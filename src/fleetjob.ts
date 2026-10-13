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
};
export const PRESETS: Record<string, Model[]> = {
  workers: [{ model: '@cf/google/gemma-4-26b-a4b-it', maxPerMin: 200 }, { model: '@cf/zai-org/glm-4.7-flash', maxPerMin: 400 }],
  cache: [{ model: 'cache', maxPerMin: 60000 }],
};
export const AGENTS_MAX = 2000, BUDGET_MAX = 30;
const REACHED = 0.65, INDEX_EXTRA = 0.15;   // share of the paced rate real runs reached; an API index line costs ~15% more

/** -> { files, agents, minutes: [lo, hi], usd: [lo, hi], capUsd, note } */
export function estimate(o: { files: number; models: Model[]; agents: number; budgetUsd: number; job?: JobKind }) {
  const files = Math.max(0, Math.round(o.files || 0));
  const ms = o.models.filter((m) => MODELS[m.model]);
  if (!files || !ms.length) return null;
  const callsPerFile = ms.reduce((a, m) => a + MODELS[m.model].callsPer1k, 0) / ms.length / 1000;
  const usdPerFile = ms.reduce((a, m) => a + MODELS[m.model].usdPer1k, 0) / ms.length / 1000 * (o.job === 'comments+index' ? 1 + INDEX_EXTRA : 1);
  const rate = ms.reduce((a, m) => a + Math.min(m.maxPerMin || MODELS[m.model].maxPerMin, MODELS[m.model].maxPerMin), 0) * REACHED;   // calls per minute
  // agents cap the pace too: each agent does about one file every 20 s at best
  const perMin = Math.min(rate / callsPerFile, Math.max(1, o.agents) * 3);
  const mid = files / perMin + 1;
  const usd = files * usdPerFile;
  const capUsd = Math.min(Math.max(0.1, o.budgetUsd || 0), BUDGET_MAX);
  return { files, agents: o.agents, minutes: [Math.max(1, Math.round(mid * 0.7)), Math.max(2, Math.round(mid * 1.4))] as [number, number],
    usd: [+(usd * 0.7).toFixed(2), +(usd * 1.3).toFixed(2)] as [number, number], capUsd,
    note: usd * 1.3 > capUsd ? `The budget stops it at $${capUsd.toFixed(2)}, before every file is done.` : '' };
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
  return { repo, root, ...(job === 'comments+index' ? { job } : {}), agents, budgetUsd, models: preset, maxFiles: 100000, label,
    ...(real ? { batch: 20, pack: { files: 10, tokens: 24000 }, planUsdPerMin: 3 } : {}) };
}
