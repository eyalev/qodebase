#!/usr/bin/env node
// Lab result charts (owner qb5), straight from public/lab/runs.jsonl.
//
//   node docs/lab/charts/build.mjs [--png]
//
// Each run is a dot; the median of a variant is a bar across its dots. A run with a known
// platform stall (timings.stallS) is left out of TIME entirely (manager's rule, 2026-10-08:
// never subtract a stall), and still counts for quality and cost.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { text, track, writeCharts } from '../../../scripts/charts/kit.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const RUNS = readFileSync(join(DIR, '../../../public/lab/runs.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const L = (f) => f.tag === '1920x1080';
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const baseline = (r) => r.baseline ?? r.variant?.baseline ?? null;
const cost = (r) => r.cost?.apiUsdStd ?? r.cost?.usdApiEquiv;
const minutes = (r) => r.timings.wallS / 60;
const stalled = (r) => Boolean(r.timings.stallS);
const C = [];

// Dots per run in panels (one scale each), rows = variants. rows: [{label, short, runs, hi}],
// panels: [{title, v(run), fmt, max?}]
function runPanels(f, box, rows, panels) {
  let out = '';
  const dot = (x, y, hi, hollow) => `<circle cx="${x}" cy="${y}" r="11" fill="${hollow ? 'var(--bg)' : `var(--${hi ? 'acc' : 'dim'})`}" stroke="var(--${hollow ? (hi ? 'acc' : 'dim') : 'bg'})" stroke-width="3"/>`;
  const L_ = L(f);
  const labelW = L_ ? 360 : 0, gap = L_ ? 50 : 0;
  const pw = L_ ? (box.w - labelW - gap * (panels.length - 1)) / panels.length : box.w;
  const ph = L_ ? box.h : (box.h - 20 * (panels.length - 1)) / panels.length;
  panels.forEach((pn, k) => {
    const px = L_ ? box.x + labelW + k * (pw + gap) : box.x, py = L_ ? box.y : box.y + k * (ph + 20);
    const runsOf = (r) => r.runs.filter((x) => !pn.skip || !pn.skip(x));
    const vals = rows.flatMap((r) => runsOf(r).map(pn.v)), max = pn.max ?? Math.max(...vals) * 1.08, min = pn.min ?? 0;
    const tw = L_ ? pw - 140 : pw - 290, tx = L_ ? px : px + 150;
    const X = (v) => tx + ((v - min) / (max - min)) * tw;
    out += text(px, py + 28, pn.title, { size: f.txt - 8, weight: 600 });
    rows.forEach((r, i) => {
      const y = py + (L_ ? 70 : 60) + i * (L_ ? 100 : 70), cy = y + 15;
      if (L_ && k === 0) out += text(box.x, cy + 12, r.label, { size: f.txt - 8, c: r.hi ? 'fg' : 'dim', weight: r.hi ? 600 : 400 });
      if (!L_) out += text(px, cy + 11, r.short, { size: f.txt - 14, c: r.hi ? 'fg' : 'dim', weight: r.hi ? 600 : 400 });
      out += track(tx, y, tw, 30);
      const med = median(runsOf(r).map(pn.v));
      out += `<rect x="${X(med) - 2}" y="${y - 8}" width="4" height="46" fill="var(--fg)"><title>${r.label}, median ${pn.fmt(med)}</title></rect>`;
      // runs with the same value sit on top of each other: spread them vertically so each shows
      const seen = new Map();
      for (const run of runsOf(r)) {
        const x = X(pn.v(run)), k = Math.round(x / 6), same = runsOf(r).filter((o) => Math.round(X(pn.v(o)) / 6) === k).length, i = seen.get(k) || 0;
        seen.set(k, i + 1);
        out += dot(x, cy + (i - (same - 1) / 2) * 14, r.hi, false);
      }
      out += text(tx + tw + 14, cy + 12, pn.fmt(med), { size: L_ ? f.val - 8 : f.txt - 12, weight: 600, c: r.hi ? 'fg' : 'dim' });
    });
  });
  return out;
}

// Greedy word wrap for the phone headline (about 28 characters a line at 62 px).
const wrap = (t, n) => t.split(' ').reduce((ls, w) => { const l = ls.at(-1); if (l && (l + ' ' + w).length <= n) ls[ls.length - 1] = l + ' ' + w; else ls.push(w); return ls; }, []);

// Headline from the numbers: who was faster, by how much, quality and cost, said plainly
// whichever way they come out.
// Quality in a headline is said in hidden tests passed, never as a score gap: the judge's
// part moves ~2 points between calls on the same code (manager, 2026-10-08), so equal hidden
// passes are a tie whatever the judge said.
function headline(title, speed, hiddenGap, hiddenTotal, cheaper) {
  const n = Math.round(Math.abs(hiddenGap));
  const q = n === 0 ? `the same quality: both passed ${hiddenTotal.passed} of ${hiddenTotal.of} hidden tests`
    : `${hiddenGap > 0 ? 'Opus' : 'the swarm'} passed ${n} more hidden test${n > 1 ? 's' : ''}`;
  const sp = (x) => `${x.toFixed(1)}x faster`, pc = `${Math.round(100 * Math.abs(cheaper))}%`;
  // under 15% apart is not a speed difference worth a headline at these run counts
  const c = Math.abs(speed - 1) < 0.15 ? `the swarm was about as fast and cost ${pc} ${cheaper >= 0 ? 'less' : 'more'}`
    : speed < 1 ? `the swarm was ${sp(1 / speed)} and cost ${pc} ${cheaper >= 0 ? 'less' : 'more'}`
    : `one Opus agent was ${sp(speed)}; the swarm cost ${pc} ${cheaper >= 0 ? 'less' : 'more'}`;
  return { L: wrap(`${title}: ${c}; ${q}`, 50), P: wrap(`${title}: ${c}; ${q}`, 31) };
}

// One Opus agent vs the swarm on a scenario; skipped until both have a finished run
function versus(scenario, name, title) {
  const bake = RUNS.filter((r) => r.scenario === scenario && r.status === 'done');
  const opus = bake.filter((r) => baseline(r) === 'opus-alone');
  const swarm = bake.filter((r) => !baseline(r) && r.variant.planner === 'opus' && r.variant.coders === 12);
  const m = (rs, f) => median(rs.map(f));
  const timed = (rs) => rs.filter((r) => !stalled(r));
  const speed = m(timed(swarm), minutes) / m(timed(opus), minutes), hiddenGap = m(opus, (r) => r.quality.hiddenPass) - m(swarm, (r) => r.quality.hiddenPass);
  const hiddenTotal = { passed: m(opus, (r) => r.quality.hiddenPass), of: opus[0].quality.hiddenTotal };
  const cheaper = 1 - m(swarm, cost) / m(opus, cost);
  if (!opus.length || !swarm.length) return;
  const leftOut = [...opus, ...swarm].filter(stalled);
  const interim = opus.length < 2 || swarm.length < 2 ? 'Interim, ' : '';
  const runsTxt0 = opus.length === swarm.length ? `${opus.length} run${opus.length > 1 ? 's' : ''} each` : `${opus.length} vs ${swarm.length} runs`;
  const tOpus = timed(opus).length, tSwarm = timed(swarm).length;
  const timeNote = [tOpus !== opus.length ? `Opus time from its ${tOpus} clean run${tOpus > 1 ? 's' : ''}` : '', tSwarm !== swarm.length ? `swarm time from its ${tSwarm} clean run${tSwarm > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ');
  const runsTxt = interim + runsTxt0 + (timeNote ? `; ${timeNote}` : '');
  C.push({ name,
    title: headline(title, speed, hiddenGap, hiddenTotal, cheaper),
    sub: { L: [`${runsTxt}. Dot = run, line = median`],
      P: [`${runsTxt}, dot = a run,`, 'line = the median'] },
    source: `runs.jsonl. Swarm: Opus planner, 12 Haiku coders, 3 reviewers${leftOut.length ? `. ${leftOut.length} run${leftOut.length > 1 ? 's' : ''} with a platform stall left out of time` : ''}`,
    dataSource: `public/lab/runs.jsonl, scenario ${scenario}, status done`,
    table: [['run', 'variant', 'minutes', 'platform stall', 'hidden tests', 'judge', 'quality', 'API-equivalent $'],
      ...[...opus, ...swarm].map((r) => [r.id, baseline(r) ? 'one Opus agent' : 'swarm', (r.timings.wallS / 60).toFixed(1), r.timings.stallS ? 'yes: left out of time' : '', `${r.quality.hiddenPass}/${r.quality.hiddenTotal}`, String(r.quality.judgeScore), String(r.quality.score), cost(r).toFixed(2)])],
    body: (f, box) => runPanels(f, { ...box, h: Math.min(box.h, L(f) ? 260 : 700) }, [
      { label: 'One Opus agent', short: 'Opus', runs: opus, hi: true },
      { label: 'Swarm (16 agents)', short: 'Swarm', runs: swarm },
    ], [
      { title: 'Minutes to finish', v: minutes, fmt: (v) => `${v.toFixed(0)} min`, skip: stalled },
      { title: 'Quality (judge ±2)', v: (r) => r.quality.score, fmt: (v) => String(Math.round(v)), min: 80, max: 100 },
      { title: 'Cost, API-equivalent', v: cost, fmt: (v) => `$${v.toFixed(2)}` },
    ]),
  });
}


versus('bakery', 'lab-bakery', 'Bakery');
versus('club', 'lab-club', 'Club');

writeCharts({ dir: DIR, charts: C, png: process.argv.includes('--png'),
  title: 'Lab results', heading: 'Variants lab: results',
  description: 'qodebase variants lab: one agent vs many, measured on real jobs (time, quality, cost).',
  intro: 'Real runs from public/lab/runs.jsonl: each dot is one run; quality is the lab score (hidden tests, floor, a Sonnet judge).',
  footer: 'Built by docs/lab/charts/build.mjs from public/lab/runs.jsonl.' });
