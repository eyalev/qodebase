// qodebase fleet (F1, docs/board/TASKS.md 'Fleet on Workers AI'): hundreds to thousands of cheap Workers AI agents add
// documentation comments to a big real codebase (VS Code src/vs, our own Artifacts copy in namespace qbfleet, never pushed
// upstream). Every change is verified to leave the code unchanged (src/doc.js: same syntax-tree tokens with comments
// skipped) and lands through lanes by folder.
//   Run (one per run)  controls (start/pause/resume/stop), the file queue, per-file records, auto-pause, status page
//   Agent (N)          loop: take a file -> read it from main -> Workers AI (gateway qodebase-fleet) -> insert -> verify
//   Lander (one)       per-folder lanes; every few seconds one commit per lane with ready files, pushed to main in order
//   Budget (one)       the account-day cap across all fleet runs ($50 per UTC day; no run after FLEET_LAST_DAY)
// No fork per agent (manager, 2026-10-13): a comment-only change to one file needs none; the lanes do the git.
import { DurableObject } from 'cloudflare:workers';
import { Objects, push } from '../../cloud/src/gitpush.js';
import { targets, insert, verify, prompt, parseAnswer } from './doc.js';

const log = (event, f = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), module: 'fleet', event, ...f }));
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const MAIN = 'fleet-main';
// The repo handle has no remote URL (only create/import return it): the namespace's fixed git endpoint.
const REMOTE = 'https://887d7234a6b8d65ad355a4f6684cab67.artifacts.cloudflare.net/git/qbfleet/fleet-main.git';
const GATEWAY = 'qodebase-fleet';
// $ per million tokens [input, output] per model: the FLEET_PRICES var (JSON). An unpriced model is refused, never priced at 0.
const DAY_CAP_USD = 50;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/page') return new Response(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (url.pathname === '/status' && request.method === 'GET') return json(await run(env).status());
    if (request.headers.get('x-fleet-key') !== env.FLEET_KEY) return json({ error: 'key required' }, 401);
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    switch (url.pathname) {
      case '/import': return json(await importRepo(env, body));
      // VS Code is too big for Artifacts' import ('upstream unavailable'): an empty repo, then the laptop pushes src/vs.
      case '/create': { const c = await env.ARTIFACTS.create(MAIN, { description: 'VS Code src/vs (MIT) for the fleet experiment; never pushed upstream', setDefaultBranch: 'main' }); using r = await env.ARTIFACTS.get(MAIN); const t = await r.createToken('write', 3600); return json({ remote: c.remote || REMOTE, token: t.plaintext }); }
      case '/plan': return json(await plan(env, body));
      case '/start': return json(await run(env).start(body));
      case '/pause': return json(await run(env).pause(body.why || 'paused by hand'));
      case '/resume': return json(await run(env).resume());
      case '/stop': return json(await run(env).stop(body.why || 'stopped by hand'));
      case '/records': return new Response(await run(env).records(url.searchParams.get('run')), { headers: { 'content-type': 'application/x-ndjson' } });
      case '/budget': return json(await budget(env).status());
      case '/retire-v1': { await env.LANDER.get(env.LANDER.idFromName('fleet')).begin('retired', ''); return json({ ok: true }); }
      // An object that never goes idle (the Lander's 5 s alarm) keeps running old code after a deploy: restart it.
      case '/restart': { await lander(env).restart().catch(() => {}); await run(env).restart().catch(() => {}); return json({ ok: true }); }
      case '/clone-token': { using r = await env.ARTIFACTS.get(MAIN); const t = await r.createToken('read', 3600); return json({ remote: REMOTE, token: t.plaintext }); }
      default: return json({ error: 'not found' }, 404);
    }
  },
};

const run = (env) => env.RUN.get(env.RUN.idFromName('fleet'));
const budget = (env) => env.BUDGET.get(env.BUDGET.idFromName('account-day'));
// v2: the first Lander instance kept running pre-fix code on its 5 s alarm (it never went idle); /retire-v1 empties it.
const lander = (env) => env.LANDER.get(env.LANDER.idFromName('fleet-v2'));
// A lane is a folder (never a file name): src/vs/<top>, or three levels deep in the big trees (workbench, editor, platform).
const laneOf = (path) => { const d = path.split('/').slice(2, -1); return (d[0] === 'workbench' || d[0] === 'editor' || d[0] === 'platform' ? d.slice(0, 3) : d.slice(0, 1)).join('/') || 'vs'; };

/** One-time: VS Code (shallow) into Artifacts qbfleet/fleet-main. */
async function importRepo(env, b) {
  const r = await env.ARTIFACTS.import({ source: { url: b.url || 'https://github.com/microsoft/vscode', branch: b.branch || 'main', depth: 1 }, target: { name: MAIN, opts: { description: 'VS Code (MIT) for the fleet experiment; never pushed upstream' } } });
  return { name: r.name, remote: r.remote };
}

/** The files to work on: src/vs/**.ts (no tests, no .d.ts), with their blob hashes, from main's tree. */
async function plan(env, b) {
  using r = await env.ARTIFACTS.get(MAIN);
  const tip = (await r.log({ limit: 1 }))[0];
  if (!tip) return { error: 'main is empty (import still running?)' };
  const out = [];
  const walk = async (hash, prefix) => {
    for (const e of await r.readTree(hash)) {
      const p = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.type === 'tree') { if (e.name !== 'test' && e.name !== 'node_modules') await walk(e.hash, p); }
      else if (e.type === 'blob' && p.endsWith('.ts') && !p.endsWith('.d.ts') && !p.endsWith('.test.ts')) out.push({ path: p, hash: e.hash });
    }
  };
  // Down to src/vs only.
  let h = tip.treeHash;
  for (const part of ['src', 'vs']) { const e = (await r.readTree(h)).find((x) => x.name === part && x.type === 'tree'); if (!e) return { error: `no ${part}/` }; h = e.hash; }
  await walk(h, 'src/vs');
  return { base: tip.hash, files: out.length, sample: out.slice(0, 3) };
}

// ---- Budget: the account-day cap across all fleet runs --------------------------------
export class Budget extends DurableObject {
  day() { return new Date().toISOString().slice(0, 10); }
  async check() {
    const env = this.env;
    const day = this.day();
    const last = env.FLEET_LAST_DAY || '2026-10-14';
    if (day > last) return { ok: false, why: `the fleet is off after ${last} (set FLEET_LAST_DAY to re-enable)` };
    const spent = (await this.ctx.storage.get(`d:${day}`)) || 0;
    if (spent >= DAY_CAP_USD) return { ok: false, why: `account-day cap reached: $${spent.toFixed(2)} of $${DAY_CAP_USD} on ${day}` };
    return { ok: true, day, spent, left: DAY_CAP_USD - spent };
  }
  async spend(usd) { const k = `d:${this.day()}`; const v = ((await this.ctx.storage.get(k)) || 0) + usd; await this.ctx.storage.put(k, v); return v; }
  async status() { return { cap: DAY_CAP_USD, lastDay: this.env.FLEET_LAST_DAY || '2026-10-14', days: Object.fromEntries(await this.ctx.storage.list({ prefix: 'd:' })) }; }
}

// ---- Run: the controller ------------------------------------------------------------------
const DEFAULTS = { agents: 10, maxFiles: 10, model: null, budgetUsd: 1, maxPerMin: 100, planUsdPerMin: 0.5,
  pause: { rateLimitShare: 0.05, modelErrorShare: 0.05, verifyFailShare: 0.10, landWaitP90S: 300, window: 40 } };

export class Run extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS rec (run TEXT, file TEXT, status TEXT, reason TEXT, model TEXT, agent INT, at INT, ms INT, usd REAL, tin INT, tout INT, comments INT, landed_at INT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS q (run TEXT, i INT, path TEXT, hash TEXT, taken INT DEFAULT 0, PRIMARY KEY (run, i))`);
  }
  async st() { return (await this.ctx.storage.get('s')) || null; }
  async save(s) { await this.ctx.storage.put('s', s); }

  async start(opts) {
    const cur = await this.st();
    if (cur && (cur.state === 'running' || cur.state === 'paused')) return { error: `run ${cur.runId} is ${cur.state}: stop it first` };
    const b = await budget(this.env).check();
    if (!b.ok) return { error: b.why };
    const cfg = { ...DEFAULTS, ...opts, pause: { ...DEFAULTS.pause, ...(opts.pause || {}) } };
    if (!cfg.model || !PRICES_OF(this.env)[cfg.model]) return { error: `model required, with a price: one of ${Object.keys(PRICES_OF(this.env)).join(', ') || '(none set: FLEET_PRICES)'}` };
    cfg.agents = Math.max(1, Math.min(2000, Number(cfg.agents) || 10));
    cfg.budgetUsd = Math.min(Number(cfg.budgetUsd) || 1, b.left);
    // One walk of main's src/vs (~800 folders): the files with their blob hashes, lanes interleaved, and main's tip.
    const { base, files } = await listFiles(this.env);
    const p = { base };
    const pick = files.slice(0, Math.max(1, Math.min(files.length, Number(cfg.maxFiles) || 10)));
    const runId = `f${Date.now().toString(36)}`;
    pick.forEach((f, i) => this.sql.exec(`INSERT INTO q (run, i, path, hash) VALUES (?, ?, ?, ?)`, runId, i, f.path, f.hash));
    const s = { runId, state: 'running', cfg, base: p.base, startedAt: Date.now(), files: pick.length, next: 0, usd: 0, calls: 0,
      counts: { queued: pick.length, model: 0, verify: 0, ready: 0, landed: 0, skipped: 0, verify_fail: 0, model_error: 0, rate_limited: 0, rejected: 0 },
      recent: [], perMin: {}, pauses: [], agentsDone: 0 };
    await this.save(s);
    await lander(this.env).begin(runId, p.base);
    for (let i = 0; i < cfg.agents; i++) await this.env.AGENT.get(this.env.AGENT.idFromName(`${runId}-${i}`)).begin(runId, i);
    log('run_started', { runId, agents: cfg.agents, files: pick.length, model: cfg.model, budgetUsd: cfg.budgetUsd });
    return { runId, agents: cfg.agents, files: pick.length, base: p.base };
  }

  /** An agent asks for its next file. */
  async next(runId) {
    const s = await this.st();
    if (!s || s.runId !== runId) return { stop: true };
    if (s.state === 'paused') return { wait: 15_000 };
    if (s.state !== 'running') return { stop: true };
    // The per-minute pace (calls) and the money.
    const minute = Math.floor(Date.now() / 60000);
    if ((s.perMin[minute]?.calls || 0) >= s.cfg.maxPerMin) return { wait: 5_000 };
    if (s.usd >= s.cfg.budgetUsd) { await this.autoPause(s, `run budget reached: $${s.usd.toFixed(3)} of $${s.cfg.budgetUsd}`); return { wait: 15_000 }; }
    const row = this.sql.exec(`SELECT i, path, hash FROM q WHERE run = ? AND taken = 0 ORDER BY i LIMIT 1`, runId).toArray()[0];
    if (!row) return { stop: true };
    this.sql.exec(`UPDATE q SET taken = 1 WHERE run = ? AND i = ?`, runId, row.i);
    s.counts.queued--; s.counts.model++;
    (s.perMin[minute] ||= { calls: 0, usd: 0 }).calls++;
    await this.save(s);
    return { file: { path: row.path, hash: row.hash }, model: s.cfg.model };
  }

  /** An agent's result for one file. */
  async done(runId, agent, r) {
    const s = await this.st();
    if (!s || s.runId !== runId) return;
    const usd = r.usd || 0;
    s.usd += usd; s.calls++;
    const minute = Math.floor(Date.now() / 60000);
    (s.perMin[minute] ||= { calls: 0, usd: 0 }).usd += usd;
    s.counts.model--;
    s.counts[r.status] = (s.counts[r.status] || 0) + 1;
    s.recent.push({ status: r.status, at: Date.now() }); if (s.recent.length > 200) s.recent.splice(0, s.recent.length - 200);
    this.sql.exec(`INSERT INTO rec (run, file, status, reason, model, agent, at, ms, usd, tin, tout, comments) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      runId, r.file, r.status, (r.reason || '').slice(0, 300), s.cfg.model, agent, Date.now(), r.ms || 0, usd, r.tin || 0, r.tout || 0, r.comments || 0);
    // Old per-minute buckets go (an hour kept).
    for (const k of Object.keys(s.perMin)) if (Number(k) < minute - 60) delete s.perMin[k];
    await this.save(s);
    if (usd) await budget(this.env).spend(usd);
    if (r.status === 'ready') await lander(this.env).add(runId, laneOf(r.file), r.file, r.text, Date.now());
    await this.checkAutoPause(s);
  }

  async landed(runId, files, at) {
    const s = await this.st();
    if (!s || s.runId !== runId) return;
    for (const f of files) this.sql.exec(`UPDATE rec SET landed_at = ?, status = 'landed' WHERE run = ? AND file = ? AND status = 'ready'`, at, runId, f);
    s.counts.ready = Math.max(0, (s.counts.ready || 0) - files.length); s.counts.landed += files.length;
    await this.save(s);
  }

  /** AUTO-PAUSE: any signal over its line pauses the run and pushes the reason. */
  async checkAutoPause(s) {
    if (s.state !== 'running') return;
    const p = s.cfg.pause, w = s.recent.slice(-p.window);
    if (w.length >= Math.min(p.window, 10)) {
      const share = (k) => w.filter((x) => x.status === k).length / w.length;
      if (share('rate_limited') > p.rateLimitShare) return this.autoPause(s, `rate limits (429) ${Math.round(share('rate_limited') * 100)}% of the last ${w.length}`);
      if (share('model_error') > p.modelErrorShare) return this.autoPause(s, `model errors ${Math.round(share('model_error') * 100)}% of the last ${w.length}`);
      if (share('verify_fail') > p.verifyFailShare) return this.autoPause(s, `verify failures ${Math.round(share('verify_fail') * 100)}% of the last ${w.length}`);
    }
    const minute = Math.floor(Date.now() / 60000) - 1;
    const last = s.perMin[minute];
    if (last && last.usd > s.cfg.planUsdPerMin) return this.autoPause(s, `spend $${last.usd.toFixed(3)} in the last minute, over the plan's $${s.cfg.planUsdPerMin}/min`);
    const waits = this.sql.exec(`SELECT landed_at - at AS w FROM rec WHERE run = ? AND landed_at IS NOT NULL ORDER BY at DESC LIMIT 100`, s.runId).toArray().map((x) => x.w).sort((a, b) => a - b);
    if (waits.length >= 10 && waits[Math.floor(waits.length * 0.9)] > p.landWaitP90S * 1000) return this.autoPause(s, `land wait p90 ${Math.round(waits[Math.floor(waits.length * 0.9)] / 1000)} s over ${p.landWaitP90S} s`);
    const b = await budget(this.env).check();
    if (!b.ok) return this.autoPause(s, b.why);
  }
  async autoPause(s, why) {
    if (s.state !== 'running') return;
    s.state = 'paused'; s.pauses.push({ at: Date.now(), why, auto: true });
    await this.save(s);
    log('auto_paused', { runId: s.runId, why });
    await pushover(this.env, `qodebase fleet paused: ${why}`, `Run ${s.runId}: ${s.counts.landed} landed, $${s.usd.toFixed(3)}. Resume after a fix: POST /resume.`);
  }
  async pause(why) { const s = await this.st(); if (!s || s.state !== 'running') return { error: 'nothing running' }; s.state = 'paused'; s.pauses.push({ at: Date.now(), why }); await this.save(s); return { state: s.state }; }
  async resume() {
    const s = await this.st(); if (!s || s.state !== 'paused') return { error: 'not paused' };
    const b = await budget(this.env).check(); if (!b.ok) return { error: b.why };
    s.state = 'running'; s.recent = []; await this.save(s); return { state: s.state };
  }
  async stop(why) { const s = await this.st(); if (!s) return { error: 'no run' }; s.state = 'stopped'; s.stoppedWhy = why; s.endedAt = Date.now(); await this.save(s); await lander(this.env).flush(s.runId); return { state: s.state }; }
  async restart() { await this.ctx.storage.sync(); this.ctx.abort('restart on the deployed code'); }
  async agentFinished(runId) { const s = await this.st(); if (!s || s.runId !== runId) return; s.agentsDone++; if (s.agentsDone >= s.cfg.agents && s.state === 'running') { s.state = 'done'; s.endedAt = Date.now(); await lander(this.env).flush(runId); } await this.save(s); }

  async status() {
    const s = await this.st();
    if (!s) return { state: 'none' };
    const waits = this.sql.exec(`SELECT landed_at - at AS w FROM rec WHERE run = ? AND landed_at IS NOT NULL`, s.runId).toArray().map((x) => x.w).sort((a, b) => a - b);
    const pct = (a, q) => (a.length ? Math.round(a[Math.floor(a.length * q)] / 1000) : null);
    const minute = Math.floor(Date.now() / 60000);
    const lastMin = s.perMin[minute - 1] || { calls: 0, usd: 0 };
    const reasons = this.sql.exec(`SELECT status, reason, COUNT(*) AS n FROM rec WHERE run = ? AND status NOT IN ('ready','landed','skipped') GROUP BY status, reason ORDER BY n DESC LIMIT 8`, s.runId).toArray();
    return { runId: s.runId, state: s.state, model: s.cfg.model, agents: s.cfg.agents, files: s.files, base: s.base, startedAt: s.startedAt, endedAt: s.endedAt || null,
      counts: s.counts, usd: Math.round(s.usd * 10000) / 10000, budgetUsd: s.cfg.budgetUsd, calls: s.calls, lastMinute: lastMin,
      landWaitS: { p50: pct(waits, 0.5), p90: pct(waits, 0.9) }, errors: reasons, pauses: s.pauses.slice(-5), budget: await budget(this.env).check(), lander: await lander(this.env).summary() };
  }
  async records(runId) {
    const s = await this.st(); const id = runId || s?.runId;
    return this.sql.exec(`SELECT * FROM rec WHERE run = ? ORDER BY at`, id).toArray().map((r) => JSON.stringify(r)).join('\n') + '\n';
  }
}
const PRICES_OF = (env) => { try { return JSON.parse(env.FLEET_PRICES || '{}'); } catch { return {}; } };

async function listFiles(env) {
  using r = await env.ARTIFACTS.get(MAIN);
  const tip = (await r.log({ limit: 1 }))[0];
  const out = [];
  let h = tip.treeHash;
  for (const part of ['src', 'vs']) h = (await r.readTree(h)).find((x) => x.name === part && x.type === 'tree').hash;
  const walk = async (hash, prefix) => {
    for (const e of await r.readTree(hash)) {
      const p = `${prefix}/${e.name}`;
      if (e.type === 'tree') { if (e.name !== 'test') await walk(e.hash, p); }
      else if (e.type === 'blob' && p.endsWith('.ts') && !p.endsWith('.d.ts') && !p.endsWith('.test.ts')) out.push({ path: p, hash: e.hash });
    }
  };
  await walk(h, 'src/vs');
  // Lanes interleaved: a small run touches many folders, like a big one.
  const by = new Map(); for (const f of out) { const k = laneOf(f.path); if (!by.has(k)) by.set(k, []); by.get(k).push(f); }
  const lanes = [...by.values()]; const mixed = [];
  for (let i = 0; mixed.length < out.length; i++) for (const l of lanes) if (l[i]) mixed.push(l[i]);
  return { base: tip.hash, files: mixed };
}

async function pushover(env, title, message) {
  if (!env.PUSHOVER_TOKEN || !env.PUSHOVER_USER) { log('push_unconfigured', { title }); return; }
  const f = new FormData(); f.set('token', env.PUSHOVER_TOKEN); f.set('user', env.PUSHOVER_USER); f.set('title', title.slice(0, 250)); f.set('message', message.slice(0, 1000));
  f.set('url', 'https://qbfleet.forqdev.workers.dev/page');
  const r = await fetch('https://api.pushover.net/1/messages.json', { method: 'POST', body: f }).catch((e) => ({ ok: false, status: String(e) }));
  log(r.ok ? 'push_sent' : 'push_failed', { title, status: r.status });
}

// ---- Agent: one file at a time --------------------------------------------------------------
export class Agent extends DurableObject {
  async begin(runId, i) { await this.ctx.storage.put({ runId, i }); await this.ctx.storage.setAlarm(Date.now() + Math.random() * 3000); }
  async alarm() {
    const runId = await this.ctx.storage.get('runId'), i = await this.ctx.storage.get('i');
    const R = run(this.env);
    const n = await R.next(runId);
    if (n.stop) { await R.agentFinished(runId); return; }
    if (n.wait) { await this.ctx.storage.setAlarm(Date.now() + n.wait); return; }
    const r = await this.work(n.file, n.model).catch((e) => ({ file: n.file.path, status: 'model_error', reason: `crash: ${String(e?.message || e).slice(0, 200)}` }));
    await R.done(runId, i, r);
    await this.ctx.storage.setAlarm(Date.now() + 50);
  }
  async work(file, model) {
    const t0 = Date.now();
    using repo = await this.env.ARTIFACTS.get(MAIN);
    const blob = await repo.readBlob(file.hash);
    if (!blob) return { file: file.path, status: 'model_error', reason: 'blob not found', ms: Date.now() - t0 };
    const text = new TextDecoder().decode(await blob.arrayBuffer());
    const tg = targets(file.path, text);
    if (!tg.length) return { file: file.path, status: 'skipped', reason: 'nothing to document', ms: Date.now() - t0 };
    let res;
    try {
      // Thinking off (GLM and Qwen spend the whole budget reasoning otherwise: the plumbing run's 3 answers had no JSON).
      res = await this.env.AI.run(model, { messages: [{ role: 'user', content: prompt(file.path, text, tg) }], max_tokens: 1200, temperature: 0.2, chat_template_kwargs: { enable_thinking: false } }, { gateway: { id: GATEWAY } });
    } catch (e) {
      const m = String(e?.message || e);
      return { file: file.path, status: /429|rate.?limit|Too Many/i.test(m) ? 'rate_limited' : 'model_error', reason: m.slice(0, 200), ms: Date.now() - t0 };
    }
    const u = res?.usage || {};
    const tin = u.prompt_tokens || 0, tout = u.completion_tokens || 0;
    const pr = PRICES_OF(this.env)[model];
    const usd = pr ? (tin * pr[0] + tout * pr[1]) / 1e6 : 0;
    // Workers AI answers in its own shape ({response}) or the OpenAI one ({choices[0].message.content}).
    const raw = res?.choices?.[0]?.message?.content ?? res?.response ?? res?.result?.response ?? '';
    const answer = parseAnswer(raw, tg);
    if (!Object.keys(answer).length) return { file: file.path, status: 'rejected', reason: `no usable JSON in the answer: ${String(typeof raw === 'string' ? raw : JSON.stringify(raw)).replace(/\s+/g, ' ').slice(0, 160)}`, ms: Date.now() - t0, usd, tin, tout };
    const { text: next, inserted } = insert(text, tg, answer);
    if (!inserted) return { file: file.path, status: 'rejected', reason: 'no comment survived cleaning', ms: Date.now() - t0, usd, tin, tout };
    const v = verify(file.path, text, next);
    if (!v.ok) return { file: file.path, status: 'verify_fail', reason: v.why, ms: Date.now() - t0, usd, tin, tout };
    return { file: file.path, status: 'ready', text: next, comments: inserted, ms: Date.now() - t0, usd, tin, tout };
  }
}

// ---- Lander: lanes by folder, one commit per lane, pushed in order ---------------------------
export class Lander extends DurableObject {
  async begin(runId, base) { await this.ctx.storage.deleteAll(); await this.ctx.storage.put({ runId, base, lanes: {}, landed: 0, commits: 0, pushes: 0, stale: 0, errors: [] }); }
  async add(runId, lane, path, text, at) {
    if ((await this.ctx.storage.get('runId')) !== runId) return;
    const lanes = (await this.ctx.storage.get('lanes')) || {};
    (lanes[lane] ||= []).push({ path, at });
    await this.ctx.storage.put({ lanes, [`f:${path}`]: text });
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 5000);
  }
  async restart() { await this.ctx.storage.setAlarm(Date.now() + 2000); await this.ctx.storage.sync(); this.ctx.abort('restart on the deployed code'); }
  async flush(runId) { if ((await this.ctx.storage.get('runId')) === runId) await this.ctx.storage.setAlarm(Date.now() + 100); }
  async alarm() {
    const runId = await this.ctx.storage.get('runId');
    const lanes = (await this.ctx.storage.get('lanes')) || {};
    const keys = Object.keys(lanes).filter((k) => lanes[k].length);
    if (!keys.length) return;
    try { await this.land(runId, lanes, keys); }
    catch (e) { const errors = (await this.ctx.storage.get('errors')) || []; errors.push({ at: Date.now(), err: String(e?.stack || e).slice(0, 600) }); await this.ctx.storage.put('errors', errors.slice(-20)); log('land_error', { runId, err: String(e?.stack || e).slice(0, 500) }); }
    await this.ctx.storage.setAlarm(Date.now() + 5000);
  }
  /** One commit per lane on top of main's tip, all pushed together; a stale tip is re-read and the batch rebuilt. */
  async land(runId, lanes, keys) {   // eslint-disable-line no-param-reassign
    using repo = await this.env.ARTIFACTS.get(MAIN);
    const token = (await repo.createToken('write', 600)).plaintext;
    for (let attempt = 0; attempt < 3; attempt++) {
      const tip = (await repo.log({ limit: 1 }))[0];
      const objs = new Objects();
      let parent = tip.hash, tree = tip.treeHash;
      const landedFiles = [];
      for (const k of keys) {
        const items = lanes[k].slice(0, 200);
        const texts = await this.ctx.storage.get(items.map((x) => `f:${x.path}`));
        tree = await overlay(repo, objs, tree, items.map((x) => ({ path: x.path, sha: objs.blob(texts.get(`f:${x.path}`)) })));
        parent = objs.commit(tree, [parent], `docs(${k}): comments for ${items.length} file${items.length === 1 ? '' : 's'}\n\nqodebase fleet run ${runId}; code unchanged (verified per file).`, Date.now(), 'qodebase fleet <fleet@qodebase.app>');
        landedFiles.push(...items.map((x) => x.path));
      }
      const p = await push({ remote: REMOTE, token, branch: 'main', oldSha: tip.hash, newSha: parent, objs: [...objs.map.values()] });
      await this.ctx.storage.put('pushes', ((await this.ctx.storage.get('pushes')) || 0) + 1);
      if (p.ok) {
        // Re-read the lanes: files added while this batch was pushing must stay (F2 at 10 agents lost 9 that way).
        const done = new Set(landedFiles), now = (await this.ctx.storage.get('lanes')) || {};
        for (const k of Object.keys(now)) now[k] = now[k].filter((x) => !done.has(x.path));
        lanes = now;
        await this.ctx.storage.put({ lanes, landed: ((await this.ctx.storage.get('landed')) || 0) + landedFiles.length, commits: ((await this.ctx.storage.get('commits')) || 0) + keys.length });
        await this.ctx.storage.delete(landedFiles.map((f) => `f:${f}`));
        await run(this.env).landed(runId, landedFiles, Date.now());
        log('landed', { runId, lanes: keys.length, files: landedFiles.length, commit: parent.slice(0, 10) });
        return;
      }
      await this.ctx.storage.put('stale', ((await this.ctx.storage.get('stale')) || 0) + 1);
      log('push_retry', { runId, attempt, status: p.status, why: String(p.detail || '').slice(0, 200) });
    }
    throw new Error('push failed 3 times');
  }
  async summary() {
    const g = await this.ctx.storage.get(['lanes', 'landed', 'commits', 'pushes', 'stale', 'errors']);
    const lanes = g.get('lanes') || {};
    return { waiting: Object.values(lanes).reduce((n, l) => n + l.length, 0), lanes: Object.keys(lanes).length, landed: g.get('landed') || 0, commits: g.get('commits') || 0, pushes: g.get('pushes') || 0, stale: g.get('stale') || 0, errors: (g.get('errors') || []).slice(-3) };
  }
}

function parseTree(body) {
  const out = []; let i = 0; const dec = new TextDecoder();
  while (i < body.length) {
    const sp = body.indexOf(0x20, i), nul = body.indexOf(0, sp);
    const mode = dec.decode(body.subarray(i, sp)), name = dec.decode(body.subarray(sp + 1, nul));
    const sha = [...body.subarray(nul + 1, nul + 21)].map((b) => b.toString(16).padStart(2, '0')).join('');
    out.push({ name, mode, sha, type: mode === '40000' ? 'tree' : 'blob' });
    i = nul + 21;
  }
  return out;
}

/** A new root tree with files replaced: only the trees on the changed paths are rewritten; the rest keep their hashes. */
async function overlay(repo, objs, rootHash, files) {
  const byDir = new Map();
  for (const f of files) { const i = f.path.lastIndexOf('/'); const d = f.path.slice(0, i); if (!byDir.has(d)) byDir.set(d, []); byDir.get(d).push({ name: f.path.slice(i + 1), sha: f.sha }); }
  const memo = new Map();
  // A tree this batch built (an earlier lane's commit) is only in memory: read it from there, else from Artifacts.
  const read = async (hash) => {
    const o = objs.map.get(hash);
    if (o && o.type === 'tree') return parseTree(o.body);
    const t = await repo.readTree(hash);
    if (!t) throw new Error(`tree ${hash} not found`);
    return t.map((e) => ({ name: e.name, mode: e.type === 'tree' ? '40000' : String(e.mode).replace(/^0+/, ''), sha: e.hash, type: e.type }));
  };
  const rewrite = async (hash, dir) => {
    const entries = await read(hash);
    for (const e of entries) {
      const sub = dir ? `${dir}/${e.name}` : e.name;
      if (e.type === 'tree' && [...byDir.keys()].some((d) => d === sub || d.startsWith(sub + '/'))) e.sha = await rewrite(e.sha, sub);
    }
    for (const f of byDir.get(dir) || []) { const e = entries.find((x) => x.name === f.name && x.type === 'blob'); if (!e) throw new Error(`no file ${dir}/${f.name} on main`); e.sha = f.sha; }
    const sha = objs.treeOf(entries.map(({ name, mode, sha }) => ({ name, mode, sha })));
    memo.set(dir, sha);
    return sha;
  };
  return rewrite(rootHash, '');
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fleet</title>
<style>:root{--bg:#fff;--fg:#1a1a1a;--mute:#666;--line:#e3e3e3;--accent:#0f6b55;--warn:#b25b00}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#eee;--mute:#999;--line:#2a2a2a;--accent:#4fc2a3;--warn:#f0a050}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 ui-sans-serif,system-ui,sans-serif;padding:16px;max-width:760px}
h1{font-size:20px;margin:0 0 4px}.mute{color:var(--mute)}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
td{border-bottom:1px solid var(--line);padding:6px 4px}td:last-child{text-align:right}.st{font-weight:600}.paused{color:var(--warn)}.running{color:var(--accent)}
pre{white-space:pre-wrap;font-size:12px;color:var(--mute)}</style></head><body><h1>Fleet</h1><div id="s" class="mute">loading</div>
<script>
async function tick(){const s=await (await fetch('/status')).json();const c=s.counts||{};const row=(k,v)=>'<tr><td>'+k+'</td><td>'+v+'</td></tr>';
document.getElementById('s').innerHTML=s.state==='none'?'No run yet.':
'<p>Run '+s.runId+' <span class="st '+s.state+'">'+s.state+'</span> · '+s.agents+' agents · '+s.model+'</p><table>'+
row('Files',s.files)+row('Waiting',c.queued)+row('At the model',c.model)+row('Ready to land',c.ready)+row('Landed',c.landed)+row('Nothing to document',c.skipped)+
row('Verify failed',c.verify_fail)+row('Rejected answers',c.rejected)+row('Model errors',c.model_error)+row('Rate limited',c.rate_limited)+
row('Spent','$'+(s.usd||0).toFixed(3)+' of $'+s.budgetUsd)+row('Last minute',(s.lastMinute.calls||0)+' calls, $'+(s.lastMinute.usd||0).toFixed(3))+
row('Land wait p50 / p90',(s.landWaitS.p50??'-')+' / '+(s.landWaitS.p90??'-')+' s')+row('Today (all runs)','$'+((s.budget&&s.budget.spent)||0).toFixed(2)+' of $50')+'</table>'+
(s.pauses&&s.pauses.length?'<p class="paused">'+s.pauses.map(p=>new Date(p.at).toISOString().slice(11,19)+' '+p.why).join('<br>')+'</p>':'')+
'<pre>'+JSON.stringify({errors:s.errors,lander:s.lander},null,1)+'</pre>';}
tick();setInterval(tick,5000);</script></body></html>`;
