const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const { SYSTEM, T, BIZ } = require('./knowledge');

// ---------- הגדרות ----------
const {
  WHATSAPP_TOKEN: TOKEN,
  PHONE_NUMBER_ID: PHONE_ID,
  VERIFY_TOKEN,
  APP_SECRET,
  OWNER_NUMBER, // 972525466304
  ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL = 'claude-haiku-5-5',
  PORT = 3000,
} = process.env;

const WA_API = `https://graph.facebook.com/v20.0/${PHONE_ID}/messages`;
const STATE_FILE = process.env.STATE_FILE || './state.json';
const PAUSE_MS = 6 * 60 * 60 * 1000; // כמה זמן הבוט שותק אחרי שאסא עונה
const HIST_MS = 12 * 60 * 60 * 1000; // כמה זמן הבוט זוכר את השיחה

for (const [k, v] of Object.entries({ TOKEN, PHONE_ID, VERIFY_TOKEN, OWNER_NUMBER, ANTHROPIC_API_KEY })) {
  if (!v) console.warn(`⚠️  חסר משתנה סביבה: ${k}`);
}
if (!APP_SECRET) console.warn('⚠️  APP_SECRET לא מוגדר - חתימות ה-webhook לא נבדקות');

// ---------- שמירת מצב ----------
let db = { clients: {}, pauses: {}, fwd: {}, fwdKeys: [] };
try { db = { ...db, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch {}
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(STATE_FILE, JSON.stringify(db), () => {}), 500);
}

// ---------- WhatsApp ----------
const waHeaders = { Authorization: `Bearer ${TOKEN}` };

// מחזיר את מזהה ההודעה שנשלחה, או null אם נכשל
async function send(to, data) {
  try {
    const r = await axios.post(WA_API, { messaging_product: 'whatsapp', to, ...data }, { headers: waHeaders, timeout: 10000 });
    return r.data?.messages?.[0]?.id || true;
  } catch (e) {
    console.error('send failed →', to, JSON.stringify(e.response?.data || e.message));
    return null;
  }
}
const sendText = (to, body) => send(to, { type: 'text', text: { body, preview_url: true } });

function markRead(id) {
  axios.post(WA_API, { messaging_product: 'whatsapp', status: 'read', message_id: id }, { headers: waHeaders, timeout: 5000 }).catch(() => {});
}

function sendButtons(to, text, buttons) {
  return send(to, {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text },
      action: { buttons: buttons.map(([id, title]) => ({ type: 'reply', reply: { id, title } })) },
    },
  });
}

const sendMainMenu = (to) =>
  sendButtons(to, T.menu, [
    ['new', '🆕 רוצה להסיר קעקוע'],
    ['existing', '👋 לקוח קיים'],
    ['info', 'ℹ️ מידע'],
  ]);

const askGender = (to, text) => sendButtons(to, text, [['g_male', '👨 גבר'], ['g_female', '👩 אישה']]);

const sendInfoList = (to) =>
  send(to, {
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: 'על מה תרצה לדעת?' },
      action: {
        button: 'בחר נושא',
        sections: [
          {
            title: 'מידע',
            rows: [
              { id: 'info_address', title: '📍 כתובת וחניה' },
              { id: 'info_hours', title: '🕒 שעות קבלה' },
              { id: 'info_price', title: '💰 מחיר' },
              { id: 'info_prep', title: '🧴 הכנה לטיפול' },
              { id: 'info_after', title: '🩹 אחרי הטיפול' },
              { id: 'info_gallery', title: '📸 תוצאות (גלריה)' },
              { id: 'info_faq', title: '❓ שאלות נפוצות' },
            ],
          },
        ],
      },
    },
  });

const sendLocation = (to) =>
  send(to, { type: 'location', location: { latitude: BIZ.lat, longitude: BIZ.lng, name: BIZ.name, address: BIZ.address } });

// ---------- העברה אליך ----------
function remember(wamid, clientNumber) {
  if (typeof wamid !== 'string') return;
  db.fwd[wamid] = clientNumber;
  db.fwdKeys.push(wamid);
  while (db.fwdKeys.length > 400) delete db.fwd[db.fwdKeys.shift()];
  save();
}

// שולח לך את ההודעה של הלקוח. כדי לענות לו: החזק את ההודעה ולחץ "השב".
// שים לב: עובד רק אם שלחת למספר הבוט הודעה ב-24 השעות האחרונות.
async function forwardToOwner(from, c, label, msg) {
  const who = `${c.profileName || 'לקוח'} (${from})`;
  const quoted = msg?.text?.body ? `\n"${msg.text.body}"` : '';
  const id = await send(OWNER_NUMBER, {
    type: 'text',
    text: { body: `${label} - ${who}${quoted}\n\n↩️ להשיב ללקוח: החזק את ההודעה ← השב` },
  });
  if (!id) console.error('⚠️ ההעברה אליך נכשלה. שלח הודעה כלשהי למספר הבוט כדי לפתוח חלון של 24 שעות.');
  remember(id, from);
  const t = msg?.type;
  if (['image', 'video', 'audio', 'document', 'sticker'].includes(t) && msg[t]?.id) {
    remember(await send(OWNER_NUMBER, { type: t, [t]: { id: msg[t].id } }), from);
  }
}

// ---------- הגנות ----------
const seen = new Set();
function isDuplicate(id) {
  if (seen.has(id)) return true;
  seen.add(id);
  if (seen.size > 1000) seen.delete(seen.values().next().value);
  return false;
}

const hits = new Map();
function rateLimited(from) {
  const now = Date.now();
  const h = hits.get(from) || { n: 0, t: now };
  if (now - h.t > 60_000) { h.n = 0; h.t = now; }
  h.n++;
  hits.set(from, h);
  return h.n > 20;
}

function isPaused(from) {
  const until = db.pauses[from];
  if (!until) return false;
  if (Date.now() > until) { delete db.pauses[from]; save(); return false; }
  return true;
}
function pause(from) { db.pauses[from] = Date.now() + PAUSE_MS; save(); }

// ---------- זיהוי ברכה ----------
const GREET = new Set([
  'היי', 'הי', 'שלום', 'הלו', 'אהלן', 'אהלא', 'הלוו', 'בוקר', 'טוב', 'ערב', 'צהריים', 'צהרים', 'לילה',
  'מה', 'קורה', 'נשמע', 'שלומך', 'אחי', 'אחלה', 'אלוף', 'כפרה', 'שבוע', 'יום', 'hi', 'hello', 'hey', 'yo',
]);
function isGreeting(t) {
  const w = t.toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  return w.length > 0 && w.length <= 5 && w.every((x) => GREET.has(x));
}

// ---------- Claude ----------
function buildMessages(c) {
  const now = Date.now();
  c.hist = (c.hist || []).filter((m) => now - m.ts < HIST_MS).slice(-10);
  const out = [];
  for (const m of c.hist) {
    const last = out[out.length - 1];
    if (last && last.role === m.r) last.content += '\n' + m.t;
    else out.push({ role: m.r, content: m.t });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

async function askClaude(c) {
  const r = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: ANTHROPIC_MODEL,
      max_tokens: 600,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: buildMessages(c),
    },
    { headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, timeout: 30000 }
  );
  const raw = (r.data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  try {
    const j = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
    return { reply: String(j.reply || '').trim(), action: j.action || 'none', gender: j.gender || 'unknown' };
  } catch {
    return { reply: raw, action: 'none', gender: 'unknown' }; // המודל ענה בטקסט רגיל
  }
}

async function handleAI(from, c, text, msg) {
  c.hist = c.hist || [];
  c.hist.push({ r: 'user', t: text, ts: Date.now() });

  let out;
  try {
    out = await askClaude(c);
    if (!out.reply) throw new Error('empty reply');
  } catch (e) {
    console.error('Claude error:', e.response?.data || e.message);
    await forwardToOwner(from, c, '⚠️ הבוט לא הצליח לענות', msg);
    return sendText(from, T.ack);
  }

  if ((out.gender === 'male' || out.gender === 'female') && !c.gender) c.gender = out.gender;
  if (c.gender === 'female' && out.action === 'none') out.action = 'sivan';

  let reply = out.reply;
  if (out.action === 'sivan' && !reply.includes('052-5655664')) reply += '\n\n📱 סיון: 052-5655664\nhttps://wa.me/972525655664';
  if (out.action === 'sivan') c.sivanAt = Date.now();

  c.hist.push({ r: 'assistant', t: reply, ts: Date.now() });
  save();
  await sendText(from, reply);

  if (out.action === 'location') await sendLocation(from);
  if (out.action === 'owner') await forwardToOwner(from, c, '❓ צריך אותך', msg);

  // אחרי התשובה הראשונה שואלים פעם אחת גבר/אישה
  if (!c.gender && !c.askedGender && (out.action === 'none' || out.action === 'location')) {
    c.askedGender = true;
    save();
    await askGender(from, 'רק שאלה קטנה כדי להפנות אותך נכון 🙂 אתה גבר או אישה?');
  }
}

// ---------- כפתורים ----------
async function handleButton(from, c, btn) {
  switch (btn) {
    case 'new':
      if (c.gender === 'female') return referWoman(from, c);
      if (c.gender === 'male') return sendText(from, T.askPhoto);
      c.askedGender = true; save();
      return askGender(from, 'מעולה! 🙂 כדי להפנות אותך נכון - אתה גבר או אישה?');

    case 'existing':
      await forwardToOwner(from, c, '👋 לקוח קיים');
      pause(from); // מכאן ההודעות שלו מועברות אליך והבוט שותק
      return sendText(from, T.existing);

    case 'info':
      return sendInfoList(from);

    case 'g_male':
      c.gender = 'male';
      if (c.pendingImage) {
        await forwardToOwner(from, c, '📸 תמונה חדשה', c.pendingImage);
        delete c.pendingImage; save();
        return sendText(from, T.photoReceived);
      }
      save();
      return sendText(from, T.askPhoto);

    case 'g_female':
      c.gender = 'female';
      delete c.pendingImage;
      return referWoman(from, c);

    case 'info_address': await sendText(from, T.address); return sendLocation(from);
    case 'info_hours': return sendText(from, T.hours);
    case 'info_price': return sendText(from, T.price);
    case 'info_prep': return sendText(from, T.prep);
    case 'info_after': return sendText(from, T.after);
    case 'info_gallery': return sendText(from, T.gallery);
    case 'info_faq': return sendText(from, T.faq);
  }
}

async function referWoman(from, c) {
  c.sivanAt = Date.now(); save();
  return sendText(from, T.sivan);
}

// ---------- תמונות ----------
async function handleImage(from, c, msg) {
  if (c.gender === 'female') return referWoman(from, c);
  if (c.gender === 'male') {
    await forwardToOwner(from, c, '📸 תמונה חדשה', msg);
    return sendText(from, T.photoReceived);
  }
  // מגדר לא ידוע: שומרים את התמונה ושואלים
  c.pendingImage = { type: 'image', image: { id: msg.image.id } };
  c.askedGender = true; save();
  return askGender(from, 'קיבלתי את התמונה 🙏 כדי להפנות אותך נכון - אתה גבר או אישה?');
}

// ---------- פקודות בעלים ----------
async function handleOwner(msg) {
  const text = (msg.text?.body || '').trim();
  const target = msg.context?.id && db.fwd[msg.context.id];

  // מענה בהחזקה והשב על הודעה שהבוט העביר אליך
  if (target) {
    if (/^(resume|חזור)$/i.test(text)) {
      delete db.pauses[target]; save();
      return send(OWNER_NUMBER, { type: 'text', text: { body: `▶️ הבוט חזר לעבוד ל-${target}` } });
    }
    if (/^(pause|השתק)$/i.test(text)) {
      pause(target);
      return send(OWNER_NUMBER, { type: 'text', text: { body: `⏸️ הבוט מושתק ל-${target}` } });
    }
    const t = msg.type;
    if (['image', 'video', 'audio', 'document'].includes(t) && msg[t]?.id) await send(target, { type: t, [t]: { id: msg[t].id } });
    else if (text) await sendText(target, text);
    pause(target); // אסא ענה → הבוט שותק ללקוח הזה
    return;
  }

  // גיבוי: 972XXXXXXXXX הודעה
  let m = text.match(/^(972\d{9,12})\s+([\s\S]+)/);
  if (m) { await sendText(m[1], m[2]); pause(m[1]); return; }
  m = text.match(/^(pause|resume)\s+(972\d{9,12})/i);
  if (m) {
    if (m[1].toLowerCase() === 'pause') pause(m[2]); else { delete db.pauses[m[2]]; save(); }
    return send(OWNER_NUMBER, { type: 'text', text: { body: m[1].toLowerCase() === 'pause' ? `⏸️ מושתק: ${m[2]}` : `▶️ חזר: ${m[2]}` } });
  }
  return send(OWNER_NUMBER, {
    type: 'text',
    text: { body: 'כדי לענות ללקוח: החזק את ההודעה שהבוט העביר אליך ← השב.\nהבוט ישתוק ללקוח הזה 6 שעות.\nבתשובה "resume" הבוט חוזר לעבוד לו, ו"pause" משתיק אותו.' },
  });
}

// ---------- טיפול בהודעה ----------
async function handle(msg, profileName) {
  const from = msg.from;
  if (isDuplicate(msg.id)) return;
  markRead(msg.id);

  if (from === OWNER_NUMBER) return handleOwner(msg);
  if (rateLimited(from)) return;

  const c = (db.clients[from] ||= { gender: null, askedGender: false, hist: [] });
  if (profileName) c.profileName = profileName;

  const text = (msg.text?.body || '').trim();
  const btn = msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id || '';
  console.log(`מ-${from} (${profileName || '?'}): ${text || btn || msg.type}`);

  // אסא מטפל בלקוח: הבוט שותק, וכל מה שהלקוח כותב מועבר אליך
  if (isPaused(from)) {
    if (!btn && (text || msg.type !== 'reaction')) await forwardToOwner(from, c, '💬', msg);
    return;
  }

  if (btn) return handleButton(from, c, btn);
  if (msg.type === 'image') return handleImage(from, c, msg);

  if (['video', 'audio', 'document', 'sticker'].includes(msg.type)) {
    await forwardToOwner(from, c, `📩 ${msg.type}`, msg);
    return sendText(from, T.ack);
  }
  if (!text) return; // ריאקציות וכו'

  // רק ברכה (היי, שלום...) מעלה את תפריט הכפתורים
  if (isGreeting(text)) return sendMainMenu(from);

  // אישה שכבר הופנתה לסיון: מזכירים פעם ב-12 שעות, אחרת שקט
  if (c.gender === 'female') {
    if (!c.sivanAt || Date.now() - c.sivanAt > 12 * 60 * 60 * 1000) return referWoman(from, c);
    return;
  }

  return handleAI(from, c, text, msg);
}

// ---------- שרת ----------
function validSignature(req) {
  if (!APP_SECRET) return true;
  const sig = req.get('x-hub-signature-256') || '';
  const expected = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(req.rawBody || '').digest('hex');
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

const app = express();
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

app.post('/webhook', (req, res) => {
  if (!validSignature(req)) return res.sendStatus(401);
  res.sendStatus(200);

  const changes = (req.body.entry || []).flatMap((e) => e.changes || []);
  for (const ch of changes) {
    const v = ch.value || {};
    for (const m of v.messages || []) {
      const name = v.contacts?.find((x) => x.wa_id === m.from)?.profile?.name;
      handle(m, name).catch((e) => console.error('handle error:', e));
    }
  }
});

app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) res.send(req.query['hub.challenge']);
  else res.sendStatus(403);
});

app.get('/health', (_req, res) => res.send('ok'));

app.listen(PORT, () => console.log(`Bot running on :${PORT} | model: ${ANTHROPIC_MODEL}`));
