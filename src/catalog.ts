// The catalogue on forq's home page: popular open-source GitHub projects that run
// in the browser as they are (scripts/build-catalog.mjs picks them: an index.html
// where forq looks for one, a licence, under 50 MB). Nothing is imported until
// someone taps Import; a project's page fetches its README from GitHub only when
// it is opened (cached a day per colo).

import type { Entry } from './registry';
import { esc, path, STEPS } from './ui';
import { freshTag } from './fresh';
import { markdown } from './md';
import CATALOG from './catalog.json';

export type CatalogItem = { full: string; desc: string; stars: number; license: string; sizeKb: number; cat: string; topic: string;
  homepage: string | null; pushed: number; branch: string; entry: string | null; runs?: boolean; lang: string | null };
export const ITEMS = (CATALOG as unknown as { projects: CatalogItem[] }).projects;
/** forq can serve it as a live app as it is (older catalogue files listed only those). */
export const runsHere = (x: CatalogItem) => x.runs ?? x.entry !== null;

export const CATS: [string, string][] = [['ai', 'AI'], ['frameworks', 'Frameworks'], ['libraries', 'Libraries'], ['devtools', 'Dev tools'],
  ['cli', 'CLI'], ['data', 'Data'], ['selfhosted', 'Self-hosted'], ['games', 'Games'], ['creative', 'Creative'], ['music', 'Music'],
  ['productivity', 'Productivity'], ['tools', 'Tools'], ['learning', 'Learning'], ['slides', 'Slides'], ['visual', 'Visual']];
const PLAY = `<svg class="ic" viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M4.5 2.8v10.4L13 8z"/></svg>`;
/** The mark for projects forq can open as a live app. */
const RUNS = `<span class="runs">${PLAY}Runs here</span>`;
const CAT_LABEL = Object.fromEntries(CATS) as Record<string, string>;

const STAR = `<svg class="ic" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="m8 1.8 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/></svg>`;
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}k` : String(n));
/** The owner's own GitHub picture (what they set on their account), lazy-loaded. */
const avatar = (owner: string, size = 44) => `<img class="gav" src="https://github.com/${esc(owner)}.png?size=${size * 2}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async">`;
const ghPath = (full: string) => `/gh/${full}`;

export const CATALOG_CSS = `
.gav{flex:none;border-radius:8px;background:var(--card);border:1px solid var(--line);object-fit:cover}
.intro3{font-size:15px;color:var(--dim);margin:0 0 12px}
.onforq{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;color:var(--acc)}
.gh-head{display:flex;gap:14px;align-items:center;margin:4px 0 12px}
.gh-head h1{font-size:20px;line-height:1.25;margin:0;font-weight:600;overflow-wrap:anywhere}
.gh-head h1 .o{color:var(--dim);font-weight:400}
.gh-desc{font-size:16px;margin:0 0 10px}
.gh-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;font-size:13px;color:var(--dim);margin:0 0 16px;font-variant-numeric:tabular-nums}
.gh-meta .st{display:inline-flex;align-items:center;gap:4px;color:var(--fg);font-weight:500}
.gh-acts{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 8px}
.gh-acts .btn{flex:1 1 100%}
.gh-note{font-size:13px;color:var(--dim);margin:0 0 20px}
.skel{display:flex;flex-direction:column;gap:10px;margin-top:8px}
.skel i{display:block;height:14px;border-radius:4px;background:var(--card)}
.skel i:nth-child(1){width:60%;height:20px}.skel i:nth-child(3){width:85%}.skel i:nth-child(5){width:70%}
.pp .gav{width:44px;height:44px}
.pp .tx span a{color:var(--dim)}
.pst{display:inline-flex;align-items:center;gap:4px;font-size:13px;font-weight:500;font-variant-numeric:tabular-nums}
.runs{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;color:var(--acc);border:1px solid color-mix(in srgb,var(--acc) 45%,transparent);border-radius:4px;padding:0 6px;line-height:18px}
.plist[data-list=gh] .upd{display:none}
.plist.by-upd .upd{display:inline}
.back3{display:inline-flex;align-items:center;min-height:44px;font-size:15px}
@media (min-width:600px){.gh-acts .btn{flex:0 0 auto}}
`;

/** Which catalogue repos are already on this forq, and as which project. */
export function importedMap(entries: Entry[]) {
  const m = new Map<string, Entry>();
  for (const e of entries) if (e.importedFrom && !e.forkedFrom) {
    const key = e.importedFrom.fullName.toLowerCase();
    if (!m.has(key) || e.owner === 'forq') m.set(key, e);
  }
  return m;
}

/** The home page's Projects view. Every row is in the page once, carrying its category,
 *  stars and last commit, so categories and Top / Recently updated switch in place
 *  (Eyal, 2026-10-03: "it should be instant"); the URL keeps the state for links and
 *  the back button, and the server renders the same state on a direct load. */
export function catalogBody(entries: Entry[], opts: { cat?: string; sort?: string }) {
  const now = Date.now();
  const onForq = importedMap(entries);
  const cat = opts.cat === 'forq' || opts.cat === 'runs' || (opts.cat && CAT_LABEL[opts.cat]) ? opts.cat : '';
  const sort = opts.sort === 'updated' ? 'updated' : 'top';
  const q = (c: string, so: string) => `/?${[c ? `cat=${c}` : '', so === 'updated' ? 'sort=updated' : ''].filter(Boolean).join('&')}`.replace(/\?$/, '');
  // forq/blank is the starter Build forks from, not a project to show.
  const native = entries.filter((e) => !e.forkedFrom && e.slug !== 'forq.blank');
  const count = (c: string) => ITEMS.filter((x) => x.cat === c).length;
  const chip = (c: string, l: string, n: number) => `<a href="${q(c, sort)}" data-cat="${c}" class="${cat === c ? 'on' : ''}">${l}<span>${n}</span></a>`;
  const cats = `<nav class="cats" aria-label="Categories">${chip('', 'All', ITEMS.length)}${chip('runs', 'Runs here', ITEMS.filter(runsHere).length)}${CATS.filter(([c]) => count(c)).map(([c, l]) => chip(c, l, count(c))).join('')}${chip('forq', 'On forq', native.length)}</nav>`;
  const sorts = `<nav class="sorts" aria-label="Sort"${cat === 'forq' ? ' hidden' : ''}><a href="${q(cat, 'top')}" data-sort="top" class="${sort === 'top' ? 'on' : ''}">Top</a><a href="${q(cat, 'updated')}" data-sort="updated" class="${sort === 'updated' ? 'on' : ''}">Recently updated</a>
<span class="why">${sort === 'top' ? 'most GitHub stars' : 'latest commit first'}</span></nav>`;
  const shown = (x: CatalogItem) => !cat || (cat === 'runs' ? runsHere(x) : x.cat === cat);
  const ordered = [...ITEMS].sort((a, b) => (sort === 'top' ? b.stars - a.stars : b.pushed - a.pushed));
  const rows = ordered.map((x) => {
    const [owner, name] = x.full.split('/');
    const there = onForq.get(x.full.toLowerCase());
    return `<a class="pr" href="${ghPath(x.full)}" data-cat="${esc(x.cat)}"${runsHere(x) ? ' data-runs' : ''} data-stars="${x.stars}" data-pushed="${x.pushed}"${shown(x) && cat !== 'forq' ? '' : ' hidden'}>${avatar(owner)}<span class="bd">
<span class="n"><span class="o">${esc(owner)} /</span> ${esc(name)}</span><span class="d">${esc(x.desc)}</span>
<span class="m"><span class="st">${STAR}${k(x.stars)}</span><span class="upd">${freshTag(x.pushed, now, [365 * 24, 90 * 24, 30 * 24, 7 * 24])}</span>${runsHere(x) ? RUNS : ''}<span class="tg">${esc(CAT_LABEL[x.cat] || x.cat)}</span><span>${esc(x.license)}</span>${there ? '<span class="onforq">On forq</span>' : ''}</span></span></a>`;
  }).join('');
  const forqRows = native.sort((a, b) => b.updatedAt - a.updatedAt).map((e) => `<a class="pr" href="${path(e.slug)}">${avatar(e.importedFrom ? e.importedFrom.fullName.split('/')[0] : e.owner)}<span class="bd">
<span class="n"><span class="o">${esc(e.owner)} /</span> ${esc(e.name)}</span><span class="d">${esc(e.description || '')}</span>
<span class="m">${e.importedFrom ? `<span class="st">${STAR}${k(e.importedFrom.stars)}</span>` : ''}${freshTag(e.updatedAt, now, STEPS)}</span></span></a>`).join('') || '<p class="empty">Nothing imported yet.</p>';
  return `${cats}${sorts}<div class="plist${sort === 'updated' ? ' by-upd' : ''}" data-list="gh"${cat === 'forq' ? ' hidden' : ''}>${rows}</div><div class="plist" data-list="forq"${cat === 'forq' ? '' : ' hidden'}>${forqRows}</div>`;
}

/** People: the GitHub owners behind the catalogue, and the people with projects on forq. */
export function peopleBody(entries: Entry[]) {
  const by = new Map<string, CatalogItem[]>();
  for (const x of ITEMS) { const o = x.full.split('/')[0]; by.set(o, [...(by.get(o) || []), x]); }
  const owners = [...by.entries()].map(([o, list]) => ({ o, list: list.sort((a, b) => b.stars - a.stars), stars: list.reduce((n, x) => n + x.stars, 0) }))
    .sort((a, b) => b.stars - a.stars);
  entries = entries.filter((e) => e.slug !== 'forq.blank');
  const onForq = [...new Set(entries.map((e) => e.owner))].map((h) => ({ h, n: entries.filter((e) => e.owner === h).length })).sort((a, b) => b.n - a.n);
  return `<div class="people">${owners.map((p) => `<div class="pp">${avatar(p.o)}<div class="tx"><b><a href="https://github.com/${esc(p.o)}" target="_blank" rel="noopener" style="color:inherit">${esc(p.o)}</a></b>
<span>${p.list.map((x) => `<a href="${ghPath(x.full)}">${esc(x.full.split('/')[1])}</a>`).join(', ')}</span></div><span class="pst">${STAR}${k(p.stars)}</span></div>`).join('')}</div>
${onForq.length ? `<p class="sec2">On this forq</p><div class="people">${onForq.map((p) => `<div class="pp">${avatar(p.h)}<div class="tx"><b>${esc(p.h)}</b><span>${p.n} project${p.n === 1 ? '' : 's'}</span></div></div>`).join('')}</div>` : ''}`;
}

/** A catalogue project's page: what it is, Import (or Open on forq), and its README, loaded lazily. */
export function catalogPage(full: string, entries: Entry[], me: string) {
  const x = ITEMS.find((i) => i.full.toLowerCase() === full.toLowerCase());
  if (!x) return null;
  const now = Date.now();
  const [owner, name] = x.full.split('/');
  const there = importedMap(entries).get(x.full.toLowerCase());
  const action = there
    ? `<a class="btn" href="${path(there.slug)}">Open on forq</a>`
    : me ? `<button class="btn" id="imp" data-repo="${esc(x.full)}">Import into forq</button>`
    : `<a class="btn" href="/login?next=${encodeURIComponent(ghPath(x.full))}">Sign in to import</a>`;
  const body = `<a class="back3" href="/">Projects</a>
<div class="gh-head">${avatar(owner, 56)}<h1><span class="o">${esc(owner)} /</span> ${esc(name)}</h1></div>
<p class="gh-desc">${esc(x.desc)}</p>
<div class="gh-meta">${runsHere(x) ? RUNS : ''}<span class="st">${STAR}${k(x.stars)} stars</span><span>${esc(x.license)}</span>${x.lang ? `<span>${esc(x.lang)}</span>` : ''}<span class="tg">${esc(CAT_LABEL[x.cat] || x.cat)}</span><span>updated ${freshTag(x.pushed, now, [365 * 24, 90 * 24, 30 * 24, 7 * 24])}</span></div>
<div class="gh-acts">${action}<a class="chipbtn" href="https://github.com/${esc(x.full)}" target="_blank" rel="noopener">GitHub</a>${x.homepage ? `<a class="chipbtn" href="${esc(x.homepage)}" target="_blank" rel="noopener">Live demo</a>` : ''}</div>
<p class="gh-note">${there ? `Already imported as ${esc(there.owner)} / ${esc(there.name)}: open it to run it, fork it and change it with agents.` : runsHere(x) ? 'Runs here: importing copies its latest commit into forq and opens it as a live app on its own address, ready to fork and change with agents.'
    : 'Importing copies its latest commit into forq: read and search the code, fork it, and change it with agents. It has no page forq can open as an app.'}</p>
<h3>README</h3><div class="readme" id="readme"><div class="skel" aria-label="Loading the README"><i></i><i></i><i></i><i></i><i></i></div></div>
<script>
fetch(location.pathname.replace(/\\/$/,'')+'/readme').then((r)=>r.ok?r.text():Promise.reject()).then((h)=>{document.getElementById('readme').innerHTML=h;})
 .catch(()=>{document.getElementById('readme').innerHTML='<p class="empty">The README could not be loaded. <a href="https://github.com/${esc(x.full)}" rel="noopener">Read it on GitHub</a>.</p>';});
const b=document.getElementById('imp');if(b)b.onclick=async()=>{b.disabled=true;b.textContent='Importing';
 const r=await fetch('/api/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({repo:b.dataset.repo})});
 const j=await r.json().catch(()=>({}));if(r.ok)location.href=j.path;else{b.disabled=false;b.textContent=j.error||'Import failed';}};
</script>`;
  return { title: `${owner}/${name}`, body };
}

/** The README as rendered HTML, fetched from GitHub's raw host (no API quota), cached a day per colo. */
export async function catalogReadme(full: string, ctx: ExecutionContext): Promise<string | null> {
  const x = ITEMS.find((i) => i.full.toLowerCase() === full.toLowerCase());
  if (!x) return null;
  const key = new Request(`https://forq-readme-cache.internal/v2/${x.full}`);
  const hit = await caches.default.match(key);
  if (hit) return hit.text();
  let text: string | null = null;
  for (const f of ['README.md', 'readme.md', 'Readme.md', 'README.markdown', 'README']) {
    const r = await fetch(`https://raw.githubusercontent.com/${x.full}/${x.branch}/${f}`, { headers: { 'user-agent': 'forq' } });
    if (r.ok) { text = await r.text(); break; }
  }
  if (text == null) return null;
  const html = markdown(text.slice(0, 200_000));
  ctx.waitUntil(caches.default.put(key, new Response(html, { headers: { 'cache-control': 'max-age=86400', 'content-type': 'text/html' } })));
  return html;
}
