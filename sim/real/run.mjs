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
import { generate, randomOp, check, lineDiff, HOT } from './project.mjs';
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
  const cfg = { ...DEFAULTS, modules: 50, filesPerModule: 8, agents: 50, hours: 1, seed: 1, ...opts };
  const pol = REAL_POLICIES[cfg.policy];
  if (!pol) throw new Error(`policy: ${Object.keys(REAL_POLICIES).join(', ')}`);
  const name = cfg.name || `${cfg.policy}-${cfg.agents}`;
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
  const files0 = generate({ modules: cfg.modules, filesPerModule: cfg.filesPerModule, rnd });
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
  const mq = []; let mergeBusy = false, brokenUntil = -1;
  const history = []; // main's commits
  const series = [];
  const m = { replayedOnLand: 0, landed: 0, conflicts: 0, testFails: 0, breaks: 0, reverts: 0, redos: 0, leadReplays: 0, dropped: 0, deferred: 0, disputes: 0, workS: 0, reworkS: 0, reviewS: 0, leadS: 0, gitMerges: 0 };
  let redS = 0, redFrom = 0;

  const ev = (c, what, extra) => c.events.push(extra ? [Math.round(t), what, extra] : [Math.round(t), what]);
  function setState(c, s) {
    if (c.state) stateCount[c.state]--;
    c.state = s; stateCount[s] = (stateCount[s] || 0) + 1;
    ev(c, s);
  }

  function newChange(agent) {
    let op = randomOp(rnd, pickFile, reader(main.snap));
    const c = { id: changes.length + 1, agent, op, created: t, events: [], state: null, tries: 0, files: [], conflicts: [], fails: [] };
    changes.push(c);
    // pickFree: if its files are claimed, leave this one in the backlog and draw another.
    if (pol.claims && pol.pickFree) {
      for (let i = 0; i < pol.pickFree && !claimable(c); i++) { m.deferred++; c.op = randomOp(rnd, pickFile, reader(main.snap)); }
    }
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
    return touched(c).every((p) => HOT.includes(p) || !claims.has(p) || claims.get(p) === c.id);
  }
  function tryClaim(c) {
    if (!pol.claims) return true;
    if (!claimable(c)) return false;
    c.claimed = touched(c).filter((p) => !HOT.includes(p));
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

  function drop(c, why) {
    m.dropped++;
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

  function toMerge(c) { setState(c, 'mergeWait'); mq.push(c); pumpMerge(); }
  function pumpMerge() {
    if (mergeBusy || !mq.length || brokenUntil > t) return;
    const batch = mq.splice(0, pol.batch);
    mergeBusy = true;
    at(cfg.mergeS + cfg.mergePerChangeS * batch.length + (pol.trainTest ? cfg.trainTestS : 0), () => mergeBatch(batch));
  }

  function bounce(c, why, detail) {
    // A conflict or a failed test: redo from intent, or hand it to the area lead.
    if (pol.onConflict === 'lead') return toLead(c, 'merge', detail);
    m.redos++;
    c.light = true;
    beginWork(c, c.workDur * cfg.redoFactor, 'rework');
  }

  function mergeBatch(batch) {
    mergeBusy = false;
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
          const fails = check(reader(snap), lister(snap));
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
          const fails = check(reader(rs), lister(rs));
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
      for (const c of landedNow) land(c, tip.sha);
      // Without train tests, main is only tested after landing.
      if (!pol.trainTest) {
        const fails = check(reader(main.snap), lister(main.snap));
        if (fails.length) breakMain(landedNow[landedNow.length - 1], fails, history[history.length - 2]);
      }
    }
    pumpMerge();
  }

  function land(c, sha) {
    m.landed++;
    c.landedAt = Math.round(t); c.landSha = sha;
    c.diff = c.files.map((p) => ({ p, lines: lineDiff(c.base.snap.has(p) ? repo.text(c.base.snap.get(p)) : '', repo.text(c.snap.get(p))) }));
    if (c.state) stateCount[c.state]--;
    c.state = 'landed'; ev(c, 'landed', sha.slice(0, 7));
    releaseClaims(c);
    at(1, () => newChange(c.agent));
  }

  // Main went red: someone reverts the change (the merge queue waits meanwhile).
  function breakMain(c, fails, before) {
    m.breaks++;
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
      // Its agent has moved on; the change goes back to the backlog.
      c.landedAt = null; c.reverted = true; c.state = 'reverted'; m.landed--;
      ev(c, 'reverted: back to the backlog');
      pumpMerge();
    });
  }

  for (let a = 0; a < cfg.agents; a++) at(logn(cfg.bootS, 0.3) + rnd() * 30, () => newChange(a));

  const end = cfg.hours * 3600;
  let lastSample = -1e9, nEvents = 0, lastLog = performance.now();
  while (heap.length && heap[0].t <= end) {
    const e = pop(); t = e.t; e.fn(); nEvents++;
    if (t - lastSample >= 60) {
      lastSample = t;
      series.push({ t: Math.round(t), landed: m.landed, conflicts: m.conflicts, testFails: m.testFails, red: brokenUntil > t ? 1 : 0, states: { ...stateCount } });
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
    leads: nLeads, leadBusy: nLeads ? +(leads.reduce((s, l) => s + l.busyS, 0) / (end * nLeads)).toFixed(3) : null,
    wallS: +((performance.now() - wall0) / 1000).toFixed(1),
  };
  const lat = changes.filter((c) => c.landedAt != null).map((c) => c.landedAt - c.created).sort((a, b) => a - b);
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
    const { bundle, stats, name } = runReal({ policy, agents: Number(args.agents || 50), hours: Number(args.hours || 1), seed: Number(args.seed || 1) });
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
