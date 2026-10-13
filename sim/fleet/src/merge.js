// The collision dial's merge (2026-10-13): agents' changes to the same file land the way git would land them.
// A comment change is pure line insertions over the text the agent read (its base). Two changes on one base merge
// cleanly when their insertions sit at different points (git: hunks that do not overlap); the same point with different
// lines is a conflict (identical lines are taken once, as git does). A conflicting change is replayed on the new text:
// its comments go above its declarations again, and a declaration someone already documented is left as it is
// ('duplicate, kept the first'). Pure functions: tested in merge.test.mjs, used by the fleet's Lander.
import { targets, insert, verify } from './doc.js';

/** text = base + inserted lines only? -> [{at: base line index, lines}] (insertions before base line `at`), else null. */
export function insertionsOf(base, text) {
  const b = base.split('\n'), t = text.split('\n');
  const out = [];
  let i = 0, j = 0;
  while (j < t.length) {
    if (i < b.length && b[i] === t[j]) { i++; j++; continue; }
    // A run of inserted lines: up to the next line that matches base[i] (comment blocks never contain code lines).
    const start = j;
    while (j < t.length && !(i < b.length && b[i] === t[j])) j++;
    if (j === t.length && i < b.length) return null;   // base lines left over: not a pure insertion
    out.push({ at: i, lines: t.slice(start, j) });
  }
  return i === b.length ? out : null;
}

function apply(base, ins) {
  const b = base.split('\n'), by = new Map();
  for (const x of ins) by.set(x.at, [...(by.get(x.at) || []), ...x.lines]);
  const out = [];
  for (let i = 0; i <= b.length; i++) { if (by.has(i)) out.push(...by.get(i)); if (i < b.length) out.push(b[i]); }
  return out.join('\n');
}

/** Three-way merge of two insertion-only changes on the same base. -> {text, identical} or {conflict: line} */
export function merge3(base, ours, theirs) {
  const a = insertionsOf(base, ours), b = insertionsOf(base, theirs);
  if (!a || !b) return { conflict: -1, why: 'not insertions only' };
  const at = new Map(a.map((x) => [x.at, x]));
  let identical = 0;
  const add = [];
  for (const x of b) {
    const y = at.get(x.at);
    if (!y) { add.push(x); continue; }
    if (y.lines.join('\n') === x.lines.join('\n')) { identical++; continue; }   // both sides added the same lines
    return { conflict: x.at };
  }
  return { text: apply(base, [...a, ...add]), identical };
}

/** Land one change on the file's current text. base = what the agent read, mine = its result, names/comments = its intent. */
export function landOne(path, current, base, mine, names, comments) {
  if (current === base) return { text: mine, how: 'clean' };
  const m = merge3(base, current, mine);
  if (m.text !== undefined) {
    const v = verify(path, current, m.text);
    if (v.ok) return { text: m.text, how: m.identical ? 'identical' : 'merged' };
  }
  // Replay by intent on the new text.
  const tg = targets(path, current).filter((t) => names.includes(t.name));
  if (!tg.length) return { text: current, how: 'duplicate' };
  const { text, inserted } = insert(current, tg, comments);
  if (!inserted) return { text: current, how: 'duplicate' };
  const v = verify(path, current, text);
  if (!v.ok) return { text: current, how: 'replay_failed', why: v.why };
  return { text, how: tg.length < names.length ? 'replayed_partly' : 'replayed' };
}
