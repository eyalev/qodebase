import { addItem, getItem } from './store.js';
import { parseTags, tagCounts, normalizeTag } from './tags.js';
import { formatList } from './format.js';
import { completionRate } from './stats.js';
import { dueBefore } from './filters.js';
import { search } from './search.js';
import { toCsv } from './csv.js';
import { snapshot, undo } from './undo.js';
import { groupByTag } from './groups.js';

export const commands = [
  { name: 'add', run: (s, rest) => { snapshot(s); const words = rest.split(/\s+/); let due = null, priority = null; const title = [];
      for (const w of words) { if (w.startsWith('#')) continue; if (w.startsWith('due:')) due = w.slice(4); else if (w.startsWith('!')) priority = w.slice(1); else title.push(w); }
      const it = addItem(s, { title: title.join(' '), due, priority, tags: parseTags(rest) }); return `added #${it.id}`; } },
  { name: 'clear-done', run: (s) => { const n = s.items.filter((i) => i.done).length; s.items = s.items.filter((i) => !i.done); return `removed ${n}`; } },
  { name: 'count', run: (s) => String(s.items.length) },
  { name: 'csv', run: (s) => toCsv(s.items) },
  { name: 'done', run: (s, rest) => { const it = getItem(s, rest); if (!it) return `no item #${rest}`; snapshot(s); it.done = true; return `done #${it.id}`; } },
  { name: 'due', run: (s, rest) => formatList(dueBefore(s.items, rest)) },
  { name: 'find', run: (s, rest) => formatList(search(s.items, rest)) },
  { name: 'groups', run: (s) => Object.entries(groupByTag(s.items)).sort(([a], [b]) => a.localeCompare(b)).map(([t, ids]) => `${t}: ${ids.join(', ')}`).join('\n') },
  { name: 'help', run: () => commands.map((c) => c.name).sort().join(', ') },
  { name: 'list', run: (s) => formatList(s.items) },
  { name: 'overdue', run: (s, rest) => formatList(dueBefore(s.items.filter((i) => !i.done), rest)) },
  { name: 'rename', run: (s, rest) => { const [id, ...t] = rest.split(' '); const it = getItem(s, id); if (!it) return `no item #${id}`; it.title = t.join(' '); return `renamed #${it.id}`; } },
  { name: 'stats', run: (s) => { const r = completionRate(s.items); return `items=${s.items.length} done=${s.items.filter((i) => i.done).length} rate=${r == null ? '-' : Math.round(r * 100) + '%'}`; } },
  { name: 'tag', run: (s, rest) => { const [id, t] = rest.split(' '); const it = getItem(s, id); if (!it) return `no item #${id}`; const n = normalizeTag(t); if (!it.tags.includes(n)) it.tags.push(n); return `tagged #${it.id}`; } },
  { name: 'tags', run: (s) => { const c = tagCounts(s.items); const k = Object.keys(c).sort(); return k.length ? k.map((t) => `${t}=${c[t]}`).join(', ') : '(no tags)'; } },
  { name: 'undo', run: (s) => (undo(s) ? 'undone' : 'nothing to undo') },
];

export function runCommand(store, line) {
  const text = String(line).trim();
  const i = text.indexOf(' ');
  const name = i < 0 ? text : text.slice(0, i);
  const rest = i < 0 ? '' : text.slice(i + 1).trim();
  const cmd = commands.find((c) => c.name === name);
  if (!cmd) return `unknown command: ${name}`;
  return cmd.run(store, rest);
}
