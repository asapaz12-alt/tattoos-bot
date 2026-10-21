const express=require('express');
const axios=require('axios');
const app=express();
app.use(express.json());

const VERIFY_TOKEN=process.env.VERIFY_TOKEN || 'tattoo_verify_1545908834';
const PHONE_NUMBER_ID=process.env.PHONE_NUMBER_ID || '640229565752070';
const VERSION=process.env.VERSION || 'v19.0';
const OWNER_NUMBER = "972525466304"; // המספר הפרטי שלך לקבל התראות

const clients = {};

async function send(to, data){
  await axios.post(`https://graph.facebook.com/${VERSION}/${PHONE_NUMBER_ID}/messages`,
    {messaging_product:'whatsapp', to, ...data},
    {headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});
}

function mainMenu(to){
  return send(to, {
    type:'interactive',
    interactive:{
      type:'button',
      body:{text:'היי! 🔥 ברוך הבא ל-Tattoo Studio!\n\nספר לי, אתה אצלנו...'},
      action:{buttons:[
        {type:'reply', reply:{id:'new_client', title:'🆕 לקוח חדש'}},
        {type:'reply', reply:{id:'old_client', title:'❤️ לקוח ותיק'}},
      ]}
    }
  });
}

app.get('/webhook',(req,res)=>{
  if(req.query['hub.verify_token']===VERIFY_TOKEN) res.send(req.query['hub.challenge']);
  else res.sendStatus(403);
});

app.post('/webhook',async(req,res)=>{
  try{
    const value=req.body.entry?.[0]?.changes?.[0]?.value;
    const msg=value?.messages?.[0];
    if(!msg){ return res.sendStatus(200); }
    const from=msg.from;
    const text=msg.text?.body?.toLowerCase() || '';
    const btn=msg.interactive?.button_reply?.id || '';

    // שלח לך התראה לפרטי על כל לקוח
    if(from !== OWNER_NUMBER){
      try{
        await send(OWNER_NUMBER, {type:'text', text:{body:`🔔 לקוח: ${from}\nאמר: ${text || btn}`}});
      }catch(e){}
    }

    if(text.includes('היי')||text.includes('שלום')||text.includes('הלו')||text===''){
      await mainMenu(from);
    }
    else if(btn==='new_client'){
      await send(from,{type:'interactive',interactive:{type:'button',body:{text:'איזה כיף שבאת! 🥳\nמה בא לך לעשות?'},action:{buttons:[{type:'reply', reply:{id:'new_tattoo', title:'✒️ קעקוע חדש'}},{type:'reply', reply:{id:'remove_tattoo', title:'❌ הסרת קעקוע'}},{type:'reply', reply:{id:'consult', title:'💬 ייעוץ'}},]}}});
    }
    else if(btn==='remove_tattoo'){
      await send(from,{type:'text', text:{body:'להסרת קעקוע אנחנו צריכים לראות תמונה 📸\n\nשלח לי עכשיו תמונה של הקעקוע + איפה בגוף, ואחזור אליך עם מחיר ומספר טיפולים משוער!'}});
    }
    else if(btn==='new_tattoo'){
      await send(from,{type:'text', text:{body:'🔥 אש! \nשלח לי:\n1. תמונה / סקיצה\n2. איפה בגוף\n3. גודל בערך\n\nואכין לך הצעת מחיר! ❤️'}});
    }
    else if(btn==='old_client'){
      await send(from,{type:'interactive',interactive:{type:'button',body:{text:'איזה כיף שחזרת! ❤️\nאיך אפשר לעזור?'},action:{buttons:[{type:'reply', reply:{id:'old_treatment', title:'🩹 הגעה לטיפול'}},{type:'reply', reply:{id:'old_address', title:'📍 הכתובת'}},{type:'reply', reply:{id:'old_human', title:'👨‍🎨 דבר עם נציג'}},]}}});
    }
    else if(btn==='old_treatment'){
      await send(from,{type:'text', text:{body:'כמובן! 🗓️\nכתוב לי מתי נוח לך להגיע ואיזה קעקוע, ואקבע לך תור!'}});
    }
    else if(btn==='old_address'){
      await send(from,{type:'text', text:{body:'📍 הרצל 123 תל אביב\nא-ה 10:00-20:00, ו 10:00-15:00\nחניה חינם! 🅿️'}});
    }
    else if(btn==='old_human' || btn==='consult' || text.includes('נציג')){
      await send(from,{type:'text', text:{body:'מעביר אותך לנציג... 👨‍🎨\nהבוט מושתק לשעה, תכתוב חופשי!'}});
      clients[from]={pausedUntil: Date.now() + 60*60*1000};
    }
    else {
      if(clients[from] && clients[from].pausedUntil > Date.now()){}
      else { await mainMenu(from); }
    }
    res.sendStatus(200);
  }catch(e){
    console.log("ERROR:", JSON.stringify(e.response?.data || e.message, null, 2));
    res.sendStatus(200);
  }
});

app.get('/',(req,res)=>res.send('Bot is running!'));
app.listen(process.env.PORT||3000,()=>console.log('Bot running'));
