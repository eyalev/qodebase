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
  const st = { v: { ...DEFAULT_V }, est: null, estState: 'idle', applied: null, sug: null };
  // B4: 'Suggest settings for my prompt' (POST /api/build/suggest, owner-only while the flag is 'owner'). sug =
  // { state: 'reading'|'done'|'unsure'|'failed', prompt, job, preset, why, model, error }. While it matches the
  // box's text, every estimate is for that job instead of a typical small app.
  const idea = () => (form.querySelector('textarea')?.value || '').trim();
  const modelName = (m) => (!m ? 'a small model' : /haiku/i.test(m) ? 'a small model (Claude Haiku)' : /glm/i.test(m) ? 'a small model (GLM-4.7 Flash on Cloudflare)' : `a small model (${m.replace(/^@cf\/[^/]+\//, '')})`);
  const OVERLAP_W = { low: 'pieces mostly separate', some: 'some pieces touch the same files', high: 'many pieces touch the same files' };
  const DIFF_W = { easy: 'easy', normal: 'normal difficulty', hard: 'hard' };
  const jobNow = () => (st.sug?.job && st.sug.prompt === idea() ? st.sug.job : null);
  let SIM = null;

  async function loadSim() {
    try {
      SIM = await import('/lab/predict.js');
      PRESETS = Object.fromEntries(Object.entries(SIM.BUILD_PRESETS || {}).map(([k, p]) => [k, { label: k === 'fastest' ? `${p.label} (default)` : p.label, name: p.label, why: p.why, v: toV(p.variant) }]));
    } catch (e) { SIM = null; log('predict_missing', { error: String(e) }); }
  }
  // One estimate for the current settings. Ranges only; quality as a direction.
  function estimate() {
    if (!SIM?.predictBuild) return null;
    try {
      const j = jobNow();
      const r = SIM.predictBuild(j ? { tasks: j.tasks, overlap: j.overlap, difficulty: j.difficulty, label: 'your idea' } : SIM.SMALL_APP, toVariant(st.v));
      return r && { wallS: r.wallS, usd: r.apiUsd, basedOn: r.basedOn, same: r.sameSetup, quality: r.quality, notes: r.notes || [], mine: !!j, tasks: r.job?.tasks };
    } catch (e) { log('estimate_failed', { error: String(e), v: st.v }); return 'error'; }
  }
  // What the sheet ticks: a preset whose team matches, the board aside (a suggestion can turn it on). What it
  // sends is presetOf: exact, else 'custom' with v, so the board choice reaches the server.
  const presetLook = (v) => Object.keys(PRESETS).find((k) => KNOBS.every(([n]) => n === 'board' || PRESETS[k].v[n] === v[n])) || 'custom';
  const presetOf = (v) => Object.keys(PRESETS).find((k) => KNOBS.every(([n]) => PRESETS[k].v[n] === v[n])) || 'custom';
  const M = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus' };
  const alone = (v) => v.coders === 1 && v.coderModel === 'opus' && !v.reviewers;
  const team = (v) => (alone(v) ? 'one Opus agent' : `${v.coders} ${M[v.coderModel]} agent${v.coders === 1 ? '' : 's'} and an Opus planner${v.reviewers ? `, ${v.reviewers} reviewer${v.reviewers === 1 ? '' : 's'}` : ''}${v.board ? ', shared board' : ''}`);
  const summary = (key, v, e) => `${key === 'custom' ? (presetLook(v) !== 'custom' ? PRESETS[presetLook(v)].name : 'Custom') : PRESETS[key].name}: ${team(v)}${e && e !== 'error' ? `, about ${range(e.usd, usd)}` : ''}`;

  // The estimate's details (scroll with the sheet) and its one line (in the sticky footer, next to the button).
  function estHtml() {
    if (st.estState === 'loading') return '';
    const e = st.est;
    if (!e || e === 'error') return '';
    return `<div class="bs-est"><p class="bs-q">${esc(e.quality)}${e.notes.length ? ` ${esc(e.notes.join(' '))}` : ''}</p>
      <p class="bs-src">${e.mine ? `For your idea, as the small model read it (about ${e.tasks} pieces of work).` : `For a typical small app (about ${e.tasks || 8} pieces of work), not your idea yet.`} Based on ${e.basedOn} real lab runs${e.same ? '' : '; this exact setup wasn\'t run'}. With an API key you pay about this; with your Claude plan it uses your plan's limits instead, and more agents use them up faster.</p></div>`;
  }
  function estLine() {
    if (st.estState === 'loading') return 'Estimating…';
    const e = st.est;
    if (!e || e === 'error') return `${e === 'error' ? 'No estimate right now.' : 'No estimate yet.'} You can still build with these settings.`;
    return `${e.mine ? 'Your idea: about' : 'About'} <b>${range(e.wallS, mins)}</b> and <b>${range(e.usd, usd)}</b> at API prices`;
  }
  function sugHtml() {
    const g = st.sug, txt = idea();
    if (g?.state === 'reading') return '<div class="bs-sug"><p class="bs-src" aria-live="polite">Reading your idea…</p></div>';
    const btn = (label) => `<button type="button" class="bs-sugb" data-suggest${txt.length < 4 ? ' disabled' : ''}>${label}</button>${txt.length < 4 ? '<p class="bs-src">Write your idea in the box first.</p>' : ''}`;
    if (!g || g.prompt !== txt) return `<div class="bs-sug">${btn('Suggest settings for my idea')}${g && g.prompt !== txt && txt ? '<p class="bs-src">Your idea changed since the last suggestion.</p>' : ''}</div>`;
    if (g.state === 'failed') return `<div class="bs-sug"><p class="bs-src">${esc(g.error || 'Could not read your idea right now.')} Pick a preset yourself.</p>${g.retry ? btn('Try again') : ''}</div>`;
    const j = g.job, facts = j ? `About ${j.tasks} pieces of work, ${OVERLAP_W[j.overlap] || j.overlap}, ${DIFF_W[j.difficulty] || j.difficulty}.` : '';
    const head = g.state === 'unsure' ? '<p class="bs-q">The small model was not sure what this needs. Pick a preset yourself; the estimate below uses what it read.</p>'
      : `<p class="bs-q"><b>Suggested: ${esc(PRESETS[g.preset]?.name || g.preset)}.</b> ${esc(g.why)}</p>`;
    return `<div class="bs-sug bs-sugd">${head}${facts ? `<p class="bs-src">${esc(facts)} Read by ${esc(modelName(g.model))}, which can be wrong.</p>` : ''}</div>`;
  }
  async function suggest() {
    const prompt = idea();
    st.sug = { state: 'reading', prompt }; render();
    const t0 = performance.now();
    try {
      const r = await fetch('/api/build/suggest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }) });
      const d = await r.json().catch(() => ({}));
      log('suggest', { status: r.status, ms: Math.round(performance.now() - t0), job: d.job, preset: d.suggestion?.preset, model: d.model, fallback: d.fallback || false });
      if (!r.ok || d.fallback || !d.job) st.sug = { state: 'failed', prompt, retry: r.status !== 429 && r.status !== 404, error: r.status === 429 ? 'Suggestions are used up for today.' : r.status === 404 ? 'Suggestions are not available for your account yet.' : 'Could not read your idea right now.' };
      else if (!d.suggestion) st.sug = { state: 'unsure', prompt, job: d.job, model: d.model };
      else {
        st.sug = { state: 'done', prompt, job: d.job, preset: d.suggestion.preset, why: d.suggestion.why, model: d.model };
        const pv = PRESETS[d.suggestion.preset]?.v;
        if (pv) st.v = { ...pv, ...(typeof d.suggestion.board === 'boolean' && pv.coders > 1 ? { board: d.suggestion.board } : {}) };
      }
    } catch (e) { log('suggest_failed', { error: String(e) }); st.sug = { state: 'failed', prompt, retry: true, error: 'Could not reach qodebase.' }; }
    recompute();
    root.querySelector('.bs-sug')?.setAttribute('tabindex', '-1'); root.querySelector('.bs-sug')?.focus();
  }
  function render() {
    const key = presetLook(st.v);
    root.innerHTML = `<div class="bs-scrim" data-close></div>
      <div class="bs-panel" role="dialog" aria-modal="true" aria-labelledby="bs-t">
        <div class="bs-head"><h2 id="bs-t">Who builds it</h2><button type="button" class="bs-x" data-close aria-label="Close">×</button></div>
        ${sugHtml()}
        ${Object.keys(PRESETS).length ? '' : st.estState === 'loading' ? '<p class="bs-src">Loading the presets…</p>' : '<p class="bs-src">The presets did not load. Fine-tune below, or build with the default.</p>'}
        <div class="bs-presets" role="radiogroup" aria-label="Presets">${Object.entries(PRESETS).map(([k, p]) => `<button type="button" role="radio" class="bs-p" data-preset="${k}" aria-checked="${key === k}"><b>${esc(p.label)}</b><span>${esc(p.why)}</span></button>`).join('')}</div>
        <details class="bs-fine"${(key === 'custom' && Object.keys(PRESETS).length) || st.fineOpen ? ' open' : ''}><summary>Fine-tune${key === 'custom' ? ' (custom)' : ''}</summary>
          <div class="bs-knobs">${KNOBS.map(([n, label, vals, word]) => `<div class="bs-k"><span class="bs-kl">${esc(label)}${GLOSS[n] ? ` <button type="button" class="bs-g" data-gloss="${n}" aria-label="What is ${esc(label.toLowerCase())}?">?</button>` : ''}</span><span class="bs-opts" role="group" aria-label="${esc(label)}">${vals.map((x) => `<button type="button" class="bs-o" data-k="${n}" data-val='${esc(JSON.stringify(x))}' aria-pressed="${st.v[n] === x}"${n === 'board' && st.v.coders === 1 ? ' disabled' : ''}>${esc(word(x))}</button>`).join('')}</span></div>`).join('')}</div>
          ${st.glossOpen ? `<p class="small dim bs-gl">${esc(GLOSS[st.glossOpen])}</p>` : ''}
        </details>
        ${estHtml()}
        ${key === 'fastest' ? '' : '<button type="button" class="bs-reset" data-reset>Back to the default</button>'}
        <div class="bs-foot"><p class="bs-line" aria-live="polite">${estLine()}</p><button type="button" class="btn" data-apply>Use these settings</button></div>
      </div>`;
  }
  // Re-rendering replaces the buttons: keep focus on the same control.
  function recompute() {
    const f = document.activeElement, inside = f && root.contains(f);
    const sel = inside ? (f.dataset.preset ? `[data-preset="${f.dataset.preset}"]` : f.dataset.k ? `[data-k="${f.dataset.k}"][data-val='${f.dataset.val}']` : null) : null;
    st.est = estimate(); st.estState = 'done'; render();
    if (inside || !root.contains(document.activeElement)) (sel && root.querySelector(sel) || root.querySelector('.bs-p[aria-checked="true"]') || root.querySelector('.bs-x'))?.focus();
  }
  function open() {
    st.v = st.applied ? { ...st.applied.v } : { ...DEFAULT_V };
    root.hidden = false; document.body.classList.add('bs-on');
    if (!SIM) { st.estState = 'loading'; render(); loadSim().then(recompute); } else recompute();
    requestAnimationFrame(() => { root.classList.add('open'); (root.querySelector('.bs-p[aria-checked="true"]') || root.querySelector('.bs-x'))?.focus(); });
    log('open', {});
  }
  function close() { root.classList.remove('open'); document.body.classList.remove('bs-on'); setTimeout(() => { root.hidden = true; }, 220); document.getElementById('bsopen')?.focus(); }
  // The choice rides on the form: preset + v (qb6's B3 reads them on /build).
  function apply(def) {
    form.querySelectorAll('input[data-bs]').forEach((i) => i.remove());
    const chip = document.getElementById('bschosen');
    const key = presetOf(st.v);
    if (def || key === 'fastest') { st.applied = null; if (chip) chip.textContent = ''; log('apply_default', {}); return close(); }
    st.applied = { key, v: { ...st.v } };
    const add = (name, value) => { const i = document.createElement('input'); i.type = 'hidden'; i.name = name; i.value = value; i.dataset.bs = '1'; form.appendChild(i); };
    add('preset', key); add('v', JSON.stringify(st.v));
    if (chip) chip.textContent = summary(key, st.v, st.est);
    log('apply', { key, v: st.v });
    close();
  }
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return close();
    const p = e.target.closest('[data-preset]');
    if (p) { st.v = { ...PRESETS[p.dataset.preset].v }; return recompute(); }
    const k = e.target.closest('[data-k]');
    if (k) { st.v[k.dataset.k] = JSON.parse(k.dataset.val); if (st.v.coders === 1) st.v.board = false; st.fineOpen = true; return recompute(); }
    const g = e.target.closest('[data-gloss]');
    if (g) { st.glossOpen = st.glossOpen === g.dataset.gloss ? null : g.dataset.gloss; st.fineOpen = true; return render(); }
    if (e.target.closest('[data-suggest]')) return suggest();
    if (e.target.closest('[data-apply]')) return apply(false);
    if (e.target.closest('[data-reset]')) { st.v = { ...DEFAULT_V }; recompute(); root.querySelector('.bs-p[aria-checked="true"]')?.focus(); return; }
  });
  // Fine-tune remembers only a real tap (a toggle event also fires when a render opens it).
  root.addEventListener('click', (e) => { const sm = e.target.closest('.bs-fine > summary'); if (sm) st.fineOpen = !sm.parentElement.open; }, true);
  document.addEventListener('keydown', (e) => {
    if (root.hidden) return;
    if (e.key === 'Escape') return close();
    if (e.key !== 'Tab') return;
    const f = [...root.querySelectorAll('button:not([disabled]), summary')].filter((x) => x.offsetParent);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });
  // Shown only when the server turned Build settings on for this viewer (qb6: <body data-build-settings="1">).
  const btn = document.getElementById('bsopen');
  if (btn && document.body.dataset.buildSettings === '1') { btn.hidden = false; btn.addEventListener('click', open); }
})();
