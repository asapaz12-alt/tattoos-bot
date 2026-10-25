// ---------- שעות פעילות של הבוט (שעון ישראל) ----------
// מחוץ לשעות האלה הבוט שותק ואתה עונה בעצמך.
// 0=ראשון ... 5=שישי, 6=שבת. כל טווח הוא [התחלה, סיום) בשעות, למשל [11, 16] = 11:00-16:00.
const WEEKDAY = [[0, 7], [11, 16], [20, 24]];
const SCHEDULE = {
  0: WEEKDAY, // ראשון
  1: WEEKDAY,
  2: WEEKDAY,
  3: WEEKDAY,
  4: WEEKDAY, // חמישי
  5: [[0, 7], [11, 16]], // שישי: בלי ערב, כניסת שבת
  6: [[20, 24]], // שבת: רק מוצאי שבת
};

function israelNow(date = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jerusalem',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value])
  );
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { day, h: Number(p.hour) + Number(p.minute) / 60 };
}

function isActive(date = new Date(), schedule = SCHEDULE) {
  const { day, h } = israelNow(date);
  return (schedule[day] || []).some(([from, to]) => h >= from && h < to);
}

// ---------- מספרי טלפון ----------
// מחזיר מספר בפורמט של וואטסאפ (972...) או null
function normNum(s) {
  let d = String(s).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('972')) { /* כבר תקין */ }
  else if (d.startsWith('0')) d = '972' + d.slice(1);
  else if (d.length === 9 && d.startsWith('5')) d = '972' + d;
  return d.length >= 10 && d.length <= 15 ? d : null;
}

module.exports = { SCHEDULE, israelNow, isActive, normNum };
