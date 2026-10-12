// Run timeline (qb7, docs/board/TASKS.md T2; Eyal 2026-10-12): one view of a whole run as a trace, rows = parts
// of the system, x = time. Overview (summary + concurrency + brush) and drill-down (zoom, tap a span).
//   window.qbTimelineData(D)   -> timeline from the landing view (until qb6's GET …/landing/timeline answers)
//   window.qbTimelineView(T)   -> HTML for a timeline;  window.qbTimelineMount(root, T) wires zoom, brush, sheet.
// Shape (qb6's endpoint uses the same): { run:{start,end,label}, lanes:[{id,group,label}], spans:[{id,lane,phase,
// start,end,change?,label?,detail?}], marks:[{lane,at,change,kind}], critical:[spanId] }.
(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const dur = (ms) => { const s = Math.max(0, ms / 1000); return s < 60 ? `${s < 10 ? s.toFixed(1) : Math.round(s)} s` : s < 3600 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`; };
  const PHASE = {
    plan: ['Planning', 'tl-plan'], work: ['Working', 'tl-work'], wait_review: ['Waiting for review', 'tl-wait tl-wr'],
    review: ['Review', 'tl-review'], wait_queue: ['Waiting in the line', 'tl-wait tl-wq'], train: ['Tested together', 'tl-train'],
    apply: ['Applying changes', 'tl-apply'], checks: ['Checks', 'tl-checks'], bounced: ['Sent back', 'tl-bounced'],
    // qb6's GET …/landing/timeline adds these
    wait_merge: ['Waiting to land', 'tl-wait tl-wq'], wait_lead: ['Waiting for a lead', 'tl-wait tl-wr'], wake: ['Waking up', 'tl-plan'],
    wait_box: ['Waiting for the merger', 'tl-wait'], fetch: ['Fetching main', 'tl-apply'], replay: ['Replaying a collision', 'tl-review'], notes: ['Notes', 'tl-checks'], push: ['Pushing to main', 'tl-train'],
  };
  const GROUPS = [['planner', 'Planner'], ['agents', 'Agents'], ['reviewers', 'Reviewers'], ['queue', 'The line'], ['merger', 'Merger'], ['main', 'Main']];

  // ---- the landing view -> timeline (each change's events carry timestamps; trains have start/end/checks) ----
  window.qbTimelineData = function (D) {
    const ch = (D.changes || []).filter((c) => c.events?.length);
    if (!ch.length) return null;
    const at = (c, w) => c.events.find((e) => e.what === w)?.t;
    const trains = (D.queue?.trains || []).filter((t) => t.startedAt);
    const trainOf = (id) => trains.find((t) => t.changes?.includes(id));
    const start = Math.min(D.demo?.startedAt || Infinity, ...ch.map((c) => c.createdAt || c.events[0].t));
    const end = Math.max(...ch.map((c) => c.landedAt || c.events[c.events.length - 1].t), ...trains.map((t) => t.endedAt || 0), start + 1000);
    const agents = [...new Set(ch.map((c) => c.agent))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
    const lanes = [{ id: 'planner', group: 'planner', label: 'Planner' }, ...agents.map((a, i) => ({ id: `a:${a}`, group: 'agents', label: /^scripted agent (\d+)/.exec(a) ? `Agent ${RegExp.$1}` : `Agent ${i + 1}` })),
      { id: 'reviewers', group: 'reviewers', label: 'Reviewers' }, { id: 'queue', group: 'queue', label: 'The line' }, { id: 'merger', group: 'merger', label: 'Merger' }, { id: 'main', group: 'main', label: 'Main' }];
    const spans = [], marks = []; let n = 0;
    const add = (lane, phase, s, e, extra) => { if (s && e && e > s) spans.push({ id: `s${++n}`, lane, phase, start: s, end: e, ...extra }); };
    const first = Math.min(...ch.map((c) => at(c, 'working') || c.events[0].t));
    add('planner', 'plan', start, first, { label: 'Splitting the work' });
    for (const c of ch) {
      const L = `a:${c.agent}`, t = trainOf(c.id), x = { change: c.id, label: c.title };
      const w = at(c, 'working') || c.createdAt, p = at(c, 'pushed'), r = at(c, 'reviewing'), ok = at(c, 'approved'), q = at(c, 'queued');
      add(L, 'work', w, p || (c.state === 'working' ? Date.now() : null), x);
      add(L, 'wait_review', p, r, x); add(L, 'review', r, ok, x); add('reviewers', 'review', r, ok, x);
      add(L, 'wait_queue', q, t?.startedAt, x);
      add(L, c.state === 'bounced' ? 'bounced' : 'train', t?.startedAt, t?.endedAt, x);
      if (c.landedAt) marks.push({ lane: 'main', at: c.landedAt, change: c.id, kind: 'landed', label: c.title });
    }
    for (const t of trains) {
      const label = `${t.changes.length} change${t.changes.length === 1 ? '' : 's'} tested together`;
      add('queue', 'train', t.startedAt, t.endedAt, { label, detail: t.items?.map((i) => i.title).join(', ') });
      const ck = t.checks?.ms || 0;
      add('merger', 'apply', t.startedAt, t.endedAt - ck, { label: 'Applying the changes' });
      add('merger', 'checks', t.endedAt - ck, t.endedAt, { label: t.checks?.ok === false ? 'Checks failed' : 'Checks passed' });
    }
    // The critical path: the chain of the change that landed last (planning, then its own steps).
    const lastC = ch.filter((c) => c.landedAt).sort((a, b) => b.landedAt - a.landedAt)[0];
    const critical = lastC ? spans.filter((s) => s.change === lastC.id && s.lane.startsWith('a:') || s.lane === 'planner').map((s) => s.id) : [];
    return { run: { start, end, label: D.mode === 'demo' ? 'The last run' : 'This build' }, lanes, spans, marks, critical, criticalChange: lastC?.title || null };
  };

  // ---- plain-words summary: where the time went, the bottleneck ----
  function union(sp) { const xs = sp.map((s) => [s.start, s.end]).sort((a, b) => a[0] - b[0]); let t = 0, cs = null, ce = null; for (const [s, e] of xs) { if (ce == null || s > ce) { if (ce != null) t += ce - cs; cs = s; ce = e; } else ce = Math.max(ce, e); } if (ce != null) t += ce - cs; return t; }
  function summary(T) {
    const runMs = T.run.end - T.run.start, ag = T.spans.filter((s) => s.lane.startsWith('a:'));
    const by = {}; for (const s of ag) by[s.phase] = (by[s.phase] || 0) + (s.end - s.start);
    const total = Object.values(by).reduce((a, b) => a + b, 0) || 1;
    const top = Object.entries(by).sort((a, b) => b[1] - a[1]);
    const grp = Object.fromEntries(T.lanes.map((l) => [l.id, l.group]));
    const qBusy = union(T.spans.filter((s) => grp[s.lane] === 'queue')) / runMs, rBusy = union(T.spans.filter((s) => grp[s.lane] === 'reviewers' && s.phase === 'review')) / runMs;
    const waits = (by.wait_review || 0) + (by.wait_queue || 0);
    const lines = [];
    if (top[0]) lines.push(`Most of the agents' time: ${PHASE[top[0][0]]?.[0].toLowerCase() || top[0][0]}, ${Math.round((top[0][1] / total) * 100)}%.`);
    if (waits / total >= 0.2) lines.push(`Waiting (for review or in the line) took ${Math.round((waits / total) * 100)}% of the agents' time.`);
    const neck = qBusy >= rBusy ? ['the line (testing and landing)', qBusy] : ['review', rBusy];
    if (neck[1] >= 0.6) lines.push(`The bottleneck: ${neck[0]} was busy ${Math.round(neck[1] * 100)}% of the run.`);
    else lines.push(`No single bottleneck: the line was busy ${Math.round(qBusy * 100)}% of the run, review ${Math.round(rBusy * 100)}%.`);
    // Inside the merger: its biggest phase (qb6: fetching main dominates, ~4 s a train).
    const mg = T.spans.filter((s) => grp[s.lane] === 'merger'), mBy = {};
    for (const s of mg) mBy[s.phase] = (mBy[s.phase] || 0) + (s.end - s.start);
    const mTot = Object.values(mBy).reduce((a, b) => a + b, 0), mTop = Object.entries(mBy).sort((a, b) => b[1] - a[1])[0];
    if (mTop && mTot > 0 && Object.keys(mBy).length > 2 && mTop[1] / mTot >= 0.4) lines.push(`In the merger, ${PHASE[mTop[0]]?.[0].toLowerCase() || mTop[0]} took most of its time: ${dur(mTop[1])} of ${dur(mTot)}.`);
    const peak = maxConcurrent(ag.filter((s) => s.phase === 'work'));
    lines.push(`Up to ${peak} agent${peak === 1 ? '' : 's'} worked at the same time; the run took ${dur(runMs)}.`);
    return { lines, by, total, qBusy };
  }
  function maxConcurrent(sp) { const ev = sp.flatMap((s) => [[s.start, 1], [s.end, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]); let c = 0, m = 0; for (const [, d] of ev) { c += d; m = Math.max(m, c); } return m; }

  // ---- the view ----
  window.qbTimelineView = function (T) {
    if (T && T.run?.now) for (const s of T.spans) if (s.open) s.end = Math.max(s.end || 0, T.run.now);
    if (!T) return '<p class="dim">No run to show yet. Start a run or a build and its timeline appears here.</p>';
    const S = summary(T), runMs = T.run.end - T.run.start;
    if (!T.criticalChange && T.critical?.length) { const cs = T.spans.find((x) => T.critical.includes(x.id) && x.change && x.label); if (cs) T.criticalChange = cs.label; }
    const used = new Set(T.spans.map((s) => s.lane).concat(T.marks.map((m) => m.lane)));
    const lanes = T.lanes.filter((l) => used.has(l.id)).map((l) => ({ ...l, label: String(l.label || l.id).replace(/^scripted agent (\d+)$/i, 'Agent $1').replace(/^r:reviewer$/, 'Reviewer') }));
    const crit = new Set(T.critical || []);
    const pct = (t) => `${(((t - T.run.start) / runMs) * 100).toFixed(3)}%`;
    const wid = (s) => `${Math.max(0.15, ((s.end - s.start) / runMs) * 100).toFixed(3)}%`;
    // agents busy over time, 60 bins
    const work = T.spans.filter((s) => s.lane.startsWith('a:') && s.phase === 'work'), B = 60, bins = Array(B).fill(0);
    for (let i = 0; i < B; i++) { const a = T.run.start + (runMs * i) / B, b = a + runMs / B; bins[i] = work.filter((s) => s.start < b && s.end > a).length; }
    const bmax = Math.max(1, ...bins);
    // One legend entry per colour (several phases share one: all the waits are hatched, fetch/apply are merging).
    const LEG = [['tl-plan', 'Planning, waking'], ['tl-work', 'Working'], ['tl-review', 'Review'], ['tl-wait', 'Waiting'], ['tl-apply', 'Merging (fetch, apply)'], ['tl-train', 'Testing and landing'], ['tl-checks', 'Checks'], ['tl-bounced', 'Sent back']];
    const usedCls = new Set(T.spans.flatMap((s) => (PHASE[s.phase]?.[1] || '').split(' ')));
    const legend = LEG.filter(([c]) => usedCls.has(c)).map(([c, w]) => `<span class="tl-lg"><i class="${c}"></i>${esc(w)}</span>`).join('');
    const agentsN = lanes.filter((l) => l.group === 'agents').length;
    const rows = GROUPS.map(([g, gl]) => {
      const ls = lanes.filter((l) => l.group === g); if (!ls.length) return '';
      const one = (l, sub) => `<div class="tl-row${sub ? ' tl-sub' : ''}" data-group="${g}"><div class="tl-lab">${esc(l.label)}</div><div class="tl-track">${T.spans.filter((s) => s.lane === l.id).map((s) => `<button type="button" class="tl-span ${PHASE[s.phase]?.[1] || ''}${crit.has(s.id) ? ' tl-crit' : ''}" style="left:${pct(s.start)};width:${wid(s)}" data-span="${s.id}" aria-label="${esc(`${PHASE[s.phase]?.[0] || s.phase}: ${s.label || ''}, ${dur(s.end - s.start)}`)}"></button>`).join('')}${T.marks.filter((m) => m.lane === l.id).map((m) => `<i class="tl-mark tl-${m.kind}" style="left:${pct(m.at)}" title="${esc(m.label || '')}"></i>`).join('')}</div></div>`;
      if (g !== 'agents') return ls.map((l) => one(l, false)).join('');
      return `<div class="tl-row tl-ghead"><div class="tl-lab"><button type="button" class="tl-fold" data-fold aria-expanded="true">Agents (${agentsN})</button></div><div class="tl-track tl-agg">${work.map((s) => `<i class="tl-aggbar" style="left:${pct(s.start)};width:${wid(s)}"></i>`).join('')}</div></div>${ls.map((l) => one(l, true)).join('')}`;
    }).join('');
    const ticks = [0, 1 / 3, 2 / 3, 1].map((f) => `<span style="left:${f * 100}%">${dur(runMs * f)}</span>`).join('');
    return `<section class="tl" aria-label="Run timeline">
      <div class="tl-sum">${S.lines.map((l) => `<p>${esc(l)}</p>`).join('')}${T.criticalChange ? `<p class="dim">Highlighted: the chain that set the end of the run (${esc(T.criticalChange)}).</p>` : ''}</div>
      <div class="tl-legend">${legend}<span class="tl-lg"><i class="tl-crit-k"></i>Critical path</span></div>
      <div class="tl-ctl"><button type="button" class="chipb" data-zoom="out" aria-label="Zoom out">−</button><button type="button" class="chipb" data-zoom="in" aria-label="Zoom in">+</button><button type="button" class="chipb" data-zoom="fit">Fit</button><span class="dim tl-zl">Pinch or use + and − to zoom; drag to move.</span></div>
      <div class="tl-brush" aria-hidden="true"><div class="tl-conc">${bins.map((v) => `<i style="height:${Math.round((v / bmax) * 100)}%"></i>`).join('')}</div><div class="tl-win"></div></div>
      <div class="tl-scroll"><div class="tl-canvas">
        <div class="tl-row tl-axisrow"><div class="tl-lab">Agents busy</div><div class="tl-track tl-conc tl-conc-big">${bins.map((v) => `<i style="height:${Math.round((v / bmax) * 100)}%" title="${v}"></i>`).join('')}</div></div>
        ${rows}
        <div class="tl-row tl-axisrow"><div class="tl-lab"></div><div class="tl-track tl-axis">${ticks}</div></div>
      </div></div>
      <div class="tl-sheet" hidden role="dialog" aria-label="Span details"></div>
    </section>`;
  };

  // ---- interaction: zoom (buttons, pinch, ctrl+wheel), drag to pan, the brush, tap for details, fold agents ----
  window.qbTimelineMount = function (root, T) {
    const sec = root.querySelector('.tl'); if (!sec || !T) return;
    const sc = sec.querySelector('.tl-scroll'), cv = sec.querySelector('.tl-canvas'), win = sec.querySelector('.tl-win'), sheet = sec.querySelector('.tl-sheet');
    let z = +(sessionStorage.getItem('qb.tl.z') || 1);
    const LAB = 84;
    const setZ = (nz, cx) => {
      const old = z; z = Math.max(1, Math.min(40, nz)); const w = sc.clientWidth - LAB;
      const fx = cx == null ? (sc.scrollLeft + w / 2) / (w * old) : (sc.scrollLeft + cx - LAB) / (w * old);
      cv.style.width = `${LAB + w * z}px`;
      sc.scrollLeft = fx * w * z - (cx == null ? w / 2 : cx - LAB);
      try { sessionStorage.setItem('qb.tl.z', String(z)); } catch {}
      brush();
    };
    const brush = () => { const w = cv.scrollWidth - LAB, vw = sc.clientWidth - LAB; win.style.left = `${(sc.scrollLeft / w) * 100}%`; win.style.width = `${Math.min(100, (vw / w) * 100)}%`; };
    setZ(z); const keep = +(sessionStorage.getItem('qb.tl.x') || 0); if (keep) sc.scrollLeft = keep;
    sc.addEventListener('scroll', () => { brush(); try { sessionStorage.setItem('qb.tl.x', String(Math.round(sc.scrollLeft))); } catch {} }, { passive: true });
    sec.querySelector('.tl-ctl').addEventListener('click', (e) => { const b = e.target.closest('[data-zoom]'); if (!b) return; const k = b.dataset.zoom; setZ(k === 'fit' ? 1 : k === 'in' ? z * 1.6 : z / 1.6); });
    sc.addEventListener('wheel', (e) => { if (!e.ctrlKey) return; e.preventDefault(); setZ(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - sc.getBoundingClientRect().left); }, { passive: false });
    let pinch = null;
    sc.addEventListener('touchstart', (e) => { if (e.touches.length === 2) { const [a, b] = e.touches; pinch = { d: Math.abs(a.clientX - b.clientX) || 1, z, cx: (a.clientX + b.clientX) / 2 - sc.getBoundingClientRect().left }; } }, { passive: true });
    sc.addEventListener('touchmove', (e) => { if (!pinch || e.touches.length !== 2) return; e.preventDefault(); const [a, b] = e.touches; setZ(pinch.z * ((Math.abs(a.clientX - b.clientX) || 1) / pinch.d), pinch.cx); }, { passive: false });
    sc.addEventListener('touchend', () => { pinch = null; });
    // the brush: tap or drag on the overview to move the view
    const br = sec.querySelector('.tl-brush');
    const moveTo = (x) => { const r = br.getBoundingClientRect(), f = (x - r.left) / r.width, w = cv.scrollWidth - LAB, vw = sc.clientWidth - LAB; sc.scrollLeft = f * w - vw / 2; };
    br.addEventListener('pointerdown', (e) => { br.setPointerCapture(e.pointerId); moveTo(e.clientX); const mv = (ev) => moveTo(ev.clientX); br.addEventListener('pointermove', mv); br.addEventListener('pointerup', () => br.removeEventListener('pointermove', mv), { once: true }); });
    sec.addEventListener('click', (e) => {
      const f = e.target.closest('[data-fold]');
      if (f) { const open = f.getAttribute('aria-expanded') !== 'true'; f.setAttribute('aria-expanded', String(open)); sec.classList.toggle('tl-folded', !open); return; }
      const sp = e.target.closest('[data-span]');
      if (sp) {
        const s = T.spans.find((x) => x.id === sp.dataset.span); if (!s) return;
        const lane = T.lanes.find((l) => l.id === s.lane);
        sheet.innerHTML = `<div class="tl-sh"><b>${esc(PHASE[s.phase]?.[0] || s.phase)}</b><button type="button" class="tl-x" data-close aria-label="Close">×</button></div>
          <p>${esc(lane?.label || '')}${s.label ? `: ${esc(s.label)}` : ''}</p>
          <p class="dim">${dur(s.end - s.start)}, from ${dur(s.start - T.run.start)} to ${dur(s.end - T.run.start)} into the run${(T.critical || []).includes(s.id) ? '; on the critical path' : ''}.</p>
          ${s.detail ? `<p class="dim">${esc(s.detail)}</p>` : ''}${s.change ? `<a href="#/change/${encodeURIComponent(s.change)}">Open this change</a>` : ''}`;
        sheet.hidden = false; return;
      }
      if (e.target.closest('[data-close]')) sheet.hidden = true;
    });
  };

  window.QB_TIMELINE_CSS = `.tl{display:grid;gap:10px}
.tl-sum p{margin:0 0 4px;font-size:15px}.tl-sum .dim{font-size:13px}
.tl-legend{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:12px;color:var(--dim)}.tl-lg{display:inline-flex;align-items:center;gap:5px}.tl-lg i{width:14px;height:10px;border-radius:3px;display:inline-block}
.tl-ctl{display:flex;align-items:center;gap:6px}.tl-ctl .chipb{min-width:44px;min-height:40px}.tl-zl{font-size:12px}
.tl-brush{position:relative;height:28px;border-radius:6px;background:var(--card);box-shadow:inset 0 0 0 1px var(--line);touch-action:none;cursor:pointer}
.tl-brush .tl-conc{position:absolute;inset:3px 4px;display:flex;align-items:flex-end;gap:1px}
.tl-conc i{flex:1;background:color-mix(in srgb,var(--acc) 55%,transparent);border-radius:1px;min-height:1px}
.tl-win{position:absolute;top:0;bottom:0;border-radius:6px;box-shadow:inset 0 0 0 2px var(--fg);background:color-mix(in srgb,var(--fg) 6%,transparent);pointer-events:none}
.tl-scroll{overflow-x:auto;overscroll-behavior-x:contain;border-radius:10px;box-shadow:inset 0 0 0 1px var(--line);touch-action:pan-x pan-y}
.tl-canvas{min-width:100%;position:relative}
.tl-row{display:flex;min-height:30px;border-bottom:1px solid var(--line)}.tl-row:last-child{border-bottom:0}
.tl-lab{flex:none;box-sizing:border-box;width:84px;position:sticky;left:0;z-index:2;display:flex;align-items:center;padding:0 8px;font-size:12px;background:var(--bg);box-shadow:1px 0 0 var(--line);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tl-sub .tl-lab{padding-left:16px;color:var(--dim)}
.tl-folded .tl-sub{display:none}.tl-agg{display:none}.tl-folded .tl-agg{display:block}
.tl-fold{border:0;background:none;padding:0;font:inherit;font-size:12px;font-weight:600;color:var(--fg);cursor:pointer;min-height:30px}
.tl-fold::before{content:'';display:inline-block;width:6px;height:6px;margin-right:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg) translateY(-2px)}
.tl-fold[aria-expanded="false"]::before{transform:rotate(-45deg)}
.tl-track{flex:1;position:relative;min-width:0}
.tl-span{position:absolute;top:7px;height:16px;border:0;border-radius:3px;padding:0;cursor:pointer;min-width:2px}
.tl-span:focus-visible{outline:2px solid var(--fg);outline-offset:1px}
.tl-aggbar{position:absolute;top:9px;height:12px;background:color-mix(in srgb,var(--acc) 40%,transparent)}
.tl-plan{background:var(--dim)}.tl-work{background:var(--acc)}.tl-review{background:var(--busy)}
.tl-wait{background:repeating-linear-gradient(135deg,var(--line) 0 3px,transparent 3px 6px);box-shadow:inset 0 0 0 1px var(--line)}
.tl-wr{background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--busy) 45%,transparent) 0 3px,transparent 3px 6px)}
.tl-train{background:var(--fg)}.tl-apply{background:color-mix(in srgb,var(--fg) 72%,var(--acc))}.tl-checks{background:color-mix(in srgb,var(--fg) 55%,transparent)}.tl-bounced{background:var(--warn)}
.tl-crit{box-shadow:0 0 0 2px var(--bg),0 0 0 3.5px var(--warn)}.tl-crit-k{box-shadow:0 0 0 1.5px var(--warn) inset}
.tl-mark{position:absolute;top:4px;bottom:4px;width:3px;margin-left:-1px;border-radius:2px;background:var(--acc)}.tl-mark.tl-bounced{background:var(--warn)}
.tl-conc-big{display:flex;align-items:flex-end;gap:1px;padding:3px 0}
.tl-axis{height:22px}.tl-axis span{position:absolute;top:4px;transform:translateX(-50%);font-size:11px;color:var(--dim);white-space:nowrap}.tl-axis span:first-child{transform:none}.tl-axis span:last-child{transform:translateX(-100%)}
.tl-sheet{position:sticky;bottom:8px;z-index:5;padding:12px;border-radius:14px;background:var(--card);box-shadow:inset 0 0 0 1px var(--line),0 0 0 8px var(--bg)}
.tl-sheet p{margin:4px 0 0;font-size:14px}.tl-sh{display:flex;align-items:center;justify-content:space-between}.tl-x{border:0;background:none;font-size:22px;width:44px;height:44px;color:var(--dim);cursor:pointer}`;
})();
