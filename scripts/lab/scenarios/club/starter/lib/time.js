// Lisbon local time. Dates are 'YYYY-MM-DD', times 'HH:MM'.
const parts = (ms) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));

export function now() { const p = parts(Date.now()); return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }; }
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
export const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export function addDays(date, n) { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function daysBetween(a, b) { return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400_000); }
export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export function weekday(date) { return DAYS[(new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7]; }
export const minutes = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
// epoch ms of a Lisbon wall-clock time (handles summer time)
export function toEpoch(date, time) {
  const guess = Date.parse(`${date}T${time}:00Z`);
  for (const off of [0, 1, 2, -1]) { const t = guess - off * 3600_000; const p = parts(t); if (`${p.year}-${p.month}-${p.day}` === date && `${p.hour}:${p.minute}` === time) return t; }
  return guess;
}
export const hoursUntil = (date, time) => (toEpoch(date, time) - Date.now()) / 3600_000;
