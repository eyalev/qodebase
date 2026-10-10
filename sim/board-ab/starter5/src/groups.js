export function groupByTag(items) { const g = {}; for (const i of items) for (const t of i.tags || []) (g[t] ||= []).push(i.id); for (const t in g) g[t].sort((a, b) => a - b); return g; }
