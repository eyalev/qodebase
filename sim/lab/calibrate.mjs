#!/usr/bin/env node
// Variants lab: predicted vs actual for every real run (public/lab/runs.jsonl), and the CAL
// numbers those runs support. Prints a table, writes public/lab/calibration.json (the evidence;
// predict.js's CAL is updated by hand from it, citing the runs, and SIM_VERSION bumped).
//
//   node sim/lab/calibrate.mjs [--runs public/lab/runs.jsonl] [--stage 1]
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAL, SCENARIOS, SIM_VERSION, predict, qualityScore } from '../../public/lab/predict.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => { if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]); return acc; }, []));
const lines = readFileSync(join(ROOT, args.runs || 'public/lab/runs.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  .filter((l) => l.status === 'done' && (args.stage == null || l.stage === Number(args.stage)));

const med = (xs) => { const a = xs.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) / 2)] : null; };
const sum = (xs) => xs.reduce((a, b) => a + (b || 0), 0);
const fmt = (x, d = 0) => (x == null ? '–' : (+x).toFixed(d));

// ---- per run: predicted vs actual ----
const rows = lines.map((l) => {
  const judgeUsd = l.cost?.byRole?.judge?.apiUsdStd || 0;
  const usd = (l.cost?.apiUsdStd ?? 0) - (l.cost?.byRole?.judge && l.cost.apiUsdStd >= judgeUsd + 0.0001 && l.cost.includesJudge ? judgeUsd : 0);
  const coderTasks = (l.tasks || []).filter((t) => (t.role || 'coder') === 'coder');
  const work = coderTasks.map((t) => (t.pushAt && t.startAt ? (t.pushAt - t.startAt) / 1000 : null));
  const q = l.quality || {};
  // The sim predicts quality without a judge (no model to predict one); compare like with like.
  const qNoJudge = q.hiddenTotal ? qualityScore({ ...q, judgeScore: null }) : null;
  const now = l.baseline ? predict({}, l.scenario, { baseline: l.baseline }) : predict(l.variant, l.scenario);
  return {
    id: l.id, variantKey: l.variantKey, baseline: l.baseline, scenario: l.scenario,
    planner: l.baseline === 'opus-alone' ? 'opus' : l.variant?.planner, coderModel: l.variant?.coderModel,
    pred: l.predicted, now: { wallS: now.wallS, apiUsdStd: now.apiUsdStd, quality: now.quality, simVersion: now.simVersion },
    wallS: l.timings?.wallS, planS: l.timings?.planAt && l.timings?.askAt ? (l.timings.planAt - l.timings.askAt) / 1000 : null,
    usd, tasksPlanned: l.counts?.tasksPlanned, tasksLanded: l.counts?.tasksLanded, expectedTasks: SCENARIOS[l.scenario]?.tasks,
    workS: work, workMedS: med(work), quality: q.score, qualityNoJudge: qNoJudge, hiddenShare: q.hiddenTotal ? q.hiddenPass / q.hiddenTotal : null, judge: q.judgeScore,
    tokens: l.cost?.tokens, conflicts: l.counts?.conflicts, bounces: l.counts?.bounces,
  };
});

console.log(`${rows.length} real runs (sim now ${SIM_VERSION})\n`);
console.log(`run                         | wall s: at run time / now (${SIM_VERSION}) / real | API $: at run / now / real | quality (no judge): at run / now / real | tasks planned/expected`);
for (const r of rows) {
  console.log(`${(r.baseline || r.id).padEnd(28)}| ${fmt(r.pred?.wallS).padStart(5)} / ${fmt(r.now.wallS).padStart(5)} / ${fmt(r.wallS).padEnd(5)} | ${fmt(r.pred?.apiUsdStd, 2).padStart(6)} / ${fmt(r.now.apiUsdStd, 2).padStart(5)} / ${fmt(r.usd, 3).padEnd(6)} | ${fmt(r.pred?.quality, 1).padStart(5)} / ${fmt(r.now.quality, 1).padStart(5)} / ${fmt(r.qualityNoJudge, 1).padEnd(5)} | ${fmt(r.tasksPlanned)} / ${fmt(r.expectedTasks)}`);
}

// ---- what the runs say about CAL ----
const byModel = (key) => { const m = {}; for (const r of rows) { const k = r[key]; if (!k) continue; (m[k] ||= []).push(r); } return m; };
const fit = { runs: rows.length, from: rows.map((r) => r.id), coder: {}, planner: {} };
for (const [model, rs] of Object.entries(byModel('coderModel'))) {
  const work = rs.flatMap((r) => r.workS);
  const workSum = sum(work);
  // Coder $ per second of work: the run's API $ (byRole is not filled yet, so planner + merge
  // ride along; small next to coders) over the summed coder work seconds.
  fit.coder[model] = { tasks: work.length, workMedS: med(work), simWorkMedS: CAL.workMedS * CAL.speed[model], usdPerS: workSum ? +(sum(rs.map((r) => r.usd)) / workSum).toFixed(6) : null, simUsdPerS: CAL.usdPerS[model] };
}
for (const [model, rs] of Object.entries(byModel('planner'))) {
  fit.planner[model] = {
    runs: rs.length, planMedS: med(rs.map((r) => r.planS)), simPlanS: CAL.planS[model],
    // Coverage: tasks the plan made vs what the scenario needs, and hidden tests passed.
    tasksPlannedShare: +(med(rs.map((r) => (r.expectedTasks ? r.tasksPlanned / r.expectedTasks : null))) ?? 0).toFixed(2),
    hiddenShareMed: med(rs.map((r) => r.hiddenShare)),
  };
}
const ratio = (k1, k2) => med(rows.map((r) => (r.pred?.[k1] && r[k2] != null ? r[k2] / r.pred[k1] : null)));
fit.actualOverPredicted = { wallS: ratio('wallS', 'wallS'), apiUsdStd: ratio('apiUsdStd', 'usd'), quality: ratio('quality', 'qualityNoJudge') };
const ratioNow = (k1, k2) => med(rows.map((r) => (r.now?.[k1] && r[k2] != null ? r[k2] / r.now[k1] : null)));
fit.actualOverNow = { simVersion: SIM_VERSION, wallS: ratioNow('wallS', 'wallS'), apiUsdStd: ratioNow('apiUsdStd', 'usd'), quality: ratioNow('quality', 'qualityNoJudge') };

console.log('\nCoder models (sim -> real):');
for (const [m, f] of Object.entries(fit.coder)) console.log(`  ${m}: work median ${fmt(f.simWorkMedS)} s -> ${fmt(f.workMedS)} s (${f.tasks} tasks); $/s ${f.simUsdPerS.toFixed(5)} -> ${f.usdPerS?.toFixed(5) ?? '–'}`);
console.log('Planners:');
for (const [m, f] of Object.entries(fit.planner)) console.log(`  ${m}: plan ${fmt(f.simPlanS)} s -> ${fmt(f.planMedS)} s; planned ${f.tasksPlannedShare} of the tasks the scenario needs; hidden tests passed (median) ${fmt(f.hiddenShareMed, 2)}`);
console.log(`Actual / predicted at run time (median): wall ${fmt(fit.actualOverPredicted.wallS, 2)}x, API $ ${fmt(fit.actualOverPredicted.apiUsdStd, 2)}x, quality ${fmt(fit.actualOverPredicted.quality, 2)}x`);
console.log(`Actual / predicted now (${SIM_VERSION}):        wall ${fmt(fit.actualOverNow.wallS, 2)}x, API $ ${fmt(fit.actualOverNow.apiUsdStd, 2)}x, quality ${fmt(fit.actualOverNow.quality, 2)}x`);

writeFileSync(join(ROOT, 'public/lab/calibration.json'), JSON.stringify({ generated: new Date().toISOString(), simVersion: SIM_VERSION, fit, runs: rows }, null, 1));
console.log('\nwrote public/lab/calibration.json');
