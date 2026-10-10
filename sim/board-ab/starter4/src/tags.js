export function normalizeTag(t) { return String(t).replace(/^#/, '').toLowerCase(); }
export function parseTags(text) { const out = []; for (const m of String(text).matchAll(/#([\p{L}\p{N}_-]+)/gu)) { const t = m[1].toLowerCase(); if (!out.includes(t)) out.push(t); } return out; }
export function tagCounts(items) { const c = {}; for (const i of items) for (const t of i.tags || []) c[t] = (c[t] || 0) + 1; return c; }
