// Estimated vs elapsed for a project that is building (qb7, manager 2026-10-12: Eyal wants to see the estimate he
// was shown next to the real clock and cost). One function, used by the Changes page and 'Agents at work':
//   window.qbEstBar(estimate, progress, now, billing, build) -> HTML string ('' when the project was built without an estimate)
// build (X2, qb6): { parts: M planned or null, landed: N, firstLandedAt, settledAt, remainingS: [lo, hi] or null }
// estimate: { startedAt, wallS:[lo,hi], apiUsd:[lo,hi], basis:'typical'|'idea', basedOn }
// progress: { spentUsd, settledAt, actualWallS, actualUsd, billing?:'sub'|'api' }   (qb6 stores both at /api/build and on settle)
// Elapsed text carries data-since so the pages' 1 s clock can tick it without a rebuild.
(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const clock = (s) => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60), h = Math.floor(m / 60); return h ? `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`; };
  const mins = (s) => (s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);
  // '5 to 12 min', '50 s to 3 min', '$0.68 to $0.92'
  const span = (r, f) => { const a = f(r[0]), b = f(r[1]); if (a === b) return a; const u = / (s|min)$/.exec(a); return u && b.endsWith(u[0]) ? `${a.slice(0, -u[0].length)} to ${b}` : `${a} to ${b}`; };
  const usd = (x) => (x < 10 ? `$${x.toFixed(2)}` : `$${Math.round(x)}`);
  const pct = (x, max) => `${Math.max(0, Math.min(100, (x / max) * 100)).toFixed(1)}%`;
  function bar(value, lo, hi, cls) {
    const max = Math.max(hi * 1.3, value * 1.08, 1);
    return `<div class="eb-track ${cls}" aria-hidden="true"><i class="eb-band" style="left:${pct(lo, max)};width:${pct(hi - lo, max)}"></i><i class="eb-fill" style="width:${pct(value, max)}"></i></div>`;
  }
  // 'about 12 min left', 'about 8 to 15 min left', 'under a minute left'
  const left = (r) => { if (!Array.isArray(r)) return ''; const [a, b] = r.map((x) => Math.max(0, x)); if (b < 60) return 'under a minute left';
    const lo = Math.max(1, Math.round(a / 60)), hi = Math.max(1, Math.round(b / 60)); return hi - lo <= Math.max(1, lo * 0.25) ? `about ${Math.round((lo + hi) / 2)} min left` : `about ${lo} to ${hi} min left`; };
  window.qbLeftText = left;   // the App tab's strip says it the same way
  // X2 (Eyal, 2026-10-13: 'clear progress + finish estimate'): N of M parts landed, about K min left.
  function partsRow(b, done) {
    if (!b) return '';
    const M = b.parts, N = b.landed || 0;
    if (!M) return `<div class="eb-row eb-parts"><b>${N ? `${N} part${N === 1 ? '' : 's'} landed` : 'Planning the parts'}</b>${done ? '' : '<span class="eb-x">the plan says how many soon</span>'}</div>`;
    const all = N >= M;
    return `<div class="eb-row eb-parts"><b>${all ? `All ${M} parts landed` : `${N} of ${M} parts landed`}</b>${done || all ? '' : `<span class="eb-x">${esc(b.leftText || left(b.remainingS))}</span>`}</div>
      <div class="eb-track eb-ptrack" role="img" aria-label="${N} of ${M} parts landed"><i class="eb-fill" style="width:${pct(Math.min(N, M), M)}"></i></div>`;
  }
  window.qbEstBar = function (est, prog, now = Date.now(), billing = null, build = null) {
    if (!est || !Array.isArray(est.wallS) || !est.startedAt) return '';
    const p = prog || {}, done = !!p.settledAt;
    const el = done ? (p.actualWallS ?? (p.settledAt - est.startedAt) / 1000) : (now - est.startedAt) / 1000;
    const [lo, hi] = est.wallS;
    // Review 2 (#3): a finished build shows its real record first; the range is the estimate shown at the time, and
    // estimates made before the refit on real builds (no realBuilds field) say so.
    const old = done && !est.realBuilds;
    const exp = done ? 'estimated' : 'expected';
    const state = done ? (el > hi ? 'Took longer than estimated' : el < lo ? 'Faster than estimated' : 'Within the estimate')
      : el > hi ? 'Taking longer than expected' : el >= lo ? 'Within the expected range' : 'On track';
    const late = el > hi;
    const cost = done ? p.actualUsd : p.spentUsd;
    // On the person's Claude plan (qb6: billing 'sub'), the dollars are what the same work costs at API prices.
    const plan = (billing || p.billing || est.billing) === 'sub';   // qb6: info.billing, next to estimate/progress
    const costRow = Array.isArray(est.apiUsd) ? `<div class="eb-row"><span class="eb-k">${plan ? (done ? 'API-equivalent' : 'API-equivalent so far') : done ? 'Cost' : 'Cost so far'}</span>${cost == null ? '<span class="eb-k">not known yet</span>' : `<b>${usd(cost)}</b>`}<span class="eb-x">${exp} ${span(est.apiUsd, usd)}</span></div>
      ${cost == null ? '' : bar(cost, est.apiUsd[0], est.apiUsd[1], cost > est.apiUsd[1] ? 'eb-late' : '')}` : '';
    return `<section class="estbar${late ? ' eb-over' : ''}" aria-label="Estimated and actual time and cost">${partsRow(build, done)}
      <div class="eb-row"><span class="eb-k">${done ? 'Took' : 'Elapsed'}</span><b${done ? '' : ` data-eb-since="${est.startedAt}"`}>${clock(el)}</b><span class="eb-x">${exp} ${span(est.wallS, mins)}</span></div>
      ${bar(el, lo, hi, late ? 'eb-late' : '')}
      <p class="eb-state">${esc(state)}</p>
      ${costRow}
      <p class="eb-src">${old ? 'Estimate shown at the time, before qodebase refit its estimates on real builds. ' : ''}${done ? 'It was the estimate' : 'Estimate'} for ${est.basis === 'idea' ? 'this idea, as the small model read it' : 'a typical small app'}${est.basedOn ? (est.realBuilds ? `, from ${est.basedOn} lab runs and ${est.realBuilds} real build${est.realBuilds === 1 ? '' : 's'}` : `, from ${est.basedOn} real lab runs`) : ''}${plan ? '. Runs on your Claude plan (not billed by qodebase); the dollars are API prices for the same work.' : '; cost at API prices.'}</p>
    </section>`;
  };
  // Tick every elapsed clock on the page once a second (no rebuild).
  window.qbEstBarTick = function () {
    document.querySelectorAll('[data-eb-since]').forEach((b) => { b.textContent = clock((Date.now() - +b.dataset.ebSince) / 1000); });
  };
  window.QB_ESTBAR_CSS = `.estbar{display:grid;gap:6px;padding:12px;border-radius:12px;background:var(--card);box-shadow:inset 0 0 0 1px var(--line);margin:0 0 14px}
.estbar .eb-row{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.estbar .eb-k{font-size:13px;color:var(--dim)}
.estbar .eb-row b{font-size:17px;font-weight:600;font-variant-numeric:tabular-nums}.estbar .eb-x{margin-left:auto;font-size:13px;color:var(--dim)}
.estbar .eb-track{position:relative;height:8px;border-radius:4px;background:var(--line);overflow:hidden}
.estbar .eb-band{position:absolute;top:0;bottom:0;z-index:1;border-radius:4px;box-shadow:inset 0 0 0 2px var(--acc)}
.estbar .eb-fill{position:absolute;left:0;top:2px;bottom:2px;border-radius:2px;background:var(--fg)}
.estbar .eb-late .eb-fill{background:var(--busy)}
.estbar .eb-parts b{font-size:17px}.estbar .eb-ptrack .eb-fill{top:0;bottom:0;border-radius:4px;background:var(--acc)}.estbar .eb-ptrack{margin-bottom:6px}
.estbar .eb-state{margin:0;font-size:14px}.estbar.eb-over .eb-state{color:var(--busy);font-weight:600}
.estbar .eb-src{margin:0;font-size:12px;color:var(--dim)}`;
  // X1/X2: the build's parts come from GET <api>/landing (the Landing DO only; qb6: fine every 10 s). One poller per page,
  // shared by the estimate bar and the App tab: window.qbBuildWatch(api, cb) calls cb(build) on every answer, with
  // remainingS filled from qb4's model in /lab/predict.js when it has one. Stops once the build has settled.
  const watchers = {};
  let SIMP = null;
  const sim = () => (SIMP ||= import('/lab/predict.js').catch(() => null));
  window.qbBuildWatch = function (api, cb) {
    if (!api) return;
    const w = (watchers[api] ||= { cbs: [], last: null, timer: 0 });
    w.cbs.push(cb); if (w.last) cb(w.last);
    if (w.timer) return;
    const tick = async () => {
      try {
        const r = await fetch(`${api}/landing`, { cache: 'no-store', credentials: 'same-origin' });
        const j = r.ok ? await r.json() : null;
        const b = j && j.build ? { ...j.build } : null;
        if (b && !b.remainingS && !b.settledAt) {
          const S = await sim();
          try {   // qb4 (98a4ac5): the range in seconds, and the phase ('over' = past the estimate: its own words)
            const est = j.estimate && j.estimate.wallS ? { wallS: j.estimate.wallS, startedAt: j.estimate.startedAt || b.startedAt } : null;
            // lastLandedAt (qb4 be003f3): between landings the time left counts down. qb6's field if present, else the newest
            // 'landed' event among the view's changes.
            const lastLandedAt = b.lastLandedAt || (j.changes || []).reduce((m, c) => Math.max(m, ...(c.events || []).filter((e) => e.what === 'landed').map((e) => e.t || 0)), 0) || null;
            if (S?.remainingS) b.remainingS = S.remainingS({ estimate: est, parts: b.parts, landed: b.landed, firstLandedAt: b.firstLandedAt, lastLandedAt, now: Date.now() }) || null;
            if (S?.remainingTime && est) { const t = S.remainingTime({ parts: b.parts, landed: b.landed, elapsedS: (Date.now() - (est.startedAt || Date.now())) / 1000, estimate: { wallS: est.wallS }, firstLandS: b.firstLandedAt && est.startedAt ? (b.firstLandedAt - est.startedAt) / 1000 : null }); if (t && t.phase === 'over') b.leftText = t.text; }
          } catch (e) { console.log(JSON.stringify({ module: 'estbar', event: 'remaining_failed', error: String(e) })); }
        }
        w.last = b; w.cbs.forEach((f) => { try { f(b, j); } catch (e) {} });
        if (b && b.settledAt) { w.timer = -1; return; }
      } catch (e) { console.log(JSON.stringify({ module: 'estbar', event: 'build_poll_failed', error: String(e) })); }
      w.timer = setTimeout(tick, document.hidden ? 30e3 : 10e3);
    };
    w.timer = 1; tick();
  };
  // Pages rendered on the server (the Changes tab, re-fetched while it polls) leave <div data-estbar='{"e":…,"p":…}'>;
  // this fills each one, again after every refresh, and ticks the clocks.
  if (window.__qbEstBarAuto) return; window.__qbEstBarAuto = 1;
  function mount() {
    const els = document.querySelectorAll('[data-estbar]:not([data-eb-done])');
    if (!els.length) return;
    if (!document.getElementById('estbar-css')) { const st = document.createElement('style'); st.id = 'estbar-css'; st.textContent = window.QB_ESTBAR_CSS; document.head.appendChild(st); }
    els.forEach((el) => {
      try {
        const d = JSON.parse(el.dataset.estbar);
        el.innerHTML = window.qbEstBar(d.e, d.p, Date.now(), d.b || null, d.x || null);
        // data-api: keep the parts row live from the Landing DO (the Changes tab re-renders this node on its own poll).
        if (d.api && !(d.p && d.p.settledAt)) window.qbBuildWatch(d.api, (b) => { if (el.isConnected && b) el.innerHTML = window.qbEstBar(d.e, d.p, Date.now(), d.b || null, b); });
      } catch (e) { console.log(JSON.stringify({ module: 'estbar', event: 'mount_failed', error: String(e) })); }
      el.dataset.ebDone = '1';
    });
  }
  const start = () => { mount(); new MutationObserver(mount).observe(document.body, { childList: true, subtree: true }); setInterval(window.qbEstBarTick, 1000); };
  if (document.body) start(); else addEventListener('DOMContentLoaded', start);
})();
