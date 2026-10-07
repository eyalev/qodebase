// Drill-down viewer for a real-code sim run (sim/real/run.mjs writes runs/<name>.json).
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const n0 = (x) => Math.round(x).toLocaleString('en-US');
const clock = (t) => `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}`;
const clockS = (t) => `${clock(t)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const dur = (s) => (s == null ? '–' : s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

const STATES = new Set(['claimWait', 'work', 'fix', 'rework', 'reviewWait', 'review', 'humanWait', 'human', 'mergeWait', 'dispute', 'leadWait', 'lead', 'landed', 'dropped', 'reverted']);
const WORDS = {
  asked: 'asked', claimWait: 'waiting for its files to be free', work: 'agent working', fix: 'fixing what the review asked',
  rework: 'redoing it on the new main', reviewWait: 'waiting for a reviewer', review: 'reviewer agent checking',
  humanWait: 'waiting for a person', human: 'a person approving', mergeWait: 'in the merge queue', dispute: 'author and reviewer arguing',
  leadWait: 'waiting for its lead', lead: 'the lead on it', landed: 'landed', dropped: 'dropped', reverted: 'reverted',
  conflict: 'git conflict', 'train tests failed': 'train tests failed', 'broke main': 'broke main',
};
const SHORT = {
  claimWait: 'waiting for files', work: 'working', fix: 'fixing', rework: 'redoing', reviewWait: 'waiting for review', review: 'in review',
  humanWait: 'waiting for a person', human: 'with a person', mergeWait: 'merge queue', dispute: 'arguing', leadWait: 'waiting for lead',
  lead: 'with its lead', landed: 'landed', dropped: 'dropped', reverted: 'reverted',
};
const GROUPS = [
  ['working', ['work', 'fix', 'rework'], 'var(--acc)'],
  ['waiting for files', ['claimWait'], 'color-mix(in srgb, var(--busy) 45%, transparent)'],
  ['waiting for review', ['reviewWait', 'humanWait'], 'var(--busy)'],
  ['in review', ['review', 'human'], 'color-mix(in srgb, var(--acc) 45%, transparent)'],
  ['arguing', ['dispute'], 'color-mix(in srgb, var(--busy) 75%, transparent)'],
  ['with a lead', ['leadWait', 'lead'], 'color-mix(in srgb, var(--fg) 45%, transparent)'],
  ['in the merge queue', ['mergeWait'], 'var(--fg)'],
];

let R = null; // the run
let t = 0, playing = false, speed = 300, timer = null;

// ---- loading ----
const params = new URLSearchParams(location.search);
const index = await fetch('./runs/index.json').then((r) => r.json()).catch(() => []);
if (!index.length) { $('view').innerHTML = '<p class="muted">No runs published yet.</p>'; throw new Error('no runs'); }
for (const r of index) $('run').add(new Option(`${r.label}, ${n0(r.agents)} agents, ${r.policy === 'cloud' ? `${Math.round(r.hours * 60)} real min` : `${r.hours} simulated h`}`, r.name));
const first = index.find((r) => r.name === params.get('run')) || index.find((r) => r.policy === 'leads' && r.agents >= 500) || index[index.length - 1];
$('run').value = first.name;
$('run').onchange = () => { const u = new URL(location.href); u.searchParams.set('run', $('run').value); history.replaceState(null, '', u); load($('run').value); };

async function load(name) {
  $('view').innerHTML = '<p class="muted">Loading the run…</p>';
  const b = await fetch(`./runs/${name}.json`).then((r) => r.json());
  // Per change: [t, state] pairs; per file: the changes that touched it.
  const byFile = b.paths.map(() => []);
  for (const c of b.changes) {
    c.st = c.events.filter((e) => STATES.has(e[1]) || e[1].startsWith('reverted')).map((e) => [e[0], e[1].startsWith('reverted') ? 'reverted' : e[1]]);
    c.end = c.landedAt ?? (['dropped', 'reverted'].includes(c.state) ? c.st[c.st.length - 1][0] : Infinity);
    c.confl = c.events.filter((e) => e[1] === 'conflict').map((e) => [e[0], e[2]]);
    const seen = new Set(c.files);
    for (const p of c.conflicts) { const i = b.paths.indexOf(p); if (i >= 0) seen.add(i); }
    for (const i of seen) byFile[i].push(c.id);
  }
  b.byId = new Map(b.changes.map((c) => [c.id, c]));
  b.byFile = byFile;
  b.pathIdx = new Map(b.paths.map((p, i) => [p, i]));
  // Folders: src/mN, everything else is "shared".
  const folders = new Map();
  b.paths.forEach((p, i) => { const f = /^src\/m\d+\//.test(p) ? p.split('/').slice(0, 2).join('/') : 'shared'; if (!folders.has(f)) folders.set(f, []); folders.get(f).push(i); });
  b.folders = [...folders.entries()].sort((x, y) => (x[0] === 'shared' ? -1 : y[0] === 'shared' ? 1 : +x[0].slice(5) - +y[0].slice(5)));
  R = b;
  const end = b.meta.hours * 3600;
  $('t').max = end; $('tend').textContent = `of ${b.meta.realTime ? clockS(end) : clock(end)}`;
  // Real-time runs (on Cloudflare) are minutes long: label them so and play them slower.
  const rt = !!b.meta.realTime;
  $('tlabel').textContent = rt ? 'Real time' : 'Simulated';
  $('lede').textContent = rt
    ? 'A generated project changed by scripted agents on Cloudflare, in real time: each agent a Durable Object with its own Artifacts fork, real pushes, a merge queue landing trains on main. No model calls. Scrub through time, then tap a folder, a file or a change.'
    : 'A generated project changed by scripted agents in a real git repo: real commits, real merge conflicts, real tests on every merge. No model calls; the clock is virtual, the code is not. Scrub through time, then tap a folder, a file or a change.';
  $('t').step = rt ? 1 : 10;
  const speeds = rt ? [[1, '1×'], [5, '5×'], [20, '20×']] : [[60, '1 min/s'], [300, '5 min/s'], [900, '15 min/s']];
  document.querySelectorAll('[data-speed]').forEach((btn, k) => { btn.dataset.speed = speeds[k][0]; btn.textContent = speeds[k][1]; btn.setAttribute('aria-pressed', String(k === 1)); });
  speed = speeds[1][0];
  t = Math.min(t || end / 2, end); $('t').value = t;
  $('about').textContent = `${b.meta.about} ${n0(b.meta.agents)} agents, ${n0(b.meta.reviewers)} reviewer agents${b.meta.leads ? `, ${n0(b.meta.leads)} leads` : ''}; ${n0(b.paths.length)} files.`;
  const s = b.stats;
  const stats = [
    [n0(s.landed), `changes landed (${n0(s.landedPerHour)}/h)`],
    [dur(s.p50S), 'asked to landed, median'],
    [n0(s.conflicts), 'real git conflicts'],
    [n0(s.testFails), 'caught by train tests'],
    [n0(s.breaks), 'broke main (then reverted)'],
    [b.meta.leads ? n0(s.leadReplays) : n0(s.redos), b.meta.leads ? 'replayed by a lead' : 'redone by the agent'],
    [n0(s.dropped), 'dropped: nothing left to do'],
    [`${Math.round(s.reworkShare * 100)}%`, 'agent time spent redoing'],
  ];
  if (b.meta.realTime && s.cloud) {
    const c = s.cloud, ms = (x) => (x == null ? '–' : x < 1000 ? `${x} ms` : `${(x / 1000).toFixed(1)} s`);
    stats.splice(0, stats.length,
      [n0(s.landed), `changes landed in ${dur(c.elapsedS)} of real time`],
      [`${n0(c.forks)} of ${n0(c.agents)}`, `agents got an Artifacts fork${c.forkRetries ? ` (${n0(c.forkRetries)} retries)` : ''}`],
      [ms(c.forkMsP50), `to fork, median (slowest 10%: ${ms(c.forkMsP90)})`],
      [n0(c.agentPushes), `pushes by agents to their forks, ${n0(c.agentPushFail)} failed`],
      [ms(c.agentPushMsP50), `per agent push, median (slowest 10%: ${ms(c.agentPushMsP90)})`],
      [n0(c.mainPushes), `trains pushed to main, ${n0(c.mainPushFail)} failed`],
      [ms(c.mainPushMsP50), 'per train push to main, median'],
      [n0(c.artifactsOpsCounted), 'Artifacts operations (counted by the sim)']);
  }
  $('stats').innerHTML = stats.map(([v, k]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
  render();
}

// ---- time ----
function stateAt(c, at) {
  if (at < c.created) return null;
  let s = null;
  for (const [et, st] of c.st) { if (et <= at) s = st; else break; }
  return s || 'asked';
}
$('t').oninput = () => { t = +$('t').value; render(); };
$('play').onclick = () => {
  playing = !playing; $('play').textContent = playing ? 'Pause' : 'Play';
  clearInterval(timer);
  if (playing) timer = setInterval(() => {
    t = Math.min(+$('t').max, t + speed / 10); $('t').value = t;
    if (t >= +$('t').max) $('play').click();
    render();
  }, 100);
};
for (const b of document.querySelectorAll('[data-speed]')) b.onclick = () => {
  speed = +b.dataset.speed;
  for (const x of document.querySelectorAll('[data-speed]')) x.setAttribute('aria-pressed', String(x === b));
};

// ---- views ----
function fileMarks(at) {
  const cls = new Array(R.paths.length).fill('');
  for (const c of R.changes) {
    if (c.created > at || c.end < at - 120) continue;
    const s = stateAt(c, at);
    if (s === 'work' || s === 'fix' || s === 'rework') for (const i of c.files) if (!cls[i]) cls[i] = 'c-work';
    for (const [ct, paths] of c.confl) if (ct <= at && ct > at - 300) for (const p of paths) cls[R.pathIdx.get(p)] = 'c-conf';
    if (c.landedAt != null && c.landedAt <= at && c.landedAt > at - 120) for (const i of c.files) if (cls[i] !== 'c-conf') cls[i] = 'c-land';
  }
  return cls;
}

function renderAgents() {
  // Count states at t straight from the change records.
  const counts = Object.create(null);
  for (const c of R.changes) { if (c.created > t || c.end < t) continue; const s = stateAt(c, t); counts[s] = (counts[s] || 0) + 1; }
  const groups = GROUPS.map(([label, keys, col]) => [label, keys.reduce((a, k) => a + (counts[k] || 0), 0), col]);
  const total = groups.reduce((a, g) => a + g[1], 0) || 1;
  $('bar').innerHTML = groups.map(([l, n, col]) => `<span style="flex-grow:${n};background:${col}" title="${l}"></span>`).join('');
  $('legend').innerHTML = groups.filter((g) => g[1] || g[0] === 'working').map(([l, n, col]) => `<div><i style="background:${col}"></i>${l}<span class="n">${n0(n)} (${Math.round((100 * n) / total)}%)</span></div>`).join('');
}

const crumbs = (items) => `<nav class="crumbs">${items.map(([label, href], i) => (href ? `<a href="${href}">${esc(label)}</a>` : `<b>${esc(label)}</b>`) + (i < items.length - 1 ? '<span class="sep">/</span>' : '')).join('')}</nav>`;
const stateTag = (s) => (s == null ? '<span class="tag">not yet asked</span>' : `<span class="tag ${s === 'landed' ? 'ok' : ['dropped', 'reverted'].includes(s) ? 'warn' : ''}">${esc(SHORT[s] || s)}</span>`);

function viewCodebase() {
  const cls = fileMarks(t);
  const folders = R.folders.map(([name, idxs]) => `<button class="folder" data-go="#/folder/${encodeURIComponent(name)}" aria-label="${esc(name)}">
    <span class="cells">${idxs.map((i) => `<i class="${cls[i]}"></i>`).join('')}</span><small>${esc(name === 'shared' ? 'shared' : name.slice(4))}</small></button>`).join('');
  const recent = R.history.filter((h) => h.t <= t).slice(-6).reverse();
  return `${crumbs([['Codebase']])}
    <div class="folders">${folders}</div>
    <div class="key"><span><i class="c-work"></i>being changed</span><span><i class="c-conf"></i>git conflict, last 5 min</span><span><i class="c-land"></i>landed, last 2 min</span></div>
    <h2 style="margin-top:20px">Main, up to ${clock(t)}</h2>
    ${recent.length ? `<ul class="list">${recent.map(mainRow).join('')}</ul>` : '<p class="muted">Nothing has landed yet.</p>'}
    <p style="margin-top:8px"><a href="#/main">All of main's history</a></p>`;
}
function mainRow(h) {
  const ids = h.ids.map((id) => `<a href="#/change/${id}" style="display:inline;padding:0;min-height:0;color:var(--acc)">#${id}</a>`).join(' ');
  const what = h.kind === 'revert' ? 'reverted' : h.ids.length > 1 ? `train of ${h.ids.length}` : 'landed';
  return `<li><div class="item"><span>${what} ${ids}</span><span class="mono" style="color:var(--dim)">${h.sha.slice(0, 7)}</span>
    <span class="sub">at ${clockS(h.t)}${h.broke ? `; broke main: ${esc(h.broke[0])}` : ''}</span></div></li>`;
}

function lane(ids, path) {
  const end = R.meta.hours * 3600;
  const ticks = [];
  for (const id of ids) {
    const c = R.byId.get(id);
    if (c.landedAt != null) ticks.push(`<i style="left:${(100 * c.landedAt) / end}%;background:var(--acc)"></i>`);
    for (const [ct, ps] of c.confl) if (ps.includes(path)) ticks.push(`<i style="left:${(100 * ct) / end}%;background:var(--busy)"></i>`);
  }
  return `<div class="lane">${ticks.join('')}<i class="now" style="left:${(100 * t) / end}%"></i></div>`;
}

function viewFolder(name) {
  const f = R.folders.find((x) => x[0] === name);
  if (!f) return viewCodebase();
  const cls = fileMarks(t);
  const rows = f[1].map((i) => {
    const ids = R.byFile[i];
    const landed = ids.filter((id) => { const c = R.byId.get(id); return c.landedAt != null && c.landedAt <= t && c.files.includes(i); }).length;
    const conf = ids.reduce((a, id) => a + R.byId.get(id).confl.filter(([ct, ps]) => ct <= t && ps.includes(R.paths[i])).length, 0);
    const now = cls[i] === 'c-work' ? ' <span class="tag ok">being changed</span>' : cls[i] === 'c-conf' ? ' <span class="tag warn">conflict</span>' : '';
    return `<li><a href="#/file/${i}"><span class="mono">${esc(R.paths[i])}</span>${now ? `<span>${now}</span>` : '<span></span>'}
      <span class="sub">${n0(landed)} landed, ${n0(conf)} conflicts by ${clock(t)}${lane(ids, R.paths[i])}</span></a></li>`;
  }).join('');
  return `${crumbs([['Codebase', '#/'], [name]])}<ul class="list">${rows}</ul>
    <div class="key"><span><i style="background:var(--acc)"></i>a change landed</span><span><i style="background:var(--busy)"></i>a conflict</span><span><i style="background:var(--dim)"></i>now</span></div>`;
}

function viewFile(i) {
  const p = R.paths[i];
  if (!p) return viewCodebase();
  const folder = /^src\/m\d+\//.test(p) ? p.split('/').slice(0, 2).join('/') : 'shared';
  const ids = R.byFile[i].filter((id) => R.byId.get(id).created <= t);
  const rows = ids.slice().reverse().slice(0, 200).map((id) => {
    const c = R.byId.get(id), s = stateAt(c, t);
    const conf = c.confl.filter(([ct, ps]) => ct <= t && ps.includes(p)).length;
    return `<li><a href="#/change/${id}"><span>#${id} ${esc(c.text)}</span>${stateTag(s)}
      <span class="sub">asked ${clockS(c.created)}${c.landedAt != null && c.landedAt <= t ? `, landed ${clockS(c.landedAt)}` : ''}${conf ? `, ${conf} conflict${conf > 1 ? 's' : ''} here` : ''}</span></a></li>`;
  }).join('');
  return `${crumbs([['Codebase', '#/'], [folder, `#/folder/${encodeURIComponent(folder)}`], [p.split('/').pop()]])}
    <p class="mono" style="color:var(--dim)">${esc(p)}</p>
    <h2 style="margin-top:12px">Changes that touched it, newest first (by ${clock(t)})</h2>
    ${rows ? `<ul class="list">${rows}</ul>` : '<p class="muted">None yet.</p>'}`;
}

function viewChange(id) {
  const c = R.byId.get(id);
  if (!c) return viewCodebase();
  const s = stateAt(c, t);
  const story = c.events.map((e) => {
    const extra = Array.isArray(e[2]) ? e[2].join(', ') : e[2] && e[1] !== 'asked' ? e[2] : '';
    return `<li class="${e[0] > t ? 'future' : ''}"><time>${clockS(e[0])}</time><span>${esc(WORDS[e[1]] || e[1])}${extra ? `: <span class="mono">${esc(extra)}</span>` : ''}</span></li>`;
  }).join('');
  const files = c.files.map((i) => `<a class="mono" href="#/file/${i}">${esc(R.paths[i])}</a>`).join('<br>');
  const diff = c.diff ? c.diff.map((d) => `<p class="mono" style="margin-top:12px"><a href="#/file/${R.pathIdx.get(d.p)}">${esc(d.p)}</a></p><pre class="diff">${d.lines.map((l) => `<span class="${l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : l === '…' ? 'gap' : ''}">${esc(l === '…' ? '  …' : l)}</span>`).join('')}</pre>`).join('') : '';
  return `${crumbs([['Codebase', '#/'], [`#${c.id}`]])}
    <h2 style="font-size:18px">${esc(c.text)}</h2>
    <div class="row" style="margin:8px 0 12px">${stateTag(s)}<span class="tag">${esc(c.kind)}</span><span class="tag">agent ${c.agent}</span>${c.tries > 1 ? `<span class="tag">built ${c.tries} times</span>` : ''}</div>
    <div class="row" style="margin-bottom:12px"><button class="chip" data-t="${c.created}">Go to when asked</button>${c.landedAt != null ? `<button class="chip" data-t="${c.landedAt}">Go to when landed</button>` : ''}</div>
    <ol class="story">${story}</ol>
    ${c.conflicts.length ? `<h2 style="margin-top:16px">Git conflicts</h2><p class="mono">${c.conflicts.map(esc).join('<br>')}</p>` : ''}
    ${c.fails.length ? `<h2 style="margin-top:16px">Tests that failed</h2><p class="mono">${c.fails.map(esc).join('<br>')}</p>` : ''}
    <h2 style="margin-top:16px">Files</h2><p>${files || '<span class="muted">none</span>'}</p>
    ${c.diff ? `<h2 style="margin-top:16px">What landed</h2>${diff}<p class="muted" style="margin-top:8px">Commit ${esc(c.commit)} landed as ${esc(c.sha)} in <span class="mono">${esc(R.meta.git)}</span>.</p>` : ''}`;
}

function viewMain() {
  const rows = R.history.filter((h) => h.t <= t).slice().reverse().slice(0, 400).map(mainRow).join('');
  return `${crumbs([['Codebase', '#/'], ["Main's history"]])}${rows ? `<ul class="list">${rows}</ul>` : '<p class="muted">Nothing yet.</p>'}`;
}

let lastHash = null;
function render() {
  if (!R) return;
  $('tnow').textContent = clockS(t);
  renderAgents();
  const h = location.hash || '#/';
  let mm;
  const html = (mm = /^#\/folder\/(.+)$/.exec(h)) ? viewFolder(decodeURIComponent(mm[1]))
    : (mm = /^#\/file\/(\d+)$/.exec(h)) ? viewFile(+mm[1])
    : (mm = /^#\/change\/(\d+)$/.exec(h)) ? viewChange(+mm[1])
    : h === '#/main' ? viewMain() : viewCodebase();
  const v = $('view');
  // Keep the scroll position while time moves; jump to the top on navigation.
  v.innerHTML = html;
  if (h !== lastHash) { if (lastHash !== null && v.getBoundingClientRect().top < 0) v.scrollIntoView({ block: 'start' }); lastHash = h; }
}
$('view').addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]'); if (go) { location.hash = go.dataset.go; return; }
  const jt = e.target.closest('[data-t]'); if (jt) { t = +jt.dataset.t; $('t').value = t; render(); }
});
addEventListener('hashchange', render);
load(first.name);
