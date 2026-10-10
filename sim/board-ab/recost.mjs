// Re-price every board-ab run from its stored tokens (calls.jsonl per run + the dedupe call) at the current
// prices: 1-hour cache writes at 2x input (checked 2026-10-10 against Claude Code's total_cost_usd; E4 used
// 1.25x). Rewrites usd_api_equiv in each result.json and in runs.jsonl; keeps the old figure as usd_api_equiv_v1.
//   node sim/board-ab/recost.mjs [--dry]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const HERE = path.dirname(new URL(import.meta.url).pathname), ROOT = path.join(os.homedir(), '.local/share/qb9-board-ab');
const PRICES = { 'claude-haiku-5-5': { in: 0.10, out: 0.50, cacheR: 0.01, cacheW: 0.20 }, 'claude-sonnet-5-5': { in: 2, out: 10, cacheR: 0.10, cacheW: 4 } };
const cost = (t, P) => ((t.in || 0) * P.in + (t.out || 0) * P.out + (t.cacheR || 0) * P.cacheR + (t.cacheW || 0) * P.cacheW) / 1e6;
const dry = process.argv.includes('--dry');
const lines = fs.readFileSync(path.join(HERE, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
for (const r of lines) {
  const dir = path.join(ROOT, r.run); const P = PRICES[r.model || 'claude-haiku-5-5'];
  const calls = fs.readFileSync(path.join(dir, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const d = r.dedupe?.tokens; const dUsd = d ? cost({ in: d.input_tokens, out: d.output_tokens, cacheR: d.cache_read_input_tokens, cacheW: d.cache_creation_input_tokens }, PRICES['claude-haiku-5-5']) : 0;
  const w = calls.filter((c) => (c.status === 'skipped' || c.status === 'failed') && (c.turns ?? 0) >= 10);
  const next = +(calls.reduce((a, c) => a + cost(c.tokens, P), 0) + dUsd).toFixed(4);
  if (r.usd_api_equiv_v1 == null && r.price?.cacheW !== P.cacheW) r.usd_api_equiv_v1 = r.usd_api_equiv;
  r.usd_api_equiv = next; r.wasted_usd = +w.reduce((a, c) => a + cost(c.tokens, P), 0).toFixed(4); r.price = P; if (r.dedupe) r.dedupe.usd_api_equiv = +dUsd.toFixed(5);
  r.usd_note = `subscription; API-equivalent at ${r.model || 'claude-haiku-5-5'} rates, 1h cache writes (recost.mjs)`;
  console.log(r.run, r.usd_api_equiv_v1 ?? '-', '->', next);
  if (!dry && fs.existsSync(path.join(dir, 'result.json'))) { const res = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8')); fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ ...res, usd_api_equiv: r.usd_api_equiv, usd_api_equiv_v1: r.usd_api_equiv_v1, wasted_usd: r.wasted_usd, price: P, usd_note: r.usd_note, dedupe: r.dedupe }, null, 1)); }
}
if (!dry) fs.writeFileSync(path.join(HERE, 'runs.jsonl'), lines.map((r) => JSON.stringify(r)).join('\n') + '\n');
