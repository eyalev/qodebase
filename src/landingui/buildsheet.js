// Build settings under the home page's Build box (qb7, docs/board/TASKS.md B2 + B4). Behind flag BUILD_SETTINGS.
// Eyal, 2026-10-12: no modal. 'Adjust' expands a section in place: a row of presets (Fastest / Balanced /
// Cheapest / for my idea), sliders (agents, review depth, agent model) and a board switch, and outcome bars
// (time, cost, quality direction) that move while you drag. Picking a preset moves the sliders; moving a slider
// makes it Custom. The choice rides on the form as preset + v = {planner, coders, coderModel, reviewers, board}
// (qb6's B3 clamps it and ignores it unless the flag is on for the viewer). Estimates: qb4's predictBuild in
// /lab/predict.js; suggestions: POST /api/build/suggest (qb6, B4), bucketed by qb4 so a re-read agrees.
(() => {
  const form = document.querySelector('.landask');
  const root = document.getElementById('bsheet');
  const btn = document.getElementById('bsopen');
  if (!form || !root || !btn || document.body.dataset.buildSettings !== '1') return;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const log = (event, extra) => { try { console.log(JSON.stringify({ ts: new Date().toISOString(), module: 'buildsheet', event, ...extra })); } catch {} };
  const mins = (s) => (s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);
  const usd = (x) => (x < 10 ? `$${x.toFixed(2)}` : `$${Math.round(x)}`);
  const range = (r, f) => { if (!r) return '–'; const a = f(r[0]), b = f(r[1]); if (a === b) return a; const u = / (s|min)$/.exec(a); return u && b.endsWith(u[0]) ? `${a.slice(0, -u[0].length)} to ${b}` : `${a} to ${b}`; };
  const idea = () => (form.querySelector('textarea')?.value || '').trim();

  const MODELS = ['haiku', 'sonnet', 'opus'], M = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus' };
  const MODEL_COST = { haiku: 'the cheapest per agent', sonnet: 'about 20x Haiku per agent', opus: 'about 40x Haiku per agent' };
  const REVIEW_W = ['none', '1 reviewer', '2 reviewers', '3 reviewers'];
  const DEFAULT_V = { planner: 'opus', coders: 1, coderModel: 'opus', reviewers: 0, board: false };   // what Build does untouched
  const OVERLAP_W = { low: 'pieces mostly separate', some: 'some pieces touch the same files', high: 'many pieces touch the same files' };
  const DIFF_W = { easy: 'easy', normal: 'normal difficulty', hard: 'hard' };

  let SIM = null, PRESETS = {};
  const st = { v: { ...DEFAULT_V }, sug: null, open: false, est: null };
  const toV = (variant) => (variant.baseline === 'opus-alone' ? { ...DEFAULT_V }
    : { planner: variant.planner || 'opus', coders: variant.coders, coderModel: variant.coderModel, reviewers: variant.reviewers || 0, board: !!variant.board });
  // One Opus agent with no reviewer is the lab's opus-alone baseline (Fastest); anything else is a team.
  const alone = (v) => v.coders === 1 && v.coderModel === 'opus' && !v.reviewers;
  const toVariant = (v) => (alone(v) ? { baseline: 'opus-alone' }
    : { planner: v.planner, coders: v.coders, coderModel: v.coderModel, reviewers: v.reviewers, reviewerModel: v.coderModel, reviewStyle: 'read', policy: 'intent', claims: false, dedupe: true, trainMax: 4, board: v.board });
  const same = (a, b) => !!a && !!b && ['coders', 'coderModel', 'reviewers', 'board'].every((k) => a[k] === b[k]);
  const sugV = () => (st.sug?.state === 'done' && st.sug.v && st.sug.prompt === idea() ? st.sug.v : null);
  const jobNow = () => (st.sug?.job && st.sug.prompt === idea() ? st.sug.job : null);
  // Which chip is lit: the suggestion, a preset whose settings match exactly, or Custom.
  const which = (v) => (sugV() && same(v, sugV()) ? 'idea' : Object.keys(PRESETS).find((k) => same(v, PRESETS[k].v)) || 'custom');
  const team = (v) => (alone(v) ? 'one Opus agent' : `${v.coders} ${M[v.coderModel]} agent${v.coders === 1 ? '' : 's'} and an Opus planner${v.reviewers ? `, ${v.reviewers} reviewer${v.reviewers === 1 ? '' : 's'}` : ''}${v.board ? ', shared board' : ''}`);

  // ---- markup, built once; a drag only updates text, bars and inputs ----
  root.innerHTML = `
    <div class="bs-chips" role="radiogroup" aria-label="Presets">
      <button type="button" role="radio" class="bs-chip" data-preset="fastest" aria-checked="true"><b>Fastest</b><small></small></button>
      <button type="button" role="radio" class="bs-chip" data-preset="balanced" aria-checked="false"><b>Balanced</b><small></small></button>
      <button type="button" role="radio" class="bs-chip" data-preset="cheapest" aria-checked="false"><b>Cheapest</b><small></small></button>
      <button type="button" role="radio" class="bs-chip" data-preset="idea" aria-checked="false">Suggest from my idea</button>
      <span class="bs-chip bs-custom" aria-current="true" hidden>Custom: your own mix</span>
    </div>
    <p class="bs-hint bs-ideahint" hidden>Write your idea in the box above first; a small model reads it and suggests settings.</p>
    <p class="bs-why" aria-live="polite"></p>
    <div class="bs-sl">
      <label class="bs-row"><span class="bs-rl">Agents</span><b class="bs-rv" data-out="coders"></b>
        <input type="range" min="1" max="12" step="1" data-k="coders" aria-describedby="bs-hc"></label>
      <p class="bs-hint" id="bs-hc">With more than one, an Opus planner splits the work and each agent builds a piece on its own copy.</p>
      <label class="bs-row"><span class="bs-rl">Reviewers <span class="bs-sub">quality</span></span><b class="bs-rv" data-out="reviewers"></b>
        <input type="range" min="0" max="3" step="1" data-k="reviewers" aria-describedby="bs-hr"></label>
      <p class="bs-hint" id="bs-hr"></p>
      <label class="bs-row"><span class="bs-rl">Agent model <span class="bs-sub">cost per agent</span></span><b class="bs-rv" data-out="coderModel"></b>
        <input type="range" min="0" max="2" step="1" data-k="coderModel" aria-describedby="bs-hm"></label>
      <p class="bs-hint" id="bs-hm"></p>
      <div class="bs-row bs-sw"><span class="bs-rl" id="bs-bl">Shared board</span>
        <button type="button" role="switch" class="bs-switch" data-k="board" aria-checked="false" aria-labelledby="bs-bl" aria-describedby="bs-hb"><i></i></button></div>
      <p class="bs-hint" id="bs-hb"></p>
    </div>
    <p class="bs-out bs-wait" data-talk-dock>Write your idea above to see time and cost.</p>
    <div class="bs-out bs-est" data-talk-dock aria-live="polite">
      <p class="bs-for" data-out="for"></p>
      <div class="bs-bar"><span class="bs-bl">Time</span><b data-out="time"></b><div class="bs-track" data-bar="time"><i></i></div></div>
      <div class="bs-bar"><span class="bs-bl">Cost at API prices</span><b data-out="cost"></b><div class="bs-track" data-bar="cost"><i></i></div></div>
      <div class="bs-bar"><span class="bs-bl">Quality</span><b data-out="quality"></b><div class="bs-meter" data-bar="quality"><i></i><i></i><i></i><i></i></div></div>
      <button type="submit" class="btn bs-build">Build it</button>
    </div>
    <p class="bs-src" data-out="src"></p>
    <p class="bs-foot"><button type="button" class="bs-link" data-reset hidden>Back to the default</button></p>`;
  const $ = (sel) => root.querySelector(sel);
  const out = (k) => root.querySelector(`[data-out="${k}"]`);

  // Log-scale position of a value between lo and hi, in percent.
  const pos = (x, lo, hi) => Math.max(0, Math.min(100, (Math.log(Math.max(x, lo) / lo) / Math.log(hi / lo)) * 100));
  // predictBuild's quality is a direction in words; the meter shows the same direction, never a score.
  const QUALITY = [[/fewest/i, 4], [/fewer/i, 3], [/middle|about like/i, 2], [/more misses/i, 1]];
  function estimate() {
    if (!SIM?.predictBuild) return null;
    try {
      const j = jobNow();
      const r = SIM.predictBuild(j || SIM.SMALL_APP, toVariant(st.v));
      return r && { wallS: r.wallS, usd: r.apiUsd, basedOn: r.basedOn, same: r.sameSetup, quality: r.quality, notes: r.notes || [], mine: !!j, tasks: r.job?.tasks, agentTasks: r.agentTasks, measured: r.qualityMeasured !== false, guess: r.qualityGuess };
    } catch (e) { log('estimate_failed', { error: String(e), v: st.v }); return 'error'; }
  }
  const bucketWords = () => (st.sug?.bucket && jobNow() ? `${st.sug.bucket.replace(/ pieces?$/, '')} pieces of work` : null);
  // Eyal: with an empty box, numbers confuse. No prices on the chips, the dock asks for the idea; with text, the
  // estimate is for a typical small app until 'Suggest from my idea' reads it (never an automatic model call).
  const empty = () => idea().length < 4;
  function paintOut() {
    root.classList.toggle('bs-empty', empty());
    if (empty()) { st.est = null; out('src').textContent = ''; return; }
    const e = estimate();
    st.est = e;
    root.classList.toggle('bs-noest', !e || e === 'error');
    if (!e || e === 'error') {
      for (const k of ['time', 'cost', 'quality']) out(k).textContent = '';
      out('src').textContent = SIM || e === 'error' ? 'No estimate right now. You can still build with these settings.' : 'Loading the estimate…';
      return;
    }
    const cap = e.agentTasks, v = st.v;
    $('#bs-hc').textContent = v.coders === 1 ? 'One agent builds everything. With more, an Opus planner splits the work and each agent builds a piece on its own copy.'
      : cap && v.coders > cap ? `A limit, not a crew size: the planner splits this into about ${cap} task${cap === 1 ? '' : 's'}, so about ${cap} agent${cap === 1 ? '' : 's'} will work.`
      : `Up to ${v.coders} agents at once, each on its own copy${cap ? `; the planner makes about ${cap} tasks` : ''}.`;
    out('for').textContent = e.mine ? (st.sug?.state === 'unsure' ? 'Rough guess for your idea' : 'For your idea') : 'For a typical small app (Suggest from my idea reads yours)';
    out('time').textContent = range(e.wallS, mins);
    out('cost').textContent = range(e.usd, usd);
    const seg = (el, r, lo, hi) => { const a = pos(r[0], lo, hi), b = pos(r[1], lo, hi); el.style.left = `${a}%`; el.style.width = `${Math.max(3, b - a)}%`; };
    seg($('[data-bar="time"] i'), e.wallS, 30, 3600); seg($('[data-bar="cost"] i'), e.usd, 0.1, 10);
    // A setup the lab never ran: no meter, the words say so; qb4's guess goes in the small print.
    const q = e.measured ? (QUALITY.find(([re]) => re.test(e.quality)) || [0, 2])[1] : 0;
    out('quality').textContent = e.quality.replace(/\.$/, '');
    $('[data-bar="quality"]').classList.toggle('bs-unmeasured', !e.measured);
    root.querySelectorAll('[data-bar="quality"] i').forEach((el, i) => el.classList.toggle('on', i < q));
    out('src').textContent = `${e.mine ? `For your idea as the small model read it (${bucketWords() || `about ${e.tasks} pieces of work`}).` : `For a typical small app (about ${e.tasks || 8} pieces of work), not your idea yet.`} Based on ${e.basedOn} real lab runs${e.same ? '' : '; this exact setup wasn\'t run'}.${!e.measured && e.guess ? ` Quality guess: ${e.guess.replace(/\.$/, '').toLowerCase()}.` : ''} ${e.notes.join(' ')} With an API key you pay about this; with your Claude plan it uses your plan's limits instead, and more agents use them up faster.`;
  }
  function paintWhy() {
    const g = st.sug, w = $('.bs-why'), k = which(st.v);
    if (g?.state === 'reading') return void (w.textContent = 'Reading your idea…');
    if (g && g.prompt === idea()) {
      if (g.state === 'failed') return void (w.textContent = `${g.error} Pick a preset or drag the sliders.`);
      const j = g.job, facts = j ? ` ${bucketWords() || `About ${j.tasks} pieces of work`}, ${OVERLAP_W[j.overlap] || j.overlap}, ${DIFF_W[j.difficulty] || j.difficulty}. Read by ${g.model && /haiku/i.test(g.model) ? 'a small model (Claude Haiku)' : 'a small model (GLM-4.7 Flash on Cloudflare)'}, which can be wrong.` : '';
      if (g.state === 'unsure') return void (w.textContent = `The small model was not sure what this needs; pick yourself, the bars use what it read.${facts}`);
      if (k === 'idea') return void (w.innerHTML = `<b>For your idea: ${esc(PRESETS[g.preset]?.name || g.preset)}${g.v?.board && !PRESETS[g.preset]?.v.board ? ' with the board on' : ''}.</b> ${esc(g.why)}${esc(facts)}`);
    }
    w.textContent = k === 'custom' ? 'Your own mix. The bars below show what to expect.' : PRESETS[k]?.why || '';
  }
  // The form carries the choice; untouched (the default) adds nothing, so Build sends exactly what it always did.
  function paintForm() {
    form.querySelectorAll('input[data-bs]').forEach((i) => i.remove());
    const chip = document.getElementById('bschosen');
    const isDefault = same(st.v, DEFAULT_V);
    if (!isDefault) {
      const exact = Object.keys(PRESETS).find((p) => same(st.v, PRESETS[p].v)), k = which(st.v);
      for (const [name, value] of [['preset', exact || 'custom'], ['v', JSON.stringify(st.v)]]) {
        const i = document.createElement('input'); i.type = 'hidden'; i.name = name; i.value = value; i.dataset.bs = '1'; form.appendChild(i);
      }
    }
    // The settings row says the current choice in one line, and once there is text, about how long and how much.
    if (chip) { const k = which(st.v); chip.textContent = `${k === 'custom' ? 'Custom' : k === 'idea' ? 'For your idea' : PRESETS[k]?.name || 'Fastest'}: ${team(st.v)}`; }
    const ee = document.getElementById('bsest');
    if (ee) { const e = st.est; ee.textContent = e && e !== 'error' && !empty() ? `${range(e.wallS, mins)}, ${range(e.usd, usd)}${e.mine ? ' for your idea' : ''}` : ''; }
    try { sessionStorage.setItem('qb.bs', JSON.stringify({ open: st.open, v: st.v })); } catch {}
    // The estimate the person saw rides along (est), so the project page can show estimated vs elapsed (qb6 stores it).
    const e = st.est;
    if (e && e !== 'error' && !empty()) {
      const i = document.createElement('input'); i.type = 'hidden'; i.name = 'est'; i.dataset.bs = '1';
      i.value = JSON.stringify({ wallS: e.wallS, apiUsd: e.usd, basis: e.mine ? 'idea' : 'typical', basedOn: e.basedOn, simVersion: SIM?.SIM_VERSION || null });
      form.appendChild(i);
    }
    $('[data-reset]').hidden = isDefault;
  }
  function paint() {
    const v = st.v, k = which(v);
    root.querySelectorAll('.bs-chip').forEach((c) => c.setAttribute('aria-checked', String(c.dataset.preset === k)));
    const ideaChip = $('[data-preset="idea"]');
    ideaChip.textContent = sugV() ? `For my idea: ${PRESETS[st.sug.preset]?.name || st.sug.preset}` : st.sug?.state === 'reading' ? 'Reading your idea…' : 'Suggest from my idea';
    ideaChip.disabled = st.sug?.state === 'reading';
    $('.bs-ideahint').hidden = !!sugV() || idea().length >= 4;
    $('.bs-custom').hidden = k !== 'custom';
    paintPrices();
    $('[data-k="coders"]').value = v.coders; out('coders').textContent = v.coders === 1 ? '1 agent' : `up to ${v.coders}`;
    $('[data-k="reviewers"]').value = v.reviewers; out('reviewers').textContent = REVIEW_W[v.reviewers];
    $('[data-k="coderModel"]').value = MODELS.indexOf(v.coderModel); out('coderModel').textContent = M[v.coderModel];
    $('#bs-hm').textContent = `${M[v.coderModel]} is ${MODEL_COST[v.coderModel]}.`;
    $('#bs-hr').textContent = v.reviewers && v.coders === 1 ? 'With a reviewer, the one agent works as a planned team: an Opus planner, the agent and its reviewer.' : 'Each change is read once before it lands: fewer misses. More reviewers only cut the wait for a free one.';
    const sw = $('[data-k="board"]'); sw.setAttribute('aria-checked', String(v.board)); sw.disabled = v.coders === 1;
    $('#bs-hb').textContent = v.coders === 1 ? 'Needs more than one agent.' : 'Agents say what they are doing and which files they touch, so nothing is built twice.';
    root.querySelectorAll('input[type=range]').forEach((r) => r.style.setProperty('--p', `${((r.value - r.min) / (r.max - r.min)) * 100}%`));
    paintOut(); paintWhy(); paintForm();
  }
  // Each preset chip carries its cost for the current job (one estimate per preset, again only when the job changes).
  let priced = null;
  const PLAIN = { fastest: 'One strong agent does it all', balanced: 'A planned team with reviewers', cheapest: 'A planned team of small agents' };
  function paintPrices() {
    if (!SIM?.predictBuild) return;
    const j = jobNow(), key = JSON.stringify(j) + empty();
    if (priced === key) return;
    priced = key;
    for (const [k, p] of Object.entries(PRESETS)) {
      let t = PLAIN[k] || '';
      if (!empty()) try { const r = SIM.predictBuild(j || SIM.SMALL_APP, toVariant(p.v)); t = range(r.apiUsd, usd); } catch {}
      const sm = root.querySelector(`[data-preset="${k}"] small`); if (sm) sm.textContent = t;
    }
  }
  // predictBuild takes ~60 ms: during a drag, at most one estimate per frame.
  let raf = 0;
  const paintSoon = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); };

  let touched = false;   // a slider or preset moved while a suggestion was being read: the person's choice wins
  async function suggest() {
    const prompt = idea();
    if (prompt.length < 4) { st.sug = { state: 'failed', prompt, error: 'Write your idea in the box above first.' }; paint(); form.querySelector('textarea')?.focus(); return; }
    st.sug = { state: 'reading', prompt }; touched = false; paint();
    const t0 = performance.now();
    try {
      const r = await fetch('/api/build/suggest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }) });
      const d = await r.json().catch(() => ({}));
      log('suggest', { status: r.status, ms: Math.round(performance.now() - t0), job: d.job, preset: d.suggestion?.preset, bucket: d.suggestion?.bucket, model: d.model, fallback: d.fallback || false });
      if (!r.ok || d.fallback || !d.job) st.sug = { state: 'failed', prompt, error: r.status === 429 ? 'Suggestions are used up for today.' : r.status === 404 ? 'Suggestions are not available for your account yet.' : 'Could not read your idea right now.' };
      else if (!d.suggestion) st.sug = { state: 'unsure', prompt, job: d.job, model: d.model };
      else {
        const pv = PRESETS[d.suggestion.preset]?.v;
        const sv = pv ? { ...pv, ...(typeof d.suggestion.board === 'boolean' && pv.coders > 1 ? { board: d.suggestion.board } : {}) } : null;
        st.sug = { state: 'done', prompt, job: d.suggestion.job || d.job, bucket: d.suggestion.bucket || null, preset: d.suggestion.preset, why: d.suggestion.why, model: d.model, v: sv };
        if (sv && !touched) st.v = { ...sv };
      }
    } catch (e) { log('suggest_failed', { error: String(e) }); st.sug = { state: 'failed', prompt, error: 'Could not reach qodebase.' }; }
    paint();
  }

  root.addEventListener('input', (e) => {
    const r = e.target.closest('input[type=range]'); if (!r) return;
    const k = r.dataset.k, n = Number(r.value);
    touched = true;
    st.v = { ...st.v, [k]: k === 'coderModel' ? MODELS[n] : n };
    if (st.v.coders === 1) st.v.board = false;
    paintSoon();
  });
  // Touch: scroll and slide must be different gestures (Eyal, 2026-10-12: a page scroll that started on a slider
  // changed it). On touch screens the native range takes no touches (CSS, pointer:coarse); this decides on the
  // first move: horizontal (|dx| > 8 px and > |dy|) drags the value, vertical is left to the page (touch-action:
  // pan-y), a tap on the track steps one toward the finger. Keyboard and mouse keep the native control.
  root.querySelectorAll('.bs-row').forEach((row) => {
    const r = row.querySelector('input[type=range]'); if (!r) return;
    let g = null;   // { x, y, mode: null | 'slide' | 'scroll', v0 }
    const valueAt = (x) => {
      const b = r.getBoundingClientRect(), min = +r.min, max = +r.max, thumb = 28;
      const f = Math.max(0, Math.min(1, (x - b.left - thumb / 2) / Math.max(1, b.width - thumb)));
      return Math.round(min + f * (max - min));
    };
    const set = (v, kind) => { if (+r.value === v && kind === 'input') return; r.value = String(v); r.dispatchEvent(new Event(kind, { bubbles: true })); };
    row.addEventListener('touchstart', (e) => { if (e.touches.length !== 1) return void (g = null); const t = e.touches[0]; g = { x: t.clientX, y: t.clientY, mode: null, v0: +r.value }; }, { passive: true });
    row.addEventListener('touchmove', (e) => {
      if (!g) return; const t = e.touches[0], dx = t.clientX - g.x, dy = t.clientY - g.y;
      if (!g.mode) { if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) { g.mode = 'slide'; touched = true; } else if (Math.abs(dy) > 8) { g.mode = 'scroll'; log('slider_scroll', { k: r.dataset.k }); } }
      if (g.mode === 'slide') { e.preventDefault(); set(valueAt(t.clientX), 'input'); }
    }, { passive: false });
    row.addEventListener('touchend', (e) => {
      if (!g) return;
      if (g.mode === 'slide') set(+r.value, 'change');
      else if (!g.mode && (() => { const b = r.getBoundingClientRect(); return g.y >= b.top && g.y <= b.bottom; })()) {   // a tap on the track: one step toward the finger, never a jump
        const v = valueAt(g.x), cur = +r.value;
        if (v !== cur) { set(cur + (v > cur ? 1 : -1), 'input'); set(+r.value, 'change'); }
      }
      g = null;
    });
    row.addEventListener('touchcancel', () => { g = null; });
  });
  root.addEventListener('change', (e) => { if (e.target.matches('input[type=range]')) log('slider', { k: e.target.dataset.k, v: st.v }); });
  root.addEventListener('click', (e) => {
    const c = e.target.closest('[data-preset]');
    if (c) {
      const k = c.dataset.preset;
      if (k === 'idea') { if (!sugV()) return void suggest(); st.v = { ...sugV() }; }
      else if (PRESETS[k]) { touched = true; st.v = { ...PRESETS[k].v }; }
      log('preset', { k }); return paint();
    }
    const sw = e.target.closest('[data-k="board"]');
    if (sw && !sw.disabled) { touched = true; st.v = { ...st.v, board: !st.v.board }; return paint(); }
    if (e.target.closest('[data-reset]')) { st.v = { ...DEFAULT_V }; log('reset', {}); return paint(); }
  });
  // Arrow keys move between the preset chips (a radio group).
  $('.bs-chips').addEventListener('keydown', (e) => {
    if (!/^Arrow(Left|Right)$/.test(e.key)) return;
    const cs = [...root.querySelectorAll('.bs-chip:not([disabled])')], i = cs.indexOf(document.activeElement);
    if (i < 0) return; e.preventDefault(); cs[(i + (e.key === 'ArrowRight' ? 1 : cs.length - 1)) % cs.length].focus();
  });
  // A changed idea makes 'For my idea' stale: the chip asks again and the bars go back to a typical app.
  form.querySelector('textarea')?.addEventListener('input', () => paintSoon());

  async function loadSim() {
    try {
      SIM = await import('/lab/predict.js');
      PRESETS = Object.fromEntries(Object.entries(SIM.BUILD_PRESETS || {}).map(([k, p]) => [k, { name: p.label, why: p.why, v: toV(p.variant) }]));
    } catch (e) { SIM = null; log('predict_missing', { error: String(e) }); }
  }
  // The settings row between the box and Build it is a toggle: tap expands the controls in place, tap again
  // collapses (Eyal, 2026-10-12). Open state and choice are kept for the session.
  function toggle(open) {
    st.open = open; root.hidden = !open; btn.setAttribute('aria-expanded', String(open));
    paint();
    log(open ? 'open' : 'close', {});
  }
  try { const saved = JSON.parse(sessionStorage.getItem('qb.bs') || 'null'); if (saved?.v && typeof saved.v.coders === 'number') st.v = { ...DEFAULT_V, ...saved.v }; if (saved?.open) { st.open = true; root.hidden = false; btn.setAttribute('aria-expanded', 'true'); } } catch {}
  btn.hidden = false; btn.setAttribute('aria-controls', 'bsheet'); if (!st.open) btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('click', () => toggle(root.hidden));
  paint(); loadSim().then(paint);   // the row shows the estimate even while collapsed
})();
