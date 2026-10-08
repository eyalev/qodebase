// Variants lab (qb7, docs/lab/PLAN.md): which way of running many agents wins, for whom.
// 1) Try a setup: scenario + knobs -> instant prediction from qb4's simulation
//    (public/lab/predict.js), next to the two baselines. The owner gets "Run for real":
//    the estimate and the runner command (v0; a queue comes after stage 1).
// 2) Results: public/lab/runs.jsonl (docs/lab/runs-schema.md), one dot per setup (median of
//    its repetitions) on time x quality, predicted vs actual, tap -> runs, replay, the app.
// 3) The funnel: public/lab/stages.jsonl. ?mock=1 reads the *.mock.jsonl sample files.
(() => {
  const root = document.getElementById('lab');
  if (!root) return;
  const OWN = 'own' in root.dataset;
  const Q = new URLSearchParams(location.search);
  const MOCK = Q.has('mock');
  const BASE = root.dataset.base || '/lab'; // where runs.jsonl, stages.jsonl, scenarios.json and predict.js live
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const log = (event, extra) => { try { console.log(JSON.stringify({ ts: new Date().toISOString(), module: 'lab', event, ...extra })); } catch {} };
  const mins = (s) => (s == null ? '–' : s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);
  const usd = (x) => (x == null ? '–' : x < 0.1 ? `$${x.toFixed(3)}` : `$${x.toFixed(2)}`);
  const med = (a) => { const b = a.filter((x) => x != null).sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[b.length >> 1] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : null; };

  // ---- knobs (qb4's KNOBS from predict.js replace these when it loads) --------------------
  let KNOBS = {
    coders: { label: 'Coding agents', values: [1, 3, 6, 12, 24], def: 6 },
    coderModel: { label: 'Coder model', values: ['haiku', 'sonnet', 'opus'], def: 'haiku' },
    planner: { label: 'Planner model', values: ['haiku', 'sonnet', 'opus'], def: 'sonnet' },
    reviewers: { label: 'Reviewers', values: [0, 1, 3, 6], def: 1 },
    reviewerModel: { label: 'Reviewer model', values: ['haiku', 'sonnet', 'opus'], def: 'haiku' },
    reviewStyle: { label: 'How reviewers check', values: ['read', 'adversarial'], def: 'read' },
    policy: { label: 'How changes land', values: ['intent', 'phases', 'stacking', 'leads', 'ffa'], def: 'intent' },
    claims: { label: 'Claims', values: [true, false], def: true },
    dedupe: { label: 'Duplicate check', values: [true, false], def: true },
    trainMax: { label: 'Changes tested together', values: [1, 4, 8, 16], def: 8 },
  };
  const WORDS = {
    reviewStyle: { read: 'Read the change', adversarial: 'Try to break it' },
    policy: { intent: 'Land by intent', phases: 'In phases', stacking: 'Stacking', leads: 'Area leads', ffa: 'Free for all', github: 'GitHub-style' },
    claims: { true: 'On', false: 'Off' }, dedupe: { true: 'On', false: 'Off' },
    model: { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus', none: 'none' },
  };
  const GLOSS = {
    intent: 'When two changes collide, the later one is re-applied on the newest code instead of being sent back.',
    phases: 'Changes land in planned phases; later tasks start only after the earlier phase has landed.',
    stacking: 'A change can build on another one that has not landed yet; they land in order.',
    leads: 'Each part of the code has a lead agent who combines collisions there.',
    ffa: 'Every change lands as soon as it is ready; collisions are left to whoever comes next.',
    adversarial: 'The reviewer must try to write a test that fails before it approves.',
    claims: 'Agents say which files they will touch, so others can avoid them.',
    dedupe: 'Before work starts, tasks that ask for the same thing are merged into one.',
    trainMax: 'Finished changes are tested together in groups of this size before landing.',
  };
  const BASELINES = {
    'opus-alone': { label: 'One Opus agent alone', about: 'One Opus agent gets the whole request: no planner, no split, no reviewer.' },
    github: { label: 'GitHub-style', about: 'One pull request per agent; any conflict sends it back to rebase. No replays.' },
  };
  const mdl = (m) => WORDS.model[m] || m;
  const plain = (v, baseline) => {
    if (baseline) return BASELINES[baseline]?.label || baseline;
    const parts = [`${v.coders} ${mdl(v.coderModel)} coder${v.coders === 1 ? '' : 's'}`, v.planner && v.planner !== 'none' ? `${mdl(v.planner)} planner` : null,
      v.reviewers ? `${v.reviewers} reviewer${v.reviewers === 1 ? '' : 's'}${v.reviewStyle === 'adversarial' ? ' who try to break it' : ''}` : 'no reviewer',
      (WORDS.policy[v.policy] || v.policy).toLowerCase()];
    return parts.filter(Boolean).join(', ');
  };
  const vkey = (v, b) => (SIM?.variantKey ? SIM.variantKey(v, b) : b ? b : `${v.planner}/${v.coders}x${v.coderModel}/r${v.reviewers}${String(v.reviewStyle)[0]}/${v.policy}${v.claims ? '+c' : ''}${v.dedupe ? '+d' : ''}/t${v.trainMax}`);

  // ---- state ------------------------------------------------------------------------------------
  const st = { scenario: Q.get('s') || 'cafe-family', v: {}, open: null, more: false };
  for (const [k, kb] of Object.entries(KNOBS)) st.v[k] = kb.def;
  try { const qv = JSON.parse(Q.get('v') || 'null'); if (qv) Object.assign(st.v, qv); } catch {}
  let SIM = null, simErr = '', SCEN = [], RUNS = [], STAGES = [], loaded = false;

  async function load() {
    const sfx = MOCK ? '.mock' : '';
    const jl = (t) => t.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const [sc, runs, stages] = await Promise.all([
      fetch(`${BASE}/scenarios.json`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch(`${BASE}/runs${sfx}.jsonl`, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : '')).then(jl).catch(() => []),
      fetch(`${BASE}/stages${sfx}.jsonl`, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : '')).then(jl).catch(() => []),
    ]);
    SCEN = sc.length ? sc : [
      { id: 'cafe-family', title: 'Make the café site family-friendly', about: 'A vague feature request on an existing site: the planner has to decide what it means.' },
      { id: 'port-ts', title: 'Port a library to TypeScript', about: 'uuid (a small, popular JavaScript library) ported file by file; its own tests must still pass.' },
    ];
    RUNS = runs; STAGES = stages;
    try {
      SIM = await import(`${BASE}/predict.js`);
      if (SIM.KNOBS) KNOBS = normKnobs(SIM.KNOBS);
      // GitHub-style is a baseline, not a landing choice.
      if (KNOBS.policy) KNOBS.policy = { ...KNOBS.policy, values: KNOBS.policy.values.filter((x) => x !== 'github') };
      if (SIM.DEFAULT_VARIANT && !Q.get('v')) Object.assign(st.v, SIM.DEFAULT_VARIANT);
    } catch (e) { SIM = null; simErr = String(e.message || e); log('predict_missing', { error: simErr }); }
    loaded = true;
    log('loaded', { scenarios: SCEN.length, runs: RUNS.length, stages: STAGES.length, sim: !!SIM, mock: MOCK });
  }
  // qb4's KNOBS may be {name: {values, default, label}}: keep ours for anything missing.
  function normKnobs(k) {
    const out = { ...KNOBS };
    for (const [n, x] of Object.entries(k || {})) if (x && Array.isArray(x.values)) out[n] = { label: x.label || KNOBS[n]?.label || n, values: x.values, def: x.default ?? x.def ?? x.values[0] };
    return out;
  }
  function predict(v, baseline) {
    if (!SIM?.predict) return null;
    try {
      const variant = baseline ? { ...(SIM.BASELINES?.[baseline] || v) } : { ...v };
      const p = SIM.predict(variant, st.scenario, baseline ? { baseline } : {});
      return p && { wallS: p.wallS, usd: p.apiUsdStd, quality: p.quality, landed: p.landed, range: p.range || null };
    } catch (e) { log('predict_failed', { error: String(e) }); return null; }
  }

  // ---- 1. try a setup ---------------------------------------------------------------------------
  const scenOf = (id) => SCEN.find((s) => s.id === id) || { id, title: id };
  function knobRow(name) {
    const kb = KNOBS[name]; if (!kb) return '';
    const word = (x) => (/Model$|^planner$/.test(name) ? mdl(x) : WORDS[name]?.[x] ?? String(x));
    const g = GLOSS[name] ? ` <button class="gl" type="button" data-gloss="${name}" aria-label="What is this?">?</button>` : '';
    return `<div class="knob"><span class="kl">${esc(kb.label)}${g}</span><span class="opts" role="group" aria-label="${esc(kb.label)}">${kb.values.map((x) => `<button type="button" class="opt" data-k="${name}" data-val='${esc(JSON.stringify(x))}' aria-pressed="${String(st.v[name] === x)}">${esc(word(x))}</button>`).join('')}</span></div>`;
  }
  function bars(title, rows, fmt, better) {
    const max = Math.max(...rows.map((r) => r.val || 0), 1e-9);
    return `<div class="bars"><div class="bt">${esc(title)} <span class="dim">${better}</span></div>${rows.map((r) => `<div class="br ${r.cls}"><span class="bn">${esc(r.label)}</span><span class="bw"><i style="width:${r.val == null ? 0 : Math.max(2, (100 * r.val) / max).toFixed(1)}%"></i></span><span class="bv">${r.val == null ? '–' : fmt(r.val)}</span></div>`).join('')}</div>`;
  }
  function tryView() {
    const sc = scenOf(st.scenario);
    const me = predict(st.v), oa = predict(null, 'opus-alone'), gh = predict(null, 'github');
    const rows = (k) => [{ label: 'This setup', cls: 'me', val: me?.[k] }, { label: 'One Opus agent alone', cls: 'b1', val: oa?.[k] }, { label: 'GitHub-style', cls: 'b2', val: gh?.[k] }];
    let sentence = '';
    if (me) {
      const vs = oa && oa.wallS ? ` That is ${(oa.wallS / me.wallS).toFixed(1)}× ${oa.wallS >= me.wallS ? 'faster' : 'slower'} than one Opus agent alone, at ${(me.usd / (oa.usd || 1)).toFixed(1)}× the cost.` : '';
      const rg = me.range?.wallS ? ` <span class="dim">(likely ${mins(me.range.wallS[0])} to ${mins(me.range.wallS[1])})</span>` : '';
      sentence = `<p class="pred">Predicted: done in <b>${mins(me.wallS)}</b>${rg}, quality <b>${Math.round(me.quality)}/100</b>, <b>${usd(me.usd)}</b> at API prices.${vs}</p>`;
    }
    return `<section class="sec" id="try"><h2>Try a setup</h2>
      <p class="cap">Pick a job and how the agents should work. A simulation predicts the result at once; the best setups are then run for real.</p>
      <div class="scen" role="group" aria-label="Scenario">${SCEN.map((s) => `<button type="button" class="sc" data-scen="${esc(s.id)}" aria-pressed="${String(s.id === st.scenario)}"><b>${esc(s.title)}</b>${s.about ? `<span>${esc(s.about)}</span>` : ''}</button>`).join('')}</div>
      <div class="knobs">${['coders', 'coderModel', 'planner', 'reviewers', 'policy'].map(knobRow).join('')}</div>
      <details class="more"${st.more ? ' open' : ''}><summary>More settings</summary><div class="knobs">${['reviewerModel', 'reviewStyle', 'claims', 'dedupe', 'trainMax'].filter((k) => k !== 'reviewerModel' || st.v.reviewers > 0).map(knobRow).join('')}</div></details>
      <div class="predbox" aria-live="polite">
        ${SIM ? `${sentence}${bars('Time to finish', rows('wallS'), mins, 'shorter is better')}${bars('Quality', rows('quality'), (x) => `${Math.round(x)}/100`, 'higher is better')}${bars('Cost at API prices', rows('usd'), usd, 'lower is better')}
          <p class="small dim">Prediction by the lab's simulation${SIM.SIM_VERSION ? ` (${esc(SIM.SIM_VERSION)})` : ''}, calibrated on real runs. Quality is the hidden tests, the build and a judge, out of 100.</p>`
        : `<p class="dim">The simulation is not loaded yet, so there is no prediction to show.${MOCK ? '' : ''}</p>`}
      </div>
      ${OWN ? runForReal(me) : ''}
      ${me ? `<div class="pin" aria-hidden="true"><span>This setup</span><b>${mins(me.wallS)}</b><b>${Math.round(me.quality)}/100</b><b>${usd(me.usd)}</b></div>` : ''}
    </section>`;
  }
  function runForReal(me) {
    const cmd = `node scripts/lab/run.mjs --scenario ${st.scenario} --variant '${JSON.stringify(st.v)}'`;
    return `<details class="real"><summary class="btn">Run for real</summary>
      <div class="realb"><p>Estimate: about <b>${me ? mins(me.wallS) : '?'}</b> and <b>${me ? usd(me.usd) : '?'}</b> at API prices (Claude runs on the subscription; containers are billed for real). The runner refuses to start over the stage budget.</p>
      <p class="small dim">For now runs start from the laptop. Copy this into a terminal in the qodebase folder:</p>
      <pre class="cmd"><code>${esc(cmd)}</code></pre><button type="button" class="chipb" data-copy="${esc(cmd)}">Copy command</button></div></details>`;
  }

  // ---- 2. results -------------------------------------------------------------------------------
  function groups() {
    const by = new Map();
    for (const r of RUNS.filter((x) => x.scenario === st.scenario && x.status !== 'failed')) {
      const k = r.variantKey || vkey(r.variant || {}, r.baseline);
      if (!by.has(k)) by.set(k, { key: k, baseline: r.baseline, variant: r.variant, runs: [] });
      by.get(k).runs.push(r);
    }
    return [...by.values()].map((g) => ({ ...g,
      wallS: med(g.runs.map((r) => r.timings?.wallS)), quality: med(g.runs.map((r) => r.quality?.score)), usd: med(g.runs.map((r) => r.cost?.apiUsdStd)),
      pWallS: med(g.runs.map((r) => r.predicted?.wallS)), pQuality: med(g.runs.map((r) => r.predicted?.quality)), stage: Math.max(...g.runs.map((r) => r.stage || 0)) }));
  }
  function scatter(gs) {
    const W = 340, H = 250, L = 36, B = 34, T = 18, R = 10;
    const xs = gs.flatMap((g) => [g.wallS, g.pWallS]).filter((x) => x != null), ys = gs.flatMap((g) => [g.quality, g.pQuality]).filter((x) => x != null);
    const xMax = Math.max(60, ...xs) * 1.08, yMin = Math.max(0, Math.floor((Math.min(...ys, 100) - 8) / 10) * 10), yMax = 100;
    const X = (s) => L + ((W - L - R) * s) / xMax, Y = (q) => T + ((H - T - B) * (yMax - q)) / (yMax - yMin);
    const xt = [0, 1, 2, 3, 4].map((i) => Math.round((xMax / 60 / 4) * i)).filter((v, i, a) => a.indexOf(v) === i);
    const yt = []; for (let q = yMin; q <= 100; q += yMax - yMin > 40 ? 20 : 10) yt.push(q);
    const best = bestOf(gs);
    const dots = gs.map((g, i) => {
      if (g.wallS == null || g.quality == null) return '';
      const x = X(g.wallS), y = Y(g.quality), on = st.open === g.key, cls = g.baseline ? 'bl' : 'vr';
      const ghost = g.pWallS != null && g.pQuality != null ? `<line class="pl" x1="${X(g.pWallS).toFixed(1)}" y1="${Y(g.pQuality).toFixed(1)}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/><circle class="pd" cx="${X(g.pWallS).toFixed(1)}" cy="${Y(g.pQuality).toFixed(1)}" r="4"/>` : '';
      const mark = g.baseline ? `<rect class="m ${cls}${on ? ' on' : ''}" x="${(x - 6).toFixed(1)}" y="${(y - 6).toFixed(1)}" width="12" height="12" rx="2"/>` : `<circle class="m ${cls}${on ? ' on' : ''}${g === best ? ' best' : ''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6"/>`;
      const left = x > W * 0.62;
      const label = g.baseline || g === best || on ? `<text class="dl" x="${(left ? x - 9 : x + 9).toFixed(1)}" y="${(y + 4).toFixed(1)}"${left ? ' text-anchor="end"' : ''}>${esc(g.baseline ? BASELINES[g.baseline]?.label : g === best ? 'Best so far' : plain(g.variant).split(',')[0])}</text>` : '';
      return `<g class="pt" data-open="${esc(g.key)}" tabindex="0" role="button" aria-label="${esc(plain(g.variant, g.baseline))}: ${mins(g.wallS)}, quality ${Math.round(g.quality)}"><circle class="hit" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="16"/>${ghost}${mark}${label}</g>`;
    }).join('');
    return `<p class="ct">Quality (out of 100) by minutes to finish</p><svg class="sc-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="Each setup by time to finish and quality">
      ${yt.map((q) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(q)}" y2="${Y(q)}"/><text class="ax" x="${L - 6}" y="${Y(q) + 4}" text-anchor="end">${q}</text>`).join('')}
      ${xt.map((m) => `<text class="ax" x="${X(m * 60)}" y="${H - 10}" text-anchor="middle">${m}</text>`).join('')}
      <text class="ax" x="${W - R}" y="${H}" text-anchor="end">minutes</text>
      ${dots}</svg>
      <div class="key"><span><i class="k vr"></i>a setup (median of its runs)</span><span><i class="k bl"></i>baseline</span><span><i class="k pd"></i>what the simulation predicted</span></div>
      <p class="small dim">Up and to the left is better: higher quality in less time.</p>`;
  }
  // Best = highest quality among the setups within 1.5x of the fastest time; ties: cheaper.
  function bestOf(gs) {
    const vr = gs.filter((g) => !g.baseline && g.wallS != null && g.quality != null);
    if (!vr.length) return null;
    return vr.slice().sort((a, b) => b.quality - a.quality || a.wallS - b.wallS || a.usd - b.usd)[0];
  }
  function compare(gs) {
    const best = bestOf(gs), oa = gs.find((g) => g.baseline === 'opus-alone'), gh = gs.find((g) => g.baseline === 'github');
    if (!best) return '';
    const vs = (b) => (b && b.wallS ? `${plain(null, b.baseline)}: ${mins(b.wallS)}, ${Math.round(b.quality)}/100, ${usd(b.usd)}` : null);
    const lines = [vs(oa), vs(gh)].filter(Boolean);
    return `<div class="cmp"><p><b>Best so far:</b> ${esc(plain(best.variant))}. Done in <b>${mins(best.wallS)}</b>, quality <b>${Math.round(best.quality)}/100</b>, <b>${usd(best.usd)}</b> at API prices (median of ${best.runs.length} run${best.runs.length === 1 ? '' : 's'}).</p>${lines.length ? `<p class="dim">Compared with ${lines.map(esc).join('; ')}.</p>` : ''}</div>`;
  }
  function list(gs) {
    const sorted = gs.slice().sort((a, b) => (b.quality ?? -1) - (a.quality ?? -1) || (a.wallS ?? 1e9) - (b.wallS ?? 1e9));
    return `<ul class="rows">${sorted.map((g) => {
      const on = st.open === g.key;
      return `<li class="${on ? 'open' : ''}"><button type="button" class="rw" data-open="${esc(g.key)}" aria-expanded="${on}"><i class="k ${g.baseline ? 'bl' : 'vr'}"></i><span class="t">${esc(plain(g.variant, g.baseline))}</span>
        <span class="nums"><span>${mins(g.wallS)}</span><span>${g.quality == null ? '–' : Math.round(g.quality)}/100</span><span>${usd(g.usd)}</span></span>
        <span class="sub">${g.runs.length} run${g.runs.length === 1 ? '' : 's'}, stage ${g.stage}${g.pWallS != null ? `; predicted ${mins(g.pWallS)}, ${Math.round(g.pQuality)}/100` : ''}</span></button>${on ? detail(g) : ''}</li>`;
    }).join('')}</ul>`;
  }
  function detail(g) {
    const about = g.baseline ? BASELINES[g.baseline]?.about : `Planner ${mdl(g.variant.planner)}; ${g.variant.coders} ${mdl(g.variant.coderModel)} coders; ${g.variant.reviewers} reviewer${g.variant.reviewers === 1 ? '' : 's'} (${WORDS.reviewStyle[g.variant.reviewStyle] || g.variant.reviewStyle}); ${WORDS.policy[g.variant.policy] || g.variant.policy}; claims ${g.variant.claims ? 'on' : 'off'}; duplicate check ${g.variant.dedupe ? 'on' : 'off'}; up to ${g.variant.trainMax} tested together.`;
    const runs = g.runs.slice().sort((a, b) => (a.seed || 0) - (b.seed || 0)).map((r) => {
      const c = r.counts || {}, q = r.quality || {};
      const words = [`${c.tasksLanded ?? '?'} of ${c.tasksPlanned ?? '?'} tasks landed`, c.conflicts ? `${c.conflicts} collision${c.conflicts === 1 ? '' : 's'}` : 'no collisions',
        (c.replaysHandler || 0) + (c.replaysLlm || 0) ? `${(c.replaysHandler || 0) + (c.replaysLlm || 0)} replayed` : null, c.bounces ? `${c.bounces} sent back` : null,
        c.breaksOnMain ? `${c.breaksOnMain} broke main` : null, q.hiddenTotal ? `${q.hiddenPass}/${q.hiddenTotal} hidden tests` : null].filter(Boolean).join(', ');
      const status = r.status && r.status !== 'done' ? ` <span class="warn">${esc({ 'stopped-budget': 'stopped: budget', timeout: 'timed out', failed: 'failed' }[r.status] || r.status)}</span>` : '';
      return `<li><span class="rn">Run ${r.seed ?? ''}${status}</span><span class="rv">${mins(r.timings?.wallS)}, ${q.score ?? '–'}/100, ${usd(r.cost?.apiUsdStd)}</span>
        <span class="rw2">${esc(words)}.</span>
        <span class="lk">${r.links?.replay ? `<a href="${esc(r.links.replay)}">Watch the replay</a>` : ''}${r.links?.app ? `<a href="${esc(r.links.app)}" target="_blank" rel="noopener">The app it built</a>` : ''}${r.links?.repo ? `<a href="${esc(r.links.repo)}">The code</a>` : ''}</span></li>`;
    }).join('');
    return `<div class="det"><p class="small">${esc(about)}</p><ul class="runs">${runs}</ul></div>`;
  }
  function resultsView() {
    const gs = groups();
    const n = RUNS.filter((r) => r.scenario === st.scenario).length;
    return `<section class="sec" id="results"><h2>Results so far</h2>
      ${n ? `<p class="cap">${n} real run${n === 1 ? '' : 's'} of “${esc(scenOf(st.scenario).title)}”, ${gs.length} setup${gs.length === 1 ? '' : 's'}. Tap a dot or a row for its runs, the replay and the app it built.</p>${compare(gs)}${scatter(gs)}${list(gs)}`
        : `<p class="dim">No real runs of this job yet. The simulation picks the setups worth running; they appear here as they finish.</p>`}
    </section>`;
  }
  function funnelView() {
    if (!STAGES.length) return '';
    const NAMES = { 0: 'Simulation', 1: 'Small real runs', 2: 'More agents, more repetitions', 3: 'At scale' };
    return `<section class="sec" id="funnel"><h2>How setups are picked</h2>
      <p class="cap">Every combination is simulated for free; only the best few are run for real, each stage with its own budget.</p>
      <ol class="funnel">${STAGES.slice().sort((a, b) => a.stage - b.stage).map((s) => `<li><b>Stage ${s.stage}: ${esc(NAMES[s.stage] || '')}</b><span>${s.setups ?? '?'} setup${s.setups === 1 ? '' : 's'}${s.runs != null && s.runs !== s.setups ? `, ${s.runs} runs` : ''}${s.kept != null ? `; ${s.kept} kept` : ''}${s.usdReal ? `; ${usd(s.usdReal)} real spend` : ''}${s.quotaPctAccount ? `; ${s.quotaPctAccount}% of the weekly Claude quota (account-wide meter)` : ''}</span>${s.notes ? `<span class="dim">${esc(s.notes)}</span>` : ''}</li>`).join('')}</ol></section>`;
  }

  // ---- render, events ----------------------------------------------------------------------------
  const pop = document.createElement('div'); pop.className = 'lab-pop'; pop.id = 'lab-pop'; pop.setAttribute('popover', ''); document.body.appendChild(pop);
  function render() {
    if (!loaded) { root.innerHTML = '<p class="dim">Loading the lab…</p>'; return; }
    root.innerHTML = `${MOCK || RUNS.some((r) => r.mock) ? '<div class="mock"><b>Sample data.</b> These results are invented to show the page; real runs replace them.</div>' : ''}
      <h1>Variants lab</h1>
      <p class="lede">Is one strong agent better than many? How many, checked by whom, landing how? We predict every setup with a simulation, run the best ones on real jobs, and score what they built with tests the agents never saw.</p>
      ${tryView()}${resultsView()}${funnelView()}`;
  }
  function setUrl() {
    const u = new URL(location.href); u.searchParams.set('s', st.scenario); u.searchParams.set('v', JSON.stringify(st.v)); history.replaceState(null, '', u);
  }
  root.addEventListener('click', async (e) => {
    const o = e.target.closest('[data-k]');
    if (o) { st.v[o.dataset.k] = JSON.parse(o.dataset.val); setUrl(); render(); return; }
    const sc = e.target.closest('[data-scen]');
    if (sc) { st.scenario = sc.dataset.scen; st.open = null; setUrl(); render(); return; }
    const op = e.target.closest('[data-open]');
    if (op) { st.open = st.open === op.dataset.open ? null : op.dataset.open; render(); if (st.open) root.querySelector('.rows li.open')?.scrollIntoView({ block: 'nearest' }); return; }
    const g = e.target.closest('[data-gloss]');
    if (g) { pop.innerHTML = `<b>${esc(KNOBS[g.dataset.gloss]?.label || '')}</b><p>${esc(GLOSS[g.dataset.gloss])}</p>`; pop.showPopover?.(); return; }
    const cp = e.target.closest('[data-copy]');
    if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copy); cp.textContent = 'Copied'; } catch { cp.textContent = 'Select and copy it above'; } }
  });
  root.addEventListener('toggle', (e) => { if (e.target.matches('details.more')) st.more = e.target.open; }, true);
  root.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('g.pt')) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); } });
  render();
  load().then(render, (e) => { log('load_failed', { error: String(e) }); root.innerHTML = '<p class="dim">Could not load the lab. Try again later.</p>'; });
})();
