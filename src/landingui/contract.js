// The team's contract on the project Board (qb5, 2026-10-14): the skeleton's ONE contracts file (record shapes + the
// functions modules call in each other), highlighted, with the change that created it and the ones that edited it.
// Prepended to WORK_JS by build.mjs. The host page calls window.qbContractMount(root) after every render; what was
// fetched is kept here (per source), so re-renders draw from memory. Data: GET /api/p/<o>/<n>/contract (src/contract.ts).
(() => {
  const CT_CSS = `
.ct{display:grid;gap:12px;min-width:0}
.ct-lede{margin:0;color:var(--dim);font-size:15px;max-width:68ch}
.ct-meta{display:flex;flex-wrap:wrap;gap:4px 16px;align-items:baseline;font-size:14px;color:var(--dim)}
.ct-meta code{font:13px 'JetBrains Mono',ui-monospace,monospace;color:var(--fg)}
.ct-hist{margin:0;padding:0;list-style:none;display:grid;gap:4px;font-size:14px}
.ct-hist li{display:grid;grid-template-columns:4.5em minmax(0,1fr);gap:8px;align-items:baseline}
.ct-hist li>span:last-child{display:flex;flex-wrap:wrap;gap:2px 8px;align-items:baseline;min-width:0}
.ct-hist .w{color:var(--dim)}
.ct-hist a{color:var(--acc);text-underline-offset:3px}
.ct-hist time{color:var(--dim);font-variant-numeric:tabular-nums}
.ct-code{margin:0;border-radius:12px;background:var(--card);box-shadow:inset 0 0 0 1px var(--line);overflow:auto;max-height:70vh;overscroll-behavior:contain}
.ct-code table{border-collapse:collapse;font:13px/1.55 'JetBrains Mono',ui-monospace,monospace;min-width:100%}
.ct-code td{padding:0 12px 0 0;vertical-align:top;white-space:pre}
.ct-code td.n{padding:0 10px 0 12px;text-align:right;color:var(--dim);user-select:none;position:sticky;left:0;background:var(--card);box-shadow:inset -1px 0 0 var(--line)}
.ct-code tr:first-child td{padding-top:10px}.ct-code tr:last-child td{padding-bottom:10px}
.ct-k{color:var(--acc)}.ct-s{color:var(--busy)}.ct-c{color:var(--dim)}.ct-num{color:var(--acc)}.ct-t{color:var(--acc);font-style:normal}
.ct-none{padding:16px;border-radius:12px;background:var(--card);box-shadow:inset 0 0 0 1px var(--line)}
.ct-none b{display:block;font-weight:600;margin-bottom:4px}
.ct-none p{margin:0;color:var(--dim);font-size:14px;max-width:68ch}
.ct-err{color:var(--warn);font-size:14px}
.ct-load{color:var(--dim);font-size:14px}
`;
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const log = (event, data) => { try { console.log(JSON.stringify({ ts: new Date().toISOString(), module: 'contract', event, ...(data || {}) })); } catch (e) { /* none */ } };
  const ago = (t) => { if (!t) return ''; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
  const data = new Map();   // src -> { j, err, at }

  // A small highlighter for the languages a contract comes in (JS/TS, JSON): comments, strings, numbers, keywords, JSDoc
  // tags. One regex pass over the text; everything else is escaped as is.
  const KW = /^(export|import|from|const|let|var|function|return|class|extends|new|if|else|for|of|in|async|await|type|interface|enum|readonly|null|undefined|true|false|this|typeof|default|throw|try|catch|static|get|set)$/;
  const TOK = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g;
  function highlight(text, lang) {
    if (lang === 'md' || lang === 'text') return esc(text);
    let out = '', last = 0;
    for (const m of text.matchAll(TOK)) {
      out += esc(text.slice(last, m.index)); last = m.index + m[0].length;
      if (m[1]) out += `<span class="ct-c">${esc(m[1]).replace(/(@\w+)/g, '<i class="ct-t">$1</i>')}</span>`;
      else if (m[2]) out += `<span class="ct-s">${esc(m[2])}</span>`;
      else if (m[3]) out += `<span class="ct-num">${m[3]}</span>`;
      else out += lang !== 'json' && KW.test(m[4]) ? `<span class="ct-k">${m[4]}</span>` : esc(m[4]);
    }
    return out + esc(text.slice(last));
  }
  // Highlight the whole file, then cut it into lines (a comment or string can span lines): each line closes and
  // reopens the spans that cross it.
  function lines(html) {
    const rows = [], open = [];
    for (const raw of html.split('\n')) {
      let line = open.join('') + raw;
      for (const m of raw.matchAll(/<(\/?)(span|i)([^>]*)>/g)) { if (m[1]) open.pop(); else open.push(`<${m[2]}${m[3]}>`); }
      line += open.map((t) => (t.startsWith('<i') ? '</i>' : '</span>')).reverse().join('');
      rows.push(line);
    }
    return rows;
  }

  function changeLink(el, c) {
    const href = (el.dataset.changeHref || '#/change/{id}').replace('{id}', encodeURIComponent(c.id));
    return `<a href="${esc(href)}">${esc(c.title)}</a>`;
  }
  function body(el, j) {
    if (j.none) return `<div class="ct-none"><b>No contract in this project</b><p>${esc(j.why || 'A team build writes one first: its skeleton agent puts every record the features share and every function one module calls in another in a single contracts file. One-agent builds and imported projects usually have none.')}</p></div>`;
    const who = (c) => `<span>${c.agent ? `<span>${esc(c.agent)}</span>` : ''}${changeLink(el, c)}${c.at ? `<time datetime="${new Date(c.at).toISOString()}">${esc(ago(c.at))}</time>` : ''}${c.landed === false ? '<span class="w">not on main yet</span>' : ''}</span>`;
    const hist = `<ul class="ct-hist">${j.created ? `<li><span class="w">Created</span>${who(j.created)}</li>` : ''}${(j.edits || []).map((c) => `<li><span class="w">Edited</span>${who(c)}</li>`).join('')}${j.created && !(j.edits || []).length ? '<li><span class="w">Edited</span><span style="color:var(--dim)">No later change edited it.</span></li>' : ''}</ul>`;
    const meta = `<div class="ct-meta"><code>${esc(j.path)}</code><span>${j.lines} lines</span>${j.via === 'search' ? '<span>found by its name on main</span>' : ''}</div>`;
    const code = j.text != null ? `<div class="ct-code" tabindex="0" role="region" aria-label="${esc(j.path)}"><table><tbody>${lines(highlight(j.text.replace(/\n$/, ''), j.lang)).map((l, i) => `<tr><td class="n">${i + 1}</td><td>${l || ' '}</td></tr>`).join('')}</tbody></table></div>`
      : `<p class="ct-err">${j.tooBig ? 'The file is too big to show here.' : 'The file is not text.'}</p>`;
    return `${meta}${hist}${code}`;
  }
  function draw(el) {
    const src = el.dataset.src, d = data.get(src);
    const lede = '<p class="ct-lede">The interfaces every agent codes against: data shapes and the functions modules call in each other.</p>';
    const inner = !d ? '<p class="ct-load">Loading the contract…</p>' : d.err && !d.j ? `<p class="ct-err">Could not load the contract: ${esc(d.err)}. <button type="button" class="chipb" data-ct-retry>Try again</button></p>` : body(el, d.j);
    const html = `<div class="ct">${lede}${inner}</div>`;
    if (el._ct !== html) { el._ct = html; el.innerHTML = html; }
  }
  async function load(el, force) {
    const src = el.dataset.src, d = data.get(src);
    if (d && !force && (d.loading || Date.now() - d.at < 30000)) return;
    data.set(src, { ...(d || {}), loading: true, at: Date.now() });
    const t0 = performance.now();
    try {
      const r = await fetch(src, { credentials: 'same-origin' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      data.set(src, { j, at: Date.now() });
      log('loaded', { src, none: !!j.none, path: j.path || null, via: j.via || null, edits: (j.edits || []).length, ms: Math.round(performance.now() - t0) });
    } catch (e) {
      data.set(src, { ...(d || {}), err: String(e.message || e), at: Date.now() });
      log('error', { src, err: String(e) });
    }
    for (const m of document.querySelectorAll('.ct-mount')) if (m.dataset.src === src) draw(m);
  }
  let css = false;
  window.qbContractMount = (root) => {
    if (!css) { const s = document.createElement('style'); s.textContent = CT_CSS; document.head.appendChild(s); css = true; }
    for (const el of (root || document).querySelectorAll('.ct-mount')) { el._ct = ''; draw(el); load(el); }
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-ct-retry]'); if (!b) return;
    const el = b.closest('.ct-mount'); if (el) load(el, true);
  });
})();
