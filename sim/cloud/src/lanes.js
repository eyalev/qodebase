// Lanes (docs/board/TASKS.md L3): instead of one merge queue for the whole repo, one landing Durable Object per
// area of the code. Area = module (src/m<k>/); lane k owns the modules m with m % N == k and is the only one that
// writes them. Every lane lands its own trains (replay by intent, the project's tests, one push) on the SAME main
// ref with compare-and-swap: a stale push re-reads main's root and src trees, overlays its own module trees and
// retries, so contention on the one ref is measured, not hidden.
// Cross changes (files in more than one lane, or a hot shared file: routes.ts, schema.ts, package.json) go to lane
// X, the slower coordinated lane: every xEveryS it freezes the lanes its train touches (each finishes its train in
// flight and hands over its files), lands the train on the full tree, then thaws them with the new files.
//
// The workload is the same for every N: a task is "cross" (touches more than one module or a hot file) with
// probability crossShare, else it stays inside one module. With N = 1 there is one lane and no X: today's design.
import { DurableObject } from 'cloudflare:workers';
import { randomOp, makeOp, check, slotName } from '../../real/project.mjs';
import { Objects, push } from './gitpush.js';

const log = (event, data) => console.log(JSON.stringify({ ts: new Date().toISOString(), module: 'qbsim-lanes', event, ...data }));
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const HOT = new Set(['src/routes.ts', 'src/schema.ts', 'package.json']);
export const moduleOf = (p) => { const m = /^src\/m(\d+)\//.exec(p); return m ? +m[1] : null; };
/** Where a change lands: a lane number, or 'X'. `paths` = files it writes plus files it reads (addCall's target). */
export function routeOf(paths, n) {
  if (n === 1) return 0;
  const lanes = new Set();
  for (const p of paths) { if (HOT.has(p)) return 'X'; const m = moduleOf(p); if (m == null) return 'X'; lanes.add(m % n); }
  return lanes.size === 1 ? [...lanes][0] : 'X';
}
/** Is a change "cross" (the workload knob): more than one module, or a hot file. Independent of N. */
export function isCross(paths) {
  const mods = new Set();
  for (const p of paths) { if (HOT.has(p)) return true; const m = moduleOf(p); if (m == null) return true; mods.add(m); }
  return mods.size > 1;
}
export const laneName = (runId, k) => `${runId}:${typeof k === 'number' ? `L${k}` : k}`;
const normMode = (e) => (e.type === 'tree' || /^0?40000$/.test(String(e.mode)) ? '40000' : '100644');
const pct = (a, p) => { if (!a.length) return null; const x = [...a].sort((u, v) => u - v); return x[Math.min(x.length - 1, Math.floor(p * x.length))]; };
const CHUNK = 400;

/** Build main's new root tree: main's current root and src entries (`base`), with every module that has a changed
 *  file rebuilt from `snap`, and changed hot files replaced. Unchanged subtrees are referenced by hash. */
export function compose(objs, snap, changed, base) {
  const { modTree, files } = moduleTrees(objs, snap, changed);
  return overlay(objs, base, modTree, files);
}
/** The trees of every module with a changed file (built from `snap`), and the changed hot files' blobs. */
export function moduleTrees(objs, snap, changed) {
  const mods = new Set(), files = new Map();
  for (const p of changed) { const m = moduleOf(p); if (m != null) mods.add(m); else files.set(p, snap.get(p)); }
  const modTree = new Map();
  for (const m of mods) {
    const pre = `src/m${m}/`, es = [];
    for (const [p, sha] of snap) if (p.startsWith(pre)) es.push({ name: p.slice(pre.length), mode: '100644', sha });
    modTree.set(`m${m}`, objs.treeOf(es));
  }
  return { modTree, files };
}
/** main's root and src entries with module trees and hot files replaced. */
export function overlay(objs, base, modTree, files) {
  const src = base.src.map((e) => (modTree.has(e.name) ? { ...e, sha: modTree.get(e.name) } : files.has(`src/${e.name}`) ? { ...e, sha: files.get(`src/${e.name}`) } : e));
  for (const [name, sha] of modTree) if (!base.src.some((e) => e.name === name)) src.push({ name, mode: '40000', sha });
  const srcSha = objs.treeOf(src);
  const root = base.root.map((e) => (e.name === 'src' ? { ...e, sha: srcSha } : files.has(e.name) ? { ...e, sha: files.get(e.name) } : e));
  return { tree: objs.treeOf(root), root, src };
}

export class Lane extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.s = null; this.dirty = new Set(); this.trainP = null; }

  // ---- state (written after every step: a Durable Object can be evicted at any moment) ----
  async persist() {
    const s = this.s;
    await this.ctx.storage.put('core', {
      runId: s.runId, k: s.k, n: s.n, cfg: s.cfg, tag: s.tag, main: s.main, mods: s.mods, phase: s.phase, runFrom: s.runFrom, deadline: s.deadline,
      snap: [...s.snap.entries()], texts: [...new Set(s.snap.values())].map((h) => [h, s.text.get(h)]), queue: s.queue, base: s.base,
      m: s.m, series: s.series.slice(-300), seq: s.seq, frozen: s.frozen, nChanges: s.changes.length, pending: s.pending || [],
    });
    for (const c of this.dirty) await this.ctx.storage.put(`ch:${c}`, s.changes.slice(c * CHUNK, (c + 1) * CHUNK));
    this.dirty.clear();
  }
  async ensure() {
    if (this.s) return true;
    const core = await this.ctx.storage.get('core');
    if (!core) return false;
    const changes = [];
    for (let c = 0; c * CHUNK < core.nChanges; c++) changes.push(...((await this.ctx.storage.get(`ch:${c}`)) || []));
    this.s = { ...core, snap: new Map(core.snap), text: new Map(core.texts), changes, rnd: mulberry32((Date.now() % 2 ** 31) ^ core.seq) };
    delete this.s.texts;
    this.s.m.restores = (this.s.m.restores || 0) + 1;
    log('lane_restored', { lane: core.tag, changes: changes.length, queue: core.queue.length });
    return true;
  }
  touch(c) { this.dirty.add(Math.floor((c.n - 1) / CHUNK)); }
  now() { return Math.round((Date.now() - (this.s.runFrom ?? Date.now())) / 1000); }
  ev(c, what, extra) { c.events.push(extra === undefined ? [this.now(), what] : [this.now(), what, extra]); this.touch(c); }
  stub(k) { return this.env.LANE.get(this.env.LANE.idFromName(laneName(this.s.runId, k))); }

  async init({ runId, k, n, cfg, main, files }) {
    await this.ctx.storage.deleteAll(); this.dirty.clear();
    const snap = new Map(), text = new Map(), objs = new Objects();
    for (const [p, t] of files) { const h = objs.blob(t); snap.set(p, h); text.set(h, t); }
    const mods = k === 'X' || k === 'C' ? [] : Array.from({ length: cfg.modules }, (_, m) => m).filter((m) => m % n === k);
    this.s = {
      runId, k, n, cfg, tag: typeof k === 'number' ? `L${k}` : k, main, mods, phase: 'ready', runFrom: null, deadline: null,
      snap, text, queue: [], base: null, changes: [], seq: 0, frozen: false, series: [], rnd: mulberry32(cfg.seed * 1000 + (typeof k === 'number' ? k : 999)),
      m: { tasks: 0, registered: 0, cross: 0, landed: 0, dropped: 0, testFails: 0, trains: 0, mainPushes: 0, mainPushFail: 0, mainPushMs: [], cas: 0, refreshes: 0,
        artifactsOps: 0, waitS: [], frozenMs: 0, freezes: 0, foreign: 0, errors: [] },
    };
    await this.persist();
    return { tag: this.s.tag, mods: mods.length };
  }
  async go({ runFrom, deadline }) {
    await this.ensure();
    Object.assign(this.s, { phase: 'run', runFrom, deadline });
    await this.persist();
    await this.ctx.storage.setAlarm(Date.now() + this.everyMs());
  }
  everyMs() { const c = this.s.cfg; return (this.s.k === 'C' ? c.combineEveryS : this.s.k === 'X' ? c.xEveryS : c.trainEveryS) * 1000; }
  async stop() {
    if (!(await this.ensure())) return;
    this.s.phase = 'done'; await this.ctx.storage.deleteAlarm(); await this.persist();
  }

  // ---- tasks: the home lane makes them (same workload for every N), and routes each to the lane that lands it ----
  pick(mods) {
    const r = this.s.rnd, mm = mods[Math.min(mods.length - 1, Math.floor(-Math.log(1 - r()) * Math.max(1, (8 * mods.length) / 50)))];
    return `src/m${mm}/f${Math.floor(r() * 8)}.ts`;
  }
  areaOp(get) {
    const s = this.s, r = s.rnd, file = this.pick(s.mods), slot = ['a', 'b', 'c'][Math.floor(r() * 3)], u = r();
    if (u < 0.59) return makeOp('edit', { file, slot, value: 10 + Math.floor(r() * 990) });
    if (u < 0.88) {
      const m = moduleOf(file), target = `src/m${m}/f${(Number(file.match(/f(\d+)\.ts$/)[1]) + 1 + Math.floor(r() * 7)) % 8}.ts`;
      return makeOp('addCall', { file, slot, target, targetSlot: ['a', 'b', 'c'][Math.floor(r() * 3)] });
    }
    const cur = slotName(get(file) || '', slot) || 'fn';
    return makeOp('rename', { file, slot, to: `${cur.replace(/V\w+$/, '')}V${s.tag}x${++s.seq}` });
  }
  crossOp(get) {
    const s = this.s, all = Array.from({ length: s.cfg.modules }, (_, m) => m);
    const op = randomOp(s.rnd, () => this.pick(all), get);
    // Names unique per lane: two lanes in different isolates must not invent the same name by accident.
    if (op.kind === 'addFunction') return makeOp('addFunction', { ...op.args, name: `${op.args.name}${s.tag}x${++s.seq}` });
    if (op.kind === 'rename') return makeOp('rename', { ...op.args, to: `${op.args.to}${s.tag}x${++s.seq}` });
    return op;
  }
  async task(agent) {
    if (!(await this.ensure())) return null;
    const s = this.s;
    if (s.phase !== 'run' || Date.now() > s.deadline) return null;
    const get = (p) => (s.snap.has(p) ? s.text.get(s.snap.get(p)) : null), paths = () => s.snap.keys();
    for (let i = 0; i < 16; i++) {
      const cross = s.rnd() < s.cfg.crossShare;
      const op = cross ? this.crossOp(get) : this.areaOp(get);
      const out = op.apply(get, paths);
      if (!out || !out.size) continue;
      const touched = [...out.keys(), ...(op.args.target ? [op.args.target] : [])];
      if (isCross(touched) !== cross) continue; // keep the mix exact
      const route = routeOf(touched, s.n);
      const rec = { agent, opKind: op.kind, opArgs: op.args, text: op.text, files: [...out.keys()], touched, cross };
      s.m.tasks++; if (cross) s.m.cross++;
      const id = route === s.k ? this.register(rec) : await this.stub(route).registerRpc(rec);
      return { id, to: route, text: op.text, files: [...out.entries()] };
    }
    return null;
  }
  register(rec) {
    const s = this.s, n = s.changes.length + 1;
    const c = { n, id: `${s.tag}-${n}`, ...rec, lanes: [...new Set(rec.touched.map((p) => (HOT.has(p) ? 'X' : moduleOf(p) % s.n)))], created: this.now(), events: [], state: 'work' };
    this.ev(c, 'asked', rec.text);
    s.changes.push(c);
    s.m.registered++;
    return c.id;
  }
  async registerRpc(rec) { await this.ensure(); return this.register(rec); }
  async submitted(id, r) {
    if (!(await this.ensure())) return;
    const s = this.s, c = s.changes[Number(id.split('-')[1]) - 1];
    if (!c) return;
    s.m.agentPushes = (s.m.agentPushes || 0) + 1;
    if (!r.ok) { s.m.agentPushFail = (s.m.agentPushFail || 0) + 1; s.m.errors.push(`agent push ${r.status}: ${r.detail}`.slice(0, 160)); }
    c.state = 'mergeWait'; c.queuedAt = this.now(); this.ev(c, 'mergeWait');
    s.queue.push(c.n);
  }

  // ---- landing ----
  async alarm() {
    try {
      if (!(await this.ensure()) || this.s.phase === 'done') return;
      if (!this.s.frozen) { this.trainP = this.s.k === 'C' ? this.combine() : this.s.k === 'X' ? this.xTrain() : this.train(); await this.trainP; this.trainP = null; }
      this.sample();
      await this.persist();
      await this.ctx.storage.setAlarm(Date.now() + this.everyMs());
    } catch (e) {
      this.trainP = null;
      log('lane_alarm_error', { lane: this.s?.tag, err: String(e), stack: e?.stack });
      if (this.s) { this.s.m.errors.push(`alarm: ${String(e)}`.slice(0, 200)); await this.ctx.storage.setAlarm(Date.now() + 2000); }
    }
  }
  sample() {
    const s = this.s;
    s.series.push({ t: this.now(), landed: s.m.landed, queue: s.queue.length, cas: s.m.cas, frozenMs: s.m.frozenMs });
  }
  async refreshBase() {
    const s = this.s, repo = await this.env.ARTIFACTS.get(s.main.name);
    const [head] = await repo.log({ limit: 1 });
    const rootE = (await repo.readTree(head.treeHash)) || [];
    const srcE = rootE.find((e) => e.name === 'src');
    const src = (await repo.readTree(srcE.hash)) || [];
    const norm = (es) => es.map((e) => ({ name: e.name, mode: normMode(e), sha: e.hash }));
    s.base = { tip: head.hash, root: norm(rootE), src: norm(src) };
    s.m.refreshes++; s.m.artifactsOps += 4;
  }
  /** Replay `ids` on `snap`; returns the new snap, the changed paths, and the changes that landed (or null). */
  replay(ids, objs, own) {
    const s = this.s;
    let snap = new Map(s.snap);
    const landed = [], changed = new Set();
    // Failures already in this lane's view before the train are not the change's fault (and must never be: one stale
    // read copy once failed every change of every lane, 2026-10-12). Counted separately; should stay 0.
    const tget = (sn) => (p) => (sn.has(p) ? s.text.get(sn.get(p)) : null);
    const before = new Set(check(tget(snap), () => snap.keys()));
    if (before.size) { s.m.viewFails = (s.m.viewFails || 0) + 1; s.m.viewFailSample = [...before].slice(0, 3); }
    for (const n of ids) {
      const c = s.changes[n - 1];
      const op = makeOp(c.opKind, c.opArgs);
      const get = (p) => (snap.has(p) ? (s.text.get(snap.get(p)) ?? null) : null), paths = () => snap.keys();
      const out = op.apply(get, paths);
      if (!out || !out.size) { s.m.dropped++; c.state = 'dropped'; this.ev(c, 'dropped', 'another change already covers it'); continue; }
      const outside = [...out.keys()].filter((p) => !own(p));
      if (outside.length) { s.m.dropped++; c.state = 'dropped'; this.ev(c, 'dropped', `now needs files outside this lane: ${outside.slice(0, 3).join(', ')}`); s.m.outside = (s.m.outside || 0) + 1; continue; }
      const next = new Map(snap);
      for (const [p, t] of out) { const h = objs.blob(t); s.text.set(h, t); next.set(p, h); }
      const fails = check(tget(next), () => next.keys()).filter((f) => !before.has(f));
      if (fails.length) {
        s.m.testFails++; s.m.dropped++; c.state = 'dropped'; this.ev(c, 'train tests failed', fails.slice(0, 3));
        (s.m.failSamples ||= []).push({ id: c.id, op: c.opKind, files: c.files, fails: fails.slice(0, 2) }); if (s.m.failSamples.length > 8) s.m.failSamples.shift();
        log('lane_test_failed', { lane: s.tag, id: c.id, op: c.opKind, args: c.opArgs, files: c.files, fails: fails.slice(0, 3) });
        continue;
      }
      for (const p of out.keys()) changed.add(p);
      snap = next; landed.push(c);
    }
    return { snap, changed, landed };
  }
  /** Push a train's tree to main with compare-and-swap; on a stale ref re-read main's trees and retry. */
  async land(objs, snap, changed, landed) {
    const s = this.s;
    for (let attempt = 0; attempt < 10; attempt++) {
      if (!s.base) await this.refreshBase();
      const { tree, root, src } = compose(objs, snap, changed, s.base);
      const commit = objs.commit(tree, [s.base.tip], `${s.tag}: land ${landed.map((c) => `#${c.id}`).join(' ')}`, Date.now());
      const t0 = Date.now();
      const r = await push({ remote: s.main.remote, token: s.main.token, oldSha: s.base.tip, newSha: commit, objs: [...objs.map.values()] });
      s.m.mainPushes++; s.m.artifactsOps++;
      if (r.ok) {
        s.m.mainPushMs.push(Date.now() - t0); if (s.m.mainPushMs.length > 2000) s.m.mainPushMs = s.m.mainPushMs.slice(-1000);
        s.base = { tip: commit, root, src }; // main is our tree now: the next train overlays on it (a stale push re-reads)
        return { ok: true, commit, ms: Date.now() - t0 };
      }
      if (/stale ref|non-fast-forward|fetch first/.test(r.detail || '')) { s.m.cas++; s.base = null; await new Promise((ok) => setTimeout(ok, 50 + Math.random() * 250)); continue; }
      // Artifacts takes one receive-pack per repo at a time and refuses the others (seen 2026-10-12 with 3 lanes).
      if (/receive_pack_busy/.test(r.detail || '')) { s.m.busy = (s.m.busy || 0) + 1; await new Promise((ok) => setTimeout(ok, 100 + Math.random() * 400)); continue; }
      s.m.mainPushFail++; s.m.errors.push(`main push ${r.status}: ${r.detail}`.slice(0, 200));
      return { ok: false };
    }
    s.m.mainPushFail++; s.m.errors.push('main push: stale or busy 10 times');
    return { ok: false };
  }
  /** A train's files into the lane's snapshot. Only the files it changed: X may have updated other files (a thaw)
   *  while the train ran, and writing back the whole copy taken at its start lost them (2026-10-12). */
  adopt(snap, changed) { for (const p of changed) this.s.snap.set(p, snap.get(p)); }
  async finish(landed, snap, res, changed) {
    const s = this.s;
    if (!res.ok) { for (const c of landed.slice().reverse()) { c.state = 'mergeWait'; s.queue.unshift(c.n); } return; }
    this.adopt(snap, changed);
    for (const c of landed) {
      c.state = 'landed'; c.landedAt = this.now(); s.m.landed++;
      if (c.queuedAt != null) s.m.waitS.push(c.landedAt - c.queuedAt);
      this.ev(c, 'landed', `${res.commit.slice(0, 7)} (push ${res.ms} ms)`);
    }
    if (s.m.waitS.length > 4000) s.m.waitS = s.m.waitS.slice(-2000);
    // Drop texts no longer in the snapshot (memory).
    if (++s.m.trains % 10 === 0) { const live = new Set(s.snap.values()); for (const h of s.text.keys()) if (!live.has(h)) s.text.delete(h); }
    await this.persist();   // main moved: save before anything else can reset this object
  }
  async train() {
    const s = this.s;
    if (!s.queue.length) return;
    const ids = s.queue.splice(0, s.cfg.trainMax);
    const objs = new Objects();
    const own = s.n === 1 ? () => true : (p) => !HOT.has(p) && moduleOf(p) != null && moduleOf(p) % s.n === s.k;
    const { snap, changed, landed } = this.replay(ids, objs, own);
    if (!landed.length) return;
    if (s.cfg.door === 'combine') return this.hand(objs, snap, changed, landed);
    await this.finish(landed, snap, await this.land(objs, snap, changed, landed), changed);
  }
  // ---- door 'combine': a lane hands its tested train to the main door (C), which puts every lane's trains into
  // one commit per round. C never replays or tests (areas are disjoint; cross changes went through X). ----
  async hand(objs, snap, changed, landed) {
    const s = this.s;
    const { modTree, files } = moduleTrees(objs, snap, changed);
    const r = await this.stub('C').handoff({ from: s.k, ids: landed.map((c) => c.n), mods: [...modTree], files: [...files], objects: [...objs.map].map(([sha, o]) => [sha, o.type, o.body]) });
    if (!r?.ok) { for (const c of landed.slice().reverse()) { c.state = 'mergeWait'; s.queue.unshift(c.n); } s.m.errors.push(`handoff: ${r?.error || 'failed'}`.slice(0, 160)); return; }
    this.adopt(snap, changed);
    for (const c of landed) { c.state = 'handed'; c.handedAt = this.now(); this.ev(c, 'handed to the main door'); }
    s.m.handed = (s.m.handed || 0) + landed.length;
    if (++s.m.trains % 10 === 0) { const live = new Set(s.snap.values()); for (const h of s.text.keys()) if (!live.has(h)) s.text.delete(h); }
    // Saved now, not at the end of the alarm: the handoff cannot be taken back, and a reset in between brought this
    // lane back with its files from before the train; X's next train then put an old routes.ts on main (x20 cell,
    // 2026-10-12: 2 test failures on main, 19 resets that run).
    await this.persist();
  }
  async landedInMain({ ids, commit, ms }) {
    await this.ensure();
    const s = this.s;
    for (const n of ids) {
      const c = s.changes[n - 1]; if (!c || c.state === 'landed') continue;
      c.state = 'landed'; c.landedAt = this.now(); s.m.landed++;
      if (c.queuedAt != null) s.m.waitS.push(c.landedAt - c.queuedAt);
      this.ev(c, 'landed', `${commit.slice(0, 7)} (main door push ${ms} ms)`);
    }
    if (s.m.waitS.length > 4000) s.m.waitS = s.m.waitS.slice(-2000);
    await this.persist();   // a lost 'landed' left the lanes' count 51 short of main's in the x20 cell
  }
  async handoff(h) {
    await this.ensure();
    const s = this.s;
    s.pending = s.pending || [];
    s.pending.push(h);
    s.m.handoffs = (s.m.handoffs || 0) + 1;
    await this.persist();   // accepted = kept: a handoff only in memory was lost with a reset
    return { ok: true };
  }
  async combine() {
    const s = this.s;
    if (!s.pending?.length) return;
    const round = s.pending.splice(0, s.pending.length);
    const objs = new Objects(), modTree = new Map(), files = new Map();
    for (const h of round) {
      for (const [sha, type, body] of h.objects) objs.map.set(sha, { type, body });
      for (const [k, v] of h.mods) modTree.set(k, v);   // in arrival order: a later train of the same module wins
      for (const [k, v] of h.files) files.set(k, v);
    }
    for (let attempt = 0; attempt < 10; attempt++) {
      if (!s.base) await this.refreshBase();
      const { tree, root, src } = overlay(objs, s.base, modTree, files);
      // Every change id in the message (#L3-17 …), so a clone of main can check each landing (verify.mjs).
      const tag = (h) => (h.from === 'X' ? 'X' : `L${h.from}`);
      const commit = objs.commit(tree, [s.base.tip], `C: land ${round.map((h) => `${tag(h)}x${h.ids.length}`).join(' ')}\n\n${round.flatMap((h) => h.ids.map((n) => `#${tag(h)}-${n}`)).join(' ')}`, Date.now());
      const t0 = Date.now();
      const r = await push({ remote: s.main.remote, token: s.main.token, oldSha: s.base.tip, newSha: commit, objs: [...objs.map.values()] });
      s.m.mainPushes++; s.m.artifactsOps++;
      if (r.ok) {
        const ms = Date.now() - t0;
        s.m.mainPushMs.push(ms); if (s.m.mainPushMs.length > 2000) s.m.mainPushMs = s.m.mainPushMs.slice(-1000);
        s.base = { tip: commit, root, src };
        await this.persist();   // main moved with this round: saved before the lanes are told
        const byLane = new Map();
        for (const h of round) byLane.set(h.from, [...(byLane.get(h.from) || []), ...h.ids]);
        await Promise.all([...byLane].map(([l, ids]) => this.stub(l).landedInMain({ ids, commit, ms }).catch((e) => s.m.errors.push(`notify ${l}: ${e}`.slice(0, 160)))));
        const n = round.reduce((a, h) => a + h.ids.length, 0);
        s.m.landed += n; s.m.rounds = (s.m.rounds || 0) + 1; s.m.perRound = (s.m.perRound || []).concat(n).slice(-2000);
        return;
      }
      if (/stale ref|non-fast-forward|fetch first/.test(r.detail || '')) { s.m.cas++; s.base = null; continue; }
      if (/receive_pack_busy/.test(r.detail || '')) { s.m.busy = (s.m.busy || 0) + 1; await new Promise((ok) => setTimeout(ok, 100 + Math.random() * 300)); continue; }
      s.m.mainPushFail++; s.m.errors.push(`main push ${r.status}: ${r.detail}`.slice(0, 200)); break;
    }
    s.pending.unshift(...round); // nothing is lost: next round
  }

  // ---- lane X: the coordinated lane ----
  /** Freeze: finish the train in flight, stop landing, hand over this lane's files (X lands on top of them). */
  async freeze() {
    await this.ensure();
    if (this.trainP) await this.trainP.catch(() => {});
    this.s.frozen = true; this.s.frozenAt = Date.now(); this.s.m.freezes++;
    const s = this.s, files = [];
    for (const [p, h] of s.snap) { const m = moduleOf(p); if (m != null && m % s.n === s.k) files.push([p, s.text.get(h)]); }
    await this.persist();
    return files;
  }
  /** Thaw (or, for a lane X did not touch, refresh): take X's new files, land again. */
  async thaw({ files, unfreeze }) {
    await this.ensure();
    const s = this.s, objs = new Objects();
    for (const [p, t] of files) { const h = objs.blob(t); s.text.set(h, t); s.snap.set(p, h); }
    if (unfreeze && s.frozen) { s.m.frozenMs += Date.now() - (s.frozenAt || Date.now()); s.frozen = false; }
    s.base = null;
    await this.persist();
  }
  async xTrain() {
    const s = this.s;
    if (!s.queue.length) return;
    const ids = s.queue.splice(0, s.cfg.xTrainMax);
    const lanes = new Set();
    for (const n of ids) for (const l of s.changes[n - 1].lanes) if (l !== 'X') lanes.add(l);
    const t0 = Date.now();
    const handed = await Promise.all([...lanes].map((l) => this.stub(l).freeze()));
    const objs = new Objects();
    for (const files of handed) for (const [p, t] of files) { const h = objs.blob(t); s.text.set(h, t); s.snap.set(p, h); }
    // X may write only the hot files and the frozen lanes' modules.
    const own = (p) => HOT.has(p) || (moduleOf(p) != null && lanes.has(moduleOf(p) % s.n));
    let res = { ok: false }, out = { landed: [] };
    try {
      out = this.replay(ids, objs, own);
      if (out.landed.length && s.cfg.door === 'combine') { await this.hand(objs, out.snap, out.changed, out.landed); res = { ok: out.landed.every((c) => c.state === 'handed') }; }
      else if (out.landed.length) { res = await this.land(objs, out.snap, out.changed, out.landed); await this.finish(out.landed, out.snap, res, out.changed); }
    } finally {
      // Every lane gets the frozen lanes' whole current files, not only what X changed: a lane that saw X's new file
      // next to an old copy of its neighbour (renamed meanwhile inside the frozen lane) failed every change after that.
      const paths = new Set([...handed.flatMap((h) => h.map(([p]) => p)), ...(res.ok ? out.changed : [])]);
      const files = [...paths].map((p) => [p, s.text.get(s.snap.get(p))]).filter(([, t]) => t != null);
      const all = Array.from({ length: s.n }, (_, l) => l);
      await Promise.all(all.map((l) => (lanes.has(l) || files.length ? this.stub(l).thaw({ files, unfreeze: lanes.has(l) }) : null)));
      s.m.xHoldMs = (s.m.xHoldMs || 0) + (Date.now() - t0);
      log('x_train', { runId: s.runId, ids: ids.length, landed: out.landed.length, lanes: lanes.size, ok: res.ok, ms: Date.now() - t0 });
    }
  }

  async summary() {
    if (!(await this.ensure())) return null;
    const s = this.s, minutes = Math.max(1 / 60, this.now() / 60);
    const states = {};
    for (const c of s.changes) if (c.state !== 'landed' && c.state !== 'dropped') states[c.state] = (states[c.state] || 0) + 1;
    return {
      lane: s.tag, mods: s.mods.length, phase: s.phase, frozen: s.frozen, tasks: s.m.tasks, cross: s.m.cross, registered: s.m.registered, landed: s.m.landed,
      landedPerHour: Math.round((s.m.landed / minutes) * 60), dropped: s.m.dropped, testFails: s.m.testFails, outside: s.m.outside || 0, queue: s.queue.length, states,
      trains: s.m.trains, mainPushes: s.m.mainPushes, mainPushFail: s.m.mainPushFail, mainPushMsP50: pct(s.m.mainPushMs, 0.5), mainPushMsP90: pct(s.m.mainPushMs, 0.9),
      cas: s.m.cas, busy: s.m.busy || 0, refreshes: s.m.refreshes, waitSP50: pct(s.m.waitS, 0.5), waitSP90: pct(s.m.waitS, 0.9), frozenMs: s.m.frozenMs, freezes: s.m.freezes, xHoldMs: s.m.xHoldMs || 0,
      handed: s.m.handed || 0, handoffs: s.m.handoffs || 0, rounds: s.m.rounds || 0, pending: (s.pending || []).length, perRoundP50: pct(s.m.perRound || [], 0.5),
      agentPushes: s.m.agentPushes || 0, agentPushFail: s.m.agentPushFail || 0, artifactsOps: s.m.artifactsOps, restores: s.m.restores || 0,
      errors: s.m.errors.slice(0, 5), errorCount: s.m.errors.length, failSamples: s.m.failSamples || [], viewFails: s.m.viewFails || 0, viewFailSample: s.m.viewFailSample || [],
    };
  }
  async seriesOf() { return (await this.ensure()) ? { lane: this.s.tag, series: this.s.series } : null; }
}
