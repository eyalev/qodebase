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
  // What each fleet repo is (Eyal: 'Copy' means nothing): our own Artifacts duplicates of these open-source projects,
  // made for the test and never pushed upstream. qb6's row.source wins when present.
  const SRC = { 'fleet-vscode-src': ['VS Code src/vs', 'microsoft/vscode'], 'fleet-vscode-ext': ['VS Code extensions', 'microsoft/vscode'], 'fleet-nest': ['NestJS packages', 'nestjs/nest'],
    'fleet-angular': ['Angular packages', 'angular/angular'], 'fleet-nextjs': ['Next.js packages', 'vercel/next.js'], 'fleet-babel': ['Babel packages', 'babel/babel'], 'fleet-main': ['VS Code src/vs', 'microsoft/vscode'] };
  const repoBase = (repo) => String(repo || '').replace(/-\d+$/, '');
  const srcOf = (r) => { const x = r.source; if (x && x.name) return { name: x.name, upstream: x.upstream || '' }; const m = SRC[repoBase(r.repo)]; return m ? { name: m[0], upstream: m[1] } : { name: repoBase(r.repo).replace(/^fleet-/, ''), upstream: '' }; };
  const repoCopy = (r) => +((/-(\d+)$/.exec(r.repo || '') || [])[1] || 0);
  const pct = (a, b) => (b ? Math.max(0, Math.min(100, (100 * a) / b)) : 0);

  let D = null, TL = {}, failures = 0, timer = 0, lastOk = 0, stopAsk = {}, busy = false;
  const live = (r) => r.state === 'running' || r.state === 'paused';
  const key = (r) => `${r.repo}/${r.runId}`;

  // ---- data ------------------------------------------------------------------------------------------------------
  // The last list, kept in this browser (owner flag dropped): drawn at once on the next visit while /api/runs answers
  // (review 3: /runs took ~3.4 s to show anything). Six hours at most; the poll replaces it.
  const CACHE_K = 'qb.runs.v1';
  function cached() { try { const c = JSON.parse(localStorage.getItem(CACHE_K) || 'null'); return c && Date.now() - c.at < 6 * 3600e3 ? c.d : null; } catch (e) { return null; } }
  async function load() {
    if (MOCK) {
      const m = await fetch('/lab/runs-mock.json', { cache: 'no-store' }).then((r) => r.json());
      D = m; TL = m.timelines || {}; if (m.owner) OWN = true; return;
    }
    // 20 s at most (qb3: the first load sometimes sat on 'Loading the runs…' past 25 s); the poll tries again
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), 20e3), t0 = Date.now();
    const r = await fetch(API, { cache: 'no-store', credentials: 'same-origin', signal: ac.signal }).finally(() => clearTimeout(to));
    if (Date.now() - t0 > 5e3) log('runs_slow', { ms: Date.now() - t0 });
    if (!r.ok) throw new Error(`runs ${r.status}`);
    D = await r.json();
    if (typeof D.owner === 'boolean') OWN = D.owner;
    try { localStorage.setItem(CACHE_K, JSON.stringify({ at: Date.now(), d: { ...D, owner: false } })); } catch (e) {}
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
  // The API index checker (qb6: GET …/indexcheck -> {lines, expected, sorted, missing, twice}): asked on a run's page,
  // every 15 s while it runs; a 404 (no index job, or not deployed) shows nothing.
  const IX = {}, IXat = {};
  async function loadIndexCheck(r) {
    // a check made while the run was live is refetched once it ends (qb6: the card froze at a mid-landing 5,252 of 5,300)
    const k = key(r); if (IX[k] && !(IX[k].wasLive && !live(r)) && (!live(r) || Date.now() - (IXat[k] || 0) < 15e3)) return;
    IXat[k] = Date.now(); const wasLive = live(r);
    const res = await fetch(`${API}/${encodeURIComponent(r.repo)}/${encodeURIComponent(r.runId)}/indexcheck`, { cache: 'no-store', credentials: 'same-origin' }).catch(() => null);
    IX[k] = res && res.ok ? await res.json().catch(() => ({ error: 'bad' })) : { error: res ? res.status : 'net' };
    IX[k].wasLive = wasLive;
  }
  const openCopies = new Set();   // which steps' 'Show all copies' are open: kept across the 5 s refresh
  // A ladder step's own summed series (qb6: /api/runs/ladder/<ladder>/series); copies summed in the page otherwise.
  async function loadLadder(g) {
    const lad = g.copies[0]?.ladder; if (!lad || MOCK) return false;
    const k = 'ladder:' + lad;
    if (TL[k] && !live(g) && TL[k].series) return true;
    if (TL[k] && Date.now() - (TLat[k] || 0) < 5e3) return true;
    const r = await fetch(`${API}/ladder/${encodeURIComponent(lad)}/series`, { cache: 'no-store', credentials: 'same-origin' }).catch(() => null);
    if (!r || !r.ok) { if (!TL[k]) TL[k] = { failed: true, series: [] }; log('ladder_failed', { ladder: lad, status: r ? r.status : null }); return false; }
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
    const landed = c.landed || 0, skipped = c.skipped || 0, rejected = (c.rejected || 0) + (c.verify_fail || 0) + (c.model_error || 0);
    // an ended run leaves files that never finished (still at the model when it stopped) out of the total (qb6, qb8's
    // pass: S5b copy 3 read 4,064 files where results.json and Intents say 4,063); a group sums its copies' totals
    const files = r.group ? r.files || 0 : live(r) ? r.files || 0 : Math.min(r.files || 0, landed + skipped + rejected) || r.files || 0;
    const inflight = Math.max(0, files - landed - skipped - rejected);
    return { files, landed, skipped, rejected, inflight };
  }
  // Code-dial runs (qb6's kata: agents make small code changes to src/vs through the merge queue) count changes, not
  // files with comments (qb8's pass: the K60 card read 'added doc comments to 2,852 files'). Redone = sent back by the
  // queue (bounced) and made again.
  const isCode = (r) => (r.group ? isCode(r.copies[0] || {}) : /^fleet-kata/.test(r.repo || '') || /^K\d/.test(r.ladder || '') || /code dial/i.test(r.label || ''));
  const bouncedOf = (r) => (r.group ? r.copies.reduce((a, c) => a + bouncedOf(c), 0) : Object.values(r.models || {}).reduce((a, m) => a + (m.bounced || 0), 0));
  // queue waits under a second come back as 0 or below (clock offsets between the boxes): never print a negative wait
  const secs = (v) => (v == null ? '–' : v < 1 ? 'under 1' : n0(v));
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
    const title = plainName(r.label) || `${r.repo}${r.root ? ` ${r.root}` : ''}`;
    return `<article class="rc st-${esc(r.state)}" data-k="${esc(key(r))}" data-talk-ctx="${esc(title)}">
      <div class="rc-h">${stateTag(r)}<span class="rc-t">${r.state === 'paused' ? `paused <b data-since="${lastPause(r)?.at || Date.now()}">${clock((Date.now() - (lastPause(r)?.at || Date.now())) / 1000)}</b>` : live(r) ? `running <b data-since="${r.startedAt}">${clock(elapsedS(r))}</b>` : r.endedAt ? `${clock(elapsedS(r))}, ended ${ago(r.endedAt)}` : ''}</span></div>
      ${full || r.group ? `<h2 class="rc-name">${esc(title)}</h2>` : `<a class="rc-name" href="#/run/${encodeURIComponent(r.repo)}/${encodeURIComponent(r.runId)}">${esc(title)}</a>`}
      <p class="rc-sub">${r.group ? `${r.copies.length} copies of ${new Set(r.copies.map((c) => repoBase(c.repo))).size} projects, run side by side` : whatIs(r)}, ${n0(r.agentsStarted ?? r.agents)} of ${n0(r.agents)} agents started</p>
      ${r.group && r.copies[0]?.ladder ? `<div class="rc-tl"><p class="rc-mh">All ${r.copies.length} copies together</p>${timeline(r, TL['ladder:' + r.copies[0].ladder], full ? (DR && DR.k === key(r) ? DR : null) : 'mini')}</div>` : ''}
      ${(() => { const ph = r.phase || r.live?.phase, left = r.landingLeft ?? r.live?.landingLeft; return live(r) && ph === 'landing' ? `<p class="rc-why">Every agent has answered: landing the last ${left != null ? `${n0(left)} file${left === 1 ? '' : 's'}` : 'files'} on main.</p>` : ''; })()}
      ${why ? `<p class="rc-why">${r.state === 'paused' && autoWhy(r) ? 'Paused automatically: ' : ''}${esc(why)}</p>` : ''}
      ${isCode(r) ? codeFiles(r, c) : isDecl(r) ? declFiles(r, c) : `<div class="rc-files"><div class="seg" role="img" aria-label="${c.landed} of ${c.files} files got comments on main">${seg(c.landed, 's-l')}${seg(c.skipped, 's-s')}${seg(c.rejected, 's-r')}</div>
        <p>Agents ${live(r) ? 'have added' : 'added'} doc comments to <b>${n0(c.landed)}</b> files and committed them to ${r.group ? 'each copy\u2019s' : 'the'} main branch; ${n0(c.skipped)} files already had them.</p>
        <p class="rc-sm">${n0(c.rejected)} rejected${c.inflight && live(r) ? `, ${n0(c.inflight)} still to do` : ''}, of ${n0(c.files)} files. One change = comments added to one file.</p></div>`}
      <dl class="rc-k">
        <div><dt>Spent</dt><dd>${usd(spent)}${budget ? ` <small>of ${usd(budget)}</small>` : ''}</dd>${budget ? `<div class="bar" aria-hidden="true"><i style="width:${pct(spent, budget).toFixed(1)}%"${spent / budget > 0.85 ? ' class="hot"' : ''}></i></div>` : ''}</div>
        <div><dt>${live(r) ? 'Changes on main per min' : elapsedS(r) < 120 ? 'Changes on main' : 'Changes on main per min, average'}</dt><dd>${lpm}</dd></div>
        ${`<div><dt>${isCode(r) ? 'Task picked to change on main' : 'Wait to reach main'}</dt><dd>${r.landWaitS && r.landWaitS.p50 != null ? `${secs(r.landWaitS.p50)} s <small>median, ${secs(r.landWaitS.p90)} s slowest tenth</small>` : '–'}</dd></div>`}
        <div><dt>Answers</dt><dd>${(() => { const fromCache = mods.filter((m) => m.name === 'cache').reduce((a, m) => a + m.calls, 0), fromModel = mods.filter((m) => m.name !== 'cache').reduce((a, m) => a + m.calls, 0); return `${n0(fromCache)} <small>from cache</small> ${n0(fromModel)} <small>from a model</small>`; })()}</dd></div>
      </dl>
      ${modRows ? `<div class="rc-m"><p class="rc-mh">Calls per minute, per model${live(r) ? '' : ' (peak)'}</p>${modRows}</div>` : ''}
      ${ctl}
      ${r.group ? copyRows(r) : ''}
      ${r.group && !full ? `<a class="chipbtn rc-go" href="#/step/${encodeURIComponent(r.label)}">Open: drill into moments and commits</a>` : ''}
      ${window.qbIntentsMount ? (r.group ? `<a class="chipbtn rc-go" href="#/intents/step/${encodeURIComponent(r.label)}">Intents</a>` : `<a class="chipbtn rc-go" href="#/intents/run/${encodeURIComponent(r.repo)}/${encodeURIComponent(r.runId)}">Intents</a>`) : ''}
      ${full || r.group ? '' : `<a class="chipbtn rc-go" href="#/run/${encodeURIComponent(r.repo)}/${encodeURIComponent(r.runId)}">Timeline</a>`}
    </article>`;
  }
  // Comment-dial runs count doc comments per declaration (35,446 of them in 30,720 files' worth of copies), not files (H2)
  const isDecl = (r) => (r.group ? isDecl(r.copies[0] || {}) : /comment dial/i.test(r.label || '') || /^D-L/.test(r.ladder || ''));
  function declFiles(r, c) {
    return `<div class="rc-files"><p>Agents ${live(r) ? 'have added' : 'added'} <b>${n0(c.landed)}</b> doc comments, one per declaration, to the ${n0(c.files)} files of ${r.group ? 'the copies' : 'the copy'} and committed them to main.</p>
        <p class="rc-sm">${n0(c.rejected)} rejected. One change = a comment on one declaration.</p></div>`;
  }
  function codeFiles(r, c) {
    const redone = bouncedOf(r), made = c.landed + redone + c.rejected;
    const seg = (n, cls) => (n ? `<i class="${cls}" style="width:${pct(n, made).toFixed(2)}%"></i>` : '');
    return `<div class="rc-files"><div class="seg" role="img" aria-label="${c.landed} of ${made} code changes reached main">${seg(c.landed, 's-l')}${seg(redone, 's-s')}${seg(c.rejected, 's-r')}</div>
        <p><b>${n0(c.landed)}</b> of ${n0(made)} code tasks ${live(r) ? 'have landed' : 'landed'} on main; ${n0(redone)} ${redone === 1 ? 'was' : 'were'} sent back by the merge queue and did not land${c.rejected ? `, ${n0(c.rejected)} rejected` : ''}.</p>
        <p class="rc-sm">${n0(r.agentsStarted ?? r.agents)} agents${live(r) ? '' : `, ${clock(elapsedS(r))}`}. A task is one small change to the code, tested before it lands.</p></div>`;
  }
  // Run labels are the team's shorthand ('code dial 60% (K60h)', 'S5b batched…', 'smoke'): the card says it plainly; the
  // label stays the step's key in links.
  const KV = { '': ', one merge queue', f: ', first try (stopped)', g: ', a lane per module', h: ', a lane per module + prefetch' };
  const STEP = { S5: 'Each model at its limit (VS Code)', B1: 'Batching bench: one file per call vs packs', S4a: '200 agents on 4 copies (cache)', S4b: '400 agents on 8 copies (cache)' };
  function plainName(l) {
    if (!l) return '';
    if (STEP[l]) return STEP[l];
    let m = /^code dial (\d+)% \(K(?:\d+([a-z]?)|-([\w-]+))\)$/i.exec(l);
    if (m) return `Code changes, ${m[1] === '0' ? 'no tasks overlapping' : `${m[1]}% of tasks overlapping`}${m[3] ? `, ${m[3].replace(/-/g, ' ')} test` : KV[m[2] || ''] ?? ''}`;
    m = /^comment dial L(\d+)(c?)\b(.*)$/i.exec(l);
    if (m) return `Doc comments, ${m[1] === '0' ? 'no overlap' : `${m[1]}% overlapping`}${m[2] ? ', compact' : ''}${m[3]}`;
    if (/smoke|plumbing|notes test/i.test(l)) return `Test run${(/\(([^)]*)\)/.exec(l) || [])[1] ? ` (${/\(([^)]*)\)/.exec(l)[1]})` : ''}`;
    const x = l.replace(/^(?:S\d+[a-z]?|F\d+[a-z]?|B\d+)\s+/, '').replace(/\s@\s/, ' with ');
    return x.charAt(0).toUpperCase() + x.slice(1);
  }
  function whatIs(r) {
    const s = srcOf(r), n = r.copyOfKind || repoCopy(r), of = r.copiesOfKind || r.copiesOfRepo || (D?.fleet || []).filter((x) => x.ladder && x.ladder === r.ladder && repoBase(x.repo) === repoBase(r.repo)).length;
    // a code kata's source says what it is ('qb4 kata seed 1: 400 small JavaScript functions…'): that, not 'a duplicate of'
    if (isCode(r)) { const pj = r.source && r.source.project; return `A 400-function JavaScript kata library${pj ? ` (${esc(pj)})` : ''}, one qodebase project per level`; }   // qb6: not VS Code
    return `${esc(s.name)}${n && r.ladder && of > 1 ? `, copy ${n} of ${of}` : ''}${s.upstream ? ` (a duplicate of ${esc(s.upstream)} made for this test)` : ''}`;
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
    const blank = (b) => ({ minute: b, calls: {}, landed: 0, ready: null, active: null, lanes: {}, r429: 0, usd: 0, queue: null, door: null, coll: null, repl: null, wait90: null, n: 0 });
    const out = new Map();
    for (const s of src) {
      const b = t0 + Math.floor((s.minute - t0) / step) * step;
      const o = out.get(b) || blank(b);
      for (const [m, v] of Object.entries(s.calls || {})) o.calls[m] = (o.calls[m] || 0) + v;
      for (const [l, v] of Object.entries(s.lanes || {})) o.lanes[l] = (o.lanes[l] || 0) + v;
      o.landed += s.landed || 0; o.r429 += s.r429 || 0; o.usd += s.usd || 0; o.n++;
      if (s.ready != null) o.ready = (o.ready || 0) + s.ready;
      if (s.collisions != null) o.coll = (o.coll || 0) + s.collisions;   // qb6: two changes met on the same lines
      if (s.replays != null) o.repl = (o.repl || 0) + s.replays;          // ... and were redone on the newest main
      if (s.landWaitP90 != null && s.landWaitP90 >= 0) o.wait90 = Math.max(o.wait90 || 0, s.landWaitP90);
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
    const S = [...out.values()].sort((a, b) => a.minute - b.minute).map((o) => ({ ...o, raw: { landed: o.landed, ready: o.ready, coll: o.coll, repl: o.repl, calls: { ...o.calls } }, calls: Object.fromEntries(Object.entries(o.calls).map(([m, v]) => [m, sc(v)])), landed: sc(o.landed), ready: sc(o.ready), coll: sc(o.coll), repl: sc(o.repl) }));
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
    if (t.failed) return '<p class="tl-empty">No timeline for this step.</p>';
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
    // collisions (qb3's shot list, 1): two changes met on the same lines; replays, when the series has them, as a line
    if (S.some((s) => s.coll)) { const tot = S.reduce((a, s) => a + (s.raw.coll || 0), 0), rt = S.reduce((a, s) => a + (s.raw.repl || 0), 0), hasR = S.some((s) => s.repl != null);
      rows.push({ label: hasR ? `Collisions ${unit} (bars), <i class="k-ready"></i>redone on the newest code (line): ${n0(tot)} met, ${n0(rt)} redone` : `Collisions ${unit}: two changes met on the same lines, ${n0(tot)} in all`, html: true, kind: 'pair', vals: S.map((s) => s.coll || 0), area: hasR ? S.map((s) => s.repl || 0) : null, max: nice(Math.max(1, ...S.map((s) => Math.max(s.coll || 0, s.repl || 0)))), cls: 'c-coll', h: H + 8 }); }
    if (S.some((s) => s.wait90)) { const pk = peakOf((s) => s.wait90 || 0); rows.push({ label: `Wait to reach main, slowest tenth (seconds), peak ${n0(pk)}`, kind: 'area', vals: S.map((s) => s.wait90 || 0), max: nice(Math.max(pk, 1)), cls: 'c-queue', h: H }); }
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
    const mini = drill === 'mini'; if (mini) drill = null; else TLS = { S, stepMs, per, t0, unit };
    return `<div class="tl-frame${mini ? ' mini' : ''}"${live(run) ? ' data-live' : ''} tabindex="0" role="group" aria-label="Timeline of the run; scrolls sideways; tap a column for that moment"><div class="tl-in" style="width:${W}px;--fw:${W0 - 6}px" data-per="${per}">
      ${mlabels ? `<svg class="tl-ax" width="${W}" height="16" aria-hidden="true">${mlabels}</svg>` : ''}
      <svg class="tl-ov" width="${W}" height="100%" aria-hidden="true">${grid}${sel}${marks}</svg>
      ${rows.map(strip).join('')}
      <svg class="tl-ax" width="${W}" height="16" aria-hidden="true">${axis}</svg></div></div>${legend}
      ${mini ? '' : '<p class="tl-hint">Tap a column to see what happened in that slice.</p>'}`;
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
    const crumbs = `<p class="dp-cr"><button type="button" class="dp-x" data-dr="close" aria-label="Close">Close</button><button type="button" class="dp-b${DR.view === 'slice' ? ' on' : ''}" data-dr="slice">${from} to ${to}</button>${DR.agent ? `<button type="button" class="dp-b${DR.view === 'agent' ? ' on' : ''}" data-dr="agent" data-agent="${esc(DR.agent)}">${esc(agentName(DR.agent))}</button>` : ''}${DR.sha && (DR.view === 'commit' || DR.view === 'change') ? `<button type="button" class="dp-b${DR.view === 'commit' ? ' on' : ''}" data-dr="commit" data-sha="${esc(DR.sha)}">Commit ${esc(DR.sha.slice(0, 7))}</button>` : ''}${DR.file && DR.view === 'change' ? `<span class="dp-b on">${esc(fileName(DR.file))}</span>` : ''}</p>`;
    let body = '';
    if (DR.view === 'slice') {
      const raw = s.raw || {};
      const facts = [s.active != null ? `<li><b>${n0(s.active)}</b> agents at work</li>` : '', raw.ready != null ? `<li><b>${n0(raw.ready)}</b> changes finished by agents</li>` : '', `<li><b>${n0(raw.landed || 0)}</b> changes reached main</li>`, raw.coll ? `<li><b>${n0(raw.coll)}</b> collisions${raw.repl != null ? `, ${n0(raw.repl)} redone on the newest code` : ''}</li>` : '',
        ...Object.entries(raw.calls || {}).map(([m, v]) => `<li><b>${n0(v)}</b> calls to ${esc(short(m))}</li>`), s.queue != null ? `<li><b>${n0(s.queue)}</b> waiting at the deepest moment</li>` : '', s.r429 ? `<li><b>${n0(s.r429)}</b> refused by the model (429)</li>` : ''].join('');
      const lanes = Object.entries(s.lanes || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const d = DR.data.slice;
      const list = run.group ? '<p class="dp-n">Open one copy’s timeline to see its single changes.</p>'
        : !d ? '<p class="dp-n">Loading the changes in this slice…</p>' : d.error ? `<p class="dp-n">The list of changes is not available yet (${esc(d.error)}).</p>`
        : !(d.changes || []).length ? `<p class="dp-n">${d.landedInSlice ? `${n0(d.landedInSlice)} changes reached main in this slice; agents finished them earlier.` : 'No single change finished in this slice.'}</p>`
        : `<ul class="dp-l">${d.changes.slice(0, 60).map((c) => `<li><button type="button" class="dp-f" data-dr="change" data-file="${esc(c.file)}" data-agent="${esc(c.agent || '')}"><span class="mono">${esc(fileName(c.file))}</span><small>${esc(ST[c.status] || c.status || '')}${c.landed ? `, on main ${rel(c.landed)}` : c.answered ? `, finished ${rel(c.answered)}` : ''}</small></button>${c.agent ? `<button type="button" class="dp-a" data-dr="agent" data-agent="${esc(c.agent)}">${esc(agentName(c.agent))}</button>` : ''}</li>`).join('')}</ul>${(d.total || d.changes.length) > 60 ? `<p class="dp-n">and ${n0((d.total || d.changes.length) - 60)} more in this slice</p>` : ''}`;
      const cm = DR.data.commits;
      const commits = cm && !cm.error && (cm.commits || []).length ? `<p class="dp-h">Commits to main in this slice</p><ul class="dp-l">${cm.commits.slice(0, 40).map((c) => `<li><button type="button" class="dp-f" data-dr="commit" data-sha="${esc(c.sha)}"><span>${esc(c.message || c.sha.slice(0, 7))}</span><small>${rel(c.at)}, ${n0(c.files)} file${c.files === 1 ? '' : 's'}${c.lane ? `, lane ${esc(c.lane)}` : ''}, <span class="mono">${esc(c.sha.slice(0, 7))}</span></small></button></li>`).join('')}</ul>` : '';
      body = `<ul class="dp-facts">${facts}</ul>${lanes.length ? `<p class="dp-n">Busiest lanes: ${lanes.map(([l, v]) => `${esc(l)} ${n0(v)}`).join(', ')}</p>` : ''}${commits}${commits ? '<p class="dp-h">Changes in this slice</p>' : ''}${list}`;
    } else if (DR.view === 'commit') {
      const d = DR.data['c:' + DR.sha];
      body = !d ? '<p class="dp-n">Loading the commit…</p>' : d.error ? `<p class="dp-n">Not available yet (${esc(d.error)}).</p>`
        : `<p class="dp-cm">${esc(d.message || '')}</p><p class="dp-n">On main ${rel(d.at)}, ${n0((d.files || []).length)} file${(d.files || []).length === 1 ? '' : 's'}, <span class="mono">${esc(d.sha.slice(0, 7))}</span></p><ul class="dp-l">${(d.files || []).slice(0, 100).map((f) => { const fp = typeof f === 'string' ? f : f.file; return `<li><button type="button" class="dp-f" data-dr="change" data-file="${esc(fp)}" data-sha="${esc(d.sha)}"><span class="mono">${esc(fileName(fp))}</span><small>${esc(ST[f.status] || f.status || 'comments added')}</small></button></li>`; }).join('')}</ul>`;
    } else if (DR.view === 'agent') {
      const d = DR.data['a:' + DR.agent];
      body = !d ? '<p class="dp-n">Loading this agent’s files…</p>' : d.error ? `<p class="dp-n">Not available yet (${esc(d.error)}).</p>`
        : `<p class="dp-n">${n0((d.files || []).length)} files, times from the run’s start.</p><ul class="dp-l">${(d.files || []).map((f) => `<li><button type="button" class="dp-f" data-dr="change" data-file="${esc(f.file)}" data-agent="${esc(DR.agent)}"><span class="mono">${esc(fileName(f.file))}</span><small>picked ${rel(f.picked)}${f.answered ? `, finished ${rel(f.answered)}` : ''}${f.landed ? `, on main ${rel(f.landed)}` : ''}, ${esc(ST[f.status] || f.status || '')}</small></button></li>`).join('')}</ul>`;
    } else {
      const d = DR.data['f:' + DR.file];
      body = !d ? '<p class="dp-n">Loading the change…</p>' : d.error ? `<p class="dp-n">Not available yet (${esc(d.error)}).</p>`
        : `<p class="dp-p mono">${esc(d.file)}</p>${(d.note?.intent || d.intent) ? `<p class="dp-why"><b>Why:</b> ${esc(d.note?.intent || d.intent)}</p>` : ''}<dl class="dp-t"><div><dt>Agent</dt><dd>${esc(agentName(d.agent))}</dd></div><div><dt>Picked</dt><dd>${rel(d.note?.picked || d.picked)}</dd></div><div><dt>Comments from</dt><dd>${esc(d.source === 'cache' ? 'the cache (reused)' : short(d.model || d.source || ''))}${d.answered ? `, ${rel(d.answered)}` : ''}</dd></div><div><dt>Code unchanged</dt><dd>${d.note?.verify ? `${d.note.verify.ok ? 'yes' : 'no'}${d.note.verify.how ? `: ${esc(d.note.verify.how)}` : ''}` : d.verified ? `yes, checked ${rel(d.verified)}` : '–'}</dd></div>${d.commit ? `<div><dt>Commit</dt><dd class="mono">${esc(String(d.commit).slice(0, 7))}</dd></div>` : ''}<div><dt>On main</dt><dd>${(d.note?.landedAt || d.landed) ? rel(d.note?.landedAt || d.landed) : esc(ST[d.status] || d.status || '–')}</dd></div></dl>
          ${d.diff ? `<pre class="dp-d">${String(d.diff).split('\n').slice(0, 400).map((l) => `<span class="${/^\+(?!\+\+)/.test(l) ? 'ad' : /^-(?!--)/.test(l) ? 'rm' : /^@@/.test(l) ? 'hk' : ''}">${esc(l)}</span>`).join('\n')}</pre>` : '<p class="dp-n">No diff for this change.</p>'}`;
    }
    return `<section class="dp" aria-label="What happened">${crumbs}${body}</section>`;
  }
  const agentName = (a) => { const x = String(a ?? ''); return /^\d+$/.test(x) ? `Agent ${x}` : x.replace(/^.*#/, 'Agent ').replace(/^agent[-_ ]?/i, 'Agent '); };
  const fileName = (f) => { const p = String(f || '').split('/'); return p.length > 3 ? `…/${p.slice(-3).join('/')}` : f; };

  // ---- copies: one ladder step runs as N copies (label '… - copy N'); the step is one card with the copies under it ---
  // the step's name from the label ('S4d 4,750 agents / 95 copies (cache) - copy 7'), else qb6's ladder field
  const baseOf = (r) => { const m = /^(.*?)\s+[-–]\s+(?:copy\s+\d+|fleet-[\w-]+)$/i.exec(r.label || ''); return m ? m[1] : r.ladder && r.copy != null ? r.ladder : null; };   // reruns of a step (K60, K60f) are not copies
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
      Object.assign(g, { state: st, files: sum((c) => C(c).files), counts: { landed: sum((c) => C(c).landed), skipped: sum((c) => C(c).skipped), rejected: sum((c) => C(c).rejected) },
        usd: sum((c) => c.usd), budgetUsd: sum((c) => c.budgetUsd) || null, agents: sum((c) => c.agents), agentsStarted: sum((c) => c.agentsStarted ?? c.agents), calls: sum((c) => c.calls),
        startedAt: Math.min(...cs.map((c) => c.startedAt || Infinity)), endedAt: cs.every((c) => c.endedAt) ? Math.max(...cs.map((c) => c.endedAt)) : null,
        lastMinute: { landed: sum((c) => c.lastMinute?.landed), calls: sum((c) => c.lastMinute?.calls) },
        landWaitS: p90s.length ? { p50: Math.round(p50s.reduce((a, v) => a + v, 0) / p50s.length), p90: Math.max(...p90s) } : null,
        models, pauses: cs.flatMap((c) => c.pauses || []).sort((a, b) => a.at - b.at), repos: cs.map((c) => c.repo) });
    }
    return out;
  }
  // A step's copies grouped by the project they duplicate: one summary row per project (tap to open its copies, the
  // first five, then 'Show all'); above them, fastest / median / slowest copy by files per second.
  function copyRows(g) {
    const rate = (c) => { const k = counts(c), sec = elapsedS(c); return sec > 0 ? (k.landed + k.skipped + k.rejected) / sec : null; };
    const f1 = (v) => (v >= 10 ? Math.round(v) : v.toFixed(1));
    const rs = g.copies.map((c) => ({ c, v: rate(c) })).filter((x) => x.v != null).sort((a, b) => b.v - a.v);
    const nm = (x) => `${srcOf(x.c).name} copy ${x.c.copyOfKind || repoCopy(x.c) || '?'}`;
    const sum = rs.length > 2 ? `<p class="rcp-s">Files per second per copy: fastest ${f1(rs[0].v)} (${esc(nm(rs[0]))}), median ${f1(rs[rs.length >> 1].v)}, slowest ${f1(rs[rs.length - 1].v)} (${esc(nm(rs[rs.length - 1]))}).</p>` : '';
    const by = new Map(); for (const c of g.copies) { const b = repoBase(c.repo); (by.get(b) || by.set(b, []).get(b)).push(c); }
    const row = (c, n) => { const k = counts(c); return `<li><a href="#/run/${encodeURIComponent(c.repo)}/${encodeURIComponent(c.runId)}"><span class="rs-st st-${esc(c.state)}"><i></i>Copy ${c.copyOfKind || repoCopy(c) || '?'}</span><span class="rcp-v">${n0(k.landed)} files got comments, ${n0(k.skipped)} already had them, ${esc((STATE[c.state] || c.state).toLowerCase())}</span><span class="rr-go">Timeline</span></a></li>`; };
    const groups = [...by.entries()].sort((a, b) => b[1].length - a[1].length).map(([base, cs]) => {
      cs.sort((a, b) => (a.copyOfKind || repoCopy(a)) - (b.copyOfKind || repoCopy(b)));
      const s = srcOf(cs[0]), k = cs.reduce((a, c) => { const x = counts(c); a.l += x.landed; a.s += x.skipped; return a; }, { l: 0, s: 0 });
      const id = `${g.label}|${base}`, more = cs.length > 5 ? `<details class="rcp-more"${openCopies.has(id + '|all') ? ' open' : ''} data-g="${esc(id + '|all')}"><summary>Show all ${cs.length} copies</summary><ul class="rcp">${cs.slice(5).map(row).join('')}</ul></details>` : '';
      return `<details class="rcp-repo"${openCopies.has(id) ? ' open' : ''} data-g="${esc(id)}"><summary><span class="rr-n"><b>${esc(s.name)}</b><small>${cs.length} cop${cs.length === 1 ? 'y' : 'ies'}${s.upstream ? ` of ${esc(s.upstream)}` : ''}, ${n0(k.l)} files got comments, ${n0(k.s)} already had them</small></span></summary><ul class="rcp">${cs.slice(0, 5).map(row).join('')}</ul>${more}</details>`;
    }).join('');
    return `${sum}<div class="rcp-g">${groups}</div>`;
  }

  // ---- pages -------------------------------------------------------------------------------------------------------
  const PINS = [
    (r) => !r.group && r.repo === 'fleet-n2-vscode-src-1' && (r.agents || 0) >= 500,   // the 1,000-agent VS Code index take, once recorded
    (r) => !r.group && r.repo === 'fleet-kata-d60h',                                      // the fast code dial at 60% (K60h, qb6: lanes + gateway replays + lane prefetch, 44.5 min; beats K60g)
    (r) => r.group && /^S5b\b/.test(r.label),
    (r) => r.group && /^S4d\b/.test(r.label),
  ];
  function listOrder() {
    const fleet = grouped((D.fleet || []).slice().sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))).sort((a, b) => (live(b) - live(a)) || (b.startedAt || 0) - (a.startedAt || 0));
    const cur = fleet.filter(live), past = fleet.filter((r) => !live(r));
    const pins = PINS.map((p) => past.find(p)).filter(Boolean), rest = past.filter((r) => !pins.includes(r));
    return { cur, pins, rest };
  }
  const shownGroups = () => { const o = listOrder(); return [...o.cur, ...o.pins, ...o.rest.slice(0, 20)].filter((g) => g.group); };
  function listView() {
    // Judge-facing runs first, in this order (manager, 2026-10-14); the rest, newest first, as experiments.
    const { cur, pins, rest } = listOrder();
    const real = D.real || [];
    const realRow = (b) => `<li><a href="${esc(b.link || `/p/${b.slug.replace('.', '/')}/work#/timeline`)}"><span class="rr-n"><b>${esc(b.label || b.slug)}</b><small>${esc(b.slug.replace('.', ' / '))}</small></span><span class="rr-v">${b.settledAt ? `${clock((b.settledAt - b.startedAt) / 1000)}, ${usd(b.usd)}` : b.startedAt ? `running, ${usd(b.usd)} so far` : '–'}${b.parts ? `<small>${n0(b.landed)} of ${n0(b.parts)} parts on main</small>` : b.landed ? `<small>${n0(b.landed)} changes on main</small>` : ''}</span><span class="rr-go">Timeline</span></a></li>`;
    return `<header class="rh"><h1>Scale runs</h1><p class="rh-s"><i class="live${cur.length ? '' : ' off'}"></i><span id="rupd">${cur.length ? `${cur.length} running now` : 'Nothing running now'}</span>${OWN ? '' : '<span class="rh-ro">read-only</span>'}</p></header>${OWN && !MOCK ? '<div id="nj-slot"></div>' : ''}
      ${cur.length ? `<section class="rsec"><h2>Now</h2>${cur.map((r) => card(r, false)).join('')}</section>` : ''}
      ${pins.length ? `<section class="rsec"><h2>Highlights</h2>${pins.map((r) => card(r, false)).join('')}</section>` : ''}
      <section class="rsec"><h2>${pins.length ? 'Experiments' : cur.length ? 'Earlier' : 'Fleet runs'}</h2>${rest.length ? rest.slice(0, 20).map((r) => card(r, false)).join('') : '<p class="dim">No fleet runs yet.</p>'}</section>
      ${real.length ? `<section class="rsec"><h2>Real builds</h2><p class="dim">Real Claude Code agents building an app; each opens its project's timeline.</p><ul class="rr">${real.map(realRow).join('')}</ul></section>` : ''}`;
  }
  // A run just started from New fleet job, until /api/runs lists it (polled every 3 s, 5 min at most)
  let PENDING = null;
  const pendingFor = (repo, id) => (PENDING && PENDING.repo === repo && PENDING.runId === id && Date.now() - PENDING.at < 5 * 60e3 ? PENDING : null);
  const startingCard = (p) => `<p class="crumb"><a href="#/">All runs</a></p><article class="rc st-running"><div class="rc-h"><span class="rs-st st-running"><i></i>Starting</span><span class="rc-t">started <b data-since="${p.at}">${clock((Date.now() - p.at) / 1000)}</b> ago</span></div>
      <h2 class="rc-name">${esc(plainName(p.label) || 'New fleet job')}</h2><p class="rc-sub">${n0(p.agents || 0)} agents on ${esc(p.repo)}${p.root ? ` (${esc(p.root)})` : ''}. Its timeline appears here as soon as the fleet lists it, in a few seconds.</p></article>`;
  function runView(repo, id) {
    const r = (D.fleet || []).find((x) => x.repo === repo && x.runId === id);
    if (!r && pendingFor(repo, id)) return startingCard(PENDING);
    if (!r) return `<p><a href="#/">All runs</a></p><p>That run is not in the list any more.</p>`;
    if (PENDING && PENDING.runId === id) { log('fleet_listed', { runId: id, ms: Date.now() - PENDING.at }); PENDING = null; }
    const ix = IX[key(r)];
    const ixLine = ix && !ix.error && ix.expected != null && ix.lines > 0 ? `<p class="rc-ix${ix.wasLive ? '' : ix.lines === ix.expected && ix.sorted && !ix.missing && !ix.twice ? ' ok' : ' bad'}"><b>API index (docs/API.md, one line per exported function, written by this job)${ix.wasLive ? ', so far' : ''}:</b> ${n0(ix.lines)} of ${n0(ix.expected)} lines, ${ix.sorted ? 'sorted' : 'not sorted'}, ${ix.missing ? `${n0(ix.missing)} missing` : 'none missing'}, ${ix.twice ? `${n0(ix.twice)} twice` : 'none twice'}.</p>` : '';
    return `<p class="crumb"><a href="#/">All runs</a></p>${card(r, true)}${ixLine}<section class="rsec"><h2>Timeline</h2>${timeline(r, TL[key(r)], DR && DR.k === key(r) ? DR : null)}${drillPanel(r)}</section>`;
  }
  const stepOf = (base) => grouped((D.fleet || []).slice()).find((g) => g.group && g.label === base) || null;
  function stepView(base) {
    const g = stepOf(base);
    if (!g) return `<p><a href="#/">All runs</a></p><p>That ladder step is not in the list any more.</p>`;
    const lad = g.copies[0]?.ladder && TL['ladder:' + g.copies[0].ladder];
    const ts = lad ? [] : g.copies.map((c) => TL[key(c)]), have = lad ? g.copies.length : ts.filter(Boolean).length;
    const t = lad || (have ? summed(ts) : null);
    if (lad) return `<p class="crumb"><a href="#/">All runs</a></p>${card(g, true)}${drillPanel(g)}`;
    return `<p class="crumb"><a href="#/">All runs</a></p>${card(g, true)}<section class="rsec"><h2>Timeline, all ${g.copies.length} copies together</h2>${have < g.copies.length ? `<p class="dim">${have} of ${g.copies.length} copies loaded…</p>` : ''}${timeline(g, t, DR && DR.k === key(g) ? DR : null)}${drillPanel(g)}</section>`;
  }
  // The intent tree (qb5, intents.js bundled in front of this file): a run's folders and files, status rolled up; a step's
  // copies first. intents.js draws inside the mount and keeps its own state (DR and TLS are not touched here).
  const itSrc = (r) => `/api/runs/${encodeURIComponent(r.repo)}/${encodeURIComponent(r.runId)}/intents`;
  function intentsRunView(repo, id, why) {
    const r = (D.fleet || []).find((x) => x.repo === repo && x.runId === id);
    if (!r && pendingFor(repo, id)) return startingCard(PENDING);
    if (!r) return `<p><a href="#/">All runs</a></p><p>That run is not in the list any more.</p>`;
    const base = `#/intents/run/${encodeURIComponent(repo)}/${encodeURIComponent(id)}`;
    return `<p class="crumb"><a href="#/">All runs</a></p><section class="rsec"><h2>${why ? 'Why this exists' : `Intents: ${esc(plainName(r.label) || repo)}`}</h2><p><a class="chipbtn rc-go" href="#/run/${encodeURIComponent(repo)}/${encodeURIComponent(id)}">Timeline</a></p>${why ? '' : '<p class="dim">The job, then its folders; each file is one agent\'s intent. Stuck files come first. Tap a line to open it.</p>'}<div class="it-mount" data-src="${esc(itSrc(r))}" data-runs="/api/runs/${esc(encodeURIComponent(repo))}/${esc(encodeURIComponent(id))}" data-why-href="${esc(base)}/why/{id}" data-tree-href="${esc(base)}"${why ? ` data-why="${esc(why)}"` : ''}></div></section>`;
  }
  function intentsStepView(label) {
    const g = stepOf(label);
    if (!g) return `<p><a href="#/">All runs</a></p><p>That ladder step is not in the list any more.</p>`;
    // Named like the step card (whatIs): "NestJS packages, copy 3 of 22"; counts from counts(), which reads live rows too.
    const copies = g.copies.map((c) => { const k = counts(c), n = c.copyOfKind || repoCopy(c), of = c.copiesOfKind || c.copiesOfRepo || 0;
      return { src: itSrc(c), label: `${srcOf(c).name}${n ? `, copy ${n}${of > 1 ? ` of ${of}` : ''}` : ''}`, sub: `${n0(k.landed)} files got comments, ${n0(k.skipped)} already had them` }; });
    return `<p class="crumb"><a href="#/">All runs</a></p><section class="rsec"><h2>Intents: ${esc(label)}</h2><p><a class="chipbtn rc-go" href="#/step/${encodeURIComponent(label)}">Timeline</a></p><div class="it-mount" data-step="${esc(label)}" data-label="${esc(label)}" data-copies="${esc(JSON.stringify(copies))}"></div></section>`;
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
    const mi = /^#\/intents\/run\/([^/]+)\/([^/]+?)(?:\/why\/(.+))?$/.exec(location.hash), mis = /^#\/intents\/step\/(.+)$/.exec(location.hash);
    const html = mi && window.qbIntentsMount ? intentsRunView(decodeURIComponent(mi[1]), decodeURIComponent(mi[2]), mi[3] ? decodeURIComponent(mi[3]) : null) : mis && window.qbIntentsMount ? intentsStepView(decodeURIComponent(mis[1])) : m ? runView(decodeURIComponent(m[1]), decodeURIComponent(m[2])) : ms ? stepView(decodeURIComponent(ms[1])) : listView();
    const k = html.replace(/(data-since="\d+">)[^<]*/g, '$1');
    if (k === lastHtml || busy) return tickClocks();
    const ctlF = document.activeElement?.closest?.('.rc-ctl') ? document.activeElement.dataset.ctl : null;
    const fr = root.querySelector('.tl-frame'), sx = fr ? fr.scrollLeft : null, atEnd = fr ? fr.scrollLeft + fr.clientWidth >= fr.scrollWidth - 4 : true;
    lastHtml = k; root.innerHTML = html;
    // a live run opens at, and keeps showing, its newest minute; a finished one opens at its start
    const f2 = root.querySelector('.tl-frame'); if (f2) f2.scrollLeft = fr ? (atEnd && 'live' in f2.dataset ? f2.scrollWidth : sx) : ('live' in f2.dataset ? f2.scrollWidth : 0);
    if (ctlF) root.querySelector(`[data-ctl="${ctlF}"]`)?.focus({ preventScroll: true });
    // the New fleet job form is one node kept across refreshes (moving it keeps what is typed and the focus)
    const slot = root.querySelector('#nj-slot'); if (slot && NJ) { const fa = document.activeElement, keep = NJ.contains(fa) ? fa : null; slot.replaceWith(NJ); keep?.focus({ preventScroll: true }); }
    talkActions();
    if (window.qbIntentsMount) window.qbIntentsMount(root);
  }
  function tickClocks() { root.querySelectorAll('[data-since]').forEach((b) => { b.textContent = clock((Date.now() - +b.dataset.since) / 1000); }); }

  async function tick() {
    clearTimeout(timer);
    if (!D && !root.innerHTML) root.innerHTML = '<header class="rh"><h1>Scale runs</h1><p class="rh-s"><i class="live off"></i><span>Loading the runs…</span></p></header>';
    try {
      const first = !D;
      await load(); failures = 0; lastOk = Date.now(); if (!NJ && OWN && !MOCK) { njMount(); lastHtml = ''; } loaded1();
      // The copies list (~4 s) fetched now, so a spoken fleet sentence gets its estimate at once (qb2, 2026-10-14: the
      // question came 7-25 s after the sentence on film).
      if (OWN && !MOCK && !COPIES) njCopies().catch(() => {});
      if (first) render();   // the list at once; timelines fill in as they arrive
      const cur = current();
      if (cur) { if (!(cur.group && (await loadLadder(cur).catch(() => false)))) await loadMany(cur.group ? cur.copies : [cur]); if (!cur.group) await loadIndexCheck(cur).catch(() => {}); }
      else await Promise.all(shownGroups().slice(0, 16).map((g) => loadLadder(g).catch(() => false)));   // the steps on screen, in screen order (qb3: cards kept 'Loading the timeline…')
      render();
    } catch (e) { failures++; log('poll_failed', { error: String(e), failures }); if (!D) root.innerHTML = `<header class="rh"><h1>Scale runs</h1></header><p class="dim">Could not load the runs (${esc(String(e.message || e))}). Trying again.</p>`; }
    const anyLive = (D?.fleet || []).some(live);
    if (PENDING && Date.now() - PENDING.at > 5 * 60e3) PENDING = null;
    timer = setTimeout(tick, !D || PENDING ? 3e3 : document.hidden ? 30e3 : anyLive ? 5e3 : 30e3 * Math.min(4, 2 ** failures));   // nothing on screen yet: try again soon
  }
  addEventListener('hashchange', () => { DR = null; lastHtml = ''; render(); tick(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  setInterval(tickClocks, 1000);

  // Open the moment (column) i of the timeline on screen: by tap, or by voice through Talk's __talkActions (qb2).
  async function openMoment(run, i) {
    if (!TLS || i < 0 || i >= TLS.S.length) return null;
    const s = TLS.S[i]; DR = { k: key(run), i, t: s.minute, to: s.minute + TLS.stepMs, view: 'slice', data: {} };
    log('drill', { kind: 'slice', i }); lastHtml = ''; render(); root.querySelector('.dp')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const [d, cm] = await Promise.all([drillFetch(run, `slice?t=${s.minute}&to=${s.minute + TLS.stepMs}`).catch((x) => ({ error: String(x) })), drillFetch(run, `commits?t=${s.minute}&to=${s.minute + TLS.stepMs}`).catch(() => null)]);
    if (DR && DR.t === s.minute) { DR.data.slice = d; DR.data.commits = cm; lastHtml = ''; render(); }
    return s;
  }
  // '3:20', '3 min 20', 'minute 5', '5 minutes', '30 seconds', '90 s' -> seconds from the run's start (null if none)
  function spokenTime(t) {
    const x = String(t || '').toLowerCase();
    let m = /(\d+)\s*:\s*(\d{1,2})/.exec(x); if (m) return +m[1] * 60 + +m[2];
    m = /(\d+)\s*(?:min(?:ute)?s?)\s*(?:and\s*)?(\d+)\s*(?:s|sec|secs|seconds?)\b/.exec(x); if (m) return +m[1] * 60 + +m[2];
    m = /minute\s+(\d+)|(\d+(?:\.\d+)?)\s*(?:min(?:ute)?s?)\b/.exec(x); if (m) return Math.round(+(m[1] || m[2]) * 60);
    m = /(\d+)\s*(?:s|sec|secs|seconds?)\b/.exec(x); if (m) return +m[1];
    if (/\b(start|beginning)\b/.test(x)) return 0;
    if (/\b(end|last)\b/.test(x) && TLS) return Math.round(((TLS.S.length - 1) * TLS.stepMs) / 1000);
    return null;
  }
  // Talk's fleet-job action. Registered at once (before /api/runs answers, ~4 s on a phone: a sentence said sooner went
  // to the chat lane, which claimed it had opened the build page; found by scripts/talk-e2e runs-take); it waits for the
  // first load and does nothing for a visitor.
  const FLEET_TEXT = 'Start a fleet job: say what to document and where (e.g. every exported function in VS Code\u2019s editor, and add each to the API index)';
  let loaded1 = null; const firstLoad = new Promise((ok) => { loaded1 = ok; });
  async function fleetRun(sentence) {
    await firstLoad; if (!OWN || MOCK) return false;
    if (!NJ) { njMount(); lastHtml = ''; render(); }
      await njCopies(); const pre = njFromSentence(sentence);
      if (!pre.repo) return false;
      if (location.hash && location.hash !== '#/') location.hash = '#/';
      await njToggle(true, pre); log('talk_fleet_job', { sentence: String(sentence).slice(0, 120), repo: pre.repo, root: pre.root || null, job: pre.job || 'comments' });
      const o = NJ.querySelector('#nj-copy').selectedOptions[0];
      return `Ready to start ${pre.job === 'comments+index' && COPIES.jobs.includes('comments+index') ? 'doc comments and the API index' : 'doc comments'} on ${o?.dataset.name || pre.repo}${pre.root ? ` (${pre.root})` : ''}. Check the estimate and tap Start.`;
  }
  function talkActions() {
    const run = current();
    const fleetAction = OWN && NJ ? [{ id: 'fleet-job', text: FLEET_TEXT, run: fleetRun }] : [];
    if (!run || !TLS || !root.querySelector('.tl-in:not(.tl-frame.mini .tl-in)')) { if (fleetAction.length) window.__talkActions = fleetAction; else delete window.__talkActions; return; }
    if (!run || !TLS || !root.querySelector('.tl-in:not(.tl-frame.mini .tl-in)')) { delete window.__talkActions; return; }
    window.__talkActions = [{ id: 'moment', text: 'Open the moment of this run\u2019s timeline at a time (say it like 3:20 or minute 5)', run: async (sentence) => {
      const sec = spokenTime(sentence); if (sec == null || !TLS) return false;
      const i = Math.max(0, Math.min(TLS.S.length - 1, Math.floor((sec * 1000) / TLS.stepMs)));
      const s = await openMoment(current(), i); if (!s) return false;
      const raw = s.raw || {}, from = clock((s.minute - TLS.t0) / 1000), to = clock((s.minute - TLS.t0 + TLS.stepMs) / 1000);
      log('talk_moment', { sentence: String(sentence).slice(0, 80), i });
      return `Opened ${from} to ${to}: ${s.active != null ? `${n0(s.active)} agents at work, ` : ''}${n0(raw.landed || 0)} changes reached main.`;
    } }, ...fleetAction];
  }
  root.addEventListener('toggle', (e) => { const d = e.target; if (d.matches?.('.rcp-more, .rcp-repo')) { if (d.open) openCopies.add(d.dataset.g); else openCopies.delete(d.dataset.g); } }, true);
  // Taps on the timeline and in the drill-down panel.
  root.addEventListener('click', async (e) => {
    const run = current();
    const tin = e.target.closest('.tl-in');
    if (tin && tin.closest('.tl-frame.mini')) { const k = tin.closest('.rc')?.querySelector('a.rc-go[href^="#/step/"]'); if (k) location.hash = k.getAttribute('href'); return; }
    if (tin && run && TLS) { openMoment(run, Math.floor((e.clientX - tin.getBoundingClientRect().left) / TLS.per)); return; }
    const dr = e.target.closest('[data-dr]');
    if (dr && run && DR) {
      const a = dr.dataset.dr;
      if (a === 'close') { DR = null; lastHtml = ''; render(); return; }
      if (a === 'slice') { DR.view = 'slice'; DR.agent = null; DR.sha = null; lastHtml = ''; render(); return; }
      if (a === 'agent') {
        DR.view = 'agent'; DR.agent = dr.dataset.agent; lastHtml = ''; render(); log('drill', { kind: 'agent' });
        const k = 'a:' + DR.agent; if (!DR.data[k]) { const d = await drillFetch(run, `agent/${encodeURIComponent(DR.agent)}`).catch((x) => ({ error: String(x) })); if (DR) { DR.data[k] = d; lastHtml = ''; render(); } }
        return;
      }
      if (a === 'commit') {
        DR.view = 'commit'; DR.sha = dr.dataset.sha; lastHtml = ''; render(); log('drill', { kind: 'commit' });
        const k = 'c:' + DR.sha; if (!DR.data[k]) { const d = await drillFetch(run, `commit/${encodeURIComponent(DR.sha)}`).catch((x) => ({ error: String(x) })); if (DR) { DR.data[k] = d; lastHtml = ''; render(); } }
        return;
      }
      if (a === 'change') {
        DR.view = 'change'; DR.file = dr.dataset.file; if (dr.dataset.agent) DR.agent = dr.dataset.agent; if (dr.dataset.sha) DR.sha = dr.dataset.sha; lastHtml = ''; render(); log('drill', { kind: 'change' });
        const k = 'f:' + DR.file; if (!DR.data[k]) { const d = await drillFetch(run, `change?file=${encodeURIComponent(DR.file)}${DR.sha ? `&sha=${encodeURIComponent(DR.sha)}` : ''}`).catch((x) => ({ error: String(x) })); if (DR) { DR.data[k] = d; lastHtml = ''; render(); } }
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

  // ---- New fleet job (owner; qb7, src/fleetjob.ts): pick a copy, the job, agents and a budget, see the estimate, start.
  // The form lives in its own section above the list, outside the 5 s re-render, so typing is never wiped. Talk fills it
  // from a sentence ('document every exported function in VS Code's editor and add each one to the API index').
  let NJ = null, COPIES = null, njEst = 0; const njCount = {};
  const VS_AREAS = ['editor', 'workbench', 'base', 'platform', 'code', 'server'];
  const RESERVED_TAKE = 'fleet-n2-vscode-src-1';
  function njMount() {
    if (!OWN || NJ || MOCK) return;
    NJ = document.createElement('section'); NJ.id = 'nj'; NJ.className = 'nj';   // placed into #nj-slot by render()
    NJ.innerHTML = '<button type="button" class="btn nj-open" aria-expanded="false" aria-controls="nj-f">New fleet job</button><form class="nj-f" id="nj-f" hidden></form>';
    NJ.querySelector('.nj-open').onclick = () => njToggle();
  }
  let copiesP = null;   // one request at a time: the prefetch at load and Talk's fleet sentence share it
  async function njCopies() {
    if (COPIES) return COPIES;
    if (copiesP) return copiesP;
    copiesP = njCopies1().finally(() => { copiesP = null; });
    return copiesP;
  }
  async function njCopies1() {
    const r = await fetch(`${API}/copies`, { cache: 'no-store', credentials: 'same-origin' }).catch(() => null);
    const j = r && r.ok ? await r.json().catch(() => ({})) : {};
    COPIES = { copies: (j.copies || []).slice().sort((a, b) => (b.fresh - a.fresh) || String(a.repo).localeCompare(String(b.repo))), jobs: j.jobs || ['comments'], error: j.error || (!r || !r.ok ? 'Could not list the copies.' : '') };
    return COPIES;
  }
  // What the form holds (qb3's real take started with the defaults, 200 agents / $3, after Talk had filled 1,000 / $5): kept
  // here and put back whenever the form is drawn again (a second open, a tap on the button, two opens racing over the
  // copies fetch). Talk's values are kept before the await; a start clears them.
  let NJV = null;
  async function njToggle(open, pre) {
    if (pre) NJV = { ...pre, rootTouched: !!pre.root };
    const f = NJ.querySelector('form'), b = NJ.querySelector('.nj-open');
    const on = open ?? f.hidden; f.hidden = !on; b.setAttribute('aria-expanded', String(on)); b.textContent = on ? 'Close' : 'New fleet job'; b.className = on ? 'chipbtn nj-open' : 'btn nj-open';
    if (!on) return;
    const c = await njCopies();
    const idx = c.jobs.includes('comments+index');
    f.innerHTML = `<h2 class="nj-h">New fleet job</h2>${c.error ? `<p class="rc-cn bad">${esc(c.error)}</p>` : ''}
      <label class="nj-l" for="nj-copy">Copy to work on</label><select id="nj-copy">${c.copies.map((x) => `<option value="${esc(x.repo)}" data-root="${esc(x.source?.root || '')}" data-files="${x.files || 0}" data-name="${esc(x.source?.name || x.repo)}">${esc(x.source?.name || x.repo)} (${esc(x.repo)})${x.reserved ? ', reserved' : ''}${x.fresh ? '' : ', already documented'}</option>`).join('')}</select>
      <label class="nj-l" for="nj-root">Folder</label><input id="nj-root" autocapitalize="none" spellcheck="false">
      <fieldset class="nj-g"><legend>Job</legend><label><input type="radio" name="nj-job" value="comments" checked> Doc comments on every exported function</label><label><input type="radio" name="nj-job" value="comments+index"${idx ? '' : ' disabled'}> Doc comments and a line for each in docs/API.md${idx ? '' : ' <small>(coming)</small>'}</label></fieldset>
      <div class="nj-row"><label class="nj-l" for="nj-agents">Agents<input id="nj-agents" type="number" inputmode="numeric" min="1" max="2000" step="1" value="200"></label><label class="nj-l" for="nj-budget">Budget, $<input id="nj-budget" type="number" inputmode="decimal" min="0.1" max="30" step="any" value="3"></label></div>
      <fieldset class="nj-g"><legend>Who writes the comments</legend><label><input type="radio" name="nj-model" value="workers" checked> Workers AI models (Gemma 4 and GLM 4.7)</label><label><input type="radio" name="nj-model" value="cache"> The cache (answers reused, no model, free)</label></fieldset>
      <div class="nj-est" id="nj-est" role="status" aria-live="polite">Pick a copy.</div>
      <div class="rc-ctl"><button type="submit" class="btn" id="nj-go">Start</button><button type="button" class="chipbtn" id="nj-x">Cancel</button></div>
      <p class="rc-cn" id="nj-msg"></p>`;
    const $ = (id) => f.querySelector('#' + id);
    const sel = $('nj-copy'), rootI = $('nj-root');
    const pickCopy = () => { const o = sel.selectedOptions[0]; if (o && !rootI.dataset.touched) rootI.value = o.dataset.root; };
    const drawnFrom = pre ? 'talk' : NJV ? 'kept' : 'defaults'; pre = pre || NJV;
    if (pre) { if (pre.repo) sel.value = pre.repo; if (pre.root) { rootI.value = pre.root; if (pre.rootTouched !== false) rootI.dataset.touched = '1'; } if (pre.job && idx) f.querySelector(`[name=nj-job][value="${pre.job}"]`).checked = true; if (pre.agents) $('nj-agents').value = pre.agents; if (pre.budgetUsd) $('nj-budget').value = pre.budgetUsd; if (pre.preset) f.querySelector(`[name=nj-model][value="${pre.preset}"]`).checked = true; }
    pickCopy();
    const keep = () => { const v = njBody(); NJV = { repo: v.repo, root: rootI.value.trim(), rootTouched: !!rootI.dataset.touched, job: v.job, agents: v.agents, budgetUsd: v.budgetUsd, preset: v.preset };
      const go = $('nj-go'); if (go && !go.disabled) go.textContent = `Start ${n0(v.agents || 0)} agent${v.agents === 1 ? '' : 's'}`; };
    sel.onchange = () => { rootI.dataset.touched = ''; pickCopy(); keep(); njEstimate(); };
    rootI.oninput = () => { rootI.dataset.touched = '1'; keep(); njEstimate(); };
    f.oninput = (e) => { keep(); if (e.target !== rootI) njEstimate(); };
    $('nj-x').onclick = () => njToggle(false);
    f.onsubmit = async (e) => { e.preventDefault(); const b2 = njBody(); const go = $('nj-go'), msg = $('nj-msg'); go.disabled = true; go.textContent = `Starting ${n0(b2.agents || 0)} agents…`; msg.textContent = (b2.agents || 0) >= 200 ? 'Starting every agent takes up to a minute for a big job.' : ''; msg.className = 'rc-cn';
      let r, j = {};
      try { r = await fetch(`${API}/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(b2) }); j = await r.json().catch(() => ({})); } catch (x) { r = { ok: false }; }
      log('fleet_start', { ok: !!r.ok, repo: b2.repo, agents: b2.agents, runId: j.runId || null, error: j.error || null });
      go.disabled = false; keep();
      if (!r.ok || !j.runId) { msg.className = 'rc-cn bad'; msg.textContent = j.error || 'Could not start it. Try again.'; return; }
      // qb3's rehearsal: the new run is not in /api/runs for a while; show it as starting and poll until it is
      PENDING = { repo: j.repo || b2.repo, runId: j.runId, at: Date.now(), agents: b2.agents, root: b2.root || '', label: b2.label || '' };
      log('fleet_pending', { repo: PENDING.repo, runId: PENDING.runId });
      NJV = null; njToggle(false); COPIES = null; location.hash = `#/run/${encodeURIComponent(PENDING.repo)}/${encodeURIComponent(j.runId)}`; tick(); };
    keep(); njEstimate();
    log('nj_drawn', { from: drawnFrom, agents: NJV && NJV.agents, budget: NJV && NJV.budgetUsd });
    setTimeout(() => f.scrollIntoView({ block: 'start', behavior: 'smooth' }), 30);
  }
  function njBody() {
    const f = NJ.querySelector('form'), o = f.querySelector('#nj-copy').selectedOptions[0];
    const rootV = f.querySelector('#nj-root').value.trim();
    const cp = (COPIES?.copies || []).find((x) => x.repo === o?.value);
    // a copy without a count (qbfleet2's copies: files null) at its own root: every copy of the same project and root has
    // the same files, so take a sibling's count (a /count walk of src/vs takes ~50 s)
    // (/copies' files can be what a copy's last run covered, so the largest sibling count is the whole folder)
    const sib = cp && cp.files == null && rootV === cp.source?.root ? { files: Math.max(0, ...(COPIES?.copies || []).filter((x) => x.files && x.source?.name === cp.source?.name && x.source?.root === cp.source?.root).map((x) => x.files)) } : null;
    return { repo: o?.value || '', root: rootV, files: (o && rootV === o.dataset.root ? +o.dataset.files : 0) || sib?.files || (cp?.folders || {})[rootV] || njCount[`${o?.value}:${rootV}`] || 0, job: f.querySelector('[name=nj-job]:checked')?.value || 'comments',
      agents: +f.querySelector('#nj-agents').value || 200, budgetUsd: +f.querySelector('#nj-budget').value || 3, preset: f.querySelector('[name=nj-model]:checked')?.value || 'workers',
      label: `${o?.dataset.name || ''}${rootV && rootV !== o?.dataset.root ? ` ${rootV.split('/').pop()}` : ''}: ${f.querySelector('[name=nj-job]:checked')?.value === 'comments+index' ? 'doc comments + API index' : 'doc comments'}` };
  }
  async function njEstimate() {
    const my = ++njEst, box = NJ?.querySelector('#nj-est'); if (!box) return log('nj_estimate', { step: 'no_box' });
    let b2; try { b2 = njBody(); } catch (e) { log('nj_estimate', { step: 'body_failed', error: String(e) }); return; }
    log('nj_estimate', { step: 'start', my, repo: b2.repo, root: b2.root, files: b2.files });
    if (!b2.repo) { box.textContent = 'Pick a copy.'; return; }
    await new Promise((z) => setTimeout(z, 250)); if (my !== njEst) return log('nj_estimate', { step: 'superseded', my, now: njEst });
    if (!b2.files && b2.root) {   // a subfolder: count its files (qbfleet /count through the proxy), once per folder
      const k = `${b2.repo}:${b2.root}`;
      if (!(k in njCount)) { njCount[k] = 0; box.textContent = `Counting the files in ${b2.root}…`; const r0 = await fetch(`${API}/count?repo=${encodeURIComponent(b2.repo)}&root=${encodeURIComponent(b2.root)}`, { credentials: 'same-origin' }).catch(() => null); const j0 = r0 && r0.ok ? await r0.json().catch(() => ({})) : {}; if (j0.files) { njCount[k] = j0.files; return njEstimate(); } }
    }
    if (!b2.files) { box.innerHTML = `<b>${n0(b2.agents)} agents</b> on ${esc(b2.root || 'the copy')}. The number of files in a subfolder is counted when it starts; the budget stops it at <b>${usd(Math.min(30, b2.budgetUsd))}</b>.`; return; }
    const r = await fetch(`${API}/estimate`, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(b2) }).catch(() => null);
    const e = r && r.ok ? await r.json().catch(() => null) : null; if (my !== njEst) return;
    box.innerHTML = !e || e.error ? esc(e?.error || 'No estimate right now.') : `<b>${n0(e.files)} files</b>, ${n0(e.agents)} agents: about <b>${e.minutes[0]} to ${e.minutes[1]} min</b> and <b>${usd(e.usd[0])} to ${usd(e.usd[1])}</b>. It stops at ${usd(e.capUsd)} whatever happens.${e.note ? ` ${esc(e.note)}` : ''}`;
  }
  // Talk (qb2): 'document every exported function in VS Code's editor and add each one to the API index' -> the form,
  // filled in, with its estimate: the person checks it and taps Start (Talk never starts a job by itself).
  // 'with a thousand agents' -> 'with 1000 agents'; '2.5k' -> 2500; runs of number words become one number
  const NW = { zero: 0, a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  function spokenNums(t) {
    let x = String(t || '').toLowerCase().replace(/(\d+(?:\.\d+)?)\s*k\b/g, (m, n) => String(Math.round(+n * 1000))).replace(/(\d[\d,]*)\s+(thousand|hundred)\b/g, (m, n, w) => String(+n.replace(/,/g, '') * (w === 'thousand' ? 1000 : 100)));
    return x.replace(/\b((?:(?:a|an|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)(?:[\s-]+(?:and\s+)?)?)+)(?=\s*(?:agents?|dollars?|bucks)\b)/g, (m) => {
      const ws = m.trim().split(/[\s-]+/).filter((w) => w !== 'and');
      if (!ws.some((w) => w !== 'a' && w !== 'an')) return m;   // 'an agent' stays
      let total = 0, cur = 0;
      for (const w of ws) { if (w === 'hundred') cur = (cur || 1) * 100; else if (w === 'thousand') { total += (cur || 1) * 1000; cur = 0; } else cur += NW[w] ?? 0; }
      return `${total + cur} `;
    });
  }
  function njFromSentence(t) {
    const x = String(t || '').toLowerCase(), pre = {};
    const kinds = [[/vs ?code|visual studio code/, /extension/.test(x) ? 'VS Code extensions' : 'VS Code'], [/nest/, 'NestJS'], [/angular/, 'Angular'], [/next(\.js|js)?\b/, 'Next.js'], [/babel/, 'Babel']];
    const want = (kinds.find(([re]) => re.test(x)) || [])[1];
    // area words only outside the project's name ('VS Code' itself must not read as the src/vs/code area)
    const rest = x.replace(/vs ?code|visual studio code/g, ' ');
    const area = want === 'VS Code' && VS_AREAS.find((a) => new RegExp(`\\b${a}\\b`).test(rest));
    // the exact project name (VS Code is not VS Code extensions); an area like 'editor' needs a src/vs copy; fresh first
    const cs = (COPIES?.copies || []).filter((c) => !want || (c.source?.name || '').toLowerCase() === want.toLowerCase()).filter((c) => !area || String(c.source?.root || '').startsWith('src/vs'));
    // a copy qbfleet marks reserved (the recording's take) first, then any fresh one. RESERVED_TAKE: the 3a take on
    // 2026-10-14 (qb2/qb3) until /copies carries reserved; drop it after the recording.
    const c = cs.find((y) => y.reserved && y.fresh) || cs.find((y) => y.repo === RESERVED_TAKE && y.fresh) || cs.find((y) => y.fresh) || cs[0];
    if (c) { pre.repo = c.repo; if (area) pre.root = `src/vs/${area}`; }
    if (/api index|index|api\.md/.test(x)) pre.job = 'comments+index';
    // spoken numbers too (qb3's take: Talk heard 'with a thousand agents' and the form kept 200): 'a thousand', 'one
    // thousand', 'two hundred and fifty', '1k', 'five dollars'
    const xs = spokenNums(x);
    const ag = /([\d,]+)\s*agents/.exec(xs); if (ag) pre.agents = Math.min(2000, +ag[1].replace(/,/g, ''));
    const bd = /\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:dollars?|bucks)|budget (?:of |to |at )?(\d+(?:\.\d+)?)/.exec(xs); if (bd) pre.budgetUsd = Math.min(30, +(bd[1] || bd[2] || bd[3]));
    if (/\bcache\b|for free/.test(x)) pre.preset = 'cache';
    if (!pre.budgetUsd && (pre.agents || 0) >= 500) pre.budgetUsd = 5;   // a big run gets room: small batches cost more per file
    return pre;
  }

  // A tab left open keeps polling JSON with the code it loaded; when a new version is deployed, reload (not while the
  // person is in a drill-down or has a stop confirm open).
  let ver = null;
  setInterval(async () => {
    try { const v = (await (await fetch('/version.json', { cache: 'no-store' })).json()).version; if (ver && v && v !== ver && !DR && !Object.keys(stopAsk).length) { log('reload_new_version', { from: ver, to: v }); location.reload(); } ver = ver || v; } catch (e) {}
  }, 120e3);
  fetch('/version.json', { cache: 'no-store' }).then((r) => r.json()).then((j) => { ver = j.version; }).catch(() => {});
  if (!MOCK && !window.__talkActions) window.__talkActions = [{ id: 'fleet-job', text: FLEET_TEXT, run: fleetRun }];   // until the first load
  if (!MOCK && !D) { const c = cached(); if (c) { D = c; log('cached_paint', { rows: (c.fleet || []).length }); render(); D = null; lastHtml = ''; window.__talkActions = [{ id: 'fleet-job', text: FLEET_TEXT, run: fleetRun }]; } }
  tick();
})();
