#!/usr/bin/env node
// Lab result charts (owner qb5), straight from public/lab/runs.jsonl.
//
//   node docs/lab/charts/build.mjs [--png]
//
// Each run is a dot; the median of a variant is a bar across its dots. A run with a known
// platform stall (timings.stallS) is plotted without the stall, and says so.
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
const minutes = (r) => (r.timings.wallS - (r.timings.stallS || 0)) / 60;
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
    const vals = rows.flatMap((r) => r.runs.map(pn.v)), max = pn.max ?? Math.max(...vals) * 1.08, min = pn.min ?? 0;
    const tw = L_ ? pw - 140 : pw - 290, tx = L_ ? px : px + 150;
    const X = (v) => tx + ((v - min) / (max - min)) * tw;
    out += text(px, py + 28, pn.title, { size: f.txt - 8, weight: 600 });
    rows.forEach((r, i) => {
      const y = py + (L_ ? 70 : 60) + i * (L_ ? 100 : 70), cy = y + 15;
      if (L_ && k === 0) out += text(box.x, cy + 12, r.label, { size: f.txt - 8, c: r.hi ? 'fg' : 'dim', weight: r.hi ? 600 : 400 });
      if (!L_) out += text(px, cy + 11, r.short, { size: f.txt - 14, c: r.hi ? 'fg' : 'dim', weight: r.hi ? 600 : 400 });
      out += track(tx, y, tw, 30);
      const med = median(r.runs.map(pn.v));
      out += `<rect x="${X(med) - 2}" y="${y - 8}" width="4" height="46" fill="var(--fg)"><title>${r.label}, median ${pn.fmt(med)}</title></rect>`;
      // runs with the same value sit on top of each other: spread them vertically so each shows
      const seen = new Map();
      for (const run of r.runs) {
        const x = X(pn.v(run)), k = Math.round(x / 6), same = r.runs.filter((o) => Math.round(X(pn.v(o)) / 6) === k).length, i = seen.get(k) || 0;
        seen.set(k, i + 1);
        out += dot(x, cy + (i - (same - 1) / 2) * 14, r.hi, run.timings.stallS && pn.stallAware);
      }
      out += text(tx + tw + 14, cy + 12, pn.fmt(med), { size: L_ ? f.val - 8 : f.txt - 12, weight: 600, c: r.hi ? 'fg' : 'dim' });
    });
  });
  return out;
}

// 1. bakery: one Opus agent vs the swarm
{
  const bake = RUNS.filter((r) => r.scenario === 'bakery' && r.status === 'done');
  const opus = bake.filter((r) => baseline(r) === 'opus-alone');
  const swarm = bake.filter((r) => !baseline(r) && r.variant.planner === 'opus' && r.variant.coders === 12);
  const m = (rs, f) => median(rs.map(f));
  const speed = m(swarm, minutes) / m(opus, minutes), qGap = m(opus, (r) => r.quality.score) - m(swarm, (r) => r.quality.score);
  const cheaper = 1 - m(swarm, cost) / m(opus, cost);
  const stalled = swarm.filter((r) => r.timings.stallS);
  C.push({ name: 'lab-bakery',
    title: { L: [`Bakery: one Opus agent was ${speed.toFixed(1)}x faster and ${Math.round(qGap)} points better;`, `the swarm cost ${Math.round(100 * cheaper)}% less`],
      P: [`Bakery: one Opus agent`, `${speed.toFixed(1)}x faster, ${Math.round(qGap)} points`, `better; swarm ${Math.round(100 * cheaper)}% cheaper`] },
    sub: { L: [`${opus.length} runs each: a dot per run, a line at the median. The swarm is 16 agents`],
      P: [`${opus.length} runs each, dot = a run,`, 'line = the median'] },
    source: `runs.jsonl. Swarm: Opus planner, 12 Haiku coders, 3 reviewers${stalled.length ? `. Hollow: ${Math.round(stalled[0].timings.stallS / 60)}-min platform stall removed` : ''}`,
    dataSource: 'public/lab/runs.jsonl, scenario bakery, status done',
    table: [['run', 'variant', 'minutes', 'platform stall', 'quality', 'API-equivalent $'],
      ...[...opus, ...swarm].map((r) => [r.id, baseline(r) ? 'one Opus agent' : 'swarm', (r.timings.wallS / 60).toFixed(1), r.timings.stallS ? `${(r.timings.stallS / 60).toFixed(1)} min` : '', String(r.quality.score), cost(r).toFixed(2)])],
    body: (f, box) => runPanels(f, { ...box, h: Math.min(box.h, L(f) ? 260 : 700) }, [
      { label: 'One Opus agent', short: 'Opus', runs: opus, hi: true },
      { label: 'Swarm (16 agents)', short: 'Swarm', runs: swarm },
    ], [
      { title: 'Minutes to finish', v: minutes, fmt: (v) => `${v.toFixed(0)} min`, stallAware: true },
      { title: 'Quality (0-100)', v: (r) => r.quality.score, fmt: (v) => String(Math.round(v)), min: 80, max: 100 },
      { title: 'Cost, API-equivalent', v: cost, fmt: (v) => `$${v.toFixed(2)}` },
    ]),
  });
}

writeCharts({ dir: DIR, charts: C, png: process.argv.includes('--png'),
  title: 'Lab results', heading: 'Variants lab: results',
  description: 'qodebase variants lab: one agent vs many, measured on real jobs (time, quality, cost).',
  intro: 'Real runs from public/lab/runs.jsonl: each dot is one run; quality is the lab score (hidden tests, floor, a Sonnet judge).',
  footer: 'Built by docs/lab/charts/build.mjs from public/lab/runs.jsonl.' });
