#!/usr/bin/env node
// E3 follow-up (docs/board/sim.md): the backlog sim at the grain of E4 (sim/board-ab), calibrated on
// E4's 20 real runs, then used to predict qb9's scale test before it runs. Zero tokens.
//
// One agent = a loop of calls (like `claude -p` per task pick). A call: pull, read BACKLOG + main
// (+ the board), pick one task, build it, commit, push; a rejected push means pull --rebase, fix,
// test, push again. What E4 showed that backlog.mjs got wrong: WITHOUT a board an agent cannot see
// who is on what, so two agents often build the SAME task (wasted work 7 calls a run in A);
// backlog.mjs let no-board agents see each other's claims for free.
//
// Conditions: A no board; B hooks only (files visible, not intents); C board `who` + stated intent;
// D C + `who --recent` (finished intents) + "same meaning -> alias or pick another".
//
//   node sim/board/calls.mjs calibrate [--seeds 400]   E4 (5 agents, 16 tasks) sim vs real
//   node sim/board/calls.mjs scale [--seeds 400]       qb9's scale test (10 agents, ~30 tasks x4)
import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// Calibrated on E4 (5 Haiku 5.5 agents, 16 tasks, 4 dup pairs; sim/board-ab/runs.jsonl + calls.jsonl).
export const E4 = {
  agents: 5, tasks: 16, dupPairs: 4, needs: 4, // T4<-T2, T10<-T2+T7, T8<-T1, T12<-T5 (as single needs)
  workMedS: 26, workSigma: 0.6, // build + test in one call (pushed calls: median 35-44 s incl. rebases)
  pickS: 4, // pull + read before the pick is made (posts appear after this)
  rebaseMedS: 3, rebaseSigma: 0.5, // pull --rebase, fix the hot-file conflict, npm test, push again
  pushS: 2,
  boardS: { B: 3, C: 6, D: 7 }, // the board's own time per call (E4 pushed-call medians: A 35, B 40, C 42, D 44 s)
  deferS: 9, // a call that saw the task taken and skipped it (E4: 7-11 s)
  allDoneS: 14, // the last call: "everything is on main"
  attractSigma: 0.5, // tasks are not picked uniformly: a shared taste (E4 A first picks: T6 6/25, T16 5/25)
  agentNoise: 1.5, // each agent's own taste on top
  pImplicitAvoid: 0.65,
  pHeedBoard: 0.92, // C/D: reads `who` first and picks an unclaimed task; otherwise picks, then sees the claim and skips (a deferral call)
  pReadyPref: 0.9, // prefer a task whose needs are on main
  pSpotMainDup: 0.9, // reading main, notices that a differently named twin already landed (A: 4 of 20 pairs built twice)
  pSpotNowDup: 0.5, // C/D: notices a twin in someone's posted intent (now)
  pSpotRecentDup: 0.95, // D: twin among recently finished intents + the same-meaning rule (D: 0 of 20)
  pSpotFiles: 0.95, // B: the hooks show only files: spots that the same task is taken from them
  collisionRetries: 0.7, // mean extra rejected pushes an agent fights through before dropping a task someone else landed
  pDropDupAtRebase: 0.5, // a twin landed while I built mine: dropped at rebase instead of landing both
};

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function run(cond, seed = 1, over = {}) {
  const C = { ...E4, ...over };
  const rnd = mulberry32(seed * 7919 + C.agents * 31 + cond.charCodeAt(0));
  const normal = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const logn = (med, s) => med * Math.exp(s * normal());
  const board = cond !== 'A';

  // ---- backlog: units of work, dupPairs of them listed twice under another name ----
  const nUnits = C.tasks - C.dupPairs;
  const units = Array.from({ length: nUnits }, (_, u) => ({ id: u, landed: false, landedBy: [] }));
  // needs: C.needs units (not the first ones) need one earlier unit
  const needy = new Set(); while (needy.size < Math.min(C.needs, nUnits - 1)) needy.add(1 + Math.floor(rnd() * (nUnits - 1)));
  for (const u of needy) units[u].need = Math.floor(rnd() * u);
  const items = units.map((u) => ({ unit: u.id }));
  const twins = new Set(); while (twins.size < C.dupPairs) twins.add(Math.floor(rnd() * nUnits));
  for (const u of twins) items.push({ unit: u });
  items.forEach((it, i) => { it.id = i; it.attract = Math.exp(C.attractSigma * normal()); it.landed = false; });
  const isTwin = (it) => twins.has(it.unit);

  // ---- state ----
  let head = 0; // main's commit count
  const posts = []; // {agent, item, t, end?}
  const wastedStarts = [];
  const building = new Map(); // agent -> item id (truth, board or not)
  const m = { aliases: 0, wastedSame: 0, wastedS: 0, calls: 0, landed: 0, wasted: 0, deferrals: 0, rejected: 0, dupBuiltTwice: 0, sameTaskTwice: 0, allDone: 0, agentS: 0 };
  const agents = Array.from({ length: C.agents }, (_, i) => ({ id: i, done: false, endT: 0 }));
  const heap = []; let seq = 0, t = 0;
  const at = (dt, fn) => { heap.push({ t: t + dt, s: seq++, fn }); heap.sort((a, b) => a.t - b.t || a.s - b.s); };

  const onMain = (it) => it.landed; // the task id is in a landed commit message
  const twinOf = (it) => items.find((x) => x !== it && x.unit === it.unit);
  const nowPosts = (a) => posts.filter((p) => p.agent !== a.id && p.end == null && p.t <= t);
  const recentPosts = (a) => posts.filter((p) => p.agent !== a.id && p.end != null);

  function call(a) {
    if (a.done) return;
    m.calls++; const t0 = t;
    const spend = (dt, fn) => at(dt, () => { m.agentS += t - t0; fn(); });
    // What this agent believes is done: tasks on main, and twins it notices on main.
    const known = (it) => onMain(it) || (isTwin(it) && onMain(twinOf(it)) && it.spotMain) || spotMainD(it);
    for (const it of items) if (it.spotMain == null && isTwin(it) && onMain(twinOf(it))) it.spotMain = rnd() < C.pSpotMainDup;
    // D: finished intents are on the board and the same-meaning rule applies to them
    const spotMainD = (it) => cond === 'D' && isTwin(it) && onMain(twinOf(it)) && (it.spotD ??= rnd() < C.pSpotRecentDup);
    const open = items.filter((it) => !known(it));
    if (!open.length) { m.allDone++; return spend(C.allDoneS, () => { a.done = true; a.endT = t; }); }
    const ready = open.filter((it) => { const n = units[it.unit].need; return n == null || units[n].landed; });
    let pool = ready.length && rnd() < C.pReadyPref ? ready : open;
    const now = board ? nowPosts(a) : [];
    const recent = cond === 'D' ? recentPosts(a) : [];
    const avoid = (keep) => { const f = pool.filter(keep); if (f.length) pool = f; };
    // Without a board agents still spread out somewhat (they read main and the backlog at different
    // moments): with pImplicitAvoid a pick avoids a task someone is building, as if it could see it
    // (backlog.mjs assumed 1.0 here; E4 A says much less). Fitted.
    if (rnd() < C.pImplicitAvoid) { const busy = new Set([...building].filter(([k]) => k !== a.id).map(([, v]) => v)); avoid((x) => !busy.has(x.id)); }
    // B: the hooks feed the now-view (files only) into every prompt; C/D run `who` before choosing.
    if (cond === 'B' && rnd() < C.pSpotFiles) { const claimed = new Set(now.map((p) => p.item)); avoid((x) => !claimed.has(x.id)); }
    if ((cond === 'C' || cond === 'D') && rnd() < C.pHeedBoard) {
      const claimed = new Set(now.map((p) => p.item));
      avoid((x) => !claimed.has(x.id));
      // twins: C sees claims only; D also sees finished intents and has the same-meaning rule
      const pTw = cond === 'D' ? C.pSpotRecentDup : C.pSpotNowDup;
      const shown = new Set([...now, ...recent].map((p) => p.item));
      avoid((x) => !(isTwin(x) && shown.has(twinOf(x).id) && rnd() < pTw));
    }
    // At the end everything left is claimed on the board: C/D skip once (a deferral) and stop; B's
    // prompt shows the same now-view, so it stops (as "all done") when it notices the files are taken.
    if (board && open.every((x) => now.some((p) => p.item === x.id))) {
      if (cond !== 'B') { m.deferrals++; return spend(C.deferS, () => { a.done = true; a.endT = t; }); }
      if (rnd() < C.pSpotFiles) { m.allDone++; return spend(C.allDoneS, () => { a.done = true; a.endT = t; }); }
    }
    // the agent's pick: shared taste, its own noise
    const w = pool.map((it) => it.attract * Math.exp(C.agentNoise * normal()));
    const it = pool[w.indexOf(Math.max(...w))];
    // ---- C/D: the check after choosing (posting shows the claim): skip = a deferral call ----
    if (cond === 'C' || cond === 'D') {
      const sameTask = now.some((p) => p.item === it.id);
      const twinShown = isTwin(it) && [...now, ...recent].some((p) => p.item === twinOf(it).id);
      let defer = sameTask;
      if (!defer && twinShown) defer = rnd() < (cond === 'D' ? C.pSpotRecentDup : C.pSpotNowDup);
      if (defer) { m.deferrals++; return spend(C.deferS, () => call(a)); }
    }
    // ---- build ----
    building.set(a.id, it.id);
    const post = board ? { agent: a.id, item: it.id, t: t + C.pickS } : null;
    if (post) posts.push(post);
    const base = head;
    const work = C.pickS + (C.boardS[cond] || 0) + logn(C.workMedS, C.workSigma);
    const finishPost = () => { building.delete(a.id); if (post) post.end = t; };
    const tryPush = (myBase) => {
      if (onMain(it)) { // the same task landed while I built: push rejected, the rebase conflicts on my own
        // function, the agent fights it (abort, reset, retry: E4 A had ~3 aborts/resets per dropped task), then drops it
        const fights = 1 + Math.floor(rnd() * 2 * C.collisionRetries);
        m.rejected += fights; m.wasted++; m.wastedSame++; m.wastedS += t - t0; wastedStarts.push(t0); finishPost();
        return spend(fights * logn(C.rebaseMedS, C.rebaseSigma), () => call(a));
      }
      if (isTwin(it) && onMain(twinOf(it)) && it.dropChecked == null) {
        it.dropChecked = true;
        // D's rule: "make yours a one-line alias of theirs once theirs is on main" (lands as an alias, not a second copy)
        if (cond === 'D' && rnd() < C.pSpotRecentDup) it.alias = true;
        else
        if (rnd() < C.pDropDupAtRebase) { m.wasted++; m.wastedS += t - t0; wastedStarts.push(t0); finishPost(); return spend(1, () => call(a)); }
      }
      if (head !== myBase) { m.rejected++; const rb = logn(C.rebaseMedS, C.rebaseSigma); const nb = head; return at(rb, () => tryPush(nb)); }
      at(C.pushS, () => {
        if (head !== myBase) return tryPush(myBase); // someone pushed first
        head++; it.landed = true; m.landed++;
        const u = units[it.unit];
        if (u.landed && !it.alias) m.dupBuiltTwice++;
        if (it.alias) m.aliases++;
        u.landed = true; finishPost();
        m.agentS += t - t0; at(0.5, () => call(a));
      });
    };
    at(work, () => tryPush(base));
  }
  agents.forEach((a) => at(rnd() * 3, () => call(a)));
  while (heap.length && heap[0].t < 4 * 3600) { const e = heap.shift(); t = e.t; e.fn(); }
  const wall = Math.max(...agents.map((a) => a.endT || t));
  return { cond, seed, wallS: Math.round(wall), ...m, wastedEarly: wastedStarts.filter((x) => x < wall / 2).length, agentS: Math.round(m.agentS), wastedS: Math.round(m.wastedS), unitsLeft: units.filter((u) => !u.landed).length };
}

// ---- E4 real numbers (medians, sim/board-ab summary + calls.jsonl) ----
export const E4_REAL = {
  A: { wallS: 227, wasted: 7, wastedEarly: 4, deferrals: 0, dupBuiltTwice: 1, rejected: 34, calls: 28, agentS: 1090 },
  B: { wallS: 219, wasted: 3, wastedEarly: 2, deferrals: 0, dupBuiltTwice: 1, rejected: 24, calls: 26, agentS: 1070 },
  C: { wallS: 202, wasted: 2, wastedEarly: null, deferrals: 6, dupBuiltTwice: 1, rejected: 16, calls: 29, agentS: 960 },
  D: { wallS: 200, wasted: 1, wastedEarly: null, deferrals: 7, dupBuiltTwice: 0, rejected: 17, calls: 29, agentS: 973 },
};
const KEYS = ['wallS', 'wasted', 'wastedSame', 'wastedS', 'wastedEarly', 'deferrals', 'dupBuiltTwice', 'rejected', 'calls', 'agentS'];
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
export function cell(cond, seeds, over) {
  const rs = []; for (let s = 1; s <= seeds; s++) rs.push(run(cond, s, over));
  const out = { unfinished: rs.filter((r) => r.unitsLeft).length };
  for (const k of KEYS) out[k] = { med: q(rs.map((r) => r[k]), 0.5), lo: q(rs.map((r) => r[k]), 0.1), hi: q(rs.map((r) => r[k]), 0.9), mean: +(rs.reduce((a, r) => a + r[k], 0) / rs.length).toFixed(2) };
  out.pDupAny = +(rs.filter((r) => r.dupBuiltTwice > 0).length / rs.length).toFixed(2);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2] || 'calibrate';
  const i = process.argv.indexOf('--seeds'); const SEEDS = i > 0 ? +process.argv[i + 1] : 400;
  const fmt = (c) => `${c.med} [${c.lo}-${c.hi}]`;
  const res = { generated: new Date().toISOString(), mode, seeds: SEEDS, params: E4, rows: [] };
  if (mode === 'calibrate') {
    for (const cond of 'ABCD') {
      const c = cell(cond, SEEDS); res.rows.push({ cond, sim: c, real: E4_REAL[cond] });
      console.log(`${cond} ` + KEYS.map((k) => `${k} ${fmt(c[k])} (real ${E4_REAL[cond][k]})`).join(' | ') + ` | P(any dup built twice) ${c.pDupAny}${c.unfinished ? ` | unfinished ${c.unfinished}` : ''}`);
    }
  } else {
    // qb9's scale test (manager, 2026-10-10; sim/board-ab/starter2): 10 agents, 30 tasks 3-5x bigger, 5 twin pairs (T19~T2, T20~T4, T21~T3, T22~T6, T23~T1), ~11 commands that need a helper task.
    const variants = [
      ['10 agents, 30 tasks, 4 pairs, x4 work', { agents: 10, tasks: 30, dupPairs: 4, needs: 11, workMedS: 26 * 4 }],
      ['10 agents, 30 tasks, 5 pairs, x4 work', { agents: 10, tasks: 30, dupPairs: 5, needs: 11, workMedS: 26 * 4 }],
      ['10 agents, 30 tasks, 5 pairs, x3 work', { agents: 10, tasks: 30, dupPairs: 5, needs: 11, workMedS: 26 * 3 }],
      ['10 agents, 30 tasks, 5 pairs, x5 work', { agents: 10, tasks: 30, dupPairs: 5, needs: 11, workMedS: 26 * 5 }],
    ];
    for (const [label, over] of variants) for (const cond of 'AD') {
      const c = cell(cond, SEEDS, over); res.rows.push({ label, cond, over, sim: c });
      console.log(`${label} | ${cond} ` + KEYS.map((k) => `${k} ${fmt(c[k])}`).join(' | ') + ` | P(dup twice) ${c.pDupAny}${c.unfinished ? ` | unfinished ${c.unfinished}` : ''}`);
    }
  }
  mkdirSync(join(HERE, 'out'), { recursive: true });
  writeFileSync(join(HERE, 'out', `calls-${mode}.json`), JSON.stringify(res, null, 1));
  appendFileSync(join(homedir(), '.local/share/qbsim-bench/board.jsonl'), JSON.stringify({ ts: res.generated, event: `calls_${mode}`, seeds: SEEDS, rows: res.rows }) + '\n');
}
