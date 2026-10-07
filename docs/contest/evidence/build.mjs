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
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, '../../..');
const D = JSON.parse(readFileSync(join(DIR, 'data.json'), 'utf8'));

const THEMES = {
  dark: { bg: '#0c0d0e', card: '#141517', line: '#222428', fg: '#ececee', dim: '#9a9fa6', acc: '#4fbf9f', busy: '#e0a948', bad: '#e8655a', bar: '#5a5f67' },
  light: { bg: '#ffffff', card: '#f3f4f6', line: '#e2e4e8', fg: '#111214', dim: '#6e737b', acc: '#17695a', busy: '#b7791f', bad: '#b4322a', bar: '#a9aeb6' },
};
// L = video slide, P = phone portrait. top/side padding, where the chart may
// end, and the source line's baseline.
const FMT = {
  L: { w: 1920, h: 1080, pad: 160, top: 100, h1: 64, h2: 40, txt: 44, val: 48, src: 26, tick: 34, chartBottom: 800, srcY: 840, tag: '1920x1080' },
  P: { w: 1080, h: 1350, pad: 56, top: 84, h1: 62, h2: 44, txt: 48, val: 52, src: 30, tick: 38, chartBottom: 1190, srcY: 1252, tag: '1080x1350' },
};

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = v => v.toLocaleString('en-US');
const text = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.size}" font-weight="${o.weight || 400}" fill="var(--${o.c || 'fg'})"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.ls ? ` letter-spacing="${o.ls}"` : ''} style="font-variant-numeric:tabular-nums">${esc(s)}</text>`;
const lines = (x, y, arr, size, lh, o = {}) => arr.map((s, i) => text(x, y + i * size * lh, s, { size, ...o })).join('');
const rect = (x, y, w, h, c, o = {}) => `<rect x="${x}" y="${y}" width="${Math.max(0, w)}" height="${h}" rx="${o.rx ?? 4}" fill="var(--${c})"${o.ring ? ' stroke="var(--line)" stroke-width="1"' : ''}>${o.title ? `<title>${esc(o.title)}</title>` : ''}</rect>`;
const track = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="var(--card)"/><rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="4" fill="none" stroke="var(--line)"/>`;

// Header: headline (pre-broken per format), what was measured, then the source line.
function frame(f, c, body) {
  const h1 = c.title[f.tag === '1920x1080' ? 'L' : 'P'], h2 = c.sub[f.tag === '1920x1080' ? 'L' : 'P'];
  let y = f.top + f.h1 * 0.85;
  let out = lines(f.pad, y, h1, f.h1, 1.12, { weight: 600, ls: '-1.6' });
  y += (h1.length - 1) * f.h1 * 1.12 + 36 + f.h2;
  out += lines(f.pad, y, h2, f.h2, 1.35, { c: 'dim' });
  const top = y + (h2.length - 1) * f.h2 * 1.35 + (f.tag === '1920x1080' ? 60 : 64);
  out += body(f, { x: f.pad, y: top, w: f.w - 2 * f.pad, h: f.chartBottom - top });
  const src = 'Source: ' + c.source, cut = f.tag === '1920x1080' ? Infinity : src.lastIndexOf(' ', 56);
  out += cut > 0 && cut < src.length ? lines(f.pad, f.srcY, [src.slice(0, cut), src.slice(cut + 1)], f.src, 1.3, { c: 'dim' }) : text(f.pad, f.srcY, src, { size: f.src, c: 'dim' });
  return out;
}

// Horizontal bars, one series. Landscape: label column left. Portrait: label above.
function hbars(f, box, rows, o) {
  const P = f.tag !== '1920x1080', max = o.max ?? Math.max(...rows.map(r => r.v));
  const labelW = P ? 0 : o.labelW ?? 460, gap = P ? 26 : 22;
  const rowH = (box.h - gap * (rows.length - 1)) / rows.length;
  const barH = Math.min(P ? rowH - f.txt - 14 : rowH, 58), valW = o.valW ?? (P ? 0 : 230), vs = Math.min(f.val, barH + 16);
  let out = '';
  rows.forEach((r, i) => {
    const y0 = box.y + i * (rowH + gap);
    const by = P ? y0 + f.txt + 12 : y0 + (rowH - barH) / 2;
    const tx = box.x + labelW, tw = box.w - labelW - valW;
    out += P ? text(box.x, y0 + f.txt * 0.85, r.label, { size: f.txt, c: r.hi ? 'fg' : 'dim', weight: r.hi ? 600 : 400 })
      : text(box.x, by + barH / 2 + f.txt * 0.35, r.label, { size: f.txt, c: r.hi ? 'fg' : 'dim', weight: r.hi ? 600 : 400 });
    out += track(tx, by, tw, barH);
    const w = (r.v / max) * tw;
    out += rect(tx, by, w, barH, r.color || (r.hi ? 'acc' : 'bar'), { title: `${r.label}: ${r.valueText}` });
    // value: after the bar if it fits, else inside its end
    const vt = r.valueText, vw = vt.length * vs * 0.56 + 20;
    const inside = w + vw > tw + valW;
    out += text(inside ? tx + w - 16 : tx + w + 16, by + barH / 2 + vs * 0.35, vt,
      { size: vs, weight: 600, c: inside ? 'bg' : (r.hi ? 'fg' : 'dim'), anchor: inside ? 'end' : null });
    // a second, quieter fact after the value, with its own colour marker (hono: conflicts)
    if (r.extra) { const ex = tx + w + 16 + vt.length * vs * 0.6 + 28, ey = by + barH / 2;
      out += `<rect x="${ex}" y="${ey - 8}" width="16" height="16" rx="3" fill="var(--${r.extraColor})"/>` + text(ex + 26, ey + f.txt * 0.33, r.extra, { size: f.txt - 2, c: 'dim' }); }
  });
  return out;
}

function tiles(f, box, items, cols) {
  const gap = 24, rowsN = Math.ceil(items.length / cols);
  const tw = (box.w - gap * (cols - 1)) / cols, th = Math.min((box.h - gap * (rowsN - 1)) / rowsN, f.tag === '1920x1080' ? 230 : 250);
  const big = Math.min(f.tag === '1920x1080' ? 84 : 88, th * 0.42), sm = f.txt - 2;
  return items.map((it, i) => {
    const x = box.x + (i % cols) * (tw + gap), y = box.y + Math.floor(i / cols) * (th + gap);
    return `<rect x="${x}" y="${y}" width="${tw}" height="${th}" rx="14" fill="var(--card)"/><rect x="${x + 0.5}" y="${y + 0.5}" width="${tw - 1}" height="${th - 1}" rx="14" fill="none" stroke="var(--line)"/>`
      + text(x + 30, y + 30 + big * 0.8, it.big, { size: big, weight: 600, ls: '-2', c: it.hi ? 'acc' : 'fg' })
      + lines(x + 30, y + th - 26 - (it.small.length - 1) * sm * 1.3, it.small, sm, 1.3, { c: 'dim' });
  }).join('');
}

// A 100% bar split into parts, labels under the parts.
function split(f, x, y, w, h, parts, total, caption) {
  let out = text(x, y - 18, caption, { size: f.txt, weight: 600 }), cx = x;
  const P = f.tag !== '1920x1080';
  parts.forEach((p, i) => {
    const pw = (p.v / total) * w - (i < parts.length - 1 ? 3 : 0); // 3 px surface gap between parts
    out += rect(cx, y, pw, h, p.c, { rx: 4, title: `${p.label}: ${n(p.v)} (${Math.round(100 * p.v / total)}%)` });
    p.x = cx; p.w = pw; cx += pw + 3;
  });
  if (P) { // phone: one line per part under the bar
    parts.forEach((p, i) => { const ly = y + h + 30 + f.val * 0.8 + i * f.val * 1.3, share = `${Math.round(100 * p.v / total)}%`;
      out += `<rect x="${x}" y="${ly - f.val * 0.36 - 8}" width="16" height="16" rx="3" fill="var(--${p.c})"/>`
        + text(x + 28, ly, n(p.v), { size: f.val, weight: 600 }) + text(x + 150, ly, share, { size: f.val - 6, c: 'dim' })
        + text(x + 290, ly, p.label.join(' '), { size: f.txt - 2, c: 'dim' }); });
    return out;
  }
  // labels: one column per part, left-aligned on it; the last one right-aligned if narrow
  parts.forEach((p, i) => {
    const narrow = p.w < (P ? 260 : 330);
    const lx = narrow && i === parts.length - 1 ? x + w : p.x, anchor = narrow && i === parts.length - 1 ? 'end' : null;
    const ly = y + h + 26 + f.val * 0.8 + (P && narrow && i === parts.length - 1 ? f.val * 1.25 + f.txt * 1.3 * p.label.length : 0);
    const share = `${Math.round(100 * p.v / total)}%`, numW = n(p.v).length * f.val * 0.58;
    out += `<rect x="${anchor ? lx - 16 : lx}" y="${ly - f.val * 0.36 - 8}" width="16" height="16" rx="3" fill="var(--${p.c})"/>`;
    out += anchor
      ? text(lx - 28, ly, share, { size: f.val - 6, c: 'dim', anchor }) + text(lx - 28 - share.length * (f.val - 6) * 0.6 - 12, ly, n(p.v), { size: f.val, weight: 600, anchor })
      : text(lx + 28, ly, n(p.v), { size: f.val, weight: 600 }) + text(lx + 28 + numW + 12, ly, share, { size: f.val - 6, c: 'dim' });
    out += lines(lx, ly + f.txt * 1.1, p.label, f.txt - 4, 1.25, { c: 'dim', anchor });
  });
  return out;
}

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

// ---------- write ----------
const vars = t => Object.entries(THEMES[t]).map(([k, v]) => `--${k}:${v}`).join(';');
// On the page (no theme) the SVG has no fixed size: it scales with the column.
const svg = (c, f, theme) => `<svg xmlns="http://www.w3.org/2000/svg"${theme ? ` width="${f.w}" height="${f.h}"` : ` style="aspect-ratio:${f.w}/${f.h}"`} viewBox="0 0 ${f.w} ${f.h}" role="img" aria-label="${esc(c.title.L.join(' '))}"${theme ? ` style="${vars(theme)}"` : ''} font-family="Geist, 'Instrument Sans', system-ui, sans-serif">`
  + `<rect width="${f.w}" height="${f.h}" fill="var(--bg)"/>${frame(f, c, c.body)}</svg>`;
const files = [];
for (const c of C) for (const [k, f] of Object.entries(FMT)) for (const t of ['dark', 'light']) {
  const name = `${c.name}-${f.tag}-${t}`;
  writeFileSync(join(DIR, name + '.svg'), svg(c, f, t) + '\n');
  files.push({ name, f, t });
}

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>qodebase evidence</title>
<meta name="description" content="What happens when many AI agents change one codebase: six measurements behind qodebase.">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root { ${vars('light')}; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${vars('dark')} } }
:root[data-theme="dark"] { ${vars('dark')} }
* { box-sizing: border-box; margin: 0; }
body { background: var(--bg); color: var(--fg); font: 400 16px/1.5 Geist, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
main { max-width: 1040px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 28px; font-weight: 600; letter-spacing: -0.02em; }
header p { color: var(--dim); margin-top: 8px; max-width: 640px; }
section { margin-top: 48px; }
svg { display: block; width: 100%; height: auto; border-radius: 12px; box-shadow: inset 0 0 0 1px var(--line); }
.L { display: none; } @media (min-width: 760px) { .L { display: block; } .P { display: none; } }
details { margin-top: 12px; } summary { color: var(--dim); font-size: 15px; cursor: pointer; min-height: 44px; display: flex; align-items: center; }
table { border-collapse: collapse; width: 100%; font-size: 15px; font-variant-numeric: tabular-nums; }
td, th { text-align: left; padding: 8px 12px 8px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--dim); font-weight: 500; }
.files { margin-top: 8px; font-size: 13px; color: var(--dim); }
.files a { color: var(--acc); }
footer { margin-top: 56px; color: var(--dim); font-size: 13px; }
</style></head><body><main>
<header><h1>What happens when many agents change one codebase</h1>
<p>Six measurements behind qodebase: four simulations on real code and real git, one real agent swarm (Bun), and one run on Cloudflare. No model calls in any of them.</p></header>
${C.map(c => `<section id="${c.name}" aria-labelledby="${c.name}-h">
<h2 id="${c.name}-h" hidden>${esc(c.title.L.join(' '))}</h2>
<div class="L">${svg(c, FMT.L)}</div><div class="P">${svg(c, FMT.P)}</div>
<details><summary>The numbers</summary><table>${c.table.map((r, i) => `<tr>${r.map(v => i ? `<td>${esc(v)}</td>` : `<th>${esc(v)}</th>`).join('')}</tr>`).join('')}</table>
<p class="files">Source: ${esc(D[Object.keys(D).find(k => D[k] === c.data)].source)}. Files: ${Object.values(FMT).map(f => ['dark', 'light'].map(t => `<a href="${c.name}-${f.tag}-${t}.png">${f.tag} ${t}</a>`).join(' ')).join(' ')}</p></details>
</section>`).join('\n')}
<footer>Built by docs/contest/evidence/build.mjs from data.json, 2026-10-07.</footer>
</main></body></html>
`;
writeFileSync(join(DIR, 'index.html'), page);
console.log(`${C.length} charts, ${files.length} SVGs, index.html`);

if (process.argv.includes('--png')) {
  const font = join(ROOT, 'video/fonts/Geist.ttf');
  const tmp = join(DIR, '.render'); mkdirSync(tmp, { recursive: true });
  // chrome-headless-shell sizes the viewport exactly; full Chrome's --headless=new
  // keeps ~90 px for window chrome and leaves a white strip at the bottom.
  const CHROME = process.env.CHROME || execFileSync('bash', ['-c', 'ls -d ~/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell | sort -V | tail -1'], { encoding: 'utf8' }).trim();
  for (const { name, f } of files) {
    const html = join(tmp, name + '.html');
    writeFileSync(html, `<!doctype html><style>@font-face{font-family:Geist;src:url("file://${font}")}html,body{margin:0;width:${f.w}px;height:${f.h}px;overflow:hidden}</style>${readFileSync(join(DIR, name + '.svg'), 'utf8')}`);
    execFileSync(CHROME, ['--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${f.w},${f.h}`,
      `--user-data-dir=${join(tmp, 'profile')}`, `--screenshot=${join(DIR, name + '.png')}`, '--virtual-time-budget=2000', `file://${html}`], { stdio: 'ignore' });
  }
  rmSync(tmp, { recursive: true, force: true });
  console.log(`${files.length} PNGs`);
}
