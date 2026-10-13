// Scale runs, qodebase.app/runs (qb7, manager 2026-10-13: Eyal wants ONE page to watch the scale runs live).
// Fleet runs on qbfleet (current + recent) with state, auto-pause reason, stage counts, $ vs budget, calls/min per model
// vs its limit, landed/min, land-wait p50/p90, and a timeline per run (x = time; rows: each model's calls/min, landed,
// each lane's landings, the door, queue depth; pause/resume marks). Real builds link to their project timelines.
// Data (qb6's forq proxy, the fleet key stays on the server):
//   GET  /api/runs                                -> { owner, fleet: [run], real: [build] }
//   GET  /api/runs/<repo>/<runId>/series          -> { start, end, slice: 10000, series: [{ t, calls: {model: n}, r429, landed,
//        lanes: {lane: n}, usd, queue: {waiting, atModel, readyToLand}, landWaitP90 }], limits: {model: perMin}, marks }
//   GET  /api/runs/<repo>/<runId>/slice?t=&to=    -> { t, changes: [{file, agent, picked, answered, source, verified, landed, status}] }
//   GET  /api/runs/<repo>/<runId>/agent/<agent>   -> { agent, files: [{file, picked, answered, verified, landed, status}] }
//   GET  /api/runs/<repo>/<runId>/change?file=    -> { file, agent, status, picked, answered, source, model, verified, landed, diff }
//   POST /api/runs/<repo>/{pause,resume,stop}     owner only
// Words (Eyal, 2026-10-13): a change = comments added to one file; 'on main' = landed; 'already had them' = nothing to do.
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
    TLat[key(run)] = Date.now();
    return (TL[key(run)] = await r.json());
  }
  // A step with many copies (S4d: 100) is fetched at most 10 at a time, and a copy at most every 15 s past 20 copies.
  const TLat = {};
  const openCopies = new Set();   // which steps' 'Show all copies' are open: kept across the 5 s refresh
  // A ladder step's own summed series (qb6: /api/runs/ladder/<ladder>/series); copies summed in the page otherwise.
  async function loadLadder(g) {
    const lad = g.copies[0]?.ladder; if (!lad || MOCK) return false;
    const k = 'ladder:' + lad;
    if (TL[k] && !live(g) && TL[k].series) return true;
    if (TL[k] && Date.now() - (TLat[k] || 0) < 5e3) return true;
    const r = await fetch(`${API}/ladder/${encodeURIComponent(lad)}/series`, { cache: 'no-store', credentials: 'same-origin' }).catch(() => null);
    if (!r || !r.ok) return false;
    const j = await r.json(); TLat[k] = Date.now();
    TL[k] = { start: j.series?.[0]?.t, slice: j.slice || 10000, series: j.series || [], limits: j.limits || {}, marks: j.marks || [] };
    return true;
  }
  async function loadMany(runs) {
    const gap = runs.length > 20 ? 15e3 : 4e3, q = runs.filter((r) => !TL[key(r)] || (live(r) && Date.now() - (TLat[key(r)] || 0) > gap));
    for (let i = 0; i < q.length; i += 10) await Promise.all(q.slice(i, i + 10).map((r) => loadTimeline(r).catch((e) => log('timeline_failed', { repo: r.repo, error: String(e) }))));
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
  // Live: the last minute's landings. Finished: an average over the minutes it ran; under 2 min the plain count and time,
  // never a per-minute rate the run did not last long enough to have (critique).
  function landedPerMin(r) {
    if (r.lastMinute && typeof r.lastMinute.landed === 'number' && live(r)) return n0(r.lastMinute.landed);
    const s = elapsedS(r), l = counts(r).landed;
    if (!s || !l) return '–';
    return s < 120 && !live(r) ? `${n0(l)} <small>in ${Math.round(s)} s</small>` : n0(Math.round((l / s) * 60));
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
      return `<div class="rm"><span class="rm-n">${esc(short(m.name))}${m.role === 'overflow' ? ' <small>overflow</small>' : ''}</span><span class="rm-v">${m.now == null && m.peak != null ? 'peak ' : ''}${v == null ? '–' : n0(v)}${lim ? ` of ${n0(lim)}` : ''}/min${m.r429 ? `, ${n0(m.r429)} refused` : ''}</span>
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
      <div class="rc-files"><div class="seg" role="img" aria-label="${c.landed} of ${c.files} files got comments on main">${seg(c.landed, 's-l')}${seg(c.skipped, 's-s')}${seg(c.rejected, 's-r')}</div>
        <p>Agents ${live(r) ? 'have added' : 'added'} doc comments to <b>${n0(c.landed)}</b> files and committed them to ${r.group ? 'each copy\u2019s' : 'the'} main branch; ${n0(c.skipped)} files already had them.</p>
        <p class="rc-sm">${n0(c.rejected)} rejected${c.inflight && live(r) ? `, ${n0(c.inflight)} still to do` : ''}, of ${n0(c.files)} files. One change = comments added to one file.</p></div>
      <dl class="rc-k">
        <div><dt>Spent</dt><dd>${usd(spent)}${budget ? ` <small>of ${usd(budget)}</small>` : ''}</dd>${budget ? `<div class="bar" aria-hidden="true"><i style="width:${pct(spent, budget).toFixed(1)}%"${spent / budget > 0.85 ? ' class="hot"' : ''}></i></div>` : ''}</div>
        <div><dt>${live(r) ? 'Changes on main per min' : elapsedS(r) < 120 ? 'Changes on main' : 'Changes on main per min, average'}</dt><dd>${lpm}</dd></div>
        <div><dt>Wait to reach main</dt><dd>${r.landWaitS && r.landWaitS.p50 != null ? `${n0(r.landWaitS.p50)} s <small>median, ${n0(r.landWaitS.p90)} s slowest tenth</small>` : '–'}</dd></div>
        <div><dt>Answers</dt><dd>${(() => { const fromCache = mods.filter((m) => m.name === 'cache').reduce((a, m) => a + m.calls, 0), fromModel = mods.filter((m) => m.name !== 'cache').reduce((a, m) => a + m.calls, 0); return `${n0(fromCache)} <small>from cache</small> ${n0(fromModel)} <small>from a model</small>`; })()}</dd></div>
      </dl>
      ${modRows ? `<div class="rc-m"><p class="rc-mh">Calls per minute, per model${live(r) ? '' : ' (peak)'}</p>${modRows}</div>` : ''}
      ${ctl}
      ${r.group ? copyRows(r) : ''}
      ${r.group && !full ? `<a class="chipbtn rc-go" href="#/step/${encodeURIComponent(r.label)}">Timeline, all copies</a>` : ''}
      ${full || r.group ? '' : `<a class="chipbtn rc-go" href="#/run/${encodeURIComponent(r.repo)}/${encodeURIComponent(r.runId)}">Timeline</a>`}
    </article>`;
  }
  function controls(r) {
    const k = key(r), asking = stopAsk[k] && Date.now() - stopAsk[k] < 10e3, all = r.group ? ` all ${r.copies.length}` : '';
    const reposAttr = r.group ? ` data-repos="${esc(r.copies.filter(live).map((c) => c.repo).join(','))}"` : '';
    if (asking) return `<div class="rc-ctl" role="group" aria-label="Run controls"><button class="btn danger" type="button" data-ctl="stop" data-k="${esc(k)}"${reposAttr}>${r.group ? `Stop${all} copies` : 'Stop this run'}</button><button class="chipbtn" type="button" data-ctl="cancel" data-k="${esc(k)}">Keep going</button><p class="rc-cn">Stop ends the run; what is already on main stays. It cannot be resumed.</p></div>`;
    return `<div class="rc-ctl" role="group" aria-label="Run controls"><button class="chipbtn" type="button" data-ctl="${r.state === 'paused' ? 'resume' : 'pause'}" data-k="${esc(k)}"${reposAttr}>${r.state === 'paused' ? 'Resume' : 'Pause'}${all}</button><button class="chipbtn danger" type="button" data-ctl="ask" data-k="${esc(k)}">Stop${all}</button></div>`;
  }

  // ---- the timeline ----------------------------------------------------------------------------------------------
  // x = time from the run's start, one shared axis for every row. qb6's series come in 10 s slices; buckets of whole
  // slices keep ~120 columns at most (empty ones filled: the series skips quiet slices). Buckets of a minute or more
  // show rates per minute (to line up with per-minute limits); shorter ones show plain counts per bucket.
  // Rows, top first (Eyal, 2026-10-13): active agents; changes (finished by agents = ready, and reached main: they land
  // in batches, so the two are shown apart); each model's calls vs its limit; changes per lane; waiting; the door if
  // present. Every chart has a y-scale (its top value and 0), pinned left with the row's label while it scrolls.
  // Tap a column: what happened in that slice; from there an agent's files, or one change's comments and timings.
  function bucketed(t) {
    const src = (t.series || []).map((s) => ({ ...s, minute: s.minute ?? s.t }));
    const slice = t.slice || t.minute || 60000;
    if (!src.length) return { S: [], step: slice };
    const span = src[src.length - 1].minute - src[0].minute + slice;
    const k = Math.max(1, Math.ceil(span / slice / 120)), step = slice * k, perMin = 60000 / step, t0 = src[0].minute;
    const blank = (b) => ({ minute: b, calls: {}, landed: 0, ready: null, active: null, lanes: {}, r429: 0, usd: 0, queue: null, door: null, n: 0 });
    const out = new Map();
    for (const s of src) {
      const b = t0 + Math.floor((s.minute - t0) / step) * step;
      const o = out.get(b) || blank(b);
      for (const [m, v] of Object.entries(s.calls || {})) o.calls[m] = (o.calls[m] || 0) + v;
      for (const [l, v] of Object.entries(s.lanes || {})) o.lanes[l] = (o.lanes[l] || 0) + v;
      o.landed += s.landed || 0; o.r429 += s.r429 || 0; o.usd += s.usd || 0; o.n++;
      if (s.ready != null) o.ready = (o.ready || 0) + s.ready;
      if (s.active != null) o.active = Math.max(o.active || 0, s.active);   // agents at work: the busiest slice in the bucket
      const q = typeof s.queue === 'number' ? s.queue : s.queue ? (s.queue.waiting || 0) + (s.queue.atModel || 0) + (s.queue.readyToLand || 0) : null;
      if (q != null) o.queue = Math.max(o.queue || 0, q);
      // the door (qb6): the Lander's pushes to main, with the files they carried
      if (s.door) o.door = { files: (o.door?.files || 0) + (s.door.files ?? s.door.commits ?? 0), pushes: (o.door?.pushes || 0) + (s.door.pushes || 0) };
      out.set(b, o);
    }
    const last = Math.max(...out.keys());
    for (let b = t0; b <= last; b += step) if (!out.has(b)) out.set(b, blank(b));
    const asRate = step >= 60000, f = asRate ? perMin : 1, sc = (v) => (v == null ? null : Math.round(v * f));
    const S = [...out.values()].sort((a, b) => a.minute - b.minute).map((o) => ({ ...o, raw: { landed: o.landed, ready: o.ready, calls: { ...o.calls } }, calls: Object.fromEntries(Object.entries(o.calls).map(([m, v]) => [m, sc(v)])), landed: sc(o.landed), ready: sc(o.ready) }));
    return { S, step, unit: asRate ? 'per min' : `per ${Math.round(step / 1000)} s`, limScale: asRate ? 1 : step / 60000 };
  }
  // A ladder step's copies summed slice by slice (their slices share the 10 s grid).
  function summed(ts) {
    const by = new Map(); let slice = 10000, start = Infinity, end = 0; const limits = {}, marks = [];
    for (const t of ts.filter(Boolean)) {
      slice = t.slice || slice; start = Math.min(start, t.start || Infinity); end = Math.max(end, t.end || 0); Object.assign(limits, t.limits || {});
      for (const s of t.series || []) {
        const o = by.get(s.t) || { t: s.t, calls: {}, lanes: {}, landed: 0, ready: null, active: null, r429: 0, usd: 0, queue: null };
        for (const [m, v] of Object.entries(s.calls || {})) o.calls[m] = (o.calls[m] || 0) + v;
        for (const [l, v] of Object.entries(s.lanes || {})) o.lanes[l] = (o.lanes[l] || 0) + v;
        o.landed += s.landed || 0; o.r429 += s.r429 || 0; o.usd += s.usd || 0;
        if (s.ready != null) o.ready = (o.ready || 0) + s.ready;
        if (s.active != null) o.active = (o.active || 0) + s.active;
        if (s.door) o.door = { files: (o.door?.files || 0) + (s.door.files || 0), pushes: (o.door?.pushes || 0) + (s.door.pushes || 0) };
        const q = typeof s.queue === 'number' ? s.queue : s.queue ? (s.queue.waiting || 0) + (s.queue.atModel || 0) + (s.queue.readyToLand || 0) : null;
        if (q != null) o.queue = (o.queue || 0) + q;
        by.set(s.t, o);
      }
    }
    // a summed lane heat would be 20 copies x 20 lanes: keep the ten busiest lane names, the rest as 'other'
    const series = [...by.values()].sort((a, b) => a.t - b.t);
    const tot = {}; for (const s of series) for (const [l, v] of Object.entries(s.lanes)) tot[l] = (tot[l] || 0) + v;
    const keep = new Set(Object.entries(tot).filter(([l]) => l !== 'other').sort((a, b) => b[1] - a[1]).slice(0, 10).map(([l]) => l));
    for (const s of series) { const L = {}; for (const [l, v] of Object.entries(s.lanes)) { const k = keep.has(l) ? l : 'other'; L[k] = (L[k] || 0) + v; } s.lanes = L; }
    return { start, end: end || null, slice, series, limits, marks };
  }
  const nice = (v) => { if (v <= 10) return Math.max(1, Math.ceil(v)); const p = 10 ** Math.floor(Math.log10(v)), m = v / p; return (m <= 1 ? 1 : m <= 1.5 ? 1.5 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 3 ? 3 : m <= 4 ? 4 : m <= 5 ? 5 : m <= 6 ? 6 : m <= 8 ? 8 : 10) * p; };
  const kfmt = (v) => (v >= 10000 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(v));
  function timeline(run, t, drill) {
    if (!t) return '<p class="tl-empty">Loading the timeline…</p>';
    const { S, step: stepMs, unit, limScale } = bucketed(t);
    if (!S.length) return '<p class="tl-empty">Nothing on the timeline yet: the first slice is still running.</p>';
    // the frame's inner width (root padding 2 x 16, frame left padding 8): a run that fits never overflows the card
    const W0 = Math.max((root.querySelector('.tl-frame')?.clientWidth || root.clientWidth - 32) - 10, 280), per = Math.max(12, Math.floor(W0 / S.length)), W = Math.max(W0, per * S.length);
    const t0 = S[0].minute, x = (m) => ((m - t0) / stepMs) * per;
    const rows = [], H = 36, HB = 64;
    const peakOf = (f) => Math.max(0, ...S.map(f).filter((v) => v != null));
    if (S.some((s) => s.active != null)) { const pk = peakOf((s) => s.active); rows.push({ label: `Agents at work, peak ${n0(pk)}`, kind: 'area', vals: S.map((s) => s.active || 0), max: nice(Math.max(pk, 1)), cls: 'c-active', h: HB }); }
    { const pr = peakOf((s) => s.ready), pl = peakOf((s) => s.landed), hasReady = S.some((s) => s.ready != null);
      rows.push({ label: hasReady ? `Changes ${unit}: <i class="k-ready"></i>finished by agents (comments written), <i class="k-main"></i>reached main (in batches)` : `Changes reaching main ${unit} (in batches), peak ${n0(pl)}`, html: true, kind: 'pair', vals: S.map((s) => s.landed || 0), area: hasReady ? S.map((s) => s.ready || 0) : null, max: nice(Math.max(pr, pl, 1)), cls: 'c-land', h: HB }); }
    const models = Object.keys(Object.assign({}, ...S.map((s) => s.calls || {})));
    for (const m of models) {
      const peak = peakOf((s) => (s.calls || {})[m] || 0), lim0 = (t.limits || {})[m], lim = lim0 ? lim0 * limScale : null;
      const drawLim = lim && lim <= peak * 4;   // a limit far above the peak would flatten the chart: named, not drawn
      rows.push({ label: `${short(m)}: calls ${unit}, peak ${n0(peak)}${lim0 ? `, limit ${n0(lim0)} per min` : ''}`, kind: 'area', vals: S.map((s) => (s.calls || {})[m] || 0), max: nice(Math.max(drawLim ? lim : 0, peak, 1)), lim: drawLim ? lim : null, cls: 'c-model', h: H });
    }
    const lanes = Object.keys(Object.assign({}, ...S.map((s) => s.lanes || {}))).filter((l) => l !== 'other');
    if (S.some((s) => (s.lanes || {}).other)) lanes.push('other');
    const laneMax = Math.max(1, ...S.flatMap((s) => Object.values(s.lanes || {})));
    if (lanes.length) rows.push({ label: `Changes per lane (${lanes.length}${lanes.includes('other') ? ', smaller lanes together' : ''}), darker = more, up to ${n0(laneMax)} in a slice`, kind: 'heat', lanes, max: laneMax });
    if (S.some((s) => s.door && (s.door.files || s.door.pushes))) { const pk = peakOf((s) => s.door?.files || 0), pp = S.reduce((a, s) => a + (s.door?.pushes || 0), 0); rows.push({ label: `The door to main: files ${unit} (bars), pushes as ticks, ${n0(pp)} pushes in all`, kind: 'door', vals: S.map((s) => s.door?.files || 0), ticks: S.map((s) => s.door?.pushes || 0), max: nice(Math.max(pk, 1)), cls: 'c-door', h: H }); }
    if (S.some((s) => s.queue != null)) { const pk = peakOf((s) => s.queue || 0); rows.push({ label: `Waiting (not started, at the model, or not yet on main), peak ${n0(pk)}`, kind: 'area', vals: S.map((s) => s.queue || 0), max: nice(Math.max(pk, 1)), cls: 'c-queue', h: H }); }
    const cx = (i) => x(S[i].minute) + per / 2;
    const strip = (r) => {
      const h = r.kind === 'heat' ? r.lanes.length * 10 : r.h, base = h, parts = [`<rect class="tl-bg" x="0" y="0" width="${W}" height="${h}" rx="4"/>`];
      const yv = (v) => (base - (v / r.max) * (h - 2)).toFixed(1);
      if (r.kind !== 'heat') parts.push(`<line class="tl-mid" x1="0" x2="${W}" y1="${(h / 2).toFixed(1)}" y2="${(h / 2).toFixed(1)}"/>`);
      const area = (vals, cls) => `<path class="tl-a ${cls}" d="M${cx(0).toFixed(1)},${base} L${vals.map((v, i) => `${cx(i).toFixed(1)},${yv(v)}`).join(' L')} L${cx(S.length - 1).toFixed(1)},${base} Z"/><path class="tl-ln ${cls}" d="M${vals.map((v, i) => `${cx(i).toFixed(1)},${yv(v)}`).join(' L')}"/>`;
      if (r.kind === 'area') { parts.push(area(r.vals, r.cls)); if (r.lim) parts.push(`<line class="tl-lim" x1="0" x2="${W}" y1="${yv(r.lim)}" y2="${yv(r.lim)}"/>`); }
      else if (r.kind === 'pair' || r.kind === 'door') {
        r.vals.forEach((v, i) => { if (!v) return; const bh = Math.max(1.5, (v / r.max) * (h - 2)); parts.push(`<rect class="tl-b ${r.cls}" x="${(x(S[i].minute) + per * 0.2).toFixed(1)}" y="${(base - bh).toFixed(1)}" width="${Math.max(2, per * 0.6).toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5"/>`); });
        if (r.ticks) r.ticks.forEach((v, i) => { if (!v) return; parts.push(`<rect class="tl-tick" x="${(cx(i) - 1).toFixed(1)}" y="1" width="2" height="${Math.min(h - 2, 4 + v * 2)}"/>`); });
        // finished by agents: a line on top of the batch bars, so the agents' own pace stays visible (critique)
        if (r.area) parts.push(`<path class="tl-ln c-ready" d="M${r.area.map((v, i) => `${cx(i).toFixed(1)},${yv(v)}`).join(' L')}"/>`);
      } else if (r.kind === 'heat') {
        r.lanes.forEach((ln, j) => S.forEach((s) => { const v = (s.lanes || {})[ln] || 0; if (!v) return; parts.push(`<rect class="tl-h" x="${(x(s.minute) + 0.5).toFixed(1)}" y="${j * 10 + 1}" width="${Math.max(2, per - 1)}" height="8" rx="1" style="opacity:${(0.18 + 0.82 * (v / r.max)).toFixed(2)}"><title>${esc(ln)}: ${v}</title></rect>`); }));
      }
      const yscale = r.kind === 'heat' ? '' : `<div class="tl-y" style="height:${h}px" aria-hidden="true"><span>${kfmt(r.max)}</span>${h >= 50 ? `<span>${kfmt(r.max / 2)}</span>` : ''}<span>0</span></div>`;
      return `<div class="tl-row"><p class="tl-lab"><span>${r.html ? r.label : esc(r.label)}</span></p><div class="tl-plot" style="height:${h}px">${yscale}<svg class="tl-s" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" aria-hidden="true">${parts.join('')}</svg></div></div>`;
    };
    // ticks on round times: every 10 s, 30 s, 1, 2, 5, 10 or 30 min, at least ~56 px apart
    const niceT = [10e3, 30e3, 60e3, 120e3, 300e3, 600e3, 1800e3, 3600e3].find((ms) => (ms / stepMs) * per >= 56) || 3600e3;
    const every = Math.max(1, Math.round(niceT / stepMs)), lab = (i) => { const sec = Math.round((i * stepMs) / 1000); return i === 0 ? '0:00' : sec < 120 ? `${sec} s` : `${Math.round(sec / 60)} min`; };
    const grid = S.map((s, i) => (i % every === 0 ? `<line class="tl-g" x1="${x(s.minute).toFixed(1)}" x2="${x(s.minute).toFixed(1)}" y1="0" y2="100%"/>` : '')).join('');
    const axis = S.map((s, i) => (i % every === 0 && x(s.minute) < W - 40 ? `<text class="tl-x" x="${Math.max(2, x(s.minute) + 2).toFixed(1)}" y="12">${lab(i)}</text>` : '')).join('');
    const MK = (k) => (k === 'auto_pause' ? 'pause' : k), MW = (k) => (k === 'auto_pause' ? 'auto-paused' : k === 'pause' ? 'paused' : k === 'resume' ? 'resumed' : k === 'stop' ? 'stopped' : k);
    const marks = (t.marks || []).map((m) => { const mx = Math.max(1, Math.min(W - 1, x(m.at))); return `<line class="tl-m m-${esc(MK(m.kind))}" x1="${mx.toFixed(1)}" x2="${mx.toFixed(1)}" y1="0" y2="100%"/>`; }).join('');
    const mlabels = (t.marks || []).map((m) => { const w = MW(m.kind).length * 6.5, mx = Math.max(1, Math.min(W - w - 4, x(m.at) + 3)); return `<text class="tl-mt m-${esc(MK(m.kind))}" x="${mx.toFixed(1)}" y="12">${esc(MW(m.kind))}</text>`; }).join('');
    const legend = (t.marks || []).length ? `<ul class="tl-ml">${(t.marks || []).map((m) => `<li><i class="m-${esc(MK(m.kind))}"></i>${esc(MW(m.kind).replace(/^./, (c) => c.toUpperCase()))} ${clock((m.at - t0) / 1000)} in${m.why ? `: ${esc(m.why)}` : ''}</li>`).join('')}</ul>` : '';
    const sel = drill && drill.i != null && S[drill.i] ? `<rect class="tl-sel" x="${x(S[drill.i].minute).toFixed(1)}" y="0" width="${per}" height="100%"/>` : '';
    TLS = { S, stepMs, per, t0, unit };
    return `<div class="tl-frame"${live(run) ? ' data-live' : ''} tabindex="0" role="group" aria-label="Timeline of the run; scrolls sideways; tap a column for that moment"><div class="tl-in" style="width:${W}px" data-per="${per}">
      ${mlabels ? `<svg class="tl-ax" width="${W}" height="16" aria-hidden="true">${mlabels}</svg>` : ''}
      <svg class="tl-ov" width="${W}" height="100%" aria-hidden="true">${grid}${sel}${marks}</svg>
      ${rows.map(strip).join('')}
      <svg class="tl-ax" width="${W}" height="16" aria-hidden="true">${axis}</svg></div></div>${legend}
      <p class="tl-hint">Tap a column to see what happened in that slice.</p>`;
  }

  // ---- drill-down: a slice -> its changes -> an agent's files, or one change's comments and timings --------------
  let TLS = null, DR = null;   // DR = { k, i, t, to, view: 'slice'|'agent'|'change', agent, file, data: {} }
  const rel = (at) => (at && TLS ? clock((at - TLS.t0) / 1000) : '–');
  const ST = { landed: 'on main', skipped: 'already had comments', rejected: 'rejected', verify_fail: 'changed the code: refused', ready: 'ready to land', model: 'at the model', queued: 'waiting' };
  async function drillFetch(run, path) {
    if (MOCK || run.group) return null;
    const r = await fetch(`${API}/${encodeURIComponent(run.repo)}/${encodeURIComponent(run.runId)}/${path}`, { cache: 'no-store', credentials: 'same-origin' });
    if (!r.ok) return { error: r.status };
    return r.json();
  }
  function drillPanel(run) {
    if (!DR || DR.k !== key(run) || !TLS) return '';
    const s = TLS.S[DR.i]; if (!s) return '';
    const from = clock((s.minute - TLS.t0) / 1000), to = clock((s.minute - TLS.t0 + TLS.stepMs) / 1000);
    const crumbs = `<p class="dp-cr"><button type="button" class="dp-x" data-dr="close" aria-label="Close">Close</button><button type="button" class="dp-b${DR.view === 'slice' ? ' on' : ''}" data-dr="slice">${from} to ${to}</button>${DR.agent ? `<button type="button" class="dp-b${DR.view === 'agent' ? ' on' : ''}" data-dr="agent" data-agent="${esc(DR.agent)}">${esc(agentName(DR.agent))}</button>` : ''}${DR.file && DR.view === 'change' ? `<span class="dp-b on">${esc(fileName(DR.file))}</span>` : ''}</p>`;
    let body = '';
    if (DR.view === 'slice') {
      const raw = s.raw || {};
      const facts = [s.active != null ? `<li><b>${n0(s.active)}</b> agents at work</li>` : '', raw.ready != null ? `<li><b>${n0(raw.ready)}</b> changes finished by agents</li>` : '', `<li><b>${n0(raw.landed || 0)}</b> changes reached main</li>`,
        ...Object.entries(raw.calls || {}).map(([m, v]) => `<li><b>${n0(v)}</b> calls to ${esc(short(m))}</li>`), s.queue != null ? `<li><b>${n0(s.queue)}</b> waiting at the deepest moment</li>` : '', s.r429 ? `<li><b>${n0(s.r429)}</b> refused by the model (429)</li>` : ''].join('');
      const lanes = Object.entries(s.lanes || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const d = DR.data.slice;
      const list = run.group ? '<p class="dp-n">Open one copy’s timeline to see its single changes.</p>'
        : !d ? '<p class="dp-n">Loading the changes in this slice…</p>' : d.error ? `<p class="dp-n">The list of changes is not available yet (${esc(d.error)}).</p>`
        : !(d.changes || []).length ? `<p class="dp-n">${d.landedInSlice ? `${n0(d.landedInSlice)} changes reached main in this slice; agents finished them earlier.` : 'No single change finished in this slice.'}</p>`
        : `<ul class="dp-l">${d.changes.slice(0, 60).map((c) => `<li><button type="button" class="dp-f" data-dr="change" data-file="${esc(c.file)}" data-agent="${esc(c.agent || '')}"><span class="mono">${esc(fileName(c.file))}</span><small>${esc(ST[c.status] || c.status || '')}${c.landed ? `, on main ${rel(c.landed)}` : c.answered ? `, finished ${rel(c.answered)}` : ''}</small></button>${c.agent ? `<button type="button" class="dp-a" data-dr="agent" data-agent="${esc(c.agent)}">${esc(agentName(c.agent))}</button>` : ''}</li>`).join('')}</ul>${(d.total || d.changes.length) > 60 ? `<p class="dp-n">and ${n0((d.total || d.changes.length) - 60)} more in this slice</p>` : ''}`;
      body = `<ul class="dp-facts">${facts}</ul>${lanes.length ? `<p class="dp-n">Busiest lanes: ${lanes.map(([l, v]) => `${esc(l)} ${n0(v)}`).join(', ')}</p>` : ''}${list}`;
    } else if (DR.view === 'agent') {
      const d = DR.data['a:' + DR.agent];
      body = !d ? '<p class="dp-n">Loading this agent’s files…</p>' : d.error ? `<p class="dp-n">Not available yet (${esc(d.error)}).</p>`
        : `<p class="dp-n">${n0((d.files || []).length)} files, times from the run’s start.</p><ul class="dp-l">${(d.files || []).map((f) => `<li><button type="button" class="dp-f" data-dr="change" data-file="${esc(f.file)}" data-agent="${esc(DR.agent)}"><span class="mono">${esc(fileName(f.file))}</span><small>picked ${rel(f.picked)}${f.answered ? `, finished ${rel(f.answered)}` : ''}${f.landed ? `, on main ${rel(f.landed)}` : ''}, ${esc(ST[f.status] || f.status || '')}</small></button></li>`).join('')}</ul>`;
    } else {
      const d = DR.data['f:' + DR.file];
      body = !d ? '<p class="dp-n">Loading the change…</p>' : d.error ? `<p class="dp-n">Not available yet (${esc(d.error)}).</p>`
        : `<p class="dp-p mono">${esc(d.file)}</p><dl class="dp-t"><div><dt>Agent</dt><dd>${esc(agentName(d.agent))}</dd></div><div><dt>Picked</dt><dd>${rel(d.picked)}</dd></div><div><dt>Comments from</dt><dd>${esc(d.source === 'cache' ? 'the cache (reused)' : short(d.model || d.source || ''))}${d.answered ? `, ${rel(d.answered)}` : ''}</dd></div><div><dt>Code unchanged</dt><dd>${d.verified ? `checked ${rel(d.verified)}` : '–'}</dd></div><div><dt>On main</dt><dd>${d.landed ? rel(d.landed) : esc(ST[d.status] || d.status || '–')}</dd></div></dl>
          ${d.diff ? `<pre class="dp-d">${String(d.diff).split('\n').slice(0, 400).map((l) => `<span class="${/^\+(?!\+\+)/.test(l) ? 'ad' : /^-(?!--)/.test(l) ? 'rm' : /^@@/.test(l) ? 'hk' : ''}">${esc(l)}</span>`).join('\n')}</pre>` : '<p class="dp-n">No diff for this change.</p>'}`;
    }
    return `<section class="dp" aria-label="What happened">${crumbs}${body}</section>`;
  }
  const agentName = (a) => { const x = String(a ?? ''); return /^\d+$/.test(x) ? `Agent ${x}` : x.replace(/^.*#/, 'Agent ').replace(/^agent[-_ ]?/i, 'Agent '); };
  const fileName = (f) => { const p = String(f || '').split('/'); return p.length > 3 ? `…/${p.slice(-3).join('/')}` : f; };

  // ---- copies: one ladder step runs as N copies (label '… - copy N'); the step is one card with the copies under it ---
  // the step's name from the label ('S4d 4,750 agents / 95 copies (cache) - copy 7'), else qb6's ladder field
  const baseOf = (r) => { const m = /^(.*?)\s+[-–]\s+(?:copy\s+\d+|fleet-[\w-]+)$/i.exec(r.label || ''); return m ? m[1] : r.ladder || null; };
  const copyNo = (c) => +(c.copy || (/copy\s+(\d+)$/i.exec(c.label || '') || [])[1] || (/-(\d+)$/.exec(c.repo || '') || [])[1] || 0);
  function grouped(list) {
    const out = [], seen = new Map();
    for (const r of list) {
      const b = baseOf(r);
      if (!b) { out.push(r); continue; }
      let g = seen.get(b);
      if (!g) { g = { group: true, label: b, copies: [], repo: r.repo, runId: `group:${b}` }; seen.set(b, g); out.push(g); }
      g.copies.push(r);
    }
    for (const g of seen.values()) g.copies.sort((a, b) => copyNo(a) - copyNo(b));
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
    // many copies (S4d: 100): the first five, the rest behind 'Show all'
    const row = (c, i) => { const k = counts(c); return `<li><a href="#/run/${encodeURIComponent(c.repo)}/${encodeURIComponent(c.runId)}"><span class="rs-st st-${esc(c.state)}"><i></i>${esc(`Copy ${c.copy || (/copy\s+(\d+)$/i.exec(c.label || '') || [])[1] || i + 1}`)}</span><span class="rcp-v">${n0(k.landed)} files got comments, ${n0(k.skipped)} already had them, ${esc((STATE[c.state] || c.state).toLowerCase())}</span><span class="rr-go">Timeline</span></a></li>`; };
    // one line above the list (Eyal): fastest, median and slowest copy by files per second (finished files / its time)
    const rate = (c) => { const k = counts(c), sec = elapsedS(c); return sec > 0 ? (k.landed + k.skipped + k.rejected) / sec : null; };
    const rs = g.copies.map((c, i) => ({ c, i, v: rate(c) })).filter((x) => x.v != null).sort((a, b) => b.v - a.v);
    const nm = (x) => `copy ${x.c.copy || x.i + 1}`, f1 = (v) => (v >= 10 ? Math.round(v) : v.toFixed(1));
    const sum = rs.length > 2 ? `<p class="rcp-s">Files per second: fastest ${f1(rs[0].v)} (${nm(rs[0])}), median ${f1(rs[rs.length >> 1].v)}, slowest ${f1(rs[rs.length - 1].v)} (${nm(rs[rs.length - 1])}).</p>` : '';
    if (g.copies.length > 6) return `${sum}<ul class="rcp">${g.copies.slice(0, 5).map(row).join('')}</ul><details class="rcp-more"${openCopies.has(g.label) ? ' open' : ''} data-g="${esc(g.label)}"><summary>Show all ${g.copies.length} copies</summary><ul class="rcp">${g.copies.slice(5).map((c, i) => row(c, i + 5)).join('')}</ul></details>`;
    return `${sum}<ul class="rcp">${g.copies.map((c, i) => { const k = counts(c); return `<li><a href="#/run/${encodeURIComponent(c.repo)}/${encodeURIComponent(c.runId)}"><span class="rs-st st-${esc(c.state)}"><i></i>${esc(`Copy ${c.copy || (/copy\s+(\d+)$/i.exec(c.label || '') || [])[1] || i + 1}`)}</span><span class="rcp-v">${n0(k.landed)} files got comments, ${n0(k.skipped)} already had them, ${esc((STATE[c.state] || c.state).toLowerCase())}</span><span class="rr-go">Timeline</span></a></li>`; }).join('')}</ul>`;
  }

  // ---- pages -------------------------------------------------------------------------------------------------------
  function listView() {
    const fleet = grouped((D.fleet || []).slice().sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))).sort((a, b) => (live(b) - live(a)) || (b.startedAt || 0) - (a.startedAt || 0));
    const cur = fleet.filter(live), past = fleet.filter((r) => !live(r));
    const real = D.real || [];
    const realRow = (b) => `<li><a href="${esc(b.link || `/p/${b.slug.replace('.', '/')}/work#/timeline`)}"><span class="rr-n"><b>${esc(b.label || b.slug)}</b><small>${esc(b.slug.replace('.', ' / '))}</small></span><span class="rr-v">${b.settledAt ? `${clock((b.settledAt - b.startedAt) / 1000)}, ${usd(b.usd)}` : b.startedAt ? `running, ${usd(b.usd)} so far` : '–'}${b.parts ? `<small>${n0(b.landed)} of ${n0(b.parts)} parts on main</small>` : b.landed ? `<small>${n0(b.landed)} changes on main</small>` : ''}</span><span class="rr-go">Timeline</span></a></li>`;
    return `<header class="rh"><h1>Scale runs</h1><p class="rh-s"><i class="live${cur.length ? '' : ' off'}"></i><span id="rupd">${cur.length ? `${cur.length} running now` : 'Nothing running now'}</span>${OWN ? '' : '<span class="rh-ro">read-only</span>'}</p></header>
      ${cur.length ? `<section class="rsec"><h2>Now</h2>${cur.map((r) => card(r, false)).join('')}</section>` : ''}
      <section class="rsec"><h2>${cur.length ? 'Earlier' : 'Fleet runs'}</h2>${past.length ? past.slice(0, 20).map((r) => card(r, false)).join('') : '<p class="dim">No fleet runs yet.</p>'}</section>
      ${real.length ? `<section class="rsec"><h2>Real builds</h2><p class="dim">Real Claude Code agents building an app; each opens its project's timeline.</p><ul class="rr">${real.map(realRow).join('')}</ul></section>` : ''}`;
  }
  function runView(repo, id) {
    const r = (D.fleet || []).find((x) => x.repo === repo && x.runId === id);
    if (!r) return `<p><a href="#/">All runs</a></p><p>That run is not in the list any more.</p>`;
    return `<p class="crumb"><a href="#/">All runs</a></p>${card(r, true)}<section class="rsec"><h2>Timeline</h2>${timeline(r, TL[key(r)], DR && DR.k === key(r) ? DR : null)}${drillPanel(r)}</section>`;
  }
  const stepOf = (base) => grouped((D.fleet || []).slice()).find((g) => g.group && g.label === base) || null;
  function stepView(base) {
    const g = stepOf(base);
    if (!g) return `<p><a href="#/">All runs</a></p><p>That ladder step is not in the list any more.</p>`;
    const lad = g.copies[0]?.ladder && TL['ladder:' + g.copies[0].ladder];
    const ts = lad ? [] : g.copies.map((c) => TL[key(c)]), have = lad ? g.copies.length : ts.filter(Boolean).length;
    const t = lad || (have ? summed(ts) : null);
    return `<p class="crumb"><a href="#/">All runs</a></p>${card(g, true)}<section class="rsec"><h2>Timeline, all ${g.copies.length} copies together</h2>${have < g.copies.length ? `<p class="dim">${have} of ${g.copies.length} copies loaded…</p>` : ''}${timeline(g, t, DR && DR.k === key(g) ? DR : null)}${drillPanel(g)}</section>`;
  }
  function current() {
    let m = /^#\/run\/([^/]+)\/([^/]+)$/.exec(location.hash);
    if (m) return (D?.fleet || []).find((x) => x.repo === decodeURIComponent(m[1]) && x.runId === decodeURIComponent(m[2])) || null;
    m = /^#\/step\/(.+)$/.exec(location.hash);
    return m && D ? stepOf(decodeURIComponent(m[1])) : null;
  }

  let lastHtml = '';
  function render() {
    if (!D) return;
    const m = /^#\/run\/([^/]+)\/([^/]+)$/.exec(location.hash), ms = /^#\/step\/(.+)$/.exec(location.hash);
    const html = m ? runView(decodeURIComponent(m[1]), decodeURIComponent(m[2])) : ms ? stepView(decodeURIComponent(ms[1])) : listView();
    const k = html.replace(/(data-since="\d+">)[^<]*/g, '$1');
    if (k === lastHtml || busy) return tickClocks();
    const ctlF = document.activeElement?.closest?.('.rc-ctl') ? document.activeElement.dataset.ctl : null;
    const fr = root.querySelector('.tl-frame'), sx = fr ? fr.scrollLeft : null, atEnd = fr ? fr.scrollLeft + fr.clientWidth >= fr.scrollWidth - 4 : true;
    lastHtml = k; root.innerHTML = html;
    // a live run opens at, and keeps showing, its newest minute; a finished one opens at its start
    const f2 = root.querySelector('.tl-frame'); if (f2) f2.scrollLeft = fr ? (atEnd && 'live' in f2.dataset ? f2.scrollWidth : sx) : ('live' in f2.dataset ? f2.scrollWidth : 0);
    if (ctlF) root.querySelector(`[data-ctl="${ctlF}"]`)?.focus({ preventScroll: true });
  }
  function tickClocks() { root.querySelectorAll('[data-since]').forEach((b) => { b.textContent = clock((Date.now() - +b.dataset.since) / 1000); }); }

  async function tick() {
    clearTimeout(timer);
    try {
      await load(); failures = 0; lastOk = Date.now();
      const cur = current();
      if (cur) { if (!(cur.group && (await loadLadder(cur).catch(() => false)))) await loadMany(cur.group ? cur.copies : [cur]); }
      render();
    } catch (e) { failures++; log('poll_failed', { error: String(e), failures }); if (!D) root.innerHTML = `<header class="rh"><h1>Scale runs</h1></header><p class="dim">Could not load the runs (${esc(String(e.message || e))}). Trying again.</p>`; }
    const anyLive = (D?.fleet || []).some(live);
    timer = setTimeout(tick, document.hidden ? 30e3 : anyLive ? 5e3 : 30e3 * Math.min(4, 2 ** failures));
  }
  addEventListener('hashchange', () => { DR = null; lastHtml = ''; render(); tick(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  setInterval(tickClocks, 1000);

  root.addEventListener('toggle', (e) => { const d = e.target; if (d.matches?.('.rcp-more')) { if (d.open) openCopies.add(d.dataset.g); else openCopies.delete(d.dataset.g); } }, true);
  // Taps on the timeline and in the drill-down panel.
  root.addEventListener('click', async (e) => {
    const run = current();
    const tin = e.target.closest('.tl-in');
    if (tin && run && TLS) {
      const i = Math.floor((e.clientX - tin.getBoundingClientRect().left) / TLS.per);
      if (i < 0 || i >= TLS.S.length) return;
      const s = TLS.S[i]; DR = { k: key(run), i, t: s.minute, to: s.minute + TLS.stepMs, view: 'slice', data: {} };
      log('drill', { kind: 'slice', i }); lastHtml = ''; render(); root.querySelector('.dp')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const d = await drillFetch(run, `slice?t=${s.minute}&to=${s.minute + TLS.stepMs}`).catch((x) => ({ error: String(x) }));
      if (DR && DR.t === s.minute) { DR.data.slice = d; lastHtml = ''; render(); }
      return;
    }
    const dr = e.target.closest('[data-dr]');
    if (dr && run && DR) {
      const a = dr.dataset.dr;
      if (a === 'close') { DR = null; lastHtml = ''; render(); return; }
      if (a === 'slice') { DR.view = 'slice'; DR.agent = null; lastHtml = ''; render(); return; }
      if (a === 'agent') {
        DR.view = 'agent'; DR.agent = dr.dataset.agent; lastHtml = ''; render(); log('drill', { kind: 'agent' });
        const k = 'a:' + DR.agent; if (!DR.data[k]) { const d = await drillFetch(run, `agent/${encodeURIComponent(DR.agent)}`).catch((x) => ({ error: String(x) })); if (DR) { DR.data[k] = d; lastHtml = ''; render(); } }
        return;
      }
      if (a === 'change') {
        DR.view = 'change'; DR.file = dr.dataset.file; if (dr.dataset.agent) DR.agent = dr.dataset.agent; lastHtml = ''; render(); log('drill', { kind: 'change' });
        const k = 'f:' + DR.file; if (!DR.data[k]) { const d = await drillFetch(run, `change?file=${encodeURIComponent(DR.file)}`).catch((x) => ({ error: String(x) })); if (DR) { DR.data[k] = d; lastHtml = ''; render(); } }
        return;
      }
    }
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
