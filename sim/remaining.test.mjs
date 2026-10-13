// X2: remainingTime / remainingS (public/lab/predict.js). node --test sim/remaining.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { remainingTime, remainingS } from '../public/lab/predict.js';

const est = { wallS: [720, 1980] };

test('before the first landing: the estimate minus the time gone', () => {
  const r = remainingTime({ parts: 9, landed: 0, elapsedS: 300, estimate: est });
  assert.equal(r.phase, 'starting');
  assert.deepEqual(r.leftS, [420, 1680]);
  assert.match(r.text, /^about \d+ min left \(7-28\)$/);
});

test('past the estimate with nothing landed: says so, never a negative time', () => {
  const r = remainingTime({ parts: 9, landed: 0, elapsedS: 2400, estimate: est });
  assert.equal(r.phase, 'over');
  assert.ok(r.leftS[0] > 0 && r.leftS[1] >= r.leftS[0]);
  assert.match(r.text, /longer than estimated/);
});

test('the range narrows as parts land', () => {
  const at = (landed, t) => remainingTime({ parts: 40, landed, elapsedS: t, estimate: { wallS: [1380, 3780] }, firstLandS: 400 });
  const w = (r) => r.leftS[1] - r.leftS[0];   // minutes wide, as the person reads it
  const early = at(5, 600), mid = at(20, 1300), late = at(35, 2000);
  assert.ok(w(early) > w(mid) && w(mid) > w(late), `${w(early)} > ${w(mid)} > ${w(late)}`);
  assert.ok(early.midS > mid.midS && mid.midS > late.midS);
});

test('slow landings push the time left up', () => {
  const base = { parts: 10, landed: 5, estimate: { wallS: [600, 1600] }, firstLandS: 300 };
  assert.ok(remainingTime({ ...base, elapsedS: 1500 }).midS > remainingTime({ ...base, elapsedS: 600 }).midS);
});

test('done, and bad input', () => {
  assert.equal(remainingTime({ parts: 3, landed: 3, elapsedS: 900, estimate: est }).text, 'done');
  assert.equal(remainingTime({ parts: 3, landed: 9, elapsedS: 900, estimate: est }).phase, 'done', 'landed past parts');
  assert.equal(remainingTime({ parts: 0, landed: 0, elapsedS: 10, estimate: est }).parts, 1, 'no part count: one');
  assert.equal(remainingTime({ parts: 5, elapsedS: 10 }).text, 'starting', 'no estimate yet');
});

test('remainingS (qb7): ms timestamps -> [lo, hi] s, null when it cannot say', () => {
  const startedAt = 1_000_000;
  assert.deepEqual(remainingS({ estimate: { ...est, startedAt }, parts: 9, landed: 0, now: startedAt + 300_000 }), [420, 1680]);
  const r = remainingS({ estimate: { ...est, startedAt }, parts: 9, landed: 3, firstLandedAt: startedAt + 748_000, now: startedAt + 900_000 });
  assert.ok(Array.isArray(r) && r[0] > 0 && r[1] > r[0]);
  assert.equal(remainingS({ estimate: { ...est, startedAt }, parts: 9, landed: 9, now: startedAt + 2_000_000 }), null);
  assert.equal(remainingS({ estimate: null, parts: 9, landed: 0 }), null);
});

test('backtest on real builds: after the first landing the truth falls in the range >= 70% of the time', () => {
  const { builds } = JSON.parse(fs.readFileSync(new URL('./remaining-lands.json', import.meta.url)));
  for (const b of builds.filter((x) => x.parts > 1)) {
    const end = b.lands[b.parts - 1]; let hit = 0, n = 0;
    for (let t = b.lands[0]; t < end; t += 15) {
      const landed = b.lands.filter((x) => x <= t).length;
      const r = remainingTime({ parts: b.parts, landed, elapsedS: t, estimate: { wallS: b.estimate }, firstLandS: b.lands[0] });
      n++; if (end - t >= r.leftS[0] && end - t <= r.leftS[1]) hit++;
    }
    assert.ok(hit / n >= 0.7, `${b.slug}: ${hit}/${n}`);
  }
});
