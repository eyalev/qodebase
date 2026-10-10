#!/usr/bin/env node
// E3 (b), docs/board/PLAN.md: a scripted decentralized backlog. N agents pick their own tasks
// from a shared backlog that has duplicates (the same work worded differently), dependencies
// (a task needs another to have landed) and hot shared files. Without a board an agent sees only
// the backlog and main; with a board it also sees what others announced (intent + files), as of
// `staleS` seconds ago, from the share of agents that actually post. Zero tokens: a seeded
// virtual-clock sim (same style as sim/real), no git, no models.
//
// What a board changes (each an assumption, stated where it is used):
//   pick:  skip a task someone is already on, or a duplicate of it (spotted with pSpotDup when
//          the other agent posted), and prefer tasks whose needs are landed or being worked on
//          by a poster (then stack on it instead of building on a main that lacks it);
//   land:  before landing, check who else is on my files; if a poster is mid-change on one,
//          land after it and replay (ordered), instead of colliding and redoing.
//
//   node sim/board/backlog.mjs [--agents 5,20,100] [--seeds 5]
import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => { if (x.startsWith('--')) a.push([x.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]); return a; }, []));

export const DEFAULTS = {
  tasksPerAgent: 6, // backlog size = N x 6
  pDup: 0.15, // share of backlog items that duplicate another item, worded differently
  pNeed: 0.3, // share of tasks that need another task to have landed first
  filesPerAgent: 8, hotFiles: 4, pHot: 0.35, // shared lists (routes, index, package.json...)
  touches: [1, 3], // files per task
  workMedS: 600, workSigma: 0.5, // ~10 min per task (Bun: ~18 min per commit; smaller tasks here)
  landS: 20, // pushing to the shared main
  pCleanHot: 0.2, pCleanCold: 0.5, // git merges a file both sides changed (sim/real: lists ~0.2)
  redoFactor: 0.4, // redoing on the new main
  replayFactor: 0.1, // ordered landing: replay my change on top of theirs (no surprise)
  waitPollS: 60, // a blocked agent checks again every minute
  pSpotDup: 0.8, // with a board: spotting that another posted intent is the same work
  maxOrderWaitS: 600, maxStackWaitS: 1200, // agents stop waiting (a chain of waits can circle otherwise)
  maxHours: 48,
};

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function run({ agents: N, board, postShare = 1, staleS = 0, seed = 1, ...over }) {
  const C = { ...DEFAULTS, ...over };
  const rnd = mulberry32(seed * 104729 + N);
  const normal = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const logn = (med, s) => med * Math.exp(s * normal());

  // ---- the backlog: work units, some listed twice (duplicates), some needing an earlier unit ----
  const nFiles = Math.max(C.hotFiles + 4, N * C.filesPerAgent);
  const nTasks = N * C.tasksPerAgent;
  const units = [];
  const nUnits = Math.round(nTasks / (1 + C.pDup));
  for (let u = 0; u < nUnits; u++) {
    const k = C.touches[0] + Math.floor(rnd() * (C.touches[1] - C.touches[0] + 1));
    const files = new Set();
    if (rnd() < C.pHot) files.add(Math.floor(rnd() * C.hotFiles));
    while (files.size < k) files.add(C.hotFiles + Math.floor(rnd() * (nFiles - C.hotFiles)));
    units.push({ id: u, files: [...files], need: u > 0 && rnd() < C.pNeed ? Math.floor(rnd() * u) : null, landed: false });
  }
  const items = units.map((u) => ({ unit: u.id }));
  while (items.length < nTasks) items.push({ unit: Math.floor(rnd() * nUnits), dup: true });
  for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
  items.forEach((it, i) => { it.id = i; it.state = 'open'; });

  // ---- agents, board ----
  const posts = Array.from({ length: N }, () => rnd() < postShare); // does this agent post?
  const ag = Array.from({ length: N }, (_, i) => ({ id: i, item: null, posts: posts[i] }));
  const log = []; // board events {t, agent, item, unit, files, kind:'start'|'end'}
  const visibleNow = (t) => { // who is on what, as the board shows it at t (posts up to t - staleS)
    const now = new Map();
    for (const e of log) { if (e.t > t - staleS) break; if (e.kind === 'start') now.set(e.agent, e); else now.delete(e.agent); }
    return [...now.values()];
  };
  const fileVersion = new Array(nFiles).fill(0);

  // ---- event loop ----
  const heap = []; let seq = 0, t = 0;
  const push = (dt, fn) => { heap.push({ t: t + dt, s: seq++, fn }); heap.sort((a, b) => a.t - b.t || a.s - b.s); };
  const m = { orderTimeouts: 0, givenBack: 0, landed: 0, dupImplemented: 0, dupAvoided: 0, conflicts: 0, redos: 0, ordered: 0, blockedS: 0, stacked: 0, workS: 0, wastedS: 0 };
  let doneAt = null;

  function pick(a) {
    const open = items.filter((it) => it.state === 'open' && !units[it.unit].landed && !(it.notBefore > t));
    if (!open.length) return null;
    // Every agent sees the backlog (with its dependencies) and main, so everyone prefers a task
    // whose need has landed; only a board adds "its need is being worked on by a poster" (stackable).
    if (!board) { const ready = open.filter((it) => { const n = units[it.unit].need; return n == null || units[n].landed; }); const from = ready.length ? ready : open; return from[Math.floor(rnd() * from.length)]; }
    const seen = visibleNow(t);
    const taken = new Set(seen.map((e) => e.item));
    const busyUnits = new Set(seen.map((e) => e.unit));
    let skippedDup = false;
    const cands = open.filter((it) => {
      if (taken.has(it.id)) return false;
      // Same work under another wording: spotted from the posted intent + files with pSpotDup.
      if (busyUnits.has(it.unit) && rnd() < C.pSpotDup) { skippedDup = true; return false; }
      return true;
    });
    if (skippedDup) m.dupAvoided++;
    if (!cands.length) return null;
    // Prefer a task whose need has landed, or is being worked on by someone who posted (stackable).
    const ready = cands.filter((it) => { const n = units[it.unit].need; return n == null || units[n].landed || busyUnits.has(n); });
    const from = ready.length ? ready : cands;
    return from[Math.floor(rnd() * from.length)];
  }
  function start(a) {
    if (doneAt != null) return;
    const it = pick(a);
    if (!it) { push(C.waitPollS, () => start(a)); return; }
    it.state = 'taken'; a.item = it; it.startedAt = t;
    const u = units[it.unit];
    const base = u.files.map((f) => fileVersion[f]);
    const needLandedAtStart = u.need == null || units[u.need].landed;
    const stackOn = board && !needLandedAtStart && visibleNow(t).some((e) => e.unit === u.need);
    if (stackOn) m.stacked++;
    if (a.posts) log.push({ t, agent: a.id, item: it.id, unit: it.unit, files: u.files, kind: 'start' });
    const d = logn(C.workMedS, C.workSigma);
    push(d, () => { m.workS += d; finish(a, it, base, stackOn, d); });
  }
  function finish(a, it, base, stacked, d) {
    const u = units[it.unit];
    if (u.landed) { // someone already landed the same work (a duplicate implemented twice)
      m.dupImplemented++; m.wastedS += d; return end(a, it, 'done');
    }
    // Its need must be on main to pass its own check. A change stacked on a need someone is working
    // on waits for it; otherwise the agent gives the task back (the check failed) and picks another.
    if (u.need != null && !units[u.need].landed) {
      const needInProgress = items.some((x) => x.unit === u.need && x.state === 'taken');
      if (stacked && needInProgress) {
        const since = t;
        const w = () => { if (units[u.need].landed || doneAt != null) land(a, it, base, d); else if (!items.some((x) => x.unit === u.need && x.state === 'taken') || t - since > C.maxStackWaitS) giveBack(a, it, d); else { m.blockedS += C.waitPollS; push(C.waitPollS, w); } };
        return push(C.waitPollS, w);
      }
      return giveBack(a, it, d);
    }
    land(a, it, base, d);
  }
  function giveBack(a, it, d) {
    m.givenBack++; m.wastedS += d;
    it.state = 'open'; it.notBefore = t + 2 * C.waitPollS; a.item = null;
    if (a.posts) log.push({ t, agent: a.id, item: it.id, unit: it.unit, files: units[it.unit].files, kind: 'end' });
    push(1, () => start(a));
  }
  function land(a, it, base, d) {
    const u = units[it.unit];
    if (u.landed) { m.dupImplemented++; m.wastedS += d; return end(a, it, 'done'); }
    // Check before landing (board): a poster mid-change on my files -> land after theirs and replay.
    if (board) {
      // Only wait for posters who started before me (no two agents wait for each other).
      const others = visibleNow(t).filter((e) => e.agent !== a.id && e.t < it.startedAt && e.files.some((f) => u.files.includes(f)));
      if (others.length && !it.waitedOnce) {
        it.waitedOnce = true; m.ordered++;
        const since = t;
        const w = () => { if (doneAt != null || !others.some((e) => ag[e.agent].item?.id === e.item)) { m.workS += d * C.replayFactor; land2(a, it, d, true); } else if (t - since > C.maxOrderWaitS) { m.orderTimeouts++; land2(a, it, d, false, base); } else { m.blockedS += C.waitPollS; push(C.waitPollS, w); } };
        return push(C.waitPollS, w);
      }
    }
    land2(a, it, d, false, base);
  }
  function land2(a, it, d, replayed, base) {
    const u = units[it.unit];
    if (u.landed) { m.dupImplemented++; m.wastedS += d; return end(a, it, 'done'); }
    if (!replayed && base) {
      const changed = u.files.filter((f, i) => fileVersion[f] > base[i]);
      const conflict = changed.some((f) => rnd() > (f < C.hotFiles ? C.pCleanHot : C.pCleanCold));
      if (conflict) { m.conflicts++; m.redos++; const rd = d * C.redoFactor; m.wastedS += rd; return push(rd, () => land2(a, it, d, true)); }
    }
    push(C.landS, () => {
      if (u.landed) { m.dupImplemented++; m.wastedS += d; return end(a, it, 'done'); }
      u.landed = true; m.landed++;
      for (const f of u.files) fileVersion[f]++;
      end(a, it, 'done');
      if (units.every((x) => x.landed)) doneAt = t;
    });
  }
  function end(a, it, how) {
    it.state = how; a.item = null;
    if (a.posts) log.push({ t, agent: a.id, item: it.id, unit: it.unit, files: units[it.unit].files, kind: 'end' });
    push(1, () => start(a));
  }

  ag.forEach((a) => push(rnd() * 30, () => start(a)));
  const end_ = C.maxHours * 3600;
  while (heap.length && doneAt == null && heap[0].t <= end_) { const e = heap.shift(); t = e.t; e.fn(); }
  const T = doneAt ?? t;
  return { agents: N, board, postShare, staleS, seed, units: nUnits, items: nTasks, finished: doneAt != null, hours: +(T / 3600).toFixed(2), landedPerHour: +(m.landed / (T / 3600)).toFixed(1), ...m, blockedH: +(m.blockedS / 3600).toFixed(1), wastedH: +(m.wastedS / 3600).toFixed(1), workH: +(m.workS / 3600).toFixed(1) };
}

// ---- CLI: with vs without a board; post share; staleness ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const AG = String(args.agents || '5,20,100').split(',').map(Number);
  const SEEDS = Number(args.seeds || 5);
  const avg = (rs, k) => +(rs.reduce((s, r) => s + r[k], 0) / rs.length).toFixed(1);
  const cell = (cfg) => { const rs = []; for (let s = 1; s <= SEEDS; s++) rs.push(run({ ...cfg, seed: s })); return Object.fromEntries(['hours', 'landedPerHour', 'dupImplemented', 'dupAvoided', 'conflicts', 'redos', 'givenBack', 'ordered', 'stacked', 'blockedH', 'wastedH', 'workH'].map((k) => [k, avg(rs, k)]).concat([['finished', rs.every((r) => r.finished)], ['units', rs[0].units], ['items', rs[0].items]])); };
  const out = { generated: new Date().toISOString(), seeds: SEEDS, defaults: DEFAULTS, rows: [] };
  for (const N of AG) {
    const conds = [['no board', { board: false }], ['board, all post, live', { board: true }], ['board, 70% post', { board: true, postShare: 0.7 }], ['board, 40% post', { board: true, postShare: 0.4 }], ['board, 30 s stale', { board: true, staleS: 30 }], ['board, 60 s stale', { board: true, staleS: 60 }]];
    for (const [label, cfg] of conds) {
      const c = cell({ agents: N, ...cfg });
      out.rows.push({ agents: N, label, ...c });
      console.log(`${String(N).padStart(3)} agents | ${label.padEnd(24)} | ${c.hours} h, ${c.landedPerHour}/h | dup built twice ${c.dupImplemented} (avoided ${c.dupAvoided}) | conflicts ${c.conflicts}, redos ${c.redos}, given back ${c.givenBack}, ordered ${c.ordered}, stacked ${c.stacked} | blocked ${c.blockedH} h, wasted ${c.wastedH} h of ${c.workH} h work${c.finished ? '' : ' | NOT FINISHED'}`);
    }
  }
  mkdirSync(join(HERE, 'out'), { recursive: true });
  writeFileSync(join(HERE, 'out', 'backlog.json'), JSON.stringify(out, null, 1));
  appendFileSync(join(homedir(), '.local/share/qbsim-bench/board.jsonl'), JSON.stringify({ ts: out.generated, event: 'backlog_sim', seeds: SEEDS, rows: out.rows }) + '\n');
}
