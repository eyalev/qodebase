// COPIED by src/landingui/build.mjs from src/landingui/buildsheet.js. Do not edit.
// "Adjust" sheet under the home page's Build box (qb7, docs/board/TASKS.md B2). Behind flag buildSettings.
// Build stays one tap with today's default; Adjust opens a sheet: 3 presets + knobs + a live estimate.
// The choice rides on the form as hidden inputs (preset, v) for qb6's B3 wiring. Estimate: qb4's
// predictBuild() in /lab/predict.js (B1, docs/board/build-estimate.md). The form sends v = {planner, coders,
// coderModel, reviewers, board}; qb6's server clamps it and ignores it when the flag is off for the viewer.
(() => {
  const form = document.querySelector('.landask');
  const root = document.getElementById('bsheet');
  if (!form || !root) return;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const log = (event, extra) => { try { console.log(JSON.stringify({ ts: new Date().toISOString(), module: 'buildsheet', event, ...extra })); } catch {} };
  const mins = (s) => (s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);
  const usd = (x) => (x < 10 ? `$${x.toFixed(2)}` : `$${Math.round(x)}`);
  const range = (r, f) => (!r ? '–' : f(r[0]) === f(r[1]) ? f(r[0]) : `${f(r[0])} to ${f(r[1])}`);

  // Presets: qb4's BUILD_PRESETS (label, variant, why), mapped onto the sheet's four knobs. Until they load: none.
  let PRESETS = {};
  const toV = (variant) => (variant.baseline === 'opus-alone' ? { planner: 'opus', coders: 1, coderModel: 'opus', reviewers: 0, board: false }
    : { planner: variant.planner || 'opus', coders: variant.coders, coderModel: variant.coderModel, reviewers: variant.reviewers || 0, board: !!variant.board });
  // Back to the lab's variant: one Opus agent with no reviewer is the opus-alone baseline (Fastest).
  const toVariant = (v) => (v.coders === 1 && v.coderModel === 'opus' && !v.reviewers ? { baseline: 'opus-alone' }
    : { planner: v.planner, coders: v.coders, coderModel: v.coderModel, reviewers: v.reviewers, reviewerModel: v.coderModel, reviewStyle: 'read', policy: 'intent', claims: false, dedupe: true, trainMax: 4, board: v.board });
  const KNOBS = [
    ['coders', 'Agents', [1, 3, 6, 12], (x) => String(x)],
    ['coderModel', 'Agent model', ['haiku', 'sonnet', 'opus'], (x) => ({ haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus' })[x]],
    ['reviewers', 'Reviewers', [0, 1, 3], (x) => (x ? String(x) : 'None')],
    ['board', 'Shared board', [true, false], (x) => (x ? 'On' : 'Off')],
  ];
  const GLOSS = { coders: 'With more than one agent, an Opus planner splits the work and each agent builds a piece on its own copy of the code.', board: 'Each agent says what it is doing and which files it touches, and repeated tasks are merged, so agents do not build the same thing twice.', reviewers: 'Another agent reads each change before it can land.' };

  const DEFAULT_V = { planner: 'opus', coders: 1, coderModel: 'opus', reviewers: 0, board: false };   // what Build does without the sheet
  const st = { v: { ...DEFAULT_V }, est: null, estState: 'idle', applied: null };
  let SIM = null;

  async function loadSim() {
    try {
      SIM = await import('/lab/predict.js');
      PRESETS = Object.fromEntries(Object.entries(SIM.BUILD_PRESETS || {}).map(([k, p]) => [k, { label: p.label, why: p.why, v: toV(p.variant) }]));
    } catch (e) { SIM = null; log('predict_missing', { error: String(e) }); }
  }
  // One estimate for the current settings. Ranges only; quality as a direction.
  function estimate() {
    if (!SIM?.predictBuild) return null;
    try {
      const r = SIM.predictBuild(SIM.SMALL_APP, toVariant(st.v));
      return r && { wallS: r.wallS, usd: r.apiUsd, basedOn: r.basedOn, same: r.sameSetup, quality: r.quality, notes: r.notes || [], job: r.job?.label || 'a small app', tasks: r.job?.tasks };
    } catch (e) { log('estimate_failed', { error: String(e), v: st.v }); return 'error'; }
  }
  const presetOf = (v) => Object.keys(PRESETS).find((k) => KNOBS.every(([n]) => PRESETS[k].v[n] === v[n])) || 'custom';
  const M = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus' };
  const summary = (key, v) => `${key === 'custom' ? 'Custom' : PRESETS[key].label}: ${v.coders === 1 ? `one ${M[v.coderModel]} agent` : `Opus planner, ${v.coders} ${M[v.coderModel]} agents`}${v.reviewers ? `, ${v.reviewers} reviewer${v.reviewers === 1 ? '' : 's'}` : ''}${v.board ? ', board on' : ''}`;

  function estHtml() {
    if (st.estState === 'loading') return '<p class="dim">Estimating…</p>';
    const e = st.est;
    if (!e || e === 'error') return `<p class="dim">${e === 'error' ? 'No estimate right now.' : 'No estimate yet.'} You can still build with these settings.</p>`;
    return `<p class="bs-e1">For ${esc(e.job)}${e.tasks ? ` (about ${e.tasks} pieces of work)` : ''}: <b>${range(e.wallS, mins)}</b>, <b>${range(e.usd, usd)}</b> at API prices.</p>
      <p class="bs-q">${esc(e.quality)}${e.notes.length ? ` ${esc(e.notes.join(' '))}` : ''}</p>
      <p class="bs-src">Based on ${e.basedOn} real lab runs${e.same ? '' : '; this exact setup wasn\'t run'}. On your own Claude plan the price is part of your plan.</p>`;
  }
  function render() {
    const key = presetOf(st.v);
    root.innerHTML = `<div class="bs-scrim" data-close></div>
      <div class="bs-panel" role="dialog" aria-modal="true" aria-labelledby="bs-t">
        <div class="bs-head"><h2 id="bs-t">Who builds it</h2><button type="button" class="bs-x" data-close aria-label="Close">×</button></div>
        ${Object.keys(PRESETS).length ? '' : st.estState === 'loading' ? '<p class="bs-src">Loading the presets…</p>' : '<p class="bs-src">The presets did not load. Fine-tune below, or build with the default.</p>'}
        <div class="bs-presets" role="radiogroup" aria-label="Presets">${Object.entries(PRESETS).map(([k, p]) => `<button type="button" role="radio" class="bs-p" data-preset="${k}" aria-checked="${key === k}"><b>${esc(p.label)}</b><span>${esc(p.why)}</span></button>`).join('')}</div>
        <details class="bs-fine"${(key === 'custom' && Object.keys(PRESETS).length) || st.fineOpen ? ' open' : ''}><summary>Fine-tune${key === 'custom' ? ' (custom)' : ''}</summary>
          <div class="bs-knobs">${KNOBS.map(([n, label, vals, word]) => `<div class="bs-k"><span class="bs-kl">${esc(label)}${GLOSS[n] ? ` <button type="button" class="bs-g" data-gloss="${n}" aria-label="What is ${esc(label.toLowerCase())}?">?</button>` : ''}</span><span class="bs-opts" role="group" aria-label="${esc(label)}">${vals.map((x) => `<button type="button" class="bs-o" data-k="${n}" data-val='${esc(JSON.stringify(x))}' aria-pressed="${st.v[n] === x}">${esc(word(x))}</button>`).join('')}</span></div>`).join('')}</div>
          ${st.glossOpen ? `<p class="small dim bs-gl">${esc(GLOSS[st.glossOpen])}</p>` : ''}
        </details>
        <div class="bs-est" aria-live="polite">${estHtml()}</div>
        <div class="bs-foot"><button type="button" class="btn" data-apply>Use these settings</button><button type="button" class="chipbtn" data-reset>Back to the default</button></div>
      </div>`;
  }
  function recompute() { st.est = estimate(); st.estState = 'done'; render(); }
  function open() {
    st.v = st.applied ? { ...st.applied.v } : { ...DEFAULT_V };
    root.hidden = false; document.body.classList.add('bs-on');
    if (!SIM) { st.estState = 'loading'; render(); loadSim().then(recompute); } else recompute();
    requestAnimationFrame(() => root.classList.add('open'));
    log('open', {});
  }
  function close() { root.classList.remove('open'); document.body.classList.remove('bs-on'); setTimeout(() => { root.hidden = true; }, 220); }
  // The choice rides on the form: preset + v (qb6's B3 reads them on /build).
  function apply(def) {
    form.querySelectorAll('input[data-bs]').forEach((i) => i.remove());
    const chip = document.getElementById('bschosen');
    if (def) { st.applied = null; if (chip) chip.textContent = ''; log('reset', {}); return close(); }
    const key = presetOf(st.v);
    st.applied = { key, v: { ...st.v } };
    const add = (name, value) => { const i = document.createElement('input'); i.type = 'hidden'; i.name = name; i.value = value; i.dataset.bs = '1'; form.appendChild(i); };
    add('preset', key); add('v', JSON.stringify(st.v));
    if (chip) chip.textContent = summary(key, st.v);
    log('apply', { key, v: st.v });
    close();
  }
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return close();
    const p = e.target.closest('[data-preset]');
    if (p) { st.v = { ...PRESETS[p.dataset.preset].v }; return recompute(); }
    const k = e.target.closest('[data-k]');
    if (k) { st.v[k.dataset.k] = JSON.parse(k.dataset.val); st.fineOpen = true; return recompute(); }
    const g = e.target.closest('[data-gloss]');
    if (g) { st.glossOpen = st.glossOpen === g.dataset.gloss ? null : g.dataset.gloss; st.fineOpen = true; return render(); }
    if (e.target.closest('[data-apply]')) return apply(false);
    if (e.target.closest('[data-reset]')) return apply(true);
  });
  // Fine-tune remembers only a real tap (a toggle event also fires when a render opens it).
  root.addEventListener('click', (e) => { const sm = e.target.closest('.bs-fine > summary'); if (sm) st.fineOpen = !sm.parentElement.open; }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !root.hidden) close(); });
  // Shown only when the server turned Build settings on for this viewer (qb6: <body data-build-settings="1">).
  const btn = document.getElementById('bsopen');
  if (btn && document.body.dataset.buildSettings === '1') { btn.hidden = false; btn.addEventListener('click', open); }
})();
