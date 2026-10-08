// The lab's one quality number (docs/lab/PLAN.md, docs/lab/runs-schema.md), 0-100.
// Shared by the scorer (scripts/lab/score.mjs), the sim (predict.js) and the page.
//   60 x hidden acceptance tests passed / total
// + 20 x the floor: build, typecheck and the project's own tests, a third each
// + 20 x judge score / 10
// Without a judge score the first two (out of 80) are scaled to 100.
export function qualityScore(q) {
  if (!q) return null;
  const hidden = q.hiddenTotal ? q.hiddenPass / q.hiddenTotal : 0;
  const floor = [q.build, q.typecheck, q.ownTests].filter(Boolean).length / 3;
  const base = 60 * hidden + 20 * floor;
  const s = typeof q.judgeScore === 'number' ? base + 2 * q.judgeScore : base * 100 / 80;
  return Math.round(s * 10) / 10;
}
