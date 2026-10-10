export function parseDate(t) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(t ?? ''));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}
export function formatDate({ y, m, d }) { return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
const ms = (s) => { const p = parseDate(s); return Date.UTC(p.y, p.m - 1, p.d); };
export function addDays(s, n) { const t = new Date(ms(s) + n * 864e5); return formatDate({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }); }
export function daysBetween(a, b) { return Math.round((ms(b) - ms(a)) / 864e5); }
