#!/usr/bin/env node
// P1 results generator (docs/board/TASKS.md 'Parallel tracks'). One script, run after every run:
//   node scripts/results/build.mjs [--offline]
// Reads the sources below and writes
//   docs/board/RESULTS.md   the current tables (fleet per run + per model, real builds, board ablation, W8, lanes, lab)
//   public/results.json     the headline numbers /how and the README read (same numbers, machine-readable)
// Every table carries n and a label saying what kind of evidence it is:
//   measured            real agents on real code (Claude on Eyal's plan, or Workers AI / Gemini for the fleet)
//   real git, scripted  real git and tests, scripted agents (no model)
//   simulated           the fast sim (public/sim/engine.js), no git
// Network sources (fleet /runs, /api/admin/build-estimates) are cached in scripts/results/cache/; with --offline, or
// when a fetch fails, the cache is used and the output says so. Same inputs -> same output (no timestamps in the
// tables; 'generated' is in results.json only).
import fs from 'node:fs';
import path from 'node:path';
import { teamVsOneAgent } from '../../public/lab/predict.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const CACHE = path.join(ROOT, 'scripts/results/cache');
const OFFLINE = process.argv.includes('--offline');
const HOME = process.env.HOME;
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const jsonl = (p) => rd(p).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const secret = (p) => { try { return fs.readFileSync(path.join(HOME, p), 'utf8').trim(); } catch { return null; } };
const med = (a) => { const b = a.filter((x) => x != null && !Number.isNaN(x)).sort((x, y) => x - y); if (!b.length) return null; const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const r1 = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
const fmt = (x, d = 0) => (x == null ? '-' : Number(x).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }));
const usd = (x, d = 2) => (x == null ? '-' : '$' + fmt(x, d));
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const notes = [];

async function cached(name, fetcher) {
  const file = path.join(CACHE, name);
  if (!OFFLINE) {
    try { const v = await fetcher(); if (v != null) { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(file, JSON.stringify(v, null, 1) + '\n'); return { v, from: 'live' }; } }
    catch (e) { notes.push(`${name}: live fetch failed (${String(e.message || e).slice(0, 80)}), used the cache`); }
  }
  try { return { v: JSON.parse(fs.readFileSync(file, 'utf8')), from: 'cache' }; } catch { return { v: null, from: 'none' }; }
}
async function getJson(url, headers) { const r = await fetch(url, { headers }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); }

// What a run was for, from qb6 (2026-10-13), until /runs carries its own label.
const RUN_NOTES = { fmv6kuwtl: 'plumbing', fmv6kzol3: 'plumbing', fmv6l8doa: 'plumbing', fmv6lhnk2: 'F2 @ 10 agents',
  fmv6lmffn: 'F2 @ 100 (start bug: only 8 agents started)', fmv6m4smw: 'F2 @ 100 agents', fmv6md3we: 'F3 @ 200 agents' };
// ---- Fleet (qbfleet Worker GET /runs, key-gated; qb9's sim/fleet/quality.json; F0 bench) ----
async function fleet() {
  const key = secret('.config/qbfleet/key');
  const runs = await cached('fleet-runs.json', () => (key ? getJson('https://qbfleet.forqdev.workers.dev/runs', { 'x-fleet-key': key }) : null));
  const list = Array.isArray(runs.v) ? runs.v : runs.v?.runs || [];
  let quality = null; try { quality = JSON.parse(rd('sim/fleet/quality.json')); } catch {}
  let f0 = null; try { f0 = JSON.parse(rd('sim/fleet/f0-summary-all.json')); } catch { try { f0 = JSON.parse(rd('sim/fleet/f0-summary.json')); } catch {} }
  const rows = list.map((r) => ({
    // /runs gives models as { model: { usd, landed, skipped, rejected, ... } }.
    runId: r.runId, models: Array.isArray(r.models) ? r.models : r.models ? Object.keys(r.models) : r.model ? [r.model] : [],
    state: r.state ?? null, tokensIn: r.tokensIn ?? null, tokensOut: r.tokensOut ?? null, agents: r.agents ?? null, agentsStarted: r.agentsStarted ?? null, files: r.files ?? null,
    landed: r.landed ?? r.counts?.landed ?? null, skipped: r.skipped ?? r.counts?.skipped ?? null, verifyFail: r.verify_fail ?? r.counts?.verify_fail ?? null,
    rejected: r.rejected ?? r.counts?.rejected ?? null, rateLimited: r.rate_limited ?? r.counts?.rate_limited ?? null, modelError: r.model_error ?? r.counts?.model_error ?? null,
    calls: r.calls ?? null, usd: r.usd ?? null, startedAt: r.startedAt ?? null, endedAt: r.endedAt ?? null, wallS: r.wallS ?? r.wall ?? (r.endedAt && r.startedAt ? Math.round((r.endedAt - r.startedAt) / 1000) : null),
    landWaitP50S: r.landWaitS?.p50 ?? r.landWaitP50S ?? null, landWaitP90S: r.landWaitS?.p90 ?? r.landWaitP90S ?? null,
    peakPerMin: r.peakPerMin ?? null, perModel: r.perModel || (r.models && !Array.isArray(r.models) ? r.models : null),
    repo: r.repo === 'fleet-main' || !r.repo ? `microsoft/vscode ${r.root || 'src/vs'}` : `${r.repo} ${r.root || ''}`.trim(), label: r.label || RUN_NOTES[r.runId] || null,
  }));
  // Cached-answer runs (S3/S4: comments reused by content hash, no model call) test our side only: kept out of the
  // model totals and summed on their own.
  for (const r of rows) r.cached = r.models.length > 0 && r.models.every((m) => m === 'cache');
  // What the run wrote: 'docs' (comments only, code unchanged by verify), 'code' (the kata code dial: functions on
  // their own repos) or 'index' (the index job). Totals are kept per job so the docs-only number has its own source.
  for (const r of rows) r.job = /^fleet-kata/.test(r.repo) ? 'code' : /^index job/.test(r.label || '') ? 'index' : 'docs';
  const cachedRows = rows.filter((r) => r.cached);
  const csum = (k) => cachedRows.reduce((a, r) => a + (r[k] || 0), 0);
  const cachedTotals = { runs: cachedRows.length, files: csum('files'), landed: csum('landed'), skipped: csum('skipped'), verifyRefused: csum('verifyFail'),
    label: 'measured on Cloudflare with cached answers (comments reused by content hash, no model call): agents, verify, lanes, door and pushes real' };
  const modelRows = rows.filter((r) => !r.cached);
  // Per model across runs (the per-run perModel counts when the API gives them).
  const pm = {};
  for (const r of modelRows) for (const [m, c] of Object.entries(r.perModel || {})) {
    const t = (pm[m] ||= { files: 0, landed: 0, skipped: 0, verifyFail: 0, rejected: 0, rateLimited: 0, calls: 0, usd: 0, peakPerMin: 0 });
    for (const k of ['landed', 'skipped', 'verifyFail', 'rejected', 'rateLimited', 'calls', 'usd']) t[k] += c[k] ?? c[{ verifyFail: 'verify_fail', rateLimited: 'rateLimited429' }[k]] ?? 0;
    // role: 'planned' (the run's own model) or 'overflow' (took work when the planned models were full)
    if (c.role) { t.roles ||= {}; t.roles[c.role] = (t.roles[c.role] || 0) + (c.landed || 0) + (c.skipped || 0); }
    // Files a model handled = every final outcome (an answer with nothing to add is 'skipped').
    t.files += c.files ?? ((c.landed || 0) + (c.skipped || 0) + (c.rejected || 0) + (c.verify_fail || c.verifyFail || 0) + (c.model_error || 0));
    t.peakPerMin = Math.max(t.peakPerMin, c.peakPerMin || 0);
  }
  // $ per 1k files handled (a skipped file still costs its read); 429 share only when the API gives calls.
  for (const t of Object.values(pm)) { t.usdPer1kFiles = t.files ? r1((t.usd / t.files) * 1000, 2) : null; t.share429 = t.calls ? r1(t.rateLimited / t.calls, 3) : null; t.usd = r1(t.usd, 4); if (!t.calls) { t.calls = null; t.peakPerMin = t.peakPerMin || null; } }
  const sum = (k) => modelRows.reduce((a, r) => a + (r[k] || 0), 0);
  const totals = { runs: modelRows.length, filesAttempted: sum('files'), landed: sum('landed'), skipped: sum('skipped'), verifyRefused: sum('verifyFail'), rejected: sum('rejected'), rateLimited: sum('rateLimited'), usd: r1(sum('usd'), 2) };
  totals.usdPer1kLanded = totals.landed ? r1((totals.usd / totals.landed) * 1000, 2) : null;
  totals.usdPer1kFiles = totals.filesAttempted ? r1((totals.usd / totals.filesAttempted) * 1000, 2) : null;
  totals.byJob = {};
  for (const r of modelRows) { const j = (totals.byJob[r.job] ||= { runs: 0, filesAttempted: 0, landed: 0, skipped: 0, usd: 0 }); j.runs++; j.filesAttempted += r.files || 0; j.landed += r.landed || 0; j.skipped += r.skipped || 0; j.usd += r.usd || 0; }
  for (const j of Object.values(totals.byJob)) j.usd = r1(j.usd, 2);
  // The biggest run so far, for the headline.
  const big = [...modelRows].sort((a, b) => (b.files || 0) - (a.files || 0))[0] || null;
  totals.largestRun = big && { runId: big.runId, agents: big.agents, files: big.files, landed: big.landed, skipped: big.skipped, wallS: big.wallS, filesPerMin: big.wallS ? r1(((big.landed || 0) + (big.skipped || 0)) / (big.wallS / 60), 0) : null, landWaitP90S: big.landWaitP90S, usd: big.usd, models: big.models };
  // One row per step: a step's copies share its label up to ' - copy N'.
  const groups = new Map();
  for (const r of rows) { const k = (r.label || r.runId).replace(/ - copy \d+$/, ''); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const steps = [...groups.entries()].map(([label, rs]) => {
    const g = (k) => rs.reduce((a, r) => a + (r[k] || 0), 0);
    const st = Math.min(...rs.map((r) => r.startedAt || Infinity)), en = Math.max(...rs.map((r) => r.endedAt || 0));
    return { label, runs: rs.length, cached: rs.every((r) => r.cached), models: [...new Set(rs.flatMap((r) => r.models))], repos: [...new Set(rs.map((r) => r.repo))],
      agents: g('agents') || null, files: g('files'), landed: g('landed'), skipped: g('skipped'), verifyFail: g('verifyFail'), rejected: g('rejected'), rateLimited: g('rateLimited'), usd: r1(g('usd'), 4),
      wallS: Number.isFinite(st) && en ? Math.round((en - st) / 1000) : rs.length === 1 ? rs[0].wallS : null, landWaitP90S: Math.max(...rs.map((r) => r.landWaitP90S || 0)) || null, firstAt: Number.isFinite(st) ? st : null };
  }).sort((a, b) => (a.firstAt || 0) - (b.firstAt || 0));
  return { steps, label: 'measured (Workers AI and Gemini agents, real git on Artifacts, Cloudflare)', source: runs.from, runs: rows, perModel: pm, totals, cached: cachedTotals, quality, f0: f0?.models || null };
}

// ---- Real builds (R2-R8b): /api/admin/build-estimates (forq admin) ----
const REAL_SOLO = { 'home-inventory': 'eyal/real-home-inventory-solo', 'cafe-site': 'eyal/real-cafe-site-solo' };
const BUILD_NAMES = { 'eyal.real-tip-splitter': ['R2', 'small, one Opus agent'], 'eyal.real-home-inventory': ['R3', 'Large, Balanced team'], 'eyal.real-cafe-site': ['R4', 'Huge, up to 20 Haiku'],
  'eyal.real-course-builder': ['R5', 'Huge, up to 40 Haiku'], 'eyal.real-home-inventory-solo': ['R6', "R3's prompt, one Opus agent"], 'eyal.real-cafe-site-solo': ['R7', "R4's prompt, one Opus agent"],
  'eyal.real-budget-tracker-10': ['R8', 'proof build (X1/X4), Balanced'], 'eyal.real-home-inventory-r8b': ['R8b', "R3's prompt again, Balanced (~10 min queue bug)"] };
async function realBuilds() {
  const sec = secret('.config/forq/admin-secret');
  const be = await cached('build-estimates.json', () => (sec ? getJson('https://forq.forqdev.workers.dev/api/admin/build-estimates', { 'x-forq-secret': sec }) : null));
  const rows = (be.v?.builds || []).filter((b) => BUILD_NAMES[b.slug] && b.progress?.actualWallS != null).map((b) => {
    const [id, what] = BUILD_NAMES[b.slug], e = b.estimate, p = b.progress, v = e.v || {};
    return { id, slug: b.slug.replace('.', '/'), what, setup: v.coders > 1 ? `planner + ${v.coders} ${v.coderModel}, ${v.reviewers} reviewers${v.board ? ', board' : ''}` : 'one Opus agent',
      wallS: p.actualWallS, usd: p.actualUsd, shownWallS: e.wallS, shownUsd: e.apiUsd,
      inside: { wall: p.actualWallS >= e.wallS[0] && p.actualWallS <= e.wallS[1], usd: p.actualUsd >= e.apiUsd[0] && p.actualUsd <= e.apiUsd[1] } };
  }).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  return { label: 'measured (real Claude agents on Eyal\'s plan, real builds on Cloudflare; one run each)', source: be.from, rows,
    usdBasis: 'model use at normal API rates per model (Haiku calls over 100k-token prompts at 5x): every Claude session in the project\'s boxes (router/planner, coders, reviewers) and merge-queue model replays recorded under the project; container time not included. R5: ~$0.21 of merge-queue replays were recorded under a mistyped project key and are not in its figure.' };
}

// ---- Board ablation (E7) and growing the team (W8): sim/board-ab/runs.jsonl ----
function boardAb() {
  const rows = jsonl('sim/board-ab/runs.jsonl');
  const dups = (r) => (Array.isArray(r.dup_pairs) ? r.dup_pairs.filter((p) => p.both_separate).length : r.dup_pairs ?? null);
  const agg = (rs) => ({ n: rs.length, wallS: med(rs.map((r) => r.wall_s)), agentMin: r1(med(rs.map((r) => r.agent_minutes)), 0), usd: r1(med(rs.map((r) => r.usd_api_equiv)), 2), dupPairs: med(rs.map(dups)), hidden: rs.map((r) => r.hidden_pass), runs: rs.map((r) => r.run) });
  const ARMS = [['A', 'A: no coordination'], ['A+', 'A+: upfront dedupe + stagger, no board'], ['A-split', 'split: agent k takes every 20th task'], ['E', 'E: board + upfront dedupe']];
  const ablation = ARMS.map(([arm, name]) => ({ arm, name, ...agg(rows.filter((r) => r.scenario === 's3' && r.tasks_n === 60 && r.arm === arm)) }));
  const s6 = rows.filter((r) => r.scenario === 's6' && r.tasks_n === 150 && r.agents === 40 && r.meter_stopped === false);
  const fixed = (cond) => s6.filter((r) => r.cond === cond && !r.probe);
  const ctl = (cond) => s6.filter((r) => r.cond === cond && r.probe);
  const w8 = [['40 agents, no board', fixed('A')], ['40 agents, board', fixed('E')], ['controller, no board', ctl('A')], ['controller + board', ctl('E')],
    ['fixed 8, no board (control)', rows.filter((r) => r.scenario === 's6' && r.tasks_n === 150 && r.agents === 8 && r.cond === 'A')]].map(([name, rs]) => ({ name, ...agg(rs) }));
  return { label: 'measured (real Haiku agents on Eyal\'s plan, real git, local; medians)', ablation: { scenario: 's3: 20 agents, 60 tasks, 10 twin pairs', arms: ablation }, w8: { scenario: 's6: 150 tasks, 40-agent pool', arms: w8 } };
}

// ---- Lanes: L1 fast sim (sim/lanes/summary.json), L2 real git (sim/real/out/lanes.jsonl), L3 Cloudflare (sim/cloud/results) ----
function lanes() {
  const l1 = JSON.parse(rd('sim/lanes/summary.json'));
  // The main grid only (one coordinated lane, controller holds, no claims/small/risky variants); zipf = how skewed the
  // areas are (1 = a hot area, 0.5 = flatter).
  const l1rows = l1.filter((s) => s.setup.coord === 'one' && !s.setup.pick && !s.setup.small && !s.setup.claims && !s.setup.risky)
    .map((s) => ({ lanes: s.setup.lanes, cross: s.setup.cross, controller: s.setup.ctl, zipf: s.setup.zipf, maxPerH: s.maxPerH, saturatesAt: s.saturatesAt }))
    .sort((a, b) => a.cross - b.cross || b.zipf - a.zipf || a.lanes - b.lanes || a.controller - b.controller);
  const l2 = jsonl('sim/real/out/lanes.jsonl').filter((r) => r.event === 'lanes_run' && (r.hours >= 6 || r.agents >= 10000)).map((r) => {
    const s = r.stats;
    return { name: r.name.replace('lanes-intents-', ''), agents: r.agents, hours: r.hours, seed: r.seed, lanes: s.lanes, controller: s.controller, rdeps: s.rdeps, splitHot: s.splitHot,
      perHLastHour: s.landedLastHour, waitP50Min: r1(s.p50S / 60, 0), usdPerChange: r1(s.cost / s.landed, 2), redShare: s.redShare, awake: s.avgWorking };
  }).sort((a, b) => a.agents - b.agents || a.hours - b.hours || a.lanes - b.lanes || a.name.localeCompare(b.name));
  const dir = path.join(ROOT, 'sim/cloud/results');
  const l3 = fs.readdirSync(dir).filter((f) => /^L3-.*\.json$/.test(f)).sort().map((f) => {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), s = d.status || {}, v = d.verify || {};
    return { cell: d.cell || f.replace(/\.json$/, ''), agents: s.agents ?? d.cfg?.agents, lanes: s.lanes ?? d.cfg?.lanes, door: s.door ?? d.cfg?.door, cross: s.crossShare ?? d.cfg?.crossShare,
      minutes: s.minutes ?? d.cfg?.minutes, tasks: s.tasks, landed: s.landed, mainWhole: v.fsck === 'ok' && (v.testFails ?? 0) === 0, dupIds: v.dupIds ?? null };
  });
  return {
    L1: { label: 'simulated (fast sim, 16 h runs, last 8 h measured)', rows: l1rows },
    L2: { label: 'real git, scripted agents (real tests, one run per cell unless seeds say otherwise)', rows: l2 },
    L3: { label: 'Cloudflare, scripted agents (Durable Objects + Artifacts, 10 min)', rows: l3 },
  };
}

// ---- Variants lab: public/lab/runs.jsonl ----
function lab() {
  const rows = jsonl('public/lab/runs.jsonl').filter((r) => r.status === 'done');
  const g = new Map();
  for (const r of rows) { const k = `${r.stage}|${r.scenario}|${r.baseline || r.variantKey}`; if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
  const short = (r) => r.baseline || (() => { const v = r.variant || {}; return `${v.planner} planner + ${v.coders} ${v.coderModel}, ${v.reviewers} rev, ${v.policy}${v.board ? ', board' : ''}`; })();
  const out = [...g.values()].map((rs) => ({ stage: rs[0].stage, scenario: rs[0].scenario, setup: short(rs[0]), n: rs.length,
    wallS: med(rs.map((r) => r.timings?.wallS)), usd: r1(med(rs.map((r) => r.cost?.apiUsdStd)), 2), quality: r1(med(rs.map((r) => r.quality?.score)), 1),
    hidden: `${med(rs.map((r) => r.quality?.hiddenPass))}/${rs[0].quality?.hiddenTotal ?? '?'}` }))
    .sort((a, b) => a.stage - b.stage || a.scenario.localeCompare(b.scenario) || a.setup.localeCompare(b.setup));
  return { label: 'measured (real Claude agents on qodebase, lab stages; finished runs only; medians)', rows: out };
}

// ---- Write ----
const [F, RB] = await Promise.all([fleet(), realBuilds()]);
const AB = boardAb(), L = lanes(), LAB = lab();
const ab = (n) => AB.ablation.arms.find((a) => a.arm === n), w8 = (n) => AB.w8.arms.find((a) => a.name === n);
const l2 = (name) => L.L2.rows.find((r) => r.name === name);
const headline = {
  fleetQuality: F.quality?.status === 'done' ? { filesChanged: F.quality.files_changed, codeChanged: F.quality.code_changed, handComments: F.quality.hand?.comments, handOk: F.quality.hand?.ok, handFiles: F.quality.hand?.files,
    judge: (F.quality.judge || []).map((j) => ({ model: j.model, n: j.n, accurate: j.accurate, helpful: j.helpful, invented: j.invented })), judgeVsHand: F.quality.judge_vs_hand, label: 'measured (qb9: re-verify of every changed file, automatic checks, gpt-oss-120b judge, 50-file hand check)' } : null,
  // headline.scale (qb3's deck): the S4 ladder's peak windows from sim/fleet/scale-ladder.json.
  scale: (() => { try { const d = JSON.parse(rd('sim/fleet/scale-ladder.json')); const L = d.cached.ladder;
    const one = L.filter((r) => r.namespaces === 1 && !r.readCache);   // the read-cache runs (R10K) are reported apart
    return { maxAgents: Math.max(...L.map((r) => r.agents)), filesPerSecPlateau: Math.max(...one.map((r) => r.filesPerSec)), twoNamespacesFilesPerSec: L.find((r) => r.namespaces === 2)?.filesPerSec ?? null,
      ladder: L.map(({ run, agents, copies, namespaces, filesPerSec, readP50Ms, limit }) => ({ run, agents, copies, namespaces, filesPerSec, readP50Ms, limit })),
      readCache: L.filter((r) => r.readCache).map(({ run, agents, copies, readCache, filesPerSec, readP50Ms, readP90Ms, answersDoneS, landed, readsFromArtifacts, errors, landedPerSecPeak, limit, source }) => ({ run, agents, copies, readCache, filesPerSec, readP50Ms, readP90Ms, answersDoneS, landed, readsFromArtifacts, errors, landedPerSecPeak, limit, source })),
      realModels: d.realModels.runs.map(({ run, agents, filesPerSec, callsPerMin, limit, usd }) => ({ run, agents, filesPerSec, callsPerMin, limit, usd })),
      tenK: d.cached.tenK || null, maxBusyAtOnce: Math.max(...L.map((r) => r.busyAtOnceMax || 0)) || null,
      label: d.cached.label, realModelsLabel: d.realModels.label }; } catch { return null; } })(),
  fleetCached: F.cached,
  fleet: { peakFilesPerSec: (() => { try { const d = JSON.parse(rd('sim/fleet/scale-ladder.json')); return Math.max(...d.realModels.runs.map((r) => r.filesPerSec || 0)) || null; } catch { return null; } })(),
    peakNote: 'busiest stretch of the real-model runs (S5 v2b: its peak minute, 6,840 files)', largestRun: F.totals.largestRun, filesLanded: F.totals.landed, filesAttempted: F.totals.filesAttempted, verifyRefused: F.totals.verifyRefused, usd: F.totals.usd, usdPer1kLanded: F.totals.usdPer1kLanded, runs: F.totals.runs, byJob: F.totals.byJob, label: F.label },
  realBuilds: { n: RB.rows.length, insideEstimateTime: RB.rows.filter((r) => r.inside.wall).length, insideEstimateCost: RB.rows.filter((r) => r.inside.usd).length,
    // Costs and walls from the rows (the settled build-estimates figures), so the headline and the table agree.
    teamVsOneAgent: (() => { const c = teamVsOneAgent(); const row = (slug) => RB.rows.find((r) => r.slug === slug);
      return { n: c.n, teamCheaper: c.teamCheaper, usdBasis: RB.usdBasis, comparisons: c.comparisons.map(({ prompt, team, teamUsd, oneUsd, teamS, oneS, teamCheaper }) => {
        const solo = REAL_SOLO[prompt], t = row(team), o = solo && row(solo);
        return { prompt, team, teamUsd: t ? r1(t.usd, 2) : teamUsd, oneUsd: o ? r1(o.usd, 2) : oneUsd, teamS: t?.wallS ?? teamS, oneS: o?.wallS ?? oneS, teamCheaper }; }) }; })(),
    sameLargePrompt: (() => { const t = RB.rows.find((r) => r.id === 'R3'), s = RB.rows.find((r) => r.id === 'R6'); return t && s ? { teamS: t.wallS, oneAgentS: s.wallS, teamUsd: t.usd, oneAgentUsd: s.usd } : null; })(),
    label: RB.label },
  board: { dupPairsNoBoard: ab('A')?.dupPairs, dupPairsBoard: ab('E')?.dupPairs, wallNoBoardS: ab('A')?.wallS, wallBoardS: ab('E')?.wallS, n: ab('E')?.n, label: AB.label },
  controller: { usdFixed40Board: w8('40 agents, board')?.usd, usdControllerBoard: w8('controller + board')?.usd, agentMinFixed40Board: w8('40 agents, board')?.agentMin, agentMinControllerBoard: w8('controller + board')?.agentMin, label: AB.label },
  lanes: { oneQueuePerH: l2('a2000-l1-split-h6-s1')?.perHLastHour, lanes32PerH: l2('a2000-l32-split-rdeps-ctl-h6-s1')?.perHLastHour, label: L.L2.label },
};
const DIALS = (() => { try { return JSON.parse(rd('sim/fleet/collision-dials.json')); } catch { return null; } })();
headline.collisionDials = DIALS ? { commentFinding: DIALS.comment.finding || null, comment: DIALS.comment.levels.map(({ dial, claims, tasks, tasksPerSec, doubled, codeChanged, lost }) => ({ dial, claims: !!claims, tasks, tasksPerSec, doubled, codeChanged, lost })),
  code: DIALS.code.levels, label: DIALS.comment.label } : null;
const results = { v: 1, generated: new Date().toISOString(), sources: { fleet: F.source, buildEstimates: RB.source }, notes, headline, collisionDials: DIALS, fleet: F, realBuilds: RB, boardAblation: AB.ablation, w8: AB.w8, lanes: L, lab: LAB };
fs.writeFileSync(path.join(ROOT, 'public/results.json'), JSON.stringify(results, null, 1) + '\n');

const md = [];
md.push('# Results (generated)', '', 'Generated by `node scripts/results/build.mjs` from the run records; do not edit by hand, re-run it. The machine-readable copy is `public/results.json`. Each table names its kind of evidence: **measured** (real agents on real code), **real git, scripted** (real git and tests, no model), **simulated** (the fast sim).', '');
if (notes.length) md.push('Sources not fresh: ' + notes.join('; ') + '.', '');
md.push('## Fleet: documentation comments on VS Code (F2-F3)', '', `Label: ${F.label}. Source: qbfleet /runs (${F.source}).`, '');
if (F.runs.length) {
  md.push(`${F.runs.length} runs (one per repo copy) grouped into ${F.steps.length} steps; every run is in results.json fleet.runs.`, '');
  md.push(table(['step', 'runs', 'repos', 'models', 'agents', 'files', 'landed', 'nothing to add', 'verify refused', 'rejected', 'rate-limited', '$', 'wall (first start to last end)', 'land wait p90 (worst run)'],
    F.steps.map((r) => [`${r.label}${r.cached ? ' [cached answers]' : ''}`, r.runs, r.repos.length > 3 ? `${r.repos.length} copies` : r.repos.join(', '), r.models.map((m) => m.split('/').pop()).join(', ') || '-', fmt(r.agents), fmt(r.files), fmt(r.landed), fmt(r.skipped), fmt(r.verifyFail), fmt(r.rejected), fmt(r.rateLimited), usd(r.usd, 2), r.wallS != null ? `${fmt(r.wallS)} s` : '-', r.landWaitP90S != null ? `${fmt(r.landWaitP90S)} s` : '-'])), '');
  const S = (() => { try { return JSON.parse(rd('sim/fleet/scale-ladder.json')); } catch { return null; } })();
  if (S) md.push('Scale ladder, peak 10-s windows (sim/fleet/scale-ladder.json, from qb6\'s series; sim.md (l)):', '',
    table(['run', 'agents', 'copies', 'namespaces', 'files/s (peak window)', 'read p50', 'what limited it'], S.cached.ladder.map((r) => [`${r.run}${r.readCache ? ` (read cache: ${r.readCache})` : ''}`, fmt(r.agents), r.copies, r.namespaces ?? '-', fmt(r.filesPerSec), r.readP50Ms ? `${r.readP50Ms} ms` : '-', r.limit])), '',
    ...(S.cached.tenK ? [`10,000 agents: ${S.cached.tenK.say} ${S.cached.tenK.always} ${S.cached.tenK.not} ${S.cached.tenK.notRun}`, ''] : []),
    table(['real-model run', 'agents', 'files/s', 'calls/min', 'what limited it', '$'], S.realModels.runs.map((r) => [r.run, fmt(r.agents), fmt(r.filesPerSec), fmt(r.callsPerMin), r.limit, usd(r.usd)])), '');
  if (Object.keys(F.perModel).length) md.push(table(['model', 'files handled', 'landed', 'verify refused', 'rate-limited (share of calls)', 'peak calls/min', '$', '$ per 1k files'],
    Object.entries(F.perModel).map(([m, t]) => [m, fmt(t.files), fmt(t.landed), fmt(t.verifyFail), `${fmt(t.rateLimited)} (${t.share429 != null ? fmt(t.share429 * 100, 1) + '%' : '-'})`, fmt(t.peakPerMin), usd(t.usd, 2), usd(t.usdPer1kFiles, 2)])), '');
  if (F.cached.runs) md.push(`Cached-answer runs (${F.cached.label}): ${F.cached.runs} runs, ${fmt(F.cached.files)} files, ${fmt(F.cached.landed)} landed, ${fmt(F.cached.verifyRefused)} refused by verify. Not counted in the model totals below.`, '');
  md.push(`Model-written totals: ${fmt(F.totals.landed)} files landed of ${fmt(F.totals.filesAttempted)} attempted over ${F.totals.runs} runs (${fmt(F.totals.skipped)} needed no comment)${F.totals.byJob ? `; by job: ${Object.entries(F.totals.byJob).map(([k, j]) => `${k} ${fmt(j.landed)} landed in ${j.runs} run${j.runs === 1 ? "" : "s"}`).join(', ')}` : ''}; ${fmt(F.totals.verifyRefused)} refused by the code-unchanged check; ${usd(F.totals.usd)} (${usd(F.totals.usdPer1kFiles)} per 1k files).`, '');
} else md.push('No fleet runs readable yet.', '');
if (F.quality) {
  const q = F.quality, pct = (a, n) => (n ? `${a}/${n} (${fmt((a / n) * 100)}%)` : '-');
  if (q.status !== 'done') md.push('Quality (qb9, sim/fleet/quality.json): not measured yet.', '');
  else {
    md.push(`Quality (qb9's F4 check, sim/fleet/quality.json; measured on main ${String(q.head).slice(0, 8)} vs base ${String(q.base).slice(0, 8)}): ${fmt(q.files_changed)} files changed, **code changed on re-verify: ${fmt(q.code_changed)}**; automatic checks over ${fmt(q.auto?.comments)} comments: invented params ${fmt(q.auto?.invented_params)}, missing params ${fmt(q.auto?.missing_params)}, @returns on void ${fmt(q.auto?.returns_on_void)}, trivial ${fmt(q.auto?.trivial)}.`, '');
    md.push(table(['fleet model', 'judge (gpt-oss-120b) accurate', 'judge helpful', 'judge: invented', 'hand-checked ok', 'hand: invented'],
      (q.judge || []).map((j) => { const h = Object.entries(q.hand_by_model || {}).find(([m]) => m.endsWith(j.model) || j.model.endsWith(m))?.[1];
        return [j.model, pct(j.accurate, j.n), pct(j.helpful, j.n), fmt(j.invented), h ? pct(h.ok, h.comments) : '-', h ? fmt(h.invented) : '-']; })), '');
    const h = q.hand || {}, jv = q.judge_vs_hand || {};
    md.push(`Hand check: ${fmt(h.files)} files, ${fmt(h.comments)} comments, ${pct(h.ok, h.comments)} ok (accurate, nothing invented). Judge vs hand on the same ${fmt(jv.paired)} comments: agreed on ${fmt(jv.agree)}; of ${fmt(jv.hand_bad)} the hand check found bad, the judge caught ${fmt(jv.judge_caught)}, and it flagged ${fmt(jv.judge_flagged_hand_ok)} the hand check found fine.`, '');
  }
}
if (F.f0) md.push('F0 bench (20 files per model, measured, sim/fleet/F0.md):', '', table(['model', 'code unchanged', 'comments', 'judge accurate', 'helpful', 'p50 latency', '$ per 1k files'],
  Object.entries(F.f0).map(([m, v]) => v.withComments === 0 ? [m, 'not usable: 14 of 20 calls hit the free-tier quota', '-', '-', '-', '-', '-'] : [m, `${v.codeUnchanged}/${v.withComments}`, fmt(v.comments), v.judge?.accurate != null ? fmt(v.judge.accurate * 100) + '%' : '-', fmt(v.judge?.helpful, 2), `${fmt(v.latencyS?.p50, 1)} s`, usd(v.per1kFiles?.usd)])), '');

if (DIALS) {
  md.push('## Collision dials', '', `**Comment dial.** ${DIALS.comment.label}.${DIALS.comment.caveat ? ' ' + DIALS.comment.caveat : ''}`, '',
    table(['dial', 'tasks', 'tasks/s', 'pairs far / near / same', 'how pairs resolved', 'doubled comments', 'code changed', 'lost (checker)', 'land wait p50 / p90'],
      DIALS.comment.levels.map((l) => [`${l.dial}%${l.claims ? ' + claims' : ''}`, fmt(l.tasks), fmt(l.tasksPerSec), `${fmt(l.pairs.far)} / ${fmt(l.pairs.near)} / ${fmt(l.pairs.same)}`, Object.entries(l.resolutions).map(([k, v]) => `${k} ${fmt(v)}`).join(', '), fmt(l.doubled), fmt(l.codeChanged), `${fmt(l.lost)}${l.lostNote ? ` (${l.lostNote})` : ''}`, l.landWaitP50S != null ? `${fmt(l.landWaitP50S)} / ${fmt(l.landWaitP90S)} s` : `- (${l.landNote || ''})`])), '');
  if (DIALS.comment.finding) md.push(DIALS.comment.finding, '');
  md.push(`**Code dial.** ${DIALS.code.levels.length ? DIALS.code.label + '. Prediction: docs/board/sim.md (m).' : 'Pending (prediction in docs/board/sim.md (m)).'}`, '');
  if (DIALS.code.levels.length) md.push(table(['dial', 'wall', 'landed (clean / redo / replayed)', 'requirements passing on main', 'requirement lost: wrong at landing / later agent dropped it / lost in landing', 'base lost: wrong at landing / dropped later / lost in landing', 'models $'],
    DIALS.code.levels.map((l) => { const a = l.attribution || {}, r = l.landedByResolution || {}; return [`${l.dial}%${l.variant ? ` (${l.variant})` : ''}`, `${l.wallMin} min`, `${fmt(l.landed)} (${fmt(r.merged)} / ${fmt((r['redo+merged'] || 0) + (r['redo+replayed-llm'] || 0))} / ${fmt((r['replayed-llm'] || 0) + (r['redo+replayed-llm'] || 0))})`, `${fmt(l.requirementsPassing)} / ${fmt(l.requirements)}`, `${fmt(l.requirementLost)}: ${fmt(a.cr?.wrongAtLanding)} / ${fmt(a.cr?.laterAgentDroppedIt)} / ${fmt(a.cr?.concurrentLostInLanding)}`, `${fmt(l.baseLost)}: ${fmt(a.base?.wrongAtLanding)} / ${fmt(a.base?.laterAgentDroppedIt)} / ${fmt(a.base?.concurrentLostInLanding || 0)}`, usd(l.usd)]; })), '', ...DIALS.code.levels.filter((l) => l.note).map((l) => `Dial ${l.dial}%${l.variant ? ` (${l.variant})` : ''}: ${l.note}`), '');
}
md.push('## Real builds inside qodebase (R2-R8b)', '', `Label: ${RB.label}. Source: /api/admin/build-estimates (${RB.source}).`, '',
  table(['build', 'what', 'setup', 'wall', 'cost (tokens)', 'estimate shown', 'inside?'],
    RB.rows.map((r) => [r.id, r.what, r.setup, `${fmt(r.wallS)} s`, usd(r.usd), `${fmt(r.shownWallS[0])}-${fmt(r.shownWallS[1])} s, ${usd(r.shownUsd[0])}-${usd(r.shownUsd[1])}`, `time ${r.inside.wall ? 'yes' : 'no'}, cost ${r.inside.usd ? 'yes' : 'no'}`])), '',
  'Estimates as shown at the time; later refits (public/lab/predict.js REAL_FIT) were fitted on these builds.', '',
  (() => { const c = headline.realBuilds.teamVsOneAgent; return `Same prompt, team vs one Opus agent (model use at API rates, no containers): ${c.comparisons.map((x) => `${x.team.split('/').pop()} $${x.teamUsd} / ${fmt(x.teamS)} s vs one agent $${x.oneUsd} / ${fmt(x.oneS)} s`).join('; ')}. The team was cheaper in ${c.teamCheaper} of ${c.n}; one agent was faster in ${c.comparisons.filter((x) => x.oneS < x.teamS).length} of ${c.n}.`; })(), '');

md.push('## Board ablation (E7)', '', `Label: ${AB.label}. ${AB.ablation.scenario}.`, '',
  table(['arm', 'n', 'wall', 'agent-minutes', 'API-equiv $', 'twin pairs built twice (of 10)'], AB.ablation.arms.map((a) => [a.name, a.n, `${fmt(a.wallS)} s`, fmt(a.agentMin), usd(a.usd), fmt(a.dupPairs)])), '');
md.push('## Growing the team (W8)', '', `Label: ${AB.label}. ${AB.w8.scenario}.`, '',
  table(['arm', 'n', 'wall', 'API-equiv $', 'agent-minutes', 'hidden tests passed'], AB.w8.arms.map((a) => [a.name, a.n, `${fmt(a.wallS)} s`, usd(a.usd), fmt(a.agentMin), a.hidden.join(', ')])), '');

md.push('## Lanes', '', `**L1** ${L.L1.label}: max landed per hour and where it saturates (agents).`, '',
  table(['lanes', 'cross-area', 'areas', 'controller', 'max landed/h', 'saturates at (agents)'], L.L1.rows.map((r) => [r.lanes, `${fmt(r.cross * 100)}%`, r.zipf >= 1 ? 'one hot area' : 'flatter', r.controller ? 'yes' : 'no', fmt(r.maxPerH), fmt(r.saturatesAt)])), '',
  `**L2** ${L.L2.label} (6 h cells and 10,000-agent cells).`, '',
  table(['cell', 'agents', 'hours', 'lanes', 'landed/h (last hour)', 'median wait', '$ per change', 'main red share', 'agents awake'],
    L.L2.rows.map((r) => [r.name, fmt(r.agents), r.hours, r.lanes, fmt(r.perHLastHour), `${fmt(r.waitP50Min)} min`, usd(r.usdPerChange), fmt(r.redShare, 2), fmt(r.awake)])), '',
  `**L3** ${L.L3.label}.`, '',
  table(['cell', 'agents', 'lanes', 'door', 'cross', 'tasks', 'landed', 'main whole', 'landed twice'], L.L3.rows.map((r) => [r.cell, fmt(r.agents), r.lanes, r.door || '-', `${fmt((r.cross || 0) * 100)}%`, fmt(r.tasks), fmt(r.landed), r.mainWhole ? 'yes' : 'no', fmt(r.dupIds)])), '');

md.push('## Variants lab (stages 1-4)', '', `Label: ${LAB.label}.`, '',
  table(['stage', 'scenario', 'setup', 'n', 'wall', 'API $', 'quality', 'hidden'], LAB.rows.map((r) => [r.stage, r.scenario, r.setup, r.n, `${fmt(r.wallS)} s`, usd(r.usd), fmt(r.quality, 1), r.hidden])), '');
fs.writeFileSync(path.join(ROOT, 'docs/board/RESULTS.md'), md.join('\n'));
console.log(JSON.stringify({ wrote: ['docs/board/RESULTS.md', 'public/results.json'], fleetRuns: F.runs.length, fleetSource: F.source, realBuilds: RB.rows.length, buildsSource: RB.source, notes }));
