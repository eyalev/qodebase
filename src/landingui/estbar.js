// Estimated vs elapsed for a project that is building (qb7, manager 2026-10-12: Eyal wants to see the estimate he
// was shown next to the real clock and cost). One function, used by the Changes page and 'Agents at work':
//   window.qbEstBar(estimate, progress, now) -> HTML string ('' when the project was built without an estimate)
// estimate: { startedAt, wallS:[lo,hi], apiUsd:[lo,hi], basis:'typical'|'idea', basedOn }
// progress: { spentUsd, settledAt, actualWallS, actualUsd }   (qb6 stores both at /api/build and on settle)
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
  window.qbEstBar = function (est, prog, now = Date.now()) {
    if (!est || !Array.isArray(est.wallS) || !est.startedAt) return '';
    const p = prog || {}, done = !!p.settledAt;
    const el = done ? (p.actualWallS ?? (p.settledAt - est.startedAt) / 1000) : (now - est.startedAt) / 1000;
    const [lo, hi] = est.wallS;
    const state = done ? (el > hi ? 'Took longer than expected' : el < lo ? 'Faster than expected' : 'Within the estimate')
      : el > hi ? 'Taking longer than expected' : el >= lo ? 'Within the expected range' : 'On track';
    const late = el > hi;
    const cost = done ? p.actualUsd : p.spentUsd;
    const costRow = Array.isArray(est.apiUsd) ? `<div class="eb-row"><span class="eb-k">${done ? 'Cost' : 'Cost so far'}</span>${cost == null ? '<span class="eb-k">not known yet</span>' : `<b>${usd(cost)}</b>`}<span class="eb-x">expected ${span(est.apiUsd, usd)}</span></div>
      ${cost == null ? '' : bar(cost, est.apiUsd[0], est.apiUsd[1], cost > est.apiUsd[1] ? 'eb-late' : '')}` : '';
    return `<section class="estbar${late ? ' eb-over' : ''}" aria-label="Estimated and actual time and cost">
      <div class="eb-row"><span class="eb-k">${done ? 'Took' : 'Elapsed'}</span><b${done ? '' : ` data-eb-since="${est.startedAt}"`}>${clock(el)}</b><span class="eb-x">expected ${span(est.wallS, mins)}</span></div>
      ${bar(el, lo, hi, late ? 'eb-late' : '')}
      <p class="eb-state">${esc(state)}</p>
      ${costRow}
      <p class="eb-src">Estimate for ${est.basis === 'idea' ? 'your idea, as the small model read it' : 'a typical small app'}${est.basedOn ? `, from ${est.basedOn} real lab runs` : ''}; cost at API prices.</p>
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
.estbar .eb-band{position:absolute;top:0;bottom:0;background:color-mix(in srgb,var(--acc) 30%,transparent)}
.estbar .eb-fill{position:absolute;left:0;top:2px;bottom:2px;border-radius:2px;background:var(--fg)}
.estbar .eb-late .eb-fill{background:var(--busy)}
.estbar .eb-state{margin:0;font-size:14px}.estbar.eb-over .eb-state{color:var(--busy);font-weight:600}
.estbar .eb-src{margin:0;font-size:12px;color:var(--dim)}`;
  // Pages rendered on the server (the Changes tab, re-fetched while it polls) leave <div data-estbar='{"e":…,"p":…}'>;
  // this fills each one, again after every refresh, and ticks the clocks.
  if (window.__qbEstBarAuto) return; window.__qbEstBarAuto = 1;
  function mount() {
    const els = document.querySelectorAll('[data-estbar]:not([data-eb-done])');
    if (!els.length) return;
    if (!document.getElementById('estbar-css')) { const st = document.createElement('style'); st.id = 'estbar-css'; st.textContent = window.QB_ESTBAR_CSS; document.head.appendChild(st); }
    els.forEach((el) => { try { const d = JSON.parse(el.dataset.estbar); el.innerHTML = window.qbEstBar(d.e, d.p); } catch (e) { console.log(JSON.stringify({ module: 'estbar', event: 'mount_failed', error: String(e) })); } el.dataset.ebDone = '1'; });
  }
  const start = () => { mount(); new MutationObserver(mount).observe(document.body, { childList: true, subtree: true }); setInterval(window.qbEstBarTick, 1000); };
  if (document.body) start(); else addEventListener('DOMContentLoaded', start);
})();
