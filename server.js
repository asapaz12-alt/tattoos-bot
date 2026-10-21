const express=require('express');
const axios=require('axios');
const app=express();
app.use(express.json());

const VERIFY_TOKEN=process.env.VERIFY_TOKEN || 'tattoo_verify_1545908834';
const PHONE_NUMBER_ID=process.env.PHONE_NUMBER_ID || '640229565752070';
const VERSION=process.env.VERSION || 'v19.0';

app.get('/webhook',(req,res)=>{
  if(req.query['hub.verify_token']===VERIFY_TOKEN){
    res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook',async(req,res)=>{
  try{
    const entry=req.body.entry?.[0]?.changes?.[0]?.value;
    const msg=entry?.messages?.[0];
    if(msg){
      const from=msg.from;
      const text=(msg.text?.body||'').toLowerCase();
      let reply='';

      // תפריט חכם
      if(text.includes('מחיר')||text.includes('כמה')||text.includes('עולה')){
        reply=`💰 *המחירון שלנו:*\n\n🔸 קטן (עד 5 ס"מ) 300-500₪\n🔸 בינוני (5-15 ס"מ) 600-1200₪\n🔸 גדול / שרוול - ייעוץ חינם\n\nרוצה הצעת מחיר מדויקת? שלח תמונה של הסקיצה! 📸`;
      } else if(text.includes('שעות')||text.includes('פתוח')||text.includes('מתי')){
        reply=`🕒 *שעות פתיחה:*\n\nא'-ה': 10:00-20:00\nו': 10:00-15:00\nשבת: סגור\n\nרוצה לקבוע תור? 😊`;
      } else if(text.includes('מיקום')||text.includes('כתובת')||text.includes('איפה')){
        reply=`📍 *אנחנו כאן:*\nרחוב הרצל 123, תל אביב\nחניה חינם ללקוחות!\nשלח לי "נווט" ואשלח לך מיקום ב-Waze`;
      } else if(text.includes('תור')||text.includes('לקבוע')||text.includes('ייעוץ')){
        reply=`🔥 *בוא נקבע!*\nכדי לקבוע ייעוץ חינם שלח לי:\n1. איזה קעקוע בא לך\n2. איפה בגוף\n3. מתי נוח לך להגיע\n\nואחזור אליך תוך שעה! ❤️`;
      } else if(text.includes('היי')||text.includes('שלום')||text.includes('הלו')){
        reply=`היי! 🔥 ברוך הבא לסטודיו Tattoo!\n\nאני הבוט החכם שלנו, איך אפשר לעזור?\n\nכתוב לי:\n💰 "מחיר" - למחירון\n🕒 "שעות" - לשעות פתיחה\n📍 "מיקום" - לכתובת\n📅 "תור" - לקביעת ייעוץ`;
      } else {
        reply=`קיבלתי: "${msg.text?.body}" 🔥\n\nספר לי קצת יותר - מה בא לך לקעקע? ואיפה בגוף?\n\n💡 טיפ: כתוב "מחיר" / "שעות" / "מיקום" / "תור"`;
      }
      
      await axios.post(`https://graph.facebook.com/${VERSION}/${PHONE_NUMBER_ID}/messages`,
        {messaging_product:'whatsapp',to:from,text:{body:reply}},
        {headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});
      
      console.log(`✅ Sent to ${from}: ${reply.substring(0,30)}...`);
    }
    res.sendStatus(200);
  }catch(e){
    console.log("ERROR:", JSON.stringify(e.response?.data || e.message, null, 2));
    res.sendStatus(200);
  }
});

app.get('/',(req,res)=>res.send('Bot is running!'));
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log('Bot running'));
