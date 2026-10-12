// "Suggest settings for my prompt" (Build settings B4; spec docs/board/build-estimate.md, qb4): one small model
// call reads only the prompt and returns the JOB as facts {tasks, overlap, difficulty, vague, summary, confidence};
// the preset is picked in code (public/lab/predict.js suggestBuild), never by the model.
//   POST /api/build/suggest {prompt} -> {job, suggestion|null, estimate, model, ms}
// Model: Claude Haiku 5.5 when the Worker has an ANTHROPIC_API_KEY secret (qodebase's own key), else Workers AI
// (glm-4.7-flash, thinking off) through the qodebase-talk AI Gateway. Bad JSON or 4 s: SMALL_APP, no suggestion.
// Caps: 40 a day per person, 1000 a day in all (Registry.dayCount). Every call is a Ledger row (kind 'ai').

import type { Env } from './env';
// @ts-ignore: plain JS module shared with the lab page (no types)
import { suggestBuild, predictBuild, BUILD_PRESETS, SMALL_APP } from '../public/lab/predict.js';
import { recordCost, claudeUsd } from './costs';
import { registry } from './registry';
import { log } from './box';
import { SUGGEST_SYSTEM, parseJob, type Job } from './buildsettings';

export const SUGGEST_CAPS = { perPerson: 40, total: 1000 };
const HAIKU = 'claude-haiku-5-5';
const WAI = '@cf/zai-org/glm-4.7-flash';
const TIMEOUT_MS = 4000;

/** What the page shows: the job, the suggestion (only at confidence >= 0.4), the estimate for it. */
export function suggestion(job: Job | null) {
  if (!job) return { job: null, suggestion: null, estimate: predictBuild(SMALL_APP, BUILD_PRESETS.balanced.variant) };
  const j = { tasks: job.tasks, overlap: job.overlap, difficulty: job.difficulty, label: job.summary };
  if (job.confidence < 0.4) return { job, suggestion: null, estimate: predictBuild(j, BUILD_PRESETS.balanced.variant) };
  const s = suggestBuild(j) as { preset: string; why: string; board?: boolean };
  const variant = { ...BUILD_PRESETS[s.preset].variant, ...(s.board !== undefined ? { board: s.board } : {}) };
  return { job, suggestion: s, estimate: predictBuild(j, variant) };
}

async function callModel(env: Env, prompt: string): Promise<{ text: string; model: string; usd: number | null; tokens?: { in: number; out: number } }> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  if (env.ANTHROPIC_API_KEY) {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal,
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: HAIKU, max_tokens: 250, temperature: 0, system: SUGGEST_SYSTEM, messages: [{ role: 'user', content: prompt }] }) });
    const j = await r.json() as any;
    if (!r.ok) throw new Error(`anthropic ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
    const tokens = { in: j.usage?.input_tokens || 0, out: j.usage?.output_tokens || 0 };
    return { text: (j.content || []).map((c: any) => c.text || '').join(''), model: HAIKU, usd: claudeUsd(HAIKU, { ...tokens, cw: 0, cr: 0 }), tokens };
  }
  const run = (env.AI as any).run(WAI, { messages: [{ role: 'system', content: SUGGEST_SYSTEM }, { role: 'user', content: prompt }], max_tokens: 250, temperature: 0, seed: 7,
    chat_template_kwargs: { enable_thinking: false } }, env.TALK_GATEWAY ? { gateway: { id: env.TALK_GATEWAY } } : {});
  const res: any = await Promise.race([run, new Promise((_, no) => signal.addEventListener('abort', () => no(new Error('timeout'))))]);
  const text = res?.choices?.[0]?.message?.content ?? res?.response ?? '';
  return { text: typeof text === 'string' ? text : JSON.stringify(text), model: WAI, usd: null };
}

export async function suggestRoute(request: Request, env: Env, ctx: ExecutionContext, handle: string): Promise<Response> {
  const b = await request.json().catch(() => ({})) as { prompt?: string };
  const prompt = String(b.prompt || '').trim().slice(0, 3000);
  if (prompt.length < 4) return Response.json({ error: 'Say what to build' }, { status: 400 });
  // The same prompt gets the same answer for a day: temperature 0 alone still read one bakery prompt as 12 or 20
  // tasks (manager, 2026-10-12), which flipped the preset. Memo per colo by prompt hash; a fallback is not kept.
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(prompt.toLowerCase().replace(/\s+/g, ' '))))].map((x) => x.toString(16).padStart(2, '0')).join('');
  const key = new Request(`https://suggest.qodebase.internal/${hash}`);
  const hit = await caches.default.match(key).catch(() => undefined);
  if (hit) { const j = await hit.json() as { job: Job; model: string }; log('build', 'suggest', { handle, cached: true, tasks: j.job.tasks }); return Response.json({ ...suggestion(j.job), model: j.model, ms: 0, cached: true }, { headers: { 'cache-control': 'no-store' } }); }
  const reg = registry(env);
  const mine = await reg.dayCount(`suggest:${handle}`, SUGGEST_CAPS.perPerson);
  const all = mine.ok ? await reg.dayCount('suggest:*', SUGGEST_CAPS.total) : mine;
  if (!mine.ok || !all.ok) return Response.json({ error: 'Suggestions are used up for today; pick a preset yourself', ...suggestion(null) }, { status: 429 });
  const t0 = Date.now();
  let job: Job | null = null, model = '', err = '';
  try {
    const r = await callModel(env, prompt);
    model = r.model; job = parseJob(r.text);
    if (!job) err = `bad answer: ${r.text.slice(0, 120)}`;
    ctx.waitUntil(recordCost(env, handle, 'ai', 'build suggestion', { usd: r.usd, covered: true, ...(r.tokens ? { tokens: { ...r.tokens, cw: 0, cr: 0 } } : {}), billing: 'api' }));
  } catch (e) { err = String((e as Error)?.message || e).slice(0, 200); }
  const ms = Date.now() - t0;
  if (job) ctx.waitUntil(caches.default.put(key, new Response(JSON.stringify({ job, model }), { headers: { 'content-type': 'application/json', 'cache-control': 's-maxage=86400' } })));
  log('build', 'suggest', { handle, model, ms, ok: !!job, err: err || undefined, tasks: job?.tasks, confidence: job?.confidence });
  return Response.json({ ...suggestion(job), model: model || null, ms, ...(err ? { fallback: true } : {}) }, { headers: { 'cache-control': 'no-store' } });
}
