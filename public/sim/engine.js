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
  leads: {
    label: 'Team leads',
    about: 'Everything in claims + redo + trains, plus an area lead per group of agents: an author and reviewer who disagree get one round, then the lead decides; a conflict goes to the lead, who knows both intents and merges them, and only a failed merge is redone.',
    humanReview: 'risky', claims: 'cold', onConflict: 'lead', batch: 16, pickFree: 8, trainTest: true, leads: true,
  },
  intents: {
    label: 'Land by intent',
    about: 'Team leads, plus: the merge queue lands intents, not text. When git reports a conflict, the queue replays the reviewed change on the current main and the train tests it; only a replay that fails goes to the lead. (In the real-code run, 972 of 976 conflicts replayed cleanly.)',
    humanReview: 'risky', claims: 'cold', onConflict: 'lead', batch: 16, pickFree: 8, trainTest: true, leads: true, replay: true,
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
  // Chance git merges a conflicting file by itself. Hot files were 0.8 until the real-code run
  // (sim/real) showed two appends to the same list (routes, schema, deps) conflict nearly always.
  pCleanCold: 0.35, pCleanHot: 0.2,
  rebaseFactor: 0.5, redoFactor: 0.6, redoReviewFactor: 0.5,
  pBreak: 0.003, fixMainMedS: 600, // a change that breaks main once merged with the others
  trainTestS: 60, pTestCatches: 0.9, // a tested train bounces a breaking change instead of landing it
  llmPerS: 0.0043, // $/s of an agent thinking (≈ $1.42 per change at Sonnet API prices)
  boxPerS: 0.05 / (1.43 * 3600), // container $/s
  // Disagreements: when a review asks for changes, sometimes the author pushes back.
  pDispute: 0.3, disputeRounds: 2.5, // without a lead: rounds of arguing (mean), then a coin flip
  argueFactor: 0.15, // agent time per round, as a share of the task's work
  leadSpan: 25, // agents per area lead
  leadDecideMedS: 60, leadMergeMedS: 90, pLeadMerge: 0.75,
  pReplay: 0.95, // land by intent: share of conflicts the queue replays on main by itself (real-code run: 972/976)
  sampleEveryS: 60,
  latencyWindow: 3000,
  moduleZipf: 1.0, // how unevenly changes fall on the code's areas (1 = a few hot areas, 0 = even)
  // Lanes (L1, docs/board/sim.md (i)). 0 = off: one merge queue per repo, as before. With N lanes the code is cut
  // into N areas (whole modules, balanced by how often they change), each with its own merge queue, its own hot
  // files (package.json, routes... designed per area) and its own red/green main. A change whose files span
  // areas (crossShare of them) cannot land in either lane: it goes to the coordinated lane, which waits until
  // every lane it touches is idle, holds them, lands with a bigger test (coordTestFactor), then lets them go.
  // coord 'one' = one coordinated queue, trains of up to coordBatch changes over at most coordMaxLanes lanes;
  // 'locks' = cross changes with disjoint lanes land at once, FIFO per lane (a waiting one blocks later ones).
  lanes: 0, crossShare: 0, coord: 'one', coordBatch: 4, coordMaxLanes: 8, coordTestFactor: 1.5,
  // A throughput controller per lane (and one for the coordinated lane): a lane takes new tasks only under its cap;
  // the cap grows while landings/min rise (W8's probe, steps of max(step, grow x cap)), backs off when they fall,
  // halves on redos > drop x cap per min. ctlPick false (honest default): an agent whose task's lane is full parks
  // WITH that task until the lane has room (the work mix never changes; a parked agent costs no box). true: it
  // draws up to 8 other tasks first, an upper bound valid only while the backlog has work in other lanes.
  laneCtl: false, ctlPick: false,
  // Windows longer than one change's ask-to-land (~8-10 min here; W8's 4 min suited 26 s tasks): with 4-min windows
  // the added agents never showed up in landings and the cap collapsed (1 lane, 1,000 agents: 125/h vs 728 fixed).
  ctl: { start: 8, step: 2, grow: 0.5, min: 1, tickS: 30, evalS: 900, windowS: 900, eff: 0.1, holdS: 900, fall: 0.25, drop: 1 },
};

const WORKING = new Set(['work', 'fix', 'rework']);
export const STATE_GROUPS = [
  ['starting', ['boot']],
  ['waiting for a claim', ['claimWait']],
  ['working', ['work', 'fix', 'rework']],
  ['waiting for review', ['reviewWait', 'humanWait']],
  ['in review', ['review', 'human']],
  ['arguing', ['dispute']],
  ['with a lead', ['leadWait', 'lead']],
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
  if (!POLICIES[cfg.policy]) throw new Error(`unknown policy ${cfg.policy}`);
  const pol = cfg.policyOverride ? { ...POLICIES[cfg.policy], ...cfg.policyOverride } : POLICIES[cfg.policy];
  const rnd = mulberry32(cfg.seed >>> 0 || 1);
  const normal = () => {
    const u = 1 - rnd(), v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const logn = (med, sigma) => med * Math.exp(sigma * normal());

  const F = cfg.files, H0 = Math.min(cfg.hotFiles, F);
  const L = cfg.lanes > 0 ? Math.floor(cfg.lanes) : 0;
  const H = L ? H0 * L : H0; // with lanes, each area has its own hot files
  const M = Math.max(1, Math.ceil((F - H0) / cfg.filesPerModule));
  const FT = L ? H + M * cfg.filesPerModule : F;
  const moduleCdf = zipfCdf(M, cfg.moduleZipf);
  // Modules to lanes: heaviest first onto the least-loaded lane (areas drawn by how often they change).
  const laneOfMod = L ? new Int32Array(M) : null;
  if (L) {
    const load = new Float64Array(L);
    for (let i = 0; i < M; i++) {
      let b = 0; for (let l = 1; l < L; l++) if (load[l] < load[b]) b = l;
      laneOfMod[i] = b; load[b] += moduleCdf[i] - (i ? moduleCdf[i - 1] : 0);
    }
  }
  const laneOfFile = (f) => (f < H ? Math.floor(f / H0) : laneOfMod[Math.floor((f - H) / cfg.filesPerModule)]);
  const inModuleCdf = zipfCdf(cfg.filesPerModule, 0.8);
  const reviewersPerRepo = Math.max(1, Math.round(cfg.agentsPerRepo * cfg.reviewersShare));
  const leadsPerRepo = pol.leads ? Math.max(1, Math.ceil(cfg.agentsPerRepo / cfg.leadSpan)) : 0;

  const heap = new Heap();
  let seq = 0, t = 0, nextId = 1;
  const at = (dt, fn, task) => heap.push({ t: t + dt, s: seq++, fn, task });

  const repos = [];
  for (let r = 0; r < cfg.repos; r++) {
    repos.push({
      id: r,
      fileVer: new Int32Array(FT),
      claim: new Int32Array(FT).fill(-1),
      inFlight: r === 0 ? new Int32Array(FT) : null,
      conflictT: r === 0 ? new Float64Array(FT).fill(-1e9) : null,
      mergeT: r === 0 ? new Float64Array(FT).fill(-1e9) : null,
      claimWait: [],
      reviewQ: [], reviewersFree: reviewersPerRepo,
      humanQ: [], humansFree: cfg.humansPerRepo,
      leads: Array.from({ length: leadsPerRepo }, () => ({ busy: false, q: [], qHead: 0, busyS: 0 })),
      mq: [], mqHead: 0, mergeBusy: false,
      brokenUntil: -1, redFrom: 0, redDone: 0,
      merged: 0, conflicts: 0,
    });
  }

  const m = {
    merged: 0, conflicts: 0, autoMerged: 0, rebases: 0, redos: 0, breaks: 0,
    workS: 0, reworkS: 0, discardedS: 0, reviewS: 0, humanS: 0, claimWaitS: 0,
    cost: 0, created: 0, deferred: 0, caught: 0,
    disputes: 0, disputeS: 0, leadCalls: 0, leadS: 0, leadMerged: 0,
  };
  // Lanes: one unit per lane plus the coordinated lane; each counts its tasks in flight against its cap.
  const ctlOn = !!(L && cfg.laneCtl), C = { ...DEFAULTS.ctl, ...(cfg.ctl || {}) };
  const mkUnit = (id) => ({ id, q: [], head: 0, busy: false, locked: false, brokenUntil: -1, redFrom: 0, redDone: 0,
    merged: 0, inflight: 0, cap: ctlOn ? C.start : Infinity, parked: [], landT: [], landHead: 0, dropT: [], dropHead: 0, state: 'warm', since: 0, ref: 0, capMax: 0 });
  const lanes = L ? Array.from({ length: L }, (_, i) => mkUnit(i)) : [];
  const coord = L ? { ...mkUnit(-1), busyN: 0, wants: new Set() } : null;
  const units = L ? [...lanes, coord] : [];
  const parked = []; let parkedS = 0, parkedN = 0;
  const lanesOfFiles = (files) => { const ls = []; for (const f of files) { const l = laneOfFile(f); if (!ls.includes(l)) ls.push(l); } return ls; };
  const unitOfFiles = (files) => { const ls = lanesOfFiles(files); return ls.length > 1 ? coord : lanes[ls[0]]; };
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

  let lastHome = 0;
  function sampleFiles() {
    if (L) return sampleLaneFiles();
    let k = 1; while (k < 8 && rnd() < 1 - 1 / cfg.meanTouches) k++;
    const set = new Set();
    const home = sampleCdf(moduleCdf, rnd());
    lastHome = home;
    for (let i = 0; i < k; i++) {
      const mod = rnd() < 0.8 ? home : sampleCdf(moduleCdf, rnd());
      const j = sampleCdf(inModuleCdf, rnd());
      set.add(Math.min(F - 1, H + mod * cfg.filesPerModule + j));
    }
    if (H > 0 && rnd() < cfg.pHot) set.add(Math.floor(rnd() * rnd() * H));
    return Int32Array.from(set);
  }

  // With lanes: a task stays in its home lane (other modules it touches are drawn from the same lane) unless it
  // is one of crossShare, which also touches a module in another lane.
  function sampleLaneFiles() {
    let k = 1; while (k < 8 && rnd() < 1 - 1 / cfg.meanTouches) k++;
    const home = sampleCdf(moduleCdf, rnd()); lastHome = home;
    const hl = laneOfMod[home];
    let other = -1;
    if (L > 1 && rnd() < cfg.crossShare) {
      for (let i = 0; i < 50 && other < 0; i++) { const m2 = sampleCdf(moduleCdf, rnd()); if (laneOfMod[m2] !== hl) other = m2; }
      if (other >= 0) k = Math.max(k, 2);
    }
    const set = new Set();
    for (let i = 0; i < k; i++) {
      let mod = home;
      if (other >= 0 && i === k - 1) mod = other;
      else if (rnd() >= 0.8) for (let j = 0; j < 20; j++) { const m2 = sampleCdf(moduleCdf, rnd()); if (laneOfMod[m2] === hl) { mod = m2; break; } }
      set.add(Math.min(FT - 1, H + mod * cfg.filesPerModule + sampleCdf(inModuleCdf, rnd())));
    }
    if (H0 > 0 && rnd() < cfg.pHot) set.add(hl * H0 + Math.floor(rnd() * rnd() * H0));
    return Int32Array.from(set);
  }

  // With a controller, an agent draws up to 8 tasks for one whose lane is under its cap, else it parks.
  function newLaneTask(repo, agent, held) {
    let files = held ? held.files : sampleFiles(), home = held ? held.home : lastHome, u = unitOfFiles(files);
    if (cfg.ctlPick) for (let i = 0; i < 8 && u.inflight >= u.cap; i++) { files = sampleFiles(); home = lastHome; u = unitOfFiles(files); }
    if (u.inflight >= u.cap) { (cfg.ctlPick ? parked : u.parked).push({ repo, agent, files, home }); parkedN++; return; }
    const task = {
      id: nextId++, repo, agent, files, home, base: null, unit: u,
      workS: logn(cfg.workMedS, cfg.workSigma), created: t, state: null, since: t,
      risky: rnd() < cfg.pRisky, attempts: 0, claimed: false,
    };
    u.inflight++;
    m.created++;
    if (repo.id === 0) live0.set(task.id, task);
    startOrWait(task);
  }
  // Wake up to n parked agents (a slot freed or a cap rose in unit u); one that finds nothing parks again.
  function wake(n, u) {
    const q = cfg.ctlPick ? parked : u.parked;
    for (let i = 0; i < n && q.length; i++) { const p = q.shift(); parkedN--; newLaneTask(p.repo, p.agent, cfg.ctlPick ? null : p); }
  }

  function newTask(repo, agent) {
    if (L) return newLaneTask(repo, agent);
    const task = {
      id: nextId++, repo, agent, files: sampleFiles(), home: lastHome, base: null,
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
    for (let i = 0; i < (pol.pickFree || 0) && !tryClaim(task); i++) { m.deferred++; task.files = sampleFiles(); task.home = lastHome; }
    if (task.unit) { const u = unitOfFiles(task.files); if (u !== task.unit) { task.unit.inflight--; u.inflight++; task.unit = u; } }
    if (tryClaim(task)) beginWork(task, task.workS, 'work');
    else { setState(task, 'claimWait'); task.repo.claimWait.push(task); }
  }

  function snapBase(task) {
    const v = task.repo.fileVer;
    task.base = Int32Array.from(task.files, (f) => v[f]);
  }

  function beginWork(task, dur, kind) {
    if (kind === 'rework' && task.unit) task.unit.dropT.push(t);
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
      if (rnd() < cfg.pDispute) dispute(task);
      else beginWork(task, task.workS * cfg.fixFactor, 'fix');
    } else afterApproval(task);
    pumpReview(repo);
  }
  const afterApproval = (task) => (task.risky ? toHuman(task, cfg.humanQuickMedS) : toMerge(task));

  // The author disagrees with the review. Without a lead they argue for a few rounds
  // and then one side gives in; with a lead, one round and the lead decides.
  function dispute(task) {
    m.disputes++;
    note(task, 'author disagrees');
    const round = task.workS * cfg.argueFactor + logn(cfg.reviewMedS, cfg.reviewSigma) * 0.5;
    let rounds = 1;
    if (!pol.leads) while (rnd() < 1 - 1 / cfg.disputeRounds) rounds++;
    const d = round * rounds;
    m.disputeS += d;
    setState(task, 'dispute');
    at(d, () => {
      m.reworkS += d;
      if (pol.leads) return toLead(task, 'decide');
      note(task, `${rounds} round${rounds > 1 ? 's' : ''} of arguing`);
      if (rnd() < 0.5) afterApproval(task); else beginWork(task, task.workS * cfg.fixFactor, 'fix');
    }, task);
  }

  // Area leads: one per leadSpan agents, picked by the task's home folder. One thing at a time.
  function toLead(task, why) {
    const lead = task.repo.leads[task.home % task.repo.leads.length];
    task.leadWhy = why;
    setState(task, 'leadWait');
    lead.q.push(task);
    pumpLead(lead);
  }
  function pumpLead(lead) {
    if (lead.busy || lead.qHead >= lead.q.length) return;
    const task = lead.q[lead.qHead++];
    if (lead.qHead > 1024 && lead.qHead * 2 > lead.q.length) { lead.q = lead.q.slice(lead.qHead); lead.qHead = 0; }
    lead.busy = true;
    const d = logn(task.leadWhy === 'merge' ? cfg.leadMergeMedS : cfg.leadDecideMedS, 0.5);
    m.leadCalls++; m.leadS += d; lead.busyS += d;
    setState(task, 'lead');
    at(d, () => { lead.busy = false; leadDone(task); pumpLead(lead); }, task);
  }
  function leadDone(task) {
    if (task.leadWhy === 'decide') {
      if (rnd() < 0.5) { note(task, 'lead sided with the author'); afterApproval(task); }
      else { note(task, 'lead sided with the reviewer'); beginWork(task, task.workS * cfg.fixFactor, 'fix'); }
      return;
    }
    // A conflict: the lead knows both intents and merges them onto the new main.
    if (rnd() < cfg.pLeadMerge) {
      m.leadMerged++;
      note(task, 'lead merged both changes');
      snapBase(task);
      toMerge(task);
    } else {
      note(task, 'lead could not merge: redo');
      m.redos++; m.discardedS += task.workS;
      task.lightReview = true;
      beginWork(task, task.workS * cfg.redoFactor, 'rework');
    }
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
    if (L) {
      task.ls = lanesOfFiles(task.files);
      if (task.ls.length > 1) { coord.q.push(task); pumpCoord(); } else { const ln = lanes[task.ls[0]]; ln.q.push(task); pumpLane(ln); }
      return;
    }
    task.repo.mq.push(task);
    pumpMerge(task.repo);
  }

  // A lane's own queue: trains as in pumpMerge, but it waits while the coordinated lane wants it.
  function pumpLane(ln) {
    if (ln.busy || ln.locked || ln.head >= ln.q.length || ln.brokenUntil > t || coord.wants.has(ln.id)) return;
    const n = Math.min(pol.batch, ln.q.length - ln.head);
    const batch = ln.q.slice(ln.head, ln.head + n);
    ln.head += n;
    if (ln.head > 4096 && ln.head * 2 > ln.q.length) { ln.q = ln.q.slice(ln.head); ln.head = 0; }
    ln.busy = true;
    at(cfg.mergeS + cfg.mergePerChangeS * n + (pol.trainTest ? cfg.trainTestS : 0), () => {
      ln.busy = false; landBatch(repos[0], batch); pumpCoord(); pumpLane(ln);
    });
  }
  const laneFree = (l) => { const ln = lanes[l]; return !ln.busy && !ln.locked && ln.brokenUntil <= t; };
  // The coordinated lane. Ordering: a cross change lands only with every lane it touches idle and held.
  function pumpCoord() {
    if (!coord) return;
    while (coord.head < coord.q.length && coord.q[coord.head].started) coord.head++;
    if (coord.head > 4096 && coord.head * 2 > coord.q.length) { coord.q = coord.q.slice(coord.head); coord.head = 0; }
    coord.wants = new Set();
    if (coord.head >= coord.q.length) return;
    if (cfg.coord === 'locks') {
      const reserved = new Set();
      for (let i = coord.head, seen = 0; i < coord.q.length && seen < 64; i++) {
        const task = coord.q[i];
        if (task.started) continue;
        seen++;
        if (task.ls.every((l) => laneFree(l) && !reserved.has(l))) startCoord([task], task.ls);
        else for (const l of task.ls) reserved.add(l);
      }
      coord.wants = reserved;
      return;
    }
    if (coord.busyN) return;
    const batch = [], union = new Set();
    for (let i = coord.head; i < coord.q.length && batch.length < cfg.coordBatch; i++) {
      const task = coord.q[i];
      const next = new Set([...union, ...task.ls]);
      if (batch.length && next.size > cfg.coordMaxLanes) break;
      batch.push(task); for (const l of task.ls) union.add(l);
    }
    coord.wants = union;
    if ([...union].every(laneFree)) startCoord(batch, [...union]);
  }
  function startCoord(batch, ls) {
    for (const task of batch) task.started = true;
    for (const l of ls) lanes[l].locked = true;
    coord.busyN++;
    at(cfg.mergeS + cfg.mergePerChangeS * batch.length + (pol.trainTest ? cfg.trainTestS * cfg.coordTestFactor : 0), () => {
      coord.busyN--;
      for (const l of ls) lanes[l].locked = false;
      landBatch(repos[0], batch);
      pumpCoord();
      for (const l of ls) pumpLane(lanes[l]);
    });
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
    landBatch(repo, batch);
    pumpMerge(repo);
  }

  function landBatch(repo, batch) {
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
      if (conflicting && !clean && pol.replay && rnd() < cfg.pReplay) {
        m.conflicts++; repo.conflicts++; m.replayed = (m.replayed || 0) + 1;
        note(task, 'replayed on main: no text merge');
        clean = true;
      }
      if (conflicting && !clean) {
        m.conflicts++; repo.conflicts++;
        note(task, `conflict on ${conflicting} file${conflicting > 1 ? 's' : ''}`);
        if (pol.onConflict === 'lead') {
          toLead(task, 'merge');
        } else if (pol.onConflict === 'redo') {
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
    if (L) {
      const u = task.unit; u.inflight--; u.merged++; u.landT.push(t);
      for (const l of task.ls) {
        const ln = lanes[l];
        if (ln !== u) ln.merged++;
        if (!breaks) continue;
        const d = logn(cfg.fixMainMedS, 0.5);
        if (ln.brokenUntil > t) ln.brokenUntil += d;
        else { ln.redDone += Math.max(0, ln.brokenUntil - ln.redFrom); ln.redFrom = t; ln.brokenUntil = t + d; }
        at(ln.brokenUntil - t + 0.001, () => { pumpCoord(); pumpLane(ln); });
      }
      if (breaks) { m.breaks++; note(task, 'broke main'); }
      newTask(repo, task.agent);
      if (ctlOn) wake(1, u);
      return;
    }
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

  // W8's probe per unit, on that unit's landings.
  function ctlUnit(u) {
    const W = C.windowS;
    while (u.landHead < u.landT.length && u.landT[u.landHead] <= t - 2 * W) u.landHead++;
    while (u.dropHead < u.dropT.length && u.dropT[u.dropHead] <= t - 60) u.dropHead++;
    if (u.landHead > 1024) { u.landT = u.landT.slice(u.landHead); u.landHead = 0; }
    if (u.dropHead > 1024) { u.dropT = u.dropT.slice(u.dropHead); u.dropHead = 0; }
    let n = 0; for (let i = u.landHead; i < u.landT.length; i++) if (u.landT[i] > t - W) n++;
    const now = (n * 60) / W, before = u.cap;
    const st = Math.max(C.step, Math.round(u.cap * C.grow));
    const dropsPerMin = u.dropT.length - u.dropHead;
    if (dropsPerMin > C.drop * u.cap && u.cap > C.min) { u.cap = Math.max(C.min, Math.floor(u.cap / 2)); u.state = 'hold'; u.since = t; u.ref = now; }
    else if (u.state === 'warm' && t - u.since >= C.evalS) { u.ref = now; u.cap += st; u.state = 'eval'; u.since = t; u.lastStep = st; }
    else if (u.state === 'eval' && t - u.since >= C.evalS) {
      const s0 = u.lastStep || st, b = u.cap - s0;
      if (now >= u.ref * (1 + (C.eff * s0) / Math.max(1, b))) { u.ref = now; u.cap += st; u.since = t; u.lastStep = st; }
      else { u.cap = Math.max(C.min, u.cap - s0); u.state = 'hold'; u.since = t; u.ref = now; }
    } else if (u.state === 'hold') {
      if (u.ref > 0 && now < u.ref * (1 - C.fall)) { u.cap = Math.max(C.min, u.cap - 1); u.ref = now; u.since = t; }
      else if (t - u.since >= C.holdS) { u.ref = now; u.cap += st; u.state = 'eval'; u.since = t; u.lastStep = st; }
    }
    u.cap = Math.min(u.cap, totalAgents); // a cap above the agents there are means nothing (and grows forever)
    u.capMax = Math.max(u.capMax, u.cap);
    return Math.max(0, u.cap - before);
  }
  if (ctlOn) {
    const tick = () => { for (const u of units) { const up = ctlUnit(u); if (up) wake(up, u); } at(C.tickS, tick); };
    at(C.tickS, tick);
  }

  const totalAgents = cfg.repos * cfg.agentsPerRepo;
  const reviewerAgents = cfg.repos * reviewersPerRepo;
  const leadAgents = cfg.repos * leadsPerRepo;
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
  const costNow = () => (m.workS + m.reworkS + m.reviewS + m.leadS) * cfg.llmPerS + ((totalAgents + reviewerAgents + leadAgents) * t - parkedS) * cfg.boxPerS;

  function runUntil(tEnd, maxEvents = Infinity) {
    let n = 0;
    while (heap.size && heap.peek().t <= tEnd && n < maxEvents) {
      const e = heap.pop();
      if (parkedN) parkedS += parkedN * (e.t - t);
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
      t, events, totalAgents, reviewerAgents, leadAgents, policy: cfg.policy,
      leadBusy: leadAgents ? repos.reduce((s, r) => s + r.leads.reduce((a, l) => a + l.busyS, 0), 0) / Math.max(1, t * leadAgents) : null,
      groups, metrics: { ...m }, mergeWait: mq, redRepos: red,
      p50: pct(0.5), p90: pct(0.9),
      lanes: L ? {
        n: L, parked: parkedN, awakeShare: 1 - parkedS / Math.max(1, t * totalAgents),
        red: lanes.reduce((s, r) => s + r.redDone + Math.max(0, Math.min(t, r.brokenUntil) - r.redFrom), 0) / Math.max(1, t * L),
        coordQueue: coord.q.length - coord.head, coordLanded: coord.merged, maxLaneQueue: Math.max(...lanes.map((x) => x.q.length - x.head)),
        caps: ctlOn ? units.map((u) => u.cap) : null, coordCap: ctlOn ? coord.cap : null,
        inflight: units.reduce((s, u) => s + u.inflight, 0),
      } : null,
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
