#!/usr/bin/env node
// Variants lab, stage 0: predict every knob combo on every scenario (public/lab/predict.js, no
// model calls), find the time / cost / quality frontier, and pick the variants that advance to
// stage 1 (funnel.mjs rules). Writes public/lab/stage0.json for the lab page and a JSON line per
// sweep to ~/.local/share/qbsim-bench/lab-stage0.jsonl.
//
//   node sim/lab/sweep.mjs [--seeds 5] [--scenarios cafe-family,port-ts] [--picks 6] [--budget <API-equiv $>] [--baseline-reps 1]
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { KNOBS, BASELINES, SCENARIOS, SIM_VERSION, predict, variantKey, scenarioProfile } from '../../public/lab/predict.js';
import { pickStage1 } from './funnel.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => { if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]); return acc; }, []));
const seeds = Number(args.seeds || 5);

// Scenario profiles: predict.js SCENARIOS (qb5's scenario.json profiles, mapped there).
function profiles() {
  return String(args.scenarios || 'cafe-family,port-ts').split(',').map((id) => ({ ...scenarioProfile(id), id, source: `scripts/lab/scenarios/${id}/scenario.json (qb5), mapped in public/lab/predict.js` }));
}

// Every combo; with no reviewers the reviewer model and style do not matter (one of each).
function* combos() {
  const keys = Object.keys(KNOBS);
  const rec = function* (i, v) {
    if (i === keys.length) { yield { ...v }; return; }
    const k = keys[i];
    for (const x of KNOBS[k].values) {
      if ((k === 'reviewerModel' || k === 'reviewStyle') && v.reviewers === 0 && x !== KNOBS[k].values[0]) continue;
      if (k === 'trainMax' && v.policy === 'github' && x !== 1) continue; // one PR at a time
      if (k === 'trainMax' && v.policy === 'phases' && x !== 1) continue; // shared tree: no queue
      v[k] = x; yield* rec(i + 1, v);
    }
  };
  yield* rec(0, {});
}

const t0 = performance.now();
const scen = profiles();
const rows = []; // one per combo: per-scenario means
for (const v of combos()) {
  const per = scen.map((sc) => { const p = predict(v, sc, { seeds }); return { wallS: p.wallS, usd: p.apiUsdStd, q: p.quality, qMin: p.range.quality[0], wMax: p.range.wallS[1] }; });
  rows.push({ key: variantKey(v), v, per });
}
const baselines = Object.keys(BASELINES).map((b) => ({ key: b, baseline: b, v: { ...BASELINES[b] }, per: scen.map((sc) => { const p = predict({}, sc, { seeds, baseline: b }); return { wallS: p.wallS, usd: p.apiUsdStd, q: p.quality, qMin: p.range.quality[0], wMax: p.range.wallS[1] }; }) }));
const sweepS = (performance.now() - t0) / 1000;

const picks = pickStage1(rows, baselines, scen, { n: Number(args.picks || 6), ...(args.budget ? { budgetUsd: Number(args.budget) } : {}), ...(args['baseline-reps'] ? { baselineRepetitions: Number(args['baseline-reps']) } : {}) });

// Per knob: the average effect of each value, all else averaged (what matters, in plain numbers).
const marginals = {};
for (const k of Object.keys(KNOBS)) {
  marginals[k] = KNOBS[k].values.map((x) => {
    const sel = rows.filter((r) => r.v[k] === x);
    const avg = (f) => +(sel.reduce((s, r) => s + r.per.reduce((a, p) => a + f(p), 0) / r.per.length, 0) / sel.length).toFixed(2);
    return { value: x, n: sel.length, wallS: Math.round(avg((p) => p.wallS)), usd: avg((p) => p.usd), quality: avg((p) => p.q) };
  });
}
const out = {
  simVersion: SIM_VERSION, generated: new Date().toISOString(), seeds, combos: rows.length, sweepS: +sweepS.toFixed(1),
  scenarios: scen.map(({ id, label, source, ...p }) => ({ id, label, source, profile: p })),
  baselines: baselines.map(({ key, v, per }) => ({ key, variant: v, per })),
  front: picks.front, picks: picks.picks, stage1: picks.stage1, rules: picks.rules, marginals,
  note: 'Stage-0 predictions from public/lab/predict.js (no model calls). Every assumed number is in its CAL; real runs (public/lab/runs.jsonl) recalibrate it. Not a measurement.',
};
const json = JSON.stringify(out, null, 1);
writeFileSync(join(ROOT, 'public/lab/stage0.json'), json);
mkdirSync(join(homedir(), '.local/share/qbsim-bench'), { recursive: true });
appendFileSync(join(homedir(), '.local/share/qbsim-bench/lab-stage0.jsonl'), JSON.stringify({ ts: out.generated, event: 'lab_stage0', simVersion: SIM_VERSION, seeds, combos: rows.length, sweepS: out.sweepS, picks: out.picks.map((p) => p.key), stage1: out.stage1 }) + '\n');

const fmt = (p) => `${Math.round(p.wallS / 60)} min, $${p.usd.toFixed(1)}, q ${p.q.toFixed(0)}`;
console.log(`${rows.length} combos x ${scen.length} scenarios x ${seeds} seeds in ${sweepS.toFixed(1)} s; front ${picks.front.length}; public/lab/stage0.json ${(json.length / 1024).toFixed(0)} KB`);
for (const b of baselines) console.log(`  baseline ${b.key.padEnd(12)} ${b.per.map(fmt).join(' | ')}`);
for (const p of out.picks) console.log(`  pick ${p.why.padEnd(28)} ${p.key}\n       ${p.per.map(fmt).join(' | ')}`);
console.log(`  stage 1: ${out.stage1.runs} runs (${out.stage1.scenario}, picks x${out.stage1.repetitions}, baselines x${out.stage1.baselineRepetitions}), predicted API-equivalent $${out.stage1.apiUsdStd} (picks $${out.stage1.picksUsd}, baselines $${out.stage1.baselinesUsd})${out.stage1.budgetUsd != null ? `, budget $${out.stage1.budgetUsd}` : ''}`);
