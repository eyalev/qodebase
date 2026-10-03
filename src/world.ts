// The home page's body under D's top tabs: Projects (the GitHub catalogue and what is
// on forq, src/catalog.ts) and People (who made them). Real data only: the made-up
// sample world and its Happening feed were removed (Eyal, 2026-10-03: "confusing").
// The sub-tabs come first on every view, so they never move when you switch.

import type { Entry } from './registry';
import { catalogBody, peopleBody } from './catalog';

export const WORLD_CSS = `
.sample{display:flex;gap:8px;align-items:center;margin:0 0 8px;padding:6px 10px;border:1px dashed var(--line);border-radius:8px;font-size:13px;color:var(--dim)}
.pulse{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 0 16px}
.pulse div{background:var(--card);border-radius:12px;padding:8px 12px}
.pulse b{display:block;font-size:20px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.2}
.pulse span{font-size:13px;color:var(--dim);white-space:nowrap}
.pulse .live b{display:flex;align-items:center;gap:6px}
.pulse .live b::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--busy);animation:pulse 1.6s ease-in-out infinite}
.lede2{font-size:17px;line-height:1.35;margin:0 0 12px;font-weight:500}
.sub3{position:sticky;top:0;z-index:5;display:flex;gap:4px;margin:0 -16px 12px;padding:6px 16px;background:var(--bg);border-bottom:1px solid var(--line)}
.sub3 a{flex:1;text-align:center;min-height:36px;display:flex;align-items:center;justify-content:center;border-radius:8px;color:var(--dim);font:500 14px 'Instrument Sans',sans-serif}
.sub3 a.on{background:var(--chip);color:var(--fg)}
.feed{display:flex;flex-direction:column}
.ev{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}
.av{flex:none;width:36px;height:36px;border-radius:50%;background:var(--chip);color:var(--fg);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:15px}
.ev .tx{flex:1;min-width:0;font-size:15px;line-height:1.4}
.ev .tx b{font-weight:600}
.ev .what{display:block;margin-top:4px;padding:8px 10px;background:var(--card);border-radius:8px;font-size:14px}
.ev .what.k-x{border-left:3px solid var(--warn)}
.ev .what.k-m{border-left:3px solid var(--acc)}
.ev .what.k-a{border-left:3px solid var(--busy)}
.ev .meta2{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:13px;color:var(--dim)}
.sec2{font-size:13px;font-weight:600;color:var(--dim);margin:20px 0 8px}
.sec2:first-child{margin-top:4px}
.cards2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.pc{position:relative;display:flex;flex-direction:column;gap:6px;background:var(--card);border-radius:12px;padding:12px;color:inherit;min-height:132px}
.pc .tile{width:40px;height:40px;border-radius:8px;background:var(--bg);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-weight:600}
.pc .n{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pc .o{color:var(--dim);font-weight:400}
.pc .d{font-size:13px;color:var(--dim);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pc .s{margin-top:auto;display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dim)}
.pc .s.busy{color:var(--fg)}
.pc .s.busy .dot{background:var(--busy);animation:pulse 1.6s ease-in-out infinite}
.cats{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:0 -16px 8px;padding:0 16px}
.cats::-webkit-scrollbar{display:none}
.cats a{flex:none;display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 12px;border-radius:8px;border:1px solid var(--line);color:var(--fg);font:500 14px 'Instrument Sans',sans-serif}
.cats a span{color:var(--dim);font-variant-numeric:tabular-nums}
.cats a.on{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.cats a.on span{color:color-mix(in srgb,var(--bg) 70%,var(--fg))}
.sorts{display:flex;align-items:center;gap:16px;margin:4px 0 4px;font-size:14px}
.sorts a{color:var(--dim);font-weight:500;padding:8px 0;border-bottom:2px solid transparent}
.sorts a.on{color:var(--fg);border-bottom-color:var(--fg)}
.sorts .why{margin-left:auto;font-size:12px;color:var(--dim)}
.plist{display:flex;flex-direction:column}
.pr{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--line);color:inherit}
.pr .tile{flex:none;width:44px;height:44px;border-radius:8px;background:var(--card);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:17px}
.pr .bd{flex:1;min-width:0}
.pr .n{display:block;font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pr .n .o{color:var(--dim);font-weight:400}
.pr .d{display:block;font-size:14px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px}
.pr .m{display:flex;align-items:center;flex-wrap:wrap;gap:4px 12px;margin-top:6px;font-size:13px;color:var(--dim);font-variant-numeric:tabular-nums}
.pr .m .st{display:inline-flex;align-items:center;gap:4px;color:var(--fg);font-weight:500}
.pr .m .up{color:var(--acc);font-weight:500}
.pr .m .f{display:inline-flex;align-items:center;gap:4px}
.pr .m .w{display:inline-flex;align-items:center;gap:6px;color:var(--fg)}
.pr .m .w .dot{background:var(--busy);animation:pulse 1.6s ease-in-out infinite}
.pr .tg{display:inline-block;font-size:12px;color:var(--dim);background:var(--chip);border-radius:4px;padding:1px 6px}
.ic{flex:none}
.people{display:flex;flex-direction:column}
.pp{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}
.pp .av{width:44px;height:44px;font-size:17px}
.pp .tx{flex:1;min-width:0}
.pp b{display:block;font-weight:600}
.pp .tx span{font-size:13px;color:var(--dim)}
@media (min-width:700px){.cards2{grid-template-columns:repeat(3,1fr)}}
@media (hover:hover){.pc:hover{background:var(--chip)}}
`;

export type WorldTab = 'projects' | 'people';

export function worldBody(tab: WorldTab, real: Entry[], signedIn: boolean, opts: { tag?: string; sort?: string } = {}) {
  const sub = (id: WorldTab, labelT: string) => `<a href="/${id === 'projects' ? '' : `?s=${id}`}" data-tab="${id}" class="${tab === id ? 'on' : ''}"${tab === id ? ' aria-current="page"' : ''}>${labelT}</a>`;
  const head = `<nav class="sub3" aria-label="Home">${sub('projects', 'Projects')}${sub('people', 'People')}</nav>`;
  // Both views are in the page; switching between them, and between categories and
  // sorts, happens in place (no request), keeping the URL in step.
  const body = `<section data-panel="projects"${tab === 'projects' ? '' : ' hidden'}>${catalogBody(real, { cat: opts.tag, sort: opts.sort })}</section>
<section data-panel="people"${tab === 'people' ? '' : ' hidden'}>${peopleBody(real)}</section>`;
  return `${head}${body}${signedIn ? '' : '<p class="empty" style="margin-top:20px"><a href="/login">Sign in</a> to import projects, fork them and run agents with your own Anthropic API key.</p>'}
<script>${HOME_JS}</script>${SPECULATE}`;
}

/** Chrome builds the next page as a finger lands on a link (eagerness "moderate":
 *  pointerdown on a phone, hover on a desktop), so opening a project is instant.
 *  GET pages only; never sign-in, the API, agent terminals or feedback. */
export const SPECULATE = `<script type="speculationrules">${JSON.stringify({
  prerender: [{ where: { and: [{ href_matches: '/*' }, { not: { href_matches: ['/api/*', '/login*', '/logout*', '/a/*', '/feedback*', '/e*'] } }] }, eagerness: 'moderate' }],
})}</script>`;

/** In-place switching for the home page: tabs, categories, sort; the URL follows. */
const HOME_JS = String.raw`(function(){
 const list=document.querySelector('.plist[data-list=gh]'),forq=document.querySelector('.plist[data-list=forq]'),sorts=document.querySelector('.sorts'),view=document.getElementById('view');
 if(!list)return;
 const rows=[...list.children];
 const read=()=>{const u=new URLSearchParams(location.search);return{s:u.get('s')==='people'?'people':'projects',cat:u.get('cat')||u.get('tag')||'',sort:u.get('sort')==='updated'?'updated':'top'};};
 let st=read(),last={cat:st.cat,sort:st.sort};
 const url=()=>st.s==='people'?'/?s=people':'/'+(([st.cat?'cat='+st.cat:'',st.sort==='updated'?'sort=updated':''].filter(Boolean).join('&'))?'?'+[st.cat?'cat='+st.cat:'',st.sort==='updated'?'sort=updated':''].filter(Boolean).join('&'):'');
 function apply(push){
  for(const a of document.querySelectorAll('.sub3 a')){const on=a.dataset.tab===st.s;a.classList.toggle('on',on);on?a.setAttribute('aria-current','page'):a.removeAttribute('aria-current');}
  for(const p of document.querySelectorAll('[data-panel]'))p.hidden=p.dataset.panel!==st.s;
  if(st.s==='projects'){
   for(const a of document.querySelectorAll('.cats a'))a.classList.toggle('on',a.dataset.cat===st.cat);
   for(const a of document.querySelectorAll('.sorts a'))a.classList.toggle('on',a.dataset.sort===st.sort);
   sorts.querySelector('.why').textContent=st.sort==='top'?'most GitHub stars':'latest commit first';
   const isForq=st.cat==='forq';sorts.hidden=isForq;list.hidden=isForq;forq.hidden=!isForq;
   list.classList.toggle('by-upd',st.sort==='updated');
   const key=st.sort==='top'?'stars':'pushed';
   rows.sort((a,b)=>Number(b.dataset[key])-Number(a.dataset[key]));
   for(const r of rows){r.hidden=!(!st.cat||(st.cat==='runs'?r.hasAttribute('data-runs'):r.dataset.cat===st.cat));list.appendChild(r);}
   document.querySelector('.cats a.on')?.scrollIntoView({inline:'center',block:'nearest'});
  }
  if(push){history.pushState(null,'',url());if(view)view.scrollTop=0;}
 }
 document.addEventListener('click',(e)=>{
  if(e.metaKey||e.ctrlKey||e.shiftKey||e.button)return;
  const t=e.target.closest('.sub3 a[data-tab]'),c=e.target.closest('.cats a[data-cat]'),o=e.target.closest('.sorts a[data-sort]');
  if(!t&&!c&&!o)return;e.preventDefault();
  if(t){if(st.s===t.dataset.tab)return;if(st.s==='projects')last={cat:st.cat,sort:st.sort};st.s=t.dataset.tab;if(st.s==='projects'){st.cat=last.cat;st.sort=last.sort;}}
  if(c)st.cat=c.dataset.cat;
  if(o)st.sort=o.dataset.sort;
  apply(true);});
 addEventListener('popstate',()=>{st=read();apply(false);});
 document.querySelector('.cats a.on')?.scrollIntoView({inline:'center',block:'nearest'});
})();`;
