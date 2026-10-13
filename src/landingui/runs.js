// Scale runs, qodebase.app/runs (qb7, manager 2026-10-13: Eyal wants ONE page to watch the scale runs live).
// Fleet runs on qbfleet (current + recent) with state, auto-pause reason, stage counts, $ vs budget, calls/min per model
// vs its limit, landed/min, land-wait p50/p90, and a timeline per run (x = time; rows: each model's calls/min, landed,
// each lane's landings, the door, queue depth; pause/resume marks). Real builds link to their project timelines.
// Data (qb6's forq proxy, the fleet key stays on the server):
//   GET  /api/runs                                -> { owner, fleet: [run], real: [build] }
//   GET  /api/runs/<repo>/<runId>/series          -> { start, end, slice: 10000, series: [{ t, calls: {model: n}, r429, landed,
//        lanes: {lane: n}, usd, queue: {waiting, atModel, readyToLand}, landWaitP90 }], limits: {model: perMin}, marks }
//   POST /api/runs/<repo>/{pause,resume,stop}     owner only
// ?mock=1 reads /lab/runs-mock.json (same shapes, timelines inside). Polls every 5 s while a run is live.
(() => {
  const root = document.getElementById('runs');
  if (!root) return;
  const MOCK = new URLSearchParams(location.search).has('mock');
  const API = root.dataset.api || '/api/runs';
  let OWN = 'own' in root.dataset;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const log = (event, x) => { try { console.log(JSON.stringify({ module: 'runs', event, ...(x || {}) })); } catch (e) {} };
  const n0 = (x) => (x == null ? '–' : Number(x).toLocaleString('en-US'));
  const usd = (x) => (x == null ? '–' : x < 10 ? `$${x.toFixed(2)}` : `$${Math.round(x)}`);
  const clock = (s) => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60), h = Math.floor(m / 60); return h ? `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`; };
  const ago = (t) => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} days ago`; };
  const short = (m) => (m === 'cache' ? 'cache (answers reused, no model)' : String(m || '').replace(/^@cf\/[^/]+\//, '').replace(/-instruct$|-it$|-fp8$/g, ''));
  const pct = (a, b) => (b ? Math.max(0, Math.min(100, (100 * a) / b)) : 0);

  let D = null, TL = {}, failures = 0, timer = 0, lastOk = 0, stopAsk = {}, busy = false;
  const live = (r) => r.state === 'running' || r.state === 'paused';
  const key = (r) => `${r.repo}/${r.runId}`;

  // ---- data ------------------------------------------------------------------------------------------------------
  async function load() {
    if (MOCK) {
      const m = await fetch('/lab/runs-mock.json', { cache: 'no-store' }).then((r) => r.json());
      D = m; TL = m.timelines || {}; if (m.owner) OWN = true; return;
    }
    const r = await fetch(API, { cache: 'no-store', credentials: 'same-origin' });
    if (!r.ok) throw new Error(`runs ${r.status}`);
    D = await r.json();
    if (typeof D.owner === 'boolean') OWN = D.owner;
    // qb6: the newest run per repo carries live: <qbfleet /status> (state, counts, usd, pauses, landWaitS, lastMinute…);
    // the /runs row keeps the label and the per-model summary.
    D.fleet = (D.fleet || []).map((x) => (x.live && (!x.live.runId || x.live.runId === x.runId) ? { ...x, ...x.live, label: x.label || x.live.label, models: x.models || x.live.models, repo: x.repo || x.live.repo } : x));
  }
  async function loadTimeline(run) {
    if (MOCK) return TL[key(run)] || null;
    const r = await fetch(`${API}/${encodeURIComponent(run.repo)}/${encodeURIComponent(run.runId)}/series`, { cache: 'no-store', credentials: 'same-origin' });
    if (!r.ok) throw new Error(`timeline ${r.status}`);
    return (TL[key(run)] = await r.json());
  }

  // ---- one run -----------------------------------------------------------------------------------------------------
  const STATE = { running: 'Running', paused: 'Paused', done: 'Done', ended: 'Done', stopped: 'Stopped', failed: 'Failed', queued: 'Starting' };
  function stateTag(r) {
    const auto = r.state === 'paused' && autoWhy(r);
    return `<span class="rs-st st-${esc(r.state)}"><i></i>${esc(STATE[r.state] || r.state)}${auto ? ' automatically' : ''}</span>`;
  }
  // qb6: pauses [{at, why, auto}]; the newest one says why a paused run stopped taking work.
  const lastPause = (r) => (r.pauses || []).slice(-1)[0] || null;
  const autoWhy = (r) => r.autoPauseWhy || (lastPause(r)?.auto ? lastPause(r).why : '');
  function counts(r) {
    const c = r.counts || r;
    const files = r.files || 0, landed = c.landed || 0, skipped = c.skipped || 0, rejected = (c.rejected || 0) + (c.verify_fail || 0) + (c.model_error || 0);
    const inflight = Math.max(0, files - landed - skipped - rejected);
    return { files, landed, skipped, rejected, inflight };
  }
  function elapsedS(r) { return r.startedAt ? ((r.endedAt || Date.now()) - r.startedAt) / 1000 : 0; }
  function landedPerMin(r) {
    if (r.lastMinute && typeof r.lastMinute.landed === 'number' && live(r)) return r.lastMinute.landed;
    const s = elapsedS(r); return s > 30 ? Math.round((counts(r).landed / s) * 60) : null;
  }
  function modelsOf(r) {
    const m = r.models || {};
    return Object.entries(m).map(([name, x]) => ({ name, now: live(r) ? (x.lastMinute ?? x.perMin ?? null) : null, peak: x.peakPerMin ?? null, limit: x.limitPerMin ?? (D?.limits || {})[name] ?? null, calls: x.calls || 0, usd: x.usd, r429: x.rateLimited429 || 0, role: x.role }));
  }
  function card(r, full) {
    const c = counts(r), lpm = landedPerMin(r), budget = r.budgetUsd, spent = r.usd || 0;
    const seg = (n, cls) => (n ? `<i class="${cls}" style="width:${pct(n, c.files).toFixed(2)}%"></i>` : '');
    const mods = modelsOf(r);
    const modRows = mods.map((m) => {
      const v = m.now ?? m.peak, lim = m.limit;
      return `<div class="rm"><span class="rm-n">${esc(short(m.name))}${m.role === 'overflow' ? ' <small>overflow</small>' : ''}</span><span class="rm-v">${v == null ? '–' : n0(v)}${lim ? ` of ${n0(lim)}` : ''} per min${m.now == null && m.peak != null ? ' at peak' : ''}${m.r429 ? `, ${n0(m.r429)} refused (429)` : ''}</span>
        ${lim ? `<div class="bar" aria-hidden="true"><i style="width:${pct(v || 0, lim).toFixed(1)}%"${v / lim > 0.9 ? ' class="hot"' : ''}></i></div>` : ''}</div>`;
    }).join('');
    const why = r.state === 'paused' ? (autoWhy(r) || lastPause(r)?.why || '') : r.state === 'stopped' ? (r.stopWhy || '') : '';
    const ctl = OWN && live(r) ? controls(r) : '';
    const title = r.label || `${r.repo}${r.root ? ` ${r.root}` : ''}`;
    return `<article class="rc st-${esc(r.state)}" data-k="${esc(key(r))}">
      <div class="rc-h">${stateTag(r)}<span class="rc-t">${live(r) ? `running <b data-since="${r.startedAt}">${clock(elapsedS(r))}</b>` : r.endedAt ? `${clock(elapsedS(r))}, ended ${ago(r.endedAt)}` : ''}</span></div>
      ${full || r.group ? `<h2 class="rc-name">${esc(title)}</h2>` : `<a class="rc-name" href="#/run/${encodeURIComponent(r.repo)}/${encodeURIComponent(r.runId)}">${esc(title)}</a>`}
      <p class="rc-sub">${r.group ? `${r.copies.length} copies run side by side` : `${esc(r.repo)}${r.root ? `, ${esc(r.root)}` : ''}`}, ${n0(r.agentsStarted ?? r.agents)} of ${n0(r.agents)} agents started</p>
      ${why ? `<p class="rc-why">${r.state === 'paused' && autoWhy(r) ? 'Paused automatically: ' : ''}${esc(why)}</p>` : ''}
      <div class="rc-files"><div class="seg" role="img" aria-label="${c.landed} landed of ${c.files} files">${seg(c.landed, 's-l')}${seg(c.skipped, 's-s')}${seg(c.rejected, 's-r')}</div>
        <p><b>${n0(c.landed)}</b> landed, ${n0(c.skipped)} nothing to document, ${n0(c.rejected)} rejected${c.inflight && live(r) ? `, ${n0(c.inflight)} to go` : ''}, of ${n0(c.files)} files</p></div>
      <dl class="rc-k">
        <div><dt>Spent</dt><dd>${usd(spent)}${budget ? ` <small>of ${usd(budget)}</small>` : ''}</dd>${budget ? `<div class="bar" aria-hidden="true"><i style="width:${pct(spent, budget).toFixed(1)}%"${spent / budget > 0.85 ? ' class="hot"' : ''}></i></div>` : ''}</div>
        <div><dt>${live(r) ? 'Landed per min' : 'Landed per min, average'}</dt><dd>${lpm == null ? '–' : n0(lpm)}</dd></div>
        <div><dt>Wait to land</dt><dd>${r.landWaitS ? `${n0(r.landWaitS.p50)} s <small>median, ${n0(r.landWaitS.p90)} s slowest tenth</small>` : '–'}</dd></div>
        <div><dt>Model calls</dt><dd>${n0(r.calls ?? mods.reduce((a, m) => a + m.calls, 0))}</dd></div>
      </dl>
      ${modRows ? `<div class="rc-m"><p class="rc-mh">Calls per minute, per model${live(r) ? '' : ' (peak)'}</p>${modRows}</div>` : ''}
      ${ctl}
      ${r.group ? copyRows(r) : ''}
      ${full || r.group ? '' : `<a class="chipbtn rc-go" href="#/run/${encodeURIComponent(r.repo)}/${encodeURIComponent(r.runId)}">Timeline</a>`}
    </article>`;
  }
  function controls(r) {
    const k = key(r), asking = stopAsk[k] && Date.now() - stopAsk[k] < 10e3, all = r.group ? ` all ${r.copies.length}` : '';
    const reposAttr = r.group ? ` data-repos="${esc(r.copies.filter(live).map((c) => c.repo).join(','))}"` : '';
    if (asking) return `<div class="rc-ctl" role="group" aria-label="Run controls"><button class="btn danger" type="button" data-ctl="stop" data-k="${esc(k)}"${reposAttr}>${r.group ? `Stop${all} copies` : 'Stop this run'}</button><button class="chipbtn" type="button" data-ctl="cancel" data-k="${esc(k)}">Keep going</button><p class="rc-cn">Stop ends the run; what has landed stays. It cannot be resumed.</p></div>`;
    return `<div class="rc-ctl" role="group" aria-label="Run controls"><button class="chipbtn" type="button" data-ctl="${r.state === 'paused' ? 'resume' : 'pause'}" data-k="${esc(k)}"${reposAttr}>${r.state === 'paused' ? 'Resume' : 'Pause'}${all}</button><button class="chipbtn danger" type="button" data-ctl="ask" data-k="${esc(k)}">Stop${all}</button></div>`;
  }

  // ---- the timeline ----------------------------------------------------------------------------------------------
  // One SVG, rows stacked; x = minutes from the run's start. A row's label sits above its strip (no sticky column on a
  // phone). The SVG is at least 12 px per minute and scrolls sideways in its frame when that is wider than the screen.
  // qb6's series come in 10 s slices; buckets of whole slices keep ~120 columns at most, and every rate is shown per
  // minute so it lines up with the models' per-minute limits. Lanes stay counts per bucket (the heat rows).
  function bucketed(t) {
    const src = (t.series || []).map((s) => ({ ...s, minute: s.minute ?? s.t }));
    const slice = t.slice || t.minute || 60000;
    if (!src.length) return { S: [], step: slice };
    const span = src[src.length - 1].minute - src[0].minute + slice;
    const k = Math.max(1, Math.ceil(span / slice / 120)), step = slice * k, perMin = 60000 / step, t0 = src[0].minute;
    const out = new Map();
    for (const s of src) {
      const b = t0 + Math.floor((s.minute - t0) / step) * step;
      const o = out.get(b) || { minute: b, calls: {}, landed: 0, lanes: {}, r429: 0, usd: 0, queue: null, door: null, n: 0 };
      for (const [m, v] of Object.entries(s.calls || {})) o.calls[m] = (o.calls[m] || 0) + v;
      for (const [l, v] of Object.entries(s.lanes || {})) o.lanes[l] = (o.lanes[l] || 0) + v;
      o.landed += s.landed || 0; o.r429 += s.r429 || 0; o.usd += s.usd || 0; o.n++;
      const q = typeof s.queue === 'number' ? s.queue : s.queue ? (s.queue.waiting || 0) + (s.queue.atModel || 0) + (s.queue.readyToLand || 0) : null;
      if (q != null) o.queue = Math.max(o.queue || 0, q);   // sampled: the deepest moment in the bucket
      if (s.door) o.door = { commits: (o.door?.commits || 0) + (s.door.commits || 0), pushes: (o.door?.pushes || 0) + (s.door.pushes || 0) };
      out.set(b, o);
    }
    // Buckets of a minute or more show rates per minute (to line up with per-minute limits); shorter buckets (runs under
    // ~20 min) show plain counts per bucket, so one burst is not blown up into a per-minute rate it never had.
    const asRate = step >= 60000, f = asRate ? perMin : 1;
    const S = [...out.values()].sort((a, b) => a.minute - b.minute).map((o) => ({ ...o, calls: Object.fromEntries(Object.entries(o.calls).map(([m, v]) => [m, Math.round(v * f)])), landed: Math.round(o.landed * f) }));
    return { S, step, unit: asRate ? 'per min' : `per ${Math.round(step / 1000)} s`, limScale: asRate ? 1 : step / 60000 };
  }
  function timeline(run, t) {
    if (!t) return '<p class="tl-empty">Loading the timeline…</p>';
    const { S, step: stepMs, unit, limScale } = bucketed(t);
    t = { ...t, minute: stepMs };
    if (!S.length) return '<p class="tl-empty">Nothing on the timeline yet: the first minute is still running.</p>';
    const W0 = Math.max(root.clientWidth - 24, 300), per = Math.max(12, Math.floor(W0 / S.length)), W = Math.max(W0, per * S.length);
    const t0 = S[0].minute, x = (m) => ((m - t0) / (t.minute || 60000)) * per;
    const rows = [], H = 34, GAP = 22;
    const models = Object.keys(Object.assign({}, ...S.map((s) => s.calls || {})));
    for (const m of models) {
      const peak = Math.max(...S.map((s) => (s.calls || {})[m] || 0)), lim0 = (t.limits || {})[m], lim = lim0 ? lim0 * limScale : null;
      const drawLim = lim && lim <= peak * 4;   // a limit far above the peak would flatten the chart: named, not drawn
      rows.push({ label: `${short(m)}: calls ${unit}, peak ${n0(peak)}${lim0 ? `, limit ${n0(lim0)} per min` : ''}`, kind: 'area', vals: S.map((s) => (s.calls || {})[m] || 0), max: Math.max(drawLim ? lim : 0, peak, 1), lim: drawLim ? lim : null, cls: 'c-model' });
    }
    { const peak = Math.max(...S.map((s) => s.landed || 0)); rows.push({ label: `Landed ${unit}, peak ${n0(peak)}`, kind: 'bars', vals: S.map((s) => s.landed || 0), max: Math.max(peak, 1), cls: 'c-land' }); }
    const lanes = Object.keys(Object.assign({}, ...S.map((s) => s.lanes || {}))).filter((l) => l !== 'other');
    if (S.some((s) => (s.lanes || {}).other)) lanes.push('other');
    const laneMax = Math.max(1, ...S.flatMap((s) => Object.values(s.lanes || {})));
    if (lanes.length) rows.push({ label: `Landings per lane (${lanes.length}${lanes.includes('other') ? ', smaller lanes together' : ''}), darker = more`, kind: 'heat', lanes, max: laneMax });
    if (S.some((s) => s.door)) { const peak = Math.max(...S.map((s) => (s.door?.commits || 0))); rows.push({ label: `The door: commits per min (pushes as ticks), peak ${n0(peak)}`, kind: 'door', vals: S.map((s) => s.door?.commits || 0), ticks: S.map((s) => s.door?.pushes || 0), max: Math.max(peak, 1), cls: 'c-door' }); }
    if (S.some((s) => s.queue != null)) { const peak = Math.max(...S.map((s) => s.queue || 0)); rows.push({ label: `Waiting to land, peak ${n0(peak)}`, kind: 'area', vals: S.map((s) => s.queue || 0), max: Math.max(peak, 1), cls: 'c-queue' }); }
    // Each row: a label pinned to the left of the scrolling frame (sticky), then its own SVG strip. One overlay SVG on
    // top carries the time grid and the pause/resume marks across every row.
    const strip = (r) => {
      const h = r.kind === 'heat' ? r.lanes.length * 10 : H, base = h, parts = [`<rect class="tl-bg" x="0" y="0" width="${W}" height="${h}" rx="4"/>`];
      if (r.kind === 'area') {
        const pts = r.vals.map((v, i) => `${(x(S[i].minute) + per / 2).toFixed(1)},${(base - (v / r.max) * (h - 2)).toFixed(1)}`);
        parts.push(`<path class="tl-a ${r.cls}" d="M${(x(S[0].minute) + per / 2).toFixed(1)},${base} L${pts.join(' L')} L${(x(S[S.length - 1].minute) + per / 2).toFixed(1)},${base} Z"/>`);
        if (r.lim) { const ly = (base - (r.lim / r.max) * (h - 2)).toFixed(1); parts.push(`<line class="tl-lim" x1="0" x2="${W}" y1="${ly}" y2="${ly}"/>`); }
      } else if (r.kind === 'bars' || r.kind === 'door') {
        r.vals.forEach((v, i) => { if (!v) return; const bh = Math.max(1.5, (v / r.max) * (h - 2)); parts.push(`<rect class="tl-b ${r.cls}" x="${(x(S[i].minute) + 1).toFixed(1)}" y="${(base - bh).toFixed(1)}" width="${Math.max(2, per - 2)}" height="${bh.toFixed(1)}" rx="1.5"/>`); });
        if (r.ticks) r.ticks.forEach((v, i) => { if (!v) return; parts.push(`<rect class="tl-tick" x="${(x(S[i].minute) + per / 2 - 1).toFixed(1)}" y="1" width="2" height="${Math.min(h - 2, 4 + v * 2)}"/>`); });
      } else if (r.kind === 'heat') {
        r.lanes.forEach((ln, j) => S.forEach((s) => { const v = (s.lanes || {})[ln] || 0; if (!v) return; parts.push(`<rect class="tl-h" x="${(x(s.minute) + 0.5).toFixed(1)}" y="${j * 10 + 1}" width="${Math.max(2, per - 1)}" height="8" rx="1" style="opacity:${(0.18 + 0.82 * (v / r.max)).toFixed(2)}"><title>${esc(ln)}: ${v}</title></rect>`); }));
      }
      return `<div class="tl-row"><p class="tl-lab"><span>${esc(r.label)}</span></p><svg class="tl-s" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" aria-hidden="true">${parts.join('')}</svg></div>`;
    };
    // ticks on round times: every 10 s, 30 s, 1, 2, 5, 10 or 30 min, at least ~56 px apart
    const nice = [10e3, 30e3, 60e3, 120e3, 300e3, 600e3, 1800e3, 3600e3].find((ms) => (ms / stepMs) * per >= 56) || 3600e3;
    const every = Math.max(1, Math.round(nice / stepMs)), lab = (i) => { const sec = Math.round((i * stepMs) / 1000); return i === 0 ? 'start' : sec < 120 ? `${sec} s` : `${Math.round(sec / 60)} min`; };
    const grid = S.map((s, i) => (i % every === 0 ? `<line class="tl-g" x1="${x(s.minute).toFixed(1)}" x2="${x(s.minute).toFixed(1)}" y1="0" y2="100%"/>` : '')).join('');
    const near = (px) => (t.marks || []).some((m) => Math.abs(x(m.at) - px) < 70);
    const axis = S.map((s, i) => (i % every === 0 && !near(x(s.minute)) ? `<text class="tl-x" x="${(x(s.minute) + 2).toFixed(1)}" y="12">${lab(i)}</text>` : '')).join('');
    const MK = (k) => (k === 'auto_pause' ? 'pause' : k), MW = (k) => (k === 'auto_pause' ? 'auto-paused' : k === 'pause' ? 'paused' : k === 'resume' ? 'resumed' : k === 'stop' ? 'stopped' : k);
    const marks = (t.marks || []).map((m) => { const mx = Math.max(1, Math.min(W - 1, x(m.at))); return `<line class="tl-m m-${esc(MK(m.kind))}" x1="${mx.toFixed(1)}" x2="${mx.toFixed(1)}" y1="0" y2="100%"/>`; }).join('');
    const mlabels = (t.marks || []).map((m) => { const mx = Math.max(1, Math.min(W - 60, x(m.at))); return `<text class="tl-mt m-${esc(MK(m.kind))}" x="${(mx + 3).toFixed(1)}" y="12">${esc(MW(m.kind))}</text>`; }).join('');
    const legend = (t.marks || []).length ? `<ul class="tl-ml">${(t.marks || []).map((m) => `<li><i class="m-${esc(MK(m.kind))}"></i>${esc(MW(m.kind).replace(/^./, (c) => c.toUpperCase()))} ${clock((m.at - t0) / 1000)} in${m.why ? `: ${esc(m.why)}` : ''}</li>`).join('')}</ul>` : '';
    return `<div class="tl-frame" tabindex="0" role="group" aria-label="Timeline of the run; scrolls sideways"><div class="tl-in" style="width:${W}px">
      <svg class="tl-ov" width="${W}" height="100%" aria-hidden="true">${grid}${marks}</svg>
      ${rows.map(strip).join('')}
      <svg class="tl-ax" width="${W}" height="16" aria-hidden="true">${axis}${mlabels}</svg></div></div>${legend}`;
  }

  // ---- copies: one ladder step runs as N copies (label '… - copy N'); the step is one card with the copies under it ---
  const baseOf = (r) => { const m = /^(.*?)\s*[-–]\s*copy\s+\d+$/i.exec(r.label || ''); return m ? m[1] : null; };
  function grouped(list) {
    const out = [], seen = new Map();
    for (const r of list) {
      const b = baseOf(r);
      if (!b) { out.push(r); continue; }
      let g = seen.get(b);
      if (!g) { g = { group: true, label: b, copies: [], repo: r.repo, runId: `group:${b}` }; seen.set(b, g); out.push(g); }
      g.copies.push(r);
    }
    for (const g of out.filter((x) => x.group)) {
      const cs = g.copies, sum = (f) => cs.reduce((a, c) => a + (f(c) || 0), 0);
      const st = cs.some((c) => c.state === 'running') ? 'running' : cs.some((c) => c.state === 'paused') ? 'paused' : cs.every((c) => c.state === 'stopped') ? 'stopped' : 'done';
      const C = (c) => counts(c);
      const models = {};
      for (const c of cs) for (const [m, x] of Object.entries(c.models || {})) { const o = (models[m] ||= { calls: 0, usd: 0, rateLimited429: 0, peakPerMin: 0, lastMinute: 0, limitPerMin: x.limitPerMin }); o.calls += x.calls || 0; o.usd += x.usd || 0; o.rateLimited429 += x.rateLimited429 || 0; o.peakPerMin += x.peakPerMin || 0; o.lastMinute += x.lastMinute || 0; }
      const p50s = cs.map((c) => c.landWaitS?.p50).filter((v) => v != null), p90s = cs.map((c) => c.landWaitS?.p90).filter((v) => v != null);
      Object.assign(g, { state: st, files: sum((c) => c.files), counts: { landed: sum((c) => C(c).landed), skipped: sum((c) => C(c).skipped), rejected: sum((c) => C(c).rejected) },
        usd: sum((c) => c.usd), budgetUsd: sum((c) => c.budgetUsd) || null, agents: sum((c) => c.agents), agentsStarted: sum((c) => c.agentsStarted ?? c.agents), calls: sum((c) => c.calls),
        startedAt: Math.min(...cs.map((c) => c.startedAt || Infinity)), endedAt: cs.every((c) => c.endedAt) ? Math.max(...cs.map((c) => c.endedAt)) : null,
        lastMinute: { landed: sum((c) => c.lastMinute?.landed), calls: sum((c) => c.lastMinute?.calls) },
        landWaitS: p90s.length ? { p50: Math.round(p50s.reduce((a, v) => a + v, 0) / p50s.length), p90: Math.max(...p90s) } : null,
        models, pauses: cs.flatMap((c) => c.pauses || []).sort((a, b) => a.at - b.at), repos: cs.map((c) => c.repo) });
    }
    return out;
  }
  function copyRows(g) {
    return `<ul class="rcp">${g.copies.map((c, i) => { const k = counts(c); return `<li><a href="#/run/${encodeURIComponent(c.repo)}/${encodeURIComponent(c.runId)}"><span class="rs-st st-${esc(c.state)}"><i></i>${esc((/copy\s+(\d+)$/i.exec(c.label || '') || [])[1] ? `Copy ${/copy\s+(\d+)$/i.exec(c.label)[1]}` : c.repo)}</span><span class="rcp-v">${n0(k.landed)} of ${n0(k.files)} landed, ${esc((STATE[c.state] || c.state).toLowerCase())}</span><span class="rr-go">Timeline</span></a></li>`; }).join('')}</ul>`;
  }

  // ---- pages -------------------------------------------------------------------------------------------------------
  function listView() {
    const fleet = grouped((D.fleet || []).slice().sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))).sort((a, b) => (live(b) - live(a)) || (b.startedAt || 0) - (a.startedAt || 0));
    const cur = fleet.filter(live), past = fleet.filter((r) => !live(r));
    const real = D.real || [];
    const realRow = (b) => `<li><a href="${esc(b.link || `/p/${b.slug.replace('.', '/')}/work#/timeline`)}"><span class="rr-n"><b>${esc(b.label || b.slug)}</b><small>${esc(b.slug.replace('.', ' / '))}</small></span><span class="rr-v">${b.settledAt ? `${clock((b.settledAt - b.startedAt) / 1000)}, ${usd(b.usd)}` : b.startedAt ? `running, ${usd(b.usd)} so far` : '–'}${b.parts ? `<small>${n0(b.landed)} of ${n0(b.parts)} parts</small>` : b.landed ? `<small>${n0(b.landed)} landed</small>` : ''}</span><span class="rr-go">Timeline</span></a></li>`;
    return `<header class="rh"><h1>Scale runs</h1><p class="rh-s"><i class="live${cur.length ? '' : ' off'}"></i><span id="rupd">${cur.length ? `${cur.length} running now` : 'Nothing running now'}</span>${OWN ? '' : '<span class="rh-ro">read-only</span>'}</p></header>
      ${cur.length ? `<section class="rsec"><h2>Now</h2>${cur.map((r) => card(r, false)).join('')}</section>` : ''}
      <section class="rsec"><h2>${cur.length ? 'Earlier' : 'Fleet runs'}</h2>${past.length ? past.slice(0, 20).map((r) => card(r, false)).join('') : '<p class="dim">No fleet runs yet.</p>'}</section>
      ${real.length ? `<section class="rsec"><h2>Real builds</h2><p class="dim">Real Claude Code agents building an app; each opens its project's timeline.</p><ul class="rr">${real.map(realRow).join('')}</ul></section>` : ''}`;
  }
  function runView(repo, id) {
    const r = (D.fleet || []).find((x) => x.repo === repo && x.runId === id);
    if (!r) return `<p><a href="#/">All runs</a></p><p>That run is not in the list any more.</p>`;
    return `<p class="crumb"><a href="#/">All runs</a></p>${card(r, true)}<section class="rsec"><h2>Timeline</h2>${timeline(r, TL[key(r)])}</section>`;
  }

  let lastHtml = '';
  function render() {
    if (!D) return;
    const m = /^#\/run\/([^/]+)\/([^/]+)$/.exec(location.hash);
    const html = m ? runView(decodeURIComponent(m[1]), decodeURIComponent(m[2])) : listView();
    const k = html.replace(/(data-since="\d+">)[^<]*/g, '$1');
    if (k === lastHtml || busy) return tickClocks();
    const ctlF = document.activeElement?.closest?.('.rc-ctl') ? document.activeElement.dataset.ctl : null;
    const fr = root.querySelector('.tl-frame'), sx = fr ? fr.scrollLeft : null, atEnd = fr ? fr.scrollLeft + fr.clientWidth >= fr.scrollWidth - 4 : true;
    lastHtml = k; root.innerHTML = html;
    const f2 = root.querySelector('.tl-frame'); if (f2) f2.scrollLeft = atEnd ? f2.scrollWidth : sx;   // a live run keeps showing its newest minute
    if (ctlF) root.querySelector(`[data-ctl="${ctlF}"]`)?.focus({ preventScroll: true });
  }
  function tickClocks() { root.querySelectorAll('[data-since]').forEach((b) => { b.textContent = clock((Date.now() - +b.dataset.since) / 1000); }); }

  async function tick() {
    clearTimeout(timer);
    try {
      await load(); failures = 0; lastOk = Date.now();
      const m = /^#\/run\/([^/]+)\/([^/]+)$/.exec(location.hash);
      if (m) { const r = (D.fleet || []).find((x) => x.repo === decodeURIComponent(m[1]) && x.runId === decodeURIComponent(m[2])); if (r && (live(r) || !TL[key(r)])) await loadTimeline(r).catch((e) => log('timeline_failed', { error: String(e) })); }
      render();
    } catch (e) { failures++; log('poll_failed', { error: String(e), failures }); if (!D) root.innerHTML = `<header class="rh"><h1>Scale runs</h1></header><p class="dim">Could not load the runs (${esc(String(e.message || e))}). Trying again.</p>`; }
    const anyLive = (D?.fleet || []).some(live);
    timer = setTimeout(tick, document.hidden ? 30e3 : anyLive ? 5e3 : 30e3 * Math.min(4, 2 ** failures));
  }
  addEventListener('hashchange', () => { lastHtml = ''; render(); tick(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  setInterval(tickClocks, 1000);

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ctl]'); if (!b) return;
    const k = b.dataset.k, act = b.dataset.ctl, repos = b.dataset.repos ? b.dataset.repos.split(',').filter(Boolean) : [k.split('/')[0]], repo = repos.join(',');
    if (act === 'ask') { stopAsk[k] = Date.now(); lastHtml = ''; render(); root.querySelector(`[data-ctl="stop"][data-k="${CSS.escape(k)}"]`)?.focus(); setTimeout(() => { lastHtml = ''; render(); }, 10.1e3); return; }
    if (act === 'cancel') { delete stopAsk[k]; lastHtml = ''; render(); return; }
    if (act === 'stop' && !(stopAsk[k] && Date.now() - stopAsk[k] < 10e3)) { delete stopAsk[k]; lastHtml = ''; render(); return; }
    delete stopAsk[k]; b.disabled = true; busy = true;
    let r = { ok: false, status: 0 };
    try {
      const rs = MOCK ? repos.map(() => ({ ok: true, status: 200 })) : await Promise.all(repos.map((rp) => fetch(`${API}/${encodeURIComponent(rp)}/${act}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ why: `${act === 'pause' ? 'paused' : act === 'stop' ? 'stopped' : 'resumed'} from qodebase.app/runs` }) }).catch(() => ({ ok: false, status: 0 }))));
      r = rs.find((x) => !x.ok) || rs[0] || r;
    } catch (x) {}
    log('control', { repo, action: act, ok: r.ok, status: r.status });
    busy = false; b.disabled = false;
    const say = b.closest('.rc')?.querySelector('.rc-ctl');
    if (!r.ok && say) { const p = document.createElement('p'); p.className = 'rc-cn bad'; p.textContent = r.status === 403 || r.status === 401 ? 'Only the owner can do that.' : 'That did not work. Try again.'; say.append(p); return; }
    lastHtml = ''; tick();
  });

  tick();
})();
