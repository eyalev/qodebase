// Variants lab, stage 0: predict how a variant (planner, coders, reviewers, landing policy...)
// does on a scenario, in milliseconds, with no model calls. Same file in the browser
// (qodebase.app/lab, instant prediction) and in node (the runner records the prediction
// before every real run; sim/lab/sweep.mjs ranks every combo; sim/lab/calibrate.mjs fits it).
//
// A finite goal: a planner turns a one-line prompt into a task graph (and can miss
// requirements, duplicate intents, or miss a dependency); coders work the graph; reviewers
// catch defects; a landing policy gets changes onto main. Policy behaviour is what the
// migration swarm measured on real code (sim/swarm): free-for-all gives back tasks whose
// prerequisites have not landed, phases wait at gates with main red inside a phase, stacking
// redoes on conflicts, land by intent replays them, leads queue.
//
// Every number below is in CAL and says where it comes from: "measured" (MEASUREMENTS.md,
// sim/swarm, sim/bun/calibration.json) or "assumed" (to be replaced by sim/lab/calibrate.mjs
// from public/lab/runs.jsonl). The output is an estimate, not a measurement.

import { qualityScore } from './score.js';
export { qualityScore }; // qb5's one quality formula (public/lab/score.js)

export const SIM_VERSION = 'lab-0.11';

// Knob names and values = the Landing flags and runs.jsonl `variant` (docs/lab/runs-schema.md).
export const KNOBS = {
  planner: { label: 'Planner model', values: ['haiku', 'sonnet', 'opus'], default: 'sonnet' },
  coders: { label: 'Coding agents', values: [1, 3, 6, 12, 24], default: 6 },
  coderModel: { label: 'Coding model', values: ['haiku', 'sonnet', 'opus'], default: 'sonnet' },
  reviewers: { label: 'Reviewers', values: [0, 1, 3, 6], default: 1 },
  reviewerModel: { label: 'Reviewer model', values: ['haiku', 'sonnet', 'opus'], default: 'sonnet' },
  reviewStyle: { label: 'Review style', values: ['read', 'adversarial'], default: 'read' },
  policy: { label: 'Landing policy', values: ['intent', 'ffa', 'phases', 'stacking', 'leads', 'github'], default: 'intent' },
  claims: { label: 'Claim files before working', values: [false, true], default: false },
  dedupe: { label: 'Check for duplicate tasks', values: [false, true], default: true },
  trainMax: { label: 'Changes landed together (train)', values: [1, 4, 8], default: 8 },
};
export const DEFAULT_VARIANT = Object.fromEntries(Object.entries(KNOBS).map(([k, x]) => [k, x.default]));
// Baselines run with every stage: one Opus agent alone (no split, no reviewer), and GitHub-style
// (one PR per agent, any conflict bounces back to the agent, no handlers, no replay).
export const BASELINES = {
  'opus-alone': { planner: 'none', coders: 1, coderModel: 'opus', reviewers: 0, reviewerModel: 'opus', reviewStyle: 'read', policy: 'ffa', claims: false, dedupe: false, trainMax: 1 },
  github: { planner: 'sonnet', coders: 6, coderModel: 'sonnet', reviewers: 1, reviewerModel: 'sonnet', reviewStyle: 'read', policy: 'github', claims: false, dedupe: false, trainMax: 1 },
};
// One canonical string per variant: groups repetitions and matches sim to real runs.
export function variantKey(variant, baseline = variant?.baseline ?? null) {
  if (baseline) return baseline;
  const v = { ...DEFAULT_VARIANT, ...variant };
  // board (round 2, W4) is not a KNOB so that every earlier run keeps its key: it appears only when on.
  return Object.keys(KNOBS).map((k) => `${k}=${typeof v[k] === 'boolean' ? (v[k] ? 1 : 0) : v[k]}`).join(';') + (v.board ? ';board=1' : '') + (v.claimNext ? ';claimNext=1' : '');
}

// Scenario profiles: qb5's scripts/lab/scenarios/<id>/scenario.json "profile" (2868ad1, first
// guesses by qb5, to be measured in stage 1), mapped to the sim's fields: tasks = middle of
// expectedTasks (geometric for a wide range), depth = dependencyDepth, pShared = sharedFileShare,
// sharedFiles = how many, vague = vagueness (high 0.8 / medium 0.5 / low 0.2), dupRisk = duplicateIntentRisk
// (for a Sonnet planner; other planners scale by CAL.pDup), hidden = hiddenTotal
// (public/lab/scenarios.json). difficulty is qb4's guess (defects and work time multiplier).
// aloneS: the job's size, measured as the seconds ONE Opus agent took to do all of it (stage 1:
// runs 3, 13, 15). Every work time is derived from it (CAL.taskFixedS, CAL.workRatio).
export const SCENARIOS = {
  'cafe-family': { label: 'Make the cafe family-friendly', tasks: 7, depth: 2, pShared: 0.6, sharedFiles: 4, vague: 0.8, dupRisk: 0.05, difficulty: 1, hidden: 7, aloneS: 50 }, // dupRisk 0.3 -> 0.05: 0 duplicates in 11 tasks (stage 1, qb5)
  'port-ts': { label: 'Port a library to TypeScript', tasks: 21, depth: 3, pShared: 0.1, sharedFiles: 3, vague: 0.2, dupRisk: 0.05, difficulty: 1, hidden: 158, aloneS: 223 }, // aloneS: stage-1 run 13 (one Opus agent, 81 files); difficulty 1.3 -> 1: it passed 158/158
  bakery: { label: 'Build a small bakery website with online orders', tasks: 25, depth: 3, pShared: 0.5, sharedFiles: 5, vague: 0.5, dupRisk: 0.15, difficulty: 1.2, hidden: 26, aloneS: 530 }, // aloneS: one Opus agent took 806 / 465 / 509 s (stage-1 run 15, stage-2 r2, r3): median 509 / 0.96 coverage
  club: { label: 'Build a booking app for a padel club', tasks: 47, depth: 2, pShared: 0.2, sharedFiles: 4, vague: 0.5, dupRisk: 0.15, difficulty: 1.2, hidden: 42, aloneS: 740 }, // qb5 7828aef: wide, shallow; one Opus agent on a box took 850 / 606 s (stage-2 club r1, r2): median 728 / ~0.98 coverage. (qb5's subagent reference: 881 s; bakery's box/subagent ratio 0.64 did NOT carry over)
  // Board round 2, W4 (qb5 682e05f): coders self-pick from one shared list (the router never splits or dedupes);
  // 30 tasks = 25 units + 5 far-worded twin pairs; qb9's todokit (s2), whose tasks took ~45 Haiku-s each
  // (aloneS from 25 + 1.4 x aloneS / 30 = 45). Clear spec: 30/30 hidden in every local run (difficulty low).
  // two-teams: two routers, the 5 pairs cross the teams.
  backlog: { label: 'Self-picked backlog', tasks: 30, depth: 2, pShared: 0.9, sharedFiles: 4, vague: 0.1, dupRisk: 0, difficulty: 0.1, hidden: 30, aloneS: 430, selfPick: true, dupPairs: 5, farPairs: 5 },
  'two-teams': { label: 'Two teams, one repo', tasks: 30, depth: 2, pShared: 0.9, sharedFiles: 4, vague: 0.1, dupRisk: 0, difficulty: 0.1, hidden: 30, aloneS: 430, selfPick: true, dupPairs: 5, farPairs: 5, teams: 2 },
  rename: { label: 'Rename X across the codebase + a dependent change', tasks: 20, depth: 3, pShared: 0.4, sharedFiles: 2, vague: 0.1, difficulty: 0.7, hidden: 10, aloneS: 300 }, // qb4 guess (backup scenario)
};

export const CAL = {
  // Agent work per task (Sonnet): agents push in 1.5-4 min (measured, MEASUREMENTS.md run 1).
  // Calibrated 2026-10-08 on stage-1 runs 1-3 (cafe-family; sim/lab/calibrate.mjs, public/lab/calibration.json):
  // Haiku coders took a median 29 s per task (11 tasks). Sonnet/Opus coders not measured yet: same speed ratios.
  // Work model (lab-0.8, stage-1 runs 1-16): a task takes taskFixedS + workRatio[model] x its
  // share of the job x aloneS. Fitted: haiku coders summed 284 s for cafe's 8 tasks (8 x 25 +
  // 1.7 x 50) and 1159 s for bakery's 7 (7 x 25 + 1.24 x 796); opus = 1 by definition.
  taskFixedS: 25, workSigma: 0.5,
  aloneSigma: 0.2, // one agent doing a whole job varies less than a single task: runs 3, 13, 15 were -8%, +3%, +8% off lab-0.8's median
  workRatio: { haiku: 1.4, sonnet: 1.15, opus: 1 }, // sonnet assumed between
  workMedS: 48, // only for fix/redo shares below (a cafe-size task)
  speed: { haiku: 0.6, sonnet: 1, opus: 1.4 }, // reviewer time ratios (assumed)
  // Planners split a job into fewer, bigger tasks than a fine split: grain = planned / fine.
  // Opus planner: cafe 5 of ~7, bakery 7 of ~25, port-ts 5 of ~21 (run 14) -> ~0.37; haiku ~0.8.
  grain: { haiku: 0.8, sonnet: 0.55, opus: 0.37 }, // sonnet assumed between
  // API $ per second of an agent working: $1.42 per reviewed change at Sonnet rates (measured).
  usdPerS: { haiku: 0.00059, sonnet: 0.0043, opus: 0.0085 }, // opus: median of the 5 opus-alone runs ($/s 0.005-0.009) // API $ per agent-second: haiku measured (runs 1-2, incl. planner/router), sonnet measured (MEASUREMENTS run 1), opus measured (run 3, one run)
  // A clear plan makes fewer wrong tasks: run 11 (opus planner, haiku coders, 3 haiku reviewers)
  // passed 6/7 like opus-alone, where haiku planner + haiku coders passed 1/7 and 3/7.
  plannerClarity: { haiku: 1, sonnet: 0.6, opus: 0.35, none: 1 }, // haiku/opus fitted on runs 1, 2, 11; sonnet assumed
  pDefect: { haiku: 0.55, sonnet: 0.3, opus: 0.14 }, // per task, times difficulty: haiku fitted on runs 1-2 (hidden 1/7, 3/7 with 3 and 8 tasks), opus on run 3 (6/7); sonnet assumed between. Was 0.25/0.15/0.08
  pVisible: 0.1, // share of defects the build/type check/own tests see: runs 1-3 had every floor green while 1-6 of 7 hidden tests failed. Was 0.5
  // Planner (one call): time, missed requirements, duplicate intents, missed dependency edges (x vague).
  planS: { haiku: 47, sonnet: 60, opus: 60 }, // ask to first task: haiku runs 1-2, opus run 16 (60 s); sonnet assumed
  routerUsdPerTask: { haiku: 0.005, sonnet: 0.008, opus: 0.01 }, // the planner keeps coordinating: bakery swarm planner $0.41-0.78 in total over 3 runs (plan included); was 0.11
  pMiss: { haiku: 0.37, sonnet: 0.2, opus: 0.08 }, // x vague: haiku fitted on runs 1-2 (3 and 8 tasks for a ~7-task prompt); sonnet/opus assumed. Was 0.15/0.08/0.04
  pDup: { haiku: 0.25, sonnet: 0.12, opus: 0.06 }, // assumed
  pEdgeMiss: { haiku: 0.3, sonnet: 0.15, opus: 0.08 }, // assumed (not scaled by vague)
  dedupeCatch: 0.85, dedupeS: 20, // assumed
  // Review: ~3 min per review (measured: reviewer agent ~3 min); catch rates assumed.
  reviewMedS: 75, reviewSigma: 0.4, // bakery swarm: reviewers $0.29-0.46 for 7-11 reviews = ~$0.045 each = ~75 Haiku-seconds (cost-fitted; review time itself not measured)
  pCatch: { haiku: 0.4, sonnet: 0.6, opus: 0.75 }, adversarialCatch: 1.35, adversarialTime: 1.8, pFalseAlarm: 0.05,
  fixFactor: 0.35, // fixing what review asked, share of the task's work (fast sim DEFAULTS)
  // Landing: per train 30 s + 5 s per extra change (sim/swarm); conflicts on shared files.
  landS: 60, landPerChangeS: 10, // run 16: landings 70-100 s apart (the project's own tests run with each); was 30/5
  pCleanShared: 0.5, // between Hono's list files 0.2 (sim/real) and Bun's 0.84 (sim/bun): assumed
  pCleanDup: 0.1, // a duplicate intent edits the same lines
  redoFactor: 0.5, // redo on the new main, share of the work (swarm: 0.3 for codemods)
  pReplay: 0.9, // land by intent: replay succeeds (real-code run 972/976; lower for model-written code: assumed)
  leadSpan: 10, leadS: 90, pLead: 0.85, // swarm/fast sim: a lead serves ~10 agents
  gateS: 120, // phases: full check between phases (assumed)
  backoffS: 120, // a task given back is retried after 2 min
  // One agent alone does the whole job in one pass and one commit (run 3: Opus, 8 files, ~50 s).
  aloneSelfCatch: 0.3, // assumed
  maxTries: 8, // redos (conflict, failed check) before a task is dropped
  maxGiveBacks: 40, // given back because a prerequisite had not landed (sim/swarm)
  // Board (round 2; docs/board/sim.md, sim/board/calls.mjs calibrated on E4 + the 10-agent scale test):
  // self-picking coders without a board build the same task twice (s2 A: 11 wasted of 54 calls), with it
  // far less (D 5, E 6 of ~52, those incl. twin drops). The board costs ~7 s a call (E4 pushed calls D vs A).
  pSamePick: { off: 0.2, on: 0.06 }, boardS: 7,
  // Twins: the dedupe pass over a list catches a pair 0.97 (E4 E: 15/15), a far-worded pair seen only on
  // the board ~0.1 (s2: D built 4/5 twice). An alias is a thin call.
  pDedupeList: 0.97, pBoardFar: 0.1, aliasWork: 0.3, dedupeListS: 5,
  pChanceAlias: 0.2, // no dedupe: an agent finds its twin already on main and reuses it (qb5's scorer on s2: A built 4, 4, 3 of 5 twice, D 4)
};

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function scenarioProfile(s) {
  if (typeof s === 'string') { if (!SCENARIOS[s]) throw new Error(`unknown scenario ${s}`); return { id: s, ...SCENARIOS[s] }; }
  return { id: s.id || 'custom', ...(SCENARIOS[s.id] || SCENARIOS['cafe-family']), ...s };
}
export function variantOf(v = {}, baseline = v.baseline ?? null) {
  if (baseline) { if (!BASELINES[baseline]) throw new Error(`unknown baseline ${baseline}`); return { ...BASELINES[baseline], baseline }; }
  return { ...DEFAULT_VARIANT, ...v, baseline: null };
}

// One simulated run. -> { wallS, apiUsdStd, quality, landed, ... }
export function simulate(variantIn, scenarioIn, seed = 1, cal = CAL, baseline) {
  const v = variantOf(variantIn, baseline), sc = scenarioProfile(scenarioIn), C = { ...CAL, ...cal };
  const rnd = mulberry32(seed * 7919 + 17);
  const normal = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const logn = (med, s) => med * Math.exp(s * normal());
  const alone = v.baseline === 'opus-alone';
  const github = v.policy === 'github';
  const usd = { planner: 0, coders: 0, reviewers: 0, merge: 0 };
  const n = { conflicts: 0, bounces: 0, replays: 0, leadMerges: 0, givenBack: 0, reviews: 0, reviewRejects: 0, breaksOnMain: 0, dupWork: 0, claimWaits: 0, samePick: 0, builtTwice: 0 };
  let workS = 0, wastedS = 0, redS = 0, memberOf = null;

  // ---- the true task graph, then the plan ----
  const N = sc.selfPick ? sc.tasks - (sc.dupPairs || 0) : Math.max(2, Math.round(sc.tasks * (0.8 + 0.4 * rnd()))); // self-pick: the list is fixed
  const levels = Math.max(1, Math.min(sc.depth, N));
  const tasks = [];
  for (let i = 0; i < N; i++) {
    // Level 0 gets the most tasks: the first `levels` tasks pin one per level so the chain exists.
    const level = i < levels ? i : Math.min(levels - 1, Math.floor(Math.pow(rnd(), 1.6) * levels));
    tasks.push({ id: i + 1, level, needs: [], plannedNeeds: [], shared: rnd() < sc.pShared ? 1 + Math.floor(rnd() * sc.sharedFiles) : 0, missed: false, dupOf: null });
  }
  for (const t of tasks) if (t.level > 0) {
    const prev = tasks.filter((x) => x.level === t.level - 1);
    const k = Math.min(prev.length, 1 + (rnd() < 0.4 ? 1 : 0));
    for (let j = 0; j < k; j++) { const p = prev[Math.floor(rnd() * prev.length)]; if (!t.needs.includes(p.id)) t.needs.push(p.id); }
  }
  const pm = v.planner === 'none' ? 'opus' : v.planner; // opus-alone plans in its own head
  const planS = logn(C.planS[pm], 0.4);
  usd.planner += planS * C.usdPerS[pm];
  if (!alone) usd.planner += C.routerUsdPerTask[pm] * Math.max(1, Math.round(sc.tasks * C.grain[pm]));
  for (const t of tasks) {
    t.missed = rnd() < C.pMiss[pm] * sc.vague;
    t.plannedNeeds = t.needs.filter(() => rnd() >= C.pEdgeMiss[pm]);
  }
  if (sc.selfPick) for (const t of tasks) { t.missed = false; t.plannedNeeds = [...t.needs]; } // the backlog states every task and its needs
  let work = tasks.filter((t) => !t.missed);
  // Duplicate intents: the vague prompt split into two tasks doing the same thing.
  const dups = [];
  const pDupHere = sc.dupRisk != null ? sc.dupRisk * C.pDup[pm] / C.pDup.sonnet : C.pDup[pm] * sc.vague;
  if (!sc.selfPick) for (const t of work) if (!alone && rnd() < pDupHere) dups.push({ ...t, id: N + dups.length + 1, dupOf: t.id, needs: [...t.needs], plannedNeeds: [...t.plannedNeeds] });
  let dedupeS = 0;
  if (v.dedupe && !sc.selfPick) { dedupeS = C.dedupeS * (work.length + dups.length) / 4; usd.planner += dedupeS * C.usdPerS.haiku; }
  for (const d of dups) if (!(v.dedupe && rnd() < C.dedupeCatch)) work.push(d);
  const W = sc.aloneS ?? 60; // the job in one-Opus-agent seconds
  // Self-pick: the backlog lists dupPairs units twice under far-apart names. Board off: both get built.
  // Board on: one dedupe pass over the list (two teams: only if it sees both lists, `crossDedupe`; else the
  // board's finished intents + the same-meaning rule, pBoardFar) turns the second into a thin alias.
  let builtTwiceIds = [];
  if (sc.selfPick && !alone) {
    const pool = [...work]; const twinsOf = [];
    for (let i = 0; i < (sc.dupPairs || 0) && pool.length; i++) twinsOf.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    const pCatch = !v.board ? 0 : (sc.teams > 1 && !v.crossDedupe) ? C.pBoardFar : C.pDedupeList;
    if (v.board) { const ds = C.dedupeListS * (sc.teams || 1); dedupeS += ds; usd.planner += ds * C.usdPerS.haiku; }
    for (const t of twinsOf) {
      const tw = { ...t, id: N + dups.length + 1, dupOf: t.id, needs: [...t.needs], plannedNeeds: [...t.plannedNeeds], weight: 1 / N };
      if (rnd() < pCatch || rnd() < C.pChanceAlias) { tw.alias = true; tw.dupOf = null; tw.aliasOf = t.id; tw.needs.push(t.id); tw.plannedNeeds.push(t.id); }
      dups.push(tw); tasks.push(tw); work.push(tw);
    }
    if (sc.teams > 1) usd.planner += C.routerUsdPerTask[pm] * work.length; // a second router
  }
  for (const x of work) { x.members = [x.id]; x.weight = (x.alias ? C.aliasWork : 1) / N; }

  // ---- one agent alone: the whole job in one pass, one commit (no split, no queue, no merges) ----
  if (alone) {
    const d = logn(W * C.workRatio[v.coderModel] * (1 - [...tasks].filter((t) => t.missed).length / N), C.aloneSigma);
    usd.coders += d * C.usdPerS[v.coderModel];
    for (const x of work) { x.st = 'landed'; x.defect = rnd() < C.pDefect[v.coderModel] * sc.difficulty && !(rnd() < C.aloneSelfCatch); }
    const wallS = (v.planner === 'none' ? 0 : planS) + d + 5;
    let passed = 0;
    const per = sc.hidden / N;
    const mine = new Map(work.map((x) => [x.id, x]));
    for (const x of tasks) { const w = mine.get(x.id); if (!x.missed && w && !w.defect) passed += per; }
    const apiUsdStd = usd.planner * (v.planner === 'none' ? 0 : 1) + usd.coders;
    return { wallS, apiUsdStd, quality: qualityScore({ hiddenPass: passed, hiddenTotal: sc.hidden, build: true, typecheck: true, ownTests: true, judgeScore: null }), hiddenPass: +passed.toFixed(1), hiddenTotal: sc.hidden, tasksPlanned: work.length, tasksTrue: N, landed: work.length, dropped: 0, missed: tasks.filter((x) => x.missed).length, dupPlanned: 0, workS: d, wastedS: 0, redS: 0, usd, ...n };
  }

  // ---- the planner's grain: merge the fine tasks into k bigger ones, level by level ----
  if (!sc.selfPick) {
    const k = Math.max(1, Math.min(work.length, Math.round(work.length * C.grain[pm] * (0.8 + 0.4 * rnd()))));
    if (k < work.length) {
      // Vertical slices: a planner bundles a piece with what it builds on (stage 1: the planners
      // mostly declared no needs between their tasks), so order the fine tasks depth-first from
      // each root and cut that order into k runs: most dependencies end up inside one task.
      const kids = new Map(work.map((x) => [x.id, []]));
      for (const x of work) { const p = x.needs.find((id) => kids.has(id)); if (p != null) kids.get(p).push(x); }
      const seen = new Set(), order = [];
      const visit = (x) => { if (seen.has(x.id)) return; seen.add(x.id); order.push(x); for (const c of kids.get(x.id)) visit(c); };
      for (const x of [...work].sort((a, b) => a.level - b.level || a.id - b.id)) if (!x.needs.some((id) => kids.has(id))) visit(x);
      for (const x of work) visit(x);
      const per = order.length / k, groups = [];
      for (let g = 0; g < k; g++) groups.push(order.slice(Math.round(g * per), Math.round((g + 1) * per)));
      const groupOf = new Map();
      const merged = groups.filter((g) => g.length).map((g, i) => {
        const id = 1000 + i;
        for (const m of g) groupOf.set(m.id, id);
        return { id, level: Math.min(...g.map((m) => m.level)), members: g.flatMap((m) => m.members), weight: g.reduce((a, m) => a + m.weight, 0),
          shared: g.find((m) => m.shared)?.shared || 0, dupOf: g.every((m) => m.dupOf) ? g[0].dupOf : null, trueNeeds: g.flatMap((m) => m.needs), plannedTrueNeeds: g.flatMap((m) => m.plannedNeeds) };
      });
      // A planned task depends only on tasks EARLIER in the plan's order: two bigger tasks that
      // needed each other would deadlock (seed 1 of bakery did), and a planner would not split it so.
      for (const x of merged) {
        const earlier = (id) => id != null && id < x.id;
        x.needs = [...new Set(x.trueNeeds.map((id) => groupOf.get(id)).filter(earlier))];
        x.plannedNeeds = [...new Set(x.plannedTrueNeeds.map((id) => groupOf.get(id)).filter(earlier))];
        if (x.dupOf != null) x.dupOf = groupOf.get(x.dupOf) ?? null;
      }
      work = merged;
    }
  }
  memberOf = new Map(work.flatMap((x) => x.members.map((m) => [m, x])));

  // ---- event loop ----
  const heap = []; let seq = 0, t = 0;
  const push = (dt, fn) => { const e = { t: t + dt, s: seq++, fn }; heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p].t < e.t || (heap[p].t === e.t && heap[p].s < e.s)) break; heap[i] = heap[p]; i = p; } heap[i] = e; };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = l; if (l >= heap.length) break; if (r < heap.length && (heap[r].t < heap[l].t || (heap[r].t === heap[l].t && heap[r].s < heap[l].s))) m = r; if (heap[m].t > last.t || (heap[m].t === last.t && heap[m].s > last.s)) break; heap[i] = heap[m]; i = m; } heap[i] = last; } return top; };

  const byId = new Map(work.map((x) => [x.id, x]));
  for (const x of work) { x.st = 'todo'; x.tries = 0; x.notBefore = 0; x.defect = false; x.sharedVersion = 0; }
  const landed = new Set(); // true ids landed (a duplicate lands under its own id)
  const isLanded = (id) => landed.has(id) || !byId.has(id); // a missed task never lands: its dependents build anyway
  const sharedVersion = new Map(); // shared file -> number of landings that changed it
  const holder = new Map(); // claims: shared file -> task id
  const coders = alone ? 1 : v.coders;
  let freeCoders = coders, freeReviewers = alone ? 0 : v.reviewers;
  const nLeads = v.policy === 'leads' ? Math.max(1, Math.ceil(coders / C.leadSpan)) : 0;
  let freeLeads = nLeads;
  const reviewQ = [], leadQ = [], mq = [];
  let mergeBusy = false, phase = 0, gateOpen = true, done = null;
  const maxLevel = Math.max(...work.map((x) => x.level), 0);

  const ready = (x) => {
    if (x.st !== 'todo' || x.notBefore > t) return false;
    if (v.policy === 'phases') return gateOpen && x.level === phase;
    if (['stacking', 'intent', 'leads'].includes(v.policy)) return x.plannedNeeds.every((id) => isLanded(id) || ['queued', 'review', 'reviewWait'].includes(byId.get(id)?.st));
    return true; // ffa, github, opus-alone
  };
  function pump() {
    while (freeCoders > 0 && done == null) {
      const c = work.filter(ready);
      if (!c.length) return;
      const fix = c.find((x) => x.fixing);
      // One agent alone works in dependency order (it planned it); a swarm does not plan the order.
      const x = fix || (alone ? c.reduce((a, b) => (b.level < a.level ? b : a)) : c[Math.floor(rnd() * c.length)]);
      if (v.claims && x.shared && holder.has(x.shared) && holder.get(x.shared) !== x.id) { x.notBefore = t + 30; n.claimWaits++; push(31, pump); continue; }
      if (v.claims && x.shared) holder.set(x.shared, x.id);
      start(x);
    }
  }
  function start(x) {
    freeCoders--; x.st = 'work'; x.tries++; if (x.startedAt == null) x.startedAt = t;
    const model = v.coderModel;
    let d = logn(C.taskFixedS + C.workRatio[model] * W * x.weight, C.workSigma);
    if (v.board) d += C.boardS;
    // Self-pick: another coder picked the same task at the same time; its copy is dropped at landing.
    if (sc.selfPick && freeCoders > 1 && rnd() < C.pSamePick[v.board ? 'on' : 'off']) {
      freeCoders--; n.samePick++; const d2 = d * (0.7 + 0.6 * rnd());
      push(d2, () => { freeCoders++; workS += d2; wastedS += d2; usd.coders += d2 * C.usdPerS[model]; pump(); });
    }
    if (x.fixing) d *= x.fixing; else if (x.tries > 1) d *= C.redoFactor;
    if (alone) d *= 0.8; // no hand-offs, but the context grows (costed below)
    // Base: main now (+ the needs it stacks on, for stacking/intent/leads).
    x.base = new Set(landed);
    if (['stacking', 'intent', 'leads'].includes(v.policy)) for (const id of x.plannedNeeds) x.base.add(id);
    if (x.shared) x.sharedVersion = sharedVersion.get(x.shared) || 0;
    push(d, () => {
      freeCoders++; workS += d; x.pushedAt = t;
      usd.coders += d * C.usdPerS[model] * (alone ? C.aloneContext : 1);
      const wasFix = x.fixing; x.fixing = 0;
      // Own check: does it build on what it started from? A true need that was neither on main nor stacked fails it.
      const unmet = v.policy !== 'phases' && x.needs.some((id) => byId.has(id) && !x.base.has(id) && !landed.has(id));
      if (unmet) {
        // Given back: waiting for a prerequisite is not a failed attempt (swarm: no cap was ever hit at 40).
        n.givenBack++; wastedS += d; x.st = 'todo'; x.notBefore = t + C.backoffS; x.tries--; x.givenBack = (x.givenBack || 0) + 1;
        if (v.claims && x.shared && holder.get(x.shared) === x.id) holder.delete(x.shared);
        if (x.givenBack >= C.maxGiveBacks) { x.st = 'dropped'; release(x); checkDone(); }
        push(C.backoffS + 1, pump); pump(); return;
      }
      // A big task has more chances to go wrong; an escaped defect breaks one requirement (run 16: 1 of 26 hidden).
      if (!wasFix) x.defect = rnd() < 1 - Math.pow(1 - C.pDefect[model] * sc.difficulty * C.plannerClarity[v.planner], x.members.length);
      if (alone) { if (x.defect && rnd() < C.aloneSelfCatch) x.defect = false; }
      if (!alone && v.reviewers > 0) { x.st = 'reviewWait'; reviewQ.push(x); pumpReview(); } else toMerge(x);
      pump();
    });
  }
  function pumpReview() {
    while (freeReviewers > 0 && reviewQ.length) {
      const x = reviewQ.shift(); freeReviewers--; x.st = 'review'; n.reviews++;
      const adv = v.reviewStyle === 'adversarial';
      const d = logn(C.reviewMedS * C.speed[v.reviewerModel], C.reviewSigma) * (adv ? C.adversarialTime : 1);
      push(d, () => {
        freeReviewers++; usd.reviewers += d * C.usdPerS[v.reviewerModel];
        const pc = Math.min(0.95, C.pCatch[v.reviewerModel] * (adv ? C.adversarialCatch : 1));
        if ((x.defect && rnd() < pc) || (!x.defect && rnd() < C.pFalseAlarm)) {
          n.reviewRejects++; x.defect = false; x.fixing = C.fixFactor; x.st = 'todo'; x.notBefore = 0;
        } else toMerge(x);
        pumpReview(); pump();
      });
    }
  }
  function toMerge(x) {
    if (v.policy === 'phases') return push(5, () => landPhases(x)); // shared tree: a commit, no queue
    if (alone) return push(5, () => { if (x.defect && rnd() < C.pVisible) { x.defect = false; x.fixing = C.fixFactor; x.st = 'todo'; return pump(); } land(x); }); // its own main: commits, runs the check, no merges
    x.st = 'queued'; mq.push(x); pumpMerge();
  }
  function landPhases(x) {
    // Main may go red inside a phase: a missed dependency edge inside the same phase lands early.
    if (x.needs.some((id) => byId.has(id) && !landed.has(id))) { n.breaksOnMain++; redS += 60; }
    if (x.defect && rnd() < C.pVisible) { n.breaksOnMain++; redS += C.workMedS * C.fixFactor; x.defect = false; }
    land(x);
  }
  function pumpMerge() {
    if (mergeBusy || !mq.length) return;
    const order = ['stacking', 'intent', 'leads'].includes(v.policy);
    const train = [];
    for (const x of mq) {
      if (train.length >= (github ? 1 : v.trainMax)) break;
      if (order && !x.plannedNeeds.every((id) => isLanded(id) || train.includes(byId.get(id)))) continue;
      train.push(x);
    }
    if (!train.length) return;
    for (const x of train) mq.splice(mq.indexOf(x), 1);
    mergeBusy = true;
    const d = C.landS + C.landPerChangeS * (train.length - 1);
    push(d, () => {
      mergeBusy = false; usd.merge += d * C.usdPerS.haiku * 0.1;
      for (const x of train) landOne(x);
      pumpMerge();
    });
  }
  function landOne(x) {
    // Conflict: its shared file changed on main since it started, or it duplicates a landed change.
    const moved = x.shared && (sharedVersion.get(x.shared) || 0) > x.sharedVersion;
    const dupClash = x.dupOf && landed.has(x.dupOf);
    let conflict = (moved && rnd() > C.pCleanShared) || (dupClash && rnd() > C.pCleanDup);
    if (conflict) {
      n.conflicts++;
      if (v.policy === 'intent' && rnd() < C.pReplay) { n.replays++; conflict = false; }
      else if (v.policy === 'leads') { leadQ.push(x); x.st = 'lead'; return pumpLead(); }
    }
    if (conflict) return bounce(x);
    // The queue's check (build + types + own tests) sees some defects; the rest land.
    if (x.defect && rnd() < C.pVisible) { n.bounces++; x.defect = false; x.fixing = C.fixFactor; x.st = 'todo'; x.notBefore = 0; return pump(); }
    land(x);
  }
  function pumpLead() {
    while (freeLeads > 0 && leadQ.length) {
      const x = leadQ.shift(); freeLeads--;
      const d = logn(C.leadS, 0.5);
      push(d, () => { freeLeads++; usd.merge += d * C.usdPerS.sonnet; if (rnd() < C.pLead) { n.leadMerges++; land(x); } else bounce(x); pumpLead(); pumpMerge(); });
    }
  }
  function bounce(x) {
    n.bounces++; x.st = 'todo'; x.notBefore = 0; wastedS += C.workMedS * C.redoFactor;
    if (x.tries >= C.maxTries) { x.st = 'dropped'; release(x); checkDone(); }
    pump();
  }
  function land(x) {
    x.st = 'landed'; landed.add(x.id); x.landedAt = t;
    if (x.dupOf) { n.dupWork++; if (sc.selfPick) n.builtTwice++; }
    if (x.shared) { sharedVersion.set(x.shared, (sharedVersion.get(x.shared) || 0) + 1); if (holder.get(x.shared) === x.id) holder.delete(x.shared); }
    if (v.policy === 'phases' && gateOpen && !work.some((y) => y.level === phase && !['landed', 'dropped'].includes(y.st))) {
      if (phase < maxLevel) { gateOpen = false; push(C.gateS, () => { phase++; gateOpen = true; pump(); }); }
    }
    checkDone(); pump(); pumpMerge();
  }
  // A task that stops holding work (dropped) gives its claim back: a dropped task kept its claim
  // and every task needing that file waited forever (found by qb7's skewed marginals).
  function release(x) { if (x.shared && holder.get(x.shared) === x.id) holder.delete(x.shared); }
  function checkDone() { if (done == null && work.every((y) => ['landed', 'dropped'].includes(y.st))) done = t; }

  push(planS + dedupeS, pump);
  let guard = 0;
  while (heap.length && done == null && guard++ < 200000) { const e = pop(); t = e.t; e.fn(); }
  // Not finished (event guard or nothing left to run): unlanded tasks count as dropped.
  if (done == null) for (const x of work) if (!['landed', 'dropped'].includes(x.st)) x.st = 'dropped';
  const wallS = done ?? t;

  // ---- quality: hidden tests spread over the true tasks; an escaped defect breaks one of them ----
  let passed = 0;
  const per = sc.hidden / tasks.length;
  for (const x of tasks) { const w = memberOf.get(x.id); if (!x.missed && w && w.st === 'landed') passed += per; }
  for (const w of work) if (w.st === 'landed' && w.defect) passed = Math.max(0, passed - per);
  const dropped = work.filter((x) => x.st === 'dropped').length;
  const quality = qualityScore({ hiddenPass: passed, hiddenTotal: sc.hidden, build: !dropped, typecheck: !dropped, ownTests: true, judgeScore: null });
  const apiUsdStd = usd.planner + usd.coders + usd.reviewers + usd.merge;
  return {
    wallS, apiUsdStd, quality, hiddenPass: +passed.toFixed(1), hiddenTotal: sc.hidden,
    tasksPlanned: work.length, tasksTrue: N, landed: work.filter((x) => x.st === 'landed').length, dropped,
    timeline: work.map((x) => ({ members: x.members.length, startS: Math.round(x.startedAt ?? -1), pushS: Math.round(x.pushedAt ?? -1), landS: Math.round(x.landedAt ?? -1), tries: x.tries, needs: x.needs.length })), // for comparing with a real run's tasks[]
    missed: tasks.filter((x) => x.missed).length, dupPlanned: dups.length, workS, wastedS, redS, usd, ...n,
  };
}

// Mean and range over seeds. The first five fields are runs.jsonl's `predicted` block.
export function predict(variant, scenario, { seeds = 5, cal, baseline } = {}) {
  const runs = [];
  for (let s = 1; s <= seeds; s++) runs.push(simulate(variant, scenario, s, cal, baseline ?? variant?.baseline ?? null));
  // Medians (lab-0.8): a real run is one draw, and the lognormal tails pulled the mean up.
  const stat = (k) => { const xs = runs.map((r) => r[k]).sort((a, b) => a - b); return { mean: xs.reduce((a, b) => a + b, 0) / xs.length, median: xs[Math.floor((xs.length - 1) / 2)], min: xs[0], max: xs[xs.length - 1] }; };
  const w = stat('wallS'), c = stat('apiUsdStd'), q = stat('quality');
  return {
    landed: +stat('landed').median.toFixed(1), wallS: Math.round(w.median), apiUsdStd: +c.median.toFixed(2), quality: +q.median.toFixed(1), simVersion: SIM_VERSION,
    mean: { wallS: Math.round(w.mean), apiUsdStd: +c.mean.toFixed(2), quality: +q.mean.toFixed(1) },
    variantKey: variantKey(variant, baseline ?? variant?.baseline ?? null), seeds,
    range: { wallS: [Math.round(w.min), Math.round(w.max)], apiUsdStd: [+c.min.toFixed(2), +c.max.toFixed(2)], quality: [q.min, q.max] },
    counts: Object.fromEntries(['tasksPlanned', 'conflicts', 'bounces', 'replays', 'leadMerges', 'givenBack', 'reviews', 'reviewRejects', 'breaksOnMain', 'dupWork', 'missed', 'dropped', 'samePick', 'builtTwice'].map((k) => [k, +stat(k).mean.toFixed(1)])),
    wastedS: Math.round(stat('wastedS').mean), redS: Math.round(stat('redS').mean),
  };
}

// ---- Builds (B1, docs/board/TASKS.md "Build settings"): an estimate for the home page's Build box ----
// One prediction from the model above, widened by how far the model has been from REAL lab runs
// (estimate-cal.js: real / predicted, p10..p90, regenerated by sim/lab/estimate-cal.mjs). Quality is never a
// number here: only a direction against Balanced, plus what the lab saw for the knob.
import EST_CAL from './estimate-cal.js';

// The three presets, each one a setup the lab has run for real (public/lab/runs.jsonl). R0 (2026-10-12): the two
// team presets run with the board on. The lab measured the board only with agents picking their own tasks; with
// a planner handing out tasks its effect is not measured yet, so the estimate says so (notes) instead of claiming it.
export const BUILD_PRESETS = {
  fastest: { label: 'Fastest', variant: { baseline: 'opus-alone' },
    why: 'One Opus agent does it all. In the lab it finished first where time could be compared (2 of 4 jobs), with the same quality or within one hidden test; on the bigger apps it cost 2-2.5x a team.' },
  balanced: { label: 'Balanced', variant: { planner: 'opus', coders: 12, coderModel: 'haiku', reviewers: 3, reviewerModel: 'haiku', reviewStyle: 'read', policy: 'intent', claims: false, dedupe: true, trainMax: 4, board: true },
    why: 'An Opus planner, 12 Haiku coders and 3 Haiku reviewers, with the board on. On the lab\'s bigger apps: about half the cost of Fastest, slower, nearly the same quality. On small jobs the saving shrinks or reverses.' },
  cheapest: { label: 'Cheapest', variant: { planner: 'opus', coders: 6, coderModel: 'haiku', reviewers: 0, reviewerModel: 'haiku', reviewStyle: 'read', policy: 'intent', claims: false, dedupe: true, trainMax: 4, board: true },
    why: 'An Opus planner and 6 Haiku coders with the board on, no reviewer. Cheapest of the three on most jobs (on very small ones a single agent can cost less), and more misses get through.' },
};

// job: { tasks: 1-80 (pieces of work), overlap: 'low'|'some'|'high' or 0-1 (how much the pieces touch the same
// files / repeat each other), difficulty: 'easy'|'normal'|'hard' }. No prompt analysis yet: SMALL_APP.
export const SMALL_APP = { tasks: 8, overlap: 'some', difficulty: 'normal', label: 'a small app' };
const OVERLAP = { low: 0.15, some: 0.5, high: 0.85 };
const DIFFICULTY = { easy: 0.7, normal: 1, hard: 1.3 };
export function jobProfile(job = SMALL_APP) {
  const tasks = Math.max(1, Math.min(80, Math.round(job.tasks ?? SMALL_APP.tasks)));
  const ov = typeof job.overlap === 'number' ? Math.max(0, Math.min(1, job.overlap)) : OVERLAP[job.overlap] ?? OVERLAP.some;
  const diff = typeof job.difficulty === 'number' ? job.difficulty : DIFFICULTY[job.difficulty] ?? 1;
  // Job size in one-Opus-agent seconds: the lab's apps took 7-21 s per piece (cafe 7, port-ts 11, backlog 14,
  // club 16, bakery 21); 15 s x difficulty.
  return { id: 'build', label: job.label || 'your app', tasks, depth: tasks > 12 ? 3 : 2, pShared: ov, sharedFiles: 4, vague: 0.5,
    dupRisk: 0.3 * ov, difficulty: diff, hidden: tasks, aloneS: 15 * tasks * diff };
}

const roundS = (s) => (s < 120 ? Math.max(10, Math.round(s / 10) * 10) : Math.round(s / 60) * 60);
const roundUsd = (x) => (x < 1 ? Math.max(0.01, +x.toFixed(2)) : +x.toFixed(1));
const sameSetup = (key) => (EST_CAL.rows || []).filter((r) => r.key === key).length;

// -> { wallS: [lo, hi], apiUsd: [lo, hi], basedOn, sameSetup, quality, notes, simVersion }
// basedOn = real lab runs the range rests on; sameSetup = how many of them used exactly this setup.
// Memo: the Adjust sheet re-asks on every slider move.
const BUILD_MEMO = new Map();
function cachedPredict(variant, sc, baseline) {
  const k = `${baseline || ''}|${variantKey(variant, baseline)}|${sc.tasks}|${sc.pShared}|${sc.difficulty}`;
  if (!BUILD_MEMO.has(k)) { if (BUILD_MEMO.size > 500) BUILD_MEMO.clear(); BUILD_MEMO.set(k, predict(variant, sc, { seeds: 15, baseline })); }
  return BUILD_MEMO.get(k);
}
// Was this kind of setup run in the lab? One agent alone; or a team with this coder model, with or without review.
function measured(v) {
  const rows = EST_CAL.rows || [];
  if (v.baseline === 'opus-alone') return rows.some((r) => r.key === 'opus-alone');
  return rows.some((r) => {
    if (r.key === 'opus-alone') return false;
    const kv = Object.fromEntries(r.key.split(';').map((x) => x.split('=')));
    return kv.coderModel === v.coderModel && (+kv.reviewers > 0) === (v.reviewers > 0);
  });
}

// Fixed start-up time every build pays whatever its size: agent boxes starting, the planner's split, the queue's
// check and landing. The lab's per-task fit scales it away on tiny jobs (one agent on 2 easy pieces: 20-40 s).
// low = no build of this shape finished sooner; mid = what a tiny build takes. From the lab's quickest finished
// runs (one agent 58 s, a team 172 s) and the real builds below (Workers Logs build_settled). Refit at 3+ builds.
export const REAL_BUILDS = [
  // eyal/est-bar-test, 2026-10-12: click-counter page + README, router + 2 Opus agents, no review, auto-land.
  // Router split at +41 s, both pushed at +311 s, landed at +320 s. The page showed Fastest's 70-180 s: it ran
  // on code from before a810395, which ignored the setting. The model for what ran (2 pieces): 90-240 s.
  { slug: 'eyal/est-bar-test', at: '2026-10-12', shape: 'team', pieces: 2, wallS: 320 },
  // R2, eyal/real-tip-splitter, 2026-10-12: curated small idea (3 pieces), default Build = one Opus agent. Shown
  // 50-120 s, $0.21-0.28; took 149 s and $0.81 (Ledger at lab rates). Cost: not refit yet (which tokens: asked qb6).
  { slug: 'eyal/real-tip-splitter', at: '2026-10-12', shape: 'alone', pieces: 3, wallS: 149, usd: 0.813 },
  // R3-R5 (FINDINGS2 section 11; Ledger per model at lab rates, Haiku prompts over 100k tokens at 5x; boxes left out,
  // the estimate is API cost). Walls include a false budget halt (2-6 min, fixed) and, in R3, a stalled push.
  { slug: 'eyal/real-home-inventory', at: '2026-10-12', shape: 'team', bucket: 'large', coders: 12, agents: 9, reviewers: 3, wallS: 1940, usd: 2.40, shown: { wallS: [420, 1080], usd: [1.0, 1.4] } },
  { slug: 'eyal/real-cafe-site', at: '2026-10-12', shape: 'team', bucket: 'huge', coders: 20, agents: 10, reviewers: 3, wallS: 1762, usd: 3.45, shown: { wallS: [540, 1440], usd: [1.7, 2.3] } },
  // 40 agents: long-context Haiku calls $8.16 of $17.3; agents waited 16,234 agent-s for a reviewer vs 15,731 working.
  { slug: 'eyal/real-course-builder', at: '2026-10-13', shape: 'team', bucket: 'huge', coders: 40, agents: 40, reviewers: 6, wallS: 2257, usd: 17.3, shown: { wallS: [540, 1440], usd: [1.7, 2.3] } },
  // R6: R3's Large prompt on Fastest (one Opus agent): 457 s, $3.87 (out 95k, cache reads 4.6M, 1-h writes 132k);
  // 1 change, 7 files, ~1,340 lines vs R3's 22 files, ~4,140 lines. Shown 120-300 s, $1.70-3.10 (sim ~195 s, $1.67).
  { slug: 'eyal/real-home-inventory-solo', at: '2026-10-13', shape: 'alone', bucket: 'large', wallS: 457, usd: 3.87, shown: { wallS: [120, 300], usd: [1.7, 3.1] } },
];
// The refit on those builds (2026-10-13), applied on top of the lab-calibrated sim. Few points, so each term is
// named, the range is widened, and the estimate says how many real builds it rests on.
// - one Opus agent: real = aloneUsdX x sim + sessionUsd, the line through R2 ($0.81 real, $0.24 sim) and R6 ($3.87,
//   $1.67): x2.14 + $0.30. The fixed part is the start-up context (1-h cache) and the push/landing turns; the x2.1
//   is more work per piece than in the lab (R6 wrote 95k output tokens). Time: R6 2.4x the sim (R2 sits on the floor).
// - perAgentUsd: each Haiku team agent's own session on top of the sim (start-up context, board, waiting turns):
//   R3 ($2.40 - $1.2 sim) / 9 agents = $0.13, R4 ($3.45 - $2.0) / 10 = $0.145.
// - long: at 40 agents contexts grew past 100k tokens (5x price): per-agent cost x2.7 (R5: ($17.3 - $2.0) / 40 =
//   $0.38). Grows linearly from 10 agents (none seen) to 40 (R5). Why contexts grow is open (FINDINGS2 11).
// - wall: real team walls were 1.8x the sim at 9-10 agents (R3, R4) and 2.3x at 40 (R5: as much time waiting for a
//   reviewer as working). Same linear ramp.
// - agents: how many the router opens. It is now told how many it has, so up to min(coders, pieces) (R5 used all
//   40); R3/R4 used fewer (9 of 12, 10 of 20). Low end = the planner's bundling, high end = min(coders, pieces).
export const REAL_FIT = { aloneUsdX: 2.14, sessionUsd: 0.30, aloneWallX: 2.4, perAgentUsd: 0.14, longAt40: 2.7, wallAt10: 1.8, wallAt40: 2.3, from: 10, to: 40 };
const ramp = (n) => Math.max(0, Math.min(1, (n - REAL_FIT.from) / (REAL_FIT.to - REAL_FIT.from)));
// alone mid: the one real one-agent build (R2, 149 s); low stays the lab's quickest (58 s).
export const BUILD_FLOOR = { alone: { low: 50, mid: 150 }, team: { low: 170, mid: 320 } };

// -> { wallS: [lo, hi], apiUsd: [lo, hi], basedOn, sameSetup, agentTasks, quality, qualityMeasured, notes, simVersion, job }
// basedOn = real lab runs the range rests on; sameSetup = how many of them used exactly this setup.
// Monotonic in reviewers (qb7, 2026-10-12): each change is reviewed once, so reviewers add review time and cost
// once (0 -> 1) and after that only shorten the wait for a free reviewer. So over the same variant with
// 0..r reviewers: cost never falls (running max), quality never falls (running max), and time is at least the
// no-review time, else the best of 1..r (sim noise would otherwise make 2 reviewers cheaper than 1).
// opts.real = false: the lab-only estimate, without REAL_FIT (suggestBuild compares presets on it, see there).
export function predictBuild(job = SMALL_APP, variantIn = BUILD_PRESETS.balanced.variant, opts = {}) {
  const real = opts.real !== false;
  const sc = jobProfile(job);
  const baseline = variantIn?.baseline ?? null;
  const v = variantOf(variantIn, baseline);
  let p = cachedPredict(variantIn, sc, baseline);
  if (!baseline && v.reviewers > 0) {
    const at = (r) => cachedPredict({ ...variantIn, reviewers: r }, sc, null);
    let cost = 0, q = 0, wall = Infinity;
    for (let r = 0; r <= v.reviewers; r++) { const x = at(r); cost = Math.max(cost, x.apiUsdStd); q = Math.max(q, x.quality); if (r > 0) wall = Math.min(wall, x.wallS); }
    p = { ...p, apiUsdStd: cost, quality: q, wallS: Math.max(at(0).wallS, wall) };
  }
  // Quality is compared with the nearest preset: one coder (alone or with reviewers) against Fastest, a team
  // against Balanced.
  const solo = baseline === 'opus-alone' || v.coders === 1;
  const refName = solo ? 'Fastest' : 'Balanced';
  const refVariant = solo ? BUILD_PRESETS.fastest.variant : BUILD_PRESETS.balanced.variant;
  const isRef = variantKey(variantIn, baseline) === variantKey(refVariant, refVariant.baseline ?? null);
  const ref = isRef ? p : cachedPredict(refVariant, sc, refVariant.baseline ?? null);
  const w = EST_CAL.wall, c = EST_CAL.cost;
  const notes = [];
  if (baseline === 'opus-alone') notes.push('One agent: no merges, nothing to coordinate.');
  else {
    if (v.reviewers === 0) notes.push('No reviewer: a mistake that the build does not catch lands as is.');
    else notes.push('Each change is reviewed once: more reviewers only shorten the wait for one.');
    if (v.coders === 1) notes.push('One coder in a team still pays for a planner and reviews: Fastest skips both.');
    if (v.planner === 'haiku') notes.push('A Haiku planner missed requirements on vague prompts in the lab.');
    // The lab measured the board with self-picking agents only (round 2); the sim's planned-team effect is a guess.
    if (v.board) notes.push('Board on: its effect is not measured for planned teams yet (the lab measured it with agents picking their own tasks).');
    else if (sc.pShared >= 0.7) notes.push('Many tasks touch the same files: the board helps here.');
  }
  const qualityMeasured = measured(v);
  const dq = p.quality - ref.quality;
  const direction = baseline === 'opus-alone' ? 'About the same quality as a team in the lab.' : isRef ? 'The lab\'s middle setting.'
    // Never better than Fastest: in the lab a team matched one Opus agent at best (same, or one hidden test apart), so a sim edge over it is not evidence.
    : dq > 2 && !solo ? `Fewer misses than ${refName}.` : dq < -2 ? `More misses than ${refName}.` : `About like ${refName}.`;
  const shape = baseline === 'opus-alone' ? 'alone' : 'team';
  const floor = BUILD_FLOOR[shape];
  const realN = REAL_BUILDS.filter((r) => r.shape === shape && r.usd != null).length;
  // REAL_FIT (above): time x the real/sim ratio for this many agents; cost + per-session costs.
  const agentsLo = shape === 'alone' ? 1 : Math.max(1, Math.min(v.coders, Math.round(p.counts.tasksPlanned)));
  const agentsHi = shape === 'alone' ? 1 : Math.max(agentsLo, Math.min(v.coders, sc.tasks));
  const wallX = !real ? 1 : shape === 'alone' ? REAL_FIT.aloneWallX : REAL_FIT.wallAt10 + (REAL_FIT.wallAt40 - REAL_FIT.wallAt10) * ramp(agentsHi);
  const extraUsd = (n) => !real ? 0 : shape === 'alone' ? REAL_FIT.sessionUsd + (REAL_FIT.aloneUsdX - 1) * p.apiUsdStd
    : v.coderModel === 'haiku' ? n * REAL_FIT.perAgentUsd * (1 + (REAL_FIT.longAt40 - 1) * ramp(n))
    // Sonnet/Opus crews: no real build yet. A guess: R2's extra over the sim ($0.57) per Opus agent, half per Sonnet one.
    : n * 0.57 * (v.coderModel === 'sonnet' ? 0.5 : 1);
  const simWall = p.wallS * wallX;
  const wallMid = Math.max(simWall, floor.mid);
  if (simWall < floor.mid) notes.push('Mostly start-up time (agents starting, landing) at this size.');
  if (real && shape === 'team' && v.coderModel === 'haiku' && agentsHi >= 20) notes.push(`With ${agentsHi} agents, contexts grow past 100k tokens, priced 5x (nearly half of a 40-agent build's cost), and agents wait for reviewers about as long as they work.`);
  if (real) notes.push(`Fitted to ${realN} real build${realN === 1 ? '' : 's'} like this (${REAL_BUILDS.length} in all) on top of ${EST_CAL.runs} lab runs.`);
  // Widened: the low end takes 40% of the fitted extra (R4 used 10 agents where the planner's bundling says 15), the
  // high end x1.25 for having so few real builds.
  const usdLo = p.apiUsdStd * c.p10 + extraUsd(agentsLo) * 0.4, usdHi = (p.apiUsdStd * c.p90 + extraUsd(agentsHi)) * (real ? 1.25 : 1);
  return {
    wallS: [roundS(Math.max(wallMid * w.p10, floor.low)), roundS(wallMid * w.p90)],
    apiUsd: [roundUsd(usdLo), roundUsd(usdHi)], realBuilds: realN,
    basedOn: EST_CAL.runs, sameSetup: sameSetup(variantKey(variantIn, baseline)),
    // The planner bundles pieces into fewer agent tasks (Opus ~0.37 of the pieces, Haiku ~0.8: stage 1); the
    // router spawns one agent per task, so agents beyond `agentTasks` never start: the coders knob is a cap.
    agentTasks: baseline ? 1 : Math.max(1, Math.round(p.counts.tasksPlanned)),
    quality: qualityMeasured ? direction : 'Not measured in the lab.', qualityGuess: direction, qualityMeasured,
    notes, simVersion: SIM_VERSION, job: { tasks: sc.tasks, overlap: sc.pShared, difficulty: sc.difficulty, label: sc.label },
  };
}

// B4: the prompt analysis (one Haiku call, docs/board/build-estimate.md) returns only the job; the preset is
// chosen here, in code, from the estimates, so the model never picks a setting.
// Stable across readings (qb6, 2026-10-12: the same bakery prompt read as 20, 12, 20, 20 pieces): the piece count
// goes into log-scale buckets ~2.5x wide and the decision and its words use the bucket's middle, so a +-40%
// wobble in the reading mostly stays inside one bucket. Show `job` (bucketed) and estimate from it.
export const TASK_BUCKETS = [
  { max: 4, tasks: 3, label: '1-4 pieces', small: true },
  { max: 11, tasks: 7, label: '5-11 pieces', small: true },
  { max: 29, tasks: 18, label: '12-29 pieces', small: false, size: 'A mid-size job' },
  { max: Infinity, tasks: 40, label: '30 or more pieces', small: false, size: 'A big job' },
];
export const bucketOf = (n) => TASK_BUCKETS.find((b) => Math.round(n) <= b.max);
// -> { preset, why, bucket, job }. The board comes with the preset (R0: on for both team presets), so no board here.
export function suggestBuild(jobIn = SMALL_APP) {
  const bucket = bucketOf(jobProfile(jobIn).tasks);
  const job = { ...jobIn, tasks: bucket.tasks, bucket: bucket.label };
  const sc = jobProfile(job);
  // Compared on the real-fitted estimates (2026-10-13): both sides now have real builds, including the same Large
  // prompt both ways (R3 team $2.40 / 1,940 s, R6 one agent $3.87 / 457 s). The picks equal the lab-only ones.
  const f = predictBuild(job, BUILD_PRESETS.fastest.variant), b = predictBuild(job, BUILD_PRESETS.balanced.variant);
  const mid = (r) => (r.apiUsd[0] + r.apiUsd[1]) / 2;
  const x = mid(f) / mid(b);
  const out = (o) => ({ ...o, bucket: bucket.label, job });
  if (bucket.small || x <= 1.5) {
    // The words follow this job's numbers: 'small' only for the two small buckets.
    const cost = x <= 1.05 ? 'costs about the same as a team or less' : x <= 1.25 ? 'costs a little more than a team' : `costs about ${x.toFixed(1)}x a team`;
    return out({ preset: 'fastest', why: `${bucket.small ? 'A small job: o' : 'O'}ne agent is likely quickest here, at about a team's quality, and ${cost}.` });
  }
  if (sc.difficulty <= 0.7 && sc.pShared < 0.7) return out({ preset: 'cheapest', why: 'Many simple, separate pieces: a Haiku crew does them for the least.' });
  const share = 1 / x;
  const part = share <= 0.4 ? 'at well under half' : share <= 0.6 ? 'at about half' : share <= 0.8 ? 'at about two thirds' : 'a little below';
  const of = `${part} the cost of one agent`;
  return out({ preset: 'balanced', why: sc.pShared >= 0.7 ? `${bucket.size} whose pieces overlap: a team with the board on, ${of}.` : `${bucket.size}: a reviewed team, ${of}.` });
}

// "Need an idea?" chips (docs/board/TASKS.md I1): each size's typical time and cost, i.e. a job in the middle of
// its bucket (some overlap, normal difficulty) on the settings suggestBuild picks for it. A picked idea then shows
// its own estimate (POST /api/build/idea returns it). The ideas themselves are one list, server side: qb6's
// CURATED_IDEAS in src/buildsettings.ts. A function, memoised, so importing this module costs nothing.
// -> { small: { label, tasks, bucket: '1-4 pieces', preset, board?, settings, wallS: [lo, hi], apiUsd: [lo, hi] }, medium, large, huge }
const IDEA_SIZE_IDS = [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'], ['huge', 'Huge']];
let ideaSizesMemo = null;
export function ideaSizes() {
  if (ideaSizesMemo) return ideaSizesMemo;
  ideaSizesMemo = Object.fromEntries(IDEA_SIZE_IDS.map(([id, label], i) => {
    const b = TASK_BUCKETS[i];
    const s = suggestBuild({ tasks: b.tasks, overlap: 'some', difficulty: 'normal' });
    const settings = { ...BUILD_PRESETS[s.preset].variant, ...(s.board !== undefined ? { board: s.board } : {}) };
    const e = predictBuild(s.job, settings);
    return [id, { label, tasks: b.tasks, bucket: b.label, preset: s.preset, ...(s.board !== undefined ? { board: s.board } : {}), settings, wallS: e.wallS, apiUsd: e.apiUsd }];
  }));
  return ideaSizesMemo;
}

// ---- the adaptive orchestrator's label (manager + qb7, 2026-10-12): what kind of job this is, the strategy the
// builder will run for it (never one it cannot run) and why, from the suggest/idea job facts and suggestBuild's pick.
// jobType(job, suggestion?) -> { type, label, strategy, why, preset, board?, better?, evidence, from }
//   type: 'small-app' | 'app' | 'big-app' | 'shared-list' | 'port' | 'sweep'
//   strategy/why: what the builder runs and the short reason (qb7 shows "Looks like: <label>. Strategy: <strategy> (<why>).")
//   better: a strategy we measured that the builder does not run yet (lanes, owned ranges + check behind); may be absent
//   from: 'kind' (job.kind said port/sweep) or 'size'. Port and sweep come ONLY from job.kind, never guessed.
const STRATEGY = { fastest: 'one strong agent', balanced: 'an Opus planner with a reviewed Haiku team', cheapest: 'an Opus planner and a Haiku crew, no reviewer' };
export function jobType(job = SMALL_APP, suggestion = null) {
  const s = suggestion || suggestBuild(job);
  // The board comes with the preset (R0); an older suggestion may still carry its own.
  const preset = s.preset, board = s.board ?? BUILD_PRESETS[preset]?.variant.board;
  const strategy = STRATEGY[preset] + (board ? ' with the board on' : '');
  const base = { preset, ...(board !== undefined ? { board } : {}), strategy };
  const b = bucketOf(jobProfile(job).tasks);
  const overlapHigh = jobProfile(job).pShared >= 0.7;
  if (job.kind === 'port') return { ...base, type: 'port', from: 'kind', label: 'a port of existing code',
    why: preset === 'fastest' ? 'in a port most changes build on earlier ones, so extra agents mostly wait'
      : 'a team at about half the cost of one agent, though changes that build on each other still wait for each other',
    better: 'agents owning line ranges, each change landing at once with its check behind it',
    evidence: 'Bun port replay (BUN3): 89% of commits depend on earlier lines; 640 agents no faster than 64.' };
  if (job.kind === 'sweep') return { ...base, type: 'sweep', from: 'kind', label: 'one change across many files',
    why: preset === 'fastest' ? 'at this size one agent is still quickest' : 'many small, separate edits split well, and the queue replays each on the newest main',
    evidence: 'Real-code run (sim/real): 972 of 976 conflicts replayed cleanly on the new main.' };
  if (b.small) return { ...base, type: 'small-app', from: 'size', label: 'a new small app',
    why: preset === 'fastest' ? 'fastest in the lab, at about a team\'s quality' : s.why,
    evidence: 'Lab: one agent finished first where time could be compared (2 of 4 jobs), same quality or within one hidden test.' };
  if (overlapHigh) return { ...base, type: 'shared-list', from: 'size', label: 'an app whose pieces overlap',
    why: board ? 'the board shows who works on what, so pieces are not built twice (not yet measured with a planner)' : s.why,
    evidence: 'Board runs and sims (sim.md (d)-(h)): a duplicate check before work stops pieces being built twice.' };
  if (b.tasks < 30) return { ...base, type: 'app', from: 'size', label: 'a mid-size app',
    why: preset === 'balanced' ? 'about half the cost of one agent on the lab\'s bigger apps' : preset === 'cheapest' ? 'many simple, separate pieces' : 'one agent is still quickest here',
    evidence: 'Lab stage 1: on the bigger apps a team cost about half of one agent.' };
  return { ...base, type: 'big-app', from: 'size', label: 'a big app',
    why: preset === 'fastest' ? 'one agent is still quickest here' : preset === 'cheapest' ? 'many simple, separate pieces: a Haiku crew does them for the least'
      : 'in the lab a team cost about half of one agent on big apps; the builder runs up to 12 coders',
    better: 'landing lanes by area that test what depends on each change, with a controller per lane',
    evidence: 'L1-L2: one queue saturates near 300 agents; 32 dependency-aware lanes + controller landed 1.4x one queue with 0 breaks.' };
}
