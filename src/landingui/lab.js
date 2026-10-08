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
  const usd = (x) => (x == null ? '–' : x === 0 ? '$0' : x < 0.1 ? `$${x.toFixed(3)}` : `$${x.toFixed(2)}`);
  const sc100 = (x) => (x == null ? '–' : Math.round(x));
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
  let SIM = null, simErr = '', SCEN = [], RUNS = [], STAGES = [], STAGE0 = null, PLANS = [], loaded = false;

  async function load() {
    const sfx = MOCK ? '.mock' : '';
    const jl = (t) => t.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const [sc, runs, stages, s0, plan, plan2] = await Promise.all([
      fetch(`${BASE}/scenarios.json`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch(`${BASE}/runs${sfx}.jsonl`, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : '')).then(jl).catch(() => []),
      fetch(`${BASE}/stages${sfx}.jsonl`, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : '')).then(jl).catch(() => []),
      fetch(`${BASE}/stage0.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`${BASE}/stage1-plan.json`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`${BASE}/stage2-plan.json`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    // A plan can carry a second part (stage2-plan.json part2: its own runs and guards).
    STAGE0 = s0; PLANS = [plan, plan2, plan2?.part2?.runs?.length ? { ...plan2.part2, stage: plan2.stage, part: 2 } : null].filter((x) => x?.runs?.length);
    SCEN = sc.length ? sc : [
      { id: 'cafe-family', title: 'Make the café site family-friendly', about: 'A vague feature request on an existing site: the planner has to decide what it means.' },
      { id: 'port-ts', title: 'Port a library to TypeScript', about: 'uuid (a small, popular JavaScript library) ported file by file; its own tests must still pass.' },
    ];
    // stages.jsonl (qb6): 'summary' lines are the table; 'start' lines are the guard's baseline.
    RUNS = runs; STAGES = stages.filter((x) => !x.event || x.event === 'summary');
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
          <p class="small dim">Prediction by the lab's simulation${SIM.SIM_VERSION ? ` (${esc(SIM.SIM_VERSION)})` : ''}, calibrated on real runs. Quality is the hidden tests, the build and a judge, out of 100. ${anchors()}</p>`
        : `<p class="dim">The simulation is not loaded yet, so there is no prediction to show.${MOCK ? '' : ''}</p>`}
      </div>
      ${OWN ? runForReal(me) : ''}
      ${me ? `<div class="pin" aria-hidden="true"><span>This setup</span><b>${mins(me.wallS)}</b><b>${Math.round(me.quality)}/100</b><b>${usd(me.usd)}</b></div>` : ''}
    </section>`;
  }
  // What a score means, from qb5's scorer validation (docs/lab/scoring.md, 2026-10-08).
  const ANCHORS = { 'cafe-family': [25, 94], 'port-ts': [8, 92], bakery: [8, 96] };
  // The reference solutions' scores include the judge (7 and 6 of 10); without it both are 100.
  // scenarios.json may carry {anchors: {starter, reference}} (qb5); these are the validated numbers until then.
  const anchors = () => {
    const sa = scenOf(st.scenario).anchors, a = sa ? [Math.round(sa.starter), Math.round(sa.reference)] : ANCHORS[st.scenario];
    return `${a ? `For this job, the untouched starting code scores ${a[0]} and a reference solution ${a[1]} (it passes every hidden test; the judge's opinion keeps it below 100). ` : ''}The judge's part varies by about 2 points between scorings of the same code.`;
  };
  // ---- the simulation's picks (qb4's public/lab/stage0.json) -----------------------------------
  const WHY = { fastest: 'Fastest', cheapest: 'Cheapest', 'best balance': 'Best balance of time, cost and quality', 'best stacking': 'Best with stacking', 'best ffa': 'Best with free for all', 'best phases': 'Best in phases', 'best leads': 'Best with area leads' };
  // Stage 1 = the APPROVED list (public/lab/stage1-plan.json, the source of truth); a run is
  // done when runs.jsonl has its variantKey + repetition at stage 1.
  const WHYB = { 'opus-alone': 'Baseline: one Opus agent alone', github: 'Baseline: GitHub-style' };
  const dropped = (p) => /^dropped/i.test(p.status || '');
  // A job is finished when no planned run for it is still open (not done, not dropped, not excluded).
  function jobOpen(id) {
    for (const pl of PLANS) for (const p of pl.runs) {
      if ((p.scenario || pl.scenario) !== id || dropped(p) || /^done/i.test(p.status || '')) continue;
      const hit = RUNS.find((r) => r.stage === pl.stage && r.scenario === id && (r.variantKey || vkey(r.variant || {}, r.baseline)) === p.variantKey && (r.seed ?? 1) === p.repetition);
      if (!hit) return true;
    }
    return false;
  }
  // One stage's approved plan (stageN-plan.json). The newest plan is "being run now"; older ones fold away.
  function planView(PLAN, active) {
    const notCounted = (p) => RUNS.find((r) => r.excluded && r.stage === PLAN.stage && r.scenario === p.scenario && (r.variantKey || vkey(r.variant || {}, r.baseline)) === p.variantKey && (r.seed ?? 1) === p.repetition);
    const done = (p) => RUNS.find((r) => !r.excluded && r.stage === PLAN.stage && r.scenario === p.scenario && (r.variantKey || vkey(r.variant || {}, r.baseline)) === p.variantKey && (r.seed ?? 1) === p.repetition);
    const total = PLAN.runs[PLAN.runs.length - 1]?.predictedCumulativeUsd;
    const n = PLAN.runs.filter(done).length;
    const allDone = n + PLAN.runs.filter((p) => !done(p) && (notCounted(p) || dropped(p))).length >= PLAN.runs.length;
    const g = PLAN.guards || {};
    const firstOpen = PLAN.runs.find((p) => !done(p) && !notCounted(p) && !dropped(p));
    const rows = PLAN.runs.map((p) => {
      const r = done(p), pr = p.predicted || {};
      const nc = !r && notCounted(p);
      const real = !r && dropped(p) ? '<span class="dim">Dropped: the plan changed after the first results.</span>' : nc ? `<span class="dim">Not counted: ${esc(nc.excluded)}</span>` : r ? `<span class="act">Done: ${mins(r.timings?.wallS)}, ${sc100(r.quality?.score)}/100, ${usd(r.cost?.apiUsdStd)}${r.links?.replay ? ` <a href="${esc(r.links.replay)}">replay</a>` : ''}</span>` : `<span class="dim">${p === firstOpen ? 'Next' : 'Waiting'}</span>`;
      const cond = p.conditional && !r ? '<span class="dim">Runs only if the first one-Opus-agent run comes within about 15% of the swarm.</span>' : '';
      return `<li class="${r ? 'done' : ''}"><span class="no">${p.order}</span><span class="pb"><b>${esc(WHYB[p.baseline] || WHY[p.why] || (p.baseline ? '' : p.why.replace(/ repetition \d+( of \d+)?$/, '') === 'swarm' ? 'Swarm' : p.why))}${p.repetition > 1 ? `, run ${p.repetition}` : ''}</b>${cond}
        <span>${esc(p.baseline ? BASELINES[p.baseline]?.about || '' : plain(p.variant))}</span>
        <span class="dim">Predicted ${mins(pr.wallS)}, ${pr.quality != null ? Math.round(pr.quality) : '–'}/100, ${usd(pr.apiUsdStd)}</span>${real}</span></li>`;
    }).join('');
    const head = `Stage ${PLAN.stage}${PLAN.part ? `, part ${PLAN.part}` : ''}: ${allDone ? 'done' : 'being run now'}`;
    if (!active) return `<details class="oldplan"><summary>Stage ${PLAN.stage}${PLAN.part ? `, part ${PLAN.part}` : ''}: ${n} of ${PLAN.runs.length} runs counted</summary><ol class="plan">${rows}</ol></details>`;
    // A second part without runs yet: name the job only (its notes are internal).
    const p2 = PLAN.part2 && !PLAN.part2.runs?.length ? PLAN.part2 : null;
    const nextLine = p2 ? `<p class="small dim" style="margin-top:8px"><b>Next:</b> ${esc(scenOf(p2.scenario).title || p2.scenario)}.</p>` : '';
    return `<h2>${esc(head)}</h2>
      <p class="cap">${PLAN.runs.length} real runs of ${[...new Set(PLAN.runs.map((p) => p.scenario || PLAN.scenario))].map((id) => `“${esc(scenOf(id).title)}” (${PLAN.runs.filter((p) => (p.scenario || PLAN.scenario) === id).length})`).join(', ')}, in this order. ${budgetLine(PLAN, allDone)} ${n} of ${PLAN.runs.length} done.</p>
      <ol class="plan">${rows}</ol>${nextLine}`;
  }
  // What the runner's guard compares (qb6): money already spent in the stage (API-equivalent,
  // excluded runs too: they were paid for) plus the next run's prediction, against the stop.
  function budgetLine(PLAN, allDone) {
    const g = PLAN.guards || {}, t = PLAN.totals;
    // qb4's totals block (stage1-plan.json) when present: spent + still to come against the guard.
    if (t && t.spentApiUsdStd != null) {
      const guard = t.guardApiUsdStd ?? g.stopAtApiUsdStd;
      return `Spent so far ${usd(t.spentApiUsdStd)} at API prices${t.judgeApiUsdStd ? ` (plus ${usd(t.judgeApiUsdStd)} for the quality judge)` : ''}; ${t.toComeRuns?.length === 1 ? 'the one run still to come is' : `the ${t.toComeRuns?.length ?? ''} runs still to come are`} predicted at ${usd(t.toComeApiUsdStd)}, about ${usd(t.expectedTotalApiUsdStd)} in all${guard ? `, under the ${usd(guard)} stop` : ''}.${meterLine(g)}`;
    }
    // Only this plan's jobs: a stage can have parts with their own stops.
    const jobs = new Set(PLAN.runs.map((p) => p.scenario || PLAN.scenario));
    const spent = RUNS.filter((r) => r.stage === PLAN.stage && jobs.has(r.scenario)).reduce((a, r) => a + (r.cost?.apiUsdStd || 0), 0);
    const doneKeys = new Set(RUNS.filter((r) => r.stage === PLAN.stage && !r.excluded).map((r) => `${r.scenario}|${r.variantKey || vkey(r.variant || {}, r.baseline)}|${r.seed ?? 1}`));
    const next = PLAN.runs.find((p) => !doneKeys.has(`${p.scenario || PLAN.scenario}|${p.variantKey}|${p.repetition}`));
    const stop = g.stopAtApiUsdStd;
    const toCome = allDone ? null : t?.toComeApiUsdStd;
    if (allDone) return `Spent ${usd(spent)} at API prices${stop ? ` (the stop was ${usd(stop)})` : ''}.`;
    return `Spent so far about ${usd(spent)} at API prices${stop ? ` of the ${usd(stop)} stop` : ''}${toCome != null ? `; the runs still to come are predicted at ${usd(toCome)}` : next?.predicted?.apiUsdStd != null ? `; the next run is predicted at ${usd(next.predicted.apiUsdStd)}` : ''}.${stop ? ` A run starts only if what is spent plus its prediction stays under ${usd(stop)}.` : ''}${meterLine(g)}`;
  }
  const meterLine = (g) => (g.stopAtWeeklyMeterPct ? ` It stops if the weekly Claude meter (account-wide) reaches ${g.stopAtWeeklyMeterPct}%.` : g.stopAtWeeklyMeterRisePts ? ` The stage also stops if the weekly Claude meter rises ${g.stopAtWeeklyMeterRisePts} points.` : '');
  // The simulation's picks that are not in the approved list (it was recalibrated after approval).
  function favouritesView() {
    const inPlan = new Set(PLANS.flatMap((pl) => pl.runs.map((p) => p.variantKey)));
    const fav = (STAGE0?.picks || []).filter((p) => !inPlan.has(p.key));
    if (!fav.length) return '';
    const si = (STAGE0.scenarios || []).findIndex((x) => x.id === st.scenario);
    return `<h3 class="fh">The simulation's current favourites (not yet run)</h3>
      <p class="cap">${esc(STAGE0.picksChanged || 'The simulation was updated after stage 1 was approved, so its favourites moved.')} These are candidates for later stages.</p>
      <ul class="picks">${fav.map((p) => { const per = si >= 0 ? p.per?.[si] : null; return `<li><b>${esc(WHY[p.why] || p.why)}</b><span>${esc(plain(p.variant))}</span>
        ${per ? `<span class="nums"><span>${mins(per.wallS)}</span><span>${Math.round(per.q)}/100</span><span>${usd(per.usd)}</span></span>` : ''}
        <button type="button" class="chipb" data-pick='${esc(JSON.stringify(p.variant))}'>Try this setup</button></li>`; }).join('')}</ul>`;
  }
  // Without an approved plan: the simulation's picks as proposals.
  function picksView() {
    if (PLANS.length) {
      const cur = PLANS[PLANS.length - 1];
      return `<section class="sec" id="plan">${planView(cur, true)}${PLANS.slice(0, -1).reverse().map((pl) => planView(pl, false)).join('')}${favouritesView()}</section>`;
    }
    if (!STAGE0?.picks?.length) return '';
    const si = (STAGE0.scenarios || []).findIndex((x) => x.id === st.scenario);
    return `<section class="sec" id="picks"><h2>What the simulation suggests</h2>
      <p class="cap">${Number(STAGE0.combos).toLocaleString('en-US')} setups simulated, ${STAGE0.seeds} times each, at no cost. Proposed for the first real runs.</p>
      <ul class="picks">${STAGE0.picks.map((p) => { const per = si >= 0 ? p.per?.[si] : null; return `<li><b>${esc(WHY[p.why] || p.why)}</b><span>${esc(plain(p.variant))}</span>
        ${per ? `<span class="nums"><span>${mins(per.wallS)}</span><span>${Math.round(per.q)}/100</span><span>${usd(per.usd)}</span></span>` : ''}
        <button type="button" class="chipb" data-pick='${esc(JSON.stringify(p.variant))}'>Try this setup</button></li>`; }).join('')}</ul></section>`;
  }
  function runForReal(me) {
    const cmd = `node --experimental-strip-types scripts/lab/run.mjs --scenario ${st.scenario} --variant '${JSON.stringify(st.v)}'`;
    return `<details class="real"><summary class="btn">Run for real</summary>
      <div class="realb"><p>Estimate: about <b>${me ? mins(me.wallS) : '?'}</b> and <b>${me ? usd(me.usd) : '?'}</b> at API prices (Claude runs on the subscription; containers are billed for real). The runner refuses to start over the stage budget.</p>
      <p class="small dim">For now runs start from the laptop. Copy this into a terminal in the qodebase folder:</p>
      <pre class="cmd"><code>${esc(cmd)}</code></pre><button type="button" class="chipb" data-copy="${esc(cmd)}">Copy command</button></div></details>`;
  }

  // ---- 2. results -------------------------------------------------------------------------------
  // A run with a known platform stall (qb6's timings.stallS) is left out of time comparisons entirely:
  // the stall overlapped other agents' work, so subtracting it means nothing (manager, 2026-10-08).
  // Its quality and cost still count.
  // Comparability per run (qb4, 2026-10-08). Time counts only with no person stepping in and no
  // platform stall; cost only when it is exact (not an upper or lower bound).
  const timeWhy = (r) => (r.counts?.humanInterventions > 0 ? 'a person had to step in during the run (a platform bug, since fixed)' : r.timings?.stallS || /PLATFORM STALL/i.test(r.notes || '') ? 'a platform stall' : null);
  const costWhy = (r) => (/upper bound/i.test(r.cost?.pricedAs || '') ? 'only an upper bound is known' : r.cost?.apiUsdStdLowerBound != null ? 'only a lower bound is known' : null);
  const runS = (r) => (r.timings?.wallS == null || timeWhy(r) ? null : r.timings.wallS);
  const runUsd = (r) => (r.cost?.apiUsdStd == null || costWhy(r) ? null : r.cost.apiUsdStd);
  function groups() {
    const by = new Map();
    for (const r of RUNS.filter((x) => x.scenario === st.scenario && x.status !== 'failed' && !x.excluded)) {
      const k = r.variantKey || vkey(r.variant || {}, r.baseline);
      if (!by.has(k)) by.set(k, { key: k, baseline: r.baseline, variant: r.variant, runs: [] });
      by.get(k).runs.push(r);
    }
    return [...by.values()].map((g) => ({ ...g,
      wallS: med(g.runs.map(runS)), stallS: g.runs.reduce((a, r) => a + (r.timings?.stallS || 0), 0), quality: med(g.runs.map((r) => r.quality?.score)), qTruly: med(g.runs.map((r) => r.quality?.scoreTrulyHidden)),
      hidden: med(g.runs.map((r) => (r.quality?.hiddenTotal ? r.quality.hiddenPass / r.quality.hiddenTotal : null))),
      hiddenOf: g.runs.find((r) => r.quality?.hiddenTotal)?.quality.hiddenTotal,
      floor: Object.fromEntries(['build', 'typecheck', 'ownTests'].map((k) => [k, g.runs.every((r) => r.quality?.[k] !== false)])),
      typeErrors: med(g.runs.map((r) => r.quality?.typeErrors)),
      real: med(g.runs.map((r) => r.cost?.usdReal)), usd: med(g.runs.map(runUsd)),
      timeNot: g.runs.every((r) => timeWhy(r)) ? timeWhy(g.runs[0]) : null, costNot: g.runs.every((r) => costWhy(r)) ? costWhy(g.runs[0]) : null,
      pWallS: med(g.runs.map((r) => r.predicted?.wallS)), pQuality: med(g.runs.map((r) => r.predicted?.quality)), stage: Math.max(...g.runs.map((r) => r.stage || 0)) }));
  }
  function scatter(gs) {
    const W = 340, H = 250, L = 36, B = 34, T = 18, R = 10;
    const xs = gs.flatMap((g) => [g.wallS, g.pWallS]).filter((x) => x != null), ys = gs.flatMap((g) => [g.quality, g.pQuality]).filter((x) => x != null);
    const xMax = Math.max(60, ...xs) * 1.08, yMin = Math.max(0, Math.floor((Math.min(...ys, 100) - 8) / 10) * 10), yMax = 100;
    const X = (s) => L + ((W - L - R) * s) / xMax, Y = (q) => T + ((H - T - B) * (yMax - q)) / (yMax - yMin);
    const xt = [0, 1, 2, 3, 4].map((i) => Math.round((xMax / 60 / 4) * i)).filter((v, i, a) => a.indexOf(v) === i);
    const yt = []; for (let q = yMin; q <= 100; q += yMax - yMin > 40 ? 20 : 10) yt.push(q);
    const best = gs.length > 1 ? leaderOf(gs) : null;
    // Three layers: predictions under the points, labels over everything.
    const ghosts = [], labels = [];
    const dots = gs.map((g, i) => {
      if (g.wallS == null || g.quality == null) return '';
      const x = X(g.wallS), y = Y(g.quality), on = st.open === g.key, cls = g.baseline ? 'bl' : 'vr';
      const ghost = g.pWallS != null && g.pQuality != null ? `<line class="pl" x1="${X(g.pWallS).toFixed(1)}" y1="${Y(g.pQuality).toFixed(1)}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/><circle class="pd" cx="${X(g.pWallS).toFixed(1)}" cy="${Y(g.pQuality).toFixed(1)}" r="4"/>` : '';
      const mark = g.baseline ? `<rect class="m ${cls}${on ? ' on' : ''}" x="${(x - 6).toFixed(1)}" y="${(y - 6).toFixed(1)}" width="12" height="12" rx="2"/>` : `<circle class="m ${cls}${on ? ' on' : ''}${g === best ? ' best' : ''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6"/>`;
      const left = x > W * 0.62;
      const label = g.baseline || g === best || on ? `<text class="dl" x="${(left ? x - 9 : x + 9).toFixed(1)}" y="${(y + 4).toFixed(1)}"${left ? ' text-anchor="end"' : ''}>${esc(g.baseline ? BASELINES[g.baseline]?.label + (g === best ? ' (leading)' : '') : g === best ? 'Leading so far' : plain(g.variant).split(',')[0])}</text>` : '';
      ghosts.push(ghost); labels.push(label);
      return `<g class="pt" data-open="${esc(g.key)}" tabindex="0" role="button" aria-label="${esc(plain(g.variant, g.baseline))}: ${mins(g.wallS)}, quality ${Math.round(g.quality)}"><circle class="hit" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="16"/>${mark}</g>`;
    }).join('');
    return `<p class="ct">Quality (out of 100) by minutes to finish</p><svg class="sc-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="Each setup by time to finish and quality">
      ${yt.map((q) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(q)}" y2="${Y(q)}"/><text class="ax" x="${L - 6}" y="${Y(q) + 4}" text-anchor="end">${q}</text>`).join('')}
      ${xt.map((m) => `<text class="ax" x="${X(m * 60)}" y="${H - 10}" text-anchor="middle">${m}</text>`).join('')}
      <text class="ax" x="${W - R}" y="${H}" text-anchor="end">minutes</text>
      <g aria-hidden="true">${ghosts.join('')}</g>${dots}<g aria-hidden="true" style="pointer-events:none">${labels.join('')}</g></svg>
      <div class="key"><span><i class="k vr"></i>a setup (median of its runs)</span><span><i class="k bl"></i>baseline</span><span><i class="k pd"></i>what the simulation predicted</span></div>
      <p class="small dim">Up and to the left is better: higher quality in less time.</p>`;
  }
  // Best = highest quality among the setups within 1.5x of the fastest time; ties: cheaper.
  function bestOf(gs) {
    const vr = gs.filter((g) => !g.baseline && g.quality != null);
    if (!vr.length) return null;
    return vr.slice().sort((a, b) => b.quality - a.quality || (a.wallS ?? 1e9) - (b.wallS ?? 1e9) || (a.usd ?? 1e9) - (b.usd ?? 1e9))[0];
  }
  // Ties (manager, 2026-10-08): the judge moves ~2 points between scorings of the same code, so two
  // setups that pass the same share of hidden tests and differ by <= 4 points have the SAME quality;
  // finish times within 15% are a tie too. Never present a tie as a win.
  const qTie = (a, b) => Math.abs(a.quality - b.quality) <= 4 && (a.hidden == null || b.hidden == null || Math.abs(a.hidden - b.hidden) < 1e-9);
  const tTie = (a, b) => a.wallS != null && b.wallS != null && Math.abs(a.wallS - b.wallS) <= 0.15 * Math.min(a.wallS, b.wallS);
  const rank = (a, b) => (qTie(a, b) ? (a.wallS != null && b.wallS != null ? a.wallS - b.wallS : (a.wallS == null) - (b.wallS == null)) || (a.usd ?? 1e9) - (b.usd ?? 1e9) : b.quality - a.quality);
  const leaderOf = (gs) => gs.filter((g) => g.quality != null).sort(rank)[0] || null;
  // One comparison in words (qb5/manager wording): quality as hidden tests passed (a judge-only gap
  // is a tie, never points), time as N times faster, cost as N% less.
  // Concrete, judge-free reasons from the floor checks (qb5): build, type check, own tests.
  function floorWords(w, l) {
    const f = [];
    if (w.floor?.typecheck && l.floor && !l.floor.typecheck) f.push(`its code type-checked cleanly (the other's had ${l.typeErrors != null ? `${Math.round(l.typeErrors)} type error${Math.round(l.typeErrors) === 1 ? '' : 's'}` : 'type errors'})`);
    if (w.floor?.build && l.floor && !l.floor.build) f.push("it built and started (the other's did not)");
    if (w.floor?.ownTests && l.floor && !l.floor.ownTests) f.push("its own tests passed (the other's did not)");
    return f.join(' and ');
  }
  function diffWords(a, b) {
    const nm = (g) => esc(plain(g.variant, g.baseline));
    const out = [];
    const ha = a.hidden != null && a.hiddenOf ? Math.round(a.hidden * a.hiddenOf) : null, hb = b.hidden != null && b.hiddenOf ? Math.round(b.hidden * b.hiddenOf) : null;
    if (qTie(a, b)) out.push(`The same quality within the judge's noise${ha != null && ha === hb ? ` (both passed ${ha}/${a.hiddenOf} hidden tests)` : ''}.`);
    else if (ha != null && hb != null && ha !== hb) {
      const [w, l, hw, hl] = ha > hb ? [a, b, ha, hb] : [b, a, hb, ha];
      // Beyond the hidden tests' own share (60 points) and the judge's noise, the build / type check / judge differ too.
      const rest = Math.abs(w.quality - l.quality) - (60 * (hw - hl)) / a.hiddenOf;
      const fw = rest > 4 && w.quality > l.quality ? floorWords(w, l) : '';
      out.push(`${nm(w)} passed ${hw - hl} more hidden test${hw - hl === 1 ? '' : 's'} (${hw} against ${hl} of ${a.hiddenOf})${fw ? ` and ${fw}` : rest > 4 && w.quality > l.quality ? ` and scored higher overall (${Math.round(w.quality)} against ${Math.round(l.quality)})` : ''}.`);
    }
    else { const [w, l] = a.quality >= b.quality ? [a, b] : [b, a]; const fw = floorWords(w, l); out.push(fw ? `${nm(w)}: ${fw}.` : `${nm(w)} scored higher (${Math.round(w.quality)} against ${Math.round(l.quality)}).`); }
    const tNot = a.wallS == null || b.wallS == null, cNot = a.usd == null || b.usd == null;
    if (tNot) out.push(`Time is not comparable: for ${nm(a.wallS == null ? a : b)}, ${(a.wallS == null ? a : b).timeNot || 'no usable time'}.`);
    else if (tTie(a, b)) out.push('They finished within 15% of each other.');
    else { const [f, sl] = a.wallS < b.wallS ? [a, b] : [b, a]; out.push(`${nm(f)} was ${(sl.wallS / f.wallS).toFixed(1)}× faster (${mins(f.wallS)} against ${mins(sl.wallS)}).`); }
    if (cNot) out.push(`Cost is not comparable: for ${nm(a.usd == null ? a : b)}, ${(a.usd == null ? a : b).costNot || 'no usable cost'}.`);
    if (a.usd != null && b.usd != null && Math.abs(a.usd - b.usd) > 0.15 * Math.min(a.usd, b.usd)) {
      const [c, e] = a.usd < b.usd ? [a, b] : [b, a], r = c.usd / e.usd;
      out.push(`${nm(c)} cost ${r > 0.45 && r < 0.55 ? 'about half as much' : `${Math.round((1 - r) * 100)}% less`} (${usd(c.usd)} against ${usd(e.usd)}).`);
    }
    // What is actually billed: containers (Claude runs on the subscription).
    if (a.real != null && b.real != null && (a.real || b.real)) out.push(`Real spend on containers: ${usd(a.real)} against ${usd(b.real)}.`);
    return out.join(' ');
  }
  function compare(gs) {
    const ok = gs.filter((g) => g.quality != null).sort(rank);
    const lead = ok[0];
    if (!lead) return '';
    const one = (g) => `${esc(plain(g.variant, g.baseline))}: ${g.wallS != null ? `done in <b>${mins(g.wallS)}</b>` : 'time not comparable'}, quality <b>${Math.round(g.quality)}/100</b>, ${g.usd != null ? `<b>${usd(g.usd)}</b> at API prices` : 'cost not comparable'} (${g.runs.length} run${g.runs.length === 1 ? '' : 's'})`;
    const hid = (g) => (g.hidden != null && g.hiddenOf ? `${Math.round(g.hidden * g.hiddenOf)}/${g.hiddenOf} hidden tests` : null);
    const parts = [];
    const second = ok[1];
    const sf = jobOpen(st.scenario) ? ' so far' : '';
    if (!second) parts.push(`<p><b>${sf ? 'First result' : 'Result'}:</b> ${one(lead)}.</p>`);
    else if (qTie(lead, second) && tTie(lead, second)) {
      parts.push(`<p><b>Too close to call${sf}.</b> The same quality within the judge's noise${hid(lead) && hid(lead) === hid(second) ? ` (both passed ${hid(lead)})` : ''}, and finish times within 15% of each other:</p><p>${one(lead)}.</p><p>${one(second)}.</p>`);
    } else {
      parts.push(`<p><b>${sf ? 'Leading so far' : 'Result'}:</b> ${one(lead)}.</p>`);
      if (qTie(lead, second)) parts.push(`<p>${one(second)}.</p><p class="dim">${diffWords(lead, second)}</p>`);
      else { const bm = lead.baseline ? ok.find((g) => !g.baseline) : second; if (bm) parts.push(`<p>${lead.baseline ? 'Best setup with several agents: ' : ''}${one(bm)}.</p><p class="dim">${diffWords(lead, bm)}</p>`); }
    }
    const shown = new Set([lead, second].filter(Boolean));
    const others = ok.filter((g) => !shown.has(g) && g.baseline);
    const to = (g) => (g.runs.every((r) => r.status === 'timeout') ? ' (timed out)' : '');
    if (others.length) parts.push(`<p class="dim">Also: ${others.map((g) => `${esc(plain(g.variant, g.baseline))} ${g.wallS != null ? mins(g.wallS) : 'time not comparable'}${to(g)}, ${Math.round(g.quality)}/100, ${g.usd != null ? usd(g.usd) : 'cost not comparable'}`).join('; ')}.</p>`);
    const rs = RUNS.filter((r) => r.scenario === st.scenario && !r.excluded && r.predicted?.wallS && runS(r) && runUsd(r));
    const tR = med(rs.map((r) => r.predicted.wallS / runS(r))), cR = med(rs.map((r) => r.predicted.apiUsdStd / runUsd(r)));
    if (rs.length && (tR > 1.5 || tR < 0.67 || cR > 1.5 || cR < 0.67)) parts.push(`<p class="small dim">On these runs the simulation was off: it expected about ${tR.toFixed(1)}× the time and ${cR.toFixed(1)}× the cost that the runs took. It is recalibrated from real runs before the next ones.</p>`);
    return `<div class="cmp">${parts.join('')}</div>`;
  }
  function list(gs) {
    const sorted = gs.slice().sort((a, b) => (a.quality == null || b.quality == null || a.wallS == null || b.wallS == null ? (b.quality ?? -1) - (a.quality ?? -1) : rank(a, b)));
    return `<ul class="rows">${sorted.map((g) => {
      const on = st.open === g.key;
      return `<li class="${on ? 'open' : ''}"><button type="button" class="rw" data-open="${esc(g.key)}" aria-expanded="${on}"><i class="k ${g.baseline ? 'bl' : 'vr'}"></i><span class="t">${esc(plain(g.variant, g.baseline))}</span>
        <span class="nums"><span>${g.wallS != null ? mins(g.wallS) : 'time n/c'}</span><span>${g.quality == null ? '–' : Math.round(g.quality)}/100${g.qTruly != null ? ` <span class="dim">(${Math.round(g.qTruly)})</span>` : ''}</span><span>${g.usd != null ? usd(g.usd) : 'cost n/c'}</span></span>
        <span class="sub">${g.runs.length} run${g.runs.length === 1 ? '' : 's'}${g.runs.every((r) => r.status === 'timeout') ? ', timed out' : ''}${g.timeNot ? `; time not comparable (${esc(g.timeNot)})` : ''}${g.costNot ? `; cost not comparable (${esc(g.costNot)})` : ''}, stage ${g.stage}${g.pWallS != null ? `; predicted ${mins(g.pWallS)}, ${Math.round(g.pQuality)}/100` : ''}</span></button>${on ? detail(g) : ''}</li>`;
    }).join('')}</ul>`;
  }
  function detail(g) {
    const about = g.baseline ? BASELINES[g.baseline]?.about : `Planner ${mdl(g.variant.planner)}; ${g.variant.coders} ${mdl(g.variant.coderModel)} coders; ${g.variant.reviewers} reviewer${g.variant.reviewers === 1 ? '' : 's'} (${WORDS.reviewStyle[g.variant.reviewStyle] || g.variant.reviewStyle}); ${WORDS.policy[g.variant.policy] || g.variant.policy}; claims ${g.variant.claims ? 'on' : 'off'}; duplicate check ${g.variant.dedupe ? 'on' : 'off'}; up to ${g.variant.trainMax} tested together.`;
    const runs = g.runs.slice().sort((a, b) => (a.seed || 0) - (b.seed || 0)).map((r) => {
      const c = r.counts || {}, q = r.quality || {};
      const words = [`${c.tasksLanded ?? '?'} of ${c.tasksPlanned ?? '?'} tasks landed`, c.conflicts ? `${c.conflicts} collision${c.conflicts === 1 ? '' : 's'}` : 'no collisions',
        (c.replaysHandler || 0) + (c.replaysLlm || 0) ? `${(c.replaysHandler || 0) + (c.replaysLlm || 0)} replayed` : null, c.bounces ? `${c.bounces} sent back` : null,
        c.breaksOnMain ? `${c.breaksOnMain} broke main` : null, q.hiddenTotal ? `${q.hiddenPass}/${q.hiddenTotal} hidden tests` : null,
        q.trulyHiddenTotal ? `${q.trulyHiddenPass}/${q.trulyHiddenTotal} checks it could not look up` : null].filter(Boolean).join(', ');
      const status = r.status && r.status !== 'done' ? ` <span class="warn">${esc({ 'stopped-budget': 'stopped: budget', timeout: 'timed out', failed: 'failed' }[r.status] || r.status)}</span>` : '';
      const tw = timeWhy(r), cw = costWhy(r);
      const stall = r.timings?.stallS ? ` <span class="dim">(a platform stall of ${mins(r.timings.stallS)}, not the setup; left out of time comparisons)</span>` : tw ? ` <span class="dim">(left out of time comparisons: ${esc(tw)})</span>` : '';
      const cnote = cw ? ` <span class="dim">(cost left out: ${esc(cw)})</span>` : '';
      const th = q.scoreTrulyHidden != null ? ` <span class="dim">(${Math.round(q.scoreTrulyHidden)}/100 on the checks it could not look up)</span>` : '';
      return `<li><span class="rn">Run ${r.seed ?? ''}${status}</span><span class="rv">${mins(r.timings?.wallS)}${stall}, ${sc100(q.score)}/100${th}, ${usd(r.cost?.apiUsdStd)} at API prices${cnote}${r.cost?.usdReal != null ? `, ${usd(r.cost.usdReal)} real` : ''}</span>
        <span class="rw2">${esc(words)}.</span>${r.notes ? `<span class="rw2">${esc(r.notes)}</span>` : ''}
        <span class="lk">${r.links?.replay ? `<a href="${esc(r.links.replay)}">Watch the replay</a>` : ''}${r.links?.app ? `<a href="${esc(r.links.app)}" target="_blank" rel="noopener">The app it built</a>` : ''}${r.links?.repo ? `<a href="${esc(r.links.repo)}">The code</a>` : ''}</span></li>`;
    }).join('');
    return `<div class="det"><p class="small">${esc(about)}</p><ul class="runs">${runs}</ul></div>`;
  }
  function resultsView() {
    const gs = groups();
    const stalls = gs.filter((g) => g.stallS);
    const nStall = gs.reduce((a, g) => a + g.runs.filter((r) => r.timings?.stallS).length, 0);
    const stallNote = nStall ? `<p class="small dim">${nStall === 1 ? 'One run' : `${nStall} runs`} hit a platform stall (${stalls.map((g) => esc(plain(g.variant, g.baseline))).join('; ')}): ${nStall === 1 ? 'it is' : 'they are'} left out of the time comparison but counted for quality and cost.</p>` : '';
    const truly = gs.some((g) => g.qTruly != null)
      ? '<p class="small dim">For the TypeScript port, the number in brackets is the score on checks the agents could not have found in the original library (type cases and structure), so copying the original does not earn them.</p>' : '';
    const n = RUNS.filter((r) => r.scenario === st.scenario && !r.excluded).length;
    const ex = RUNS.filter((r) => r.scenario === st.scenario && r.excluded);
    const exHtml = ex.length ? `<h3 class="fh">Not counted</h3><ul class="runs ex">${ex.map((r) => `<li><span class="rn">${esc(plain(r.variant || {}, r.baseline))}, run ${r.seed ?? ''}</span><span class="rw2">${esc(r.excluded)}</span>${r.links?.replay ? `<span class="lk"><a href="${esc(r.links.replay)}">Watch the replay</a></span>` : ''}</li>`).join('')}</ul>` : '';
    return `<section class="sec" id="results"><h2>${jobOpen(st.scenario) ? 'Results so far' : 'Results'}</h2>
      ${n ? `<p class="cap">${n} real run${n === 1 ? '' : 's'} of “${esc(scenOf(st.scenario).title)}”, ${gs.length} setup${gs.length === 1 ? '' : 's'}. Tap a dot or a row for its runs, the replay and the app it built.</p>${compare(gs)}<p class="small dim">${anchors()}</p>${scatter(gs)}${stallNote}${list(gs)}${truly}${exHtml}`
        : `<p class="dim">No real runs of this job yet. The simulation picks the setups worth running; they appear here as they finish.</p>`}
    </section>`;
  }
  function foundView() {
    const rows = []; let anyNc = false;
    for (const sc of SCEN) {
      const keep = st.scenario; st.scenario = sc.id; const gs = groups(); st.scenario = keep;
      const oa = gs.find((g) => g.baseline === 'opus-alone' && g.quality != null), sw = bestOf(gs);
      if (!oa || !sw) continue;
      const ha = oa.hidden != null && oa.hiddenOf ? Math.round(oa.hidden * oa.hiddenOf) : null, hs = sw.hidden != null && sw.hiddenOf ? Math.round(sw.hidden * sw.hiddenOf) : null;
      const SHORT = { 'a person had to step in during the run (a platform bug, since fixed)': 'a person stepped in', 'a platform stall': 'platform stall', 'only an upper bound is known': 'upper bound only', 'only a lower bound is known': 'lower bound only' };
      const nc = (why) => `<span class="dim">Not comparable${why ? ` (${esc(SHORT[why] || why)})` : ''}</span>`;
      if ((oa.wallS == null || sw.wallS == null) || (oa.usd == null || sw.usd == null)) anyNc = true;
      const fast = oa.wallS == null || sw.wallS == null ? nc((oa.wallS == null ? oa : sw).timeNot) : tTie(oa, sw) ? 'Within 15%' : oa.wallS < sw.wallS ? `One agent, ${(sw.wallS / oa.wallS).toFixed(1)}×` : `Several, ${(oa.wallS / sw.wallS).toFixed(1)}×`;
      const cost = oa.usd == null || sw.usd == null ? nc((oa.usd == null ? oa : sw).costNot) : sw.usd < oa.usd ? `Several, ${Math.round((1 - sw.usd / oa.usd) * 100)}% less` : `One agent, ${Math.round((1 - oa.usd / sw.usd) * 100)}% less`;
      const tc = oa.floor?.typecheck && sw.floor && !sw.floor.typecheck ? '; several agents failed the strict type check' : sw.floor?.typecheck && oa.floor && !oa.floor.typecheck ? '; one agent failed the strict type check' : '';
      const qual = (qTie(oa, sw) ? `Tie${ha != null && ha === hs ? ` (${ha}/${oa.hiddenOf})` : ''}` : ha != null && hs != null && ha !== hs ? `${ha > hs ? 'One agent' : 'Several'}, +${Math.abs(ha - hs)} hidden test${Math.abs(ha - hs) === 1 ? '' : 's'}` : `${oa.quality > sw.quality ? 'One agent' : 'Several'}`) + tc;
      rows.push(`<tr><th scope="row">${esc(sc.title)}${jobOpen(sc.id) ? ' <span class="dim">(running)</span>' : ''}</th><td>${fast}</td><td>${cost}</td><td>${qual}</td></tr>`);
    }
    if (!rows.length) return '';
    return `<section class="sec" id="found"><h2>What we found</h2>
      <p class="cap">One Opus agent alone against the best setup with several agents, on each job (medians of the real runs; a run hit by a platform bug counts for quality but not for time or cost).</p>
      <div class="tw"><table class="found"><thead><tr><th scope="col">Job</th><th scope="col">Faster</th><th scope="col">Cheaper at API prices</th><th scope="col">Hidden tests</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>${anyNc ? '<p class="small dim">Not comparable: those runs hit platform bugs that were fixed later (a person had to step in, or a stall), or their cost is only known as a bound. Their quality still counts.</p>' : ''}</section>`;
  }
  function funnelView() {
    const list = STAGES.slice();
    if (STAGE0 && !list.some((x) => x.stage === 0)) list.push({ stage: 0, setups: STAGE0.combos, runs: STAGE0.combos * STAGE0.seeds, kept: STAGE0.picks?.length, notes: 'Simulation only: every combination, no model calls.' });
    if (!list.length) return '';
    const NAMES = { 0: 'Simulation', 1: 'Small real runs', 2: 'More agents, more repetitions', 3: 'At scale' };
    return `<section class="sec" id="funnel"><h2>How setups are picked</h2>
      <p class="cap">Every combination is simulated for free; only the best few are run for real, each stage with its own budget.</p>
      <ol class="funnel">${list.sort((a, b) => a.stage - b.stage).map((s) => `<li><b>Stage ${s.stage}: ${esc(NAMES[s.stage] || '')}</b><span>${[s.setups != null ? `${Number(s.setups).toLocaleString('en-US')} setup${s.setups === 1 ? '' : 's'}` : null, s.runs != null && s.runs !== s.setups ? `${Number(s.runs).toLocaleString('en-US')} ${s.stage === 0 ? 'simulated runs' : 'runs'}` : null].filter(Boolean).join(', ')}${s.kept != null ? `; ${s.kept} kept` : ''}${s.apiUsdStd ? `; ${usd(s.apiUsdStd)} at API prices` : ''}${s.usdReal ? `; ${usd(s.usdReal)} real spend` : ''}${s.quotaPctAccount ? `; ${s.quotaPctAccount}% of the weekly Claude quota (account-wide meter)` : ''}</span>${s.notes ? `<span class="dim">${esc(s.notes)}</span>` : ''}</li>`).join('')}</ol></section>`;
  }

  // ---- render, events ----------------------------------------------------------------------------
  const pop = document.createElement('div'); pop.className = 'lab-pop'; pop.id = 'lab-pop'; pop.setAttribute('popover', ''); document.body.appendChild(pop);
  function render() {
    if (!loaded) { root.innerHTML = '<p class="dim">Loading the lab…</p>'; return; }
    root.innerHTML = `${MOCK || RUNS.some((r) => r.mock) ? '<div class="mock"><b>Sample data.</b> These results are invented to show the page; real runs replace them.</div>' : ''}
      <h1>Variants lab</h1>
      <p class="lede">Is one strong agent better than many? How many, checked by whom, landing how? We predict every setup with a simulation, run the best ones on real jobs, and score what they built with tests the agents never saw.</p>
      ${foundView()}${tryView()}${picksView()}${resultsView()}${funnelView()}`;
  }
  function setUrl() {
    const u = new URL(location.href); u.searchParams.set('s', st.scenario); u.searchParams.set('v', JSON.stringify(st.v)); history.replaceState(null, '', u);
  }
  root.addEventListener('click', async (e) => {
    const o = e.target.closest('[data-k]');
    if (o) { st.v[o.dataset.k] = JSON.parse(o.dataset.val); setUrl(); render(); return; }
    const pk = e.target.closest('[data-pick]');
    if (pk) { Object.assign(st.v, JSON.parse(pk.dataset.pick)); setUrl(); render(); document.getElementById('try')?.scrollIntoView({ block: 'start' }); return; }
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
