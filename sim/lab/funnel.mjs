// Variants lab funnel: which variants advance. Pure functions over predictions (stage 0) and,
// later, over real runs (stage 1 -> 2), so the rules are written down once.
//
// Stage 0 -> 1 (PLAN.md: "keep the top ~6"; stage 1 = Haiku coders, small scenario, 2 repetitions):
//   1. Robust only: a variant whose worst seed scores below MIN_Q on any scenario is out.
//   2. The frontier: no other variant is at least as fast, as cheap and as good, and better on one.
//      Time and cost are relative to each scenario's median, so scenarios weigh the same.
//   3. Stage-1 pool = the frontier among Haiku-coder variants (stage 1 runs Haiku coders).
//   4. Picks, in order, skipping repeats: fastest, cheapest, best quality, best balance (each of
//      time/cost/quality as a share of the pool's range), then the best of each landing policy
//      not picked yet, until N. At most 2 per policy: the policy is the lab's main question.
//   Baselines (opus-alone, github) always run on top of the picks.
// Stage 1 -> 2 (real runs, decided by funnelReal below): keep the top 3; a variant only beats
//   another if it is better beyond both runs' spread on at least one axis and not worse beyond
//   it on another. Never on one run. Ask the manager before stage 2.

export const MIN_Q = 70;
export const QUALITY_TIE = 4; // quality points: smaller differences are ties (judge noise ~2 per run, qb5)

const agg = (r, med) => {
  const n = r.per.length;
  return {
    wall: r.per.reduce((s, p, i) => s + p.wallS / med[i].wallS, 0) / n,
    usd: r.per.reduce((s, p, i) => s + p.usd / med[i].usd, 0) / n,
    q: r.per.reduce((s, p) => s + p.q, 0) / n,
    qMin: Math.min(...r.per.map((p) => p.qMin)),
  };
};
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const dominates = (a, b) => a.wall <= b.wall && a.usd <= b.usd && a.q >= b.q && (a.wall < b.wall || a.usd < b.usd || a.q > b.q);

export function frontier(items) {
  // items: [{a: {wall, usd, q}}]; O(n log n)-ish: sort by wall, sweep keeping non-dominated.
  const sorted = [...items].sort((x, y) => x.a.wall - y.a.wall || x.a.usd - y.a.usd || y.a.q - x.a.q);
  const front = [];
  for (const it of sorted) if (!front.some((f) => dominates(f.a, it.a))) front.push(it);
  return front.filter((f) => !front.some((g) => g !== f && dominates(g.a, f.a)));
}

export function pickStage1(rows, baselines, scen, { n = 6, stage1Scenario = 'cafe-family', repetitions = 2, budgetUsd = null, baselineRepetitions = repetitions } = {}) {
  const si = Math.max(0, scen.findIndex((s) => s.id === stage1Scenario));
  let spent = baselines.reduce((a, b) => a + b.per[si].usd * baselineRepetitions, 0);
  const med = scen.map((_, i) => ({ wallS: median(rows.map((r) => r.per[i].wallS)), usd: median(rows.map((r) => r.per[i].usd)) }));
  const items = rows.map((r) => ({ ...r, a: agg(r, med) })).filter((r) => r.a.qMin >= MIN_Q);
  const front = frontier(items);
  const pool = frontier(items.filter((r) => r.v.coderModel === 'haiku'));
  const range = (k) => { const xs = pool.map((r) => r.a[k]); return [Math.min(...xs), Math.max(...xs)]; };
  const [w0, w1] = range('wall'), [u0, u1] = range('usd'), [q0, q1] = range('q');
  const norm = (r) => ((r.a.wall - w0) / (w1 - w0 || 1)) + ((r.a.usd - u0) / (u1 - u0 || 1)) + ((q1 - r.a.q) / (q1 - q0 || 1));
  const picks = [], perPolicy = {};
  const add = (r, why) => {
    if (!r || picks.some((p) => p.key === r.key) || (perPolicy[r.v.policy] || 0) >= 2 || picks.length >= n) return;
    // Same predictions as a pick already in = the sim cannot tell them apart (e.g. leads with
    // claims and 3 coders never has a conflict for its lead): running both teaches nothing.
    const sig = JSON.stringify(r.per.map((p) => [p.wallS, p.usd, p.q]));
    if (picks.some((p) => JSON.stringify(p.per.map((x) => [x.wallS, x.usd, x.q])) === sig)) return;
    // Budget (API-equivalent $ for the stage-1 scenario x repetitions): skip what does not fit.
    if (budgetUsd != null && spent + r.per[si].usd * repetitions > budgetUsd) return;
    spent += r.per[si].usd * repetitions;
    perPolicy[r.v.policy] = (perPolicy[r.v.policy] || 0) + 1;
    picks.push({ key: r.key, why, variant: r.v, per: r.per, agg: { wallRel: +r.a.wall.toFixed(3), usdRel: +r.a.usd.toFixed(3), quality: +r.a.q.toFixed(1), worstQ: r.a.qMin } });
  };
  const by = (f) => [...pool].sort(f);
  add(by((a, b) => a.a.wall - b.a.wall)[0], 'fastest');
  add(by((a, b) => a.a.usd - b.a.usd)[0], 'cheapest');
  add(by((a, b) => b.a.q - a.a.q || a.a.wall - b.a.wall)[0], 'best quality');
  add(by((a, b) => norm(a) - norm(b))[0], 'best balance');
  for (const pol of ['intent', 'phases', 'stacking', 'leads', 'ffa', 'github']) {
    if (picks.length >= n) break;
    if (picks.some((p) => p.variant.policy === pol)) continue;
    add(by((a, b) => norm(a) - norm(b)).find((r) => r.v.policy === pol), `best ${pol}`);
  }
  for (const r of by((a, b) => norm(a) - norm(b))) add(r, 'next best balance');
  // Stage 1 estimate: picks x repetitions + baselines x baselineRepetitions, on the small scenario.
  const pickUsd = picks.reduce((a, p) => a + p.per[si].usd, 0) * repetitions;
  const baseUsd = baselines.reduce((a, b) => a + b.per[si].usd, 0) * baselineRepetitions;
  return {
    front: front.map((r) => ({ key: r.key, a: { wallRel: +r.a.wall.toFixed(3), usdRel: +r.a.usd.toFixed(3), quality: +r.a.q.toFixed(1) } })),
    picks,
    stage1: { scenario: scen[si].id, repetitions, baselineRepetitions, runs: picks.length * repetitions + baselines.length * baselineRepetitions, apiUsdStd: +(pickUsd + baseUsd).toFixed(1), picksUsd: +pickUsd.toFixed(1), baselinesUsd: +baseUsd.toFixed(1), budgetUsd, variants: [...picks.map((p) => p.key), ...baselines.map((b) => b.key)] },
    rules: { minQuality: MIN_Q, robust: 'worst seed on every scenario', frontier: 'time and cost relative to each scenario median, quality 0-100', pool: 'Haiku coders (stage 1)', perPolicyMax: 2, identicalPredictions: 'skipped', repetitions, budgetUsd },
  };
}

// Stage 1 -> 2 from real runs (public/lab/runs.jsonl lines): group by variantKey, compare on
// wall time, API-equivalent cost and quality.score with each group's min-max as its spread.
export function funnelReal(lines, { keep = 3, stage = 1 } = {}) {
  const groups = new Map();
  for (const l of lines) {
    if (l.stage !== stage || l.status !== 'done') continue;
    const k = l.variantKey || l.baseline;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(l);
  }
  const stats = [...groups].map(([key, ls]) => {
    const vals = (f) => ls.map(f).filter((x) => x != null);
    const s = (xs) => ({ mean: xs.reduce((a, b) => a + b, 0) / (xs.length || 1), min: Math.min(...xs), max: Math.max(...xs), n: xs.length });
    return { key, baseline: ls[0].baseline, n: ls.length, wall: s(vals((l) => l.timings?.wallS)), usd: s(vals((l) => l.cost?.apiUsdStd)), q: s(vals((l) => l.quality?.score)) };
  });
  // a beats b on an axis only if their ranges do not overlap (lower is better for wall/usd).
  // Quality also needs a gap of QUALITY_TIE points: the judge alone moves a run ~2 points (qb5).
  const better = (a, b, k, low) => (low ? a[k].max < b[k].min : a[k].min > b[k].max && (k !== 'q' || a[k].mean - b[k].mean >= QUALITY_TIE));
  const beats = (a, b) => {
    const wins = [better(a, b, 'wall', true), better(a, b, 'usd', true), better(a, b, 'q', false)].filter(Boolean).length;
    const losses = [better(b, a, 'wall', true), better(b, a, 'usd', true), better(b, a, 'q', false)].filter(Boolean).length;
    return wins > 0 && losses === 0;
  };
  const eligible = stats.filter((s) => !s.baseline && s.n >= 2);
  const beaten = new Set(eligible.filter((s) => eligible.some((o) => o !== s && beats(o, s))).map((s) => s.key));
  const unbeaten = eligible.filter((s) => !beaten.has(s.key)).sort((a, b) => b.q.mean - a.q.mean || a.wall.mean - b.wall.mean);
  return { stats, advance: unbeaten.slice(0, keep).map((s) => s.key), tooFew: stats.filter((s) => s.n < 2).map((s) => s.key), note: unbeaten.length > keep ? `${unbeaten.length} unbeaten; kept the ${keep} with the best quality, then time` : null };
}
