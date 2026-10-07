// Discrete-event simulation of many agents changing code at once.
//
// No threads, no LLM calls: an agent is a small state machine and a virtual clock
// jumps from event to event, so 100k agents cost a for-loop. Same seed, same run.
// Runs in Node (cli.mjs) and in the browser (worker.js). Timings are calibrated on
// qodebase's measured runs (MEASUREMENTS.md, TASKS.md): box boot ~8 s, an agent
// pushes in 1.5-4 min, a review takes ~3 min, ~$1.42 per reviewed change.

export const POLICIES = {
  classic: {
    label: 'Classic PRs',
    about: 'A person reviews every change; a conflict sends the agent back to rebase, then review again.',
    humanReview: 'all', claims: 'none', onConflict: 'rebase', batch: 1,
  },
  agentReview: {
    label: 'Agent review',
    about: 'Reviewer agents check every change; a person only approves risky ones. Conflicts still rebase.',
    humanReview: 'risky', claims: 'none', onConflict: 'rebase', batch: 1,
  },
  claims: {
    label: 'Claims',
    about: 'Agent review, and an agent claims every file it will touch before starting; others wait.',
    humanReview: 'risky', claims: 'all', onConflict: 'rebase', batch: 1,
  },
  hybrid: {
    label: 'Claims + redo + trains',
    about: 'Claims on ordinary files, shared hot files left open; an agent whose files are taken picks another task; a conflict reruns the task on the new main; merges go in trains of up to 16, tested together before they land.',
    humanReview: 'risky', claims: 'cold', onConflict: 'redo', batch: 16, pickFree: 8, trainTest: true,
  },
};

export const PRESETS = {
  today: { label: 'One repo, 20 agents', repos: 1, agentsPerRepo: 20, files: 400 },
  k1: { label: 'One repo, 1,000 agents', repos: 1, agentsPerRepo: 1000, files: 4000 },
  k10: { label: 'One repo, 10,000 agents', repos: 1, agentsPerRepo: 10000, files: 20000 },
  k100: { label: '500 repos × 200 agents = 100,000', repos: 500, agentsPerRepo: 200, files: 1500 },
};

export const DEFAULTS = {
  seed: 1,
  policy: 'hybrid',
  repos: 1,
  agentsPerRepo: 20,
  files: 400, // per repo
  filesPerModule: 40,
  hotFiles: 6, // package.json, routes, the schema...: touched by many tasks
  pHot: 0.3, // chance a task also touches one hot file
  meanTouches: 3,
  bootS: 8,
  workMedS: 180, workSigma: 0.6,
  reviewMedS: 170, reviewSigma: 0.5,
  reviewersShare: 0.25, // reviewer agents per working agent
  pApprove: 0.85, fixFactor: 0.35,
  humansPerRepo: 2,
  humanFullMedS: 480, // a person reading a whole diff
  humanQuickMedS: 90, // a person approving a risky change on its evidence
  pRisky: 0.05,
  mergeS: 2, mergePerChangeS: 0.2,
  pCleanCold: 0.35, pCleanHot: 0.8, // chance git merges a conflicting file by itself
  rebaseFactor: 0.5, redoFactor: 0.6, redoReviewFactor: 0.5,
  pBreak: 0.003, fixMainMedS: 600, // a change that breaks main once merged with the others
  trainTestS: 60, pTestCatches: 0.9, // a tested train bounces a breaking change instead of landing it
  llmPerS: 0.0043, // $/s of an agent thinking (≈ $1.42 per change at Sonnet API prices)
  boxPerS: 0.05 / (1.43 * 3600), // container $/s
  sampleEveryS: 60,
  latencyWindow: 3000,
};

const WORKING = new Set(['work', 'fix', 'rework']);
export const STATE_GROUPS = [
  ['starting', ['boot']],
  ['waiting for a claim', ['claimWait']],
  ['working', ['work', 'fix', 'rework']],
  ['waiting for review', ['reviewWait', 'humanWait']],
  ['in review', ['review', 'human']],
  ['in the merge queue', ['mergeWait']],
];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Binary min-heap of events keyed by (t, seq).
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  peek() { return this.a[0]; }
  push(e) {
    const a = this.a; a.push(e); let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (less(a[i], a[p])) { [a[i], a[p]] = [a[p], a[i]]; i = p; } else break;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && less(a[l], a[m])) m = l;
        if (r < a.length && less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top;
  }
}
const less = (x, y) => x.t < y.t || (x.t === y.t && x.s < y.s);

function zipfCdf(n, s) {
  const c = new Float64Array(n); let sum = 0;
  for (let i = 0; i < n; i++) { sum += 1 / Math.pow(i + 1, s); c[i] = sum; }
  for (let i = 0; i < n; i++) c[i] /= sum;
  return c;
}
function sampleCdf(c, u) {
  let lo = 0, hi = c.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (c[m] < u) lo = m + 1; else hi = m; }
  return lo;
}

export function createSim(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const pol = POLICIES[cfg.policy];
  if (!pol) throw new Error(`unknown policy ${cfg.policy}`);
  const rnd = mulberry32(cfg.seed >>> 0 || 1);
  const normal = () => {
    const u = 1 - rnd(), v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const logn = (med, sigma) => med * Math.exp(sigma * normal());

  const F = cfg.files, H = Math.min(cfg.hotFiles, F);
  const M = Math.max(1, Math.ceil((F - H) / cfg.filesPerModule));
  const moduleCdf = zipfCdf(M, 1.0);
  const inModuleCdf = zipfCdf(cfg.filesPerModule, 0.8);
  const reviewersPerRepo = Math.max(1, Math.round(cfg.agentsPerRepo * cfg.reviewersShare));

  const heap = new Heap();
  let seq = 0, t = 0, nextId = 1;
  const at = (dt, fn, task) => heap.push({ t: t + dt, s: seq++, fn, task });

  const repos = [];
  for (let r = 0; r < cfg.repos; r++) {
    repos.push({
      id: r,
      fileVer: new Int32Array(F),
      claim: new Int32Array(F).fill(-1),
      inFlight: r === 0 ? new Int32Array(F) : null,
      conflictT: r === 0 ? new Float64Array(F).fill(-1e9) : null,
      mergeT: r === 0 ? new Float64Array(F).fill(-1e9) : null,
      claimWait: [],
      reviewQ: [], reviewersFree: reviewersPerRepo,
      humanQ: [], humansFree: cfg.humansPerRepo,
      mq: [], mqHead: 0, mergeBusy: false,
      brokenUntil: -1, redFrom: 0, redDone: 0,
      merged: 0, conflicts: 0,
    });
  }

  const m = {
    merged: 0, conflicts: 0, autoMerged: 0, rebases: 0, redos: 0, breaks: 0,
    workS: 0, reworkS: 0, discardedS: 0, reviewS: 0, humanS: 0, claimWaitS: 0,
    cost: 0, created: 0, deferred: 0, caught: 0,
  };
  const stateCount = Object.create(null);
  const latencies = []; let latIdx = 0;
  const series = [];
  const live0 = new Map(); // repo 0 tasks, for following one
  let followId = -1;
  const followLog = [];

  function setState(task, s) {
    if (task.state) stateCount[task.state]--;
    task.state = s; task.since = t;
    stateCount[s] = (stateCount[s] || 0) + 1;
    if (task.id === followId) followLog.push([t, s]);
  }
  const note = (task, what) => { if (task.id === followId) followLog.push([t, what]); };

  function sampleFiles() {
    let k = 1; while (k < 8 && rnd() < 1 - 1 / cfg.meanTouches) k++;
    const set = new Set();
    const home = sampleCdf(moduleCdf, rnd());
    for (let i = 0; i < k; i++) {
      const mod = rnd() < 0.8 ? home : sampleCdf(moduleCdf, rnd());
      const j = sampleCdf(inModuleCdf, rnd());
      set.add(Math.min(F - 1, H + mod * cfg.filesPerModule + j));
    }
    if (H > 0 && rnd() < cfg.pHot) set.add(Math.floor(rnd() * rnd() * H));
    return Int32Array.from(set);
  }

  function newTask(repo, agent) {
    const task = {
      id: nextId++, repo, agent, files: sampleFiles(), base: null,
      workS: logn(cfg.workMedS, cfg.workSigma), created: t, state: null, since: t,
      risky: rnd() < cfg.pRisky, attempts: 0, claimed: false,
    };
    m.created++;
    if (repo.id === 0) live0.set(task.id, task);
    startOrWait(task);
  }

  const claimable = (task, f) => pol.claims === 'all' || (pol.claims === 'cold' && f >= H);
  function tryClaim(task) {
    if (pol.claims === 'none') return true;
    const c = task.repo.claim;
    for (const f of task.files) if (claimable(task, f) && c[f] !== -1 && c[f] !== task.id) return false;
    for (const f of task.files) if (claimable(task, f)) c[f] = task.id;
    task.claimed = true;
    return true;
  }
  function releaseClaims(task) {
    if (!task.claimed) return;
    const repo = task.repo, c = repo.claim;
    for (const f of task.files) if (c[f] === task.id) c[f] = -1;
    task.claimed = false;
    if (!repo.claimWait.length) return;
    const still = [];
    for (const w of repo.claimWait) {
      if (tryClaim(w)) { m.claimWaitS += t - w.since; beginWork(w, w.workS, 'work'); } else still.push(w);
    }
    repo.claimWait = still;
  }

  function startOrWait(task) {
    // pickFree: the agent leaves a task whose files are taken in the backlog and draws another.
    for (let i = 0; i < (pol.pickFree || 0) && !tryClaim(task); i++) { m.deferred++; task.files = sampleFiles(); }
    if (tryClaim(task)) beginWork(task, task.workS, 'work');
    else { setState(task, 'claimWait'); task.repo.claimWait.push(task); }
  }

  function snapBase(task) {
    const v = task.repo.fileVer;
    task.base = Int32Array.from(task.files, (f) => v[f]);
  }

  function beginWork(task, dur, kind) {
    if (kind !== 'fix') snapBase(task); // a fix after review keeps its base
    if (task.repo.inFlight && kind === 'work') for (const f of task.files) task.repo.inFlight[f]++;
    setState(task, kind);
    task.curDur = dur; task.curKind = kind;
    at(dur, workDone, task);
  }

  function workDone(task) {
    if (task.curKind === 'work') m.workS += task.curDur; else m.reworkS += task.curDur;
    task.attempts++;
    setState(task, 'reviewWait');
    task.repo.reviewQ.push(task);
    pumpReview(task.repo);
  }

  function pumpReview(repo) {
    while (repo.reviewersFree > 0 && repo.reviewQ.length) {
      const task = repo.reviewQ.shift();
      repo.reviewersFree--;
      if (pol.humanReview === 'all') {
        // Classic: no reviewer agent, a person reads every diff.
        repo.reviewersFree++;
        toHuman(task, cfg.humanFullMedS);
        continue;
      }
      const d = logn(cfg.reviewMedS, cfg.reviewSigma) * (task.lightReview ? cfg.redoReviewFactor : 1);
      task.curDur = d;
      setState(task, 'review');
      at(d, reviewDone, task);
    }
  }

  function reviewDone(task) {
    const repo = task.repo;
    m.reviewS += task.curDur;
    repo.reviewersFree++;
    if (rnd() > cfg.pApprove) {
      note(task, 'changes asked');
      beginWork(task, task.workS * cfg.fixFactor, 'fix');
    } else if (task.risky) {
      toHuman(task, cfg.humanQuickMedS);
    } else toMerge(task);
    pumpReview(repo);
  }

  function toHuman(task, med) {
    task.humanMed = med;
    setState(task, 'humanWait');
    task.repo.humanQ.push(task);
    pumpHuman(task.repo);
  }
  function pumpHuman(repo) {
    while (repo.humansFree > 0 && repo.humanQ.length) {
      const task = repo.humanQ.shift();
      repo.humansFree--;
      const d = logn(task.humanMed, 0.5);
      m.humanS += d;
      setState(task, 'human');
      at(d, humanDone, task);
    }
  }
  function humanDone(task) {
    task.repo.humansFree++;
    if (pol.humanReview === 'all' && rnd() > cfg.pApprove) {
      note(task, 'changes asked');
      beginWork(task, task.workS * cfg.fixFactor, 'fix');
    } else toMerge(task);
    pumpHuman(task.repo);
  }

  function toMerge(task) {
    setState(task, 'mergeWait');
    task.repo.mq.push(task);
    pumpMerge(task.repo);
  }

  function pumpMerge(repo) {
    if (repo.mergeBusy || repo.mqHead >= repo.mq.length) return;
    if (repo.brokenUntil > t) return; // main is red: the queue waits for the fix
    const n = Math.min(pol.batch, repo.mq.length - repo.mqHead);
    const batch = repo.mq.slice(repo.mqHead, repo.mqHead + n);
    repo.mqHead += n;
    if (repo.mqHead > 4096 && repo.mqHead * 2 > repo.mq.length) { repo.mq = repo.mq.slice(repo.mqHead); repo.mqHead = 0; }
    repo.mergeBusy = true;
    at(cfg.mergeS + cfg.mergePerChangeS * n + (pol.trainTest ? cfg.trainTestS : 0), mergeDone, { repo, batch });
  }

  function mergeDone({ repo, batch }) {
    repo.mergeBusy = false;
    for (const task of batch) {
      const v = repo.fileVer;
      let conflicting = 0, clean = true;
      for (let i = 0; i < task.files.length; i++) {
        const f = task.files[i];
        if (v[f] !== task.base[i]) {
          conflicting++;
          if (repo.conflictT) repo.conflictT[f] = t;
          if (rnd() > (f < H ? cfg.pCleanHot : cfg.pCleanCold)) clean = false;
        }
      }
      if (conflicting && !clean) {
        m.conflicts++; repo.conflicts++;
        note(task, `conflict on ${conflicting} file${conflicting > 1 ? 's' : ''}`);
        if (pol.onConflict === 'redo') {
          m.redos++; m.discardedS += task.workS;
          task.lightReview = true;
          beginWork(task, task.workS * cfg.redoFactor, 'rework');
        } else {
          m.rebases++;
          beginWork(task, task.workS * cfg.rebaseFactor, 'rework');
        }
        continue;
      }
      if (conflicting) { m.autoMerged++; note(task, 'git merged it'); }
      const breaks = rnd() < cfg.pBreak;
      if (breaks && pol.trainTest && rnd() < cfg.pTestCatches) {
        m.caught++;
        note(task, 'train tests failed: back to fix');
        beginWork(task, task.workS * cfg.fixFactor, 'fix');
        continue;
      }
      merge(task, breaks);
    }
    pumpMerge(repo);
  }

  function merge(task, breaks) {
    const repo = task.repo;
    for (const f of task.files) {
      repo.fileVer[f]++;
      if (repo.inFlight) { repo.inFlight[f]--; repo.mergeT[f] = t; }
    }
    m.merged++; repo.merged++;
    const lat = t - task.created;
    if (latencies.length < cfg.latencyWindow) latencies.push(lat); else latencies[latIdx++ % cfg.latencyWindow] = lat;
    setState(task, 'merged');
    stateCount.merged--;
    if (repo.id === 0) live0.delete(task.id);
    releaseClaims(task);
    if (breaks) {
      m.breaks++;
      note(task, 'broke main');
      const d = logn(cfg.fixMainMedS, 0.5);
      if (repo.brokenUntil > t) repo.brokenUntil += d;
      else { repo.redDone += Math.max(0, repo.brokenUntil - repo.redFrom); repo.redFrom = t; repo.brokenUntil = t + d; }
      at(repo.brokenUntil - t + 0.001, () => pumpMerge(repo));
    }
    newTask(repo, task.agent); // the agent picks up the next task
  }

  // Agents boot, then each takes a task.
  for (const repo of repos) {
    for (let a = 0; a < cfg.agentsPerRepo; a++) {
      const boot = logn(cfg.bootS, 0.3) + rnd() * 30;
      const ph = { id: -1, state: null, repo };
      setState(ph, 'boot');
      at(boot, () => { stateCount.boot--; newTask(repo, a); });
    }
  }

  const totalAgents = cfg.repos * cfg.agentsPerRepo;
  const reviewerAgents = cfg.repos * reviewersPerRepo;
  let lastSample = -Infinity, events = 0;

  function sample() {
    let mq = 0, red = 0;
    for (const r of repos) { mq += r.mq.length - r.mqHead; if (r.brokenUntil > t) red++; }
    const busy = ['work', 'fix', 'rework', 'review'].reduce((s, k) => s + (stateCount[k] || 0), 0);
    series.push({
      t, merged: m.merged, conflicts: m.conflicts, created: m.created,
      working: (stateCount.work || 0) + (stateCount.fix || 0) + (stateCount.rework || 0),
      claimWait: stateCount.claimWait || 0,
      reviewWait: stateCount.reviewWait || 0,
      humanWait: stateCount.humanWait || 0,
      mergeWait: mq, redRepos: red, busy, cost: costNow(),
    });
  }
  // Agents' thinking time so far plus every box awake.
  const costNow = () => (m.workS + m.reworkS + m.reviewS) * cfg.llmPerS + (totalAgents + reviewerAgents) * t * cfg.boxPerS;

  function runUntil(tEnd, maxEvents = Infinity) {
    let n = 0;
    while (heap.size && heap.peek().t <= tEnd && n < maxEvents) {
      const e = heap.pop();
      t = e.t; e.fn(e.task); n++;
      if (t - lastSample >= cfg.sampleEveryS) { lastSample = t; sample(); }
    }
    if (n < maxEvents) t = Math.max(t, tEnd);
    events += n;
    m.cost = costNow();
    return n;
  }

  function pct(p) {
    if (!latencies.length) return null;
    const s = Float64Array.from(latencies).sort();
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
  }

  function follow() {
    const working = [...live0.values()].filter((x) => WORKING.has(x.state));
    const pool = working.length ? working : [...live0.values()];
    if (!pool.length) return null;
    const task = pool[Math.floor(rnd() * pool.length)];
    followId = task.id; followLog.length = 0;
    followLog.push([task.created, 'asked'], [t, task.state]);
    return task.id;
  }

  function snapshot({ files = true } = {}) {
    const r0 = repos[0];
    const groups = STATE_GROUPS.map(([label, keys]) => [label, keys.reduce((s, k) => s + (stateCount[k] || 0), 0)]);
    let mq = 0, red = 0;
    const repoStrip = new Float32Array(Math.min(cfg.repos, 1000) * 2);
    for (let i = 0; i < repos.length; i++) {
      const r = repos[i]; const q = r.mq.length - r.mqHead;
      mq += q; if (r.brokenUntil > t) red++;
      if (i < 1000) { repoStrip[i * 2] = q; repoStrip[i * 2 + 1] = r.brokenUntil > t ? 1 : 0; }
    }
    const followed = followId > 0 ? live0.get(followId) : null;
    return {
      t, events, totalAgents, reviewerAgents, policy: cfg.policy,
      groups, metrics: { ...m }, mergeWait: mq, redRepos: red,
      p50: pct(0.5), p90: pct(0.9),
      redShare: repos.reduce((s, r) => s + r.redDone + Math.max(0, Math.min(t, r.brokenUntil) - r.redFrom), 0) / Math.max(1, t * repos.length),
      files: files ? {
        n: F, hot: H, perModule: cfg.filesPerModule,
        inFlight: Int32Array.from(r0.inFlight),
        conflictAge: Float32Array.from(r0.conflictT, (x) => t - x),
        mergeAge: Float32Array.from(r0.mergeT, (x) => t - x),
        claimed: Uint8Array.from(r0.claim, (x) => (x === -1 ? 0 : 1)),
      } : null,
      repoStrip,
      follow: followId > 0 ? {
        id: followId, done: !followed, log: followLog.slice(),
        files: followed ? Array.from(followed.files) : null,
      } : null,
    };
  }

  return {
    cfg, pol,
    get t() { return t; },
    runUntil, snapshot, follow, series, metrics: m,
  };
}

// Run one policy headless and return a summary (used by the CLI and the compare view).
export function runHeadless(opts, hours) {
  const sim = createSim(opts);
  sim.runUntil(hours * 3600);
  const s = sim.snapshot({ files: false });
  return { snapshot: s, series: sim.series, cfg: sim.cfg };
}
