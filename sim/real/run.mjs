#!/usr/bin/env node
// Real-code sim: N scripted agents change a real generated project in a real git repo.
// Virtual clock (same timing model as the fast sim), real commits, real `git merge`
// conflicts, real tests on the merged tree. No model calls.
//
//   node sim/real/run.mjs --policy leads --agents 500 --hours 2
//   node sim/real/run.mjs --all --agents 500 --hours 2      (every policy, same seed)
// Writes the git repo to sim/real/out/<name>.git and the run bundle the UI reads to
// public/sim/runs/<name>.json (+ public/sim/runs/index.json).
import { rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS } from '../../public/sim/engine.js';
import { generate, randomOp, check, lineDiff, isHot, resetNames } from './project.mjs';
import { openRepo } from './git.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNS = join(HERE, '../../public/sim/runs');

export const REAL_POLICIES = {
  agentReview: {
    label: 'Agent review',
    about: 'Reviewer agents, no claims; merges one at a time; a conflict means redo on the new main; tests run on each change alone, so a clean merge can still break main.',
    claims: false, onConflict: 'redo', batch: 1, trainTest: false,
  },
  hybrid: {
    label: 'Claims + redo + trains',
    about: 'Claims on ordinary files (routes, schema and package.json stay open), pick another task when files are taken, redo on conflict, trains of up to 16 tested on the merged result.',
    claims: true, pickFree: 8, onConflict: 'redo', batch: 16, trainTest: true,
  },
  leads: {
    label: 'Team leads',
    about: 'As claims + redo + trains, plus area leads: a disputed review gets one round, then the lead decides; a conflict or failed test goes to the lead, who replays the change\'s intent on the new main.',
    claims: true, pickFree: 8, onConflict: 'lead', batch: 16, trainTest: true, leads: true,
  },
  intents: {
    label: 'Land by intent',
    about: 'As team leads, but the merge queue lands intents, not text: when git reports a conflict or the train tests fail, the queue replays the reviewed change on the current main and tests it again; only a replay that cannot apply or still fails goes to the lead.',
    claims: true, pickFree: 8, onConflict: 'lead', batch: 16, trainTest: true, leads: true, replayOnLand: true,
  },
};

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function runReal(opts) {
  // Lanes (L2, docs/board/TASKS.md; the same rules as qb4's L1 in public/sim/engine.js): `lanes` > 1
  // cuts the code into areas (folders m % lanes, plus the root files as one more area), each with its
  // own merge queue whose train tests only its area. A change whose files span areas goes to the
  // coordinated lane: trains of up to coordBatch over at most coordMaxLanes areas, which wait until
  // those lanes are idle, hold them, and test the whole repo (coordTestFactor x). Every train goes
  // through one door onto main (a git merge + ref update, doorS, one at a time); then main's full
  // tests run (main CI): a cross-area break found there reverts the train and stops every lane.
  // `controller`: W8's probe per lane (and for the coordinated lane): a cap on agents working there,
  // probed up in steps while landings rise, backed off when they fall or redos pile up. An agent
  // whose task falls in a full lane parks WITH that task (ctlPick false, L1's honest default) or
  // draws up to pickFree others first (ctlPick true). Parked agents cost nothing.
  // `claims` false: no file claims (qodebase's Landing has none; L1's default).
  const cfg = { ...DEFAULTS, modules: 50, filesPerModule: 8, agents: 50, hours: 1, seed: 1,
    lanes: 1, reads: false, rdeps: false, controller: false, ctlPick: false, splitHot: false, claims: null, doorS: 0.5, doorPerChangeS: 0.05,
    coordBatch: 4, coordMaxLanes: 8, coordTestFactor: 1.5, bundle: true, ...opts };
  const C = { ...DEFAULTS.ctl, start: 8, step: 2, grow: 0.5, min: 1, tickS: 30, evalS: 900, windowS: 900, eff: 0.1, holdS: 900, fall: 0.25, drop: 1, ...(opts.ctl || {}) };
  const pol = REAL_POLICIES[cfg.policy] && { ...REAL_POLICIES[cfg.policy], ...(cfg.claims === false ? { claims: false, pickFree: 0 } : {}) };
  if (!pol) throw new Error(`policy: ${Object.keys(REAL_POLICIES).join(', ')}`);
  const name = cfg.name || `${cfg.policy}-${cfg.agents}`;
  resetNames();
  const rnd = mulberry32(cfg.seed);
  const normal = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const logn = (med, sigma) => med * Math.exp(sigma * normal());
  const T0 = Date.parse('2026-10-07T09:00:00Z');
  const wall0 = performance.now();

  const gitDir = join(HERE, 'out', `${name}.git`);
  rmSync(gitDir, { recursive: true, force: true });
  mkdirSync(join(HERE, 'out'), { recursive: true });
  const repo = openRepo(gitDir);

  // ---- the project ----
  const files0 = generate({ modules: cfg.modules, filesPerModule: cfg.filesPerModule, rnd, splitHot: cfg.splitHot });
  const snap0 = new Map([...files0].map(([p, text]) => [p, repo.blob(text)]));
  const root = repo.commit(repo.tree(snap0), [], 'Initial project (generated)', T0);
  let main = { sha: root, snap: snap0 };
  const paths = [...snap0.keys()].sort();
  const pathIdx = new Map(paths.map((p, i) => [p, i]));
  const reader = (snap) => (p) => (snap.has(p) ? repo.text(snap.get(p)) : null);
  const lister = (snap) => () => snap.keys();
  // Zipf-busy folders: a few are where most work happens.
  const modCdf = (() => { const c = []; let s = 0; for (let i = 0; i < cfg.modules; i++) { s += 1 / (i + 1); c.push(s); } return c.map((x) => x / s); })();
  const pickFile = () => {
    const u = rnd(); let m = modCdf.findIndex((x) => x >= u); if (m < 0) m = cfg.modules - 1;
    return `src/m${m}/f${Math.floor(rnd() * cfg.filesPerModule)}.ts`;
  };

  // ---- event loop ----
  const heap = []; let seq = 0, t = 0;
  const less = (a, b) => a.t < b.t || (a.t === b.t && a.s < b.s);
  const push = (e) => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (less(heap[i], heap[p])) { [heap[i], heap[p]] = [heap[p], heap[i]]; i = p; } else break; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && less(heap[l], heap[m])) m = l; if (r < heap.length && less(heap[r], heap[m])) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; };
  const at = (dt, fn) => push({ t: t + dt, s: seq++, fn });

  const changes = [];
  const stateCount = Object.create(null);
  const claims = new Map(); // path -> change id
  const claimWait = [];
  const reviewQ = []; let reviewersFree = Math.max(1, Math.round(cfg.agents * cfg.reviewersShare));
  const humanQ = []; let humansFree = cfg.humansPerRepo;
  const nLeads = pol.leads ? Math.max(1, Math.ceil(cfg.agents / cfg.leadSpan)) : 0;
  const leads = Array.from({ length: nLeads }, () => ({ busy: false, q: [], busyS: 0 }));
  let brokenUntil = -1;
  // ---- lanes ----
  // Units: areas 0..N-1 (folders), R = the root files' area, X = the coordinated lane (lanes > 1 only).
  const N = cfg.lanes, R = N > 1 ? N : 0, X = N > 1 ? N + 1 : 0;
  const lanes = Array.from({ length: N > 1 ? N + 2 : 1 }, (_, i) => ({ i, q: [], busy: false, locked: false, landed: 0, trains: 0, working: 0,
    cap: cfg.controller ? C.start : Infinity, capMax: cfg.controller ? C.start : 0, state: 'warm', since: 0, ref: 0, lastStep: 0, landT: [], dropT: [], parked: [] }));
  const areaOf = (p) => { if (N === 1) return 0; const mm = /^src\/m(\d+)\//.exec(p); return mm ? Number(mm[1]) % N : R; };
  const areasOf = (files) => [...new Set(files.map(areaOf))];
  const laneOfFiles = (files) => { if (N === 1) return 0; const s = areasOf(files); return s.length === 1 ? s[0] : s.length ? X : R; };
  // rdeps: a lane's tests also cover what imports from its area (the failure names a target there),
  // like a build tool testing the reverse dependencies of what changed.
  const inScope = (l) => (f) => N === 1 || l === X || areaOf(f.split(':')[0]) === l
    || (cfg.rdeps && [...f.matchAll(/(?:by|from missing) (src\/\S+)/g)].some((mm) => areaOf(mm[1]) === l));
  const doorQ = []; let doorBusy = false, doorBusyS = 0;
  let coordBusy = false, coordWants = new Set();
  const idle = []; // ctlPick: agents waiting for room in any lane
  const history = []; // main's commits
  const series = [];
  const m = { idled: 0, mainChecksFailed: 0, droppedWorkS: 0, revertedWorkS: 0, replayedOnLand: 0, landed: 0, conflicts: 0, testFails: 0, breaks: 0, reverts: 0, redos: 0, leadReplays: 0, dropped: 0, deferred: 0, disputes: 0, workS: 0, reworkS: 0, reviewS: 0, leadS: 0, gitMerges: 0 };
  let redS = 0, redFrom = 0;

  const ev = (c, what, extra) => c.events.push(extra ? [Math.round(t), what, extra] : [Math.round(t), what]);
  function setState(c, s) {
    if (c.state) stateCount[c.state]--;
    c.state = s; stateCount[s] = (stateCount[s] || 0) + 1;
    ev(c, s);
  }

  const draw = () => randomOp(rnd, pickFile, reader(main.snap), { splitHot: cfg.splitHot });
  // reads: a change's lane also counts the files it calls into (addCall's target), so a call across
  // areas goes through the coordinated lane instead of racing a rename in the other lane.
  const scope = (c, files) => (cfg.reads && c.op.kind === 'addCall' && files.length ? [...files, c.op.args.target] : files);
  const unitOf = (c) => lanes[laneOfFiles(scope(c, touched(c)))];
  const room = (c) => !cfg.controller || unitOf(c).working < unitOf(c).cap;
  function newChange(agent, parkedOp) {
    const c = { id: changes.length + 1, agent, op: parkedOp || draw(), created: t, events: [], state: null, tries: 0, files: [], conflicts: [], fails: [] };
    // pickFree: if its files are claimed (or, with ctlPick, its lane is full), leave this one in the backlog and draw another.
    const pickForRoom = cfg.controller && cfg.ctlPick;
    if (!parkedOp && (pol.claims && pol.pickFree || pickForRoom)) {
      for (let i = 0; i < (pol.pickFree || 8) && !((!pol.claims || claimable(c)) && (!pickForRoom || room(c))); i++) { m.deferred++; c.op = draw(); }
    }
    if (!room(c)) { // its lane is full: park with the task (or, with ctlPick, wait for any lane)
      m.idled++;
      if (cfg.ctlPick) idle.push(agent); else unitOf(c).parked.push({ agent, op: c.op });
      return;
    }
    changes.push(c);
    c.slotLane = laneOfFiles(scope(c, touched(c))); lanes[c.slotLane].working++;
    ev(c, 'asked', c.op.text);
    if (!pol.claims || tryClaim(c)) beginWork(c, logn(cfg.workMedS, cfg.workSigma), 'work');
    else { setState(c, 'claimWait'); claimWait.push(c); }
  }

  // Which files would this change touch on today's main (minus the hot shared ones)?
  function touched(c) {
    const out = c.op.apply(reader(main.snap), lister(main.snap));
    return out ? [...out.keys()] : [];
  }
  function claimable(c) {
    return touched(c).every((p) => isHot(p) || !claims.has(p) || claims.get(p) === c.id);
  }
  function tryClaim(c) {
    if (!pol.claims) return true;
    if (!claimable(c)) return false;
    c.claimed = touched(c).filter((p) => !isHot(p));
    for (const p of c.claimed) claims.set(p, c.id);
    return true;
  }
  function releaseClaims(c) {
    if (!c.claimed) return;
    for (const p of c.claimed) if (claims.get(p) === c.id) claims.delete(p);
    c.claimed = null;
    for (let i = 0; i < claimWait.length;) {
      const w = claimWait[i];
      if (tryClaim(w)) { claimWait.splice(i, 1); beginWork(w, logn(cfg.workMedS, cfg.workSigma), 'work'); } else i++;
    }
  }

  // Apply the change's intent to main as it is now and commit it on top.
  function build(c) {
    const out = c.op.apply(reader(main.snap), lister(main.snap));
    if (!out || !out.size) return false;
    const snap = new Map(main.snap);
    for (const [p, text] of out) snap.set(p, repo.blob(text));
    c.base = main;
    c.files = [...out.keys()];
    c.commit = repo.commit(repo.tree(snap), [main.sha], `#${c.id} ${c.op.text}`, T0 + t * 1000);
    c.snap = snap;
    c.tries++;
    return true;
  }

  // An agent's slot in its lane comes free: an idle agent tries again.
  function freeSlot(c) {
    if (c.slotLane == null) return;
    const u = lanes[c.slotLane];
    u.working--; c.slotLane = null;
    wake(1, u);
  }
  function wake(n, u) {
    for (let i = 0; i < n; i++) {
      if (cfg.ctlPick ? !idle.length : !u.parked.length) return;
      const p = cfg.ctlPick ? { agent: idle.shift() } : u.parked.shift();
      at(1 + i * 0.01, () => newChange(p.agent, p.op));
    }
  }
  function drop(c, why) {
    m.dropped++;
    if (c.workDur) m.droppedWorkS += c.workDur;
    freeSlot(c);
    ev(c, 'dropped', why);
    if (c.state) stateCount[c.state]--;
    c.state = 'dropped';
    releaseClaims(c);
    at(1, () => newChange(c.agent));
  }

  function beginWork(c, dur, kind) {
    if (kind !== 'fix' && !build(c)) return drop(c, 'nothing to do on the current main');
    if (pol.claims && !c.claimed) tryClaim(c);
    c.workDur = dur; c.workKind = kind;
    setState(c, kind);
    at(dur, () => {
      if (kind === 'work') m.workS += dur; else m.reworkS += dur;
      setState(c, 'reviewWait'); reviewQ.push(c); pumpReview();
    });
  }

  function pumpReview() {
    while (reviewersFree > 0 && reviewQ.length) {
      const c = reviewQ.shift(); reviewersFree--;
      const d = logn(cfg.reviewMedS, cfg.reviewSigma) * (c.light ? cfg.redoReviewFactor : 1);
      setState(c, 'review');
      at(d, () => {
        m.reviewS += d; reviewersFree++;
        if (rnd() > cfg.pApprove) {
          ev(c, 'changes asked');
          if (rnd() < cfg.pDispute) dispute(c);
          else beginWork(c, c.workDur * cfg.fixFactor, 'fix');
        } else approved(c);
        pumpReview();
      });
    }
  }
  const approved = (c) => (rnd() < cfg.pRisky ? toHuman(c) : toMerge(c));
  function toHuman(c) { setState(c, 'humanWait'); humanQ.push(c); pumpHuman(); }
  function pumpHuman() {
    while (humansFree > 0 && humanQ.length) {
      const c = humanQ.shift(); humansFree--;
      setState(c, 'human');
      at(logn(cfg.humanQuickMedS, 0.5), () => { humansFree++; toMerge(c); pumpHuman(); });
    }
  }

  function dispute(c) {
    m.disputes++;
    ev(c, 'author disagrees');
    let rounds = 1;
    if (!pol.leads) while (rnd() < 1 - 1 / cfg.disputeRounds) rounds++;
    const d = rounds * (c.workDur * cfg.argueFactor + logn(cfg.reviewMedS, cfg.reviewSigma) * 0.5);
    setState(c, 'dispute');
    at(d, () => {
      m.reworkS += d;
      if (pol.leads) return toLead(c, 'decide');
      ev(c, `${rounds} round${rounds > 1 ? 's' : ''} of arguing`);
      if (rnd() < 0.5) approved(c); else beginWork(c, c.workDur * cfg.fixFactor, 'fix');
    });
  }

  function leadOf(c) { return leads[(parseInt(/src\/m(\d+)/.exec(c.files[0] || '')?.[1] ?? '0', 10)) % leads.length]; }
  function toLead(c, why, detail) {
    c.leadWhy = why;
    setState(c, 'leadWait');
    const lead = leadOf(c);
    lead.q.push(c); pumpLead(lead);
  }
  function pumpLead(lead) {
    if (lead.busy || !lead.q.length) return;
    const c = lead.q.shift(); lead.busy = true;
    const d = logn(c.leadWhy === 'decide' ? cfg.leadDecideMedS : cfg.leadMergeMedS, 0.5);
    m.leadS += d; lead.busyS += d;
    setState(c, 'lead');
    at(d, () => {
      lead.busy = false;
      if (c.leadWhy === 'decide') {
        if (rnd() < 0.5) { ev(c, 'lead sided with the author'); approved(c); }
        else { ev(c, 'lead sided with the reviewer'); beginWork(c, c.workDur * cfg.fixFactor, 'fix'); }
      } else {
        // The lead replays the change's intent on today's main: no text merge.
        m.leadReplays++;
        if (build(c)) { ev(c, 'lead replayed it on the new main'); toMerge(c); }
        else drop(c, 'the lead found nothing left to do: another change already covers it');
      }
      pumpLead(lead);
    });
  }

  function toMerge(c) {
    setState(c, 'mergeWait');
    const l = laneOfFiles(scope(c, c.files));
    if (N > 1 && l === X) { c.areas = areasOf(scope(c, c.files)); lanes[X].q.push(c); pumpCoord(); } else { lanes[l].q.push(c); pumpMerge(l); }
  }
  function pumpMerge(l) {
    const lane = lanes[l];
    if (lane.busy || lane.locked || coordWants.has(l) || !lane.q.length || brokenUntil > t) return;
    const batch = lane.q.splice(0, pol.batch);
    lane.busy = true;
    at(cfg.mergeS + cfg.mergePerChangeS * batch.length + (pol.trainTest ? cfg.trainTestS : 0), () => (N > 1 ? (doorQ.push({ l, batch }), pumpDoor()) : mergeBatch(batch, l)));
  }
  // The coordinated lane: waits until every lane its train touches is idle, holds them, tests the whole repo.
  function pumpCoord() {
    const lane = lanes[X];
    if (N === 1 || coordBusy || !lane.q.length || brokenUntil > t) return;
    const batch = [], union = new Set();
    for (const c of lane.q) {
      if (batch.length >= cfg.coordBatch) break;
      const next = new Set([...union, ...c.areas]);
      if (batch.length && next.size > cfg.coordMaxLanes) break;
      batch.push(c); for (const a of c.areas) union.add(a);
    }
    coordWants = union;
    if (![...union].every((a) => !lanes[a].busy)) return;
    lane.q.splice(0, batch.length);
    coordBusy = true; lane.busy = true;
    for (const a of union) lanes[a].locked = true;
    batch.held = [...union];
    at(cfg.mergeS + cfg.mergePerChangeS * batch.length + (pol.trainTest ? cfg.trainTestS * cfg.coordTestFactor : 0), () => { doorQ.push({ l: X, batch }); pumpDoor(); });
  }
  // The door onto main: one lane's train at a time.
  function pumpDoor() {
    if (doorBusy || !doorQ.length || brokenUntil > t) return;
    const { l, batch } = doorQ.shift();
    const d = cfg.doorS + cfg.doorPerChangeS * batch.length;
    doorBusy = true; doorBusyS += d;
    at(d, () => { doorBusy = false; mergeBatch(batch, l); pumpDoor(); });
  }
  const pumpAll = () => { pumpCoord(); for (let l = 0; l < lanes.length; l++) if (N === 1 || l !== X) pumpMerge(l); pumpDoor(); };

  function bounce(c, why, detail) {
    if (c.slotLane != null) lanes[c.slotLane].dropT.push(t);
    // A conflict or a failed test: redo from intent, or hand it to the area lead.
    if (pol.onConflict === 'lead') return toLead(c, 'merge', detail);
    m.redos++;
    c.light = true;
    beginWork(c, c.workDur * cfg.redoFactor, 'rework');
  }

  function mergeBatch(batch, l) {
    lanes[l].busy = false; lanes[l].trains++;
    if (N > 1 && l === X) { coordBusy = false; coordWants = new Set(); for (const a of batch.held) lanes[a].locked = false; }
    const scoped = (fails) => fails.filter(inScope(l)); // a lane's train tests only its own area
    let tip = main;
    const landedNow = [];
    for (const c of batch) {
      m.gitMerges++;
      const r = repo.merge(tip.sha, c.commit);
      let problem = null, snap = null;
      if (r.conflicts.length) {
        m.conflicts++;
        c.conflicts.push(...r.conflicts);
        ev(c, 'conflict', r.conflicts);
        problem = 'conflict';
      } else {
        snap = repo.readTree(r.tree);
        if (pol.trainTest) {
          const fails = scoped(check(reader(snap), lister(snap)));
          if (fails.length) {
            m.testFails++;
            c.fails.push(...fails.slice(0, 3));
            ev(c, 'train tests failed', fails.slice(0, 3));
            problem = 'tests';
          }
        }
      }
      if (!problem) {
        const sha = repo.commit(r.tree, [tip.sha, c.commit], `Land #${c.id}: ${c.op.text}`, T0 + t * 1000);
        tip = { sha, snap };
        landedNow.push(c);
        continue;
      }
      // Land by intent: replay the reviewed change on the train's tip instead of merging text.
      if (pol.replayOnLand) {
        const out = c.op.apply(reader(tip.snap), lister(tip.snap));
        if (out && out.size) {
          const rs = new Map(tip.snap);
          for (const [p, text] of out) rs.set(p, repo.blob(text));
          const fails = scoped(check(reader(rs), lister(rs)));
          if (!fails.length) {
            m.replayedOnLand++;
            c.base = tip; c.files = [...out.keys()]; c.snap = rs;
            const sha = repo.commit(repo.tree(rs), [tip.sha], `Land #${c.id} (replayed): ${c.op.text}`, T0 + t * 1000);
            c.commit = sha;
            ev(c, 'replayed on main: no text merge');
            tip = { sha, snap: rs };
            landedNow.push(c);
            continue;
          }
          ev(c, 'replay failed the tests', fails.slice(0, 3));
        } else ev(c, 'replay found nothing to do');
      }
      bounce(c, problem);
    }
    if (landedNow.length) {
      main = tip;
      history.push({ t: Math.round(t), sha: tip.sha, ids: landedNow.map((c) => c.id), kind: 'land' });
      for (const c of landedNow) { lanes[l].landed++; land(c, tip.sha); }
      // Without train tests, or with lanes (each tested only its area), main's own tests run after landing.
      if (!pol.trainTest || N > 1) {
        const fails = check(reader(main.snap), lister(main.snap));
        if (fails.length) { m.mainChecksFailed++; breakMain(landedNow[landedNow.length - 1], fails, history[history.length - 2], landedNow); }
      }
    }
    pumpAll();
  }

  function land(c, sha) {
    m.landed++;
    if (c.slotLane != null) lanes[c.slotLane].landT.push(t);
    c.landedAt = Math.round(t); c.landSha = sha; c.lane = laneOfFiles(scope(c, c.files));
    if (cfg.bundle) c.diff = c.files.map((p) => ({ p, lines: lineDiff(c.base.snap.has(p) ? repo.text(c.base.snap.get(p)) : '', repo.text(c.snap.get(p))) }));
    else { c.snap = null; c.base = null; } // big runs: keep memory flat
    freeSlot(c);
    if (c.state) stateCount[c.state]--;
    c.state = 'landed'; ev(c, 'landed', sha.slice(0, 7));
    releaseClaims(c);
    at(1, () => newChange(c.agent));
  }

  // Main went red: someone reverts the change (the merge queue waits meanwhile).
  const breakKinds = Object.create(null); // what broke main, by kind (names stripped)
  function breakMain(c, fails, before, train = [c]) {
    m.breaks++;
    for (const f of new Set(fails.map((x) => x.replace(/^[^:]+: /, '').replace(/\b\w*\d\w*\b/g, 'X').replace(/src\/\S+/g, 'F')))) breakKinds[f] = (breakKinds[f] || 0) + 1;
    breakKinds[`train from ${N > 1 && train[0].lane === X ? 'the coordinated lane' : 'an area lane'}`] = (breakKinds[`train from ${N > 1 && train[0].lane === X ? 'the coordinated lane' : 'an area lane'}`] || 0) + 1;
    c.fails.push(...fails.slice(0, 3));
    ev(c, 'broke main', fails.slice(0, 3));
    const d = logn(cfg.fixMainMedS, 0.5);
    brokenUntil = t + d; redFrom = t;
    history[history.length - 1].broke = fails.slice(0, 3);
    at(d, () => {
      m.reverts++;
      redS += t - redFrom;
      const prev = before ? { sha: before.sha } : { sha: root };
      const treeSha = repo.treeOf(prev.sha);
      const sha = repo.commit(treeSha, [main.sha], `Revert #${c.id}: ${fails[0]}`, T0 + t * 1000);
      main = { sha, snap: repo.readTree(treeSha) };
      history.push({ t: Math.round(t), sha, ids: [c.id], kind: 'revert' });
      // Its agents have moved on; the changes go back to the backlog. With lanes the whole
      // train is reverted (main goes back to before it); without, the train is one change.
      for (const x of N > 1 ? train : [c]) {
        x.landedAt = null; x.reverted = true; x.state = 'reverted'; m.landed--; m.revertedWorkS += x.workDur || 0;
        if (x.lane != null) lanes[x.lane].landed--;
        ev(x, 'reverted: back to the backlog');
      }
      pumpAll();
    });
  }

  for (let a = 0; a < cfg.agents; a++) at(logn(cfg.bootS, 0.3) + rnd() * 30, () => newChange(a));

  // W8's probe per lane (L1's ctlUnit, same constants): grow the cap in steps while the lane's
  // landings/min rise by at least eff per added agent, step back when they don't, back off on redos.
  function ctlUnit(u) {
    const W = C.windowS;
    u.landT = u.landT.filter((x) => x > t - 2 * W); u.dropT = u.dropT.filter((x) => x > t - 60);
    const now = (u.landT.filter((x) => x > t - W).length * 60) / W, before = u.cap;
    const st = Math.max(C.step, Math.round(u.cap * C.grow));
    if (u.dropT.length > C.drop * u.cap && u.cap > C.min) { u.cap = Math.max(C.min, Math.floor(u.cap / 2)); u.state = 'hold'; u.since = t; u.ref = now; }
    else if (u.state === 'warm' && t - u.since >= C.evalS) { u.ref = now; u.cap += st; u.state = 'eval'; u.since = t; u.lastStep = st; }
    else if (u.state === 'eval' && t - u.since >= C.evalS) {
      const s0 = u.lastStep || st, b = u.cap - s0;
      if (now >= u.ref * (1 + (C.eff * s0) / Math.max(1, b))) { u.ref = now; u.cap += st; u.since = t; u.lastStep = st; }
      else { u.cap = Math.max(C.min, u.cap - s0); u.state = 'hold'; u.since = t; u.ref = now; }
    } else if (u.state === 'hold') {
      if (u.ref > 0 && now < u.ref * (1 - C.fall)) { u.cap = Math.max(C.min, u.cap - 1); u.ref = now; u.since = t; }
      else if (t - u.since >= C.holdS) { u.ref = now; u.cap += st; u.state = 'eval'; u.since = t; u.lastStep = st; }
    }
    u.cap = Math.min(u.cap, cfg.agents);
    u.capMax = Math.max(u.capMax, u.cap);
    return Math.max(0, u.cap - before);
  }
  if (cfg.controller) {
    const tick = () => { for (const u of lanes) { const up = ctlUnit(u); if (up) wake(up, u); } at(C.tickS, tick); };
    at(C.tickS, tick);
  }

  const end = cfg.hours * 3600;
  let lastSample = -1e9, nEvents = 0, lastLog = performance.now(), workingSum = 0, workingN = 0;
  while (heap.length && heap[0].t <= end) {
    const e = pop(); t = e.t; e.fn(); nEvents++;
    if (t - lastSample >= 60) {
      lastSample = t;
      workingSum += lanes.reduce((s, l) => s + l.working, 0); workingN++;
      series.push({ t: Math.round(t), landed: m.landed, coordQ: N > 1 ? lanes[X].q.length : 0, parked: lanes.reduce((n, l) => n + l.parked.length, 0) + idle.length, conflicts: m.conflicts, testFails: m.testFails, red: brokenUntil > t ? 1 : 0, states: { ...stateCount } });
    }
    if (performance.now() - lastLog > 5000) { lastLog = performance.now(); process.stderr.write(`  ${name}: ${Math.round(t / 60)} of ${cfg.hours * 60} simulated min, ${m.landed} landed, ${m.gitMerges} git merges\n`); }
  }
  repo.setRef('refs/heads/main', main.sha);
  if (brokenUntil > end) redS += end - redFrom;

  const thinking = m.workS + m.reworkS;
  const stats = {
    landed: m.landed, landedPerHour: Math.round(m.landed / cfg.hours), conflicts: m.conflicts, testFails: m.testFails,
    breaks: m.breaks, reverts: m.reverts, replayedOnLand: m.replayedOnLand, redos: m.redos, leadReplays: m.leadReplays, dropped: m.dropped, deferred: m.deferred,
    disputes: m.disputes, gitMerges: m.gitMerges, reworkShare: thinking ? +(m.reworkS / thinking).toFixed(3) : 0,
    redShare: +(redS / end).toFixed(3), commits: history.length,
    cost: +((m.workS + m.reworkS + m.reviewS + m.leadS) * cfg.llmPerS).toFixed(2),
    lanes: N, reads: !!cfg.reads, rdeps: !!cfg.rdeps, controller: !!cfg.controller, splitHot: !!cfg.splitHot, modules: cfg.modules,
    laneLanded: lanes.map((l) => l.landed), coordLanded: N > 1 ? lanes[X].landed : 0,
    doorBusy: +(doorBusyS / end).toFixed(3), mainChecksFailed: m.mainChecksFailed, idled: m.idled,
    avgWorking: workingN ? Math.round(workingSum / workingN) : 0,
    caps: cfg.controller ? lanes.map((l) => l.cap) : null, capMax: cfg.controller ? lanes.map((l) => l.capMax) : null,
    parkedAtEnd: lanes.reduce((n, l) => n + l.parked.length, 0) + idle.length, claims: !!pol.claims,
    wasteShare: thinking ? +((m.reworkS + m.droppedWorkS + m.revertedWorkS) / thinking).toFixed(3) : 0,
    leads: nLeads, leadBusy: nLeads ? +(leads.reduce((s, l) => s + l.busyS, 0) / (end * nLeads)).toFixed(3) : null,
    wallS: +((performance.now() - wall0) / 1000).toFixed(1),
  };
  const lat = changes.filter((c) => c.landedAt != null).map((c) => c.landedAt - c.created).sort((a, b) => a - b);
  // The last hour (qb4: a 2 h run overstates cross-heavy cells while the coordinated queue still grows).
  const lastH = series.filter((x) => x.t >= end - 3600);
  if (lastH.length && cfg.hours >= 1) {
    const atStart = series.filter((x) => x.t <= end - 3600).at(-1)?.landed ?? 0;
    stats.landedLastHour = m.landed - atStart;
    stats.coordQLastHour = Math.round(lastH.reduce((a, x) => a + x.coordQ, 0) / lastH.length);
    stats.coordQEnd = lastH.at(-1).coordQ; stats.parkedEnd = lastH.at(-1).parked;
  }
  stats.coordQByHour = Array.from({ length: Math.ceil(cfg.hours) }, (_, h) => series.find((x) => x.t >= (h + 1) * 3600 - 60)?.coordQ ?? null);
  stats.breakKinds = breakKinds;
  stats.coordBatch = cfg.coordBatch; stats.coordMaxLanes = cfg.coordMaxLanes;
  stats.p50S = lat[Math.floor(lat.length * 0.5)] ?? null; stats.p90S = lat[Math.floor(lat.length * 0.9)] ?? null;

  const bundle = {
    meta: { name, policy: cfg.policy, label: pol.label, about: pol.about, agents: cfg.agents, reviewers: Math.max(1, Math.round(cfg.agents * cfg.reviewersShare)), leads: nLeads, hours: cfg.hours, seed: cfg.seed, modules: cfg.modules, filesPerModule: cfg.filesPerModule, startedAt: new Date(T0).toISOString(), generatedAt: new Date().toISOString(), git: gitDir.replace(/^.*\/forq\//, '') },
    stats, paths,
    changes: changes.map((c) => ({
      id: c.id, agent: c.agent, kind: c.op.kind, text: c.op.text, created: Math.round(c.created),
      files: c.files.map((p) => pathIdx.get(p)), events: c.events, tries: c.tries,
      landedAt: c.landedAt ?? null, sha: c.landSha?.slice(0, 10) ?? null, commit: c.commit?.slice(0, 10) ?? null,
      conflicts: [...new Set(c.conflicts)], fails: [...new Set(c.fails)], reverted: !!c.reverted,
      diff: c.landedAt != null ? c.diff : null, state: c.state,
    })),
    history, series,
  };
  return { bundle, stats, name };
}

// ---- CLI ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => { if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]); return acc; }, []));
  const policies = args.all ? Object.keys(REAL_POLICIES) : [args.policy || 'leads'];
  mkdirSync(RUNS, { recursive: true });
  const indexPath = join(RUNS, 'index.json');
  const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : [];
  for (const policy of policies) {
    const lanesOpt = args.lanes ? { lanes: Number(args.lanes), controller: !!args.controller, ctlPick: !!args['ctl-pick'], splitHot: !!args['split-hot'],
      ...(args.claims === 'off' ? { claims: false } : {}),
      ...(args.reads ? { reads: true } : {}), ...(args.rdeps ? { rdeps: true } : {}),
      ...(args['coord-batch'] ? { coordBatch: Number(args['coord-batch']) } : {}),
      ...(args['coord-max-lanes'] ? { coordMaxLanes: args['coord-max-lanes'] === 'all' ? Infinity : Number(args['coord-max-lanes']) } : {}),
      ...(args.modules ? { modules: Number(args.modules) } : {}), bundle: !args['no-bundle'], ...(args.name ? { name: args.name } : {}) } : {};
    const { bundle, stats, name } = runReal({ policy, agents: Number(args.agents || 50), hours: Number(args.hours || 1), seed: Number(args.seed || 1), ...lanesOpt });
    if (args['no-bundle']) { // lanes grid: one stats line, no viewer bundle
      if (args.out) appendFileSync(args.out, JSON.stringify({ ts: new Date().toISOString(), event: 'lanes_run', name, policy, agents: bundle.meta.agents, hours: bundle.meta.hours, seed: bundle.meta.seed, stats }) + '\n');
      console.log(`${name}: ${stats.landed} landed (${stats.landedPerHour}/h), lanes ${stats.lanes}, coordinated ${stats.coordLanded}, ${stats.conflicts} conflicts, ${stats.breaks} broke main, waste ${stats.wasteShare}, working ${stats.avgWorking}, door ${stats.doorBusy}, p50 ${Math.round((stats.p50S || 0) / 60)} min, $${stats.cost}, ${stats.wallS} s`);
      continue;
    }
    const json = JSON.stringify(bundle);
    writeFileSync(join(RUNS, `${name}.json`), json);
    const entry = { name, policy, label: bundle.meta.label, agents: bundle.meta.agents, hours: bundle.meta.hours, stats, bytes: json.length };
    const i = index.findIndex((x) => x.name === name); if (i >= 0) index[i] = entry; else index.push(entry);
    if (args.out) appendFileSync(args.out, JSON.stringify({ ts: new Date().toISOString(), event: 'real_run', ...entry }) + '\n');
    console.log(`${name}: ${stats.landed} landed (${stats.landedPerHour}/h), ${stats.conflicts} git conflicts, ${stats.testFails} caught by train tests, ${stats.breaks} broke main, ${stats.dropped} dropped, ${stats.redos} redos, ${stats.leadReplays} lead replays, ${stats.replayedOnLand} replayed on landing, p50 ${Math.round((stats.p50S || 0) / 60)} min, ${(json.length / 1e6).toFixed(1)} MB, ${stats.wallS} s`);
  }
  index.sort((a, b) => a.agents - b.agents || a.name.localeCompare(b.name));
  writeFileSync(indexPath, JSON.stringify(index, null, 1));
}
