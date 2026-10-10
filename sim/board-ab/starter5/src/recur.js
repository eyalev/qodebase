import { parseDate, formatDate, addDays } from './dates.js';
export function nextOccurrence(date, every) {
  if (every === 'daily') return addDays(date, 1);
  if (every === 'weekly') return addDays(date, 7);
  const p = parseDate(date); let y = p.y, m = p.m + 1; if (m > 12) { m = 1; y++; }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return formatDate({ y, m, d: Math.min(p.d, last) });
}
