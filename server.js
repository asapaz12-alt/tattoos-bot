const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');

// ---------- הגדרות ----------
const {
  WHATSAPP_TOKEN: TOKEN,
  PHONE_NUMBER_ID: PHONE_ID,
  VERIFY_TOKEN,
  APP_SECRET,          // מ-Meta: App Settings > Basic > App Secret (לאימות חתימה)
  OWNER_NUMBER,        // למשל 972525466304
  PORT = 3000,
} = process.env;

const API = `https://graph.facebook.com/v20.0/${PHONE_ID}/messages`;
const STATE_FILE = process.env.STATE_FILE || './state.json';
const PAUSE_MS = 6 * 60 * 60 * 1000; // כמה זמן הבוט שותק אחרי שאסא עונה ללקוח

for (const [k, v] of Object.entries({ TOKEN, PHONE_ID, VERIFY_TOKEN, OWNER_NUMBER })) {
  if (!v) console.warn(`⚠️  חסר משתנה סביבה: ${k}`);
}
if (!APP_SECRET) console.warn('⚠️  APP_SECRET לא מוגדר - חתימות ה-webhook לא נבדקות');

const BIZ = {
  name: 'אסא הסרת קעקועים',
  lat: 31.7815,
  lng: 35.219,
  address: 'כיכר הדוידקה 1, ירושלים',
};

// ---------- שמירת מצב (שורד ריסטארט) ----------
let db = { clients: {}, pauses: {} };
try { db = { ...db, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch {}
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(STATE_FILE, JSON.stringify(db), () => {}), 500);
}

// ---------- שליחה ----------
const headers = { Authorization: `Bearer ${TOKEN}` };

async function send(to, data) {
  try {
    await axios.post(API, { messaging_product: 'whatsapp', to, ...data }, { headers, timeout: 10000 });
    return true;
  } catch (e) {
    console.error('send failed →', to, JSON.stringify(e.response?.data || e.message));
    return false;
  }
}
const sendText = (to, body) => send(to, { type: 'text', text: { body } });

function markRead(id) {
  axios.post(API, { messaging_product: 'whatsapp', status: 'read', message_id: id }, { headers, timeout: 5000 })
    .catch(() => {});
}

// הודעה אליך. שים לב: עובד רק אם שלחת הודעה למספר הבוט ב-24 השעות האחרונות
const notifyOwner = (text) => sendText(OWNER_NUMBER, text);

async function sendAddress(to) {
  await sendText(to, `📍 ${BIZ.address}\nבניין העיר קומה 2\n\n🅿️ חניה: חניון העירייה צמוד`);
  await send(to, { type: 'location', location: { latitude: BIZ.lat, longitude: BIZ.lng, name: BIZ.name, address: BIZ.address } });
}

async function sendMainMenu(to, name = '') {
  await send(to, {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: `${name ? `היי ${name}! 👋` : `היי! 👋 ברוך הבא ל${BIZ.name}`}\n\nמה תרצה לעשות?` },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'new_client', title: '🆕 לקוח חדש' } },
          { type: 'reply', reply: { id: 'existing_client', title: '👋 לקוח קיים' } },
          { type: 'reply', reply: { id: 'address', title: '📍 כתובת ושעות' } },
        ],
      },
    },
  });
}

// ---------- זיהוי כוונה ----------
// הסדר חשוב: תיאום לפני שעות, כדי ש"מתי אפשר לתאם" לא ייתפס כשעות
const INTENTS = [
  ['booking', /לתאם|תיאום|לקבוע|פגישה|תור\b|להגיע/],
  ['address', /כתובת|איפה (אתה|אתם)|מיקום|דוידקה|ווייז|waze/i],
  ['hours',   /שעות|פתוח|פתוחים|עד איזו שעה/],
  ['price',   /מחיר|כמה עולה|כמה זה עולה|עלות/],
  ['pain',    /כואב|כאב/],
];
const detectIntent = (t) => INTENTS.find(([, re]) => re.test(t))?.[0] || null;

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
  return h.n > 20; // יותר מ-20 הודעות בדקה - מתעלמים
}

function isPaused(from) {
  const until = db.pauses[from];
  if (!until) return false;
  if (Date.now() > until) { delete db.pauses[from]; save(); return false; }
  return true;
}

// ---------- פקודות בעלים ----------
async function handleOwner(text) {
  let m = text.match(/^(972\d{9,12})\s+([\s\S]+)/);
  if (m) {
    await sendText(m[1], m[2]);
    db.pauses[m[1]] = Date.now() + PAUSE_MS; // אסא ענה → הבוט שותק ללקוח הזה
    save();
    return;
  }
  m = text.match(/^(pause|resume)\s+(972\d{9,12})/i);
  if (m) {
    if (m[1].toLowerCase() === 'pause') db.pauses[m[2]] = Date.now() + PAUSE_MS;
    else delete db.pauses[m[2]];
    save();
    return sendText(OWNER_NUMBER, m[1].toLowerCase() === 'pause' ? `⏸️ הבוט מושתק ל-${m[2]}` : `▶️ הבוט חזר לעבוד ל-${m[2]}`);
  }
  return sendText(OWNER_NUMBER,
    'פקודות:\n972XXXXXXXXX הודעה - שליחה ללקוח (והבוט שותק לו 6 שעות)\npause 972XXXXXXXXX - השתקה\nresume 972XXXXXXXXX - חזרה לבוט');
}

// ---------- טיפול בהודעה ----------
async function handle(msg, profileName) {
  const from = msg.from;
  if (isDuplicate(msg.id)) return;
  markRead(msg.id);

  const text = (msg.text?.body || '').trim();
  const btn = msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id || '';

  if (from === OWNER_NUMBER) return handleOwner(text);
  if (isPaused(from)) return;
  if (rateLimited(from)) return;

  const c = (db.clients[from] ||= { name: '', step: null });
  console.log(`מ-${from} (${profileName || '?'}): ${text || msg.type} | כפתור: ${btn}`);

  // --- כפתורים ---
  if (btn === 'new_client') {
    c.step = 'ask_name'; save();
    return sendText(from, 'איזה כיף! 🙏 איך קוראים לך?');
  }
  if (btn === 'existing_client') {
    c.step = null; save();
    await sendText(from, 'היי אלוף! 👋 ברוך שובך\nשלח תמונה עדכנית של הקעקוע ונמשיך מאיפה שהפסקנו');
    return notifyOwner(`👋 לקוח קיים לחץ על הכפתור: ${c.name || profileName || ''} (${from})`);
  }
  if (btn === 'address') {
    await sendAddress(from);
    return sendText(from, '🕒 א\'-ה\' 10:00-19:00\nו\' 10:00-14:00\nעדיף לתאם מראש!');
  }

  // --- תמונה: מעבירים אליך ישירות ---
  if (msg.type === 'image') {
    const who = c.name || profileName || 'לא ידוע';
    const caption = `📸 תמונה מ-${who}\n${from}\n\nלהשיב: ${from} הודעה`;
    const ok = await send(OWNER_NUMBER, { type: 'image', image: { id: msg.image.id, caption } });
    if (!ok) await notifyOwner(`📸 התקבלה תמונה מ-${who} (${from}) אבל ההעברה נכשלה`);
    return sendText(from, 'קיבלתי את התמונה 🙏\nאסא יבדוק ויחזור אליך עם הערכת מחיר בהקדם');
  }

  // --- סוגי הודעות אחרים (הקלטה, וידאו, מסמך) ---
  if (!text) {
    await sendText(from, 'קיבלתי 🙏 אסא יחזור אליך בהקדם');
    return notifyOwner(`📩 ${msg.type} מ-${c.name || profileName || ''} (${from})`);
  }

  // --- שלבי שיחה: קודם כל, כדי ששם כמו "מתי" לא ייתפס כשאלת שעות ---
  if (c.step === 'ask_name' && text.length <= 40) {
    c.name = text; c.step = null; save();
    await notifyOwner(`🆕 ליד חדש: ${text} (${from})`);
    return sendText(from, `נעים מאוד ${text}! 😊\nשלח לי תמונה של הקעקוע ונבדוק אם אפשר להסיר`);
  }
  if (c.step === 'ask_time') {
    c.step = null; save();
    await notifyOwner(`📅 בקשת תיאום מ-${c.name || profileName || ''} (${from}):\n${text}\n\nלהשיב: ${from} הודעה`);
    return sendText(from, 'רשמתי 🙏 אסא יחזור אליך לאשר את התור');
  }

  // --- שאלות חופשיות ---
  switch (detectIntent(text)) {
    case 'booking':
      c.step = 'ask_time'; save();
      return sendText(from, 'בשמחה! 📅 מתי נוח לך? (יום ושעה, למשל "יום שלישי אחר הצהריים")');
    case 'address':
      await sendAddress(from);
      return sendMainMenu(from, c.name);
    case 'hours':
      return sendText(from, '🕒 א\'-ה\' 10:00-19:00\nו\' 10:00-14:00\nעדיף לתאם מראש!');
    case 'price':
      return sendText(from, '💰 המחיר תלוי בגודל וצבע.\nשלח תמונה ואגיד לך מחיר מדויק - הבדיקה חינם!');
    case 'pain':
      return sendText(from, 'כמו גומיה קטנה 😉\nשמים אלחוש וקירור, רוב הלקוחות אומרים שזה פחות כואב ממה שחשבו!');
  }

  // --- ברירת מחדל ---
  return sendMainMenu(from, c.name);
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
  res.sendStatus(200); // עונים מיד כדי ש-Meta לא תשלח שוב

  const changes = (req.body.entry || []).flatMap((e) => e.changes || []);
  for (const ch of changes) {
    const v = ch.value || {};
    for (const m of v.messages || []) { // כל ההודעות, לא רק הראשונה
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

app.listen(PORT, () => console.log(`Bot running on :${PORT}`));
