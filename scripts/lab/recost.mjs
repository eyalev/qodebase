#!/usr/bin/env node
// Re-price lines of public/lab/runs.jsonl per role and model from the boxes' own cost lines in
// Workers Observability (box.ts logs tokens per model since e3d6be1), for runs whose runner could not
// read them at the time (12b-14, 2026-10-08: the query sent an 'offset' the API rejects).
//   node scripts/lab/recost.mjs <run id> [<run id>…]
// Keeps the line when no per-model lines exist (boxes on older code): its upper bound stays, said in notes.
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const RUNS = join(ROOT, 'public/lab/runs.jsonl');
// Official rates per MTok (platform.claude.com pricing, checked 2026-10-08): input, output, cache read, 1-h cache write.
const RATES = { haiku: [0.10, 0.50, 0.01, 0.20], sonnet: [2, 10, 0.10, 4], opus: [4, 20, 0.20, 8] };
const priceOf = (model, t) => {
  const k = /opus/.test(model) ? 'opus' : /sonnet/.test(model) ? 'sonnet' : 'haiku';
  const [ri, ro, rc, rw] = RATES[k];
  const std = ((t.in || 0) * ri + (t.out || 0) * ro + (t.cr || 0) * rc + (t.cw1h || 0) * rw + (t.cw || 0) * ri * 1.25) / 1e6;
  return { k, std, high: k === 'haiku' ? std * 5 : std };
};
const roleOf = (id) => (id.endsWith('--router') ? 'planner' : /--review\d*$/.test(id) ? 'reviewers' : 'coders');
async function telemetry(needle, fromMs, event) {
  const tok = readFileSync(join(homedir(), '.config/forq-cf/api-token'), 'utf8').trim();
  const r = await fetch('https://api.cloudflare.com/client/v4/accounts/887d7234a6b8d65ad355a4f6684cab67/workers/observability/telemetry/query', { method: 'POST',
    headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
    body: JSON.stringify({ queryId: 'adhoc', timeframe: { from: fromMs, to: Date.now() }, view: 'events', limit: 2000,
      parameters: { needle: { value: needle, isRegex: false }, filters: [{ key: 'event', operation: 'eq', type: 'string', value: event }] } }) }).then((x) => x.json());
  if (!r.success) throw new Error(JSON.stringify(r.errors).slice(0, 300));
  return (r.result?.events?.events || []).map((e) => e.source).filter((x) => x && typeof x === 'object');
}

const ids = process.argv.slice(2);
const lines = readFileSync(RUNS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
for (const d of lines.filter((l) => ids.includes(l.id))) {
  const slug = `eyal.${d.id}`, from = d.timings.askAt - 10 * 60_000;
  const box = (await telemetry(`${slug}--`, from, 'costs')).filter((x) => String(x.agentId || '').startsWith(`${slug}--`) && x.tokens);
  const replays = (await telemetry(slug, from, 'replay_llm')).filter((x) => x.slug === slug);
  if (!box.length) { console.log(JSON.stringify({ id: d.id, kept: 'no per-model cost lines (boxes on older code)' })); continue; }
  const byRole = { planner: null, coders: null, reviewers: null, merge: null };
  let std = 0, high = 0;
  const add = (role, model, t) => {
    const p = priceOf(model, t);
    const r = byRole[role] || (byRole[role] = { apiUsdStd: 0, apiUsdHigh: 0, models: [], tokens: { in: 0, out: 0, cacheR: 0, cacheW: 0 } });
    r.apiUsdStd += p.std; r.apiUsdHigh += p.high; if (!r.models.includes(p.k)) r.models.push(p.k);
    r.tokens.in += t.in || 0; r.tokens.out += t.out || 0; r.tokens.cacheR += t.cr || 0; r.tokens.cacheW += (t.cw || 0) + (t.cw1h || 0);
    std += p.std; high += p.high;
  };
  for (const x of box) for (const [model, t] of Object.entries(x.tokens)) add(roleOf(x.agentId), model, t);
  for (const x of replays) add('merge', x.model || 'haiku', { in: x.in, out: x.out, cr: x.cacheRead, cw: Math.max(0, (x.cacheWrite || 0) - (x.cacheWrite1h || 0)), cw1h: x.cacheWrite1h || 0 });
  for (const r of Object.values(byRole)) if (r) { r.apiUsdStd = Math.round(r.apiUsdStd * 1000) / 1000; r.apiUsdHigh = Math.round(r.apiUsdHigh * 1000) / 1000; }
  // Only when the lines cover the run: boxes on older code log no tokens, and a partial sum would
  // UNDER-state the cost (run 11: $0.04 from a few lines vs the ledger's 10x more output tokens).
  const outLines = box.reduce((n, x) => n + Object.values(x.tokens).reduce((m, t) => m + (t.out || 0), 0), 0);
  const outLedger = d.cost.tokens?.out || 0;
  if (outLedger && outLines < 0.9 * outLedger) { console.log(JSON.stringify({ id: d.id, kept: `lines cover ${Math.round(100 * outLines / outLedger)}% of the run's output tokens` })); continue; }
  const before = d.cost.apiUsdStd;
  d.cost = { ...d.cost, apiUsdStd: Math.round(std * 1000) / 1000, apiUsdHigh: Math.round(high * 1000) / 1000, pricedAs: 'per-model', byRole: { ...byRole, judge: d.cost.byRole?.judge ?? null } };
  d.notes = (d.notes || '').split('; ').filter((n) => !/UPPER BOUND|priced as \w+ for every token/i.test(n)).concat(`re-priced per role and model from ${box.length} box cost lines (scripts/lab/recost.mjs; was $${before})`).filter(Boolean).join('; ');
  console.log(JSON.stringify({ id: d.id, before, after: d.cost.apiUsdStd, byRole: Object.fromEntries(Object.entries(byRole).map(([k, v]) => [k, v?.apiUsdStd ?? null])) }));
}
writeFileSync(RUNS, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
