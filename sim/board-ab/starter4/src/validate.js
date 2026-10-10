import { parseDate } from './dates.js';
export function validateItem(i) { const p = []; if (!i.title || !String(i.title).trim()) p.push('missing title'); if (i.due != null && !parseDate(i.due)) p.push('bad due date'); if (![null, undefined, 'high', 'medium', 'low'].includes(i.priority)) p.push('bad priority'); return p; }
