// "Agents at work" (qb7, docs/contest/ui.md): many agents changing one project at once,
// for people who are not programmers. Overview first (numbers in words, the merge queue as
// a train, a map of who works where, a feed of plain sentences); tap anything to drill down
// (area -> file -> change). Hash routes, so Back always works.
// Mount: <div id="lw" data-src="<GET /landing URL>" data-name="hono" [data-own] [data-mock] [data-api="/api/p/o/n"]>
// Data: the qb6/qb7 contract in docs/contest/PLAN.md. data-mock plays public/landing-mock.json.
(() => {
  const root = document.getElementById('lw');
  if (!root) return;
  const NAME = root.dataset.name || 'this project', OWN = 'own' in root.dataset, API = root.dataset.api || '';
  // ?mock=1 on any project plays the sample data instead of the real endpoint.
  const MOCK = 'mock' in root.dataset || new URLSearchParams(location.search).has('mock');
  const SRC = MOCK && !('mock' in root.dataset) ? '/landing-mock.json' : root.dataset.src;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const n0 = (x) => Math.round(x).toLocaleString('en-US');
  const log = (event, extra) => { try { console.log(JSON.stringify({ ts: new Date().toISOString(), module: 'landingui', event, ...extra })); } catch {} };

  // ---- words -----------------------------------------------------------------
  const GLOSS = {
    agent: ['Agent', 'An AI that writes code. Here every agent works on its own copy of the project, so two agents never type into the same file at the same time.'],
    fork: ['Fork', 'An agent\'s own copy of the project. It works there, and its change is copied back into the main code only after it passes.'],
    main: ['Main', 'The real, shared version of the code: what the app runs. Changes "land" when they are added to it.'],
    queue: ['The line (merge queue)', 'Finished changes wait here to be tested together, a few at a time, before they join the main code. If the tests fail, the change is sent back and main stays healthy.'],
    train: ['Train', 'A group of changes from the line that are tested together. If the tests pass, they all land at once.'],
    collision: ['Collision (conflict)', 'Two agents changed the same lines of the same file. Usually the second one has to start over. Here it does not have to: see "replayed".'],
    replay: ['Replayed', 'When a change collides with newer code, qodebase re-applies what the change was meant to do (its intent) on the newest version, instead of throwing the work away. Then it is tested again.'],
    claim: ['Claim', 'Before an agent starts, it says which files it expects to touch. Others can see the claims and avoid stepping on each other.'],
    stack: ['Stacked', 'A change that builds on another change that has not landed yet. They land in order.'],
    lead: ['Lead', 'When no rule can replay a change, it goes to a lead (an agent or a person responsible for that part of the code) who decides how to combine both changes.'],
    review: ['Review', 'Another agent reads the change and approves it or asks for fixes before it can join the line.'],
    scripted: ['Scripted agents', 'In this demo the agents follow a script instead of calling an AI model, so it costs nothing to run. Everything else is real: real git commits on real forks, real collisions, real tests.'],
  };
  const term = (k, text) => `<button class="term" type="button" data-gloss="${k}">${esc(text || GLOSS[k][0].toLowerCase())}</button>`;

  const AG = (a) => { const m = /(\d+)\D*$/.exec(a || ''); return m && /agent/i.test(a) ? `Agent ${m[1]}` : String(a || 'an agent'); };
  const leadName = (l) => { const x = (l || '').replace(/^agent-(\d+)/i, 'Agent $1'); return /^(scripted )?lead$/i.test(x) ? 'its lead' : x; };
  const ready = (c) => c.state === 'pushed' && c.review && c.review.verdict !== 'changes';
  const skey = (c) => (ready(c) ? 'ready' : c.state);
  const WORD = { working: 'Working', pushed: 'Waiting for review', ready: 'Ready to merge', reviewing: 'Being reviewed', queued: 'In line', testing: 'Being tested', landed: 'Landed', bounced: 'Sent back', replaying: 'Replaying', 'with-lead': 'With its lead' };
  const st = (c) => `<span class="st s-${skey(c)}"><i class="dot"></i><span class="w">${WORD[skey(c)] || esc(c.state)}</span></span>`;
  // Real ids are '<owner>.<name>--<id>': people see the short part.
  const ref = (id) => `#${esc(String(id).split('--').pop())}`;
  const short = (c) => (c ? esc(c.title || c.intent.slice(0, 60)) : '');
  const files = (ps) => ps.map((p) => `<span class="mono">${esc(p)}</span>`).join(', ');

  // ---- time --------------------------------------------------------------------
  let D = null, fetchedAt = 0;
  const now = () => (D ? D.now + (Date.now() - fetchedAt) * (MOCK ? MSPEED : 1) : Date.now());
  const agoTxt = (t) => { const s = Math.max(0, Math.round((now() - t) / 1000)); return s < 5 ? 'just now' : s < 60 ? `${s} s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`; };
  // Times are spans the tick updates in place (render() ignores their text when deciding to rebuild).
  const ago = (t) => `<span data-ago="${t}">${agoTxt(t)}</span>`;
  const since = (t) => `<span data-since="${t}">${secs(now() - t)}</span>`;
  const secs = (ms) => (ms < 90e3 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60e3)} min`);
  const hhmm = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

  // ---- mock playback: the mock's future events and trains, revealed over time -------
  const STATE = { asked: 'working', claimed: 'working', working: 'working', stacked: 'working', 'changes-suggested': 'working', pushed: 'pushed', approved: 'pushed', reviewing: 'reviewing', queued: 'queued', replayed: 'queued', testing: 'testing', landed: 'landed', bounced: 'bounced', replaying: 'replaying', 'with-lead': 'with-lead' };
  let M = null, playFrom = 0;
  const MSPEED = Math.min(20, Math.max(0.25, +new URLSearchParams(location.search).get('mockspeed') || 1));
  function mockAt() {
    const [a, b] = M.mock.playS, span = (b - a) * 1000;
    const T = M.now + a * 1000 + (((Date.now() - playFrom) * MSPEED) % span);
    const landedNow = M.changes.filter((c) => c.state === 'landed').length;
    const changes = M.changes.map((c) => {
      const ev = [...c.events, ...(c.future || [])].filter((e) => e.t <= T);
      if (!ev.length) return null;
      const state = ev.reduce((s, e) => STATE[e.what] || s, 'working');
      const landed = ev.find((e) => e.what === 'landed');
      const rv = ev.some((e) => e.what === 'approved' || e.what === 'changes-suggested') ? c.review : null;
      const landing = c.landing ? { ...c.landing, how: landed ? (c.landing.how || 'merged') : null, mainCommit: landed ? c.landing.mainCommit : null } : null;
      return { ...c, events: ev, state, review: rv, landing: ['pushed', 'working', 'reviewing'].includes(state) && !landed ? null : landing, landedAt: landed ? landed.t : null, lead: state === 'with-lead' ? c.lead : null };
    }).filter(Boolean);
    const trains = M.mock.trains.filter((t) => t.startedAt <= T).map((t) => ({ ...t, state: T < t.endedAt ? 'testing' : t.checks.ok ? 'landed' : 'bounced' }));
    const inTrain = new Set(trains.filter((t) => t.state === 'testing').flatMap((t) => t.changes));
    const lastQ = (c) => [...c.events].reverse().find((e) => e.what === 'queued' || e.what === 'replayed')?.t || 0;
    const waiting = changes.filter((c) => c.state === 'queued' && !inTrain.has(c.id)).sort((x, y) => lastQ(x) - lastQ(y)).map((c) => c.id);
    const landed = changes.filter((c) => c.state === 'landed').length;
    return { ...M, now: T, changes, queue: { trains, waiting },
      stats: { ...M.stats, landedToday: M.stats.landedToday - landedNow + landed, inQueue: waiting.length + inTrain.size, replayed: M.stats.replayed - 1 + (changes.find((c) => c.id === '115')?.events.some((e) => e.what === 'replayed') ? 1 : 0) } };
  }

  // ---- data ----------------------------------------------------------------------
  let failures = 0;
  async function load() {
    if (MOCK) {
      if (!M) { M = await fetch(SRC, { cache: 'no-store' }).then((r) => r.json()); playFrom = Date.now(); }
      D = mockAt(); fetchedAt = Date.now(); return;
    }
    const r = await fetch(SRC, { cache: 'no-store', credentials: 'same-origin' });
    if (r.status === 404) { D = null; throw Object.assign(new Error('none'), { none: true }); }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    D = await r.json(); fetchedAt = Date.now();
    // Trains that failed for infrastructure reasons carry a note (qb6): not part of the story.
    D.queue.trains = D.queue.trains.filter((t) => !t.note);
  }
  const byId = () => new Map(D.changes.map((c) => [c.id, c]));
  const isRoot = (p) => p === '.' || p === '/' || p === '';
  const areaOf = (p) => {
    const a = D.areas.map((x) => x.path).filter((x) => !isRoot(x) && (p === x || p.startsWith(`${x}/`))).sort((x, y) => y.length - x.length)[0];
    return a || (p.includes('/') ? p.split('/')[0] : (D.areas.find((x) => isRoot(x.path))?.path ?? '.'));
  };
  const areaLabel = (p) => (isRoot(p) ? 'top-level files' : p);
  const active = (c) => !['landed', 'bounced'].includes(c.state);

  // The other change in a collision or overlap: named in the detail (a full id or #short id),
  // else the newest change by another agent that landed on the same file before it.
  function otherOf(c, e, idx) {
    const d = e.detail || '';
    for (const x of idx.values()) if (x.id !== c.id && (d.includes(x.id) || new RegExp(`#${String(x.id).split('--').pop().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(d))) return x;
    if (e.what !== 'conflict') return null;
    const paths = conflictPaths(c, e);
    return [...idx.values()].filter((x) => x.agent !== c.agent && x.landedAt && x.landedAt <= e.t && x.files.some((p) => paths.includes(p))).sort((a, b) => b.landedAt - a.landedAt)[0] || null;
  }
  // ---- plain-language sentences ---------------------------------------------------------
  function sentence(c, e, idx) {
    const who = AG(c.agent), T = short(c);
    let d = (e.detail || '').replace(/\bagent-(\d+)/gi, 'Agent $1');
    for (const x of idx.values()) if (d.includes(x.id)) d = d.split(x.id).join(`${AG(x.agent)}'s change`);
    const its = `${who}'s change`;
    const oc = otherOf(c, e, idx);
    switch (e.what) {
      case 'asked': return [`${who} started a change`, T];
      case 'claimed': return [`${who} claimed the files it will change`, d];
      case 'overlap': return [`Heads-up: ${who} and ${oc ? AG(oc.agent) : 'another agent'} plan to touch the same file`, d];
      case 'stacked': return [`${who} is building on ${c.stackedOn && idx.get(c.stackedOn) ? AG(idx.get(c.stackedOn).agent) + "'s change" : 'another change'} before it lands`, T];
      case 'working': return null;
      case 'pushed': return [`${who} finished and sent it for review`, T];
      case 'reviewing': return null;
      case 'approved': return [`${its} passed review`, T];
      case 'changes-suggested': return [`The reviewer asked ${who} for a fix`, d || (c.review && c.review.notes)];
      case 'queued': return [`${its} joined the line`, T];
      case 'testing': return null; // trains say this once for all their changes
      case 'conflict': return [`${its} collided with ${oc ? `${AG(oc.agent)}'s` : 'newer code'}`, d];
      case 'replaying': return [`Replaying ${its} on the newest code instead of sending it back`, d];
      case 'replayed': return [`${its} replayed cleanly and went back in line`, T];
      case 'with-lead': return [`${its} needs ${leadName(c.lead) || 'its lead'} to decide`, d];
      case 'bounced': return [`${its} was sent back: a test failed`, T];
      case 'landed': {
        const rp = c.landing && /^replayed/.test(c.landing.how || '');
        return rp ? [`${its} landed after a replay`, `${T}: it collided on ${(c.landing.conflicts || []).join(', ')}, was re-applied on the newest code, and passed the tests.`] : [`${its} landed on main`, T];
      }
      default: return [`${its}: ${e.what}`, d];
    }
  }
  function feedItems() {
    const idx = byId(), out = [];
    for (const c of D.changes) for (const e of c.events) { const s = sentence(c, e, idx); if (s) out.push({ t: e.t, c, e, s }); }
    for (const tr of D.queue.trains) out.push({ t: tr.startedAt, train: tr, s: [tr.changes.length > 1 ? `Testing ${tr.changes.length} changes together` : 'Testing one change', `${tr.changes.map((id) => (idx.get(id) ? AG(idx.get(id).agent) : ref(id))).join(', ')}, on the newest main`], key: `${tr.id}s` });
    return out.sort((a, b) => b.t - a.t);
  }

  // ---- overview -------------------------------------------------------------------------------
  function demoStrip() {
    if (MOCK) return `<div class="demo"><i class="live"></i><span><b>Sample data</b>, played in a loop: how ${term('scripted', 'scripted agents')} look at work on a project.</span></div>`;
    if (D.mode !== 'demo') return '';
    const on = !D.demo || D.demo.running;
    const ctl = OWN && !MOCK ? `<button class="chipb" type="button" data-demo="${on ? 'stop' : 'start'}">${on ? 'Stop' : 'Start'}</button>` : '';
    return `<div class="demo"><i class="live${on ? '' : ' off'}"></i><span><b>Demo</b> with ${D.demo ? D.demo.agents : ''} ${term('scripted', 'scripted agents')}. Commits, collisions and tests are real.</span>${ctl}</div>`;
  }
  function numbers() {
    const s = D.stats;
    // One row of words: the numbers support the picture below, they are not the picture.
    return `<div class="nums">
      <span><b>${n0(s.landedToday)}</b> landed today</span>
      <span><b>${n0(s.inQueue)}</b> in ${term('queue', 'the line')}</span>
      <a href="#/replayed"><b>${n0(s.replayed)}</b> ${term('replay', 'replayed')}, not thrown away</a>
      <span><b>${s.medianAskToLandS ? secs(s.medianAskToLandS * 1000) : '–'}</b> ask to landed, typical</span></div>`;
  }
  // Things that just happened pulse once. innerHTML is replaced every tick, so an animation
  // keeps its place with a negative delay = how long ago it was first seen.
  const firstSeen = new Map();
  const PULSE = 1800;
  function pulse(key) {
    if (!firstSeen.has(key)) firstSeen.set(key, firstPaint ? -1e9 : Date.now());
    const age = Date.now() - firstSeen.get(key);
    return age < PULSE ? ` style="animation-delay:-${age}ms"` : null;
  }
  const car = (c, id) => `<button class="car${c && c.state === 'replaying' ? ' rp' : ''}" type="button" data-car="${esc(id)}" data-go="#/change/${esc(id)}" aria-label="${c ? `${AG(c.agent)}: ${short(c)}` : `Change ${esc(id)}`}">${c ? AG(c.agent) : ref(id)}<small>${c ? short(c) : ''}</small></button>`;
  // A long line shows its front and a "+N more" that opens the whole line.
  const capped = (cars, max) => (cars.length <= max ? cars.join('') : cars.slice(0, max).join('') + `<a class="car more" href="#/line">+${cars.length - max}<small>more</small></a>`);
  function theLine(full) {
    const idx = byId();
    const testing = D.queue.trains.filter((t) => t.state === 'testing');
    const replaying = D.changes.filter((c) => c.state === 'replaying');
    const parts = testing.map((t) => {
      const el = now() - t.startedAt, typical = 42e3, sp = MOCK ? MSPEED : 1;
      return `<div class="train"><div class="cars">${capped(t.changes.map((id) => car(idx.get(id), id)), full ? 99 : 8)}</div><div class="prog"><i style="animation-duration:${Math.round(typical / sp)}ms;animation-delay:-${Math.round(Math.min(el, typical - 1) / sp)}ms"></i></div><div class="lbl"><b>Being tested</b> ${since(t.startedAt)}</div></div>`;
    });
    const wait = [...D.queue.waiting.map((id) => car(idx.get(id), id)), ...replaying.map((c) => car(c, c.id))];
    if (wait.length) parts.push(`<div class="wait"><div class="cars">${capped(wait, full ? 999 : 10)}</div><div class="lbl">${D.queue.waiting.length} waiting${replaying.length ? `, ${replaying.length} replaying` : ''}</div></div>`);
    const lastLand = D.queue.trains.filter((t) => t.state === 'landed').sort((x, y) => y.endedAt - x.endedAt)[0];
    const landP = lastLand ? pulse(`train:${lastLand.id}`) : null;
    const track = parts.length || landP ? `<div class="track" aria-label="The line, front first"><div class="stop${landP ? ' pl' : ''}"${landP || ''}><b>main</b>lands here</div>${parts.join('')}</div>` : '<p class="empty-line">The line is empty. Finished changes wait here to be tested.</p>';
    const done = D.queue.trains.filter((t) => t.state !== 'testing').sort((a, b) => b.endedAt - a.endedAt).slice(0, full ? 50 : 3);
    // What landed, by name: "Add oat milk to the menu (Agent 4)".
    const what = (ids) => ids.map((id) => { const c = idx.get(id); return c ? `<a href="#/change/${esc(id)}">${short(c)}</a> (${AG(c.agent)})` : `<a href="#/change/${esc(id)}">${ref(id)}</a>`; }).join(', ');
    const res = done.map((t) => {
      const rp = t.changes.filter((id) => /^replayed/.test(idx.get(id)?.landing?.how || ''));
      return t.state === 'landed'
        ? `<li><i class="dot s-landed"></i><span>Landed${t.changes.length > 1 ? ` ${t.changes.length} changes` : ''}: ${what(t.changes)}${rp.length ? `, ${rp.length === t.changes.length ? '' : rp.length + ' '}after a ${term('replay', 'replay')}` : ''}; tests passed</span><span class="dim small">${ago(t.endedAt)}</span></li>`
        : `<li><i class="dot s-bounced"></i><span>Sent back: ${what(t.changes)}. A test failed, so main stayed healthy.<span class="dim small" style="display:block">${esc((t.checks.failures[0] || '').split(' › ').pop())}</span></span><span class="dim small">${ago(t.endedAt)}</span></li>`;
    }).join('');
    return `<div class="line">${track}${res ? `<ul class="results">${res}</ul>` : ''}</div>`;
  }
  function fileMarks() {
    // Per file: working (w), claimed (c), collided recently (x), landed recently (l).
    const m = new Map(), T = now(), put = (p, k) => { const o = { l: 1, c: 2, w: 3, x: 4 }; if (!m.has(p) || o[k] > o[m.get(p)]) m.set(p, k); };
    for (const c of D.changes) {
      if (c.state === 'landed' && c.landedAt > T - 10 * 60e3) c.files.forEach((p) => put(p, 'l'));
      if (active(c)) (c.claims || []).forEach((p) => put(p, c.state === 'working' ? 'w' : 'c'));
      // A collision that was replayed (or landed) since is no longer red.
      for (const e of c.events) if (e.what === 'conflict' && e.t > T - 10 * 60e3) conflictPaths(c, e).forEach((p) => put(p, c.state === 'landed' || c.events.some((x) => x.t >= e.t && x.what === 'replayed') ? 'l' : 'x'));
    }
    return m;
  }
  const conflictPaths = (c, e) => (c.landing?.conflicts?.length ? c.landing.conflicts : (e.detail || '').split(':')[0].split(/,\s*/).filter((p) => /[./]/.test(p)));
  const agNum = (a) => (/(\d+)\D*$/.exec(a || '') || [])[1] || (a || '?').slice(0, 2);
  const RANK = { 'with-lead': 9, bounced: 8, replaying: 7, testing: 6, queued: 5, ready: 4, reviewing: 3, pushed: 2, working: 1, landed: 0 };
  // One chip per agent: its number, coloured by what its change is doing; tap opens the change.
  const chip = (c, k, extra = '') => {
    const p = k === 'landed' ? pulse(`land:${c.id}`) : null;
    return `<button class="ag s-${k}${p ? ' pl' : ''}${extra}" type="button"${p || ''} data-go="#/change/${esc(c.id)}" aria-label="${AG(c.agent)}: ${WORD[k]}, ${short(c)}">${esc(agNum(c.agent))}</button>`;
  };
  const mapKey = () => `<div class="key top"><span><i class="ag s-working"></i>working</span><span><i class="ag s-reviewing"></i>in review</span><span><i class="ag s-ready"></i>ready to merge</span><span><i class="ag s-queued"></i>in the line or being tested</span><span><i class="ag s-replaying"></i>${term('replay', 'replaying')}</span><span><i class="ag s-bounced"></i>sent back or stuck</span><span><i class="ag s-landed"></i>just landed</span><span><i class="zap"></i><span>${term('collision', 'collided')}</span></span><span><i class="zap ok"></i><span>collided, then ${term('replay', 'replayed')}</span></span></div>`;
  function theMap() {
    const T = now(), idx = byId();
    // Each agent shows once: in the area of its most important change's first file.
    const shown = D.changes.filter((c) => active(c) || (c.state === 'landed' && c.landedAt > T - 90e3));
    const top = new Map();
    for (const c of shown) { const o = top.get(c.agent); if (!o || RANK[skey(c)] > RANK[skey(o)]) top.set(c.agent, c); }
    const home = new Map([...top].map(([ag, c]) => [ag, areaOf(c.files[0] || (c.claims || [])[0] || '.')]));
    const quiet = [];
    return `<div class="map">${D.areas.map((a) => {
      const inArea = (c) => [...c.files, ...(c.claims || [])].some((p) => areaOf(p) === a.path);
      // Agents here: active changes, and ones that landed in the last 90 s.
      const best = new Map([...top].filter(([ag]) => home.get(ag) === a.path));
      // Collisions in this area in the last 10 min, drawn between the two agents.
      const pairs = [], paired = new Set();
      for (const c of D.changes) for (const e of c.events) {
        if (e.what !== 'conflict' || e.t < T - 10 * 60e3 || !conflictPaths(c, e).some((p) => areaOf(p) === a.path)) continue;
        const o = otherOf(c, e, idx);
        if (!o || paired.has(c.agent) || paired.has(o.agent)) continue;
        paired.add(c.agent); paired.add(o.agent);
        const p = pulse(`x:${c.id}:${e.t}`);
        const fixed = c.events.some((x) => x.t > e.t && x.what === 'replayed') || c.state === 'landed';
        const pc = (x) => { const t = top.get(x.agent) || x; return chip(t, skey(t), home.get(x.agent) === a.path ? '' : ' past'); };
        pairs.push({ ok: fixed, html: `<span class="pair${fixed ? ' ok' : ''}${p ? ' pl' : ''}"${p || ''}>${pc(c)}<i class="zap" aria-hidden="true"></i>${pc(o)}</span>`,
          words: `${AG(c.agent)} and ${AG(o.agent)} collided on ${conflictPaths(c, e).map((x) => x.split('/').pop()).join(', ')}${c.state === 'landed' ? '; replayed, landed' : fixed ? '; replayed' : c.state === 'replaying' ? '; replaying now' : ''}` });
      }
      const singles = [...best.values()].filter((c) => !paired.has(c.agent)).sort((x, y) => RANK[skey(y)] - RANK[skey(x)]);
      const chips = [...pairs.map((x) => x.html), ...singles.map((c) => chip(c, skey(c)))].join('');
      const n = best.size;
      const meta = a.recentLandings ? `${a.recentLandings} landed today` : '';
      if (!chips) { quiet.push(a.path); return ''; }
      return `<div class="area" data-go="#/area/${encodeURIComponent(a.path)}"><button class="nm" type="button" data-go="#/area/${encodeURIComponent(a.path)}">${esc(areaLabel(a.path))}<span class="meta">${meta}</span></button><span class="chips">${chips}</span>${pairs.map((x) => `<span class="coll${x.ok ? ' ok' : ''}">${esc(x.words)}</span>`).join('')}</div>`;
    }).join('')}${quiet.length ? `<p class="quiet">Quiet now: ${quiet.map((q) => `<a href="#/area/${encodeURIComponent(q)}" class="mono">${esc(areaLabel(q))}</a>`).join(', ')}</p>` : ''}</div>`;
  }
  let firstPaint = true;
  function feed(limit) {
    const items = feedItems().slice(0, limit);
    const html = items.map((it) => {
      const k = it.key || `${it.c.id}:${it.e.what}:${it.t}`;
      const fresh = pulse(`feed:${k}`);
      const href = it.c ? `#/change/${esc(it.c.id)}` : '#/line';
      const cls = it.c ? `s-${STATE[it.e.what] === 'pushed' && it.e.what === 'approved' ? 'ready' : it.e.what === 'conflict' ? 'bounced' : STATE[it.e.what] || 'working'}` : 's-testing';
      return `<li${fresh ? ` class="new"${fresh}` : ''}><a href="${href}"><i class="dot ${cls}"></i><span class="t">${esc(it.s[0])}</span><time>${ago(it.t)}</time>${it.s[1] ? `<span class="sub">${esc(it.s[1])}</span>` : ''}</a></li>`;
    }).join('');
    return html ? `<ul class="feed">${html}</ul>` : '<p class="dim">Nothing has happened yet.</p>';
  }
  function needsYou() {
    const list = D.changes.filter((c) => ready(c) || c.state === 'with-lead');
    if (!list.length) return '';
    return `<section class="sec"><div class="sec-h"><h3>${OWN ? 'Needs you' : 'Waiting for the owner'}</h3></div><div class="needs">${list.map((c) => `<div class="need"><a href="#/change/${esc(c.id)}">${short(c)}<span class="sub">${ready(c) ? `${AG(c.agent)}, reviewed and ready` : `Collided on ${files(c.landing?.conflicts || [])}; ${esc(leadName(c.lead))} is on it`}</span></a>${ready(c) && OWN ? `<button class="btn" type="button" data-approve="${esc(c.id)}">Merge</button>` : ''}</div>`).join('')}</div></section>`;
  }
  function overview() {
    const act = D.changes.filter(active);
    const agents = new Set(act.map((c) => c.agent)).size;
    return `${demoStrip()}
      <h2>${agents ? `${agents} ${term('agent', agents === 1 ? 'agent' : 'agents')} ${agents === 1 ? 'is' : 'are'} changing ${esc(NAME)} right now.` : `No agents are working on ${esc(NAME)} right now.${D.stats.landedToday ? ` ${n0(D.stats.landedToday)} change${D.stats.landedToday === 1 ? '' : 's'} landed today.` : ''}`}</h2>
      <p class="intro">Each agent is an AI working on its own ${term('fork', 'copy')} of the code. Finished work waits in ${term('queue', 'the line')}, is tested, then joins ${term('main', 'the main code')}.</p>
      ${numbers()}
      <section class="sec"><div class="sec-h"><h3>${term('queue', 'The line')}</h3><a href="#/line">Everything</a></div>
        <p class="cap">Finished changes wait here and are tested together, then join ${term('main', 'the main code')}. Tap a change to see it.</p>${theLine(false)}</section>
      <div class="ov"><div class="col1">
        <section class="sec"><div class="sec-h"><h3>Where they work</h3><a href="#/changes">All changes</a></div>
          <p class="cap">Each circle is an agent, in the part of the code it is changing. Tap one to see its change.</p>${mapKey()}${theMap()}</section>
      </div><div class="col2">
        ${needsYou()}
        <section class="sec"><div class="sec-h"><h3>What just happened</h3><a href="#/feed">All</a></div>${feed(8)}</section>
      </div></div>`;
  }

  // ---- drill-downs -----------------------------------------------------------------------
  const crumbs = (items) => `<nav class="crumbs" aria-label="Where you are">${items.map(([l, h], i) => (h ? `<a href="${h}">${esc(l)}</a>` : `<b>${esc(l)}</b>`) + (i < items.length - 1 ? '<span class="sep">/</span>' : '')).join('')}</nav>`;
  const row = (c, sub) => `<li><a href="#/change/${esc(c.id)}"><i class="dot s-${skey(c)}"></i><span class="t">${short(c)}</span><span class="st s-${skey(c)}"><span class="w">${WORD[skey(c)]}</span></span><span class="sub">${sub ?? `${AG(c.agent)}, ${ago(c.events[c.events.length - 1]?.t || c.createdAt)}`} <span class="num-id">${ref(c.id)}</span></span></a></li>`;
  const ORDERED = ['with-lead', 'ready', 'bounced', 'replaying', 'testing', 'queued', 'reviewing', 'pushed', 'working', 'landed'];
  const sortC = (l) => l.slice().sort((a, b) => ORDERED.indexOf(skey(a)) - ORDERED.indexOf(skey(b)) || (b.createdAt || 0) - (a.createdAt || 0));

  function viewArea(path) {
    const a = D.areas.find((x) => x.path === path);
    if (!a) return overview();
    const touch = D.changes.filter((c) => [...c.files, ...(c.claims || [])].some((p) => areaOf(p) === path));
    const marks = fileMarks();
    const paths = [...new Set(touch.flatMap((c) => [...c.files, ...(c.claims || [])]).filter((p) => areaOf(p) === path))].sort();
    const fl = paths.map((p) => {
      const on = D.changes.filter((c) => c.files.includes(p) || (c.claims || []).includes(p));
      const now_ = on.filter(active).map((c) => AG(c.agent));
      const k = marks.get(p);
      const tag = k === 'x' ? '<span class="st s-bounced"><span class="w">collided</span></span>' : k === 'w' ? '<span class="st s-working"><i class="dot"></i>being changed</span>' : k === 'l' ? '<span class="st s-landed"><span class="w">just landed</span></span>' : '';
      const dk = { x: 'bounced', w: 'working', l: 'landed', c: 'pushed' }[k] || 'none';
      return `<li><a href="#/file/${encodeURIComponent(p)}"><i class="dot s-${dk}"${dk === 'none' ? ' style="visibility:hidden"' : ''}></i><span class="t mono">${esc(p.slice(isRoot(path) ? 0 : path.length + 1))}</span>${tag || '<span></span>'}<span class="sub">${now_.length ? `${[...new Set(now_)].join(', ')} on it now` : 'nobody on it now'}; ${on.length} change${on.length === 1 ? '' : 's'} today</span></a></li>`;
    }).join('');
    return `<div class="drill">${crumbs([['Agents at work', '#/'], [areaLabel(path)]])}
      <div class="tags"><span>${n0(a.files)} file${a.files === 1 ? '' : 's'}</span><span>${a.claimed} ${term('claim', 'claimed')} now</span><span>${a.recentLandings} landed today</span><span>${a.recentConflicts} ${term('collision', 'collisions')} today</span></div>
      <section class="sec" style="margin-top:8px"><h3>Changes here</h3>${touch.length ? `<ul class="rows">${sortC(touch).map((c) => row(c)).join('')}</ul>` : '<p class="dim">No changes here today.</p>'}</section>
      <section class="sec"><h3>Files being touched</h3><p class="cap">Only files someone changed or claimed today.</p>${fl ? `<ul class="rows">${fl}</ul>` : '<p class="dim">None.</p>'}</section></div>`;
  }
  function viewFile(p) {
    const area = areaOf(p);
    const on = sortC(D.changes.filter((c) => c.files.includes(p) || (c.claims || []).includes(p)));
    const coll = D.changes.flatMap((c) => c.events.filter((e) => e.what === 'conflict' && (c.landing?.conflicts || c.files).includes(p)).map((e) => ({ c, e }))).sort((a, b) => b.e.t - a.e.t);
    return `<div class="drill">${crumbs([['Agents at work', '#/'], [areaLabel(area), `#/area/${encodeURIComponent(area)}`], [p.split('/').pop()]])}
      <p class="mono dim">${esc(p)}</p>
      <section class="sec" style="margin-top:12px"><h3>Changes to this file</h3>${on.length ? `<ul class="rows">${on.map((c) => row(c, `${AG(c.agent)}${(c.claims || []).includes(p) && !c.files.includes(p) ? ', claimed only' : ''}`)).join('')}</ul>` : '<p class="dim">None today.</p>'}</section>
      ${coll.length ? `<section class="sec"><h3>${term('collision', 'Collisions')} here</h3><ul class="rows">${coll.map(({ c, e }) => `<li><a href="#/change/${esc(c.id)}"><i class="dot s-bounced"></i><span class="t">${short(c)}</span><time>${ago(e.t)}</time><span class="sub">${esc(e.detail || '')}</span></a></li>`).join('')}</ul></section>` : ''}</div>`;
  }
  function progress(c) {
    // Five steps a person understands: working, review, in line, tested, landed.
    const k = skey(c), ev = new Set(c.events.map((e) => e.what));
    const at = { working: 0, pushed: 1, reviewing: 1, ready: 1, queued: 2, replaying: 2, 'with-lead': 2, testing: 3, bounced: 3, landed: 5 }[k] ?? 0;
    const cls = (i) => (i < at ? 'on' : i === at ? (k === 'bounced' || k === 'with-lead' ? 'bad' : k === 'ready' ? 'on' : 'now') : '');
    const lbl = ['Working', 'Review', 'In line', 'Tested', 'Landed'];
    return `<div class="steps" aria-hidden="true">${lbl.map((_, i) => `<i class="${cls(i)}"></i>`).join('')}</div><div class="stepl" aria-hidden="true">${lbl.map((l) => `<span>${l}</span>`).join('')}</div>${ev.has('replayed') && k !== 'landed' ? '' : ''}`;
  }
  function howBox(c) {
    const L = c.landing, idx = byId();
    const ce = [...c.events].reverse().find((e) => e.what === 'conflict');
    const conf = L?.conflicts?.length ? L.conflicts : ce ? conflictPaths(c, ce) : [];
    const sentBack = c.events.some((e) => e.what === 'bounced');
    const sha = (x) => `<span class="mono">${esc(String(x).slice(0, 7))}</span>`;
    const oc = ce && otherOf(c, ce, idx);
    const withWho = oc ? ` with ${AG(oc.agent)}'s ${ref(oc.id)}` : '';
    switch (skey(c)) {
      case 'landed':
        if (/^replayed/.test(L?.how || '')) return `<div class="how"><b>Landed after a ${term('replay', 'replay')}</b><p>It ${term('collision', 'collided')}${withWho} on ${files(conf)}. Instead of sending it back, qodebase re-applied what it was meant to do on the newest code (${L.how === 'replayed-llm' ? 'an AI re-did the edit; the difference is shown below' : 'a fixed rule for this kind of file'}), tested it again, and it passed.</p></div>`;
        if (L?.how === 'lead') return `<div class="how"><b>Landed with its ${term('lead', 'lead')}'s help</b><p>It ${term('collision', 'collided')}${withWho}${conf.length ? ` on ${files(conf)}` : ''}. No rule could replay this edit, so its lead redid it on the newest code; it passed the tests and joined main.</p></div>`;
        if (sentBack) return `<div class="how"><b>Landed on the second try</b><p>The first time, a test failed, so it was sent back and main stayed healthy. ${AG(c.agent)} fixed it, and it passed${L?.mainCommit ? `, joining main as ${sha(L.mainCommit)}` : ''}${c.landedAt ? `, ${ago(c.landedAt)}` : ''}.</p></div>`;
        return `<div class="how"><b>Landed</b><p>It passed review and the tests, and joined main${L?.mainCommit ? ` as ${sha(L.mainCommit)}` : ''}${c.landedAt ? `, ${ago(c.landedAt)}` : ''}.</p></div>`;
      case 'replaying': return `<div class="how busy"><b>Replaying now</b><p>It ${term('collision', 'collided')}${withWho} on ${files(conf.length ? conf : (ce?.detail || '').split(':')[0].split(', '))}. qodebase is re-applying its intent on the newest code instead of throwing the work away.</p></div>`;
      case 'with-lead': return `<div class="how warn"><b>Waiting for its ${term('lead', 'lead')}</b><p>It collided${withWho} on ${files(conf)}. No rule could replay this edit${D.flags && D.flags.llmReplay === false ? ' and AI replay is off for this project' : ''}, so ${esc(leadName(c.lead) || 'the lead')} decides how to combine both.</p></div>`;
      case 'bounced': { const tr = D.queue.trains.find((t) => t.changes.includes(c.id) && t.state === 'bounced'); return `<div class="how warn"><b>Sent back</b><p>A test failed when it was tested with the newest main, so it did not land and main stayed healthy. ${AG(c.agent)} gets the failure and fixes it.</p>${tr ? `<p class="mono" style="margin-top:6px">${esc(tr.checks.failures.join('\n'))}</p>` : ''}</div>`; }
      case 'testing': { const tr = D.queue.trains.find((t) => t.changes.includes(c.id) && t.state === 'testing'); return `<div class="how busy"><b>Being tested</b><p>${tr && tr.changes.length > 1 ? `Together with ${tr.changes.filter((x) => x !== c.id).map((x) => `<a href="#/change/${esc(x)}">${ref(x)}</a>`).join(', ')}, as one ${term('train', 'train')}` : 'On its own'}, on the newest main${tr ? `, for ${since(tr.startedAt)}` : ''}.</p></div>`; }
      case 'queued': return `<div class="how busy"><b>In ${term('queue', 'the line')}</b><p>${D.queue.waiting.indexOf(c.id) >= 0 ? `Number ${D.queue.waiting.indexOf(c.id) + 1} in line.` : ''} It will be tested together with the changes next to it.${c.stackedOn ? ` It lands after ${ref(c.stackedOn)}, which it builds on.` : ''}</p></div>`;
      case 'ready': return `<div class="how"><b>Ready to merge</b><p>It passed ${term('review', 'review')}. ${OWN ? 'Merge puts it in the line.' : 'The owner merges it into the line.'}</p>${OWN ? `<p style="margin-top:10px"><button class="btn" type="button" data-approve="${esc(c.id)}">Merge</button></p>` : ''}</div>`;
      default: return '';
    }
  }
  function viewChange(id) {
    const idx = byId(), c = idx.get(id);
    if (!c) return `<div class="drill">${crumbs([['Agents at work', '#/'], [ref(id)]])}<p class="dim">This change is not in today's data.</p></div>`;
    const area = areaOf(c.files[0] || '.');
    const story = c.events.map((e) => { const s = sentence(c, e, idx) || [{ working: `${AG(c.agent)} working`, reviewing: 'The reviewer is reading it', testing: 'Being tested with the newest main' }[e.what] || e.what, { alone: 'on its own', 'next train': '' }[e.detail] ?? e.detail]; return `<li><time>${hhmm(e.t)}</time><span>${esc(s[0])}${s[1] && s[1] !== short(c) ? `<span class="d">${esc(s[1])}</span>` : ''}</span></li>`; }).reverse().join('');
    const stackOn = c.stackedOn && idx.get(c.stackedOn);
    const above = D.changes.filter((x) => x.stackedOn === c.id);
    const L = c.landing;
    const diff = L?.diff?.length ? L.diff.map((d) => `<p class="mono" style="margin-top:12px"><a href="#/file/${encodeURIComponent(d.path)}">${esc(d.path)}</a></p><pre class="diff">${d.lines.map((l) => `<span class="${l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : l === '…' ? 'gap' : ''}">${esc(l === '…' ? '  …' : l)}</span>`).join('')}</pre>`).join('') : '';
    const rv = c.review ? `<dt>${term('review', 'Review')}</dt><dd>${c.review.verdict === 'changes' ? 'Fixes asked' : c.review.verdict === 'auto' ? 'Approved (scripted)' : 'Approved'}${c.review.notes ? `<span class="dim small" style="display:block">${esc(c.review.notes)}</span>` : ''}</dd>` : '';
    return `<div class="drill">${crumbs([['Agents at work', '#/'], [areaLabel(area), `#/area/${encodeURIComponent(area)}`], [ref(c.id)]])}
      <h2 style="font-size:20px;margin-bottom:6px">${short(c)}</h2>
      <div class="tags">${st(c)}<span>${AG(c.agent)}</span>${c.createdAt ? `<span>started ${ago(c.createdAt)}</span>` : ''}</div>
      ${progress(c)}
      <section class="sec" style="margin-top:16px">${howBox(c)}</section>
      <section class="sec"><h3>What it was asked to do</h3><p style="margin-top:4px">${esc(c.intent)}</p></section>
      ${stackOn || above.length ? `<section class="sec"><h3>${term('stack', 'Stacked')}</h3><ul class="rows">${stackOn ? row(stackOn, 'This change builds on it, and lands after it') : ''}${above.map((x) => row(x, 'Builds on this change')).join('')}</ul></section>` : ''}
      <section class="sec"><h3>What happened</h3><ol class="story">${story}</ol></section>
      <section class="sec"><h3>Details</h3><dl class="kv" style="margin-top:6px">
        <dt>Files</dt><dd>${c.files.map((p) => `<a class="mono" href="#/file/${encodeURIComponent(p)}">${esc(p)}</a>`).join('<br>')}</dd>
        ${(c.claims || []).some((p) => !c.files.includes(p)) ? `<dt>${term('claim', 'Claimed')}</dt><dd>${files(c.claims.filter((p) => !c.files.includes(p)))}</dd>` : ''}
        ${rv}
        <dt>${term('fork', 'Its copy')}</dt><dd class="mono">${esc(c.fork)}</dd>
        ${L?.commit ? `<dt>Commit</dt><dd class="mono">${esc(L.commit.slice(0, 7))}${L.mainCommit ? ` landed as ${esc(L.mainCommit.slice(0, 7))}` : ''}</dd>` : ''}
      </dl></section>
      ${diff ? `<section class="sec"><h3>The change</h3><p class="cap">Green lines were added, red lines removed.</p>${diff}</section>` : ''}</div>`;
  }
  function viewLine() {
    return `<div class="drill">${crumbs([['Agents at work', '#/'], ['The line']])}
      <p class="cap" style="margin-top:4px">${GLOSS.queue[1]} Changes tested together are a ${term('train', 'train')}: if the tests pass, they all land at once.</p>${theLine(true)}</div>`;
  }
  function viewFeed() { return `<div class="drill">${crumbs([['Agents at work', '#/'], ['What happened']])}${feed(200)}</div>`; }
  function viewReplayed() {
    const l = D.changes.filter((c) => c.events.some((e) => e.what === 'replayed' || e.what === 'replaying')).sort((a, b) => b.createdAt - a.createdAt);
    return `<div class="drill">${crumbs([['Agents at work', '#/'], ['Replayed']])}<p class="cap" style="margin-top:4px">${GLOSS.replay[1]}</p>${l.length ? `<ul class="rows">${l.map((c) => row(c)).join('')}</ul>` : '<p class="dim">None in today\'s data yet.</p>'}${D.stats.replayed > l.length ? `<p class="cap" style="margin-top:8px">${n0(D.stats.replayed)} today in all; the ones above are the recent ones.</p>` : ''}</div>`;
  }
  function viewChanges() {
    const groups = [['Needs a decision', ['with-lead', 'ready']], ['On the way', ['bounced', 'replaying', 'testing', 'queued', 'reviewing', 'pushed']], ['Working', ['working']], ['Landed', ['landed']]];
    return `<div class="drill">${crumbs([['Agents at work', '#/'], ['All changes']])}${groups.map(([h, ks]) => { const l = sortC(D.changes.filter((c) => ks.includes(skey(c)))); return l.length ? `<section class="sec" style="margin-top:12px"><h3>${h} <span class="dim">${l.length}</span></h3><ul class="rows">${l.map((c) => row(c)).join('')}</ul></section>` : ''; }).join('')}</div>`;
  }

  // ---- render, poll -----------------------------------------------------------------------------
  root.classList.add('lw');
  let lastKey = '', lastHash = null, lastNow = 0, pressing = false, pendingRender = false;
  root.addEventListener('pointerdown', () => { pressing = true; });
  const release = () => { pressing = false; if (pendingRender) { pendingRender = false; setTimeout(render, 350); } };
  addEventListener('pointerup', release); addEventListener('pointercancel', release);
  function flip(before) {
    const idx = byId(), stop = root.querySelector('.stop')?.getBoundingClientRect();
    const ease = 'cubic-bezier(.2,.7,.2,1)';
    root.querySelectorAll('[data-car]').forEach((e) => {
      const o = before.get(e.dataset.car), n = e.getBoundingClientRect();
      if (!o) { e.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: ease }); return; }
      const dx = o.left - n.left, dy = o.top - n.top;
      if (Math.abs(dx) + Math.abs(dy) > 1) e.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 800, easing: ease });
    });
    for (const [id, o] of before) {
      if (root.querySelector(`[data-car="${CSS.escape(id)}"]`) || !stop) continue;
      const c = idx.get(id), landed = c && c.state === 'landed';
      const g = document.createElement('div');
      g.className = 'lw-ghost'; g.textContent = `#${id}`;
      Object.assign(g.style, { position: 'fixed', left: `${o.left}px`, top: `${o.top}px`, width: `${o.width}px`, height: `${o.height}px`, margin: 0, zIndex: 40, pointerEvents: 'none' });
      document.body.appendChild(g);
      const to = landed ? `translate(${stop.left + stop.width / 2 - o.left - o.width / 2}px,${stop.top + stop.height / 2 - o.top - o.height / 2}px) scale(.4)` : 'translateY(16px) scale(.8)';
      g.animate([{ transform: 'none', opacity: 1 }, { transform: to, opacity: 0 }], { duration: landed ? 900 : 600, easing: ease, fill: 'forwards' }).finished.then(() => g.remove(), () => g.remove());
    }
  }
  function render() {
    if (!D) return;
    const h = decodeURIComponent(location.hash || '#/'); let m;
    const html = (m = /^#\/area\/(.+)$/.exec(h)) ? viewArea(m[1]) : (m = /^#\/file\/(.+)$/.exec(h)) ? viewFile(m[1]) : (m = /^#\/change\/(.+)$/.exec(h)) ? viewChange(m[1])
      : h === '#/replayed' ? viewReplayed() : h === '#/line' ? viewLine() : h === '#/feed' ? viewFeed() : h === '#/changes' ? viewChanges() : overview();
    // Rebuild only when something other than a time changed, and never under a finger:
    // a rebuild mid-tap swallowed about one tap in six (critique, 2026-10-07).
    const key = html.replace(/(data-(?:ago|since)="\d+">)[^<]*/g, '$1').replace(/animation-delay:-\d+ms/g, '');
    if (key === lastKey || pressing) {
      root.querySelectorAll('[data-ago]').forEach((e) => { const v = agoTxt(+e.dataset.ago); if (e.textContent !== v) e.textContent = v; });
      root.querySelectorAll('[data-since]').forEach((e) => { const v = secs(now() - +e.dataset.since); if (e.textContent !== v) e.textContent = v; });
      if (pressing) pendingRender = true;
    } else {
      lastKey = key;
      // The line moves: cars glide from waiting to the train, and a landed train flies into main (FLIP).
      const same = h === lastHash && D.now >= lastNow && !matchMedia('(prefers-reduced-motion: reduce)').matches;
      const before = new Map();
      if (same) root.querySelectorAll('[data-car]').forEach((e) => before.set(e.dataset.car, e.getBoundingClientRect()));
      root.innerHTML = html;
      if (same && before.size) flip(before);
    }
    lastNow = D.now;
    firstPaint = false;
    if (h !== lastHash) { const sc = root.closest('.view') || document.scrollingElement; if (lastHash !== null && sc) sc.scrollTop = 0; lastHash = h; }
  }
  let timer = null;
  async function tick() {
    clearTimeout(timer);
    try { await load(); failures = 0; render(); } catch (e) { failures++; log('poll_failed', { error: String(e), failures }); if (e.none) { root.innerHTML = `<h2>No agents at work here yet.</h2><p class="dim">When agents work on ${esc(NAME)} at the same time, this page shows where they work, the line their changes wait in, and how each one landed. <a href="?mock=1">See it with sample data</a>.</p>`; return; }
      if (!D) root.innerHTML = `<p class="dim">Could not load the agents (${esc(e.message)}). Retrying…</p>`; }
    if (!document.hidden) timer = setTimeout(tick, MOCK ? Math.max(250, 1000 / MSPEED) : Math.min(30e3, 2000 * 2 ** Math.min(failures, 4)));
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  addEventListener('hashchange', render);

  // ---- taps -------------------------------------------------------------------------------
  const pop = document.createElement('div');
  pop.className = 'lw-pop'; pop.id = 'lw-pop'; pop.setAttribute('popover', '');
  document.body.appendChild(pop);
  const toast = (t) => { const e = document.createElement('div'); e.className = 'toast'; e.textContent = t; root.appendChild(e); setTimeout(() => e.remove(), 2600); };
  root.addEventListener('click', async (ev) => {
    const g = ev.target.closest('[data-gloss]');
    if (g) { ev.preventDefault(); ev.stopPropagation(); const [t, d] = GLOSS[g.dataset.gloss]; pop.innerHTML = `<button class="x" type="button" aria-label="Close" popovertarget="lw-pop" popovertargetaction="hide">×</button><b>${esc(t)}</b><p>${esc(d)}</p>`; pop.showPopover?.(); return; }
    const go = ev.target.closest('[data-go]');
    if (go) { location.hash = go.dataset.go; return; }
    const ap = ev.target.closest('[data-approve]');
    if (ap) {
      if (MOCK) { toast('Mock data: in a real project this puts the change in the line.'); return; }
      ap.disabled = true;
      const r = await fetch(`${API}/landing/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: ap.dataset.approve }) }).catch((e) => ({ ok: false, statusText: String(e) }));
      log('approve', { id: ap.dataset.approve, ok: r.ok });
      if (!r.ok) { ap.disabled = false; toast('Could not merge it. Try again.'); } else { toast('Put in the line.'); tick(); }
      return;
    }
    const dm = ev.target.closest('[data-demo]');
    if (dm) {
      dm.disabled = true;
      const r = await fetch(`${API}/landing/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: dm.dataset.demo }) }).catch(() => ({ ok: false }));
      log('demo', { action: dm.dataset.demo, ok: r.ok });
      if (!r.ok) { dm.disabled = false; toast('Could not change the demo.'); } else tick();
    }
  });
  tick();
})();
