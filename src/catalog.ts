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
  homepage: string | null; pushed: number; branch: string; entry: string; lang: string | null };
export const ITEMS = (CATALOG as { projects: CatalogItem[] }).projects;

export const CATS: [string, string][] = [['games', 'Games'], ['creative', 'Creative'], ['music', 'Music'], ['productivity', 'Productivity'],
  ['tools', 'Tools'], ['learning', 'Learning'], ['slides', 'Slides'], ['visual', 'Visual']];
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

/** The home page's Projects view: categories, Top / Updated, one row per project. */
export function catalogBody(entries: Entry[], opts: { cat?: string; sort?: string }) {
  const now = Date.now();
  const onForq = importedMap(entries);
  const cat = opts.cat === 'forq' || (opts.cat && CAT_LABEL[opts.cat]) ? opts.cat : '';
  const sort = opts.sort === 'updated' ? 'updated' : 'top';
  const q = (c: string, so: string) => `/?${[c ? `cat=${c}` : '', so === 'updated' ? 'sort=updated' : ''].filter(Boolean).join('&')}`.replace(/\?$/, '');
  const native = entries.filter((e) => !e.forkedFrom);
  const count = (c: string) => ITEMS.filter((x) => x.cat === c).length;
  const cats = `<nav class="cats" aria-label="Categories"><a href="${q('', sort)}" class="${cat ? '' : 'on'}">All<span>${ITEMS.length}</span></a>${CATS.filter(([c]) => count(c)).map(([c, l]) =>
    `<a href="${q(c, sort)}" class="${cat === c ? 'on' : ''}">${l}<span>${count(c)}</span></a>`).join('')}<a href="${q('forq', sort)}" class="${cat === 'forq' ? 'on' : ''}">On forq<span>${native.length}</span></a></nav>
<script>document.querySelector('.cats a.on')?.scrollIntoView({inline:'center',block:'nearest'})</script>`;
  const sorts = cat === 'forq' ? '' : `<nav class="sorts" aria-label="Sort"><a href="${q(cat, 'top')}" class="${sort === 'top' ? 'on' : ''}">Top</a><a href="${q(cat, 'updated')}" class="${sort === 'updated' ? 'on' : ''}">Recently updated</a>
<span class="why">${sort === 'top' ? 'most GitHub stars' : 'latest commit first'}</span></nav>`;
  let rows = '';
  if (cat === 'forq') {
    rows = native.sort((a, b) => b.updatedAt - a.updatedAt).map((e) => `<a class="pr" href="${path(e.slug)}">${avatar(e.importedFrom ? e.importedFrom.fullName.split('/')[0] : e.owner)}<span class="bd">
<span class="n"><span class="o">${esc(e.owner)} /</span> ${esc(e.name)}</span><span class="d">${esc(e.description || '')}</span>
<span class="m">${e.importedFrom ? `<span class="st">${STAR}${k(e.importedFrom.stars)}</span>` : ''}${freshTag(e.updatedAt, now, STEPS)}</span></span></a>`).join('') || '<p class="empty">Nothing imported yet.</p>';
  } else {
    const list = ITEMS.filter((x) => !cat || x.cat === cat).sort((a, b) => (sort === 'top' ? b.stars - a.stars : b.pushed - a.pushed));
    rows = list.map((x) => {
      const [owner, name] = x.full.split('/');
      const there = onForq.get(x.full.toLowerCase());
      return `<a class="pr" href="${ghPath(x.full)}">${avatar(owner)}<span class="bd">
<span class="n"><span class="o">${esc(owner)} /</span> ${esc(name)}</span><span class="d">${esc(x.desc)}</span>
<span class="m"><span class="st">${STAR}${k(x.stars)}</span>${sort === 'updated' ? freshTag(x.pushed, now, [365 * 24, 90 * 24, 30 * 24, 7 * 24]) : ''}<span class="tg">${esc(CAT_LABEL[x.cat] || x.cat)}</span><span>${esc(x.license)}</span>${there ? '<span class="onforq">On forq</span>' : ''}</span></span></a>`;
    }).join('');
  }
  return `<p class="intro3">Open-source projects that run in your browser. Open one to read about it; import it to run it here, fork it and change it with agents.</p>
${cats}${sorts}<div class="plist">${rows}</div>`;
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
<div class="gh-meta"><span class="st">${STAR}${k(x.stars)} stars</span><span>${esc(x.license)}</span>${x.lang ? `<span>${esc(x.lang)}</span>` : ''}<span class="tg">${esc(CAT_LABEL[x.cat] || x.cat)}</span><span>updated ${freshTag(x.pushed, now, [365 * 24, 90 * 24, 30 * 24, 7 * 24])}</span></div>
<div class="gh-acts">${action}<a class="chipbtn" href="https://github.com/${esc(x.full)}" target="_blank" rel="noopener">GitHub</a>${x.homepage ? `<a class="chipbtn" href="${esc(x.homepage)}" target="_blank" rel="noopener">Live demo</a>` : ''}</div>
<p class="gh-note">${there ? `Already imported as ${esc(there.owner)} / ${esc(there.name)}: open it to run it, fork it and change it with agents.` : 'Importing copies its latest commit into forq, runs it on its own address, and gives you a project you can fork and change with agents.'}</p>
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
