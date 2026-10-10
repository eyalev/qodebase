export function search(items, q) { const s = String(q).toLowerCase(); return items.filter((i) => i.title.toLowerCase().includes(s) || (i.tags || []).some((t) => t.includes(s))); }
