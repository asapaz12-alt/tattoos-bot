const express=require('express');
const axios=require('axios');
const app=express();
app.use(express.json());

const VERIFY_TOKEN=process.env.VERIFY_TOKEN || 'tattoo_verify_1545908834';
const PHONE_NUMBER_ID=process.env.PHONE_NUMBER_ID || '640229565752070';
const VERSION=process.env.VERSION || 'v19.0';
const OWNER_NUMBER = "972525466304";

const clients = {};

async function send(to, data){
  await axios.post(`https://graph.facebook.com/${VERSION}/${PHONE_NUMBER_ID}/messages`,
    {messaging_product:'whatsapp', to, ...data},
    {headers:{Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`}});
}

function openingMenu(to){
  return send(to, {
    type:'interactive',
    interactive:{
      type:'button',
      body:{text:'שלום הגעתם לגמ"ח המרכזי להסרת קעקועים 👋\n\nהאם אתה מטופל אצלנו?'},
      action:{buttons:[
        {type:'reply', reply:{id:'existing', title:'✅ כן, מטופל'}},
        {type:'reply', reply:{id:'not_existing', title:'❌ לא מטופל'}},
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
    const text=msg.text?.body || '';
    const lower=text.toLowerCase();
    const btn=msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id || '';

    console.log(`From ${from}: text=${text} btn=${btn}`);

    if(from !== OWNER_NUMBER && (text || btn)){
      try{ await send(OWNER_NUMBER, {type:'text', text:{body:`🔔 לקוח: ${from}\nכתב: ${text || btn}`}}); }catch(e){}
    }

    if(lower.includes('שלום')||lower.includes('היי')||lower.includes('הלו')||lower.includes('hi')||lower.includes('hey')){
      await openingMenu(from);
    }
    else if(btn==='not_existing'){
      await send(from,{
        type:'interactive',
        interactive:{
          type:'button',
          body:{text:'האם אתה רוצה להסיר קעקוע?'},
          action:{buttons:[
            {type:'reply', reply:{id:'want_remove', title:'✒️ כן, להסיר'}},
            {type:'reply', reply:{id:'talk_asa', title:'👨‍⚕️ לדבר עם אסא'}},
          ]}
        }
      });
    }
    else if(btn==='want_remove'){
      await send(from,{type:'text', text:{body:'מעולה! 👍\n\nתשלח בבקשה תמונות של הקעקועים לפה ואני אתן לך את כל הפרטים - מחיר, מספר טיפולים וכל מה שצריך לדעת! 📸'}});
    }
    else if(btn==='existing'){
      await send(from,{
        type:'interactive',
        interactive:{
          type:'list',
          body:{text:'ברוך הבא! ❤️ איזה כיף שחזרת אלינו\n\nבמה אפשר לעזור?'},
          action:{
            button:'בחר אפשרות',
            sections:[{
              title:'תפריט מטופלים',
              rows:[
                {id:'set_appointment', title:'🗓️ לקבוע תור', description:'קביעת תור לטיפול'},
                {id:'hours', title:'⏰ שעות פעילות', description:'מתי פתוח'},
                {id:'address', title:'📍 כתובת', description:'איפה אנחנו'},
                {id:'instructions', title:'📋 הוראות הכנה', description:'איך להתכונן'},
                {id:'technology', title:'💡 הטכנולוגיה', description:'באיזו טכנולוגיה משתמשים'},
                {id:'talk_asa', title:'👨‍⚕️ לדבר עם אסא', description:'מעבר לנציג'},
              ]
            }]
          }
        }
      });
    }
    else if(btn==='set_appointment'){
      await send(from,{type:'text', text:{body:'בטח! 🗓️\n\nלמתי תרצה לקבוע תור?\nתכתוב לי יום ושעה שנוחים לך ואקבע לך מיד!'}});
    }
    else if(btn==='hours'){
      await send(from,{type:'text', text:{body:'⏰ שעות הפעילות שלנו:\n\nכל יום בין 16:00-19:00\nיום שישי 10:00-12:00\n\nמחכים לך! ❤️'}});
    }
    else if(btn==='address'){
      await send(from,{type:'text', text:{body:'📍 הכתובת שלנו:\n\nהטורים 5 קומה 2 משפחת פז, ירושלים\n\nחניה בבניין! 🅿️'}});
    }
    else if(btn==='instructions'){
      await send(from,{type:'text', text:{body:'📋 הוראות הכנת הקעקוע לפני הטיפול:\n\nhttps://tattoos-off.co.il/%d7%94%d7%9b%d7%a0%d7%aa-%d7%94%d7%a7%d7%a2%d7%a7%d7%95%d7%a2-%d7%9c%d7%98%d7%99%d7%a4%d7%95%d7%9c-%d7%9c%d7%99%d7%99%d7%96%d7%a8/?preview=true\n\nחשוב לקרוא לפני שמגיעים! 👆'}});
    }
    else if(btn==='technology'){
      await send(from,{type:'text', text:{body:'💡 הטכנולוגיה שלנו להסרת קעקועים:\n\nhttps://tattoos-off.co.il/%d7%98%d7%9b%d7%a0%d7%95%d7%9c%d7%95%d7%92%d7%99%d7%aa-%d7%94%d7%a1%d7%a8%d7%aa-%d7%a7%d7%a2%d7%a7%d7%95%d7%a2%d7%99%d7%9d/\n\nהטכנולוגיה הכי מתקדמת ובטוחה בעולם! 👆'}});
    }
    else if(btn==='talk_asa'){
      await send(from,{type:'text', text:{body:'מעביר אותך לאסא... 👨‍⚕️\n\nהבוט מושתק לשעה, תכתוב חופשי ואסא יענה לך כאן מיד!\n\n(תוכל לכתוב "שלום" כדי להחזיר את הבוט)'}});
      clients[from]={pausedUntil: Date.now() + 60*60*1000};
    }
    else {
      if(clients[from] && clients[from].pausedUntil > Date.now()){}
      else { await openingMenu(from); }
    }

    res.sendStatus(200);
  }catch(e){
    console.log("ERROR:", JSON.stringify(e.response?.data || e.message, null, 2));
    res.sendStatus(200);
  }
});

app.get('/',(req,res)=>res.send('Bot is running!'));
app.listen(process.env.PORT||3000,()=>console.log('Bot running'));
