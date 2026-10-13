// The intent tree (qb5, manager 2026-10-13, Eyal approved): with a thousand agents you cannot watch agents, you browse
// intents. Read-only, built from data that already exists:
//   a real build: the person's request -> areas (the top folder each change claims) -> each agent's intent -> its change
//                 (record, commits, diff), from the Project DO (requests, agents) + the Landing view (changes);
//   a fleet run:  the job -> folders nested by path -> each file's change (its record; the diff comes from /runs' change
//                 endpoint when opened), from the fleet Run's records.
// Status rolls up every node: needs (you), blocked, working, waiting, done; with counts, $ where known, and time. Children
// are sorted needs > blocked > working > waiting > done and paged, so a 10k-leaf run opens as fast as a 10-leaf build.
// Reverse: why(id) is the path from a node up to the request.
//   GET /api/p/<o>/<n>/intents[?node=<id>&offset=&limit=][&why=<id>]
//   GET /api/runs/<repo>/<run>/intents[?node=<path>&offset=&limit=][&why=<path>]
// Pure functions (no Cloudflare imports): tested by src/intents.test.mjs.

// 'failed' is terminal: it did not land and nothing is going to retry it (a fleet file whose answer was rejected, a halted
// run's change). It ranks after the open states: a group with nothing open is done, with "N didn't land" beside it.
export type Status = 'needs' | 'blocked' | 'working' | 'waiting' | 'failed' | 'done';
export const ORDER: Status[] = ['needs', 'blocked', 'working', 'waiting', 'failed', 'done'];
const OPEN: Status[] = ['needs', 'blocked', 'working', 'waiting'];
export type Counts = Record<Status, number>;
export type Node = {
  id: string; kind: 'project' | 'request' | 'area' | 'intent' | 'job' | 'folder' | 'file';
  label: string; sub?: string; status: Status; counts: Counts; leaves: number;
  usd: number | null; startedAt: number | null; endedAt: number | null;
  waitingOn?: string; who?: string; pending?: number; kids: number; parent: string | null;
  later?: { n: number; at: number };   // a build's group: changes that landed after the build settled (its time stops at the build)
  detail?: unknown;   // leaves only: what the client shows when the node opens
};
export type Page = { node: Node; children: Node[]; offset: number; limit: number; total: number; path?: Node[] };

const zero = (): Counts => ({ needs: 0, blocked: 0, working: 0, waiting: 0, failed: 0, done: 0 });
export const rollStatus = (c: Counts): Status => OPEN.find((s) => c[s] > 0) || (c.done > 0 || !c.failed ? 'done' : 'failed');
const rank = (s: Status) => ORDER.indexOf(s);
/** Needs-you and blocked float up; then working, waiting, didn't land, done; groups before leaves; then newest work first, then name. */
export const byPriority = (a: Node, b: Node) => rank(a.status) - rank(b.status) || (b.kids ? 1 : 0) - (a.kids ? 1 : 0) || (b.startedAt || 0) - (a.startedAt || 0) || a.label.localeCompare(b.label);

/** A tree held in memory: nodes by id, children ids by parent. */
export class Tree {
  nodes = new Map<string, Node>();
  kids = new Map<string, string[]>();
  add(n: Node) { this.nodes.set(n.id, n); if (n.parent != null) { const k = this.kids.get(n.parent) || []; k.push(n.id); this.kids.set(n.parent, k); } return n; }
  /** Sum leaves up: counts, $, first start, last end; a node's status is the most urgent of its leaves. */
  roll(id: string): Node {
    const n = this.nodes.get(id)!;
    const ks = this.kids.get(id) || [];
    n.kids = ks.length;
    if (!ks.length) { if (!n.leaves) { n.counts = zero(); n.counts[n.status] = 1; n.leaves = 1; } return n; }
    const c = zero(); let usd: number | null = null, s: number | null = null, e: number | null = null, leaves = 0, open = false;
    for (const k of ks) {
      const x = this.roll(k);
      for (const st of ORDER) c[st] += x.counts[st];
      leaves += x.leaves;
      if (x.usd != null) usd = (usd || 0) + x.usd;
      if (x.startedAt != null) s = s == null ? x.startedAt : Math.min(s, x.startedAt);
      if (x.endedAt == null && OPEN.includes(x.status)) open = true;
      if (x.endedAt != null) e = e == null ? x.endedAt : Math.max(e, x.endedAt);
    }
    n.counts = c; n.leaves = leaves; n.status = rollStatus(c);
    if (n.usd == null) n.usd = usd;
    if (n.startedAt == null) n.startedAt = s;
    n.endedAt = open ? null : e;
    // A group waits on what its most urgent child waits on.
    if (!n.waitingOn && (n.status === 'needs' || n.status === 'waiting' || n.status === 'working')) { const top = ks.map((k) => this.nodes.get(k)!).sort(byPriority)[0]; if (top && top.status === n.status && top.waitingOn) n.waitingOn = top.waitingOn; }
    return n;
  }
  page(id: string, offset = 0, limit = 50): Page | null {
    const node = this.nodes.get(id);
    if (!node) return null;
    const all = (this.kids.get(id) || []).map((k) => this.nodes.get(k)!).sort(byPriority);
    const lim = Math.max(1, Math.min(200, limit | 0 || 50)), off = Math.max(0, offset | 0);
    return { node: strip(node), children: all.slice(off, off + lim).map(strip), offset: off, limit: lim, total: all.length };
  }
  /** The path from the root down to a node (for "why does this exist"). */
  path(id: string): Node[] {
    const out: Node[] = [];
    for (let n = this.nodes.get(id); n; n = n.parent != null ? this.nodes.get(n.parent) : undefined) out.unshift(strip(n));
    return out;
  }
  /** Nodes whose label or sub contains every word (Talk: "what is photo upload waiting on"). Leaves first, at most `max`. */
  find(words: string, max = 5): Node[] {
    const ws = words.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    if (!ws.length) return [];
    const hit: Node[] = [];
    for (const n of this.nodes.values()) { const t = `${n.label} ${n.sub || ''}`.toLowerCase(); if (ws.every((w) => t.includes(w))) hit.push(n); }
    return hit.sort((a, b) => a.kids - b.kids || byPriority(a, b)).slice(0, max).map(strip);
  }
}
// What a list row needs; a leaf keeps its detail (small: one change, or one file's record).
const strip = (n: Node): Node => ({ ...n });

// ---------------------------------------------------------------- real builds ----
type Ev = { t: number; what: string; detail?: string };
type Change = {
  id: string; title?: string; intent?: string; agent?: string; state: string; claims?: string[]; files?: string[];
  stackedOn?: string | null; commit?: string | null; base?: string | null; events?: Ev[]; createdAt?: number; landedAt?: number | null;
  review?: { verdict?: string; notes?: string } | null; lead?: string | null;
  landing?: { how?: string | null; mainCommit?: string | null; conflicts?: string[]; diff?: { path: string; lines: string[] }[] } | null;
};
type View = { changes: Change[]; areas?: { path: string }[]; run?: { stopped?: boolean; paused?: boolean } | null; progress?: { spentUsd?: number; actualUsd?: number } | null;
  queue?: { trains?: { changes: string[]; state: string }[] }; flags?: Record<string, unknown> };
type Info = { slug: string; name: string; autoLand?: boolean; requests?: { text: string; at: number; from?: string }[]; lastRequest?: { text: string; at: number } | null;
  agents?: { id: string; task?: string; request?: string; createdAt?: number }[] };

/** One change's status, and what it waits on, in plain words. */
export function changeStatus(c: Change, v: View, autoLand: boolean): { status: Status; waitingOn?: string; word: string } {
  const verdict = c.review?.verdict;
  if (c.state === 'landed') return { status: 'done', word: 'On main' };
  if (v.run?.stopped) return { status: 'failed', word: 'Halted: the run was stopped' };
  switch (c.state) {
    case 'bounced': return { status: 'blocked', word: 'Sent back', waitingOn: 'its agent to fix what failed' };
    case 'with-lead': return { status: 'blocked', word: 'With its lead', waitingOn: `its lead${c.lead ? ` (${c.lead})` : ''} to combine it with newer code` };
    case 'replaying': return { status: 'working', word: 'Being redone on the newest code' };
    case 'queued': return { status: 'waiting', word: 'In line', waitingOn: 'its turn in the merge queue' };
    case 'testing': return { status: 'waiting', word: 'Being tested', waitingOn: 'the tests on the newest main' };
    case 'reviewing': return { status: 'waiting', word: 'Being reviewed', waitingOn: 'the reviewer' };
    case 'pushed':
      if (verdict === 'changes') return { status: 'working', word: 'Fixing review notes', waitingOn: 'its agent to fix the review notes' };
      if (verdict) return autoLand ? { status: 'waiting', word: 'Approved', waitingOn: 'the merge queue to pick it up' } : { status: 'needs', word: 'Ready to merge', waitingOn: 'ready for you to merge' };
      return { status: 'waiting', word: 'Waiting for review', waitingOn: 'a reviewer' };
    default:
      if (c.stackedOn) return { status: 'working', word: 'Working (stacked)', waitingOn: `the change it builds on (${String(c.stackedOn).split('--').pop()})` };
      return { status: 'working', word: 'Working' };
  }
}

/** The area a change works in: the longest known area path that holds most of its claimed (else changed) files. */
export function areaOf(c: Change, areas: string[]): string {
  const ps = (c.claims && c.claims.length ? c.claims : c.files || []).filter(Boolean);
  if (!ps.length) return '(no files named)';
  const known = [...areas].filter((a) => a && a !== '/').sort((a, b) => b.length - a.length);
  const pick = (p: string) => known.find((a) => p.startsWith(`${a}/`)) || (p.includes('/') ? p.split('/').slice(0, -1).join('/') : '/');
  const tally = new Map<string, number>();
  for (const p of ps) { const a = pick(p); tally.set(a, (tally.get(a) || 0) + 1); }
  return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}
/** Agents numbered 1..N per project as the work page does (work.js agentNums): a scripted agent keeps its number, a real
 *  one ("agent 981l0") gets the next free number by when its first change started. */
export function agentNumbers(changes: Change[]): Map<string, number> {
  const m = new Map<string, number>(), used = new Set<number>();
  const all = [...changes].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  for (const c of all) { const k = /^(?:scripted )?agent[- ](\d+)$/i.exec(c.agent || ''); if (k && c.agent && !m.has(c.agent)) { m.set(c.agent, +k[1]); used.add(+k[1]); } }
  let n = 1;
  for (const c of all) if (c.agent && !m.has(c.agent)) { while (used.has(n)) n++; m.set(c.agent, n); used.add(n); }
  return m;
}
const areaLabel = (a: string) => (a === '/' ? 'Top-level files' : a);
const firstLine = (s: string) => { const t = String(s || '').split('\n')[0].trim(); return t.length > 120 ? `${t.slice(0, 118)}…` : t; };
const shortId = (id: string) => String(id).split('--').pop() || id;

export function projectTree(info: Info, v: View): Tree {
  const T = new Tree();
  const now = Date.now();
  const root = T.add({ id: 'p', kind: 'project', label: info.name, status: 'done', counts: zero(), leaves: 0, usd: v.progress?.actualUsd ?? v.progress?.spentUsd ?? null,
    startedAt: null, endedAt: null, kids: 0, parent: null });
  // Requests, oldest first; a change belongs to its agent's request (same text) or to the newest request asked before it.
  const reqs = (info.requests && info.requests.length ? info.requests : info.lastRequest ? [info.lastRequest] : []).slice().sort((a, b) => a.at - b.at);
  const rid = (i: number) => `r${reqs[i].at}`;
  reqs.forEach((r, i) => T.add({ id: rid(i), kind: 'request', label: firstLine(r.text), sub: r.text.length > 120 ? r.text : undefined, status: 'done', counts: zero(), leaves: 0,
    usd: null, startedAt: r.at, endedAt: null, kids: 0, parent: root.id }));
  const agentReq = new Map((info.agents || []).map((a) => [a.id, a.request || '']));
  const reqOf = (c: Change) => {
    const t = agentReq.get(c.id);
    if (t) { const i = reqs.findIndex((r) => r.text.startsWith(t.slice(0, 200)) || t.startsWith(r.text.slice(0, 200))); if (i >= 0) return rid(i); }
    const at = c.createdAt || 0; let k = -1;
    reqs.forEach((r, i) => { if (r.at <= at + 1000) k = i; });
    if (k >= 0) return rid(k);
    if (!T.nodes.has('r-')) T.add({ id: 'r-', kind: 'request', label: 'Changes with no recorded request', status: 'done', counts: zero(), leaves: 0, usd: null, startedAt: null, endedAt: null, kids: 0, parent: root.id });
    return 'r-';
  };
  const areas = (v.areas || []).map((a) => a.path);
  const num = agentNumbers(v.changes || []);
  for (const c of v.changes || []) {
    const rq = reqOf(c), ar = areaOf(c, areas), aid = `${rq}/a:${ar}`;
    if (!T.nodes.has(aid)) T.add({ id: aid, kind: 'area', label: areaLabel(ar), status: 'done', counts: zero(), leaves: 0, usd: null, startedAt: null, endedAt: null, kids: 0, parent: rq });
    const s = changeStatus(c, v, info.autoLand !== false);
    const ev = c.events || [];
    const intentText = (c.intent || c.title || '').split('\n\nAsked:')[0];
    const who = c.agent ? `Agent ${num.get(c.agent)}` : 'An agent';
    T.add({ id: `c:${c.id}`, kind: 'intent', label: firstLine(c.title || c.intent || shortId(c.id)), sub: s.word, who,
      status: s.status, waitingOn: s.waitingOn, counts: zero(), leaves: 0, usd: null, startedAt: c.createdAt ?? ev[0]?.t ?? null,
      endedAt: c.landedAt ?? (s.status === 'done' ? ev[ev.length - 1]?.t ?? null : null), kids: 0, parent: aid,
      detail: { change: c.id, agent: c.agent ? who : null, intent: intentText.slice(0, 2000), word: s.word, claims: c.claims || [], files: c.files || [],
        stackedOn: c.stackedOn || null, review: c.review ? { verdict: c.review.verdict || null, notes: (c.review.notes || '').slice(0, 600) } : null,
        commits: [c.commit ? { sha: c.commit, what: 'its last commit on its own copy' } : null, c.landing?.mainCommit ? { sha: c.landing.mainCommit, what: 'on main' } : null].filter(Boolean),
        how: c.landing?.how || null, conflicts: c.landing?.conflicts || [],
        diff: (c.landing?.diff || []).slice(0, 20).map((d) => ({ path: d.path, lines: d.lines.slice(0, 120) })),
        steps: ev.slice(-8).map((e) => ({ t: e.t, what: e.what, detail: (e.detail || '').slice(0, 200) })), age: now - (c.createdAt || now) } });
  }
  // Requests with no changes yet: still being split (or nothing came of them).
  for (const r of reqs.map((_, i) => rid(i))) if (!(T.kids.get(r) || []).length) { const n = T.nodes.get(r)!; n.status = 'working'; n.waitingOn = 'the router agent to split it into tasks'; }
  T.roll(root.id);
  // One area under a request is no level at all: lift its intents up.
  for (const r of T.kids.get(root.id) || []) {
    const as = T.kids.get(r) || [];
    if (as.length === 1 && T.nodes.get(as[0])!.kind === 'area') { const kids = T.kids.get(as[0]) || []; for (const k of kids) T.nodes.get(k)!.parent = r; T.kids.set(r, kids); T.nodes.delete(as[0]); T.kids.delete(as[0]); T.nodes.get(r)!.kids = kids.length; }
  }
  buildWindow(T, v);
  return T;
}

// A build that settled, then had a change land hours later (real-course-builder: build 37:37, the 41st change 8 h on):
// the groups' time is the build's own (what the project page says), and the later changes are named apart (qb8, 2026-10-13).
function buildWindow(T: Tree, v: View) {
  const b = (v as any).build as { startedAt?: number | null; settledAt?: number | null } | undefined;
  if (!b?.settledAt) return;
  const end = b.settledAt + 1000;
  const leaves = (id: string): Node[] => (T.kids.get(id) || []).flatMap((k) => { const n = T.nodes.get(k)!; return n.kind === 'intent' ? [n] : leaves(k); });
  for (const n of T.nodes.values()) {
    if (n.kind === 'intent' || n.endedAt == null || n.endedAt <= end) continue;
    const ls = leaves(n.id), inside = ls.filter((x) => x.endedAt != null && x.endedAt <= end), after = ls.filter((x) => x.endedAt != null && x.endedAt > end);
    if (!inside.length || !after.length) continue;
    n.endedAt = Math.max(...inside.map((x) => x.endedAt!));
    if (n.kind === 'project' && b.startedAt) { n.startedAt = b.startedAt; n.endedAt = b.settledAt; }
    n.later = { n: after.length, at: Math.max(...after.map((x) => x.endedAt!)) };
  }
}

// ---------------------------------------------------------------- fleet runs ----
export type Rec = { file: string; status: string; reason?: string | null; model?: string | null; agent?: number | null; at?: number | null; ms?: number | null;
  usd?: number | null; comments?: number | null; landed_at?: number | null; commit_sha?: string | null };

export function recStatus(r: Rec, stopped: boolean): { status: Status; word: string; waitingOn?: string } {
  switch (r.status) {
    case 'landed': return { status: 'done', word: `${r.comments || 0} comment${r.comments === 1 ? '' : 's'} on main` };
    case 'skipped': return { status: 'done', word: 'Already documented' };
    case 'ready': return stopped ? { status: 'failed', word: "Halted before landing" } : { status: 'waiting', word: 'Ready to land', waitingOn: "its folder's next commit to main" };
    // Terminal: the fleet does not retry these. The reason stays in the file's detail, never on a folder's row.
    case 'rejected': return { status: 'failed', word: "Didn't land: the model's answer was not usable" };
    case 'verify_fail': return { status: 'failed', word: "Didn't land: the comments changed code" };
    case 'caught_early': return { status: 'failed', word: "Didn't land: caught by the code check" };
    case 'model_error': return { status: 'failed', word: "Didn't land: the model call failed" };
    case 'read_error': return { status: 'failed', word: "Didn't land: the file could not be read" };
    case 'cache_miss': return { status: 'failed', word: "Didn't land: no cached answer" };
    default: return stopped ? { status: 'failed', word: 'Halted' } : { status: 'working', word: r.status };
  }
}

/** The last record per file, from the fleet's /records NDJSON (only what the tree needs: comments text stays out). */
export function parseRecords(ndjson: string): Rec[] {
  const last = new Map<string, Rec>();
  for (const line of ndjson.split('\n')) {
    if (!line) continue;
    let r: any; try { r = JSON.parse(line); } catch { continue; }
    if (!r || typeof r.file !== 'string') continue;
    last.set(r.file, { file: r.file, status: r.status, reason: r.reason ?? null, model: r.model ?? null, agent: r.agent ?? null, at: r.at ?? null, ms: r.ms ?? null,
      usd: r.usd ?? null, comments: r.comments ?? null, landed_at: r.landed_at ?? null, commit_sha: r.commit_sha ?? null });
  }
  return [...last.values()];
}

/** Folders nested by path under the job; one-child folder chains collapse ("src/vs" not "src" > "vs"). Node ids are paths
 *  ('' = the job). `pending`: files the run has not started (no record yet), shown on the job. */
export function fleetTree(recs: Rec[], o: { label: string; stopped?: boolean; pending?: number; root?: string; intent?: string }): Tree {
  const T = new Tree();
  const job = T.add({ id: '', kind: 'job', label: o.label, status: 'done', counts: zero(), leaves: 0, usd: null, startedAt: null, endedAt: null, kids: 0, parent: null,
    detail: { intent: o.intent || 'Doc comments for the exported functions and classes in each file, with the code left unchanged' } });
  const folder = (p: string): string => {
    if (T.nodes.has(p)) return p;
    const up = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
    const parent = p === '' ? '' : folder(up);
    T.add({ id: p, kind: 'folder', label: p.slice(up ? up.length + 1 : 0), status: 'done', counts: zero(), leaves: 0, usd: null, startedAt: null, endedAt: null, kids: 0, parent });
    return p;
  };
  for (const r of recs) {
    const dir = r.file.includes('/') ? r.file.slice(0, r.file.lastIndexOf('/')) : '';
    const s = recStatus(r, !!o.stopped);
    T.add({ id: r.file, kind: 'file', label: r.file.slice(dir ? dir.length + 1 : 0), sub: s.word, status: s.status, waitingOn: s.waitingOn, counts: zero(), leaves: 0,
      usd: r.usd ?? null, startedAt: r.at ?? null, endedAt: r.landed_at ?? (s.status === 'done' || s.status === 'failed' ? (r.at || 0) + (r.ms || 0) || null : null), kids: 0, parent: folder(dir),
      detail: { file: r.file, model: r.model, agent: r.agent, reason: r.reason || null, raw: r.status, commit: r.commit_sha || null, comments: r.comments ?? null, ms: r.ms ?? null } });
  }
  // Collapse chains: a folder whose only child is a folder merges into it (the child keeps its id, so paths stay real).
  const collapse = (id: string) => {
    for (const k of [...(T.kids.get(id) || [])]) {
      let n = T.nodes.get(k)!;
      while (n.kind === 'folder') {
        const ks = T.kids.get(n.id) || [];
        if (ks.length !== 1 || T.nodes.get(ks[0])!.kind !== 'folder') break;
        const only = T.nodes.get(ks[0])!;
        only.label = `${n.label}/${only.label}`; only.parent = id;
        const list = T.kids.get(id)!; list[list.indexOf(n.id)] = only.id;
        T.nodes.delete(n.id); T.kids.delete(n.id); n = only;
      }
      if (n.kind === 'folder') collapse(n.id);
    }
  };
  collapse('');
  // The job's only child is the root folder (src/vs, packages): the job is that folder, one tap less.
  const top = T.kids.get('') || [];
  if (top.length === 1 && T.nodes.get(top[0])!.kind === 'folder') {
    const f = T.nodes.get(top[0])!, ks = T.kids.get(f.id) || [];
    for (const k of ks) T.nodes.get(k)!.parent = '';
    T.kids.set('', ks); T.kids.delete(f.id); T.nodes.delete(f.id); job.sub = f.label;
  }
  T.roll('');
  if (o.pending && o.pending > 0) { job.counts.waiting += o.pending; job.leaves += o.pending; job.pending = o.pending; job.endedAt = null; job.status = rollStatus(job.counts); if (!job.waitingOn) job.waitingOn = 'a free agent'; }
  return T;
}

/** One answer for both routes: a page of children, or the path for ?why=, or matches for ?find=. */
export function answer(T: Tree, q: URLSearchParams) {
  const why = q.get('why');
  if (why != null) { const p = T.path(why); return p.length ? { why, path: p } : { error: 'no such node' }; }
  const f = q.get('find');
  if (f) return { find: f, nodes: T.find(f.slice(0, 200)).map((n) => ({ ...n, path: T.path(n.id).map((x) => ({ id: x.id, label: x.label })) })) };
  const root = [...T.nodes.values()].find((n) => n.parent == null)!;
  const pg = T.page(q.get('node') ?? root.id, Number(q.get('offset')) || 0, Number(q.get('limit')) || 50);
  if (!pg) return { error: 'no such node' };
  // ?open=a,b: the other open nodes' first pages in the same answer (one refresh request, not one per open node).
  const open = (q.get('open') || '').split(',').filter((x) => x !== '').slice(0, 40);
  if (open.length) { const more: Record<string, Page | { error: string }> = {}; for (const id of open) more[id] = T.page(decodeURIComponent(id), 0, Number(q.get('limit')) || 50) || { error: 'no such node' }; return { ...pg, open: more }; }
  return pg;
}

/** Trees memoised per isolate: a finished fleet run's records never change (2-3 MB of NDJSON for 4k files, ~2 s to fetch),
 *  a live one is re-read after `ttl`. At most 24 trees kept. */
const memo = new Map<string, { at: number; ttl: number; p: Promise<Tree> }>();
export function memoTree(key: string, ttl: number, build: () => Promise<Tree>): Promise<Tree> {
  const m = memo.get(key);
  if (m && Date.now() - m.at < m.ttl) return m.p;
  const p = build().catch((e) => { memo.delete(key); throw e; });
  memo.set(key, { at: Date.now(), ttl, p });
  if (memo.size > 24) memo.delete(memo.keys().next().value!);
  return p;
}
