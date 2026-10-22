const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;
const OWNER_NUMBER = "972525466304"; // הפרטי שלך

const clients = {};
const pauses = {};

async function send(to, data){
  try{
    await axios.post(`https://graph.facebook.com/v20.0/${PHONE_ID}/messages`, 
    {messaging_product:"whatsapp", to, ...data},
    {headers:{Authorization:`Bearer ${TOKEN}`}});
  }catch(e){ console.log(e.response?.data || e.message); }
}

// --- תפריט הכפתורים שבנינו ---
async function sendMainMenu(to, name=""){
  await send(to, {
    type:"interactive",
    interactive:{
      type:"button",
      body:{text: `${name ? `היי ${name}! 👋` : "היי! 👋 ברוך הבא לאסא - הסרת קעקועים"}\n\nמה תרצה לעשות?`},
      action:{
        buttons:[
          {type:"reply", reply:{id:"new_client", title:"🆕 לקוח חדש"}},
          {type:"reply", reply:{id:"existing_client", title:"👋 לקוח קיים"}},
          {type:"reply", reply:{id:"address", title:"📍 כתובת ושעות"}}
        ]
      }
    }
  });
}

// --- מזהה שאלות חופשיות ---
function checkFreeText(t){
  t=t.toLowerCase();
  if(t.match(/כתובת|איפה אתה|מיקום|דוידקה|ווייז|waze/)) return "address";
  if(t.match(/שעות|פתוח|מתי/)) return "hours";
  if(t.match(/מחיר|כמה עולה|עלות|כסף/)) return "price";
  if(t.match(/כואב|כאב/)) return "pain";
  return null;
}

app.post('/webhook', async (req,res)=>{
  try{
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if(!msg) return res.sendStatus(200);
    const from = msg.from;
    const text = msg.text?.body || "";
    const btn = msg.interactive?.button_reply?.id || "";
    const img = msg.image?.id;

    // אם מושתק (דיבר עם אסא)
    if(pauses[from] && Date.now() < pauses[from]) return res.sendStatus(200);
    if(pauses[from] && Date.now() > pauses[from]) delete pauses[from];

    // אם אתה עונה מהפרטי: 972XXX הודעה
    if(from === OWNER_NUMBER){
      const m = text.match(/^(972\d{9,12})\s+([\s\S]+)/);
      if(m){ await send(m[1], {type:'text', text:{body:m[2]}}); return res.sendStatus(200); }
    }

    console.log(`מ-${from}: ${text} | כפתור: ${btn}`);

    // --- 1. תמונה - בדיקה ---
    if(img){
      await send(from, {type:'text', text:{body:"קיבלתי תמונה! בודק... 🔍"}});
      // כאן הקוד שלך לבדיקת תמונה
      return res.sendStatus(200);
    }

    // --- 2. קודם בודק אם זו שאלה חופשית (מה שביקשת עכשיו) ---
    const free = checkFreeText(text);
    if(free === "address"){
      await send(from, {type:'text', text:{body:"📍 כיכר הדוידקה 1, ירושלים\nבניין העיר קומה 2\n\n🅿️ חניה: חניון העירייה צמוד"}});
      await send(from, {type:'location', location:{latitude:31.7815, longitude:35.219, name:"אסא הסרת קעקועים", address:"הדוידקה 1 ירושלים"}});
      await sendMainMenu(from);
      return res.sendStatus(200);
    }
    if(free === "hours"){
      await send(from, {type:'text', text:{body:"🕒 א'-ה' 10:00-19:00\nו' 10:00-14:00\nעדיף לתאם מראש!"}});
      return res.sendStatus(200);
    }
    if(free === "price"){
      await send(from, {type:'text', text:{body:"💰 המחיר תלוי בגודל וצבע.\nשלח תמונה ואגיד לך מחיר מדויק - הבדיקה חינם!"}});
      return res.sendStatus(200);
    }
    if(free === "pain"){
      await send(from, {type:'text', text:{body:"כמו גומיה קטנה 😉\nשמים אלחוש וקירור, רוב הלקוחות אומרים שזה פחות כואב ממה שחשבו!"}});
      return res.sendStatus(200);
    }

    // --- 3. אם לא שאלה חופשית - ממשיך לתפריט הרגיל שבנינו ---
    if(text.match(/היי|שלום|הלו|אהלן|מה קורה|yo|hi/i) || btn){
      
      if(btn === "new_client"){
        clients[from] = {step:"ask_name"};
        await send(from, {type:'text', text:{body:"איזה כיף! 🙏 איך קוראים לך?"}});
        return res.sendStatus(200);
      }
      if(btn === "existing_client"){
        await send(from, {type:'text', text:{body:"היי אלוף! 👋 ברוך שובך\nשלח תמונה עדכנית של הקעקוע ונמשיך מאיפה שהפסקנו"}});
        return res.sendStatus(200);
      }
      if(btn === "address"){
        await send(from, {type:'text', text:{body:"📍 הדוידקה 1, ירושלים"}});
        await send(from, {type:'location', location:{latitude:31.7815, longitude:35.219, name:"אסא", address:"הדוידקה 1"}});
        return res.sendStatus(200);
      }

      // אם כתב היי בלי כפתור - תן תפריט ראשי
      if(!clients[from]){
        await sendMainMenu(from);
        return res.sendStatus(200);
      }
    }

    // --- 4. לוגיקת שם וכו' ---
    if(clients[from]?.step === "ask_name"){
      clients[from].name = text;
      clients[from].step = "done";
      await send(from, {type:'text', text:{body:`נעים מאוד ${text}! 😊\nשלח לי תמונה של הקעקוע ונבדוק אם אפשר להסיר`}});
      return res.sendStatus(200);
    }

    // ברירת מחדל
    await sendMainMenu(from, clients[from]?.name || "");
    res.sendStatus(200);

  }catch(e){ console.log(e); res.sendStatus(200); }
});

app.get('/webhook', (req,res)=>{
  if(req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) res.send(req.query['hub.challenge']);
  else res.sendStatus(403);
});

app.listen(3000, ()=> console.log("Bot running"));
