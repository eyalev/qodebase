// Writes public/lab/runs.mock.jsonl + stages.mock.jsonl: invented results in the runs.jsonl v1
// shape (docs/lab/runs-schema.md) so the lab page (qb7) can be built before real runs exist.
// Every line says mock:true; the page shows a "sample data" banner when it reads this file.
// Run: node src/landingui/lab-mock.mjs
import { writeFileSync } from 'node:fs';

let s = 7;
const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
const T0 = Date.UTC(2026, 9, 9, 10, 0, 0);
const V = (o) => ({ planner: 'sonnet', coders: 6, coderModel: 'haiku', reviewers: 1, reviewerModel: 'haiku', reviewStyle: 'read', policy: 'intent', claims: true, dedupe: true, trainMax: 8, ...o });
const key = (b, v) => b || `${v.planner}/${v.coders}x${v.coderModel}/r${v.reviewers}${v.reviewStyle[0]}/${v.policy}${v.claims ? '+c' : ''}${v.dedupe ? '+d' : ''}/t${v.trainMax}`;
// [scenario, baseline, variant, stage, seeds, minutes, quality, apiUsd, predicted{min, q, usd}, counts tweak]
const SETUPS = [
  ['cafe-family', 'opus-alone', V({ planner: 'none', coders: 1, coderModel: 'opus', reviewers: 0, policy: 'ffa', claims: false, dedupe: false, trainMax: 1 }), 1, 2, 31, 79, 0.92, [28, 80, 0.85]],
  ['cafe-family', 'github', V({ policy: 'github', claims: false, dedupe: false, trainMax: 1 }), 1, 2, 24, 71, 1.85, [22, 72, 1.6]],
  ['cafe-family', null, V({ coders: 3 }), 1, 2, 14, 81, 1.05, [15, 80, 1.0]],
  ['cafe-family', null, V({ coders: 6 }), 2, 3, 9, 84, 1.31, [10, 82, 1.2]],
  ['cafe-family', null, V({ coders: 12 }), 1, 2, 8, 76, 1.98, [7, 79, 1.7]],
  ['cafe-family', null, V({ coders: 6, policy: 'phases' }), 1, 2, 12, 83, 1.22, [12, 81, 1.2]],
  ['cafe-family', null, V({ coders: 6, policy: 'ffa', claims: false }), 1, 2, 10, 68, 1.5, [9, 70, 1.4]],
  ['cafe-family', null, V({ coders: 6, reviewers: 3, reviewStyle: 'adversarial' }), 2, 3, 11, 89, 1.74, [11, 86, 1.6]],
  ['port-ts', 'opus-alone', V({ planner: 'none', coders: 1, coderModel: 'opus', reviewers: 0, policy: 'ffa', claims: false, dedupe: false, trainMax: 1 }), 1, 2, 22, 88, 0.7, [20, 85, 0.7]],
  ['port-ts', null, V({ coders: 6, policy: 'stacking' }), 1, 2, 9, 82, 1.1, [8, 84, 1.0]],
  ['port-ts', null, V({ coders: 6 }), 1, 2, 8, 74, 1.0, [8, 80, 1.0]],
];
const lines = [];
for (const [scenario, baseline, variant, stage, seeds, min, q, usd, [pm, pq, pu]] of SETUPS) {
  const vk = key(baseline, variant);
  for (let seed = 1; seed <= seeds; seed++) {
    const j = () => 0.85 + rnd() * 0.3;
    const wallS = Math.round(min * 60 * j()), score = Math.max(0, Math.min(100, Math.round(q + (rnd() - 0.5) * 8)));
    const askAt = T0 + lines.length * 40 * 60e3, id = `lab-${scenario}-r${seed}-${vk.replace(/[^a-z0-9]/g, '').slice(-4)}${lines.length}`;
    const tasks = baseline === 'opus-alone' ? 1 : Math.min(14, variant.coders * 2 + 1);
    const hiddenTotal = scenario === 'cafe-family' ? 12 : 30;
    lines.push({
      v: 1, mock: true, id, ts: askAt + wallS * 1000 + 60e3, stage, scenario, scenarioCommit: 'mock', promptVersion: `${scenario}@1`, scenarioVersion: '1', seed, baseline, variantKey: vk, variant,
      predicted: { landed: tasks, wallS: pm * 60, apiUsdStd: pu * 10, quality: pq, simVersion: 'mock' },
      status: 'done',
      timings: { askAt, planAt: askAt + 40e3, firstLandAt: askAt + wallS * 400, lastLandAt: askAt + wallS * 1000, wallS, medianAskToLandS: Math.round(wallS * 0.45) },
      counts: { tasksPlanned: tasks, tasksLanded: tasks - (rnd() < 0.2 ? 1 : 0), dupIntents: variant.dedupe ? 0 : Math.round(rnd() * 2), conflicts: baseline === 'opus-alone' ? 0 : Math.round(variant.coders * rnd() * 1.5),
        replaysHandler: variant.policy === 'intent' ? Math.round(variant.coders * 0.6) : 0, replaysLlm: variant.policy === 'intent' && rnd() < 0.4 ? 1 : 0, leads: 0,
        bounces: baseline === 'github' ? 5 + Math.round(rnd() * 4) : Math.round(rnd() * 2), reviews: tasks * variant.reviewers, reviewRejects: Math.round(rnd() * variant.reviewers), breaksOnMain: variant.policy === 'ffa' ? 2 : 0, humanInterventions: 0 },
      tasks: [],
      cost: { usdReal: +(wallS / 3600 * 0.09 * Math.max(1, variant.coders / 3)).toFixed(3), apiUsdStd: +(usd * 10 * j()).toFixed(2), apiUsdHigh: +(usd * 16).toFixed(2), byRole: {} },
      quality: { scorer: '1', score, hiddenPass: Math.round(hiddenTotal * score / 100), hiddenTotal, failed: [], build: true, typecheck: score > 60, ownTests: score > 70, judgeScore: Math.round(score / 10), judgeModel: 'sonnet', notes: '' },
      links: { replay: '/p/eyal/corner-cafe/work?replay=4', app: 'https://corner-cafe--eyal.ttyview.dev/', repo: '/p/eyal/corner-cafe' },
      notes: 'MOCK: invented numbers to build the page.',
    });
  }
}
writeFileSync(new URL('../../public/lab/runs.mock.jsonl', import.meta.url), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
const stages = [
  { v: 1, mock: true, stage: 0, at: T0 - 3600e3, runs: 2304, setups: 2304, kept: 6, usdReal: 0, quotaPctAccount: 0, notes: 'Simulation only: every combination, no model calls.' },
  { v: 1, mock: true, stage: 1, at: T0 + 10 * 3600e3, runs: 20, setups: 9, kept: 3, usdReal: 0.62, quotaPctAccount: 4.1, notes: 'Haiku coders, two repetitions each.' },
  { v: 1, mock: true, stage: 2, at: T0 + 20 * 3600e3, runs: 6, setups: 2, kept: 1, usdReal: 0.48, quotaPctAccount: 3.2, notes: 'Three repetitions.' },
];
writeFileSync(new URL('../../public/lab/stages.mock.jsonl', import.meta.url), stages.map((l) => JSON.stringify(l)).join('\n') + '\n');
console.log(`wrote ${lines.length} mock runs, ${stages.length} stages`);
