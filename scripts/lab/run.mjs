#!/usr/bin/env node
// Variants lab runner (docs/lab/PLAN.md, schema docs/lab/runs-schema.md). One REAL run of one
// variant on one scenario, from the laptop:
//
//   node --experimental-strip-types scripts/lab/run.mjs --scenario cafe-family --stage 1 --seed 1 \
//        --variant '{"planner":"haiku","coders":3,"coderModel":"haiku","reviewers":1,...}'
//   node … --baseline opus-alone|github  (the variant comes from predict.js BASELINES)
//   options: --budget <usd per run, default 2>  --timeout <min, default 40>  --dry (plan only)
//
// It: predicts the run (public/lab/predict.js), checks the stage cap, creates a fresh UNLISTED
// project (eyal/lab-…), pushes the scenario's starter as one commit with a fixed author and date
// (stable sha = scenarioCommit), sets the variant as landing flags, sends the scenario prompt to
// the router (opus-alone: straight to ONE agent, no router), watches until the work settles,
// stops every box, scores the final main with qb5's scorer ON THE LAPTOP (hidden tests never leave
// it), and appends one line to public/lab/runs.jsonl. Logs JSONL to ~/.local/share/qodebase-lab/runner.jsonl.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, rmSync, readdirSync, statSync, mkdtempSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { predict, variantKey, BASELINES, DEFAULT_VARIANT } from '../../public/lab/predict.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const API = process.env.QB_API || 'https://forq.forqdev.workers.dev';
const SECRET = readFileSync(join(homedir(), '.config/forq/admin-secret'), 'utf8').trim();
const LOGDIR = join(homedir(), '.local/share/qodebase-lab'); mkdirSync(LOGDIR, { recursive: true });
const log = (event, data = {}) => { const l = JSON.stringify({ ts: new Date().toISOString(), module: 'lab-runner', event, ...data }); appendFileSync(join(LOGDIR, 'runner.jsonl'), l + '\n'); console.log(l); };

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const has = (k) => args.includes(k);

// Stage caps: a stage stops itself (refuses to start a run) at these, real container dollars and
// API-equivalent dollars at the >100k tier summed over the stage's lines in runs.jsonl. The whole
// lab: <= $10 real, <= 15% of the weekly quota (the stage guard below reads the real meter).
export const STAGE_CAPS = { 1: { usdReal: 2, apiUsdHigh: 15, quotaPts: 5 }, 2: { usdReal: 5, apiUsdHigh: 40, quotaPts: 8 }, 3: { usdReal: 3, apiUsdHigh: 25, quotaPts: 2 } };

// Network retries: any method when the connection never opened (the server never saw it; run 2's
// first try died on a connect timeout, 2026-10-08), reads also on other network errors.
const NEVER_SENT = /UND_ERR_CONNECT_TIMEOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH/;
async function api(method, path, body) {
  let r;
  for (let i = 0; ; i++) {
    try { r = await fetch(API + path, { signal: AbortSignal.timeout(120_000), method, headers: { 'x-forq-secret': SECRET, 'user-agent': 'forq-cli/1', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); break; }
    catch (e) {
      const code = String(e?.cause?.code || e?.cause?.name || e?.name || '');
      const retry = i < 5 && (NEVER_SENT.test(code) || method === 'GET');
      log('api_retry', { method, path, code, try: i + 1, retry });
      if (!retry) throw e;
      await sleep(5000 * (i + 1));
    }
  }
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 300) }; }
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const meter = () => { try { const l = readFileSync(join(homedir(), '.claude/data/history.jsonl'), 'utf8').trim().split('\n').pop(); const d = JSON.parse(l); return { at: d.timestamp, weekly: d.weekly_all_pct, session: d.session_pct }; } catch { return null; } };

// ---- inputs ----------------------------------------------------------------------------
// --plan public/lab/stage1-plan.json --order N: the run comes from qb4's plan (variant, baseline,
// predicted, guards); seed = how many earlier entries of the plan share its variantKey, plus one.
const PLAN = opt('--plan') ? JSON.parse(readFileSync(join(ROOT, opt('--plan')), 'utf8')) : null;
const entry = PLAN ? PLAN.runs.find((r) => r.order === Number(opt('--order'))) : null;
if (PLAN && !entry) throw new Error(`no order ${opt('--order')} in the plan`);
const scenarioId = opt('--scenario', entry?.scenario || PLAN?.scenario);   // a plan entry can name its own scenario
const stage = Number(opt('--stage', String(PLAN?.stage ?? 1)));
const seed = entry ? (entry.repetition ?? entry.seed ?? PLAN.runs.filter((r) => r.order <= entry.order && r.variantKey === entry.variantKey && (r.scenario || PLAN.scenario) === (entry.scenario || PLAN.scenario)).length) : Number(opt('--seed', '1'));
const baseline = entry ? entry.baseline : opt('--baseline', null);
const budget = Number(opt('--budget', '2'));
const timeoutMin = Number(opt('--timeout', '40'));
if (!scenarioId) { console.error('usage: run.mjs --scenario <id> [--variant JSON | --baseline opus-alone|github] [--stage N] [--seed N] [--budget usd] [--timeout min] [--dry]'); process.exit(2); }
const SDIR = opt('--scenario-dir', join(ROOT, 'scripts/lab/scenarios', scenarioId));   // override: test a stand-in scenario
const scenario = JSON.parse(readFileSync(join(SDIR, 'scenario.json'), 'utf8'));
const prompt = (scenario.prompt || readFileSync(join(SDIR, 'prompt.txt'), 'utf8')).trim();
const variant = { ...DEFAULT_VARIANT, ...(entry ? entry.variant : baseline ? BASELINES[baseline] : JSON.parse(opt('--variant', '{}'))) };
if (baseline && !BASELINES[baseline]) throw new Error(`unknown baseline ${baseline}`);
const key = variantKey(variant, baseline);
const pred = predict(variant, scenario.profile ? { ...scenario.profile, id: scenarioId } : scenarioId, { baseline });
// The plan's predicted block wins (qb4 recalibrates it between checkpoints).
const predicted = entry?.predicted || { landed: pred.landed, wallS: pred.wallS, apiUsdStd: pred.apiUsdStd, quality: pred.quality, simVersion: pred.simVersion };
const hash = createHash('sha1').update(`${key}|${scenarioId}|${stage}`).digest('hex').slice(0, 5);
const short = scenarioId.replace(/[^a-z0-9]/g, '').slice(0, 10);
// --retry <letter>: redo a run that broke for reasons outside the variant (same seed, fresh project).
const name = `lab-${short}-${hash}-r${seed}${opt('--retry', '')}`;   // NAME_RE: no '--', <= 39 chars
const slug = `eyal.${name}`;

// ---- stage guard -------------------------------------------------------------------------
const RUNS = join(ROOT, opt('--out', 'public/lab/runs.jsonl'));   // --out public/lab/runs.smoke.jsonl for runner smoke tests
const STAGES = join(ROOT, 'public/lab/stages.jsonl');
const lines = existsSync(RUNS) ? readFileSync(RUNS, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const spent = lines.filter((l) => l.stage === stage).reduce((a, l) => ({ usdReal: a.usdReal + (l.cost?.usdReal || 0), apiUsdHigh: a.apiUsdHigh + (l.cost?.apiUsdHigh || 0), apiUsdStd: a.apiUsdStd + (l.cost?.apiUsdStd || 0) }), { usdReal: 0, apiUsdHigh: 0, apiUsdStd: 0 });
// The plan's guards replace the defaults: stop at its API-equivalent total or weekly-meter rise.
const cap = PLAN?.guards ? { usdReal: (STAGE_CAPS[stage] || STAGE_CAPS[1]).usdReal, apiUsdHigh: Infinity, apiUsdStd: PLAN.guards.stopAtApiUsdStd, quotaPts: PLAN.guards.stopAtWeeklyMeterRisePts } : { apiUsdStd: Infinity, ...(STAGE_CAPS[stage] || STAGE_CAPS[1]) };
const stageRows = existsSync(STAGES) ? readFileSync(STAGES, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.stage === stage) : [];
const startMeter = stageRows.find((r) => r.event === 'start')?.meter;
const now = meter();
const quotaUsed = startMeter && now ? now.weekly - startMeter.weekly : 0;
log('plan', { scenario: scenarioId, stage, seed, baseline, variantKey: key, project: slug, predicted, spent, cap, quotaUsed, budget });
if (spent.usdReal >= cap.usdReal || spent.apiUsdHigh >= cap.apiUsdHigh || spent.apiUsdStd >= cap.apiUsdStd || quotaUsed >= cap.quotaPts) { log('stage_cap', { spent, cap, quotaUsed }); console.error('stage cap reached: not starting'); process.exit(3); }
// Projected: the sim's estimate of this run must also fit (its numbers are stage-0 guesses until calibrated).
if ((spent.apiUsdHigh + (predicted.apiUsdStd || 0) > cap.apiUsdHigh || spent.apiUsdStd + (predicted.apiUsdStd || 0) > cap.apiUsdStd) && !has('--force')) { log('stage_cap_projected', { spent, predicted, cap }); console.error(`this run is predicted at $${predicted.apiUsdStd} API-equivalent: over the stage cap ($${cap.apiUsdHigh}); --force to run anyway`); process.exit(3); }
if (has('--dry')) process.exit(0);
if (!startMeter) appendFileSync(STAGES, JSON.stringify({ stage, event: 'start', at: Date.now(), meter: now, label: 'account-wide cc-usage meter' }) + '\n');

// ---- project + starter ------------------------------------------------------------------------
const existing = await api('GET', `/api/p/eyal/${name}`).catch(() => null);
if (existing && !existing.error) throw new Error(`${slug} exists: a run with this variant/seed was already made (use another --seed)`);
const created = await api('POST', `/api/p/eyal/${name}/create`, { description: `Variants lab run: ${scenario.title || scenarioId}, ${baseline || key}` });
const work = mkdtempSync(join(tmpdir(), 'qblab-'));
const starter = join(work, 'starter');
const g = (cwd, ...a) => execFileSync('git', ['-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' }).trim();
// qb5's scenario builder: the starter as a git repo with one fixed-date commit (stable sha).
const built = JSON.parse(execFileSync('node', ['--experimental-strip-types', '--no-warnings', join(ROOT, 'scripts/lab/scenario.mjs'), scenarioId, '--out', starter], { encoding: 'utf8' }).trim().split('\n').pop());
const scenarioCommit = built.scenarioCommit;
if (g(starter, 'rev-parse', 'HEAD') !== scenarioCommit) throw new Error('starter sha does not match scenario.mjs');
Object.assign(scenario, { promptVersion: built.promptVersion, scenarioVersion: built.scenarioVersion, check: built.check });
const tok = created.token.split('?')[0];
g(starter, '-c', `http.extraHeader=Authorization: Basic ${Buffer.from(`x:${tok}`).toString('base64')}`, 'push', '-q', created.info.remote, 'HEAD:main');
log('project', { project: slug, scenarioCommit });

// ---- the variant as landing flags ----------------------------------------------------------
const flags = {
  landing: true, unlisted: true, autoMerge: true, budgetUsd: budget,
  caps: { agents: Math.max(1, variant.coders), awake: Math.max(1, variant.coders) },
  reviewers: variant.reviewers, reviewStyle: variant.reviewStyle, policy: variant.policy, trainMax: variant.trainMax,
  claims: !!variant.claims, dedupe: !!variant.dedupe, llmReplay: variant.policy === 'intent',
  coderModel: variant.coderModel, reviewerModel: variant.reviewerModel, ...(variant.planner !== 'none' ? { plannerModel: variant.planner } : {}),
};
// Right after a deploy an old Worker version can answer and drop flags it does not know (smoke run
// 2026-10-08: landing/unlisted never set). Set them until the project reads them back.
for (let i = 0; ; i++) {
  await api('POST', `/api/p/eyal/${name}/landing/flags`, flags);
  const back = await api('GET', `/api/p/eyal/${name}`);
  const lf = (await api('GET', `/api/p/eyal/${name}/landing`)).flags || {};
  if (back.landing && back.unlisted && lf.llmReplay === flags.llmReplay) break;
  if (i >= 5) throw new Error('flags did not stick: ' + JSON.stringify({ landing: back.landing, unlisted: back.unlisted }));
  await sleep(10_000);
}

// ---- the request ----------------------------------------------------------------------------
const check = scenario.check || 'npm test';
const policyText = {
  intent: 'Merging is automatic: approved changes go to the merge queue, which replays collisions on the latest code.',
  ffa: 'Each agent lands its own change as soon as it is approved; if main moved, the agent rebases (forq sync-main).',
  github: 'Every change is one pull request: when it conflicts with main it comes back to its agent to rebase (forq sync-main).',
  phases: 'Work in PHASES: first start only the tasks that change shared files (routes, data, styles, config); start the rest only after those have landed (forq list shows them merged).',
  stacking: 'When a task builds on another task that has not landed yet, start it stacked on that agent: forq spawn "<task>" --on <agent-id>.',
  leads: 'Group the tasks by area; for each area start one agent as the area LEAD whose task is to do its area\'s shared-file changes first, and tell the others in that area to build on its work (--on the lead).',
}[variant.policy] || '';
const routerText = [
  prompt, '',
  `How to work: split this into at most ${variant.coders} tasks and start one agent per task (never more than ${variant.coders} at once).`,
  'Begin every task text with a short title line (under 60 characters) saying what it does; details after it.',
  variant.claims ? 'Start every agent with --files listing the files it will change (forq spawn "<task>" --files a,b).' : '',
  variant.dedupe ? 'Before starting agents, check that no two tasks do the same thing; merge duplicates into one task.' : '',
  policyText, `The project's checks: ${check}. Do not merge anything yourself.`,
].filter(Boolean).join('\n');
const askAt = Date.now();
if (variant.planner === 'none') {
  // opus-alone: one strong agent gets the whole job, no planner, no reviewer.
  await api('POST', `/api/p/eyal/${name}/agents`, { task: `${prompt}\n\nYou are the only agent on this project: do the whole job yourself, in small commits, keep the project's checks green (${check}), push, then run: forq status pushed "<what you did>".` });
} else {
  await api('POST', `/api/p/eyal/${name}/router`, { text: routerText });
}
log('asked', { project: slug, askAt, chars: routerText.length });

// ---- watch until it settles -------------------------------------------------------------------
const ACTIVE = ['working', 'pushed', 'reviewing', 'queued', 'testing', 'replaying'];
let status = 'done', lastChangeAt = Date.now(), lastSig = '', view = null;
const deadline = askAt + timeoutMin * 60_000;
for (;;) {
  await sleep(20_000);
  view = await api('GET', `/api/p/eyal/${name}/landing`).catch((e) => { log('poll_failed', { err: String(e) }); return view; });
  const p = await api('GET', `/api/p/eyal/${name}`).catch(() => null);
  if (!view) continue;
  const sig = JSON.stringify(view.changes.map((c) => [c.id, c.state, c.events.length]));
  if (sig !== lastSig) { lastSig = sig; lastChangeAt = Date.now(); }
  const active = view.changes.filter((c) => ACTIVE.includes(c.state)).length;
  const agentsWorking = (p?.agents || []).filter((a) => a.state === 'working').length;
  log('poll', { project: slug, changes: view.changes.length, active, agentsWorking, landed: view.stats?.landedToday, spent: view.budget?.spent });
  if (view.budget?.halted) { status = 'stopped-budget'; break; }
  if (Date.now() > deadline) { status = 'timeout'; break; }
  // Settled: something landed, nothing active, no agent working, and no change for 3 minutes
  // (a router may still start a late agent; a bounced change may still be fixed).
  if (view.changes.length && active === 0 && agentsWorking === 0 && Date.now() - lastChangeAt > 3 * 60_000) break;
}

// ---- stop everything, collect ------------------------------------------------------------------
const p = await api('GET', `/api/p/eyal/${name}`);
const boxes = [...p.agents.map((a) => a.id), `${slug}--router`, ...['', '2', '3', '4', '5', '6'].map((n) => `${slug}--review${n}`)];
await Promise.all(boxes.map((id) => api('POST', `/api/agents/${id}/stop`).catch(() => null)));
await api('POST', `/api/p/eyal/${name}/landing/flags`, { caps: null, reviewers: 1, autoMerge: false }).catch(() => null);
log('stopped', { project: slug, status, boxes: boxes.length });
await sleep(75_000);   // boxes write their final costs to the ledger as they stop
view = await api('GET', `/api/p/eyal/${name}/landing`);
const state = await api('GET', `/api/p/eyal/${name}/landing/state`);

// Cost: real = container time; tokens at the official rates (platform.claude.com/docs/en/about-claude/pricing,
// checked 2026-10-08): per MTok input, output, cache read, 1-hour cache write. Only Haiku 5.5 has a
// long-prompt tier (x5 above 100k tokens); Sonnet 5.5 and Opus 5.5 cost the same at any length.
// The ledger keeps tokens per project, not per role: byRole is null in v1 until it does.
const RATES = { haiku: [0.10, 0.50, 0.01, 0.20], sonnet: [2, 10, 0.10, 4], opus: [4, 20, 0.20, 8] };
const tokens = { in: 0, out: 0, cacheR: 0, cacheW: 0 }; let usdReal = 0;
for (const r of state.costs || []) {
  if (r.kind === 'boxes') usdReal += r.usd || 0;
  if (r.kind === 'claude' && r.tokens) { tokens.in += r.tokens.in || 0; tokens.out += r.tokens.out || 0; tokens.cacheR += r.tokens.cr || 0; tokens.cacheW += (r.tokens.cw || 0) + (r.tokens.cw1h || 0); }
}
// Per role and model, from the boxes' own cost lines in Workers Observability (box.ts logs tokens
// per model since e3d6be1) plus the merger's model replays (Landing 'replay_llm'). Each model is
// priced at its own rates. Without those lines (boxes on older code) every token is priced at the
// run's priciest model: an upper bound, said in notes.
const priceOf = (model, t) => {
  const k = /opus/.test(model) ? 'opus' : /sonnet/.test(model) ? 'sonnet' : 'haiku';
  const [ri, ro, rc, rw] = RATES[k];
  const std = ((t.in || 0) * ri + (t.out || 0) * ro + (t.cr || t.cacheR || 0) * rc + (t.cw1h || 0) * rw + (t.cw || 0) * ri * 1.25) / 1e6;
  return { k, std, high: k === 'haiku' ? std * 5 : std };
};
async function telemetry(needle, fromMs, event) {
  const acc = '887d7234a6b8d65ad355a4f6684cab67';
  const tok = readFileSync(join(homedir(), '.config/forq-cf/api-token'), 'utf8').trim();
  const out = [];
  for (let offset = 0; offset < 4000; offset += 500) {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc}/workers/observability/telemetry/query`, { method: 'POST', signal: AbortSignal.timeout(60_000),
      headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      // A field filter on the log's event name: lines are stored parsed, so a quoted-text needle never matches.
      body: JSON.stringify({ queryId: 'adhoc', timeframe: { from: fromMs, to: Date.now() }, view: 'events', limit: 500, offset, parameters: { needle: { value: needle, isRegex: false }, ...(event ? { filters: [{ key: 'event', operation: 'eq', type: 'string', value: event }] } : {}) } }) }).then((x) => x.json()).catch(() => null);
    const ev = r?.result?.events?.events || [];
    out.push(...ev.map((e) => e.source).filter((x) => x && typeof x === 'object'));
    if (ev.length < 500) break;
  }
  return out;
}
const roleOf = (id) => (id.endsWith('--router') ? 'planner' : /--review\d*$/.test(id) ? 'reviewers' : 'coders');
const byRole = { planner: null, coders: null, reviewers: null, merge: null, judge: null };
let apiUsdStd = 0, apiUsdHigh = 0, pricedAs = 'per-model';
// Observability takes minutes to make new lines searchable (12b found none 75 s after the stop):
// ask until the count holds for two reads, at most ~6 min.
let boxLines = [];
for (let i = 0, last = -1; i < 12; i++) {
  // Only cost lines (event filter): the project needle alone matched 500+ other lines first.
  boxLines = (await telemetry(`${slug}--`, askAt - 10 * 60_000, 'costs')).filter((x) => x.module === 'box' && x.event === 'costs' && String(x.agentId || '').startsWith(`${slug}--`) && x.tokens);
  if (boxLines.length && boxLines.length === last) break;
  last = boxLines.length; await sleep(30_000);
}
const replayLines = (await telemetry(slug, askAt - 10 * 60_000, 'replay_llm')).filter((x) => x.module === 'landing' && x.event === 'replay_llm' && x.slug === slug);
const addRole = (role, model, t) => {
  const p = priceOf(model, t);
  const r = byRole[role] || (byRole[role] = { apiUsdStd: 0, apiUsdHigh: 0, models: {}, tokens: { in: 0, out: 0, cacheR: 0, cacheW: 0 } });
  r.apiUsdStd += p.std; r.apiUsdHigh += p.high; r.models[p.k] = true;
  r.tokens.in += t.in || 0; r.tokens.out += t.out || 0; r.tokens.cacheR += t.cr || t.cacheRead || 0; r.tokens.cacheW += (t.cw || 0) + (t.cw1h || 0) + (t.cacheWrite || 0);
  apiUsdStd += p.std; apiUsdHigh += p.high;
};
for (const x of boxLines) for (const [model, t] of Object.entries(x.tokens)) addRole(roleOf(x.agentId), model, t);
for (const x of replayLines) addRole('merge', x.model || 'haiku', { in: x.in, out: x.out, cr: x.cacheRead, cw: x.cacheWrite });
if (!boxLines.length) {
  // Upper bound: all tokens at the run's priciest model.
  pricedAs = ['opus', 'sonnet', 'haiku'].find((m) => [variant.planner, variant.coderModel, variant.reviewers ? variant.reviewerModel : null].includes(m)) || 'haiku';
  const p = priceOf(pricedAs, { in: tokens.in, out: tokens.out, cr: tokens.cacheR, cw1h: tokens.cacheW });
  apiUsdStd = p.std; apiUsdHigh = p.high;
  for (const k of Object.keys(byRole)) byRole[k] = null;
}
for (const r of Object.values(byRole)) if (r) { r.apiUsdStd = Math.round(r.apiUsdStd * 1000) / 1000; r.apiUsdHigh = Math.round(r.apiUsdHigh * 1000) / 1000; r.models = Object.keys(r.models); }
log('cost_split', { project: slug, boxLines: boxLines.length, replayLines: replayLines.length, pricedAs, apiUsdStd, byRole: Object.fromEntries(Object.entries(byRole).map(([k, v]) => [k, v?.apiUsdStd ?? null])) });

// Tasks and counts from the Landing records.
const ev = (c, w) => c.events.filter((e) => e.what === w);
const tasks = view.changes.map((c) => ({ id: c.id, needs: c.needs || [], role: 'coder', model: variant.coderModel, startAt: c.createdAt,
  pushAt: ev(c, 'pushed')[0]?.t ?? null, landAt: c.landedAt, tries: ev(c, 'pushed').length || 0, files: (c.files || []).length,
  how: c.state === 'landed' ? ({ merged: 'merged', 'replayed-handler': 'handler', 'replayed-llm': 'llm', lead: 'lead' }[c.landing?.how] || 'merged') : 'bounced' }));
const landed = view.changes.filter((c) => c.state === 'landed');
const lands = landed.map((c) => c.landedAt).sort((a, b) => a - b);
const counts = { tasksPlanned: view.changes.length, tasksLanded: landed.length, dupIntents: 0,
  conflicts: view.changes.filter((c) => ev(c, 'conflict').length).length,
  replaysHandler: landed.filter((c) => c.landing?.how === 'replayed-handler').length, replaysLlm: landed.filter((c) => c.landing?.how === 'replayed-llm').length,
  leads: landed.filter((c) => c.landing?.how === 'lead').length, bounces: view.changes.reduce((n, c) => n + ev(c, 'bounced').length, 0),
  // Real verdicts only: a variant without reviewers approves automatically ('auto').
  reviews: variant.reviewers ? view.changes.reduce((n, c) => n + ev(c, 'approved').length + ev(c, 'changes-suggested').length, 0) : 0,
  reviewRejects: view.changes.reduce((n, c) => n + ev(c, 'changes-suggested').length, 0), breaksOnMain: 0, humanInterventions: 0 };

// ---- quality: qb5's scorer on a clone of the final main, on the laptop ----------------------
let quality = null;
try {
  const t = await api('POST', `/api/p/eyal/${name}/main-token`);
  const clone = join(work, 'final');
  g(work, '-c', `http.extraHeader=Authorization: Basic ${Buffer.from(`x:${t.token.split('?')[0]}`).toString('base64')}`, 'clone', '-q', t.remote, clone);
  const scorer = join(ROOT, 'scripts/lab/score.mjs');
  if (existsSync(scorer)) {
    const r = spawnSync('node', ['--experimental-strip-types', '--no-warnings', scorer, '--scenario', scenarioId, '--repo', clone, ...(has('--no-judge') ? [] : ['--judge'])], { encoding: 'utf8', timeout: 15 * 60_000 });
    const line = (r.stdout || '').trim().split('\n').filter(Boolean).pop();
    quality = line ? JSON.parse(line) : null;
    if (r.status === 2 || !quality) log('scorer_failed', { status: r.status, err: (r.stderr || '').slice(-400) });
  } else log('no_scorer', { scorer });
} catch (e) { log('quality_failed', { err: String(e) }); }

const out = {
  v: 1, id: name, ts: Date.now(), stage, scenario: scenarioId, scenarioCommit, promptVersion: scenario.promptVersion || null,
  scenarioVersion: scenario.scenarioVersion || scenario.version || null, seed, baseline, variantKey: key, variant: { ...variant },
  predicted, status,
  timings: { askAt, planAt: view.changes.length ? Math.min(...view.changes.map((c) => c.createdAt)) : null, firstLandAt: lands[0] ?? null, lastLandAt: lands[lands.length - 1] ?? null,
    wallS: lands.length ? Math.round((lands[lands.length - 1] - askAt) / 1000) : null, medianAskToLandS: view.stats?.medianAskToLandS ?? null },
  counts, tasks,
  cost: { usdReal: Math.round(usdReal * 1000) / 1000, apiUsdStd: Math.round(apiUsdStd * 1000) / 1000, apiUsdHigh: Math.round(apiUsdHigh * 1000) / 1000, pricedAs, tokens,
    // judge = qb5's scorer: counted to the lab, not the variant (not in apiUsdStd).
    byRole: { ...byRole, judge: quality?.judgeUsd != null ? { apiUsdStd: quality.judgeUsd } : null } },
  quality,
  links: { replay: `https://qodebase.app/p/eyal/${name}/work?replay=4`, app: `https://${name}--eyal.ttyview.dev/`, repo: `https://qodebase.app/p/eyal/${name}` },
  notes: [scenarioId === 'port-ts' ? 'fetched validator.js during the run: unknown (box command logs not collected yet)' : '',
    pricedAs !== 'per-model' ? `API-equivalent priced as ${pricedAs} for every token (upper bound: this run's boxes ran before per-model cost lines)` : '', opt('--notes', '')].filter(Boolean).join('; '),
};
appendFileSync(RUNS, JSON.stringify(out) + '\n');
log('done', { project: slug, status, landed: counts.tasksLanded, wallS: out.timings.wallS, usdReal: out.cost.usdReal, apiUsdStd: out.cost.apiUsdStd, score: quality?.score ?? null });
rmSync(work, { recursive: true, force: true });
