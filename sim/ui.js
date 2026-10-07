import { POLICIES, PRESETS } from './engine.js';

const $ = (id) => document.getElementById(id);
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const SPEEDS = [[1, '1×'], [10, '10×'], [60, '1 min/s'], [600, '10 min/s'], [3600, '1 h/s']];
const store = {
  get(k, d) { try { return localStorage.getItem('qbsim.' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('qbsim.' + k, v); } catch {} },
};
const state = {
  preset: PRESETS[store.get('preset')] ? store.get('preset') : 'today',
  policy: POLICIES[store.get('policy')] ? store.get('policy') : 'hybrid',
  speed: Number(store.get('speed', 60)) || 60,
  playing: false, last: null,
};

// ---- colours from the tokens ----
let C = {};
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ['bg', 'card', 'chip', 'line', 'fg', 'dim', 'acc', 'busy']) C[k] = cs.getPropertyValue('--' + k).trim();
}
readColors();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); if (state.last) render(state.last); });
const mix = (a, pct) => `color-mix(in srgb, ${a} ${pct}%, transparent)`;
const GROUP_COLOR = {
  'starting': () => C.dim,
  'waiting for a claim': () => mix(C.busy, 45),
  'working': () => C.acc,
  'waiting for review': () => C.busy,
  'in review': () => mix(C.acc, 45),
  'in the merge queue': () => C.fg,
};
const POLICY_COLOR = { classic: () => C.dim, agentReview: () => C.busy, claims: () => mix(C.fg, 70), hybrid: () => C.acc };

// ---- formatting ----
const n0 = (x) => Math.round(x).toLocaleString('en-US');
const money = (x) => (x >= 100 ? `$${n0(x)}` : `$${x.toFixed(2)}`);
function dur(s) {
  if (s == null || !isFinite(s)) return '–';
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}
function clock(t) {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ---- controls ----
for (const [k, p] of Object.entries(PRESETS)) $('preset').add(new Option(p.label, k, false, k === state.preset));
$('preset').onchange = (e) => { state.preset = e.target.value; store.set('preset', state.preset); restart(); };

function chipGroup(el, items, current, onPick) {
  el.replaceChildren(...items.map(([v, label]) => {
    const b = document.createElement('button');
    b.className = 'chip'; b.textContent = label; b.dataset.v = v;
    b.setAttribute('aria-pressed', String(String(v) === String(current)));
    b.onclick = () => { for (const c of el.children) c.setAttribute('aria-pressed', String(c === b)); onPick(v); };
    return b;
  }));
}
chipGroup($('policy'), Object.entries(POLICIES).map(([k, p]) => [k, p.label]), state.policy, (v) => {
  state.policy = v; store.set('policy', v); $('about').textContent = POLICIES[v].about; restart();
});
$('about').textContent = POLICIES[state.policy].about;
chipGroup($('speed'), SPEEDS, state.speed, (v) => { state.speed = v; store.set('speed', v); worker.postMessage({ cmd: 'speed', speed: v }); });

$('play').onclick = () => worker.postMessage({ cmd: state.playing ? 'pause' : 'play' });
$('restart').onclick = () => restart();
$('follow').onclick = () => worker.postMessage({ cmd: 'follow' });
$('compareBtn').onclick = () => {
  const hours = 2;
  $('compareCard').hidden = false;
  $('compareTitle').textContent = `Compare: ${PRESETS[state.preset].label}, ${hours} simulated hours, same seed`;
  $('cmpTable').innerHTML = '<tr><td class="muted">Running the four policies…</td></tr>';
  worker.postMessage({ cmd: 'compare', cfg: simCfg(), hours });
  $('compareCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

function simCfg() {
  const p = PRESETS[state.preset];
  return { seed: 1, policy: state.policy, repos: p.repos, agentsPerRepo: p.agentsPerRepo, files: p.files };
}
function restart() {
  layout = null;
  worker.postMessage({ cmd: 'start', cfg: simCfg() });
  worker.postMessage({ cmd: 'speed', speed: state.speed });
  if (state.playing) worker.postMessage({ cmd: 'play' });
}

// ---- rendering ----
function render(msg) {
  const s = msg.snap;
  state.playing = msg.playing;
  $('play').textContent = msg.playing ? 'Pause' : 'Play';

  const clockBits = [
    `<span>Simulated <b>${clock(s.t)}</b></span>`,
    msg.achieved != null && msg.playing ? `<span>running at <b>${msg.achieved >= 100 ? n0(msg.achieved) : msg.achieved.toFixed(1)}×</b></span>` : '',
    `<span><b>${n0(s.events)}</b> events</span>`,
  ];
  $('clock').innerHTML = clockBits.join('');

  const m = s.metrics, r = msg.rate;
  const thinking = m.workS + m.reworkS;
  const stats = [
    [n0(s.totalAgents), `agents, plus ${n0(s.reviewerAgents)} reviewers`],
    [r ? n0(r.mergedPerH) : '–', 'landed per hour'],
    [dur(s.p50), 'asked to landed, median'],
    [dur(s.p90), 'asked to landed, slowest 10%'],
    [r ? n0(r.conflictsPerH) : '–', 'conflicts per hour'],
    [thinking ? `${Math.round((100 * m.reworkS) / thinking)}%` : '–', 'agent time spent redoing'],
    [`${(100 * s.redShare).toFixed(1)}%`, 'of the time main is broken'],
    [m.merged ? money(m.cost / m.merged) : '–', r ? `per change, ${money(r.costPerH)}/h` : 'per change'],
  ];
  $('stats').innerHTML = stats.map(([v, k]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');

  const total = s.groups.reduce((a, [, c]) => a + c, 0) || 1;
  $('bar').innerHTML = s.groups.map(([g, c]) => `<span style="flex-grow:${c};background:${GROUP_COLOR[g]()}" title="${g}"></span>`).join('');
  $('legend').innerHTML = s.groups.map(([g, c]) =>
    `<div><i style="background:${GROUP_COLOR[g]()}"></i>${g}<span class="n">${n0(c)}${c / total >= 0.005 ? ` (${Math.round((100 * c) / total)}%)` : ''}</span></div>`).join('');

  drawChart(msg.series);
  if (s.files) drawMap(s);
  $('reposCard').hidden = s.repoStrip.length <= 2;
  if (s.repoStrip.length > 2) drawRepos(s.repoStrip);
  renderFollow(s);
}

function canvasCtx(cv, cssH) {
  const dpr = devicePixelRatio || 1, w = cv.clientWidth;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(cssH * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(cssH * dpr); cv.style.height = cssH + 'px';
  }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, cssH);
  return [g, w];
}

function line(g, pts, color, x0, y0, w, h, maxX, maxY) {
  g.strokeStyle = color; g.lineWidth = 2; g.lineJoin = 'round'; g.beginPath();
  pts.forEach(([x, y], i) => {
    const px = x0 + (x / maxX) * w, py = y0 + h - (y / maxY) * h;
    i ? g.lineTo(px, py) : g.moveTo(px, py);
  });
  g.stroke();
}
function axisText(g, text, x, y, align = 'left') {
  g.fillStyle = C.dim; g.font = '12px Geist, sans-serif'; g.textAlign = align; g.fillText(text, x, y);
}
const niceMax = (v) => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); return Math.ceil(v / p) * p; };

function drawChart(series) {
  const H = 160, [g, W] = canvasCtx($('chart'), H);
  if (series.length < 3) { axisText(g, 'Press Play: the chart fills as simulated time passes.', 0, 20); return; }
  const rate = [], wait = [];
  let j = 0;
  for (let i = 0; i < series.length; i++) {
    while (j < i && series[i].t - series[j].t > 600) j++;
    const dt = (series[i].t - series[j].t) / 3600;
    if (dt > 0) rate.push([series[i].t, (series[i].merged - series[j].merged) / dt]);
    const p = series[i];
    wait.push([p.t, p.reviewWait + p.humanWait + p.claimWait + p.mergeWait]);
  }
  const maxX = series[series.length - 1].t || 1;
  const maxR = niceMax(Math.max(1, ...rate.map((p) => p[1])));
  const maxW = niceMax(Math.max(1, ...wait.map((p) => p[1])));
  const x0 = 0, y0 = 18, w = W, h = H - 36;
  g.strokeStyle = C.line; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, y0 + h + .5); g.lineTo(W, y0 + h + .5); g.stroke();
  line(g, wait, C.busy, x0, y0, w, h, maxX, maxW);
  line(g, rate, C.acc, x0, y0, w, h, maxX, maxR);
  axisText(g, `${n0(maxR)}/h landed`, 0, 12);
  axisText(g, `${n0(maxW)} waiting`, W, 12, 'right');
  axisText(g, '0:00', 0, H - 4);
  axisText(g, clock(maxX), W, H - 4, 'right');
}

// Files laid out as folders (blocks of 8×5), the hot shared files in the first block.
let layout = null;
function makeLayout(f, W) {
  const BW = 8, BH = Math.ceil(f.perModule / BW);
  const blocks = 1 + Math.ceil((f.n - f.hot) / f.perModule);
  let c = 10;
  for (; c > 1; c--) {
    const cols = Math.max(1, Math.floor(W / ((BW + 1) * c)));
    if (Math.ceil(blocks / cols) * (BH + 1) * c <= 440) break;
  }
  const cols = Math.max(1, Math.floor(W / ((BW + 1) * c)));
  const pos = new Float32Array(f.n * 2);
  for (let i = 0; i < f.n; i++) {
    const b = i < f.hot ? 0 : 1 + Math.floor((i - f.hot) / f.perModule);
    const k = i < f.hot ? i : (i - f.hot) % f.perModule;
    const bx = (b % cols) * (BW + 1) * c, by = Math.floor(b / cols) * (BH + 1) * c;
    pos[i * 2] = bx + (k % BW) * c; pos[i * 2 + 1] = by + Math.floor(k / BW) * c;
  }
  return { W, c, pos, H: Math.ceil(blocks / cols) * (BH + 1) * c, n: f.n };
}
function drawMap(s) {
  const f = s.files, cv = $('map'), W = cv.clientWidth;
  if (!layout || layout.W !== W || layout.n !== f.n) layout = makeLayout(f, W);
  const [g] = canvasCtx(cv, layout.H);
  const flash = Math.max(20, state.speed * 0.4), cs = layout.c, gap = cs >= 4 ? 1 : 0;
  for (let i = 0; i < f.n; i++) {
    let col = C.chip, a = 1;
    if (f.conflictAge[i] < 300) { col = C.busy; a = 1 - f.conflictAge[i] / 400; }
    else if (f.mergeAge[i] < flash) col = C.fg;
    else if (f.inFlight[i] > 0) { col = C.acc; a = Math.min(1, 0.45 + 0.2 * f.inFlight[i]); }
    else if (f.claimed[i]) { col = C.acc; a = 0.3; }
    g.globalAlpha = a; g.fillStyle = col;
    g.fillRect(layout.pos[i * 2], layout.pos[i * 2 + 1], cs - gap, cs - gap);
  }
  g.globalAlpha = 1;
  $('mapTitle').textContent = s.repoStrip.length > 2 ? `The first repo, file by file (${n0(f.n)} files)` : `The codebase, file by file (${n0(f.n)} files)`;
}

function drawRepos(strip) {
  const n = strip.length / 2, cv = $('repos'), W = cv.clientWidth;
  const c = Math.max(4, Math.floor(Math.sqrt((W * 120) / n)));
  const cols = Math.max(1, Math.floor(W / c));
  const [g] = canvasCtx(cv, Math.ceil(n / cols) * c);
  let maxQ = 1; for (let i = 0; i < n; i++) maxQ = Math.max(maxQ, strip[i * 2]);
  for (let i = 0; i < n; i++) {
    const x = (i % cols) * c, y = Math.floor(i / cols) * c;
    if (strip[i * 2 + 1]) { g.globalAlpha = 1; g.fillStyle = C.busy; }
    else if (strip[i * 2] > 0) { g.globalAlpha = 0.2 + 0.8 * (strip[i * 2] / maxQ); g.fillStyle = C.acc; }
    else { g.globalAlpha = 1; g.fillStyle = C.chip; }
    g.fillRect(x, y, c - 1, c - 1);
  }
  g.globalAlpha = 1;
}

const STORY_WORDS = {
  asked: 'asked for', claimWait: 'waiting for its files to be free', work: 'agent working', fix: 'fixing what the review asked',
  rework: 'redoing it on the new main', reviewWait: 'waiting for a reviewer', review: 'reviewer agent checking',
  humanWait: 'waiting for a person', human: 'a person reviewing', mergeWait: 'in the merge queue', merged: 'landed',
};
function renderFollow(s) {
  const f = s.follow;
  if (!f) return;
  $('followNote').textContent = f.done ? 'Landed. Follow another one?' : `Change #${f.id}: live.`;
  $('followFiles').textContent = f.files ? `${f.files.length} file${f.files.length > 1 ? 's' : ''}: ${f.files.map((i) => (i < 6 ? ['package.json', 'src/routes.ts', 'src/schema.sql', 'src/index.ts', 'wrangler.jsonc', 'README.md'][i] : `src/m${Math.floor((i - 6) / 40)}/f${(i - 6) % 40}.ts`)).join(', ')}` : '';
  const t0 = f.log[0][0];
  $('story').innerHTML = f.log.map(([t, w]) => `<li><time>+${dur(t - t0)}</time><span>${STORY_WORDS[w] || w}</span></li>`).join('');
}

function renderCompare(msg) {
  const rows = msg.rows;
  const H = 160, [g, W] = canvasCtx($('cmpChart'), H);
  const maxX = msg.hours * 3600, maxY = niceMax(Math.max(1, ...rows.map((r) => r.merged)));
  for (const r of rows) line(g, r.series, POLICY_COLOR[r.policy](), 0, 18, W, H - 36, maxX, maxY);
  axisText(g, `${n0(maxY)} landed`, 0, 12);
  axisText(g, '0:00', 0, H - 4); axisText(g, clock(maxX), W, H - 4, 'right');
  $('cmpKey').innerHTML = rows.map((r) => `<span><i style="background:${POLICY_COLOR[r.policy]()}"></i>${POLICIES[r.policy].label}</span>`).join('');
  const head = ['', 'landed/h', 'median', 'slowest 10%', 'conflicts', 'redoing', 'main broken', 'per change', 'stuck at the end'];
  const stuck = (r) => {
    const top = Object.entries(r.stuck).filter(([k]) => k !== 'working' && k !== 'in review').sort((a, b) => b[1] - a[1])[0];
    return top && top[1] > 0 ? `${n0(top[1])} ${top[0]}` : 'nothing';
  };
  $('cmpTable').innerHTML = `<tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>` + rows.map((r) => `<tr>
    <td>${POLICIES[r.policy].label}</td><td>${n0(r.merged / msg.hours)}</td><td>${dur(r.p50)}</td><td>${dur(r.p90)}</td>
    <td>${n0(r.conflicts)}</td><td>${Math.round(r.reworkShare * 100)}%</td><td>${(r.redShare * 100).toFixed(1)}%</td>
    <td>${r.merged ? money(r.cost / r.merged) : '–'}</td><td>${stuck(r)}</td></tr>`).join('');
}

worker.onmessage = ({ data }) => {
  if (data.type === 'snap') { state.last = data; requestAnimationFrame(() => render(data)); }
  else if (data.type === 'compareProgress') $('cmpTable').innerHTML = `<tr><td class="muted">Running the four policies… ${data.done} of ${data.of}</td></tr>`;
  else if (data.type === 'compare') renderCompare(data);
};
addEventListener('resize', () => { layout = null; if (state.last) render(state.last); });
restart();
