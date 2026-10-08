// Chart kit for qodebase's evidence pages (docs/contest/evidence, docs/openclaw/charts):
// one look for every chart. Each chart = {name, title: {L, P}, sub: {L, P}, source, table,
// body(f, box) -> SVG}. writeCharts() writes per chart <name>-1920x1080-{dark,light}.svg
// (video slides: bottom 200 px empty for the caption bar) and <name>-1080x1350-{dark,light}.svg
// (phone), an index.html with all of them (light + dark, tables), and with png: true the PNGs.
// Tokens: video/contest/slides.html and DESIGN.md; conflict red adjusted so it separates
// from --busy (dataviz validator).
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

export const THEMES = {
  dark: { bg: '#0c0d0e', card: '#141517', line: '#222428', fg: '#ececee', dim: '#9a9fa6', acc: '#4fbf9f', busy: '#e0a948', bad: '#e8655a', bar: '#5a5f67' },
  light: { bg: '#ffffff', card: '#f3f4f6', line: '#e2e4e8', fg: '#111214', dim: '#6e737b', acc: '#17695a', busy: '#b7791f', bad: '#b4322a', bar: '#a9aeb6' },
};
// L = video slide, P = phone portrait. top/side padding, where the chart may
// end, and the source line's baseline.
export const FMT = {
  L: { w: 1920, h: 1080, pad: 160, top: 100, h1: 64, h2: 40, txt: 44, val: 48, src: 26, tick: 34, chartBottom: 800, srcY: 840, tag: '1920x1080' },
  P: { w: 1080, h: 1350, pad: 56, top: 84, h1: 62, h2: 44, txt: 48, val: 52, src: 30, tick: 38, chartBottom: 1190, srcY: 1252, tag: '1080x1350' },
};

export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const n = v => v.toLocaleString('en-US');
export const text = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.size}" font-weight="${o.weight || 400}" fill="var(--${o.c || 'fg'})"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.ls ? ` letter-spacing="${o.ls}"` : ''} style="font-variant-numeric:tabular-nums">${esc(s)}</text>`;
export const lines = (x, y, arr, size, lh, o = {}) => arr.map((s, i) => text(x, y + i * size * lh, s, { size, ...o })).join('');
export const rect = (x, y, w, h, c, o = {}) => `<rect x="${x}" y="${y}" width="${Math.max(0, w)}" height="${h}" rx="${o.rx ?? 4}" fill="var(--${c})"${o.ring ? ' stroke="var(--line)" stroke-width="1"' : ''}>${o.title ? `<title>${esc(o.title)}</title>` : ''}</rect>`;
export const track = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="var(--card)"/><rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="4" fill="none" stroke="var(--line)"/>`;

// Header: headline (pre-broken per format), what was measured, then the source line.
export function frame(f, c, body) {
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
export function hbars(f, box, rows, o) {
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

export function tiles(f, box, items, cols) {
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
export function split(f, x, y, w, h, parts, total, caption, o = {}) {
  let out = text(x, y - 18, caption, { size: f.txt, weight: 600 }), cx = x;
  const P = f.tag !== '1920x1080';
  parts.forEach((p, i) => {
    const pw = (p.v / total) * w - (i < parts.length - 1 ? 3 : 0); // 3 px surface gap between parts
    out += rect(cx, y, pw, h, p.c, { rx: 4, title: `${p.label}: ${n(p.v)} (${Math.round(100 * p.v / total)}%)` });
    p.x = cx; p.w = pw; cx += pw + 3;
  });
  if (P || o.list) { // phone (or o.list): one line per part under the bar
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
export const vars = t => Object.entries(THEMES[t]).map(([k, v]) => `--${k}:${v}`).join(';');
// On the page (no theme) the SVG has no fixed size: it scales with the column.
export const svg = (c, f, theme) => `<svg xmlns="http://www.w3.org/2000/svg"${theme ? ` width="${f.w}" height="${f.h}"` : ` style="aspect-ratio:${f.w}/${f.h}"`} viewBox="0 0 ${f.w} ${f.h}" role="img" aria-label="${esc(c.title.L.join(' '))}"${theme ? ` style="${vars(theme)}"` : ''} font-family="Geist, 'Instrument Sans', system-ui, sans-serif">`
  + `<rect width="${f.w}" height="${f.h}" fill="var(--bg)"/>${frame(f, c, c.body)}</svg>`;

// o: {dir, charts, title, description, heading, intro, footer, png}
export function writeCharts(o) {
  const { dir: DIR, charts: C } = o;
  const files = [];
  for (const c of C) for (const [k, f] of Object.entries(FMT)) for (const t of ['dark', 'light']) {
    const name = `${c.name}-${f.tag}-${t}`;
    writeFileSync(join(DIR, name + '.svg'), svg(c, f, t) + '\n');
    files.push({ name, f, t });
  }

  const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
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
<header><h1>${esc(o.heading)}</h1>
<p>${esc(o.intro)}</p></header>
${C.map(c => `<section id="${c.name}" aria-labelledby="${c.name}-h">
<h2 id="${c.name}-h" hidden>${esc(c.title.L.join(' '))}</h2>
<div class="L">${svg(c, FMT.L)}</div><div class="P">${svg(c, FMT.P)}</div>
<details><summary>The numbers</summary><table>${c.table.map((r, i) => `<tr>${r.map(v => i ? `<td>${esc(v)}</td>` : `<th>${esc(v)}</th>`).join('')}</tr>`).join('')}</table>
<p class="files">Source: ${esc(c.dataSource || c.source)}. Files: ${Object.values(FMT).map(f => ['dark', 'light'].map(t => `<a href="${c.name}-${f.tag}-${t}.png">${f.tag} ${t}</a>`).join(' ')).join(' ')}</p></details>
</section>`).join('\n')}
<footer>${esc(o.footer)}</footer>
</main></body></html>
`;
  writeFileSync(join(DIR, 'index.html'), page);
  console.log(`${C.length} charts, ${files.length} SVGs, index.html`);

  if (o.png) {
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
}
