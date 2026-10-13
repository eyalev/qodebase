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
import { landOne } from './merge.js';
import { kataPrompt, parseCode, checkCode } from './kata.js';
import { Objects, push } from '../../cloud/src/gitpush.js';
import { targets, insert, verify, prompt, parseAnswer, cleanComment, promptPack, parseAnswerPack, packFiles, docBlocks } from './doc.js';

const log = (event, f = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), module: 'fleet', event, ...f }));
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const MAIN = 'fleet-main';
// The repo handle has no remote URL (only create/import return it): the namespace's fixed git endpoint.
// S4e: a second namespace (qbfleet2) for repos named fleet-n2-*: does the shared slowdown follow the namespace?
const N2 = 'fleet-n2-';
const ns = (env, repo) => (String(repo).startsWith(N2) ? env.ARTIFACTS2 : env.ARTIFACTS);
const remoteOf = (repo) => `https://887d7234a6b8d65ad355a4f6684cab67.artifacts.cloudflare.net/git/${String(repo).startsWith(N2) ? 'qbfleet2' : 'qbfleet'}/${repo}.git`;
// Several repos at once (P4): one Run and one Lander per repo; fleet-main keeps its first object names.
const REPO_RE = /^fleet-[a-z0-9-]{1,40}$/;
const repoOf = (u, b = {}) => { const r = b.repo || u.searchParams.get('repo') || MAIN; if (!REPO_RE.test(r)) throw new Error('repo: fleet-<name>'); return r; };
const GATEWAY = 'qodebase-fleet';
// $ per million tokens [input, output] per model: the FLEET_PRICES var (JSON). An unpriced model is refused, never priced at 0.
const DAY_CAP_USD = 50;
// What each copy is a duplicate of (a one-commit snapshot of the upstream at the base sha; never pushed upstream).
const SOURCES = {
  main: { name: 'VS Code', upstream: 'microsoft/vscode', root: 'src/vs' }, 'vscode-src': { name: 'VS Code', upstream: 'microsoft/vscode', root: 'src/vs' },
  'vscode-ext': { name: 'VS Code extensions', upstream: 'microsoft/vscode', root: 'extensions' }, nextjs: { name: 'Next.js', upstream: 'vercel/next.js', root: 'packages' },
  angular: { name: 'Angular', upstream: 'angular/angular', root: 'packages' }, babel: { name: 'Babel', upstream: 'babel/babel', root: 'packages' },
  nest: { name: 'NestJS', upstream: 'nestjs/nest', root: 'packages' },
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/page') return new Response(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (url.pathname === '/status' && request.method === 'GET') return json(await run(env, repoOf(url)).status());
    if (request.headers.get('x-fleet-key') !== env.FLEET_KEY) return json({ error: 'key required' }, 401);
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    const repo = repoOf(url, body);
    switch (url.pathname) {
      case '/import': return json(await importRepo(env, body));
      // VS Code is too big for Artifacts' import ('upstream unavailable'): an empty repo, then the laptop pushes src/vs.
      // S4: more copies server-side: an Artifacts fork of a never-touched seed copy (seconds; pushing from the laptop took ~1 min
      // a copy). {repo, from}. A fresh repo can be invisible to an immediate read: callers retry reads.
      case '/fork': {
        if (!REPO_RE.test(String(body.from || ''))) return json({ error: 'from: fleet-<name>' }, 400);
        const t0 = Date.now();
        using src = await ns(env, body.from).get(body.from);
        const f = await src.fork(repo, { description: `fleet copy of ${body.from} (S4 scale runs); never pushed upstream`, defaultBranchOnly: true });
        await budget(env).addRepo(repo);
        return json({ repo, from: body.from, remote: f.remote || remoteOf(repo), ms: Date.now() - t0 });
      }
      // S4e: a seed in the other namespace, imported server-side from a qbfleet copy over git (a 1-hour read token in the URL).
      case '/import-copy': {
        if (!REPO_RE.test(String(body.from || '')) || ns(env, repo) === ns(env, body.from)) return json({ error: 'from: a repo in the other namespace' }, 400);
        const t0 = Date.now();
        using src = await ns(env, body.from).get(body.from);
        const tok = (await src.createToken('read', 3600)).plaintext.split('?')[0];
        let r;
        try { r = await ns(env, repo).import({ source: { url: remoteOf(body.from).replace('https://', `https://x:${tok}@`), branch: 'main', depth: 1 }, target: { name: repo, opts: { description: `fleet copy of ${body.from} (S4e); never pushed upstream` } } }); }
        catch (e) { return json({ error: String(e?.message || e).replaceAll(tok, '***').slice(0, 400) }, 502); }
        await budget(env).addRepo(repo);
        return json({ repo, from: body.from, remote: r.remote || remoteOf(repo), ms: Date.now() - t0 });
      }
      case '/go': return json(await run(env, repo).go());
      // Warm a held run's copy before a burst: read n of its queued blobs (S4e: cold forks failed reads under a burst).
      case '/warm': return json(await run(env, repo).warm(Math.min(500, Number(body.n) || 100)));
      // A used copy back to its starting commit (main -> body.to, a commit already in the repo; no objects sent).
      case '/reset': {
        if (!/^[0-9a-f]{40}$/.test(String(body.to || ''))) return json({ error: 'to: a commit sha' }, 400);
        using r = await ns(env, repo).get(repo);
        if (!(await r.readCommit(body.to))) return json({ error: 'no such commit in this repo' }, 400);
        const tip = (await r.log({ limit: 1 }))[0];
        if (tip.hash === body.to) return json({ repo, main: tip.hash, already: true });
        const token = (await r.createToken('write', 600)).plaintext;
        const p = await push({ remote: remoteOf(repo), token, branch: 'main', oldSha: tip.hash, newSha: body.to, objs: [] });
        return json({ repo, from: tip.hash, main: p.ok ? body.to : tip.hash, ok: p.ok, detail: p.detail || '' });
      }
      case '/create': { const c = await ns(env, repo).create(repo, { description: String(body.description || 'fleet experiment base (an open-source slice); never pushed upstream').slice(0, 300), setDefaultBranch: 'main' }); using r = await ns(env, repo).get(repo); const t = await r.createToken('write', 3600); await budget(env).addRepo(repo); return json({ repo, remote: c.remote || remoteOf(repo), token: t.plaintext }); }
      case '/plan': return json(await plan(env, body));
      case '/start': return json(await run(env, repo).start(body));
      case '/pause': return json(await run(env, repo).pause(body.why || 'paused by hand'));
      case '/resume': return json(await run(env, repo).resume(body.cfg || {}));   // cfg: e.g. a new planUsdPerMin or maxPerMin after a fix
      case '/stop': return json(await run(env, repo).stop(body.why || 'stopped by hand'));
      // F4 (qb9): the quality judge through the same gateway, one model only, priced and counted in the account-day cap.
      case '/judge': {
        if (body.model !== '@cf/openai/gpt-oss-120b') return json({ error: 'model must be @cf/openai/gpt-oss-120b' }, 400);
        const b = await budget(env).check(); if (!b.ok) return json({ error: b.why }, 429);
        // gpt-oss-120b reasons before it answers: 300 tokens went to reasoning alone (qb9), so up to 1500, effort passed through.
        let res; try { res = await env.AI.run(body.model, { messages: Array.isArray(body.messages) ? body.messages.slice(0, 4) : [], max_tokens: Math.min(1500, Number(body.max_tokens) || 600), ...(['low', 'medium', 'high'].includes(body.reasoning_effort) ? { reasoning_effort: body.reasoning_effort, reasoning: { effort: body.reasoning_effort } } : {}) }, { gateway: { id: GATEWAY } }); }
        catch (e) { const m = String(e?.message || e); return json({ error: m.slice(0, 300) }, /429|rate.?limit/i.test(m) ? 429 : 502); }
        const u = res?.usage || {}, pr = PRICES_OF(env)[body.model];
        const usd = pr ? ((u.prompt_tokens || 0) * pr[0] + (u.completion_tokens || 0) * pr[1]) / 1e6 : 0;
        if (usd) await budget(env).spend(usd);
        return json({ result: res, usd });
      }
      case '/series': return json(await run(env, repo).series(url.searchParams.get('run')));
      // Drill-down for /runs v2 (qb7): public reads, bounded (limit <= 200, offset paging).
      case '/agents': { const rid = url.searchParams.get('run'), off = Math.max(0, Number(url.searchParams.get('offset')) || 0), lim = Math.min(200, Number(url.searchParams.get('limit')) || 200);
        const a = url.searchParams.get('agent');
        return json(a != null ? await run(env, repo).agentFiles(rid, Number(a), off, lim) : await run(env, repo).agents(rid, off, lim)); }
      case '/slice': return json(await run(env, repo).slice(url.searchParams.get('run'), url.searchParams.get('t'), Math.max(0, Number(url.searchParams.get('offset')) || 0), Math.min(200, Number(url.searchParams.get('limit')) || 200), Number(url.searchParams.get('to')) || null));
      case '/file': return json(await fileView(env, repo, url.searchParams.get('run'), String(url.searchParams.get('path') || ''), url.searchParams.get('sha')));
      case '/commits': {
        const t = Number(url.searchParams.get('t')) || 0, to = Number(url.searchParams.get('to')) || 0;
        const r = await lander(env, repo).commits(url.searchParams.get('run'), t, to || (t ? t + 10000 : 9e15), Math.max(0, Number(url.searchParams.get('offset')) || 0), Math.min(200, Number(url.searchParams.get('limit')) || 200));
        return json(r ? { runId: url.searchParams.get('run'), t, to, ...r } : { error: 'commits are kept for the newest run of each copy, from 2026-10-13 14:00 UTC on' });
      }
      case '/commit': return json(await commitView(env, repo, url.searchParams.get('run'), String(url.searchParams.get('sha') || '')));
      case '/dialcheck': return json(await dialCheck(env, repo, url.searchParams.get('run'), Math.max(0, Number(url.searchParams.get('offset')) || 0), Math.min(200, Number(url.searchParams.get('limit')) || 100)));
      case '/ladder-series': return json(await ladderSeries(env, String(url.searchParams.get('ladder') || '')));
      case '/meta': return json(await run(env, repo).setMeta(String(body.run || ''), body.meta || {}));
      case '/records': return new Response(await run(env, repo).records(url.searchParams.get('run')), { headers: { 'content-type': 'application/x-ndjson' } });
      case '/budget': return json(await budget(env).status());
      // One file through a given provider/model, no landing (provider checks; the call is priced and counted in the day cap).
      case '/try': { const r = await env.AGENT.get(env.AGENT.idFromName('try')).work(body.file, body.model, body.provider || 'workers-ai'); if (r.usd) await budget(env).spend(r.usd); delete r.text; return json(r); }
      case '/retire-v1': { await env.LANDER.get(env.LANDER.idFromName('fleet')).begin('retired', ''); return json({ ok: true }); }
      // An object that never goes idle (the Lander's 5 s alarm) keeps running old code after a deploy: restart it.
      case '/restart': { await lander(env, repo).restart().catch(() => {}); await run(env, repo).restart().catch(() => {}); return json({ ok: true }); }
      // One summary row per run, every repo (qb4's results generator).
      case '/runs': { const repos = [MAIN, ...((await budget(env).repos().catch(() => [])) || []).filter((x) => x !== MAIN)]; const missing = []; const rows = (await Promise.all(repos.map((x) => run(env, x).runs().catch((e) => { missing.push({ repo: x, err: String(e?.message || e).slice(0, 120) }); return []; })))).flat(); const kindOf = (r) => r.repo.replace(/^fleet-(n2-)?/, '').replace(/-\d+$/, '');
        const groups = new Map(); for (const r of rows) if (r.ladder) { const k = `${r.ladder}|${kindOf(r)}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
        for (const g of groups.values()) g.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0)).forEach((r, i) => { r.copyOfKind = i + 1; r.copiesOfKind = g.length; });
        for (const r of rows) r.source = { ...(SOURCES[kindOf(r)] || SOURCES.main), namespace: r.repo.startsWith(N2) ? 'qbfleet2' : 'qbfleet' };
        return json({ runs: rows, ...(missing.length ? { missing } : {}) }); }
      case '/clone-token': { using r = await ns(env, repo).get(repo); const t = await r.createToken('read', 3600); return json({ repo, remote: remoteOf(repo), token: t.plaintext }); }
      default: return json({ error: 'not found' }, 404);
    }
  },
};

const run = (env, repo = MAIN) => env.RUN.get(env.RUN.idFromName(repo === MAIN ? 'fleet' : `run-${repo}`));
const budget = (env) => env.BUDGET.get(env.BUDGET.idFromName('account-day'));
// v2: the first Lander instance kept running pre-fix code on its 5 s alarm (it never went idle); /retire-v1 empties it.
const lander = (env, repo = MAIN) => env.LANDER.get(env.LANDER.idFromName(repo === MAIN ? 'fleet-v2' : `lander-${repo}`));
// A lane is a folder (never a file name): src/vs/<top>, or three levels deep in the big trees (workbench, editor, platform).
const laneOf = (path, root = 'src/vs') => { const d = path.split('/').slice(root.split('/').length, -1); return (root === 'src/vs' && (d[0] === 'workbench' || d[0] === 'editor' || d[0] === 'platform') ? d.slice(0, 3) : root === 'src/vs' ? d.slice(0, 1) : d.slice(0, 2)).join('/') || 'root'; };

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
  /** True at most once per `everyMs` for a key (push rate limit). */
  async pushGate(key, everyMs) { const k = `gate:${key}`, last = (await this.ctx.storage.get(k)) || 0; if (Date.now() - last < everyMs) return false; await this.ctx.storage.put(k, Date.now()); return true; }
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
  async addRepo(r) { const l = (await this.ctx.storage.get('repos')) || []; if (!l.includes(r)) { l.push(r); await this.ctx.storage.put('repos', l); } }
  async repos() { return (await this.ctx.storage.get('repos')) || []; }
  async status() { return { cap: DAY_CAP_USD, lastDay: this.env.FLEET_LAST_DAY || '2026-10-14', days: Object.fromEntries(await this.ctx.storage.list({ prefix: 'd:' })) }; }
}

// ---- Run: the controller ------------------------------------------------------------------
const DEFAULTS = { agents: 10, maxFiles: 10, model: null, budgetUsd: 1, maxPerMin: 100, planUsdPerMin: 0.5,
  pause: { rateLimitShare: 0.05, modelErrorShare: 0.05, readErrorShare: 0.30, verifyFailShare: 0.10, landWaitP90S: 300, window: 40 } };

export class Run extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS rec (run TEXT, file TEXT, status TEXT, reason TEXT, model TEXT, agent INT, at INT, ms INT, usd REAL, tin INT, tout INT, comments INT, landed_at INT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS q (run TEXT, i INT, path TEXT, hash TEXT, taken INT DEFAULT 0, PRIMARY KEY (run, i))`);
    try { this.sql.exec(`ALTER TABLE q ADD COLUMN tries INT DEFAULT 0`); } catch {}
    // Collision dial: a task is one or more declarations of a file (fns, JSON), its kind (solo / far / near / same), its pair.
    for (const c of ['task TEXT', 'fns TEXT', 'kind TEXT', 'grp TEXT', 'variant INT', 'text TEXT']) try { this.sql.exec(`ALTER TABLE q ADD COLUMN ${c}`); } catch {}
    this.sql.exec(`CREATE TABLE IF NOT EXISTS claim (run TEXT, file TEXT, fn TEXT, task TEXT, PRIMARY KEY (run, file, fn))`);
    // cmt: the comments this file got ({name: text}, for the per-file diff); commit: the lane commit it landed in.
    for (const c of ['t_read INT', 't_model INT', 't_verify INT', 'infra_errs INT', 'cmt TEXT', 'commit_sha TEXT', 'pack_n INT', 'task TEXT', 'kind TEXT', 'grp TEXT', 'resolution TEXT', 'change_id TEXT', 'redos INT']) try { this.sql.exec(`ALTER TABLE rec ADD COLUMN ${c}`); } catch {}
    // S4/qb7: the queue sampled every 10 s while a run is on (the series' depth per stage).
    this.sql.exec(`CREATE TABLE IF NOT EXISTS samp (run TEXT, t INT, waiting INT, at_model INT, ready INT, landed INT, lander_waiting INT, PRIMARY KEY (run, t))`);
    // S4a: the per-result land-wait check scanned the whole table; landed() looked files up by name.
    this.sql.exec(`CREATE INDEX IF NOT EXISTS rec_run_at ON rec (run, at)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS rec_run_file ON rec (run, file)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS rec_run_landed ON rec (run, landed_at)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS q_run_taken ON q (run, taken, i)`);
  }
  // One state object in memory, shared by every handler: handlers that await other objects interleave, and each saving the
  // copy it had read lost the others' counts (F2 at 100 agents showed -37 files at the model).
  async st() { if (this.s === undefined) this.s = (await this.ctx.storage.get('s')) || null; return this.s; }
  async save(s) { this.s = s; await this.ctx.storage.put('s', s); }

  async start(opts) {
    const cur = await this.st();
    if (cur && (cur.state === 'running' || cur.state === 'paused' || cur.state === 'held')) return { error: `run ${cur.runId} is ${cur.state}: stop it first` };
    const b = await budget(this.env).check();
    if (!b.ok) return { error: b.why };
    const cfg = { ...DEFAULTS, ...opts, pause: { ...DEFAULTS.pause, ...(opts.pause || {}) } };
    // Models side by side, each paced at its own limit (Workers AI: 300 req/min per model): cfg.models [{model, maxPerMin}],
    // or one cfg.model at cfg.maxPerMin. cfg.overflow {model, maxPerMin}: Gemini through the same gateway, used only when
    // every Workers AI model is at its limit.
    // S3: model 'cache' answers from the comments the fleet already produced (KV FLEET_CACHE, keyed by the file's blob hash):
    // no model call, everything else real. A miss is recorded as cache_miss (no fallback in the scale ladder).
    cfg.models = (Array.isArray(cfg.models) && cfg.models.length ? cfg.models : [{ model: cfg.model, maxPerMin: cfg.maxPerMin }]).map((m) => ({ model: m.model, maxPerMin: Number(m.maxPerMin) || 250 }));
    cfg.model = cfg.models.map((m) => m.model).join(' + ');
    const prices = PRICES_OF(this.env);
    for (const m of [...cfg.models, ...(cfg.overflow ? [cfg.overflow] : [])]) if (!m.model || (m.model !== 'cache' && !prices[m.model])) return { error: `model ${m.model} has no price: one of ${Object.keys(prices).join(', ')}` };
    if ([...cfg.models, ...(cfg.overflow ? [cfg.overflow] : [])].some((m) => m.model.startsWith('gemini')) && !this.env.GEMINI_KEY) return { error: 'a Gemini model needs the GEMINI_KEY secret' };
    cfg.agents = Math.max(1, Math.min(2000, Number(cfg.agents) || 10));
    cfg.budgetUsd = Math.min(Number(cfg.budgetUsd) || 1, b.left);
    // One walk of main's src/vs (~800 folders): the files with their blob hashes, lanes interleaved, and main's tip.
    cfg.repo = REPO_RE.test(cfg.repo || '') ? cfg.repo : MAIN;
    cfg.root = String(cfg.root || 'src/vs').replace(/^\/+|\/+$/g, '');
    // Code dial: qb4's kata tasks in their order, on a qodebase project (forq's Artifacts namespace); no file walk here.
    const { base, files } = cfg.kata ? { base: null, files: [] } : await listFiles(this.env, cfg.repo, cfg.root);
    const p = { base };
    const off = Math.max(0, Number(cfg.offset) || 0);   // the next slice of the (stable) file list
    let pick = files.slice(off, off + Math.max(1, Math.min(files.length, Number(cfg.maxFiles) || 10)));
    const runId = `f${Date.now().toString(36)}`;
    if (cfg.kata) {
      const list = (cfg.kata.tasks || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      list.forEach((t, i) => this.sql.exec(`INSERT INTO q (run, i, path, hash, task, fns, kind, grp, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, runId, i, t.file, '', t.id, JSON.stringify([t.fn]), t.kind, t.group || null, t.text));
      pick = list.map((t) => ({ path: t.file }));
      cfg.kata = { slug: cfg.kata.slug, tasks: list.length, maxRedos: cfg.kata.maxRedos ?? 2 };
    } else if (cfg.dial) {
      const tasks = await dialTasks(this.env, pick, Number(cfg.dial.level) || 0, cfg.dial.seed || runId);
      tasks.forEach((t, i) => this.sql.exec(`INSERT INTO q (run, i, path, hash, task, fns, kind, grp, variant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, runId, i, t.path, t.hash, t.task, JSON.stringify(t.fns), t.kind, t.grp, t.variant || 0));
      pick = tasks; cfg.dialActual = tasks.dial;
    } else pick.forEach((f, i) => this.sql.exec(`INSERT INTO q (run, i, path, hash) VALUES (?, ?, ?, ?)`, runId, i, f.path, f.hash));
    // hold: list and queue now, start the agents on /go (S4e: copies started together; S4d's starts spread over 98 s).
    const s = { runId, state: cfg.hold ? 'held' : 'running', cfg, base: p.base, startedAt: Date.now(), files: pick.length, next: 0, usd: 0, calls: 0,
      counts: { queued: pick.length, model: 0, verify: 0, ready: 0, landed: 0, skipped: 0, verify_fail: 0, model_error: 0, rate_limited: 0, rejected: 0 },
      recent: [], perMin: {}, pauses: [], agentsDone: 0 };
    await this.save(s);
    await this.ctx.storage.put(`meta:${runId}`, { base: p.base, dial: cfg.dialActual || null, ladder: cfg.ladder ? String(cfg.ladder).slice(0, 80) : null, copy: Number.isFinite(Number(cfg.copy)) && cfg.copy !== undefined ? Number(cfg.copy) : null, label: String(cfg.label || '').slice(0, 80) || null, agents: cfg.agents, agentsStarted: 0, repo: cfg.repo, root: cfg.root, planned: cfg.models.map((m) => m.model), overflow: cfg.overflow?.model || null, maxPerMin: Object.fromEntries([...cfg.models, ...(cfg.overflow ? [cfg.overflow] : [])].map((m) => [m.model, m.maxPerMin])) });
    if (!cfg.kata) await lander(this.env, cfg.repo).begin(runId, p.base, cfg.repo);
    await budget(this.env).addRepo(cfg.repo);
    // Agents start from this object's alarm in batches: started one by one inside the request, F2's 100-agent start
    // outlived the request and only ~8 agents began.
    s.agentsStarted = 0; await this.save(s);
    if (!cfg.hold) await this.ctx.storage.setAlarm(Date.now() + 100);
    log('run_started', { runId, agents: cfg.agents, files: pick.length, model: cfg.model, budgetUsd: cfg.budgetUsd });
    return { runId, agents: cfg.agents, files: pick.length, base: p.base, ...(cfg.dialActual ? { dial: cfg.dialActual } : {}) };
  }

  async warm(n) {
    const s = await this.st();
    if (!s || s.state !== 'held') return { error: 'warm a held run' };
    const rows = this.sql.exec(`SELECT hash FROM q WHERE run = ? ORDER BY i LIMIT ?`, s.runId, n).toArray();
    const t0 = Date.now(); let ok = 0, err = 0;
    using r = await ns(this.env, s.cfg.repo).get(s.cfg.repo);
    for (let i = 0; i < rows.length; i += 20) await Promise.all(rows.slice(i, i + 20).map(async (x) => { try { const b = await r.readBlob(x.hash); if (b) { await b.arrayBuffer(); ok++; } else err++; } catch { err++; } }));
    return { read: ok, errors: err, ms: Date.now() - t0 };
  }
  async go() {
    const s = await this.st();
    if (!s || s.state !== 'held') return { error: `nothing held (state ${s?.state || 'none'})` };
    s.state = 'running'; s.startedAt = Date.now(); await this.save(s);
    await this.ctx.storage.setAlarm(Date.now() + 10);
    return { runId: s.runId, startedAt: s.startedAt };
  }

  async alarm() {
    const s = await this.st();
    if (!s || s.state === 'stopped' || s.state === 'held' || (s.agentsStarted || 0) >= s.cfg.agents) return;
    const from = s.agentsStarted || 0, to = Math.min(s.cfg.agents, from + 50);
    await Promise.all(Array.from({ length: to - from }, (_, k) => (s.cfg.kata ? this.env.KATA : this.env.AGENT).get((s.cfg.kata ? this.env.KATA : this.env.AGENT).idFromName(`${s.runId}-${from + k}`)).begin(s.runId, from + k, s.cfg.repo || MAIN, Math.max(1, Math.min(20, Number(s.cfg.batch) || 1)), s.cfg.pack ? { files: Math.max(2, Math.min(10, Number(s.cfg.pack.files) || 8)), tokens: Math.max(2000, Math.min(30000, Number(s.cfg.pack.tokens) || 12000)) } : null)));
    s.agentsStarted = to; await this.save(s);
    const meta = await this.ctx.storage.get(`meta:${s.runId}`); if (meta) { meta.agentsStarted = to; await this.ctx.storage.put(`meta:${s.runId}`, meta); }
    log('agents_started', { runId: s.runId, started: to, of: s.cfg.agents });
    if (to < s.cfg.agents) await this.ctx.storage.setAlarm(Date.now() + 200);
  }

  /** An agent asks for its next file. */
  async next(runId, n = 1, inner = false) {
    if (!inner && (n > 1 || this.s?.cfg?.dial)) return this.nextMany(runId, n);
    const s = await this.st();
    if (!s || s.runId !== runId) return { stop: true };
    if (s.state === 'paused') return { wait: 15_000 };
    if (s.state !== 'running') return { stop: true };
    // The pace in 10-second slices per model (a per-minute bucket let a minute's calls go in seconds, and two at its edges:
    // 429s at 100 agents). The first model with room takes the file; Gemini only when every Workers AI model is full.
    const minute = Math.floor(Date.now() / 60000), slice = Math.floor(Date.now() / 10000);
    s.perSlice ||= {};
    const room = (m) => (s.perSlice[`${m.model}|${slice}`] || 0) < Math.max(1, Math.floor(m.maxPerMin / 6));
    let pickM = s.cfg.models.find(room);
    if (!pickM && s.cfg.overflow && room(s.cfg.overflow)) pickM = s.cfg.overflow;
    if (!pickM) return { wait: 2_000 + Math.random() * 3000 };
    const provider = pickM.model === 'cache' ? 'cache' : pickM.model.startsWith('gemini') ? 'google-ai-studio' : 'workers-ai';   // a planned Gemini model too (F3b)
    s.perSlice[`${pickM.model}|${slice}`] = (s.perSlice[`${pickM.model}|${slice}`] || 0) + 1;
    for (const k of Object.keys(s.perSlice)) if (Number(k.split('|')[1]) < slice - 12) delete s.perSlice[k];
    if (s.usd >= s.cfg.budgetUsd) { await this.autoPause(s, `run budget reached: $${s.usd.toFixed(3)} of $${s.cfg.budgetUsd}`); return { wait: 15_000 }; }
    const row = this.sql.exec(`SELECT i, path, hash, task, fns, kind, grp, variant, text FROM q WHERE run = ? AND taken = 0 ORDER BY i LIMIT 1`, runId).toArray()[0];
    if (!row) return { stop: true };
    this.sql.exec(`UPDATE q SET taken = 1 WHERE run = ? AND i = ?`, runId, row.i);
    s.counts.queued--; s.counts.model++;
    (s.perMin[minute] ||= { calls: 0, usd: 0 }).calls++;
    await this.save(s);
    const task = row.task ? { task: row.task, fns: JSON.parse(row.fns || '[]'), kind: row.kind, grp: row.grp, variant: row.variant || 0, claims: !!s.cfg.dial?.claims, ...(s.cfg.kata ? { text: row.text, slug: s.cfg.kata.slug, maxRedos: s.cfg.kata.maxRedos } : {}) } : {};
    return { file: { path: row.path, hash: row.hash, ...task }, model: pickM.model, provider, slot: `${pickM.model}|${slice}` };
  }

  /** S4: up to n files per call (one round trip, not n): each still paced per model, the first without room stops the batch. */
  async nextMany(runId, n) {
    const files = [];
    let first = null;
    // Batching: the pace counts calls, so one slot per pack: after a paced file, up to pack.files - 1 more ride with it
    // (S5 v2 charged every file and ran gemma at ~30 calls/min of 255).
    const st0 = await this.st(), per = st0?.cfg.pack ? Math.max(1, Math.min(10, Number(st0.cfg.pack.files) || 8)) : 1;
    for (let k = 0; k < Math.min(20, n); k++) {
      if (per > 1 && first && files.length % per !== 0) {
        const s = await this.st();
        if (!s || s.runId !== runId || s.state !== 'running') break;
        const row = this.sql.exec(`SELECT i, path, hash FROM q WHERE run = ? AND taken = 0 ORDER BY i LIMIT 1`, runId).toArray()[0];
        if (!row) break;
        this.sql.exec(`UPDATE q SET taken = 1 WHERE run = ? AND i = ?`, runId, row.i);
        s.counts.queued--; s.counts.model++; await this.save(s);
        const lead = files[files.length - (files.length % per)];
        files.push({ path: row.path, hash: row.hash, model: lead.model, provider: lead.provider, slot: null });
        continue;
      }
      const r = await this.next(runId, 1, true);
      if (!r.file) { if (!files.length) return r; break; }
      first ||= r; files.push({ ...r.file, model: r.model, provider: r.provider, slot: r.slot });
    }
    const s = await this.st();
    return { files, root: s?.cfg.root || 'src/vs', repo: s?.cfg.repo || MAIN };
  }

  /** S4: an agent's results for a batch of files (the ready ones went to the Lander already). */
  async doneMany(runId, agent, rs) { for (const r of rs) await this.done(runId, agent, r); }

  /** An agent's result for one file. */
  async done(runId, agent, r) {   // r may be rewritten (a retry)
    const s = await this.st();
    if (!s || s.runId !== runId) return;
    // A file with nothing to document never reached the model: its pace slot goes back (F3b: the pacer was the first thing
    // to saturate, counting those files; the models peaked at 207/191/172 calls/min of 290/290/350).
    if (r.status === 'skipped' && r.slot && s.perSlice?.[r.slot] > 0) s.perSlice[r.slot]--;
    const usd = r.usd || 0;
    s.usd += usd; s.calls++;
    const minute = Math.floor(Date.now() / 60000);
    (s.perMin[minute] ||= { calls: 0, usd: 0 }).usd += usd;
    s.counts.model--;
    s.counts[r.status] = (s.counts[r.status] || 0) + 1;
    s.recent.push({ status: r.status, at: Date.now() }); if (s.recent.length > 200) s.recent.splice(0, s.recent.length - 200);
    // A rate limit or a model error is not the file's verdict: back in the queue, two more tries.
    if (r.status === 'rate_limited' || r.status === 'model_error' || r.status === 'read_error') {
      const q = this.sql.exec(`SELECT i, tries FROM q WHERE run = ? AND path = ?`, runId, r.file).toArray()[0];
      if (q && (q.tries || 0) < 2) { this.sql.exec(`UPDATE q SET taken = 0, tries = ? WHERE run = ? AND i = ?`, (q.tries || 0) + 1, runId, q.i); r = { ...r, status: `${r.status}_retry` }; }
    }
    const cmt = r.cmt ? JSON.stringify(r.cmt).slice(0, 8000) : null;
    if (r.task && r.status !== 'ready') this.sql.exec(`DELETE FROM claim WHERE run = ? AND task = ?`, runId, r.task);
    this.sql.exec(`INSERT INTO rec (run, file, status, reason, model, agent, at, ms, usd, tin, tout, comments, t_read, t_model, t_verify, infra_errs, cmt, pack_n, task, kind, grp, resolution, change_id, redos, landed_at, commit_sha) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      runId, r.file, r.status, (r.reason || '').slice(0, 300), r.model || s.cfg.model, agent, Date.now(), r.ms || 0, usd, r.tin || 0, r.tout || 0, r.comments || 0, r.tRead || null, r.tModel || null, r.tVerify || null, r.infraErrs || 0, cmt, r.packN || null, r.task || null, r.kind || null, r.grp || null, r.resolution || (r.status === 'caught_early' ? 'caught_early' : r.status === 'skipped' && r.task ? 'done_before' : null), r.changeId || null, r.redos ?? null, r.landedAt || null, r.commit || null);
    const t10 = Math.floor(Date.now() / 10000) * 10000;
    if (s.lastSample !== t10) {
      s.lastSample = t10;
      const qq = this.sql.exec(`SELECT SUM(taken = 0) AS w, SUM(taken = 1) AS tk FROM q WHERE run = ?`, runId).toArray()[0] || {};
      const fin = this.sql.exec(`SELECT COUNT(*) AS n, SUM(status = 'ready') AS rd, SUM(status = 'landed') AS ld FROM rec WHERE run = ? AND status NOT LIKE '%_retry'`, runId).toArray()[0] || {};
      this.sql.exec(`INSERT OR REPLACE INTO samp (run, t, waiting, at_model, ready, landed, lander_waiting) VALUES (?,?,?,?,?,?,?)`, runId, t10, qq.w || 0, Math.max(0, (qq.tk || 0) - (fin.n || 0)), fin.rd || 0, fin.ld || 0, null);
    }
    // Old per-minute buckets go (an hour kept).
    for (const k of Object.keys(s.perMin)) if (Number(k) < minute - 60) delete s.perMin[k];
    await this.save(s);
    if (usd) await budget(this.env).spend(usd);
    if (r.status === 'ready' && r.text) await lander(this.env, s.cfg.repo || MAIN).add(runId, laneOf(r.file, s.cfg.root || 'src/vs'), r.file, r.text, Date.now());
    // Done when no file is waiting or at the model (not only when every agent reported in: a lost agent kept a run open).
    if (s.state === 'running' && s.counts.queued <= 0 && s.counts.model <= 0) { s.state = 'done'; s.endedAt = Date.now(); await this.save(s); await lander(this.env, s.cfg.repo || MAIN).flush(runId); return; }
    // The shares come from memory each time; the land-wait query and the budget check every 50 results (S4a: per result they
    // were a full table scan and a round trip to a shared object).
    s.sinceCheck = (s.sinceCheck || 0) + 1;
    if (s.sinceCheck >= 50 || s.counts?.queued <= 0) { s.sinceCheck = 0; await this.checkAutoPause(s); }
    else await this.checkShares(s);
  }

  /** Dial checker input: files (paged) with their base blob and every task's final record. */
  async dialFiles(runId, offset = 0, limit = 100) {
    const files = this.sql.exec(`SELECT path, MIN(hash) AS hash FROM q WHERE run = ? AND task IS NOT NULL GROUP BY path ORDER BY path LIMIT ? OFFSET ?`, runId, limit, offset).toArray();
    const total = this.sql.exec(`SELECT COUNT(DISTINCT path) AS n FROM q WHERE run = ? AND task IS NOT NULL`, runId).toArray()[0]?.n || 0;
    return { total, files: files.map((f) => ({ ...f, tasks: this.sql.exec(`SELECT q.task, q.fns, q.kind, q.grp, r.status, r.resolution, r.cmt FROM q LEFT JOIN rec r ON r.run = q.run AND r.task = q.task AND r.status NOT LIKE '%_retry' WHERE q.run = ? AND q.path = ?`, runId, f.path).toArray() })) };
  }
  /** Dial: claim a task's declarations before work; another live task on one of them -> caught early. */
  async claim(runId, task, file, fns) {
    const held = fns.map((fn) => this.sql.exec(`SELECT task FROM claim WHERE run = ? AND file = ? AND fn = ?`, runId, file, fn).toArray()[0]?.task).find((t) => t && t !== task);
    if (held) return { caught: held };
    for (const fn of fns) this.sql.exec(`INSERT OR REPLACE INTO claim (run, file, fn, task) VALUES (?, ?, ?, ?)`, runId, file, fn, task);
    return { ok: true };
  }
  /** Dial: tasks the Lander landed, each with how (clean / merged / identical / replayed / duplicate / replay_failed). */
  async landedTasks(runId, list, at, commits = {}) {
    const s = await this.st();
    if (!s || s.runId !== runId) return;
    for (const x of list) {
      this.sql.exec(`UPDATE rec SET landed_at = ?, status = ?, resolution = ?, commit_sha = ? WHERE run = ? AND task = ? AND status = 'ready'`, at, x.how === 'replay_failed' ? 'bounced' : 'landed', x.how, commits[x.path] || null, runId, x.task);
      this.sql.exec(`DELETE FROM claim WHERE run = ? AND task = ?`, runId, x.task);
    }
    s.counts.ready = Math.max(0, (s.counts.ready || 0) - list.length); s.counts.landed += list.filter((x) => x.how !== 'replay_failed').length;
    await this.save(s);
  }
  async landed(runId, files, at, commits = {}) {
    const s = await this.st();
    if (!s || s.runId !== runId) return;
    for (const f of files) this.sql.exec(`UPDATE rec SET landed_at = ?, status = 'landed', commit_sha = ? WHERE run = ? AND file = ? AND status = 'ready'`, at, commits[f] || null, runId, f);
    s.counts.ready = Math.max(0, (s.counts.ready || 0) - files.length); s.counts.landed += files.length;
    await this.save(s);
  }

  async checkShares(s) {
    if (s.state !== 'running') return;
    const p = s.cfg.pause, w = s.recent.slice(-p.window);
    if (w.length < Math.min(p.window, 10)) return;
    const share = (k) => w.filter((x) => x.status === k).length / w.length;
    if (share('rate_limited') > p.rateLimitShare) return this.autoPause(s, `rate limits (429) ${Math.round(share('rate_limited') * 100)}% of the last ${w.length}`);
    if (share('model_error') > p.modelErrorShare) return this.autoPause(s, `model errors ${Math.round(share('model_error') * 100)}% of the last ${w.length}`);
    // Artifacts read failures (S4e: 'An internal error occurred' under load) are retried; only a high share pauses.
    if (share('read_error') > (p.readErrorShare ?? 0.3)) return this.autoPause(s, `Artifacts read errors ${Math.round(share('read_error') * 100)}% of the last ${w.length}`);
    if (share('verify_fail') > p.verifyFailShare) return this.autoPause(s, `verify failures ${Math.round(share('verify_fail') * 100)}% of the last ${w.length}`);
  }
  /** AUTO-PAUSE: any signal over its line pauses the run and pushes the reason. */
  async checkAutoPause(s) {
    if (s.state !== 'running') return;
    const p = s.cfg.pause, w = s.recent.slice(-p.window);
    if (w.length >= Math.min(p.window, 10)) {
      const share = (k) => w.filter((x) => x.status === k).length / w.length;
      if (share('rate_limited') > p.rateLimitShare) return this.autoPause(s, `rate limits (429) ${Math.round(share('rate_limited') * 100)}% of the last ${w.length}`);
      if (share('model_error') > p.modelErrorShare) return this.autoPause(s, `model errors ${Math.round(share('model_error') * 100)}% of the last ${w.length}`);
    // Artifacts read failures (S4e: 'An internal error occurred' under load) are retried; only a high share pauses.
    if (share('read_error') > (p.readErrorShare ?? 0.3)) return this.autoPause(s, `Artifacts read errors ${Math.round(share('read_error') * 100)}% of the last ${w.length}`);
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
    log('auto_paused', { runId: s.runId, why, ladder: s.cfg.ladder || null });
    // Scale-ladder runs never push (S4e sent Eyal one push per copy, dozens at once): qb6 reports those through cc-com.
    // Other runs: at most one push per 10 minutes for the whole fleet.
    if (s.cfg.ladder) return;
    if (!(await budget(this.env).pushGate('autopause', 600_000))) return;
    await pushover(this.env, `qodebase fleet paused: ${why}`, `Run ${s.runId} (${s.cfg.repo || MAIN}): ${s.counts.landed} landed, $${s.usd.toFixed(3)}. Resume after a fix: POST /resume.`);
  }
  async pause(why) { const s = await this.st(); if (!s || s.state !== 'running') return { error: 'nothing running' }; s.state = 'paused'; s.pauses.push({ at: Date.now(), why }); await this.save(s); return { state: s.state }; }
  async resume(cfg = {}) {
    const s = await this.st(); if (!s || s.state !== 'paused') return { error: 'not paused' };
    const b = await budget(this.env).check(); if (!b.ok) return { error: b.why };
    for (const k of ['maxPerMin', 'planUsdPerMin', 'budgetUsd']) if (Number(cfg[k]) > 0) s.cfg[k] = k === 'budgetUsd' ? Math.min(Number(cfg[k]), s.usd + b.left) : Number(cfg[k]);
    if (cfg.pause && typeof cfg.pause === 'object') s.cfg.pause = { ...s.cfg.pause, ...cfg.pause };
    s.state = 'running'; s.recent = []; s.pauses.push({ at: Date.now(), why: 'resumed', cfg }); await this.save(s); return { state: s.state, cfg: s.cfg };
  }
  async stop(why) { const s = await this.st(); if (!s) return { error: 'no run' }; s.state = 'stopped'; s.stoppedWhy = why; s.endedAt = Date.now(); await this.save(s); await lander(this.env, s.cfg.repo || MAIN).flush(s.runId); return { state: s.state }; }
  async restart() { await this.ctx.storage.sync(); this.ctx.abort('restart on the deployed code'); }
  async agentFinished(runId) { const s = await this.st(); if (!s || s.runId !== runId) return; s.agentsDone++; if (s.agentsDone >= s.cfg.agents && s.state === 'running') { s.state = 'done'; s.endedAt = Date.now(); await lander(this.env, s.cfg.repo || MAIN).flush(runId); } await this.save(s); }

  async status() {
    const s = await this.st();
    if (!s) return { state: 'none' };
    const waits = this.sql.exec(`SELECT landed_at - at AS w FROM rec WHERE run = ? AND landed_at IS NOT NULL`, s.runId).toArray().map((x) => x.w).sort((a, b) => a - b);
    const pct = (a, q) => (a.length ? Math.round(a[Math.floor(a.length * q)] / 1000) : null);
    const minute = Math.floor(Date.now() / 60000);
    const lastMin = s.perMin[minute - 1] || { calls: 0, usd: 0 };
    const reasons = this.sql.exec(`SELECT status, reason, COUNT(*) AS n FROM rec WHERE run = ? AND status NOT IN ('ready','landed','skipped') GROUP BY status, reason ORDER BY n DESC LIMIT 8`, s.runId).toArray();
    // Counts from the records and the queue table (the source of truth), not from running tallies.
    const byStatus = Object.fromEntries(this.sql.exec(`SELECT status, COUNT(*) AS n FROM rec WHERE run = ? GROUP BY status`, s.runId).toArray().map((x) => [x.status, x.n]));
    const qq = this.sql.exec(`SELECT SUM(taken = 0) AS waiting, SUM(taken = 1) AS taken FROM q WHERE run = ?`, s.runId).toArray()[0] || {};
    const finals = Object.entries(byStatus).filter(([k]) => !k.endsWith('_retry')).reduce((n, [, v]) => n + v, 0);
    s.counts = { queued: qq.waiting || 0, model: Math.max(0, (qq.taken || 0) - finals), ready: byStatus.ready || 0, landed: byStatus.landed || 0, skipped: byStatus.skipped || 0,
      verify_fail: byStatus.verify_fail || 0, rejected: byStatus.rejected || 0, model_error: byStatus.model_error || 0, rate_limited: byStatus.rate_limited || 0,
      retried: (byStatus.rate_limited_retry || 0) + (byStatus.model_error_retry || 0) };
    return { runId: s.runId, state: s.state, model: s.cfg.model, agents: s.cfg.agents, agentsStarted: s.agentsStarted ?? null, inFlight: s.counts.model, files: s.files, base: s.base, startedAt: s.startedAt, endedAt: s.endedAt || null,
      counts: s.counts, usd: Math.round(s.usd * 10000) / 10000, budgetUsd: s.cfg.budgetUsd, calls: s.calls, lastMinute: lastMin,
      landWaitS: { p50: pct(waits, 0.5), p90: pct(waits, 0.9) }, errors: reasons, pauses: s.pauses.slice(-5), budget: await budget(this.env).check(), repo: s.cfg.repo || MAIN, root: s.cfg.root || 'src/vs', lander: await lander(this.env, s.cfg.repo || MAIN).summary() };
  }
  async runs() {
    const ids = this.sql.exec(`SELECT DISTINCT run FROM rec`).toArray().map((x) => x.run);
    const s = await this.st();
    const metas = await this.ctx.storage.get(ids.map((i) => `meta:${i}`)).then((m) => new Map([...m].map(([k, v]) => [k.slice(5), v])));
    return ids.map((id) => {
      const by = Object.fromEntries(this.sql.exec(`SELECT status, COUNT(*) AS n FROM rec WHERE run = ? GROUP BY status`, id).toArray().map((x) => [x.status, x.n]));
      const agg = this.sql.exec(`SELECT MIN(at) AS t0, MAX(at) AS t1, SUM(usd) AS usd, SUM(tin) AS tin, SUM(tout) AS tout, COUNT(DISTINCT file) AS files FROM rec WHERE run = ?`, id).toArray()[0];
      const waits = this.sql.exec(`SELECT landed_at - at AS w FROM rec WHERE run = ? AND landed_at IS NOT NULL`, id).toArray().map((x) => x.w).sort((a, b) => a - b);
      const models = {};
      for (const x of this.sql.exec(`SELECT model, status, COUNT(*) AS n, SUM(usd) AS usd FROM rec WHERE run = ? GROUP BY model, status`, id).toArray()) { const m = (models[x.model] ||= { usd: 0 }); m[x.status] = x.n; m.usd = Math.round((m.usd + (x.usd || 0)) * 10000) / 10000; }
      const meta = metas.get(id) || {};
      // Per model: calls (anything that reached a model: not 'skipped'), 429s, and its busiest minute.
      for (const x of this.sql.exec(`SELECT model, COUNT(*) AS calls, SUM(status LIKE 'rate_limited%') AS r429 FROM rec WHERE run = ? AND status != 'skipped' GROUP BY model`, id).toArray()) {
        const m = (models[x.model] ||= { usd: 0 }); m.calls = x.calls; m.rateLimited429 = x.r429 || 0;
        m.peakPerMin = this.sql.exec(`SELECT COUNT(*) AS n FROM rec WHERE run = ? AND model = ? AND status != 'skipped' GROUP BY at / 60000 ORDER BY n DESC LIMIT 1`, id, x.model).toArray()[0]?.n || 0;
        m.role = meta.overflow === x.model ? 'overflow' : meta.planned?.includes(x.model) ? 'planned' : (x.model.startsWith('gemini') ? 'overflow' : 'planned');
      }
      const perMinute = this.sql.exec(`SELECT at / 60000 AS minute, model, COUNT(*) AS calls FROM rec WHERE run = ? AND status != 'skipped' GROUP BY minute, model ORDER BY minute`, id).toArray().map((x) => ({ minute: x.minute * 60000, model: x.model, calls: x.calls }));
      const cur = s && s.runId === id ? s : null;
      const pct = (q) => (waits.length ? Math.round(waits[Math.floor(waits.length * q)] / 1000) : null);
      const t0 = cur?.startedAt || agg.t0, t1 = cur?.endedAt || agg.t1;
      return { runId: id, label: meta.label || null, ladder: meta.ladder || null, copy: meta.copy ?? null, repo: meta.repo || cur?.cfg.repo || MAIN, root: meta.root || cur?.cfg.root || 'src/vs', state: cur?.state || 'ended', agents: meta.agents ?? cur?.cfg.agents ?? null, agentsStarted: meta.agentsStarted ?? cur?.agentsStarted ?? null, files: agg.files,
        landed: by.landed || 0, ready: by.ready || 0, skipped: by.skipped || 0, verify_fail: by.verify_fail || 0, rejected: by.rejected || 0, rate_limited: by.rate_limited || 0, model_error: by.model_error || 0,
        retried: (by.rate_limited_retry || 0) + (by.model_error_retry || 0), usd: Math.round((agg.usd || 0) * 10000) / 10000, tokensIn: agg.tin, tokensOut: agg.tout,
        startedAt: t0, endedAt: t1, wallS: Math.round((t1 - t0) / 1000), landWaitS: { p50: pct(0.5), p90: pct(0.9) }, models, perMinute };
    });
  }

  /** Admin: fill in a past run's label and facts (runs from before run meta was kept). */
  async setMeta(runId, m) { const k = `meta:${runId}`; const cur = (await this.ctx.storage.get(k)) || {}; await this.ctx.storage.put(k, { ...cur, ...m }); return { ...cur, ...m }; }

  /** qb7's Runs page: the run in 10-second slices (calls by model, 429s, landed by lane, $, land wait p90) + sampled queue depth + marks. */
  async series(runId) {
    const s = await this.st(); const id = runId || s?.runId;
    const meta = (await this.ctx.storage.get(`meta:${id}`)) || {};
    const root = meta.root || 'src/vs';
    const by = new Map(); const slot = (t) => { const k = Math.floor(t / 10000) * 10000; if (!by.has(k)) by.set(k, { t: k, calls: {}, r429: 0, landed: 0, lanes: {}, usd: 0, waits: [], agents: new Set(), ready: 0, files: 0, door: { pushes: 0, files: 0, ms: 0 } }); return by.get(k); };
    for (const r of this.sql.exec(`SELECT at, ms, model, status, usd, agent, t_read FROM rec WHERE run = ?`, id).toArray()) {
      // active = agents that worked in the slice (a file's work spans at-ms..at); ready = files finished with a change.
      for (let t = Math.floor((r.at - (r.ms || 0)) / 10000) * 10000; t <= r.at; t += 10000) slot(t).agents.add(r.agent);
      const x = slot(r.at); x.files++; if (r.t_read != null) (x.reads ||= []).push(r.t_read);
      if (r.status === 'ready' || r.status === 'landed') x.ready++;
      if (r.status === 'skipped') continue;
      x.calls[r.model] = (x.calls[r.model] || 0) + 1; if (String(r.status).startsWith('rate_limited')) x.r429++; x.usd += r.usd || 0;
    }
    for (const p of await lander(this.env, meta.repo || s?.cfg.repo || MAIN).pushes(id).catch(() => [])) { const d = slot(p.at).door; d.pushes++; d.files += p.files; d.bytes = (d.bytes || 0) + (p.bytes || 0); d.ms = Math.max(d.ms, p.ms); }
    for (const r of this.sql.exec(`SELECT file, at, landed_at FROM rec WHERE run = ? AND landed_at IS NOT NULL`, id).toArray()) { const x = slot(r.landed_at); x.landed++; const ln = laneOf(r.file, root); x.lanes[ln] = (x.lanes[ln] || 0) + 1; x.waits.push(r.landed_at - r.at); }
    const samp = new Map(this.sql.exec(`SELECT * FROM samp WHERE run = ?`, id).toArray().map((r) => [r.t, { waiting: r.waiting, atModel: r.at_model, readyToLand: r.ready }]));
    const series = [...by.values()].sort((a, b) => a.t - b.t).map((x) => {
      const top = Object.entries(x.lanes).sort((a, b) => b[1] - a[1]); const lanes = Object.fromEntries(top.slice(0, 10)); const other = top.slice(10).reduce((n, [, v]) => n + v, 0); if (other) lanes.other = other;
      const w = x.waits.sort((a, b) => a - b);
      const rd = (x.reads || []).sort((a, b) => a - b);
      return { t: x.t, active: x.agents.size, files: x.files, ready: x.ready, door: x.door, readP50: rd.length ? rd[Math.floor(rd.length / 2)] : null, calls: x.calls, r429: x.r429, landed: x.landed, lanes, usd: Math.round(x.usd * 1e5) / 1e5, landWaitP90: w.length ? Math.round(w[Math.floor(w.length * 0.9)] / 1000) : null, queue: samp.get(x.t) || null };
    });
    const cur = s && s.runId === id ? s : null;
    const marks = (cur?.pauses || meta.pauses || []).map((p) => ({ at: p.at, kind: p.why === 'resumed' ? 'resume' : p.auto ? 'auto_pause' : 'pause', why: p.why }));
    if (cur?.state === 'stopped') marks.push({ at: cur.endedAt, kind: 'stop', why: cur.stoppedWhy || '' });
    return { runId: id, label: meta.label || null, ladder: meta.ladder || null, copy: meta.copy ?? null, start: series[0]?.t ?? cur?.startedAt ?? null, end: cur ? cur.endedAt || null : series.at(-1)?.t ?? null, slice: 10000, series, limits: meta.maxPerMin || {}, marks };
  }

  /** Drill-down (qb7, /runs v2), all bounded. Agents: per agent counts and its first/last file. */
  async agents(runId, offset = 0, limit = 200) {
    const rows = this.sql.exec(`SELECT agent, COUNT(*) AS files, SUM(status IN ('ready','landed')) AS changed, SUM(status = 'landed') AS landed, MIN(at - ms) AS first, MAX(at) AS last, SUM(ms) AS busy FROM rec WHERE run = ? AND status NOT LIKE '%_retry' GROUP BY agent ORDER BY agent LIMIT ? OFFSET ?`, runId, limit, offset).toArray();
    const total = this.sql.exec(`SELECT COUNT(DISTINCT agent) AS n FROM rec WHERE run = ?`, runId).toArray()[0]?.n || 0;
    return { runId, total, offset, agents: rows };
  }
  /** One agent's files in order: picked (work began), answered, verified, landed. */
  async agentFiles(runId, agent, offset = 0, limit = 200) {
    const rows = this.sql.exec(`SELECT file, status, model, at, ms, t_read, t_model, t_verify, landed_at, comments, reason FROM rec WHERE run = ? AND agent = ? ORDER BY at LIMIT ? OFFSET ?`, runId, agent, limit, offset).toArray();
    return { runId, agent, offset, files: rows.map(fileRow) };
  }
  /** What happened in one 10 s slice: files finished in it (cap 200), plus files that landed in it. */
  async slice(runId, t, offset = 0, limit = 200, to = null) {
    const t0 = Math.floor(Number(t) / 10000) * 10000;
    // to: a range of slices (qb7), at most 10 minutes; one slice by default.
    const t1 = to ? Math.min(Math.max(t0 + 10000, Math.ceil(Number(to) / 10000) * 10000), t0 + 600000) : t0 + 10000;
    const done = this.sql.exec(`SELECT file, agent, status, model, at, ms, t_read, t_model, t_verify, landed_at, comments, reason FROM rec WHERE run = ? AND at >= ? AND at < ? ORDER BY at LIMIT ? OFFSET ?`, runId, t0, t1, limit, offset).toArray();
    const n = this.sql.exec(`SELECT COUNT(*) AS n FROM rec WHERE run = ? AND at >= ? AND at < ?`, runId, t0, t1).toArray()[0]?.n || 0;
    const landed = this.sql.exec(`SELECT COUNT(*) AS n FROM rec WHERE run = ? AND landed_at >= ? AND landed_at < ?`, runId, t0, t1).toArray()[0]?.n || 0;
    return { runId, t: t0, to: t1, total: n, landedInSlice: landed, offset, changes: done.map(fileRow) };
  }
  /** One file's record(s) and what the diff needs (base blob hash, comments). */
  async fileRec(runId, path) {
    const rows = this.sql.exec(`SELECT * FROM rec WHERE run = ? AND file = ? ORDER BY at`, runId, path).toArray();
    const hash = this.sql.exec(`SELECT hash FROM q WHERE run = ? AND path = ?`, runId, path).toArray()[0]?.hash || null;
    const meta = (await this.ctx.storage.get(`meta:${runId}`)) || {};
    const s = await this.st();
    return { rows, hash, base: s?.runId === runId ? s.base : meta.base || null };
  }

  async records(runId) {
    const s = await this.st(); const id = runId || s?.runId;
    return this.sql.exec(`SELECT * FROM rec WHERE run = ? ORDER BY at`, id).toArray().map((r) => JSON.stringify(r)).join('\n') + '\n';
  }
}
/** The comments that went in: only the targets' names. */
const pickC = (tg, c) => Object.fromEntries(tg.filter((t) => typeof c?.[t.name] === 'string').map((t) => [t.name, c[t.name]]));
/** One file: its records, and the diff of the comments it got (rebuilt from the base blob + the stored comments; for cache
 *  runs before comments were stored, from the cache by the blob's hash). */
async function fileView(env, repo, runId, path, sha = null) {
  const f = await run(env, repo).fileRec(runId, path);
  if (!f.rows.length) return { error: 'no such file in this run' };
  const last = f.rows.at(-1);
  const out = { ...fileRow(last), tries: f.rows.length, commit: last.commit_sha || null, base: f.base, blob: f.hash, note: null, diff: null };
  // The change record from the commit's git note (runs from 2026-10-13 ~14:00 UTC on).
  const cn = (sha || last.commit_sha) ? await lander(env, repo).commitNote(runId, sha || last.commit_sha).catch(() => null) : null;
  if (cn) { const n = cn.note.split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((x) => x.file === path); if (n) out.note = { ...n, landedAt: last.landed_at || null }; }
  let c = last.cmt ? JSON.parse(last.cmt) : null;
  if (!c && last.model === 'cache' && f.hash) c = (await env.FLEET_CACHE.get(f.hash, 'json'))?.c || null;
  if (c && f.hash && (last.status === 'ready' || last.status === 'landed')) {
    using r = await ns(env, repo).get(repo);
    const blob = await r.readBlob(f.hash);
    if (blob) {
      const text = new TextDecoder().decode(await blob.arrayBuffer());
      const tg = targets(path, text);
      const lines = text.split('\n'), hunks = [];
      let added = 0;
      for (const t of tg) {
        const cl = cleanComment(c[t.name]); if (!cl) continue;
        const ind = (lines[t.line].match(/^\s*/) || [''])[0];
        const add = [`${ind}/**`, ...cl.map((l) => `${ind} * ${l}`), `${ind} */`];
        const ctxB = lines.slice(Math.max(0, t.line - 2), t.line), ctxA = lines.slice(t.line, t.line + 2);
        const oldStart = Math.max(0, t.line - 2) + 1;
        hunks.push(`@@ -${oldStart},${ctxB.length + ctxA.length} +${oldStart + added},${ctxB.length + add.length + ctxA.length} @@ ${t.name}\n` + [...ctxB.map((l) => ` ${l}`), ...add.map((l) => `+${l}`), ...ctxA.map((l) => ` ${l}`)].join('\n'));
        added += add.length;
      }
      out.diff = `--- a/${path}\n+++ b/${path}\n${hunks.join('\n')}`.slice(0, 60000);
    }
  }
  return out;
}

/** One commit: message, files (with status), and its git note. */
async function commitView(env, repo, runId, sha) {
  if (!/^[0-9a-f]{40}$/.test(sha)) return { error: 'sha: 40 hex' };
  const c = await lander(env, repo).commitNote(runId, sha);
  if (!c) return { error: 'not a commit of this run (commits are kept for the newest run of each copy)' };
  const notes = c.note.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { sha, at: c.at, lane: c.lane, message: c.message, files: notes.map((n) => ({ file: n.file, status: 'landed', agent: n.agent, source: n.source })), notes };
}

/** A ladder step's copies summed per slice (qb7): same shape as /series, plus copies (runs active in the slice). */
async function ladderSeries(env, ladder) {
  if (!ladder) return { error: 'ladder required' };
  const repos = [MAIN, ...((await budget(env).repos().catch(() => [])) || []).filter((x) => x !== MAIN)];
  const runs = (await Promise.all(repos.map((x) => run(env, x).runs().catch(() => [])))).flat().filter((r) => r.ladder === ladder);
  const all = await Promise.all(runs.map((r) => run(env, r.repo).series(r.runId).catch(() => null)));
  const by = new Map();
  for (const sr of all.filter(Boolean)) for (const x of sr.series) {
    const y = by.get(x.t) || { t: x.t, copies: 0, active: 0, files: 0, ready: 0, landed: 0, r429: 0, usd: 0, calls: {}, door: { pushes: 0, files: 0, ms: 0 }, landWaitP90: null };
    y.copies++; y.active += x.active || 0; y.files += x.files || 0; y.ready += x.ready || 0; y.landed += x.landed || 0; y.r429 += x.r429 || 0; y.usd += x.usd || 0;
    for (const [m, n] of Object.entries(x.calls || {})) y.calls[m] = (y.calls[m] || 0) + n;
    if (x.door) { y.door.pushes += x.door.pushes; y.door.files += x.door.files; y.door.bytes = (y.door.bytes || 0) + (x.door.bytes || 0); y.door.ms = Math.max(y.door.ms, x.door.ms); }
    if (x.landWaitP90 != null) y.landWaitP90 = Math.max(y.landWaitP90 ?? 0, x.landWaitP90);   // the worst copy's p90
    by.set(x.t, y);
  }
  const series = [...by.values()].sort((a, b) => a.t - b.t);
  return { ladder, runs: runs.map((r) => ({ repo: r.repo, runId: r.runId, copy: r.copy, state: r.state })), start: series[0]?.t ?? null, end: series.at(-1)?.t ?? null, slice: 10000, series };
}

/** A record as the drill-down shows it: picked = work began, answered = the model (or cache) answered, verified = done. */
function fileRow(r) {
  const picked = r.at - (r.ms || 0);
  const answered = r.t_read != null ? picked + (r.t_read || 0) + (r.t_model || 0) : null;
  return { file: r.file, agent: r.agent, status: r.status, source: r.model === 'cache' ? 'cache' : 'model', model: r.model, picked, answered, verified: r.at, landed: r.landed_at || null,
    landWaitS: r.landed_at ? Math.round((r.landed_at - r.at) / 100) / 10 : null, comments: r.comments || 0, ...(r.reason ? { reason: r.reason } : {}) };
}
const PRICES_OF = (env) => { try { return JSON.parse(env.FLEET_PRICES || '{}'); } catch { return {}; } };

// Not the code people use: tests, fixtures, build output, vendored deps.
const SKIP_DIRS = new Set(['test', 'tests', '__tests__', 'fixtures', '__fixtures__', 'testing', 'node_modules', 'compiled', 'dist', 'out', 'e2e', 'integrationtest', 'test-fixtures']);
async function listFiles(env, repoName = MAIN, root = 'src/vs') {
  using r = await ns(env, repoName).get(repoName);
  const tip = (await r.log({ limit: 1 }))[0];
  const out = [];
  let h = tip.treeHash;
  for (const part of root.split('/')) { const e = (await r.readTree(h)).find((x) => x.name === part && x.type === 'tree'); if (!e) throw new Error(`no ${root}/ in ${repoName}`); h = e.hash; }
  const walk = async (hash, prefix) => {
    for (const e of await r.readTree(hash)) {
      const p = `${prefix}/${e.name}`;
      if (e.type === 'tree') { if (!SKIP_DIRS.has(e.name)) await walk(e.hash, p); }
      else if (e.type === 'blob' && /\.m?ts$/.test(p) && !/\.d\.m?ts$|[._](test|spec)\.m?ts$/.test(p)) out.push({ path: p, hash: e.hash });
    }
  };
  await walk(h, root);
  // Lanes interleaved: a small run touches many folders, like a big one.
  const by = new Map(); for (const f of out) { const k = laneOf(f.path, root); if (!by.has(k)) by.set(k, []); by.get(k).push(f); }
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
  async begin(runId, i, repo = MAIN, batch = 1, pack = null) { await this.ctx.storage.put({ runId, i, repo, batch, pack }); await this.ctx.storage.setAlarm(Date.now() + Math.random() * 3000); }
  async alarm() {
    const runId = await this.ctx.storage.get('runId'), i = await this.ctx.storage.get('i'), repoName = (await this.ctx.storage.get('repo')) || MAIN;
    const R = run(this.env, repoName);
    let n;
    const batch = (await this.ctx.storage.get('batch')) || 1;
    // Infra errors on our own objects (an overloaded Run, a reset) are counted here and reported with the next result.
    try { n = await R.next(runId, batch); } catch (e) { await this.ctx.storage.put('infraErrs', ((await this.ctx.storage.get('infraErrs')) || 0) + 1); log('agent_infra_error', { runId, i, where: 'next', err: String(e?.message || e).slice(0, 200) }); await this.ctx.storage.setAlarm(Date.now() + 1000 + Math.random() * 2000); return; }
    if (n.stop) { await R.agentFinished(runId); return; }
    if (n.wait) { await this.ctx.storage.setAlarm(Date.now() + n.wait); return; }
    if (n.files) {
      // S4: a batch: each file worked in turn, the ready ones straight to the Lander (one call), then one done() for all.
      const rs = [];
      const pack = await this.ctx.storage.get('pack');
      if (n.files[0]?.task) for (const f of n.files) {
        const r = await this.workTask(runId, R, f, repoName).catch((e) => ({ file: f.path, status: 'model_error', reason: `crash: ${String(e?.message || e).slice(0, 200)}` }));
        Object.assign(r, { model: f.model, slot: f.slot, finishedAt: Date.now(), task: f.task, kind: f.kind, grp: f.grp }); rs.push(r);
      }
      else if (pack && n.files[0]?.provider !== 'cache') rs.push(...(await this.workPack(n.files, repoName, pack).catch((e) => n.files.map((f) => ({ file: f.path, status: 'model_error', reason: `crash: ${String(e?.message || e).slice(0, 200)}`, model: f.model, slot: f.slot, finishedAt: Date.now() })))));
      else for (const f of n.files) {
        const r = await this.work(f, f.model, f.provider, repoName).catch((e) => ({ file: f.path, status: 'model_error', reason: `crash: ${String(e?.message || e).slice(0, 200)}` }));
        r.model = f.model; r.slot = f.slot; r.finishedAt = Date.now(); rs.push(r);
      }
      const ready = rs.filter((r) => r.status === 'ready');
      try {
        // Records first, then the Lander: a fast land before the record exists was lost (S4d: 8 files on nest-6 stayed 'ready').
        // meta = the change record that goes into the lane commit's git note.
        const items = ready.map((r) => ({ lane: laneOf(r.file, n.root), path: r.file, text: r.text, at: Date.now(), task: r.task, base: r.base, names: r.names, cmtMap: r.cmt,
          meta: { intent: `add doc comments to ${r.file}`, agent: i, source: r.model === 'cache' ? 'cache' : 'model', model: r.model, comments: r.comments || 0,
            verify: { ok: true, how: `same code tokens before and after (${r.vTokens || '?'} syntax-tree tokens, comments and whitespace skipped), no new parse errors` },
            picked: r.finishedAt - (r.ms || 0), finished: r.finishedAt } }));
        for (const r of rs) delete r.text;
        rs[0].infraErrs = (await this.ctx.storage.get('infraErrs')) || 0;
        await R.doneMany(runId, i, rs); await this.ctx.storage.put('infraErrs', 0);
        if (items.length) await (items[0].task ? lander(this.env, repoName).addTasks(runId, items) : lander(this.env, repoName).addMany(runId, items));
      } catch (e) { await this.ctx.storage.put('infraErrs', ((await this.ctx.storage.get('infraErrs')) || 0) + 1); log('agent_infra_error', { runId, i, where: 'doneMany', err: String(e?.message || e).slice(0, 200) }); }
      await this.ctx.storage.setAlarm(Date.now() + 20);
      return;
    }
    const r = await this.work(n.file, n.model, n.provider, repoName).catch((e) => ({ file: n.file.path, status: 'model_error', reason: `crash: ${String(e?.message || e).slice(0, 200)}` }));
    r.model = n.model; r.slot = n.slot;
    r.infraErrs = (await this.ctx.storage.get('infraErrs')) || 0;
    try { await R.done(runId, i, r); await this.ctx.storage.put('infraErrs', 0); }
    catch (e) { await this.ctx.storage.put('infraErrs', r.infraErrs + 1); log('agent_infra_error', { runId, i, where: 'done', err: String(e?.message || e).slice(0, 200) }); }
    await this.ctx.storage.setAlarm(Date.now() + 50);
  }
  /** Dial task (cache mode): only this task's declarations; claims first when the run uses them. */
  async workTask(runId, R, f, repoName) {
    const t0 = Date.now();
    if (f.claims) { const c = await R.claim(runId, f.task, f.path, f.fns); if (c.caught) return { file: f.path, status: 'caught_early', reason: `task ${c.caught} holds it`, ms: Date.now() - t0 }; }
    const rd = await this.readText(repoName, f.hash);
    if (rd.error) return { file: f.path, status: 'read_error', reason: rd.error, ms: Date.now() - t0 };
    const tRead = Date.now() - t0;
    const hit = await this.env.FLEET_CACHE.get(f.hash, 'json');
    const c = {};
    for (const name of f.fns) if (typeof hit?.c?.[name] === 'string') c[name] = f.variant ? variantOf(hit.c[name]) : hit.c[name];
    const tg = targets(f.path, rd.text).filter((t) => f.fns.includes(t.name) && c[t.name]);
    if (!tg.length) return { file: f.path, status: hit ? 'skipped' : 'cache_miss', reason: hit ? 'nothing to document for this task' : 'no cached answer', ms: Date.now() - t0, tRead };
    const { text: next, inserted } = insert(rd.text, tg, c);
    const v = verify(f.path, rd.text, next);
    if (!inserted || !v.ok) return { file: f.path, status: v.ok ? 'rejected' : 'verify_fail', reason: v.why || 'nothing inserted', ms: Date.now() - t0, tRead };
    return { file: f.path, status: 'ready', text: next, comments: inserted, cmt: Object.fromEntries(tg.map((t) => [t.name, c[t.name]])), names: tg.map((t) => t.name), base: f.hash, vTokens: v.tokens, ms: Date.now() - t0, usd: 0, tRead, tModel: 0 };
  }
  /** One file's text from Artifacts, with the same retries as work(). */
  async readText(repoName, hash) {
    let lastErr = '';
    for (const wait of [0, 250, 1000, 3000]) {
      if (wait) await new Promise((r) => setTimeout(r, wait + Math.random() * wait));
      try { using repo = await ns(this.env, repoName).get(repoName); const b = await repo.readBlob(hash); if (b) return { text: new TextDecoder().decode(await b.arrayBuffer()) }; lastErr = 'blob not found'; }
      catch (e) { lastErr = `artifacts: ${String(e?.message || e).slice(0, 200)}`; }
    }
    return { error: lastErr };
  }
  /** One model call: Workers AI through the gateway, or Gemini; {raw, usd, tin, tout} or {status, reason}. */
  async callModel(model, provider, text, maxTokens = 1200) {
    let res;
    if (provider === 'google-ai-studio') {
      const g = await fetch(`https://gateway.ai.cloudflare.com/v1/887d7234a6b8d65ad355a4f6684cab67/${GATEWAY}/google-ai-studio/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': this.env.GEMINI_KEY },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text }] }], generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens, responseMimeType: 'application/json' } }),
      }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }));
      if (!g.ok) { const m = (await g.text()).slice(0, 200); return { status: g.status === 429 ? 'rate_limited' : 'model_error', reason: `gemini ${g.status}: ${m}` }; }
      const j = await g.json(); const u = j.usageMetadata || {};
      res = { response: j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '', usage: { prompt_tokens: u.promptTokenCount || 0, completion_tokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) } };
    } else try {
      // glm-5.3 keeps thinking with enable_thinking off; reasoning_effort low stops it (qb4's F0).
      res = await this.env.AI.run(model, { messages: [{ role: 'user', content: text }], max_tokens: maxTokens, temperature: 0.2, chat_template_kwargs: { enable_thinking: false }, ...(/glm-5/.test(model) ? { reasoning_effort: 'low' } : {}) }, { gateway: { id: GATEWAY } });
    } catch (e) { const m = String(e?.message || e); return { status: /429|rate.?limit|Too Many|3021/i.test(m) ? 'rate_limited' : 'model_error', reason: m.slice(0, 200) }; }
    const u = res?.usage || {}, tin = u.prompt_tokens || 0, tout = u.completion_tokens || 0, pr = PRICES_OF(this.env)[model];
    return { raw: res?.choices?.[0]?.message?.content ?? res?.response ?? res?.result?.response ?? '', usd: pr ? (tin * pr[0] + tout * pr[1]) / 1e6 : 0, tin, tout };
  }
  /** Batching: the batch's files with something to document go in packs (per model, up to pack.files / ~pack.tokens), one
   *  call per pack; each file inserted and verified on its own; a pack with no usable JSON is retried in halves once. */
  async workPack(files, repoName, pack) {
    const out = [], cand = [];
    const t0 = Date.now();
    for (const f of files) {
      const t1 = Date.now(); const rd = await this.readText(repoName, f.hash); const tRead = Date.now() - t1;
      const base = { file: f.path, model: f.model, slot: f.slot };
      if (rd.error) { out.push({ ...base, status: 'read_error', reason: rd.error, ms: Date.now() - t1, finishedAt: Date.now() }); continue; }
      const tg = targets(f.path, rd.text);
      if (!tg.length) { out.push({ ...base, status: 'skipped', reason: 'nothing to document', ms: Date.now() - t1, tRead, finishedAt: Date.now() }); continue; }
      cand.push({ ...f, id: `F${cand.length + 1}`, text: rd.text, tg, tRead });
    }
    const byModel = new Map(); for (const c of cand) { if (!byModel.has(c.model)) byModel.set(c.model, []); byModel.get(c.model).push(c); }
    const runPack = async (p, halves) => {
      const t1 = Date.now();
      const r = await this.callModel(p[0].model, p[0].provider, p.length === 1 ? prompt(p[0].path, p[0].text, p[0].tg) : promptPack(p), Math.min(4000, 400 + 300 * p.length));
      const tModel = Date.now() - t1;
      const size = p.reduce((n, x) => n + x.text.length, 0);
      if (r.status) { p.forEach((x, k) => out.push({ file: x.path, model: x.model, slot: x.slot, status: r.status, reason: r.reason, ms: Date.now() - t1, packN: p.length, packExtra: k > 0, finishedAt: Date.now() })); return; }
      const ans = p.length === 1 ? { [p[0].id]: parseAnswer(r.raw, p[0].tg) } : parseAnswerPack(r.raw, p);
      if (p.length > 1 && halves && !Object.values(ans).some((a) => Object.keys(a || {}).length)) {
        log('pack_split', { n: p.length, raw: String(r.raw).replace(/\s+/g, ' ').slice(0, 160) });
        const h = Math.ceil(p.length / 2);
        // The failed call's cost goes on the first half's first file.
        p[0].carry = { usd: r.usd, tin: r.tin, tout: r.tout };
        await runPack(p.slice(0, h), false); await runPack(p.slice(h), false); return;
      }
      p.forEach((x, k) => {
        const share = x.text.length / size, c = x.carry || { usd: 0, tin: 0, tout: 0 };
        const cost = { usd: r.usd * share + c.usd, tin: Math.round(r.tin * share) + c.tin, tout: Math.round(r.tout * share) + c.tout };
        const base = { file: x.path, model: x.model, slot: x.slot, packN: p.length, packExtra: k > 0, tRead: x.tRead, tModel, ...cost };
        const a = ans[x.id] || {};
        if (!Object.keys(a).length) { out.push({ ...base, status: 'rejected', reason: p.length > 1 ? `no usable answer for this file in a pack of ${p.length}` : `no usable JSON in the answer: ${String(r.raw).replace(/\s+/g, ' ').slice(0, 160)}`, ms: Date.now() - t0, finishedAt: Date.now() }); return; }
        const tV = Date.now();
        const { text: next, inserted } = insert(x.text, x.tg, a);
        if (!inserted) { out.push({ ...base, status: 'rejected', reason: 'no comment survived cleaning', ms: Date.now() - t0, finishedAt: Date.now() }); return; }
        const v = verify(x.path, x.text, next);
        if (!v.ok) { out.push({ ...base, status: 'verify_fail', reason: v.why, ms: Date.now() - t0, tVerify: Date.now() - tV, finishedAt: Date.now() }); return; }
        out.push({ ...base, status: 'ready', text: next, comments: inserted, cmt: pickC(x.tg, a), vTokens: v.tokens, ms: Date.now() - t0, tVerify: Date.now() - tV, finishedAt: Date.now() });
      });
    };
    for (const list of byModel.values()) for (const p of packFiles(list, pack.files, pack.tokens)) await runPack(p, true);
    return out;
  }
  async work(file, model, provider = 'workers-ai', repoName = MAIN) {
    const t0 = Date.now();
    let text, readTries = 0, lastErr = '';
    // An internal error on a read is retried here with backoff (S4e: a fresh namespace's forks failed 1,454 reads in one burst).
    for (const wait of [0, 250, 1000, 3000]) {
      if (wait) await new Promise((r) => setTimeout(r, wait + Math.random() * wait));
      readTries++;
      try {
        using repo = await ns(this.env, repoName).get(repoName);
        const blob = await repo.readBlob(file.hash);
        if (!blob) { lastErr = 'blob not found'; continue; }
        text = new TextDecoder().decode(await blob.arrayBuffer());
        break;
      } catch (e) { lastErr = `artifacts: ${String(e?.message || e).slice(0, 200)}`; }
    }
    if (text === undefined) return { file: file.path, status: 'read_error', reason: `${lastErr} (after ${readTries} tries)`, ms: Date.now() - t0 };
    if (readTries > 1) log('read_retried', { file: file.path, tries: readTries, err: lastErr.slice(0, 120) });
    const tRead = Date.now() - t0;
    const tg = targets(file.path, text);
    if (!tg.length) return { file: file.path, status: 'skipped', reason: 'nothing to document', ms: Date.now() - t0, tRead };
    if (provider === 'cache') {
      const hit = await this.env.FLEET_CACHE.get(file.hash, 'json');
      if (!hit) return { file: file.path, status: 'cache_miss', reason: 'no cached answer for this content', ms: Date.now() - t0, tRead };
      const tV = Date.now();
      const { text: next, inserted } = insert(text, tg, hit.c || {});
      if (!inserted) return { file: file.path, status: 'rejected', reason: 'cached answer names no target', ms: Date.now() - t0, tRead };
      const v = verify(file.path, text, next);
      const tVerify = Date.now() - tV;
      if (!v.ok) return { file: file.path, status: 'verify_fail', reason: v.why, ms: Date.now() - t0, tRead, tVerify };
      return { file: file.path, status: 'ready', text: next, comments: inserted, cmt: pickC(tg, hit.c), vTokens: v.tokens, ms: Date.now() - t0, usd: 0, tRead, tModel: 0, tVerify };
    }
    let res;
    if (provider === 'google-ai-studio') {
      // Gemini through the same AI Gateway (provider google-ai-studio), JSON answer, the provider's own token counts.
      const g = await fetch(`https://gateway.ai.cloudflare.com/v1/887d7234a6b8d65ad355a4f6684cab67/${GATEWAY}/google-ai-studio/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': this.env.GEMINI_KEY },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt(file.path, text, tg) }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 1200, responseMimeType: 'application/json' } }),
      }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }));
      if (!g.ok) { const m = (await g.text()).slice(0, 200); return { file: file.path, status: g.status === 429 ? 'rate_limited' : 'model_error', reason: `gemini ${g.status}: ${m}`, ms: Date.now() - t0 }; }
      const j = await g.json();
      const u = j.usageMetadata || {};
      res = { response: j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '', usage: { prompt_tokens: u.promptTokenCount || 0, completion_tokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) } };
    } else try {
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
    return { file: file.path, status: 'ready', text: next, comments: inserted, cmt: pickC(tg, answer), vTokens: v.tokens, ms: Date.now() - t0, usd, tin, tout, tRead };
  }
}

// ---- KataAgent: the code dial's agent (one task at a time through qodebase's real merge queue) ---
export class KataAgent extends DurableObject {
  async begin(runId, i, repo) { await this.ctx.storage.put({ runId, i, repo, job: null }); await this.ctx.storage.setAlarm(Date.now() + Math.random() * 5000); }
  landing(slug) { return this.env.LANDING.get(this.env.LANDING.idFromName(slug)); }
  async alarm() {
    const g = await this.ctx.storage.get(['runId', 'i', 'repo', 'job']);
    const runId = g.get('runId'), i = g.get('i'), R = run(this.env, g.get('repo'));
    let job = g.get('job');
    try {
      if (!job) {
        const n = await R.next(runId, 1);
        if (n.stop) { await R.agentFinished(runId); return; }
        if (n.wait) { await this.ctx.storage.setAlarm(Date.now() + n.wait); return; }
        const f = n.file;
        job = { ...f, model: n.model, provider: n.provider, slot: n.slot, stage: 'work', redos: 0, fails: 0, usd: 0, t0: Date.now(), changeId: `${f.slug}--k${runId.slice(-4)}${i}${Math.random().toString(36).slice(2, 5)}` };
      }
      if (job.stage === 'work' || job.stage === 'redo') {
        const r = await this.attempt(job, i);
        job.usd += r.usd || 0;
        if (r.error) {
          job.fails++;
          log('kata_attempt_failed', { runId, i, task: job.task, why: r.error, fails: job.fails });
          if (job.fails >= 3) return this.finish(R, runId, i, job, { status: job.stage === 'redo' ? 'bounced' : 'rejected', reason: r.error });
        } else { job.stage = 'wait'; job.queuedAt = Date.now(); }
      } else if (job.stage === 'wait') {
        const c = await this.landing(job.slug).change(job.changeId);
        if (c?.state === 'landed') return this.finish(R, runId, i, job, { status: 'landed', resolution: (job.redos ? `redo+${c.landing?.how || 'merged'}` : c.landing?.how || 'merged'), landedAt: c.landedAt || Date.now(), commit: c.landing?.mainCommit || null });
        if (c && ['replaying', 'bounced', 'with-lead'].includes(c.state)) {
          if (job.redos >= job.maxRedos) return this.finish(R, runId, i, job, { status: 'bounced', reason: `${c.state}: ${(c.events || []).slice(-1)[0]?.detail || ''}`.slice(0, 200) });
          job.redos++; job.stage = 'redo'; job.fails = 0;
        } else if (Date.now() - job.queuedAt > 30 * 60_000) return this.finish(R, runId, i, job, { status: 'bounced', reason: `still ${c?.state || 'unknown'} after 30 min` });
      }
    } catch (e) {
      job && (job.fails = (job.fails || 0) + 1);
      log('kata_error', { runId, i, task: job?.task, err: String(e?.stack || e).slice(0, 400) });
      if (job && job.fails >= 5) return this.finish(R, runId, i, job, { status: 'model_error', reason: `crash: ${String(e?.message || e).slice(0, 200)}` });
    }
    await this.ctx.storage.put('job', job);
    await this.ctx.storage.setAlarm(Date.now() + (job?.stage === 'wait' ? 4000 : 300));
  }
  async finish(R, runId, i, job, r) {
    await R.done(runId, i, { file: job.path, task: job.task, kind: job.kind, grp: job.grp, model: job.model, slot: job.slot, ms: Date.now() - job.t0, usd: job.usd, changeId: job.changeId, redos: job.redos, ...r });
    await this.ctx.storage.put('job', null);
    await this.ctx.storage.setAlarm(Date.now() + 100);
  }
  /** Main's file now -> the model -> the local check -> a fork with one commit -> the change recorded, pushed and queued. */
  async attempt(job, i) {
    const project = await this.env.PROJECT.get(this.env.PROJECT.idFromName(job.slug)).info();
    if (!project?.repo) return { error: 'no such project' };
    using main = await retry(() => this.env.ARTIFACTS_FORQ.get(project.repo));
    const head = (await retry(() => main.log({ limit: 1 })))[0];
    const h = await blobAt(main, new Objects(), head.treeHash, job.path);
    const b = await retry(() => main.readBlob(h));
    const text = new TextDecoder().decode(await b.arrayBuffer());
    const m = await Agent.prototype.callModel.call({ env: this.env }, job.model, job.provider, kataPrompt(job.text, job.path, text), 3000);
    if (m.status) return { error: `${m.status}: ${m.reason}` };
    const code = parseCode(m.raw);
    const chk = checkCode(job.path, code, job.fns[0]);
    if (!chk.ok) return { error: chk.why, usd: m.usd };
    const name = job.stage === 'redo' ? `${job.changeId}r${job.redos}` : job.changeId;
    const f = await retry(() => main.fork(name, { description: `fleet code dial: ${job.task}`.slice(0, 200), defaultBranchOnly: true }));
    using fr = await retry(() => this.env.ARTIFACTS_FORQ.get(f.name || name), [0, 500, 1500, 4000]);
    const objs = new Objects();
    const tree = await overlay(fr, objs, head.treeHash, [{ path: job.path, sha: objs.blob(code) }]);
    const commit = objs.commit(tree, [head.hash], `${job.task}\n\n${job.text}`.slice(0, 2000), Date.now(), `qodebase fleet agent ${i} <agent+fleet${i}@qodebase.app>`);
    const token = (await fr.createToken('write', 600)).plaintext;
    const p = await push({ remote: f.remote, token, branch: 'main', oldSha: head.hash, newSha: commit, objs: [...objs.map.values()] });
    if (!p.ok) return { error: `push to its fork: HTTP ${p.status} ${String(p.detail).slice(0, 120)}`, usd: m.usd };
    const L = this.landing(job.slug);
    if (job.stage === 'redo') await L.rebase(job.changeId, f.name || name, f.remote, head.hash);
    else await L.record(job.slug, { id: job.changeId, title: job.task.slice(0, 60), intent: job.text, agent: `fleet agent ${i}`, kind: 'fleet', fork: f.name || name, remote: f.remote, base: head.hash, claims: [job.path] });
    await L.pushed(job.changeId, commit, [job.path], job.stage === 'redo' ? 'redone on the latest main' : `${job.kind} ${job.task}`, head.hash);
    await L.reviewing(job.changeId);
    await L.reviewed(job.changeId, 'auto', '', true);
    return { ok: true, usd: m.usd };
  }
}

// ---- Lander: lanes by folder, one commit per lane, pushed in order ---------------------------
export class Lander extends DurableObject {
  // S4a: pending files were one 'lanes' object rewritten per file (and a key per text); now SQL rows, one insert per file.
  tables() {
    const q = (x) => this.ctx.storage.sql.exec(x);
    q(`CREATE TABLE IF NOT EXISTS pend (path TEXT PRIMARY KEY, lane TEXT, at INT, text TEXT)`); q(`CREATE INDEX IF NOT EXISTS pend_lane ON pend (lane, at)`);
    try { q(`ALTER TABLE pend ADD COLUMN meta TEXT`); } catch {}
    // The commits this run put on main, each with its git note (one JSON line per file).
    q(`CREATE TABLE IF NOT EXISTS cmt (sha TEXT PRIMARY KEY, at INT, lane TEXT, message TEXT, files INT, note TEXT)`); q(`CREATE INDEX IF NOT EXISTS cmt_at ON cmt (at)`);
    q(`CREATE TABLE IF NOT EXISTS push (at INT, ms INT, files INT, lanes INT, commit_sha TEXT, bytes INT)`);
    q(`CREATE TABLE IF NOT EXISTS nent (name TEXT PRIMARY KEY, sha TEXT)`);   // the notes tree's entries (commit -> note blob)
    // Dial: one row per task (several per file), merged per file at landing.
    q(`CREATE TABLE IF NOT EXISTS ptask (task TEXT PRIMARY KEY, path TEXT, lane TEXT, at INT, base TEXT, text TEXT, names TEXT, cmt TEXT, meta TEXT)`);
  }
  async begin(runId, base, repo = MAIN) { await this.ctx.storage.deleteAll(); this.tables(); await this.ctx.storage.put({ runId, base, repo, landed: 0, commits: 0, pushes: 0, stale: 0, errors: [] }); }
  async add(runId, lane, path, text, at) { return this.addMany(runId, [{ lane, path, text, at }]); }
  async addTasks(runId, items) {
    if ((await this.ctx.storage.get('runId')) !== runId) return;
    this.tables();
    for (const x of items) this.ctx.storage.sql.exec(`INSERT OR REPLACE INTO ptask (task, path, lane, at, base, text, names, cmt, meta) VALUES (?,?,?,?,?,?,?,?,?)`, x.task, x.path, x.lane, x.at, x.base, x.text, JSON.stringify(x.names || []), JSON.stringify(x.cmtMap || {}), x.meta ? JSON.stringify(x.meta) : null);
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 5000);
  }
  async addMany(runId, items) {
    if ((await this.ctx.storage.get('runId')) !== runId) return;
    this.tables();
    for (const x of items) this.ctx.storage.sql.exec(`INSERT OR REPLACE INTO pend (path, lane, at, text, meta) VALUES (?, ?, ?, ?, ?)`, x.path, x.lane, x.at, x.text, x.meta ? JSON.stringify(x.meta) : null);
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 5000);
  }
  async restart() { await this.ctx.storage.setAlarm(Date.now() + 2000); await this.ctx.storage.sync(); this.ctx.abort('restart on the deployed code'); }
  async flush(runId) { if ((await this.ctx.storage.get('runId')) === runId) await this.ctx.storage.setAlarm(Date.now() + 100); }
  async alarm() {
    const runId = await this.ctx.storage.get('runId');
    this.tables();
    if (this.ctx.storage.sql.exec(`SELECT COUNT(*) AS n FROM ptask`).toArray()[0].n) {
      try { await this.landTasks(runId); }
      catch (e) { const errors = (await this.ctx.storage.get('errors')) || []; errors.push({ at: Date.now(), err: String(e?.stack || e).slice(0, 600) }); await this.ctx.storage.put('errors', errors.slice(-20)); log('land_error', { runId, err: String(e?.stack || e).slice(0, 500) }); }
      await this.ctx.storage.setAlarm(Date.now() + 5000);
      return;
    }
    const keys = this.ctx.storage.sql.exec(`SELECT DISTINCT lane FROM pend`).toArray().map((x) => x.lane);
    if (!keys.length) return;
    try { await this.land(runId, keys); }
    catch (e) { const errors = (await this.ctx.storage.get('errors')) || []; errors.push({ at: Date.now(), err: String(e?.stack || e).slice(0, 600) }); await this.ctx.storage.put('errors', errors.slice(-20)); log('land_error', { runId, err: String(e?.stack || e).slice(0, 500) }); }
    await this.ctx.storage.setAlarm(Date.now() + 5000);
  }
  /** Dial: per file, every pending task lands on the file's current text the way git would (merge, else replay by intent,
   *  or 'duplicate' when its declaration already has a comment); one commit per lane, one push (main only: notes off here). */
  async landTasks(runId) {
    const repoName = (await this.ctx.storage.get('repo')) || MAIN;
    using repo = await ns(this.env, repoName).get(repoName);
    const token = (await repo.createToken('write', 600)).plaintext;
    const rows = this.ctx.storage.sql.exec(`SELECT task, path, lane, at, base, text, names, cmt FROM ptask ORDER BY at LIMIT 2000`).toArray();
    let lastWhy = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      const tip = (await repo.log({ limit: 1 }))[0];
      const objs = new Objects();
      let parent = tip.hash, tree = tip.treeHash;
      const results = [], commitOf = {};
      const blobs = new Map();
      const treeMemo = new Map();
      const readB = async (h) => { if (!blobs.has(h)) { const b = await retry(() => repo.readBlob(h)); blobs.set(h, b ? new TextDecoder().decode(await b.arrayBuffer()) : null); } return blobs.get(h); };
      const lanes = new Map(); for (const r of rows) { if (!lanes.has(r.lane)) lanes.set(r.lane, []); lanes.get(r.lane).push(r); }
      for (const [lane, list] of lanes) {
        const byPath = new Map(); for (const r of list) { if (!byPath.has(r.path)) byPath.set(r.path, []); byPath.get(r.path).push(r); }
        const files = [];
        for (const [path, ch] of byPath) {
          const curHash = await blobAt(repo, objs, tree, path, treeMemo);
          let cur = await readB(curHash);
          const orig = cur;
          for (const r of ch) {
            const base = r.base === curHash && cur === orig ? cur : await readB(r.base);
            const out = landOne(path, cur, base, r.text, JSON.parse(r.names), JSON.parse(r.cmt));
            results.push({ task: r.task, path, how: out.how });
            cur = out.text;
          }
          if (cur !== orig) files.push({ path, sha: objs.blob(cur) });
        }
        if (!files.length) continue;
        tree = await overlay(repo, objs, tree, files);
        parent = objs.commit(tree, [parent], `docs(${lane}): comments for ${files.length} file${files.length === 1 ? '' : 's'}\n\nqodebase fleet run ${runId} (collision dial); code unchanged (verified per file).`, Date.now(), 'qodebase fleet <fleet@qodebase.app>');
        for (const f of files) commitOf[f.path] = parent;
      }
      const tPush = Date.now();
      const p = parent === tip.hash ? { ok: true, bytes: 0 } : await push({ remote: remoteOf(repoName), token, branch: 'main', oldSha: tip.hash, newSha: parent, objs: [...objs.map.values()] });
      await this.ctx.storage.put('pushes', ((await this.ctx.storage.get('pushes')) || 0) + 1);
      if (p.ok) {
        for (const r of rows) this.ctx.storage.sql.exec(`DELETE FROM ptask WHERE task = ?`, r.task);
        await this.ctx.storage.put({ landed: ((await this.ctx.storage.get('landed')) || 0) + results.length, commits: ((await this.ctx.storage.get('commits')) || 0) + Object.keys(commitOf).length });
        this.ctx.storage.sql.exec(`INSERT INTO push (at, ms, files, lanes, commit_sha, bytes) VALUES (?,?,?,?,?,?)`, Date.now(), Date.now() - tPush, results.length, lanes.size, parent, p.bytes || 0);
        await run(this.env, repoName).landedTasks(runId, results, Date.now(), commitOf);
        log('landed_tasks', { runId, tasks: results.length, by: Object.fromEntries([...new Set(results.map((x) => x.how))].map((h) => [h, results.filter((x) => x.how === h).length])) });
        return;
      }
      await this.ctx.storage.put('stale', ((await this.ctx.storage.get('stale')) || 0) + 1);
      lastWhy = `HTTP ${p.status}: ${String(p.detail || '').replace(/\s+/g, ' ').slice(0, 300)}`;
    }
    throw new Error(`push failed 3 times; last: ${lastWhy}`);
  }
  /** One commit per lane on top of main's tip, all pushed together; a stale tip is re-read and the batch rebuilt. */
  async land(runId, keys) {
    const repoName = (await this.ctx.storage.get('repo')) || MAIN;
    using repo = await ns(this.env, repoName).get(repoName);
    const token = (await repo.createToken('write', 600)).plaintext;
    let lastWhy = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      const tip = (await repo.log({ limit: 1 }))[0];
      const objs = new Objects();
      let parent = tip.hash, tree = tip.treeHash;
      const landedFiles = [], commitOf = {}, made = [];
      for (const k of keys) {
        const items = this.ctx.storage.sql.exec(`SELECT path, text, meta FROM pend WHERE lane = ? ORDER BY at LIMIT 200`, k).toArray();
        tree = await overlay(repo, objs, tree, items.map((x) => ({ path: x.path, sha: objs.blob(x.text) })));
        const message = `docs(${k}): comments for ${items.length} file${items.length === 1 ? '' : 's'}\n\nqodebase fleet run ${runId}; code unchanged (verified per file).`;
        const at = Date.now();
        parent = objs.commit(tree, [parent], message, at, 'qodebase fleet <fleet@qodebase.app>');
        // The commit's git note: the change record of every file in it (qodebase's refs/notes/qodebase, like the merge queue).
        const note = items.map((x) => JSON.stringify({ file: x.path, run: runId, ...(x.meta ? JSON.parse(x.meta) : {}), committed: at })).join('\n') + '\n';
        made.push({ sha: parent, at, lane: k, message, files: items.length, note });
        landedFiles.push(...items.map((x) => x.path));
        for (const x of items) commitOf[x.path] = parent;
      }
      // Notes: the old notes tree (flat: one blob per commit) plus this push's notes, as one new notes commit.
      // The Lander is the notes ref's only writer, so it keeps the tip and the entries itself: right after a push log() still
      // returns the old tip, and Artifacts applies both refs atomically, so a stale notes ref aborted main too (S4e: 105 of 106
      // pushes refused on one copy). Read from git only on a run's first push. After two notes failures main goes alone.
      const NOTES = 'refs/notes/qodebase';
      const withNotes = ((await this.ctx.storage.get('notesFails')) || 0) < 2;
      let notesCommit = null, nt = null;
      if (withNotes) {
        nt = await this.ctx.storage.get('notesTip');
        if (nt === undefined) {
          const t = (await repo.log({ ref: NOTES, limit: 1 }).catch(() => []))[0];
          nt = t ? t.hash : null;
          for (const e of t ? await repo.readTree(t.treeHash).catch(() => []) : []) if (e.type === 'blob') this.ctx.storage.sql.exec(`INSERT OR REPLACE INTO nent (name, sha) VALUES (?, ?)`, e.name, e.hash);
        }
        const entries = new Map(this.ctx.storage.sql.exec(`SELECT name, sha FROM nent`).toArray().map((e) => [e.name, { name: e.name, mode: '100644', sha: e.sha }]));
        for (const c of made) entries.set(c.sha, { name: c.sha, mode: '100644', sha: (c.noteSha = objs.blob(c.note)) });
        notesCommit = objs.commit(objs.treeOf([...entries.values()]), nt ? [nt] : [], `Notes added by qodebase fleet (run ${runId})`, Date.now(), 'qodebase fleet <fleet@qodebase.app>');
      }
      const tPush = Date.now();
      const p = await push({ remote: remoteOf(repoName), token, branch: 'main', oldSha: tip.hash, newSha: parent, objs: [...objs.map.values()],
        extra: withNotes ? [{ ref: NOTES, oldSha: nt || '0'.repeat(40), newSha: notesCommit }] : [] });
      if (withNotes && !p.ok && /refs\/notes\/qodebase stale/.test(p.detail || '')) {
        // Our tip is wrong (another writer, or a lost reply): re-read from git next time; two in a row -> main alone.
        await this.ctx.storage.delete('notesTip'); this.ctx.storage.sql.exec(`DELETE FROM nent`);
        await this.ctx.storage.put('notesFails', ((await this.ctx.storage.get('notesFails')) || 0) + 1);
      }
      await this.ctx.storage.put('pushes', ((await this.ctx.storage.get('pushes')) || 0) + 1);
      if (p.ok) {
        // Only the landed rows go: files added while this batch was pushing stay (F2 at 10 agents lost 9 that way once).
        for (const f of landedFiles) this.ctx.storage.sql.exec(`DELETE FROM pend WHERE path = ?`, f);
        await this.ctx.storage.put({ landed: ((await this.ctx.storage.get('landed')) || 0) + landedFiles.length, commits: ((await this.ctx.storage.get('commits')) || 0) + keys.length });
        for (const c of made) this.ctx.storage.sql.exec(`INSERT OR REPLACE INTO cmt (sha, at, lane, message, files, note) VALUES (?,?,?,?,?,?)`, c.sha, c.at, c.lane, c.message, c.files, c.note);
        if (withNotes && p.refs?.[NOTES]) {
          await this.ctx.storage.put({ notesTip: notesCommit, notesFails: 0 });
          for (const c of made) this.ctx.storage.sql.exec(`INSERT OR REPLACE INTO nent (name, sha) VALUES (?, ?)`, c.sha, c.noteSha);
        } else log('notes_not_pushed', { runId, repo: repoName, withNotes });
        this.ctx.storage.sql.exec(`INSERT INTO push (at, ms, files, lanes, commit_sha, bytes) VALUES (?,?,?,?,?,?)`, Date.now(), Date.now() - tPush, landedFiles.length, keys.length, parent, p.bytes || 0);
        await run(this.env, repoName).landed(runId, landedFiles, Date.now(), commitOf);
        log('landed', { runId, lanes: keys.length, files: landedFiles.length, commit: parent.slice(0, 10) });
        return;
      }
      await this.ctx.storage.put('stale', ((await this.ctx.storage.get('stale')) || 0) + 1);
      lastWhy = `HTTP ${p.status}: ${String(p.detail || '').replace(/\s+/g, ' ').slice(0, 300)}`;
      log('push_retry', { runId, attempt, status: p.status, why: lastWhy });
    }
    throw new Error(`push failed 3 times; last: ${lastWhy}`);
  }
  /** The door: every push of this run (the Lander is per repo and begins fresh per run). */
  async pushes(runId) {
    if ((await this.ctx.storage.get('runId')) !== runId) return [];
    this.tables();
    return this.ctx.storage.sql.exec(`SELECT * FROM push ORDER BY at`).toArray();
  }
  /** Commits this run put on main (newest run only: the Lander begins fresh per run). */
  async commits(runId, t0, t1, offset = 0, limit = 200) {
    if ((await this.ctx.storage.get('runId')) !== runId) return null;
    this.tables();
    const rows = this.ctx.storage.sql.exec(`SELECT sha, at, lane, message, files FROM cmt WHERE at >= ? AND at < ? ORDER BY at LIMIT ? OFFSET ?`, t0, t1, limit, offset).toArray();
    const total = this.ctx.storage.sql.exec(`SELECT COUNT(*) AS n FROM cmt WHERE at >= ? AND at < ?`, t0, t1).toArray()[0]?.n || 0;
    return { total, commits: rows.map((r) => ({ ...r, message: r.message.split('\n')[0] })) };
  }
  async commitNote(runId, sha) {
    if ((await this.ctx.storage.get('runId')) !== runId) return null;
    this.tables();
    return this.ctx.storage.sql.exec(`SELECT sha, at, lane, message, files, note FROM cmt WHERE sha = ?`, sha).toArray()[0] || null;
  }
  async summary() {
    const g = await this.ctx.storage.get(['landed', 'commits', 'pushes', 'stale', 'errors']);
    this.tables();
    const w = this.ctx.storage.sql.exec(`SELECT COUNT(*) AS n, COUNT(DISTINCT lane) AS l FROM pend`).toArray()[0] || {};
    const wt = this.ctx.storage.sql.exec(`SELECT COUNT(*) AS n, COUNT(DISTINCT lane) AS l FROM ptask`).toArray()[0] || {};
    return { waiting: (w.n || 0) + (wt.n || 0), lanes: (w.l || 0) + (wt.l || 0), landed: g.get('landed') || 0, commits: g.get('commits') || 0, pushes: g.get('pushes') || 0, stale: g.get('stale') || 0, errors: (g.get('errors') || []).slice(-3) };
  }
}

/** The blob hash at a path in a tree (in-memory trees from this batch first). */
async function blobAt(repo, objs, rootHash, path, memo = new Map()) {
  let h = rootHash;
  const parts = path.split('/');
  for (let k = 0; k < parts.length; k++) {
    const o = objs.map.get(h);
    // Trees by hash, memoised for the whole land (a land of 1,000+ files walked from the root each time and Artifacts
    // answered 'internal error'), and retried with backoff.
    if (!(o && o.type === 'tree') && !memo.has(h)) memo.set(h, await retry(() => repo.readTree(h)));
    const entries = o && o.type === 'tree' ? parseTree(o.body).map((e) => ({ name: e.name, hash: e.sha, type: e.type })) : memo.get(h);
    const e = (entries || []).find((x) => x.name === parts[k]);
    if (!e) throw new Error(`no ${path} on main`);
    h = e.hash;
  }
  return h;
}

/** Dial checker (one page of files): main's final text vs the base. Per file: code unchanged; per declaration at most one
 *  doc comment; per landed task its comment present (clean/merged/identical/replayed) or a comment there (duplicate). */
async function dialCheck(env, repoName, runId, offset, limit) {
  const { total, files } = await run(env, repoName).dialFiles(runId, offset, limit);
  using repo = await ns(env, repoName).get(repoName);
  const tip = (await repo.log({ limit: 1 }))[0];
  const objs = new Objects();
  const out = { total, offset, n: files.length, codeChanged: [], doubled: [], lost: [], ok: 0, tasks: 0, byResolution: {} };
  for (const f of files) {
    const [bb, fb] = [await repo.readBlob(f.hash), await repo.readBlob(await blobAt(repo, objs, tip.treeHash, f.path))];
    const base = new TextDecoder().decode(await bb.arrayBuffer()), fin = new TextDecoder().decode(await fb.arrayBuffer());
    if (!verify(f.path, base, fin).ok) out.codeChanged.push(f.path);
    // The /** blocks above each declaration, from the parser; only declarations that had none at base count.
    const before = docBlocks(f.path, base), after = docBlocks(f.path, fin), above = new Map();
    for (const [name, blocks] of after) {
      if ((before.get(name) || []).length) continue;
      above.set(name, { n: blocks.length, text: blocks.join(' ') });
      if (blocks.length > 1) out.doubled.push(`${f.path}#${name}`);
    }
    for (const t of f.tasks) {
      const res = t.resolution || t.status || 'not done';
      out.byResolution[res] = (out.byResolution[res] || 0) + 1;
      if (t.status !== 'landed') continue;
      out.tasks++;
      const c = JSON.parse(t.cmt || '{}');
      for (const fn of JSON.parse(t.fns)) {
        const a = above.get(fn);
        if (!a) continue;   // not a target in this copy
        const want = (cleanComment(c[fn]) || [''])[0].slice(0, 40);
        const ok = t.resolution === 'duplicate' ? a.n >= 1 : !!want && a.text.includes(want.split(' ').slice(0, 5).join(' '));
        if (!ok) out.lost.push({ task: t.task, fn, file: f.path, resolution: t.resolution });
      }
      out.ok++;
    }
  }
  return out;
}

/** An Artifacts read with backoff (internal errors under load). */
async function retry(fn, waits = [0, 300, 1000, 3000]) {
  let last;
  for (const w of waits) { if (w) await new Promise((r) => setTimeout(r, w + Math.random() * w)); try { return await fn(); } catch (e) { last = e; } }
  throw last;
}

/** The second agent's comment on the same declaration (cache mode): a different text, so the two really collide. */
const variantOf = (c) => { const first = String(c).split(/(?<=\.)\s/)[0].trim(); return first !== String(c).trim() ? first : `${first.replace(/\.$/, '')}; see the code for details.`; };

/** Collision dial tasks over the files' cached declarations. Level 0: one task per file (all its declarations). Level L:
 *  some files become a PAIR of tasks picked at the same moment (adjacent in the queue), so that pair tasks are L of all;
 *  pairs cycle far (first + last declaration), near (two neighbours), same (one declaration twice, different text). */
async function dialTasks(env, files, level, seed) {
  const withNames = new Array(files.length);
  for (let i = 0; i < files.length; i += 50) await Promise.all(files.slice(i, i + 50).map(async (f, k) => { const h = await env.FLEET_CACHE.get(f.hash, 'json'); const names = Object.keys(h?.c || {}); if (names.length) withNames[i + k] = { ...f, names }; }));
  const fl = withNames.filter(Boolean);
  let rnd = [...String(seed)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const rand = () => ((rnd = (rnd * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const k = Math.round((level * fl.length) / (2 - level));
  const kinds = ['far', 'near', 'same'];
  const pairIdx = new Set(), want = { far: 0, near: 0, same: 0 };
  const order = fl.map((_, i) => i).sort(() => rand() - 0.5);
  // Each paired file takes the kind it fits (far needs 3+ declarations, near 2+) that has the fewest pairs so far.
  for (const i of order) {
    if (pairIdx.size >= k) break;
    const n = fl[i].names.length;
    const fits = kinds.filter((kd) => !(kd === 'far' && n < 3) && !(kd === 'near' && n < 2));
    const kind = fits.sort((a, b) => want[a] - want[b])[0];
    pairIdx.add(i); fl[i].pairKind = kind; want[kind]++;
  }
  const units = fl.map((f, i) => {
    if (!pairIdx.has(i)) return [{ path: f.path, hash: f.hash, fns: f.names, kind: 'solo', grp: null }];
    const g = `p${i}`, n = f.names;
    if (f.pairKind === 'far') return [{ path: f.path, hash: f.hash, fns: [n[0]], kind: 'far', grp: g }, { path: f.path, hash: f.hash, fns: [n[n.length - 1]], kind: 'far', grp: g }];
    if (f.pairKind === 'near') { const j = Math.floor(rand() * (n.length - 1)); return [{ path: f.path, hash: f.hash, fns: [n[j]], kind: 'near', grp: g }, { path: f.path, hash: f.hash, fns: [n[j + 1]], kind: 'near', grp: g }]; }
    const j = Math.floor(rand() * n.length);
    return [{ path: f.path, hash: f.hash, fns: [n[j]], kind: 'same', grp: g }, { path: f.path, hash: f.hash, fns: [n[j]], kind: 'same', grp: g, variant: 1 }];
  });
  units.sort(() => rand() - 0.5);
  const tasks = units.flat().map((t, i) => ({ ...t, task: `t${i}` }));
  tasks.dial = { level, pairs: want, pairShare: Math.round((tasks.filter((t) => t.grp).length / tasks.length) * 1000) / 1000, files: fl.length };
  return tasks;
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
