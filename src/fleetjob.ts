// Start a fleet job from the app (qb7, manager 2026-10-13, Eyal approved for the video): the owner picks a copy, the job
// (doc comments, or comments + an API index), agents and a budget, sees an estimate, and starts it on qbfleet through
// forq's proxy (src/index.ts, owner/admin only; the fleet key never reaches the browser). This module is pure: the
// estimate and the request checks, so node --test runs them (src/fleetjob.test.mjs).
//
// The estimate (ranges, not promises): files from qbfleet's /copies; per model, $ per 1,000 files and the per-model limit
// as measured by qb6 in S5 (2026-10-13: batched ~5 files a call; gemma ~200 calls/min, glm-4.7-flash 400+; $/1k files
// gemma 0.31, glm 0.18), scaled by the share of the paced rate real runs reached (~0.65, F3b), plus a minute for the
// last landings. 'cache' answers from earlier comments: no model, no $.
export type Model = { model: string; maxPerMin: number };
export type JobKind = 'comments' | 'comments+index';
export const MODELS: Record<string, { usdPer1k: number; callsPer1k: number; maxPerMin: number; label: string }> = {
  '@cf/google/gemma-4-26b-a4b-it': { usdPer1k: 0.31, callsPer1k: 200, maxPerMin: 200, label: 'Gemma 4 (Workers AI)' },
  '@cf/zai-org/glm-4.7-flash': { usdPer1k: 0.18, callsPer1k: 200, maxPerMin: 400, label: 'GLM 4.7 Flash (Workers AI)' },
  cache: { usdPer1k: 0, callsPer1k: 1000, maxPerMin: 60000, label: 'Cache (answers reused, no model)' },
  'gemini-3.1-flash-lite': { usdPer1k: 0.86, callsPer1k: 200, maxPerMin: 1500, label: 'Gemini 3.1 Flash-Lite (overflow)' },
};
/** Used only when every Workers AI model is at its limit (qb6: the take finishes in ~1.5-2 min instead of ~5). */
export const OVERFLOW: Record<string, Model | undefined> = { workers: { model: 'gemini-3.1-flash-lite', maxPerMin: 1500 } };
export const PRESETS: Record<string, Model[]> = {
  workers: [{ model: '@cf/google/gemma-4-26b-a4b-it', maxPerMin: 200 }, { model: '@cf/zai-org/glm-4.7-flash', maxPerMin: 400 }],
  cache: [{ model: 'cache', maxPerMin: 60000 }],
};
export const AGENTS_MAX = 2000, BUDGET_MAX = 30;
const REACHED = 0.65, INDEX_EXTRA = 0.15;   // share of the paced rate real runs reached; an API index line costs ~15% more

/** -> { files, agents, minutes: [lo, hi], usd: [lo, hi], capUsd, note } */
export function estimate(o: { files: number; models: Model[]; agents: number; budgetUsd: number; job?: JobKind; overflow?: Model }) {
  const files = Math.max(0, Math.round(o.files || 0));
  const ms = o.models.filter((m) => MODELS[m.model]);
  if (!files || !ms.length) return null;
  const callsPerFile = ms.reduce((a, m) => a + MODELS[m.model].callsPer1k, 0) / ms.length / 1000;
  const usdPerFile = ms.reduce((a, m) => a + MODELS[m.model].usdPer1k, 0) / ms.length / 1000 * (o.job === 'comments+index' ? 1 + INDEX_EXTRA : 1);
  const rate = ms.reduce((a, m) => a + Math.min(m.maxPerMin || MODELS[m.model].maxPerMin, MODELS[m.model].maxPerMin), 0) * REACHED;   // calls per minute
  // agents cap the pace too: each agent does about one file every 20 s at best. The overflow model takes what the main
  // models cannot (its share of the files, at its own price).
  const ov = o.overflow && MODELS[o.overflow.model] ? o.overflow : null;
  const perMinMain = rate / callsPerFile, perMinOv = ov ? (Math.min(ov.maxPerMin, MODELS[ov.model].maxPerMin) * REACHED) / (MODELS[ov.model].callsPer1k / 1000) : 0;
  const perMin = Math.min(perMinMain + perMinOv, Math.max(1, o.agents) * 3);
  const ovShare = ov ? Math.max(0, (perMin - perMinMain) / perMin) : 0;
  const mid = files / perMin + 1;
  // the S5 $/file came from batches of 20; smaller batches (many agents: files per agent) cost only a little more per
  // file (qb6: smaller packs, same input tokens): +1% a step below 20 (batch 4 -> x1.04). With Gemini as overflow the
  // take (4,064 files, 1,000 agents, index job) comes to ~$2, qb6's measured ~$1.9.
  const batch = o.agents >= 500 ? Math.max(1, Math.min(20, Math.floor(files / Math.max(1, o.agents)))) : 20;
  const idx = o.job === 'comments+index' ? 1 + INDEX_EXTRA : 1;
  const usd = files * (usdPerFile * (1 - ovShare) + (ov ? (MODELS[ov.model].usdPer1k / 1000) * idx * ovShare : 0)) * (1 + 0.01 * (20 / batch - 1));
  const capUsd = Math.min(Math.max(0.1, o.budgetUsd || 0), BUDGET_MAX);
  return { files, agents: o.agents, minutes: [Math.max(1, Math.round(mid * 0.7)), Math.max(2, Math.round(mid * 1.4))] as [number, number],
    usd: [+(usd * 0.7).toFixed(2), +(usd * 1.3).toFixed(2)] as [number, number], capUsd,
    note: usd * 1.3 > capUsd ? `The budget may stop it at $${capUsd.toFixed(2)} before every file is done: raise it to be safe.` : '' };
}

/** A start request checked and clamped: {repo, root, job, agents, budgetUsd, models, label} or {error}. */
export function cleanStart(b: Record<string, unknown>) {
  const repo = String(b.repo || '');
  if (!/^fleet-[a-z0-9-]{1,40}$/.test(repo)) return { error: 'Pick a copy.' };
  const root = String(b.root || '').replace(/^\/+|\/+$/g, '');
  if (root && !/^[\w.\-/]{1,120}$/.test(root)) return { error: 'That folder name is not usable.' };
  const job: JobKind = b.job === 'comments+index' ? 'comments+index' : 'comments';
  const agents = Math.max(1, Math.min(AGENTS_MAX, Math.round(Number(b.agents) || 50)));
  const budgetUsd = Math.max(0.1, Math.min(BUDGET_MAX, Number(b.budgetUsd) || 1));
  const preset = typeof b.preset === 'string' && PRESETS[b.preset] ? PRESETS[b.preset] : PRESETS.workers;
  const label = String(b.label || '').replace(/[^\w ,.:'()/+-]/g, '').slice(0, 80);
  // real models run batched and packed, paced by $ per minute (qb6's S5 settings); the cache needs none of it
  const real = preset.some((m) => m.model !== 'cache');
  // qb6 (2026-10-13): with many agents, batch = files per agent (1..20), or with batch 20 only ~files/20 agents ever get
  // work (4,064 files / 1,000 agents -> 4); pack.files the same.
  const files = Math.max(0, Math.round(Number(b.files) || 0));
  const per = agents >= 500 && files ? Math.max(1, Math.min(20, Math.floor(files / agents))) : 0;
  const overflow = typeof b.preset === 'string' ? OVERFLOW[b.preset] : OVERFLOW.workers;
  return { repo, root, ...(job === 'comments+index' ? { job } : {}), agents, budgetUsd, models: preset, ...(real && overflow ? { overflow } : {}), maxFiles: 100000, label,
    ...(real ? { batch: per || 20, pack: { files: per || 10, tokens: 24000 }, planUsdPerMin: 3 } : {}) };
}
