// The intent tree (qb5, src/intents.ts serves it): browse intents, not agents. Bundled in front of work.js (a project's
// "Agents at work": tab "Intents", #/intents, #/intents/why/<changeId>) and runs.js (/runs: #/intents/run/<repo>/<run>,
// #/intents/step/<label>). The host page renders a mount and calls window.qbIntentsMount(root) after every innerHTML:
//   <div class="it-mount" data-src="/api/p/o/n/intents" [data-why="c:<id>"] [data-change-href="#/change/{id}"]
//        [data-runs="/api/runs/<repo>/<run>"] [data-copies='[{"src","label","sub"}]'] [data-compact]></div>
// State (what is open, pages already fetched) lives here, outside the host's DOM, so a host re-render costs nothing:
// the mount redraws from memory at once and refreshes in the background (10 s while on screen).
(() => {
  if (window.qbIntentsMount) return;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const n0 = (x) => Math.round(x).toLocaleString('en-US');
  const log = (event, extra) => { try { console.log(JSON.stringify({ ts: new Date().toISOString(), module: 'intents', event, ...extra })); } catch {} };
  const WORD = { needs: 'Needs you', blocked: 'Blocked', working: 'Working', waiting: 'Waiting', failed: "Didn't land", done: 'Done' };
  const ORDER = ['needs', 'blocked', 'working', 'waiting', 'failed', 'done'];
  const dur = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`; };
  const usd = (x) => (x == null ? '' : x < 0.01 ? '<$0.01' : `$${x.toFixed(x < 10 ? 2 : 0)}`);

  const IT_CSS = `
.it{font-variant-numeric:tabular-nums;--it-i:14px}
.it *{box-sizing:border-box}
.it p{margin:0}
.it-sum .c{white-space:nowrap}
.it-sum{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;font-size:13px;color:var(--dim);margin:0 0 10px}
.it-sum b{color:var(--fg);font-weight:600}
.it-bar{display:flex;height:6px;border-radius:4px;overflow:hidden;background:var(--chip);flex:1 1 100%}
.it-bar i{display:block;height:100%;min-width:2px}
.it .k-needs{--k:var(--warn)}.it .k-blocked{--k:var(--warn)}.it .k-working{--k:var(--busy)}.it .k-waiting{--k:var(--dim)}.it .k-failed{--k:var(--dim)}.it .k-done{--k:var(--acc)}
.fpanel .it-mount{margin-top:16px}
.it-bar i{background:var(--k)}
.it-bar i.k-waiting{background:color-mix(in srgb,var(--dim) 45%,transparent)}
.it-bar i.k-blocked{background:repeating-linear-gradient(135deg,var(--warn) 0 3px,transparent 3px 5px)}
.it-bar i.k-failed,.it-mini i.k-failed{background:repeating-linear-gradient(135deg,var(--dim) 0 2px,transparent 2px 4px)}
.it ul{list-style:none;margin:0;padding:0}
.it ul ul{margin-left:9px;padding-left:3px;box-shadow:inset 1px 0 0 var(--line)}
.it-row{display:grid;grid-template-columns:20px 1fr auto;gap:0 8px;align-items:start;width:100%;min-height:44px;padding:10px 8px 10px 4px;border:0;background:none;text-align:left;cursor:pointer;border-radius:10px;color:var(--fg);font:inherit;-webkit-tap-highlight-color:transparent;transition:background-color 120ms}
@media (hover:hover){.it-row:hover{background:var(--card)}}
.it-chev{width:20px;height:20px;display:grid;place-items:center;color:var(--dim);margin-top:1px}
.it-chev svg{transition:transform 120ms}
.it-row[aria-expanded="true"] .it-chev svg{transform:rotate(90deg)}
.it-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--k);margin-right:8px;vertical-align:1px;flex:none}
.it-t>.it-dot{float:left;margin-top:7px}
.it-dot.k-waiting{background:none;box-shadow:inset 0 0 0 1.5px var(--dim)}
.it-dot.k-blocked{background:none;box-shadow:inset 0 0 0 2px var(--warn)}
.it-dot.k-failed{background:none;box-shadow:inset 0 0 0 2px var(--dim)}
.it-t{font-size:15px;line-height:1.35;min-width:0;overflow-wrap:anywhere}
.it-t .lb{font-weight:500}
.it-row.kd-project .lb,.it-row.kd-job .lb,.it-row.kd-request .lb{font-weight:600}
.it-row.kd-request .lb{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.it-row.kd-file .lb{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:13px;font-weight:400}
.it-s{display:flex;flex-wrap:wrap;gap:0 12px;font-size:13px;color:var(--dim);margin-top:2px}
.it-s .w{color:var(--fg)}
.it-s .k-needs,.it-s .k-blocked{color:var(--warn)}
.it-s .fl{color:var(--fg)}
.it-n{font-size:13px;color:var(--dim);text-align:right;white-space:nowrap;padding-top:1px}
.it-n b{color:var(--fg);font-weight:500}
.it-mini{display:flex;width:56px;height:4px;border-radius:2px;overflow:hidden;background:var(--chip);margin:6px 0 0 auto}
.it-mini i{display:block;height:100%;background:var(--k);min-width:2px}
@media (max-width:599px){.it-row{grid-template-columns:20px 1fr}.it-n{grid-column:2;text-align:left;display:flex;align-items:center;gap:8px;padding-top:4px}.it-mini{margin:0}}
.it-mini i.k-waiting{background:color-mix(in srgb,var(--dim) 45%,transparent)}
.it-more{min-height:44px;margin:4px 0 4px 28px;padding:0 12px;border:0;border-radius:10px;background:var(--chip);color:var(--fg);font:inherit;font-size:14px;cursor:pointer}
.it-load,.it-err{font-size:13px;color:var(--dim);padding:10px 0 10px 28px}
.it-err{color:var(--warn)}
.it-d{margin:2px 0 10px 24px;padding:12px;border-radius:12px;background:var(--bg);box-shadow:inset 0 0 0 1px var(--line);font-size:14px;line-height:1.45}
.it-d dl{display:grid;grid-template-columns:1fr;gap:2px 12px;margin:0}
.it-d dt:not(:first-child){margin-top:8px}
@media (min-width:600px){.it-d dl{grid-template-columns:auto 1fr;gap:6px 12px}.it-d dt:not(:first-child){margin-top:0}}
.it-d dt{color:var(--dim);font-size:13px}
.it-d dd{margin:0;min-width:0;overflow-wrap:anywhere}
.it-d .mono{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12.5px}
.it-d .txt{white-space:pre-wrap;max-height:9.5em;overflow:hidden}
.it-d .txt.all{max-height:none}
.it-d .acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.it-d .acts a,.it-d .acts button{display:inline-flex;align-items:center;min-height:44px;padding:0 12px;border-radius:10px;background:var(--chip);color:var(--fg);text-decoration:none;font:inherit;font-size:14px;border:0;cursor:pointer}
.it-d pre{margin:8px 0 0;padding:8px 0;background:var(--card);border-radius:12px;overflow-x:auto;font:12px/1.55 'JetBrains Mono',ui-monospace,monospace}
.it-d pre span{display:block;padding:0 10px;white-space:pre}
.it-d pre .add{background:color-mix(in srgb,var(--acc) 14%,transparent)}
.it-d pre .del{background:color-mix(in srgb,var(--warn) 14%,transparent)}
.it-d pre .gap{color:var(--dim)}
.it-why{margin:0 0 16px}
.it-why ol{list-style:none;margin:0;padding:0}
.it-why li{position:relative;padding:0 0 12px 20px}
.it-why li::before{content:'';position:absolute;left:3px;top:6px;width:8px;height:8px;border-radius:50%;background:var(--k)}
.it-why li.k-waiting::before{background:none;box-shadow:inset 0 0 0 1.5px var(--dim)}
.it-why li::after{content:'';position:absolute;left:7px;top:18px;bottom:0;width:1px;background:var(--line)}
.it-why li:last-child::after{display:none}
.it-why .kd{display:block;font-size:13px;color:var(--dim)}
.it-intro{font-size:13px;color:var(--dim);margin:0 0 12px;max-width:62ch}
`;
  const ensureCss = () => { if (document.getElementById('it-css')) return; const st = document.createElement('style'); st.id = 'it-css'; st.textContent = IT_CSS; document.head.appendChild(st); };
  const CHEV = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // ---- state, per data-src ----------------------------------------------------------
  // S[src] = { pages: Map(nodeId -> {node, children, total}), open: Set(nodeId), detail: Map(key -> data), at, err }
  const S = {};
  const st = (src) => (S[src] ||= { pages: new Map(), open: new Set(), detail: new Map(), more: new Map(), errs: new Map(), at: 0, err: null, busy: new Set() });
  const KIND = { project: 'Project', request: 'Request', area: 'Area', intent: 'Agent intent', job: 'Job', folder: 'Folder', file: 'File' };

  async function getJson(url) {
    const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
    const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }
  const qs = (o) => Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  // One page of a node's children (offset 0..shown): refetches the whole shown range so counts stay right.
  async function load(src, id, extra = {}) {
    const s = st(src), key = id ?? '';
    if (s.busy.has(key)) return; s.busy.add(key);
    const want = s.more.get(key) || 50;
    try {
      const j = await getJson(`${src}${src.includes('?') ? '&' : '?'}${qs({ node: id, limit: Math.min(200, want), ...extra })}`);
      // Beyond 200 shown: fetch the rest in 200s.
      let kids = j.children;
      for (let off = 200; off < Math.min(want, j.total); off += 200) kids = kids.concat((await getJson(`${src}${src.includes('?') ? '&' : '?'}${qs({ node: id, offset: off, limit: 200, ...extra })}`)).children);
      s.pages.set(key, { node: j.node, children: kids, total: j.total });
      if (id == null || id === '') s.root = j.node.id;
      s.err = null; s.at = Date.now();
      s.errs.delete(key);
    } catch (e) { const err = String(e.message || e); s.errs.set(key, err); if (key === '') s.err = err; log('load_error', { src, id, err }); }
    finally { s.busy.delete(key); }
  }
  // The root and every open node in one request (?open=a,b), every 10 s while on screen.
  async function refreshAll(src) {
    const s = st(src), open = [...s.open].filter((id) => s.pages.has(id) && (s.more.get(id) || 50) <= 50);
    if (s.busy.has('*')) return; s.busy.add('*');
    try {
      const j = await getJson(`${src}${src.includes('?') ? '&' : '?'}${qs({ open: open.map(encodeURIComponent).join(',') })}`);
      if ((s.more.get('') || 50) <= 50) s.pages.set('', { node: j.node, children: j.children, total: j.total }); else await load(src, '');
      for (const [id, pg] of Object.entries(j.open || {})) { if (pg.error) { s.pages.delete(id); s.open.delete(id); } else s.pages.set(id, { node: pg.node, children: pg.children, total: pg.total }); }
      for (const id of [...s.open].filter((x) => s.pages.has(x) && (s.more.get(x) || 50) > 50)) await load(src, id);
      s.err = null; s.at = Date.now();
    } catch (e) { s.err = String(e.message || e); s.at = Date.now(); log('refresh_error', { src, err: s.err }); }
    finally { s.busy.delete('*'); }
  }

  // ---- drawing ----------------------------------------------------------------------
  const bar = (c, cls = 'it-bar') => { const t = ORDER.reduce((a, k) => a + (c?.[k] || 0), 0) || 1; return `<span class="${cls}" aria-hidden="true">${ORDER.filter((k) => c?.[k]).map((k) => `<i class="k-${k}" style="width:${((100 * c[k]) / t).toFixed(2)}%"></i>`).join('')}</span>`; };
  const countsWords = (c, leaves) => { const parts = ORDER.filter((k) => c?.[k]).map((k) => `${n0(c[k])} ${WORD[k].toLowerCase()}`); return leaves > 1 ? parts.join(', ') : ''; };
  // One phrase for where a node stands: "Needs you (3): ready for you to merge", "Waiting, on the reviewer", "Done, 12 didn't land".
  // A group never quotes one leaf's error as the reason for all of them.
  function phrase(n) {
    const many = n.leaves > 1, k = n.status, w = n.waitingOn, c = n.counts || {};
    const head = many || !n.sub ? `${WORD[k]}${many && k !== 'done' && k !== 'failed' ? ` (${n0(c[k])})` : ''}` : n.sub;
    const tail = !w || k === 'done' || k === 'failed' || (k === 'blocked' && many) || (k === 'needs' && !many) ? '' : k === 'needs' ? `: ${esc(w)}` : k === 'blocked' ? `: ${esc(w)}` : `, waiting on ${esc(w)}`;
    const fl = many && c.failed && k !== 'failed' ? `<span class="fl">${n0(c.failed)} didn't land</span>` : '';
    return `<span class="w k-${k}">${esc(head)}</span>${tail}${fl ? `</span><span>${fl}` : ''}`;
  }
  function timeOf(n) { if (!n.startedAt) return ''; const end = n.endedAt || Date.now(); return n.endedAt ? `took ${dur(end - n.startedAt)}` : `<span data-it-since="${n.startedAt}">${dur(end - n.startedAt)}</span> so far`; }
  function rowHtml(src, n, depth) {
    const s = st(src), open = s.open.has(n.id), leaf = !n.kids, done = n.counts?.done || 0;
    const sub = [n.who ? esc(n.who) : '', phrase(n), n.pending ? `${n0(n.pending)} not started yet` : '', timeOf(n), n.usd ? usd(n.usd) : ''].filter(Boolean).map((x) => `<span>${x}</span>`).join('');
    const right = n.leaves > 1 ? `<span class="it-n"><b>${n0(done)}</b> of ${n0(n.leaves)} done${bar(n.counts, 'it-mini')}</span>` : '<span></span>';
    return `<li data-it-id="${esc(n.id)}"><button type="button" class="it-row kd-${n.kind}" data-it-src="${esc(src)}" data-it-node="${esc(n.id)}" aria-expanded="${open}">
      <span class="it-chev">${CHEV}</span><span class="it-t"><span class="it-dot k-${n.status}"></span><span class="lb">${esc(n.label)}</span><span class="it-s">${sub}</span></span>${right}</button>
      ${open ? (leaf ? detailHtml(src, n) : kidsHtml(src, n.id, depth + 1)) : ''}</li>`;
  }
  function kidsHtml(src, id, depth) {
    const s = st(src), pg = s.pages.get(id);
    if (!pg) {
      // A node that failed shows why and waits for a tap: never a request loop.
      if (s.errs.has(id)) return `<p class="it-err">Could not open this: ${esc(s.errs.get(id))}</p><button type="button" class="it-more" data-it-retry="${esc(id)}" data-it-src="${esc(src)}">Try again</button>`;
      if (!s.busy.has(id)) load(src, id).then(() => redraw(src));
      return `<p class="it-load">Loading…</p>`;
    }
    const left = pg.total - pg.children.length;
    return `<ul>${pg.children.map((c) => rowHtml(src, c, depth)).join('')}</ul>${left > 0 ? `<button type="button" class="it-more" data-it-more="${esc(id)}" data-it-src="${esc(src)}">Show ${n0(Math.min(50, left))} more of ${n0(left)}</button>` : ''}`;
  }
  const diffHtml = (ds) => ds.map((d) => `<p class="mono" style="margin-top:10px">${esc(d.path)}</p><pre>${(d.lines || []).map((l) => `<span class="${l[0] === '+' && !l.startsWith('+++') ? 'add' : l[0] === '-' && !l.startsWith('---') ? 'del' : l.startsWith('@@') || l === '…' ? 'gap' : ''}">${esc(l)}</span>`).join('')}</pre>`).join('');
  function detailHtml(src, n) {
    const d = n.detail || {}, m = mountOf(src), s = st(src);
    if (n.kind === 'intent') {
      const href = m?.dataset.changeHref ? m.dataset.changeHref.replace('{id}', encodeURIComponent(d.change)) : '';
      const showDiff = s.detail.get(`diff:${n.id}`), all = s.detail.get(`all:${n.id}`);
      // The title is the row already: the intent's text without its first line when that line is the title.
      const lines = String(d.intent || n.label).split('\n'), body = (lines[0].trim() === n.label && lines.length > 1 ? lines.slice(1) : lines).join('\n').trim() || n.label;
      return `<div class="it-d"><dl>
        <dt>Intent</dt><dd><p class="txt${all ? ' all' : ''}">${esc(body)}</p>${body.length > 280 ? `<button type="button" class="it-link" data-it-all="${esc(n.id)}" data-it-src="${esc(src)}" style="border:0;background:none;color:var(--acc);padding:0;font:inherit;font-size:14px;min-height:44px;cursor:pointer">${all ? 'Less' : 'All of it'}</button>` : ''}</dd>
        <dt>State</dt><dd>${esc(d.word || WORD[n.status])}${n.waitingOn && n.status !== 'done' ? `: ${esc(n.waitingOn)}` : ''}</dd>
        ${d.agent ? `<dt>Agent</dt><dd>${esc(d.agent)}</dd>` : ''}
        ${d.claims?.length ? `<dt>Said it would touch</dt><dd class="mono">${d.claims.map(esc).join('<br>')}</dd>` : ''}
        ${d.files?.length ? `<dt>Changed</dt><dd class="mono">${d.files.map(esc).join('<br>')}</dd>` : ''}
        ${d.stackedOn ? `<dt>Builds on</dt><dd>${esc(String(d.stackedOn).split('--').pop())}</dd>` : ''}
        ${d.review ? `<dt>Review</dt><dd>${esc(d.review.verdict === 'approved' ? 'Approved' : d.review.verdict === 'changes' ? 'Changes asked for' : d.review.verdict || 'Pending')}${d.review.notes ? `: ${esc(d.review.notes)}` : ''}</dd>` : ''}
        ${d.commits?.length ? `<dt>Commits</dt><dd>${d.commits.map((c) => `<span class="mono">${esc(c.sha.slice(0, 7))}</span> ${esc(c.what)}`).join('<br>')}</dd>` : ''}
        ${d.how && d.how !== 'merged' ? `<dt>How it landed</dt><dd>${esc(d.how)}${d.conflicts?.length ? `, after colliding on <span class="mono">${d.conflicts.map(esc).join(', ')}</span>` : ''}</dd>` : ''}
        ${n.startedAt ? `<dt>Time</dt><dd>${timeOf(n)}</dd>` : ''}
      </dl>${showDiff && d.diff?.length ? diffHtml(d.diff) : ''}
      <div class="acts">${d.diff?.length ? `<button type="button" data-it-diff="${esc(n.id)}" data-it-src="${esc(src)}">${showDiff ? 'Hide the diff' : 'Show the diff'}</button>` : ''}${href ? `<a href="${esc(href)}">Open the change</a>` : ''}<a href="${esc(whyHref(src, n.id))}">Why this exists</a></div></div>`;
    }
    if (n.kind === 'file') {
      const runs = m?.dataset.runs || runsOf(src), key = `file:${n.id}`, got = s.detail.get(key);
      if (!got && runs) { s.detail.set(key, { loading: true }); getJson(`${runs}/change?${qs({ file: d.file || n.id })}`).then((j) => { s.detail.set(key, j); redraw(src); }, (e) => { s.detail.set(key, { error: String(e.message || e) }); redraw(src); }); }
      const j = got && !got.loading ? got : null;
      const diff = j && j.diff ? (Array.isArray(j.diff) ? j.diff : [{ path: d.file || n.id, lines: String(j.diff).split('\n') }]) : [];
      return `<div class="it-d"><dl>
        <dt>Intent</dt><dd>${esc(st(src).pages.get('')?.node?.detail?.intent || 'Doc comments for the exported functions and classes in this file, with the code left unchanged')}</dd>
        <dt>State</dt><dd>${esc(n.sub || WORD[n.status])}${n.waitingOn && n.status !== 'done' ? `: ${esc(n.waitingOn)}` : ''}</dd>
        ${d.reason ? `<dt>What the fleet logged</dt><dd>${esc(d.reason)}</dd>` : ''}
        ${d.agent != null ? `<dt>Agent</dt><dd>Agent ${esc(d.agent)}</dd>` : ''}
        ${d.model ? `<dt>Answered by</dt><dd>${esc(d.model === 'cache' ? 'a cached answer (no model call)' : d.model)}</dd>` : ''}
        ${d.commit || j?.commit ? `<dt>Commit on main</dt><dd class="mono">${esc((d.commit || j.commit).slice(0, 7))}</dd>` : ''}
        ${j?.note ? `<dt>Change record</dt><dd class="mono">${esc(JSON.stringify(j.note).slice(0, 400))}</dd>` : ''}
        ${n.usd ? `<dt>Cost</dt><dd>${usd(n.usd)}</dd>` : ''}
        ${d.ms ? `<dt>Time</dt><dd>${dur(d.ms)}</dd>` : ''}
      </dl>${got?.loading ? '<p class="it-load" style="padding-left:0">Loading the diff…</p>' : got?.error ? `<p class="it-err" style="padding-left:0">${esc(got.error)}</p>` : diffHtml(diff.slice(0, 10))}
      <div class="acts"><a href="${esc(whyHref(src, n.id))}">Why this exists</a></div></div>`;
    }
    return '';
  }
  // A step's copies have no mount of their own: their why page is the run's own intents page.
  const whyHref = (src, id) => { const r = /^\/api\/runs\/([^/]+)\/([^/?]+)\/intents/.exec(src); return (mountOf(src)?.dataset.whyHref || (r ? `#/intents/run/${r[1]}/${r[2]}/why/{id}` : '#/intents/why/{id}')).replace('{id}', encodeURIComponent(id)); };
  const runsOf = (src) => { const m = /^(\/api\/runs\/[^/]+\/[^/?]+)\/intents/.exec(src); return m ? m[1] : ''; };
  const mounts = new Map();   // src -> element
  const mountOf = (src) => { const el = mounts.get(src); return el && el.isConnected ? el : null; };

  function treeHtml(src, inner) {
    const s = st(src), root = s.pages.get('');
    if (!root) return s.err ? `<p class="it-err">Could not load the intents: ${esc(s.err)}</p>` : '<p class="it-load">Loading the intents…</p>';
    const n = root.node, c = n.counts || {};
    const sum = `<div class="it-sum">${inner ? '' : `<span><b>${esc(n.label)}</b></span>`}${ORDER.filter((k) => c[k]).map((k) => `<span class="c k-${k}"><span class="it-dot k-${k}"></span>${n0(c[k])} ${WORD[k].toLowerCase()}</span>`).join('')}${n.usd ? `<span>${usd(n.usd)}</span>` : ''}${timeOf(n) ? `<span>${timeOf(n)}</span>` : ''}${bar(c)}</div>`;
    const left = root.total - root.children.length;
    return `${sum}<ul>${root.children.map((k) => rowHtml(src, k, 0)).join('')}</ul>${left > 0 ? `<button type="button" class="it-more" data-it-more="" data-it-src="${esc(src)}">Show ${n0(Math.min(50, left))} more of ${n0(left)}</button>` : ''}${s.err ? `<p class="it-err">Last refresh failed: ${esc(s.err)}</p>` : ''}`;
  }
  // A /runs step: its copies are the first level, each one a run with its own tree (loaded when opened).
  function copiesHtml(el) {
    let copies = []; try { copies = JSON.parse(el.dataset.copies || '[]'); } catch {}
    const open = stepOpen(el.dataset.step || '');
    return `<p class="it-intro">${n0(copies.length)} copies, each its own run. Open one to browse its folders and files.</p><ul>${copies.map((c) => {
      const o = open.has(c.src), r = st(c.src).pages.get('');
      const n = r?.node;
      return `<li><button type="button" class="it-row kd-job" data-it-copy="${esc(c.src)}" data-it-step="${esc(el.dataset.step || '')}" aria-expanded="${o}"><span class="it-chev">${CHEV}</span><span class="it-t"><span class="it-dot k-${n ? n.status : c.status || 'done'}"></span><span class="lb">${esc(c.label)}</span><span class="it-s">${esc(c.sub || '')}</span></span>${n && n.leaves > 1 ? `<span class="it-n"><b>${n0(n.counts.done)}</b> of ${n0(n.leaves)} done${bar(n.counts, 'it-mini')}</span>` : '<span></span>'}</button>${o ? `<div data-it-sub="${esc(c.src)}" style="margin:8px 0 8px 28px">${treeHtml(c.src, true)}</div>` : ''}</li>`;
    }).join('')}</ul>`;
  }
  const stepState = new Map();
  const stepOpen = (k) => { if (!stepState.has(k)) stepState.set(k, new Set()); return stepState.get(k); };

  // "Why does this exist": the path from the request down to the node.
  function whyHtml(el) {
    const src = el.dataset.src, id = el.dataset.why, key = `why:${id}`, s = st(src);
    let w = s.detail.get(key);
    if (!w) { s.detail.set(key, { loading: true }); getJson(`${src}${src.includes('?') ? '&' : '?'}${qs({ why: id })}`).then((j) => { s.detail.set(key, j); draw(el); }, (e) => { s.detail.set(key, { error: String(e.message || e) }); draw(el); }); return '<p class="it-load">Finding where this came from…</p>'; }
    if (w.loading) return '<p class="it-load">Finding where this came from…</p>';
    if (w.error) return `<p class="it-err">${esc(w.error)}</p>`;
    const p = w.path || [], leaf = p[p.length - 1];
    return `<div class="it-why"><p class="it-intro">Each line is the reason for the one below it.</p><ol>${p.map((n) => `<li class="k-${n.status}"><span class="kd">${esc(KIND[n.kind] || n.kind)}${n.leaves > 1 ? `, ${n0(n.counts.done)} of ${n0(n.leaves)} done` : `${n.who ? `, ${esc(n.who)}` : ''}, ${esc(n.sub || WORD[n.status])}`}${n.leaves > 1 ? `, ${WORD[n.status].toLowerCase()}` : ''}</span>${esc(n.label)}</li>`).join('')}</ol></div>${leaf && !leaf.kids ? detailHtml(src, leaf).replace('class="it-d"', 'class="it-d" style="margin-left:0"') : ''}<p style="margin-top:12px"><a href="${esc(el.dataset.treeHref || '#/intents')}">The whole intent tree</a></p>`;
  }

  function draw(el) {
    const prevY = window.scrollY;
    const html = el.dataset.why ? `<div class="it">${whyHtml(el)}</div>` : `<div class="it">${el.dataset.intro ? `<p class="it-intro">${esc(el.dataset.intro)}</p>` : ''}${el.dataset.copies ? copiesHtml(el) : treeHtml(el.dataset.src)}</div>`;
    const key = html.replace(/(data-it-since="\d+">)[^<]*/g, '$1');
    if (el._html !== key) {
      const f = document.activeElement && el.contains(document.activeElement) ? document.activeElement : null;
      const fk = f ? ['itNode', 'itMore', 'itCopy', 'itDiff', 'itAll', 'itRetry'].map((k) => f.dataset[k] != null ? `[data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${CSS.escape(f.dataset[k])}"]` : '').find(Boolean) : null;
      el.innerHTML = html; el._html = key;
      if (fk) el.querySelector(fk)?.focus({ preventScroll: true });
      if (Math.abs(window.scrollY - prevY) > 2) window.scrollTo(0, prevY);
    } else el.querySelectorAll('[data-it-since]').forEach((e) => { const v = dur(Date.now() - +e.dataset.itSince); if (e.textContent !== v) e.textContent = v; });
  }
  function redraw(src) { for (const el of document.querySelectorAll('.it-mount')) if (el.dataset.src === src || (el.dataset.copies || '').includes(JSON.stringify(src).slice(1, -1))) draw(el); }

  // Refresh what is on screen: the root and every open node, every 10 s (not while a finger is down).
  let pressing = false;
  addEventListener('pointerdown', () => { pressing = true; }, true);
  addEventListener('pointerup', () => { setTimeout(() => { pressing = false; }, 300); }, true);
  async function refresh(src) { await refreshAll(src); if (!pressing) redraw(src); }
  setInterval(() => {
    if (document.hidden) return;
    const seen = new Set();
    for (const el of document.querySelectorAll('.it-mount')) {
      const srcs = el.dataset.copies ? [...stepOpen(el.dataset.step || '')] : el.dataset.why ? [] : [el.dataset.src];
      for (const s of srcs) if (s && !seen.has(s) && Date.now() - st(s).at > 9000) { seen.add(s); refresh(s); }
    }
  }, 10000);

  // ---- taps -------------------------------------------------------------------------
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-it-node],[data-it-more],[data-it-diff],[data-it-all],[data-it-copy],[data-it-retry]');
    if (!t || !t.closest('.it-mount')) return;
    e.preventDefault();
    const src = t.dataset.itSrc;
    if (t.dataset.itCopy) { const el = t.closest('.it-mount'), cs = t.dataset.itCopy, o = stepOpen(t.dataset.itStep); if (o.has(cs)) o.delete(cs); else { o.add(cs); if (!st(cs).pages.has('')) load(cs, '').then(() => el.isConnected && draw(el)); } log('copy', { src: cs }); draw(el); return; }
    const s = st(src);
    if (t.dataset.itRetry != null) { s.errs.delete(t.dataset.itRetry); load(src, t.dataset.itRetry).then(() => redraw(src)); redraw(src); return; }
    if (t.dataset.itMore != null) { const k = t.dataset.itMore; if (s.busy.has(k)) return; s.more.set(k, (s.more.get(k) || 50) + 50); load(src, k).then(() => redraw(src)); t.textContent = 'Loading…'; return; }
    if (t.dataset.itDiff) { const k = `diff:${t.dataset.itDiff}`; s.detail.set(k, !s.detail.get(k)); redraw(src); return; }
    if (t.dataset.itAll) { const k = `all:${t.dataset.itAll}`; s.detail.set(k, !s.detail.get(k)); redraw(src); return; }
    const id = t.dataset.itNode;
    if (s.open.has(id)) s.open.delete(id); else s.open.add(id);
    log('toggle', { id, open: s.open.has(id) });
    redraw(src);
  });

  // ---- Talk (qb2's page-action contract): find an intent by its words and say its status --------------------------
  const STOP = /\b(what|whats|what's|is|are|the|on|waiting|why|does|do|exist|exists|show|me|status|of|for|a|an|to|it|this|intent|intents|tree|happening|with)\b/gi;
  async function talk(sentence) {
    const el = [...document.querySelectorAll('.it-mount')].find((x) => x.dataset.src && !x.dataset.copies);
    if (!el) return false;
    const words = String(sentence || '').replace(/[?.!,]/g, ' ').replace(STOP, ' ').replace(/\s+/g, ' ').trim();
    if (!words) return false;
    const src = el.dataset.src;
    const j = await getJson(`${src}${src.includes('?') ? '&' : '?'}${qs({ find: words })}`).catch(() => null);
    const n = j?.nodes?.[0];
    if (!n) return `I found no intent matching "${words}".`;
    const s = st(src);
    for (const p of (n.path || []).slice(1, -1)) { s.open.add(p.id); if (!s.pages.has(p.id)) await load(src, p.id); }
    s.open.add(n.id);
    redraw(src);
    requestAnimationFrame(() => document.querySelector(`.it-mount [data-it-id="${CSS.escape(n.id)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    log('talk', { words, found: n.id });
    const why = (n.path || []).slice(1, -1).map((p) => p.label).join(', then ');
    return `${n.label}: ${WORD[n.status].toLowerCase()}${n.status !== 'done' && n.waitingOn ? `, waiting on ${n.waitingOn}` : ''}.${why ? ` It exists for: ${why}.` : ''}`;
  }
  function talkRegister() {
    const on = !!document.querySelector('.it-mount');
    const list = Array.isArray(window.__talkActions) ? window.__talkActions : (window.__talkActions = []);
    const i = list.findIndex((a) => a && a.id === 'intent');
    if (on && i < 0) list.push({ id: 'intent', text: 'Find an intent by its words and say its status (what it is waiting on, why it exists)', run: talk });
    if (!on && i >= 0) list.splice(i, 1);
  }

  /** Called by the host after every render: (re)draw each mount from memory, load what is missing. */
  window.qbIntentsMount = (root) => {
    ensureCss();
    for (const el of (root || document).querySelectorAll('.it-mount')) {
      if (el.dataset.src) mounts.set(el.dataset.src, el);
      el._html = '';
      draw(el);
      if (el.dataset.src && !el.dataset.why && !st(el.dataset.src).pages.has('')) load(el.dataset.src, '').then(() => draw(el));
    }
    talkRegister();
  };
  window.qbIntents = { find: talk, state: S };
})();
