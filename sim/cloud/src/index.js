// qodebase sim on Cloudflare: N agent Durable Objects, each with its own Artifacts fork,
// push real commits; one Run Durable Object is the merge queue and lands tested trains
// on the main repo by replaying each change's intent (no text merge). No model calls:
// the edits come from the same scripted operations as the laptop run (sim/real).
//
//   POST /start  {agents, minutes, workMinS, workMaxS, trainEveryS}   (x-sim-key header)
//   GET  /status                 GET /bundle   (the run, in the viewer's format)
import { DurableObject } from 'cloudflare:workers';
import { generate, randomOp, check, lineDiff } from '../../real/project.mjs';
import { Objects, push } from './gitpush.js';

const ZERO = '0'.repeat(40);
const log = (event, data) => console.log(JSON.stringify({ ts: new Date().toISOString(), module: 'qbsim', event, ...data }));
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const run = env.RUN.get(env.RUN.idFromName('run'));
    if (url.pathname === '/status') return Response.json(await run.status());
    if (url.pathname === '/bundle') return Response.json(await run.bundle());
    // A short-lived read token for main, to clone and check it with real git.
    if (url.pathname === '/clone') {
      if (request.headers.get('x-sim-key') !== env.SIM_KEY) return new Response('forbidden', { status: 403 });
      return Response.json(await run.cloneToken());
    }
    if (url.pathname === '/start' && request.method === 'POST') {
      if (request.headers.get('x-sim-key') !== env.SIM_KEY) return new Response('forbidden', { status: 403 });
      return Response.json(await run.start(await request.json()));
    }
    return new Response('qodebase sim on Cloudflare: GET /status, GET /bundle\n', { headers: { 'content-type': 'text/plain' } });
  },
};

export class Run extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.s = null; }

  async start(opts) {
    if (this.s && this.s.phase !== 'done') return { error: 'a run is already going', status: this.summary() };
    const cfg = { agents: 20, minutes: 5, workMinS: 20, workMaxS: 60, trainEveryS: 5, trainMax: 200, seed: 1, forkConcurrency: 8, forkTries: 5, ...opts };
    cfg.agents = Math.min(cfg.agents, 600); cfg.minutes = Math.min(cfg.minutes, 20); // hard caps (cost)
    const runId = `r${Date.now().toString(36)}`;
    const rnd = mulberry32(cfg.seed);
    const files = generate({ modules: 50, filesPerModule: 8, rnd });
    const objs = new Objects();
    const text = new Map();
    const snap = new Map();
    for (const [p, t] of files) { const sha = objs.blob(t); snap.set(p, sha); text.set(sha, t); }
    const root = objs.commit(objs.tree(snap), [], 'Initial project (generated)', Date.now());
    const t0 = Date.now();
    const created = await this.env.ARTIFACTS.create(`${runId}-main`, { description: 'qodebase sim: main', setDefaultBranch: 'main' });
    const createMs = Date.now() - t0;
    const p0 = Date.now();
    const pushed = await push({ remote: created.remote, token: created.token, oldSha: ZERO, newSha: root, objs: [...objs.map.values()] });
    log('main_created', { runId, createMs, pushMs: Date.now() - p0, ok: pushed.ok, status: pushed.status, bytes: pushed.bytes, detail: pushed.detail });
    if (!pushed.ok) return { error: 'initial push failed', pushed };
    this.s = {
      cfg, runId, phase: 'spawn', startedAt: Date.now(), runFrom: null, deadline: null, spawned: 0,
      rnd, main: { name: created.name, remote: created.remote, token: created.token, tip: root, snap }, text,
      snapshots: new Map([[root, new Map(snap)]]), paths: [...snap.keys()].sort(),
      changes: [], ops: new Map(), queue: [], history: [], series: [],
      m: { forks: 0, forkMs: [], forkRetries: 0, forkFailed: 0, agentPushes: 0, agentPushMs: [], agentPushFail: 0, mainPushes: 0, mainPushMs: [], mainPushFail: 0, landed: 0, dropped: 0, testFails: 0, artifactsOps: 2, errors: [] },
      agentsDone: 0, trains: 0,
    };
    await this.ctx.storage.delete(['bundle:n']);
    await this.ctx.storage.setAlarm(Date.now() + 10);
    return { runId, main: created.name, createMs, initialPush: pushed };
  }

  now() { return Math.round((Date.now() - (this.s.runFrom ?? this.s.startedAt)) / 1000); }
  ev(c, what, extra) { c.events.push(extra === undefined ? [this.now(), what] : [this.now(), what, extra]); }

  async alarm() {
    try { await this.step(); }
    catch (e) {
      // An uncaught exception resets the object and its in-memory run (lost one on 2026-10-07).
      log('run_alarm_error', { err: String(e), stack: e?.stack, phase: this.s?.phase, queue: this.s?.queue.length, landed: this.s?.m.landed });
      if (this.s) { this.s.m.errors.push(`run: ${String(e)}`.slice(0, 200)); await this.ctx.storage.setAlarm(Date.now() + 2000); }
    }
  }

  async step() {
    const s = this.s;
    if (!s) return;
    if (s.phase === 'spawn') {
      // Start agents a few at a time (concurrent forks of one repo fail: 6 of 10 at once
      // returned "internal error" on 2026-10-07); each forks main, retrying with backoff.
      const batch = [];
      for (let i = s.spawned; i < Math.min(s.cfg.agents, s.spawned + s.cfg.forkConcurrency); i++) {
        const stub = this.env.AGENT.get(this.env.AGENT.idFromName(`${s.runId}-${i}`));
        batch.push(stub.begin({ i, runId: s.runId, main: s.main.name, cfg: s.cfg }).catch((e) => ({ error: String(e) })));
      }
      const results = await Promise.all(batch);
      for (const r of results) {
        s.m.forkRetries += r.retries || 0; s.m.artifactsOps += 1 + (r.retries || 0);
        if (r.error) { s.m.forkFailed++; s.m.errors.push(`fork: ${r.error}`.slice(0, 200)); continue; }
        s.m.forks++; s.m.forkMs.push(r.forkMs);
      }
      s.spawned += batch.length;
      if (s.spawned < s.cfg.agents) return this.ctx.storage.setAlarm(Date.now() + 10);
      s.phase = 'run'; s.runFrom = Date.now(); s.deadline = Date.now() + s.cfg.minutes * 60_000;
      log('spawned', { runId: s.runId, forks: s.m.forks, errors: s.m.errors.length, spawnS: (Date.now() - s.startedAt) / 1000 });
      // Agents were told to wait for this.
      await Promise.all(Array.from({ length: s.cfg.agents }, (_, i) => this.env.AGENT.get(this.env.AGENT.idFromName(`${s.runId}-${i}`)).go().catch(() => {})));
      return this.ctx.storage.setAlarm(Date.now() + s.cfg.trainEveryS * 1000);
    }
    if (s.phase === 'run' || s.phase === 'drain') {
      await this.train();
      this.sample();
      // Checkpoint: if the object is reset mid-run, /bundle still has the run so far.
      if (++s.trains % 6 === 0) await this.save();
      if (s.phase === 'run' && Date.now() > s.deadline) s.phase = 'drain';
      if (s.phase === 'drain' && !s.queue.length && (s.agentsDone >= s.m.forks || Date.now() > s.deadline + 180_000)) {
        s.phase = 'done';
        log('done', { runId: s.runId, ...this.summary() });
        await this.save();
        return;
      }
      return this.ctx.storage.setAlarm(Date.now() + s.cfg.trainEveryS * 1000);
    }
  }

  // ---- agents call these ----
  snapshot(sha) { return [...(this.s.snapshots.get(sha) || this.s.snapshots.get(this.s.history[0]?.sha) || []).entries()]; }
  rootSha() { return [...this.s.snapshots.keys()][0]; }

  task(agent) {
    const s = this.s;
    if (!s || s.phase !== 'run' || Date.now() > s.deadline) return null;
    const get = (p) => (s.main.snap.has(p) ? s.text.get(s.main.snap.get(p)) : null), paths = () => s.main.snap.keys();
    for (let i = 0; i < 6; i++) {
      const op = randomOp(s.rnd, () => `src/m${Math.min(49, Math.floor(-Math.log(1 - s.rnd()) * 8))}/f${Math.floor(s.rnd() * 8)}.ts`, get);
      const out = op.apply(get, paths);
      if (!out || !out.size) continue;
      const c = { id: s.changes.length + 1, agent, kind: op.kind, text: op.text, created: this.now(), events: [], files: [...out.keys()], conflicts: [], fails: [], tries: 1, state: 'work' };
      this.ev(c, 'asked', op.text); this.ev(c, 'work');
      s.changes.push(c); s.ops.set(c.id, op);
      return { id: c.id, text: op.text, files: [...out.entries()] };
    }
    return null;
  }
  submitted(id, r) {
    const s = this.s, c = s.changes[id - 1];
    s.m.agentPushes++; s.m.artifactsOps++;
    if (r.ok) s.m.agentPushMs.push(r.ms); else { s.m.agentPushFail++; s.m.errors.push(`agent push ${r.status}: ${r.detail}`.slice(0, 200)); }
    this.ev(c, 'pushed to its fork', `${r.ms} ms, ${r.bytes} bytes${r.ok ? '' : `, failed ${r.status}`}`);
    c.commit = r.commit?.slice(0, 10);
    c.state = 'mergeWait'; this.ev(c, 'mergeWait');
    s.queue.push(id);
  }
  agentDone() { this.s.agentsDone++; }

  // Land a train: replay each queued change's intent on main, test, chain the commits, one push.
  async train() {
    const s = this.s;
    if (!s.queue.length) return;
    const ids = s.queue.splice(0, s.cfg.trainMax);
    const objs = new Objects();
    let tip = s.main.tip, snap = new Map(s.main.snap);
    const landed = [];
    for (const id of ids) {
      const c = s.changes[id - 1], op = s.ops.get(id);
      const get = (p) => (snap.has(p) ? (s.text.get(snap.get(p)) ?? null) : null), paths = () => snap.keys();
      const out = op.apply(get, paths);
      if (!out || !out.size) { s.m.dropped++; c.state = 'dropped'; this.ev(c, 'dropped', 'another change already covers it'); continue; }
      const next = new Map(snap);
      const baseText = {};
      for (const [p, t] of out) { baseText[p] = get(p); const sha = objs.blob(t); s.text.set(sha, t); next.set(p, sha); }
      const nget = (p) => (next.has(p) ? s.text.get(next.get(p)) : null);
      const fails = check(nget, () => next.keys());
      if (fails.length) { s.m.testFails++; c.fails.push(...fails.slice(0, 3)); c.state = 'dropped'; this.ev(c, 'train tests failed', fails.slice(0, 3)); s.m.dropped++; continue; }
      tip = objs.commit(objs.tree(next), [tip], `Land #${id}: ${c.text}`, Date.now());
      snap = next;
      c.files = [...out.keys()];
      c.diff = [...out.entries()].map(([p, t]) => ({ p, lines: lineDiff(baseText[p], t) }));
      landed.push(c);
    }
    if (!landed.length) return;
    const t0 = Date.now();
    const r = await push({ remote: s.main.remote, token: s.main.token, oldSha: s.main.tip, newSha: tip, objs: [...objs.map.values()] });
    const ms = Date.now() - t0;
    s.m.mainPushes++; s.m.artifactsOps++;
    if (!r.ok) {
      s.m.mainPushFail++; s.m.errors.push(`main push ${r.status}: ${r.detail}`.slice(0, 200));
      log('main_push_failed', { status: r.status, detail: r.detail });
      for (const c of landed) { s.queue.unshift(c.id); }
      return;
    }
    s.m.mainPushMs.push(ms);
    s.main.tip = tip; s.main.snap = snap;
    // Agents only ever need the root snapshot; drop texts no longer on main (memory).
    if (s.trains % 10 === 0) { const live = new Set(snap.values()); for (const k of s.text.keys()) if (!live.has(k)) s.text.delete(k); }
    for (const c of landed) { c.state = 'landed'; c.landedAt = this.now(); c.sha = tip.slice(0, 10); this.ev(c, 'landed', `${tip.slice(0, 7)} (push ${ms} ms)`); s.m.landed++; }
    s.history.push({ t: this.now(), sha: tip, ids: landed.map((c) => c.id), kind: 'land', pushMs: ms });
  }

  sample() {
    const s = this.s, states = {};
    for (const c of s.changes) if (c.state !== 'landed' && c.state !== 'dropped') states[c.state] = (states[c.state] || 0) + 1;
    s.series.push({ t: this.now(), landed: s.m.landed, conflicts: 0, testFails: s.m.testFails, red: 0, states });
  }

  summary() {
    const s = this.s; if (!s) return { phase: 'idle' };
    const pct = (a, p) => { if (!a.length) return null; const x = [...a].sort((u, v) => u - v); return x[Math.min(x.length - 1, Math.floor(p * x.length))]; };
    return {
      runId: s.runId, phase: s.phase, agents: s.cfg.agents, minutes: s.cfg.minutes, elapsedS: this.now(), changes: s.changes.length,
      landed: s.m.landed, dropped: s.m.dropped, testFails: s.m.testFails, queue: s.queue.length,
      forks: s.m.forks, forkFailed: s.m.forkFailed, forkRetries: s.m.forkRetries, forkMsP50: pct(s.m.forkMs, 0.5), forkMsP90: pct(s.m.forkMs, 0.9),
      agentPushes: s.m.agentPushes, agentPushFail: s.m.agentPushFail, agentPushMsP50: pct(s.m.agentPushMs, 0.5), agentPushMsP90: pct(s.m.agentPushMs, 0.9),
      mainPushes: s.m.mainPushes, mainPushFail: s.m.mainPushFail, mainPushMsP50: pct(s.m.mainPushMs, 0.5), mainPushMsP90: pct(s.m.mainPushMs, 0.9),
      artifactsOpsCounted: s.m.artifactsOps, errors: s.m.errors.slice(0, 10), errorCount: s.m.errors.length,
    };
  }
  async cloneToken() {
    if (!this.s) return { error: 'no run in memory' };
    const t = await (await this.env.ARTIFACTS.get(this.s.main.name)).createToken('read', 600);
    return { remote: this.s.main.remote, token: t.plaintext.split('?')[0] };
  }
  status() { return this.s ? this.summary() : { phase: 'idle (no run in memory)' }; }

  makeBundle() {
    const s = this.s; const sum = this.summary();
    const pathIdx = new Map(s.paths.map((p, i) => [p, i]));
    const hours = Math.max(1, this.now()) / 3600;
    const lat = s.changes.filter((c) => c.landedAt != null).map((c) => c.landedAt - c.created).sort((a, b) => a - b);
    return {
      meta: {
        name: `cloud-${s.cfg.agents}`, policy: 'cloud', label: 'On Cloudflare, land by intent', agents: s.cfg.agents, reviewers: 0, leads: 0,
        hours: +hours.toFixed(4), seed: s.cfg.seed, startedAt: new Date(s.runFrom || s.startedAt).toISOString(), generatedAt: new Date().toISOString(),
        git: `Artifacts ${s.main.name} + ${s.m.forks} forks`, realTime: true,
        about: `Real time on Cloudflare: ${s.cfg.agents} agent Durable Objects each forked the main Artifacts repo and pushed real commits to their fork (work time ${s.cfg.workMinS}-${s.cfg.workMaxS} s, no model calls); a merge-queue Durable Object replayed each change on main every ${s.cfg.trainEveryS} s, ran the tests and pushed the train.`,
      },
      stats: {
        landed: s.m.landed, landedPerHour: Math.round(s.m.landed / hours), conflicts: 0, testFails: s.m.testFails, breaks: 0, reverts: 0, redos: 0,
        leadReplays: 0, replayedOnLand: s.m.landed, dropped: s.m.dropped, reworkShare: 0, p50S: lat[Math.floor(lat.length / 2)] ?? null, p90S: lat[Math.floor(lat.length * 0.9)] ?? null,
        cloud: sum,
      },
      paths: s.paths,
      changes: s.changes.map((c) => ({ id: c.id, agent: c.agent, kind: c.kind, text: c.text, created: c.created, files: c.files.map((p) => pathIdx.get(p)), events: c.events, tries: 1, landedAt: c.landedAt ?? null, sha: c.sha ?? null, commit: c.commit ?? null, conflicts: [], fails: c.fails, reverted: false, diff: c.diff ?? null, state: c.state })),
      history: s.history, series: s.series,
    };
  }
  // DO values are capped at 2 MB: store the bundle in chunks.
  async save() {
    const t0 = Date.now();
    const json = JSON.stringify(this.makeBundle()), parts = Math.ceil(json.length / 1_000_000);
    for (let k = 0; k < parts; k++) await this.ctx.storage.put(`bundle:${k}`, json.slice(k * 1_000_000, (k + 1) * 1_000_000));
    await this.ctx.storage.put('bundle:n', parts);
    log('saved', { bytes: json.length, parts, ms: Date.now() - t0, phase: this.s.phase, landed: this.s.m.landed });
  }

  async bundle() {
    if (this.s) return this.makeBundle();
    const n = await this.ctx.storage.get('bundle:n');
    if (!n) return { error: 'no run' };
    let json = ''; for (let k = 0; k < n; k++) json += await this.ctx.storage.get(`bundle:${k}`);
    return JSON.parse(json);
  }
}

export class Agent extends DurableObject {
  async begin({ i, runId, main, cfg }) {
    const repo = await this.env.ARTIFACTS.get(main);
    let fork = null, retries = 0, forkMs = 0, lastErr = null;
    for (let k = 0; k < (cfg.forkTries || 5) && !fork; k++) {
      if (k) { retries++; await new Promise((r) => setTimeout(r, 1000 * 2 ** k + Math.random() * 1000)); }
      const t0 = Date.now();
      try { fork = await repo.fork(`${runId}-a${i}${k ? `-${k}` : ''}`, { description: `qodebase sim agent ${i}`, defaultBranchOnly: true }); forkMs = Date.now() - t0; }
      catch (e) { lastErr = e; console.log(JSON.stringify({ module: 'qbsim', event: 'fork_error', agent: i, attempt: k, ms: Date.now() - t0, err: String(e), stack: e?.stack })); }
    }
    if (!fork) return { error: String(lastErr), retries };
    const run = this.env.RUN.get(this.env.RUN.idFromName('run'));
    const root = await run.rootSha();
    const snap = await run.snapshot(root);
    await this.ctx.storage.put('st', { i, cfg, remote: fork.remote, token: fork.token, tip: root, snap, task: null, seed: i + 1 });
    return { forkMs, retries };
  }
  async go() { await this.ctx.storage.setAlarm(Date.now() + Math.random() * 5000); }

  async alarm() {
    const st = await this.ctx.storage.get('st');
    if (!st) return; // its fork failed: this agent never started
    const run = this.env.RUN.get(this.env.RUN.idFromName('run'));
    if (!st.task) {
      const task = await run.task(st.i);
      if (!task) { await run.agentDone(); return; }
      st.task = task;
      await this.ctx.storage.put('st', st);
      const work = (st.cfg.workMinS + Math.random() * (st.cfg.workMaxS - st.cfg.workMinS)) * 1000;
      return this.ctx.storage.setAlarm(Date.now() + work);
    }
    // Work is done: commit the change on top of this agent's fork and push it.
    const objs = new Objects();
    const snap = new Map(st.snap);
    for (const [p, t] of st.task.files) snap.set(p, objs.blob(t));
    const commit = objs.commit(objs.tree(snap), [st.tip], `#${st.task.id} ${st.task.text}`, Date.now());
    const t0 = Date.now();
    let r;
    try { r = await push({ remote: st.remote, token: st.token, oldSha: st.tip, newSha: commit, objs: [...objs.map.values()] }); }
    catch (e) { r = { ok: false, status: 0, bytes: 0, detail: String(e) }; }
    const ms = Date.now() - t0;
    if (r.ok) { st.tip = commit; st.snap = [...snap.entries()]; }
    await run.submitted(st.task.id, { ok: r.ok, status: r.status, bytes: r.bytes, detail: r.detail, ms, commit });
    st.task = null;
    await this.ctx.storage.put('st', st);
    await this.ctx.storage.setAlarm(Date.now() + 500);
  }
}
