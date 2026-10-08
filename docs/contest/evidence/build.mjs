#!/usr/bin/env node
// The contest video's evidence charts, from data.json only.
//
//   node docs/contest/evidence/build.mjs          # SVGs + index.html
//   node docs/contest/evidence/build.mjs --png    # also the PNGs (headless Chrome)
//
// Per chart: <name>-1920x1080-{dark,light}.{svg,png} (video slides: the bottom
// 200 px stay empty for cut.py's caption bar) and <name>-1080x1350-{dark,light}
// (portrait, phone). index.html shows them all, light + dark, with tables.
// Tokens: video/contest/slides.html and DESIGN.md; conflict red adjusted
// so it separates from --busy (dataviz validator, see README.md).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FMT, esc, n, text, lines, rect, track, hbars, tiles, split, writeCharts } from '../../../scripts/charts/kit.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const D = JSON.parse(readFileSync(join(DIR, 'data.json'), 'utf8'));

const C = [];

// 1. 100k agents, fast sim
{
  const d = D.fastsim, base = d.landedPerHour.find(r => r[0] === d.baseline)[1], win = d.landedPerHour.find(r => r[0] === d.winner)[1];
  const x = (win / base).toFixed(1);
  C.push({ name: 'fastsim-100k', data: d,
    title: { L: [`At 100,000 agents, landing by intent`, `moved ${x}× more changes than agent review`], P: ['At 100,000 agents,', 'landing by intent moved', `${x}× more changes`, 'than agent review'] },
    sub: { L: ['Changes landed per hour by 100,000 simulated agents'], P: ['Changes landed per hour,', '100,000 simulated agents'] },
    source: 'sim/README.md, node sim/cli.mjs --preset k100',
    table: [['way of landing', 'landed per hour'], ...d.landedPerHour.map(([a, b]) => [a, n(b)])],
    body: (f, box) => hbars(f, box, d.landedPerHour.map(([label, v]) => ({ label, v, hi: label === d.winner, valueText: label === d.winner && f.tag === '1920x1080' ? `${n(v)}  (${x}×)` : n(v) })), { labelW: 540, valW: 330 }),
  });
}
// 2. real code, 500 agents
{
  const d = D.realcode, base = d.rows.find(r => r[0] === d.baseline)[1], win = d.rows.find(r => r[0] === d.winner);
  const x = (win[1] / base).toFixed(1);
  C.push({ name: 'realcode-500', data: d,
    title: { L: [`Real code, 500 agents: land by intent`, `landed ${x}× more than review-then-merge`], P: ['Real code, 500 agents:', 'land by intent landed', `${x}× more than`, 'review-then-merge'] },
    sub: { L: ['Changes landed per hour: 500 agents, real git, real tests'], P: ['Changes landed per hour:', '500 agents, real git, real tests'] },
    source: 'public/sim/runs/*-500.json, node sim/real/run.mjs --all --agents 500',
    table: [['way of landing', 'landed per hour', 'git conflicts', 'times main broke'], ...d.rows.map(r => [r[0], n(r[1]), n(r[2]), n(r[3])])],
    body: (f, box) => hbars(f, { ...box, h: Math.min(box.h, f.tag === '1920x1080' ? 420 : 640) }, d.rows.map(([label, v]) => ({ label, v, hi: label === d.winner, valueText: label === d.winner ? `${n(v)}  (${x}×)` : n(v) })), { labelW: 560, valW: 300 }),
  });
}
// 3. Hono real PRs
{
  const d = D.hono, pct = v => Math.round(100 * v / d.prs);
  const last = d.waves.at(-1), share = pct(last[1]);
  const half = share >= 45 && share <= 55 ? 'half' : share + '%', none = d.waves.every(w => w[2] === 0) ? 'none' : 'almost none';
  C.push({ name: 'hono-ordering', data: d,
    title: { L: [`With ${last[0]} pull requests open at once,`, `${half} had to wait for another. Git conflicts: ${none}.`],
      P: [`${last[0]} pull requests open`, `at once: ${half} had to wait`, 'for another. Git', `conflicts: ${none}.`] },
    sub: { L: [`Hono's last ${d.prs} pull requests, replayed as if opened at once`], P: [`Hono's last ${d.prs} pull requests,`, 'replayed as if opened at once'] },
    source: 'sim/hono/replay.mjs on github.com/honojs/hono',
    table: [['pull requests open at once', 'needed another to land first', 'git conflicts'], ...d.waves.map(w => [w[0] === 1 ? '1 (history)' : String(w[0]), `${w[1]} (${pct(w[1])}%)`, String(w[2])])],
    body: (f, box) => {
      const L = f.tag === '1920x1080';
      // legend row
      let out = `<rect x="${box.x}" y="${box.y - 10}" width="28" height="28" rx="4" fill="var(--busy)"/>` + text(box.x + 42, box.y + 14, 'needed another to land first', { size: f.txt - 4, c: 'dim' });
      const lx = L ? box.x + 720 : box.x;
      const ly = L ? box.y : box.y + f.txt + 16;
      out += `<rect x="${lx}" y="${ly - 10}" width="28" height="28" rx="4" fill="var(--bad)"/>` + text(lx + 42, ly + 14, 'git conflict', { size: f.txt - 4, c: 'dim' });
      const top = (L ? box.y : ly) + 64;
      out += hbars(f, { x: box.x, y: top, w: box.w, h: Math.min(box.h - (top - box.y), L ? 400 : 620) },
        d.waves.map(w => ({ label: w[0] === 1 ? 'One at a time' : `${w[0]} at once`, v: pct(w[1]), color: 'busy', valueText: `${pct(w[1])}%`, extra: `${w[2]} conflicts`, extraColor: 'bad', hi: w[0] === last[0] })),
        { max: 100, labelW: 330, valW: 470 });
      return out;
    },
  });
}
// 4. Bun swarm, the shape
{
  const d = D.bunSwarm;
  C.push({ name: 'bun-swarm', data: d,
    title: { L: [`Bun's ${d.agents} agents worked mostly on one`, 'shared branch, files split between them'], P: [`Bun's ${d.agents} agents worked`, 'mostly on one shared', 'branch, files split', 'between them'] },
    sub: { L: [`Bun's port from Zig to Rust, written by Claude agents`], P: [`Bun's port from Zig to Rust,`, 'written by Claude agents'] },
    source: 'sim/bun/calibration.json, sim/bun/analyze.mjs',
    table: [['measure', 'value'], ['commits', n(d.commits)], ['agents (Bun blog)', String(d.agents)], ['days', String(d.days)], ['commits straight onto one branch', `${Math.round(d.pctOneBranch)}%`], ['median time between them', `${d.secondsApart} s`]],
    body: (f, box) => tiles(f, { ...box, h: f.tag === '1920x1080' ? 300 : 560 }, [
      { big: n(d.commits), small: ['commits'] }, { big: String(d.days), small: ['days'] },
      { big: `${Math.round(d.pctOneBranch)}%`, small: ['on one branch'], hi: true }, { big: `${d.secondsApart} s`, small: ['between commits'] },
    ], f.tag === '1920x1080' ? 4 : 2),
  });
}
// 5. Bun merges replayed
{
  const d = D.bunMerges, oneIn = Math.round(d.merges / d.conflicted), share = Math.round(100 * d.keptOneSide / d.conflictedFiles);
  C.push({ name: 'bun-merges', data: d,
    title: { L: [`Real agents: 1 merge in ${oneIn} had conflicts;`, `agents wrote merged text for ${Math.round(100 * d.newText / d.conflictedFiles)}% of those files`], P: [`1 merge in ${oneIn} had conflicts;`, 'agents wrote merged text', `for ${Math.round(100 * d.newText / d.conflictedFiles)}% of those files`] },
    sub: { L: [`All ${d.merges} merges of Bun's port, replayed with git and the real files`], P: [`All ${d.merges} merges of Bun's port, replayed`] },
    source: 'sim/bun/calibration.json (merge_replay), sim/bun/replay.mjs',
    table: [['', 'count', 'share'], ['merges, no file changed on both sides', n(d.noSharedFile), `${Math.round(100 * d.noSharedFile / d.merges)}%`], ['merges git combined by itself', n(d.gitMergedClean), `${Math.round(100 * d.gitMergedClean / d.merges)}%`], ['merges with a conflict', n(d.conflicted), `${Math.round(100 * d.conflicted / d.merges)}%`],
      ['conflicted files: agent wrote merged text', n(d.newText), `${Math.round(100 * d.newText / d.conflictedFiles)}%`], ['conflicted files: kept one side whole', n(d.keptOneSide), `${share}%`], ['conflicted files: deleted', n(d.deleted), `${Math.round(100 * d.deleted / d.conflictedFiles)}%`]],
    body: (f, box) => {
      const L = f.tag === '1920x1080', h = L ? 44 : 48, gapY = L ? 244 : 340;
      return split(f, box.x, box.y + 44, box.w, h, [
        { v: d.noSharedFile, c: 'bar', label: L ? ['no shared file'] : ['no shared', 'file'] },
        { v: d.gitMergedClean, c: 'acc', label: L ? ['git merged it'] : ['git merged', 'it'] },
        { v: d.conflicted, c: 'bad', label: ['conflicts'] }], d.merges, `${d.merges} merges`)
      + split(f, box.x, box.y + 44 + gapY, box.w, h, [
        { v: d.newText, c: 'acc', label: L ? ['wrote merged text'] : ['wrote', 'merged text'] },
        { v: d.keptOneSide, c: 'busy', label: L ? ['kept one side'] : ['kept one', 'side'] },
        { v: d.deleted, c: 'bar', label: ['deleted'] }], d.conflictedFiles, `${d.conflictedFiles} conflicted files`);
    },
  });
}
// 6. Cloudflare
{
  const d = D.cloud;
  C.push({ name: 'cloudflare-500', data: d,
    title: { L: [`${d.agents} agents on Cloudflare: git held up,`, 'our single merge queue was the limit'], P: [`${d.agents} agents on Cloudflare:`, 'git held up, our one', 'merge queue was the limit'] },
    sub: { L: [`${d.agents} Durable Objects, each with its own git fork in Artifacts`], P: [`${d.agents} Durable Objects, each with`, 'its own git fork in Artifacts'] },
    source: 'public/sim/runs/cloud-500.json, sim/cloud/README.md',
    table: [['measure', 'value'], ['forks', `${d.forks} (median ${d.forkMedianS} s)`], ['pushes to forks', n(d.pushes)], ['push time', `${d.pushMedianMs} ms median, ${d.pushP90Ms} ms p90`], ['failed pushes', `${d.pushFailed} (${(100 * d.pushFailed / d.pushes).toFixed(1)}%)`], ['merge queue', `~${d.queuePerSecond} landings a second, then overloaded`],
      ...d.landedOverTime.map(([t, v]) => [`landed after ${t} s`, n(v)])],
    body: (f, box) => {
      const L = f.tag === '1920x1080';
      const tilesH = L ? 170 : 340;
      let out = tiles(f, { ...box, h: tilesH }, [
        { big: String(d.forks), small: ['forks'] }, { big: n(d.pushes), small: ['pushes'] },
        { big: `${d.pushMedianMs} ms`, small: ['per push'] }, { big: `${(100 * d.pushFailed / d.pushes).toFixed(1)}%`, small: ['failed'] }], L ? 4 : 2);
      // landed over time: a straight line = the queue's fixed pace
      const gx = box.x + (L ? 130 : 120), gy = box.y + tilesH + (L ? 60 : 70), gw = box.w - (L ? 130 : 120) - (L ? 560 : 0), gh = (L ? f.chartBottom - 40 : f.chartBottom - 160) - gy;
      const pts = d.landedOverTime, tMax = 540, vMax = 6000;
      const X = t => gx + (t / tMax) * gw, Y = v => gy + gh - (v / vMax) * gh;
      for (const v of [0, 3000, 6000]) { out += `<line x1="${gx}" x2="${gx + gw}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-width="${v ? 1 : 2}"/>` + text(gx - 14, Y(v) + 9, n(v), { size: f.tick, c: 'dim', anchor: 'end' }); }
      for (const t of [0, 120, 240, 360, 480]) out += text(X(t), gy + gh + 42, `${t / 60} min`, { size: f.tick, c: 'dim', anchor: 'middle' });
      out += text(gx, gy - 24, 'changes landed', { size: f.tick, c: 'dim' });
      out += `<polyline fill="none" stroke="var(--acc)" stroke-width="4" stroke-linejoin="round" stroke-linecap="round" points="${pts.map(([t, v]) => `${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}"/>`;
      const [lt, lv] = pts.at(-1);
      out += `<circle cx="${X(lt)}" cy="${Y(lv)}" r="7" fill="var(--acc)" stroke="var(--bg)" stroke-width="3"><title>${n(lv)} landed after ${lt} s</title></circle>`;
      const ax = L ? X(lt) + 34 : box.x, ay = L ? Y(lv) + 14 : gy + gh + 96;
      out += lines(ax, ay, L ? [`≈ ${d.queuePerSecond} landings a second:`, 'the most one queue', 'could take'] : [`≈ ${d.queuePerSecond} landings a second: the`, 'most one queue could take'], f.txt - 4, 1.25, { c: 'fg' });
      return out;
    },
  });
}

// 7. Migration swarm (qb4): hours to finish, agent time wasted
{
  const d = D.swarm, a10 = d.agents['10'], ffa = a10[0], ordered = a10.slice(1);
  const best = Math.min(...ordered.map(r => r[0])), ratio = best / ffa[0];
  const faster = ratio <= 0.45 ? 'less than half the time' : ratio <= 0.55 ? 'half the time' : `${Math.round(100 * ratio)}% of the time`;
  const fmtH = v => `${v >= 10 ? Math.round(v) : v % 1 ? v.toFixed(1) : v} h`;
  C.push({ name: 'swarm-migration', data: d,
    title: { L: [`Free-for-all wasted ${Math.round(ffa[1])} agent-hours; knowing the`, `order finished in ${faster}`], P: [`Free-for-all wasted ${Math.round(ffa[1])} h;`, 'knowing the order finished', `in ${faster}`] },
    sub: { L: [`One migration in Hono's real code: 140 tasks, about ${d.usefulH} h of real work`], P: [`Hono migration: 140 tasks, ~${d.usefulH} h of work`] },
    source: 'sim/swarm/run.mjs, mean of 3 seeds (sim/README.md)',
    table: [['way of working', 'agents', 'hours to finish (3 seeds)', 'agent-hours wasted', 'main broken'],
      ...Object.entries(d.agents).flatMap(([n, rows]) => rows.map((r, i) => [d.policies[i], n, `${r[0]} h (${d.ranges[n][i][0]})`, `${r[1]} h (${d.ranges[n][i][1]})`, r[2] ? `${Math.round(100 * r[2])}% of the time` : 'never']))],
    body: (f, box) => {
      const L = f.tag === '1920x1080', max = Math.max(...Object.values(d.agents).flat().map(r => r[0]));
      const groups = Object.entries(d.agents);
      let out = '';
      // one block per agent count: side by side on the slide, stacked on the phone
      const labelW = L ? 500 : 0, colGap = L ? 60 : 0, short = ['Free-for-all', 'Phases', 'Stacking', 'Stack + intent'];
      const colW = L ? (box.w - labelW - colGap) / groups.length : box.w;
      const blockH = L ? box.h : (box.h - 30) / groups.length;
      groups.forEach(([n, rows], gi) => {
        const cx = L ? box.x + labelW + gi * (colW + colGap) : box.x, cy = L ? box.y : box.y + gi * (blockH + 30);
        out += text(cx, cy + f.txt * 0.8, `${n} agents`, { size: f.txt, weight: 600 });
        const top = cy + f.txt + 24, rowH = (L ? box.h : blockH) - (top - cy);
        const rh = rowH / rows.length, barH = L ? 40 : 36;
        rows.forEach((r, i) => {
          const y0 = top + i * rh, hi = d.policies[i] === d.winner;
          if (L && gi === 0) out += text(box.x, y0 + barH * 0.5 + f.txt * 0.35, d.policies[i], { size: f.txt - 4, c: hi ? 'fg' : 'dim', weight: hi ? 600 : 400 });
          if (!L) out += text(cx, y0 + barH * 0.5 + f.txt * 0.3, short[i], { size: f.txt - 8, c: hi ? 'fg' : 'dim', weight: hi ? 600 : 400 });
          const bx = L ? cx : cx + 310, by = y0, tw = L ? 140 : 220, w = r[0] / max * tw;
          out += track(bx, by, tw, barH) + rect(bx, by, w, barH, hi ? 'acc' : 'bar', { title: `${d.policies[i]}, ${n} agents: ${fmtH(r[0])} to finish, ${fmtH(r[1])} wasted` });
          out += text(bx + tw + 16, by + barH / 2 + f.val * 0.35, fmtH(r[0]), { size: f.val - 4, weight: 600, c: hi ? 'fg' : 'dim' });
          // the second fact: agent time wasted, or how often main was broken
          const note = r[1] > 0 ? `${fmtH(r[1])} wasted` : r[2] > 0 ? `main broken ${Math.round(100 * r[2])}%` : null;
          if (note) {
            const wx = bx + tw + (L ? 128 : 150), wy = by + barH / 2 + f.txt * 0.33;
            out += `<rect x="${wx}" y="${wy - f.txt * 0.33 - 8}" width="16" height="16" rx="3" fill="var(--bad)"/>` + text(wx + 26, wy, L ? note : note.replace('main broken', 'broken'), { size: f.txt - (L ? 10 : 8), c: 'dim' });
          }
        });
      });
      return out;
    },
  });
}

for (const c of C) c.dataSource = D[Object.keys(D).find((k) => D[k] === c.data)].source;
writeCharts({ dir: DIR, charts: C, png: process.argv.includes('--png'),
  title: 'qodebase evidence', heading: 'What happens when many agents change one codebase',
  description: 'What happens when many AI agents change one codebase: six measurements behind qodebase.',
  intro: 'Six measurements behind qodebase: four simulations on real code and real git, one real agent swarm (Bun), and one run on Cloudflare. No model calls in any of them.',
  footer: 'Built by docs/contest/evidence/build.mjs from data.json, 2026-10-07.' });
