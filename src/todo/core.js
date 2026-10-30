// Shared To-Do helpers: used by the To-Do page (web and Jarvis) and by Jarvis's voice commands.
(function (root) {
'use strict';
const TAGS = { small: { label: 'Small', w: 1 }, medium: { label: 'Medium', w: 2 }, important: { label: 'Important', w: 3 } };
const DAY = 86400000, START_H = 0, END_H = 24;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/* ---------- dates ---------- */
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = d => addDays(d, -((d.getDay() + 6) % 7));      // weeks start Monday
const minutes = t => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fmtTime = t => { if (!t) return ''; let [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return h + (m ? ':' + pad(m) : '') + ap; };
const fmtDur = m => !m ? '' : m < 60 ? m + 'm' : (m % 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m / 60 + 'h');
function relDay(s) {
  const d = parseYmd(s), diff = Math.round((d - today()) / DAY);
  if (diff === 0) return 'Today'; if (diff === 1) return 'Tomorrow'; if (diff === -1) return 'Yesterday';
  if (diff < 0) return Math.abs(diff) + ' days late';
  if (diff < 7) return DOW[d.getDay()];
  return DOW[d.getDay()] + ' ' + MON[d.getMonth()] + ' ' + d.getDate();
}

/* ---------- quick add parser ---------- */
function parseQuick(raw) {
  let s = ' ' + raw + ' ', date = null, time = null, dur = null, tag = null;
  const take = re => { const m = s.match(re); if (m) s = s.replace(m[0], ' '); return m; };
  let m;
  if ((m = take(/\s!(small|s|medium|m|med|important|imp|i)\b/i))) tag = { s: 'small', small: 'small', m: 'medium', med: 'medium', medium: 'medium', i: 'important', imp: 'important', important: 'important' }[m[1].toLowerCase()];
  if ((m = take(/\s(\d+(?:\.\d+)?)\s?(h|hr|hrs|hours?|m|min|mins|minutes?)\b/i))) dur = Math.round(parseFloat(m[1]) * (/^h/i.test(m[2]) ? 60 : 1));
  if ((m = take(/\s(?:at\s)?(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/i))) { let h = +m[1] % 12; if (/pm/i.test(m[3])) h += 12; time = pad(h) + ':' + (m[2] || '00'); }
  else if ((m = take(/\s(?:at\s)?([01]?\d|2[0-3]):([0-5]\d)\b/))) time = pad(+m[1]) + ':' + m[2];
  const t0 = today();
  if ((m = take(/\s(today|tonight)\b/i))) date = t0;
  else if ((m = take(/\s(tomorrow|tmrw|tmr)\b/i))) date = addDays(t0, 1);
  else if ((m = take(/\snext week\b/i))) date = addDays(startOfWeek(t0), 7);
  else if ((m = take(/\s(?:on\s|next\s)?(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?\b/i))) {
    const idx = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 }[m[1].toLowerCase()];
    let diff = (idx - t0.getDay() + 7) % 7; if (diff === 0 || /next/i.test(m[0])) diff += diff === 0 ? 7 : 0; date = addDays(t0, diff);
  }
  else if ((m = take(/\s(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s(\d{1,2})(?:st|nd|rd|th)?\b/i))) {
    const mo = MON.findIndex(x => x.toLowerCase() === m[1].slice(0, 3).toLowerCase()); let d = new Date(t0.getFullYear(), mo, +m[2]); if (d < t0) d.setFullYear(d.getFullYear() + 1); date = d;
  }
  else if ((m = take(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    let y = m[3] ? +m[3] : t0.getFullYear(); if (y < 100) y += 2000; let d = new Date(y, +m[1] - 1, +m[2]); if (!m[3] && d < t0) d.setFullYear(y + 1); date = d;
  }
  if (time && !date) date = t0;
  const title = s.replace(/\s+/g, ' ').trim();
  return { title, date: date ? ymd(date) : null, time, dur, tag };
}

root.TodoCore = { TAGS, DAY, START_H, END_H, DOW, MON, MONL, pad, ymd, parseYmd, today, addDays, startOfWeek, minutes, fmtTime, fmtDur, relDay, parseQuick };
})(typeof window !== 'undefined' ? window : globalThis);
