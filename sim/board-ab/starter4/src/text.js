export function slugify(t) { return String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
export function titleCase(t) { return String(t).split(/(\s+)/).map((w) => (w.trim() ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join(''); }
export function truncate(t, max) { const s = String(t); return s.length > max ? s.slice(0, max - 1) + '…' : s; }
