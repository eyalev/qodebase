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

export const SIM_VERSION = 'lab-0.7';

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
  return Object.keys(KNOBS).map((k) => `${k}=${typeof v[k] === 'boolean' ? (v[k] ? 1 : 0) : v[k]}`).join(';');
}

// Scenario profiles: qb5's scripts/lab/scenarios/<id>/scenario.json "profile" (2868ad1, first
// guesses by qb5, to be measured in stage 1), mapped to the sim's fields: tasks = middle of
// expectedTasks (geometric for a wide range), depth = dependencyDepth, pShared = sharedFileShare,
// sharedFiles = how many, vague = vagueness (high 0.8 / medium 0.5 / low 0.2), dupRisk = duplicateIntentRisk
// (for a Sonnet planner; other planners scale by CAL.pDup), hidden = hiddenTotal
// (public/lab/scenarios.json). difficulty is qb4's guess (defects and work time multiplier).
// size: how big each task is, relative to cafe-family's (=1, measured on stage-1 runs 1-3); it
// scales every work time (coders and one-agent-alone). port-ts: 1 until stage-1 run 13 measures it.
export const SCENARIOS = {
  'cafe-family': { label: 'Make the cafe family-friendly', tasks: 7, depth: 2, pShared: 0.6, sharedFiles: 4, vague: 0.8, dupRisk: 0.05, difficulty: 1, hidden: 7 }, // dupRisk 0.3 -> 0.05: 0 duplicates in 11 tasks (stage 1, qb5)
  'port-ts': { label: 'Port a library to TypeScript', tasks: 21, depth: 3, pShared: 0.1, sharedFiles: 3, vague: 0.2, dupRisk: 0.05, difficulty: 1, hidden: 158, size: 3.2 }, // size fitted on stage-1 run 13 (one Opus agent, 81 files, 228 s); difficulty 1.3 -> 1: it passed 158/158
  bakery: { label: 'Build a small bakery website with online orders', tasks: 25, depth: 3, pShared: 0.5, sharedFiles: 5, vague: 0.5, dupRisk: 0.15, difficulty: 1.2, hidden: 26, size: 10.2 }, // qb5 682084f; size fitted so one agent alone takes ~795 s (qb5's reference: 392 + 403 s, one Opus agent) with this file's alone formula (30 s + 3 s x tasks x size); was 4.4 (my arithmetic, qb5 caught it)
  rename: { label: 'Rename X across the codebase + a dependent change', tasks: 20, depth: 3, pShared: 0.4, sharedFiles: 2, vague: 0.1, difficulty: 0.7, hidden: 10 }, // qb4 guess (backup scenario)
};

export const CAL = {
  // Agent work per task (Sonnet): agents push in 1.5-4 min (measured, MEASUREMENTS.md run 1).
  // Calibrated 2026-10-08 on stage-1 runs 1-3 (cafe-family; sim/lab/calibrate.mjs, public/lab/calibration.json):
  // Haiku coders took a median 29 s per task (11 tasks). Sonnet/Opus coders not measured yet: same speed ratios.
  workMedS: 48, workSigma: 0.5, // a Sonnet-equivalent task; was 180 (MEASUREMENTS run 1 had bigger changes)
  speed: { haiku: 0.6, sonnet: 1, opus: 1.4 }, // assumed ratios; haiku x 48 = 29 s measured
  // API $ per second of an agent working: $1.42 per reviewed change at Sonnet rates (measured).
  usdPerS: { haiku: 0.00059, sonnet: 0.0043, opus: 0.0079 }, // API $ per agent-second: haiku measured (runs 1-2, incl. planner/router), sonnet measured (MEASUREMENTS run 1), opus measured (run 3, one run)
  // A clear plan makes fewer wrong tasks: run 11 (opus planner, haiku coders, 3 haiku reviewers)
  // passed 6/7 like opus-alone, where haiku planner + haiku coders passed 1/7 and 3/7.
  plannerClarity: { haiku: 1, sonnet: 0.6, opus: 0.35, none: 1 }, // haiku/opus fitted on runs 1, 2, 11; sonnet assumed
  pDefect: { haiku: 0.55, sonnet: 0.3, opus: 0.14 }, // per task, times difficulty: haiku fitted on runs 1-2 (hidden 1/7, 3/7 with 3 and 8 tasks), opus on run 3 (6/7); sonnet assumed between. Was 0.25/0.15/0.08
  pVisible: 0.1, // share of defects the build/type check/own tests see: runs 1-3 had every floor green while 1-6 of 7 hidden tests failed. Was 0.5
  // Planner (one call): time, missed requirements, duplicate intents, missed dependency edges (x vague).
  planS: { haiku: 47, sonnet: 60, opus: 90 }, // haiku measured (runs 1-2: ask to first task); sonnet/opus assumed
  pMiss: { haiku: 0.37, sonnet: 0.2, opus: 0.08 }, // x vague: haiku fitted on runs 1-2 (3 and 8 tasks for a ~7-task prompt); sonnet/opus assumed. Was 0.15/0.08/0.04
  pDup: { haiku: 0.25, sonnet: 0.12, opus: 0.06 }, // assumed
  pEdgeMiss: { haiku: 0.3, sonnet: 0.15, opus: 0.08 }, // assumed (not scaled by vague)
  dedupeCatch: 0.85, dedupeS: 20, // assumed
  // Review: ~3 min per review (measured: reviewer agent ~3 min); catch rates assumed.
  reviewMedS: 45, reviewSigma: 0.4, // assumed: the measured ~170 s review scaled to the measured task size (48/180); no reviewed run yet
  pCatch: { haiku: 0.4, sonnet: 0.6, opus: 0.75 }, adversarialCatch: 1.35, adversarialTime: 1.8, pFalseAlarm: 0.05,
  fixFactor: 0.35, // fixing what review asked, share of the task's work (fast sim DEFAULTS)
  // Landing: per train 30 s + 5 s per extra change (sim/swarm); conflicts on shared files.
  landS: 30, landPerChangeS: 5,
  pCleanShared: 0.5, // between Hono's list files 0.2 (sim/real) and Bun's 0.84 (sim/bun): assumed
  pCleanDup: 0.1, // a duplicate intent edits the same lines
  redoFactor: 0.5, // redo on the new main, share of the work (swarm: 0.3 for codemods)
  pReplay: 0.9, // land by intent: replay succeeds (real-code run 972/976; lower for model-written code: assumed)
  leadSpan: 10, leadS: 90, pLead: 0.85, // swarm/fast sim: a lead serves ~10 agents
  gateS: 120, // phases: full check between phases (assumed)
  backoffS: 120, // a task given back is retried after 2 min
  // One agent alone does the whole job in one pass and one commit (run 3: Opus, 8 files, ~50 s).
  aloneBaseS: 30, alonePerTaskS: 3, // fitted on run 3 (one run)
  aloneSelfCatch: 0.3, // assumed
  maxTries: 8, // redos (conflict, failed check) before a task is dropped
  maxGiveBacks: 40, // given back because a prerequisite had not landed (sim/swarm)
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
  return { id: s.id || 'custom', ...SCENARIOS['cafe-family'], ...s };
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
  const n = { conflicts: 0, bounces: 0, replays: 0, leadMerges: 0, givenBack: 0, reviews: 0, reviewRejects: 0, breaksOnMain: 0, dupWork: 0, claimWaits: 0 };
  let workS = 0, wastedS = 0, redS = 0;

  // ---- the true task graph, then the plan ----
  const N = Math.max(2, Math.round(sc.tasks * (0.8 + 0.4 * rnd())));
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
  for (const t of tasks) {
    t.missed = rnd() < C.pMiss[pm] * sc.vague;
    t.plannedNeeds = t.needs.filter(() => rnd() >= C.pEdgeMiss[pm]);
  }
  let work = tasks.filter((t) => !t.missed);
  // Duplicate intents: the vague prompt split into two tasks doing the same thing.
  const dups = [];
  const pDupHere = sc.dupRisk != null ? sc.dupRisk * C.pDup[pm] / C.pDup.sonnet : C.pDup[pm] * sc.vague;
  for (const t of work) if (!alone && rnd() < pDupHere) dups.push({ ...t, id: N + dups.length + 1, dupOf: t.id, needs: [...t.needs], plannedNeeds: [...t.plannedNeeds] });
  let dedupeS = 0;
  if (v.dedupe) { dedupeS = C.dedupeS * (work.length + dups.length) / 4; usd.planner += dedupeS * C.usdPerS.haiku; }
  for (const d of dups) if (!(v.dedupe && rnd() < C.dedupeCatch)) work.push(d);

  // ---- one agent alone: the whole job in one pass, one commit (no split, no queue, no merges) ----
  if (alone) {
    const d = logn(C.aloneBaseS + C.alonePerTaskS * work.length * (sc.size ?? 1), C.workSigma) * sc.difficulty;
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
    freeCoders--; x.st = 'work'; x.tries++;
    const model = v.coderModel;
    let d = logn(C.workMedS * C.speed[model] * sc.difficulty * (sc.size ?? 1), C.workSigma);
    if (x.fixing) d *= x.fixing; else if (x.tries > 1) d *= C.redoFactor;
    if (alone) d *= 0.8; // no hand-offs, but the context grows (costed below)
    // Base: main now (+ the needs it stacks on, for stacking/intent/leads).
    x.base = new Set(landed);
    if (['stacking', 'intent', 'leads'].includes(v.policy)) for (const id of x.plannedNeeds) x.base.add(id);
    if (x.shared) x.sharedVersion = sharedVersion.get(x.shared) || 0;
    push(d, () => {
      freeCoders++; workS += d;
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
      if (!wasFix) x.defect = rnd() < C.pDefect[model] * sc.difficulty * C.plannerClarity[v.planner];
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
    if (x.dupOf) n.dupWork++;
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

  // ---- quality: hidden tests spread over the true tasks; the floor fails if a task never landed ----
  let passed = 0;
  const per = sc.hidden / N;
  for (const x of tasks) {
    const w = byId.get(x.id);
    if (x.missed || !w || w.st !== 'landed') continue;
    passed += w.defect ? 0 : per; // a wrong task fails its hidden tests (runs 1-3); was half
  }
  const dropped = work.filter((x) => x.st === 'dropped').length;
  const quality = qualityScore({ hiddenPass: passed, hiddenTotal: sc.hidden, build: !dropped, typecheck: !dropped, ownTests: true, judgeScore: null });
  const apiUsdStd = usd.planner + usd.coders + usd.reviewers + usd.merge;
  return {
    wallS, apiUsdStd, quality, hiddenPass: +passed.toFixed(1), hiddenTotal: sc.hidden,
    tasksPlanned: work.length, tasksTrue: N, landed: work.filter((x) => x.st === 'landed').length, dropped,
    missed: tasks.filter((x) => x.missed).length, dupPlanned: dups.length, workS, wastedS, redS, usd, ...n,
  };
}

// Mean and range over seeds. The first five fields are runs.jsonl's `predicted` block.
export function predict(variant, scenario, { seeds = 5, cal, baseline } = {}) {
  const runs = [];
  for (let s = 1; s <= seeds; s++) runs.push(simulate(variant, scenario, s, cal, baseline ?? variant?.baseline ?? null));
  const stat = (k) => { const xs = runs.map((r) => r[k]); return { mean: xs.reduce((a, b) => a + b, 0) / xs.length, min: Math.min(...xs), max: Math.max(...xs) }; };
  const w = stat('wallS'), c = stat('apiUsdStd'), q = stat('quality');
  return {
    landed: +stat('landed').mean.toFixed(1), wallS: Math.round(w.mean), apiUsdStd: +c.mean.toFixed(2), quality: +q.mean.toFixed(1), simVersion: SIM_VERSION,
    variantKey: variantKey(variant, baseline ?? variant?.baseline ?? null), seeds,
    range: { wallS: [Math.round(w.min), Math.round(w.max)], apiUsdStd: [+c.min.toFixed(2), +c.max.toFixed(2)], quality: [q.min, q.max] },
    counts: Object.fromEntries(['tasksPlanned', 'conflicts', 'bounces', 'replays', 'leadMerges', 'givenBack', 'reviews', 'reviewRejects', 'breaksOnMain', 'dupWork', 'missed', 'dropped'].map((k) => [k, +stat(k).mean.toFixed(1)])),
    wastedS: Math.round(stat('wastedS').mean), redS: Math.round(stat('redS').mean),
  };
}
