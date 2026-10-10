// The agent board inside a project's Landing DO (docs/board/PLAN2.md W2): who is doing what, now.
// Pure functions here (tested by board.test.mjs); storage, posts and the API are in landing.ts.
//
//   EVENT   {ts, agent, kind, intent, files, status}: posted by the platform (spawn, push, review,
//           land, bounce), by the hook in every box (edits -> files, commits) and by `forq intent`.
//   NOW     one row per agent whose last event is under TTL (10 min) old, files = all it named then.
//   RECENT  what others LANDED on main in the window, once per agent+intent (pushed/queued is not finished).
//   IN FLIGHT an agent whose latest word is pushed/queued/bounced… stays in NOW for up to 45 min.
//   ALIASES pairs the dedupe pass (`forq dedupe`, Haiku) found to be the same work.
// Advisory only: nothing here blocks an agent; the merge queue stays the gate.

export const BOARD_TTL_MS = 10 * 60_000;
export const BOARD_KEEP_MS = 24 * 3_600_000;
export const BOARD_KINDS = ['started', 'editing', 'committed', 'pushed', 'reviewing', 'approved', 'changes', 'queued', 'landed', 'bounced', 'blocked', 'done', 'gave-up'] as const;
export type BoardKind = typeof BOARD_KINDS[number];
export type BoardEvent = { ts: number; agent: string; kind: BoardKind; intent: string; files: string[]; status: string; change?: string };
export type BoardRow = BoardEvent & { ageS: number; done?: boolean };
export type Alias = { a: string; b: string; at: number; by: string };

// Finished = on main. Pushed/queued work that never landed must not read as done: at 20 agents others
// skipped those tasks and 8 were never built (qb9, 2026-10-10).
const FINISHED = new Set<string>(['landed']);
// A change on its way to main (or sent back to its agent) is still someone's work after the TTL: it stays
// in the now view, for up to IN_FLIGHT_MS, as long as that is the agent's latest word.
const IN_FLIGHT = new Set<string>(['pushed', 'reviewing', 'approved', 'changes', 'queued', 'bounced']);
export const IN_FLIGHT_MS = 45 * 60_000;

export const clip = (s: unknown, n: number) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim().slice(0, n));
export const normFiles = (files: unknown): string[] => (Array.isArray(files) ? files : String(files || '').split(','))
  .map((f) => String(f).trim().replace(/^\.?\//, '')).filter(Boolean).slice(0, 20).map((f) => f.slice(0, 200));

export function makeBoardEvent(o: { agent?: unknown; kind?: unknown; intent?: unknown; files?: unknown; status?: unknown; change?: unknown }, now = Date.now()): BoardEvent {
  const agent = clip(o.agent, 64);
  if (!agent) throw new Error('board: no agent');
  if (!(BOARD_KINDS as readonly string[]).includes(String(o.kind))) throw new Error(`board: kind must be one of ${BOARD_KINDS.join(', ')}`);
  return { ts: now, agent, kind: o.kind as BoardKind, intent: clip(o.intent, 200), files: normFiles(o.files), status: clip(o.status, 80), ...(o.change ? { change: clip(o.change, 120) } : {}) };
}

/** A path "touches" another when one is the other or a folder holding it. */
const touches = (a: string, b: string) => a === b || a.startsWith(b.replace(/\/?$/, '/')) || b.startsWith(a.replace(/\/?$/, '/'));

export type BoardQuery = { me?: string | null; files?: string[] | string; area?: string | null; now?: number; ttl?: number; recent?: number };

/** The now view (+ recent finished work when `recent` > 0), without `me`, newest first. */
export function boardView(events: BoardEvent[], q: BoardQuery = {}): BoardRow[] {
  const now = q.now ?? Date.now(), ttl = q.ttl ?? BOARD_TTL_MS, me = q.me || null;
  const rows = new Map<string, { last: BoardEvent; files: Set<string> }>();
  const latest = new Map<string, BoardEvent>();
  for (const e of events) if (e && (!latest.get(e.agent) || e.ts >= latest.get(e.agent)!.ts)) latest.set(e.agent, e);
  for (const e of events) {
    if (!e || e.agent === me) continue;
    const last = latest.get(e.agent)!;
    const keep = now - e.ts <= ttl || (IN_FLIGHT.has(last.kind) && now - last.ts <= IN_FLIGHT_MS && now - e.ts <= IN_FLIGHT_MS);
    if (!keep) continue;
    const r = rows.get(e.agent) || { last: e, files: new Set<string>() };
    if (e.ts >= r.last.ts) r.last = e;
    for (const f of e.files || []) r.files.add(f);
    rows.set(e.agent, r);
  }
  // An agent whose last word is "landed"/"done" is not working any more: it shows as finished.
  const live: BoardRow[] = [...rows.values()].filter((r) => r.last.kind !== 'landed' && r.last.kind !== 'done' && r.last.kind !== 'gave-up')
    .map((r) => ({ ...r.last, files: [...r.files], ageS: Math.round((now - r.last.ts) / 1000) })).sort((x, y) => y.ts - x.ts);
  const out: BoardRow[] = [...live];
  if ((q.recent || 0) > 0) {
    const seen = new Set(live.map((r) => `${r.agent}\n${r.intent}`));
    for (const e of [...events].sort((a, b) => b.ts - a.ts)) {
      if (!e || now - e.ts > q.recent! || e.agent === me || !FINISHED.has(e.kind) || !e.intent) continue;
      const k = `${e.agent}\n${e.intent}`; if (seen.has(k)) continue; seen.add(k);
      out.push({ ...e, done: true, ageS: Math.round((now - e.ts) / 1000) });
    }
  }
  const want = normFiles(q.files);
  let res = want.length ? out.filter((r) => r.files.some((f) => want.some((w) => touches(f, w)))) : out;
  if (q.area) { const a = q.area.toLowerCase(); res = res.filter((r) => r.intent.toLowerCase().includes(a) || r.files.some((f) => f.toLowerCase().includes(a))); }
  return res;
}

export const fmtBoardRow = (r: BoardRow) => `${r.done ? 'LANDED ' : ''}${r.agent} ${r.kind} ${fmtAge(r.ageS)}: ${clip(r.intent, 90) || '-'}`
  + `${r.files?.length ? ` [${r.files.slice(0, 5).join(', ')}${r.files.length > 5 ? ', …' : ''}]` : ''}${r.status ? ` (${r.status})` : ''}`;
const fmtAge = (s: number) => (s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`);

/** Text an agent reads (hook context, `forq who`): max `live` working rows + `done` finished rows + aliases. */
export function boardText(rows: BoardRow[], aliases: Alias[] = [], o: { live?: number; done?: number; recentMin?: number } = {}) {
  const live = rows.filter((r) => !r.done).slice(0, o.live ?? 5), done = rows.filter((r) => r.done).slice(0, o.done ?? 5);
  const parts: string[] = [];
  if (live.length) parts.push(`Working now (pushed/queued = on its way to main, not done yet):\n${live.map(fmtBoardRow).join('\n')}`);
  if (done.length) parts.push(`Landed on main in the last ${o.recentMin ?? 30} min:\n${done.map(fmtBoardRow).join('\n')}`);
  if (aliases.length) parts.push(`Same work under two names (dedupe pass): ${aliases.slice(0, 12).map((x) => `${x.a} = ${x.b}`).join('; ')}. Build it once; the other is a thin alias of it.`);
  return parts.join('\n');
}

/** The dedupe pass's answer: one JSON object {"same": [["T3","T21"], …]} somewhere in the text. */
export function parseDedupe(text: string, known?: string[]): [string, string][] {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return [];
  let j: any; try { j = JSON.parse(m[0]); } catch { return []; }
  const ok = known ? new Set(known) : null;
  const out: [string, string][] = [], seen = new Set<string>();
  for (const p of Array.isArray(j?.same) ? j.same : []) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const [a, b] = [clip(p[0], 40), clip(p[1], 40)];
    if (!a || !b || a === b || (ok && (!ok.has(a) || !ok.has(b)))) continue;
    const k = [a, b].sort().join('\n'); if (seen.has(k)) continue; seen.add(k);
    out.push([a, b]);
  }
  return out;
}

/** Task lines for the dedupe pass: list items ("- [ ] **T3** …", "3. …") and lines that start with an
 *  id ("T3: …"). id = the line's own label (T3, ISSUE-12), else its position. */
export function backlogItems(text: string): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  const ID = /^\**([A-Z]{1,6}-?\d{1,4})\**(?=[:.)\s-]|$)/;
  for (const raw of String(text || '').split('\n')) {
    const t = raw.trim();
    const l = t.replace(/^(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, '').trim();
    if (!l || (l === t && !ID.test(l))) continue;
    const label = l.match(ID)?.[1];
    out.push({ id: label || `#${out.length + 1}`, text: l.slice(0, 300) });
  }
  return out.slice(0, 200);
}

/** One call, one JSON object back (FINDINGS.md: Haiku found 5/5 far-worded pairs, no false matches). */
export function dedupePrompt(items: { id: string; text: string }[]) {
  return `Here is a project backlog. Some tasks ask for the same functionality under different names or wording. List every pair of tasks that are the same work (one of them could be a thin alias of the other). Answer with ONLY one JSON object: {"same": [["T3", "T21"], ...]} using the ids before the colons; {"same": []} if there are none.\n\n${items.map((i) => `${i.id}: ${i.text}`).join('\n')}`;
}

/** Task ids named in an intent ("T5: …", "ISSUE-12 and T7"). */
export const taskIds = (intent: string) => [...new Set((String(intent || '').match(/\b[A-Z]{1,6}-?\d{1,4}\b/g) || []))].slice(0, 5);

/** Who keeps a task when several agents claim it: the EARLIEST live claim (qb9 at 20 agents: five claimed
 *  the last task at once, each yielded to the others, nobody did it). Returns, per task id of mine, the
 *  holder when it is someone else. `claims` = each agent's stated ids and when; `live` = agents still working. */
export function claimHolders(claims: Record<string, { ids: string[]; at: number }>, me: string, live: Set<string>): Record<string, string> {
  const mine = claims[me];
  const out: Record<string, string> = {};
  if (!mine) return out;
  for (const id of mine.ids) {
    let best = { agent: me, at: mine.at };
    for (const [agent, c] of Object.entries(claims)) {
      if (agent === me || !live.has(agent) || !c.ids.includes(id)) continue;
      if (c.at < best.at || (c.at === best.at && agent < best.agent)) best = { agent, at: c.at };
    }
    if (best.agent !== me) out[id] = best.agent;
  }
  return out;
}
