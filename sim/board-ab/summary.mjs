// E4 summary: per condition median [min-max] of each measure over the reps in runs.jsonl, and an
// exact two-sided Mann-Whitney U test of each board condition against A (n is small: 5 vs 5).
//   node sim/board-ab/summary.mjs [--scenario s1|s2] [--md]   (skips smoke runs, rep 0)
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SCEN = (() => { const i = process.argv.indexOf('--scenario'); return i >= 0 ? process.argv[i + 1] : 's1'; })();
const runs = fs.readFileSync(path.join(HERE, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.rep > 0 && (r.scenario || 's1') === SCEN && r.agents === (SCEN === 's1' ? 5 : 10));
const M = [
  ['wall_s', 'wall time (s)'], ['hidden_pass', `hidden tests (of ${SCEN === 's1' ? 16 : 30})`], ['agent_minutes', 'agent-minutes (all calls)'], ['wasted_agent_minutes', 'agent-minutes wasted (built then dropped)'], ['red_commits', 'red commits on main'],
  ['wasted_work_calls', 'wasted work (calls that built a task then dropped it)'], ['deferrals', 'deferrals (skipped before any work)'],
  ['dup_pairs_both_separate', `duplicate pairs built twice (of ${SCEN === 's1' ? 4 : 5})`], ['same_task_twice_n', 'same task landed twice'],
  ['conflicts', 'merge conflicts resolved'], ['rebase_aborts', 'rebases aborted'], ['resets_to_origin', 'resets to origin/main'],
  ['rejected_push_recoveries', 'rejected pushes recovered'], ['calls', 'agent calls'], ['usd_api_equiv', 'API-equiv $ (Haiku 5.5)'],
];
for (const r of runs) r.same_task_twice_n = (r.same_task_twice || []).length;
const conds = [...new Set(runs.map((r) => r.cond))].sort();
const vals = (c, k) => runs.filter((r) => r.cond === c).map((r) => r[k]).filter((v) => v != null);
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
// Exact Mann-Whitney: enumerate every split of the pooled values (C(10,5) = 252), ties by mid-rank.
function mannWhitney(a, b) {
  if (!a.length || !b.length) return null;
  const all = [...a, ...b]; const sorted = all.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const rank = Array(all.length); for (let i = 0; i < sorted.length;) { let j = i; while (j < sorted.length && sorted[j][0] === sorted[i][0]) j++; for (let k = i; k < j; k++) rank[sorted[k][1]] = (i + j + 1) / 2; i = j; }
  const n1 = a.length, n = all.length; const U = (rs) => rs.reduce((s, r) => s + r, 0) - (n1 * (n1 + 1)) / 2;
  const obs = U(rank.slice(0, n1)); const mean = (n1 * (n - n1)) / 2; const dObs = Math.abs(obs - mean);
  let extreme = 0, total = 0; const idx = [...Array(n).keys()];
  const comb = (start, chosen) => { if (chosen.length === n1) { total++; if (Math.abs(U(chosen.map((i) => rank[i])) - mean) >= dObs - 1e-9) extreme++; return; } for (let i = start; i < n; i++) comb(i + 1, [...chosen, idx[i]]); };
  comb(0, []);
  return +(extreme / total).toFixed(3);
}
const out = { n: Object.fromEntries(conds.map((c) => [c, vals(c, 'wall_s').length])), measures: {} };
for (const [k, label] of M) {
  out.measures[k] = { label };
  for (const c of conds) { const v = vals(c, k); out.measures[k][c] = { median: med(v), min: Math.min(...v), max: Math.max(...v) }; }
  for (const c of conds.filter((c) => c !== 'A')) out.measures[k][`p_${c}_vs_A`] = mannWhitney(vals(c, k), vals('A', k));
  if (conds.includes('C') && conds.includes('D')) out.measures[k].p_D_vs_C = mannWhitney(vals('D', k), vals('C', k));
}
fs.writeFileSync(path.join(HERE, SCEN === 's1' ? 'summary.json' : `summary-${SCEN}.json`), JSON.stringify(out, null, 1));
if (process.argv.includes('--md')) {
  const fmt = (o) => (o.median == null ? '-' : `${+o.median.toFixed(o.median % 1 ? 2 : 0)} [${+o.min.toFixed(2)}–${+o.max.toFixed(2)}]`);
  console.log(`| measure | ${conds.map((c) => `${c} (n=${out.n[c]})`).join(' | ')} | ${conds.filter((c) => c !== 'A').map((c) => `p ${c} vs A`).join(' | ')} | p D vs C |`);
  console.log(`|---|${conds.map(() => '---').join('|')}|${conds.filter((c) => c !== 'A').map(() => '---').join('|')}|---|`);
  for (const [k, label] of M) console.log(`| ${label} | ${conds.map((c) => fmt(out.measures[k][c])).join(' | ')} | ${conds.filter((c) => c !== 'A').map((c) => out.measures[k][`p_${c}_vs_A`]).join(' | ')} | ${out.measures[k].p_D_vs_C ?? '-'} |`);
} else console.log(JSON.stringify(out, null, 1));
