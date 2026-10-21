const express=require('express');
const axios=require('axios');
const app=express();
app.use(express.json());
const VERIFY_TOKEN='tattoo_verify_1545908834';
const PHONE_NUMBER_ID='844742339020901';
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
      const text=msg.text?.body||'';
      let reply=`היי! 🔥 ברוך הבא לסטודיו Tattoo!\nקיבלתי: "${text}"\nספר לי מה בא לך לקעקע ❤️`;
      if(text.includes('מחיר')||text.includes('כמה')) reply='המחירים שלנו:\n🔸 קטן (עד 5 ס"מ) 300-500₪\n🔸 בינוני 600-1200₪\n🔸 גדול - ייעוץ חינם\nרוצה לקבוע ייעוץ?';
      await axios.post(`https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
        {messaging_product:'whatsapp',to:from,text:{body:reply}},
        {headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});
    }
    res.sendStatus(200);
  }catch(e){console.log(e);res.sendStatus(200);}
});
app.get('/',(req,res)=>res.send('Bot is running!'));
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log('Bot running'));
