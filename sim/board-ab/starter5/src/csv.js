const f = (v) => { const s = v == null ? '' : String(v); return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function toCsv(items) { return ['id,title,done,due,priority,tags', ...items.map((i) => [i.id, i.title, i.done, i.due, i.priority, (i.tags || []).join(';')].map(f).join(','))].join('\n'); }
