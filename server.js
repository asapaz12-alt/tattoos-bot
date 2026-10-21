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
      const text=msg.text?.body||'';
      let reply=`היי! 🔥 ברוך הבא לסטודיו Tattoo!\nקיבלתי: "${text}"\nספר לי מה בא לך לקעקע ❤️`;
      if(text.includes('מחיר')||text.includes('כמה')) reply='המחירים שלנו:\n🔸 קטן (עד 5 ס"מ) 300-500₪\n🔸 בינוני 600-1200₪\n🔸 גדול - ייעוץ חינם\nרוצה לקבוע ייעוץ?';
      
      console.log(`Trying to send to ${from} from ${PHONE_NUMBER_ID}`);
      
      await axios.post(`https://graph.facebook.com/${VERSION}/${PHONE_NUMBER_ID}/messages`,
        {messaging_product:'whatsapp',to:from,text:{body:reply}},
        {headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});
      
      console.log(`✅ Message sent to ${from}`);
    }
    res.sendStatus(200);
  }catch(e){
    console.log("FULL ERROR:", JSON.stringify(e.response?.data || e.message, null, 2));
    res.sendStatus(200);
  }
});

app.get('/',(req,res)=>res.send('Bot is running!'));
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log('Bot running on port', PORT));
