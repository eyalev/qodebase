// Code browser pages: folder listing, file view, and an agent's changes.
// Server-rendered; syntax colouring by highlight.js (cdnjs) with colours from
// our own tokens, line links (#L12), and a "Go to file" filter fed by one
// cached list of every path at that commit.

import type { ProjectInfo, Agent } from './project';
import type { Blob, Change, Head, TreeEntry } from './code';
import { esc, shell } from './ui';
import { markdown } from './md';

const HLJS = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js';
const JSDIFF = 'https://cdnjs.cloudflare.com/ajax/libs/jsdiff/5.2.0/diff.min.js';
const MAX_HIGHLIGHT_LINES = 4000;

export const CODE_CSS = `<style>
:root{--add:color-mix(in srgb,#2da44e 16%,var(--bg));--del:color-mix(in srgb,#cf222e 14%,var(--bg));--addfg:#1a7f37;--delfg:#cf222e;
 --tk-kw:#8250df;--tk-str:#0a3069;--tk-com:#6e7781;--tk-num:#0550ae;--tk-fn:#953800;--tk-tag:#116329;--tk-attr:#0550ae}
@media (prefers-color-scheme:dark){:root{--addfg:#3fb950;--delfg:#f85149;--tk-kw:#d2a8ff;--tk-str:#a5d6ff;--tk-com:#8b949e;--tk-num:#79c0ff;--tk-fn:#ffa657;--tk-tag:#7ee787;--tk-attr:#79c0ff}}
.vtabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:12px 0 8px}
.vtabs::-webkit-scrollbar{display:none}
.vtabs a{flex:none;min-height:36px;display:inline-flex;align-items:center;padding:0 12px;border-radius:8px;border:1px solid var(--line);color:var(--dim);font-size:14px}
.vtabs a.on{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.crumbs{font:14px 'JetBrains Mono',monospace;margin:12px 0;word-break:break-all;line-height:1.7}
.crumbs a{color:var(--acc)}.crumbs .sep{color:var(--dim);margin:0 4px}
.goto{position:relative;margin:8px 0 12px}
.goto input{width:100%;font:16px 'Instrument Sans',sans-serif;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg)}
.goto .hits{display:none;flex-direction:column;background:var(--card);border:1px solid var(--line);border-radius:8px;margin-top:6px;max-height:50dvh;overflow:auto}
.goto .hits.on{display:flex}
.goto .hits a{padding:10px 12px;font:13px 'JetBrains Mono',monospace;color:var(--fg);border-bottom:1px solid var(--line);word-break:break-all}
.goto .hits a b{color:var(--acc);font-weight:600}
.goto .hits p{margin:0;padding:10px 12px;color:var(--dim);font-size:14px}
.goto .deep{min-height:44px;border:0;border-top:1px solid var(--line);background:var(--chip);color:var(--fg);font:500 14px 'Instrument Sans',sans-serif;text-align:left;padding:0 12px;cursor:pointer}
.goto .sr{border-bottom:1px solid var(--line)}
.goto .sr a.f{display:flex;justify-content:space-between;gap:8px;font-weight:600;border-bottom:0}
.goto .sr a.f span{color:var(--dim);font-weight:400;font-family:'Instrument Sans',sans-serif}
.goto .sr a.l{display:flex;gap:10px;padding:4px 12px 4px 12px;font-size:12px;color:var(--dim);border-bottom:0;white-space:pre;overflow:hidden;text-overflow:ellipsis}
.goto .sr a.l:last-child{padding-bottom:10px}
.goto .sr .ln{flex:none;min-width:2.5em;text-align:right;color:var(--dim)}
.goto .sr .lt{min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--fg)}
.ls{display:flex;flex-direction:column;background:var(--card);border-radius:12px;overflow:hidden}
.ls a{display:flex;align-items:center;gap:10px;min-height:44px;padding:0 14px;border-bottom:1px solid var(--line);color:var(--fg);font:14px 'JetBrains Mono',monospace;word-break:break-all}
.ls a:last-child{border-bottom:0}
.ls .k{width:16px;flex:none;color:var(--dim);font-family:'Instrument Sans',sans-serif;font-size:13px;text-align:center}
.ls .dir{font-weight:600}
.fmeta{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;color:var(--dim);font-size:13px;margin:8px 0}
.fmeta .chipbtn{min-height:36px;padding:0 12px;font-size:14px}
.code{background:var(--card);border-radius:12px;overflow:auto;font:12.5px/1.55 'JetBrains Mono',monospace;-webkit-text-size-adjust:100%}
.code table{border-collapse:collapse;min-width:100%}
.code td{padding:0;vertical-align:top}
.code td.n{position:sticky;left:0;background:var(--card);color:var(--dim);text-align:right;padding:0 10px 0 12px;user-select:none;min-width:2.5em;cursor:pointer}
.code td.c{white-space:pre;padding:0 14px 0 4px}
.code tr.hl td{background:color-mix(in srgb,var(--busy) 18%,var(--card))}
.code tr:first-child td{padding-top:10px}.code tr:last-child td{padding-bottom:10px}
.md{background:var(--card);border-radius:12px;padding:4px 16px;font-size:15px;overflow-wrap:anywhere}
.md img{max-width:100%;height:auto}
.md code{font:13px 'JetBrains Mono',monospace;background:var(--chip);border-radius:4px;padding:1px 4px}
.md .tbl{overflow-x:auto;margin:0 0 14px}
.md table{border-collapse:collapse;font-size:14px;min-width:100%}
.md th,.md td{overflow-wrap:normal;word-break:normal;text-align:left;vertical-align:top;padding:7px 10px;border-bottom:1px solid var(--line)}
.md th{font-weight:600}
.md pre{overflow-x:auto;background:var(--chip);border-radius:8px;padding:10px}
.imgv{background:var(--card);border-radius:12px;padding:16px;text-align:center}.imgv img{max-width:100%;height:auto}
.hljs-keyword,.hljs-built_in,.hljs-selector-tag,.hljs-literal{color:var(--tk-kw)}
.hljs-string,.hljs-regexp,.hljs-template-tag{color:var(--tk-str)}
.hljs-comment,.hljs-quote{color:var(--tk-com);font-style:italic}
.hljs-number,.hljs-symbol{color:var(--tk-num)}
.hljs-title,.hljs-function .hljs-title,.hljs-title.function_{color:var(--tk-fn)}
.hljs-tag,.hljs-name,.hljs-selector-class,.hljs-selector-id{color:var(--tk-tag)}
.hljs-attr,.hljs-attribute,.hljs-property,.hljs-variable{color:var(--tk-attr)}
.chg{display:flex;flex-direction:column;gap:12px}
.chg details{background:var(--card);border-radius:12px;overflow:hidden}
.chg summary{display:flex;align-items:center;gap:8px;min-height:44px;padding:0 14px;cursor:pointer;font:13px 'JetBrains Mono',monospace;word-break:break-all;list-style:none}
.chg summary::-webkit-details-marker{display:none}
.chg .st{font:600 12px 'Instrument Sans',sans-serif;border-radius:4px;padding:1px 6px;flex:none}
.chg .st.added{background:var(--add);color:var(--addfg)}.chg .st.removed{background:var(--del);color:var(--delfg)}.chg .st.modified{background:var(--chip);color:var(--fg)}
.chg .cnt{margin-left:auto;font:12px 'Instrument Sans',sans-serif;color:var(--dim);flex:none}
.chg .cnt .a{color:var(--addfg)}.chg .cnt .d{color:var(--delfg)}
.dl{overflow:auto;font:12px/1.55 'JetBrains Mono',monospace;border-top:1px solid var(--line)}
.dl table{border-collapse:collapse;min-width:100%}
.dl td{white-space:pre;padding:0 12px 0 4px}
.dl td.n{color:var(--dim);text-align:right;padding:0 6px 0 10px;user-select:none;min-width:2.2em}
.dl tr.a td{background:var(--add)}.dl tr.d td{background:var(--del)}
.dl tr.h td{background:var(--chip);color:var(--dim);padding:4px 12px}
.sum{color:var(--dim);font-size:14px;margin:8px 0 16px}.sum .a{color:var(--addfg)}.sum .d{color:var(--delfg)}
</style>`;

/** Version tabs: Live (main) + each agent's fork. `v` = agent short id or ''. */
function versionTabs(info: ProjectInfo, v: string, at: string) {
  const base = `/p/${info.owner}/${info.name}/code/${at}`;
  const agents = info.agents.filter((a) => a.state !== 'stopped');
  return `<nav class="vtabs" aria-label="Version"><a class="${v ? '' : 'on'}" href="${esc(base)}">Live</a>${agents.map((a) => {
    const s = a.id.split('--')[1];
    return `<a class="${v === s ? 'on' : ''}" href="${esc(base)}?v=${s}">${esc(s)}${a.state === 'merged' ? ' (merged)' : ''}</a>`;
  }).join('')}</nav>`;
}

function crumbs(info: ProjectInfo, path: string, v: string) {
  const q = v ? `?v=${v}` : '';
  const segs = path.split('/').filter(Boolean);
  const root = `<a href="/p/${info.owner}/${info.name}/code/${q}">${esc(info.name)}</a>`;
  return `<div class="crumbs">${root}${segs.map((s, i) => {
    const p = segs.slice(0, i + 1).join('/');
    return `<span class="sep">/</span>${i === segs.length - 1 ? esc(s) : `<a href="/p/${info.owner}/${info.name}/code/${esc(p)}/${q}">${esc(s)}</a>`}`;
  }).join('')}</div>`;
}

const gotoBox = (info: ProjectInfo, v: string) => `<div class="goto"><input id="goto" type="search" placeholder="Go to file, or search the code" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="go"><div class="hits" id="hits"></div></div>
<script>(function(){const $i=document.getElementById('goto'),$h=document.getElementById('hits');let files=null;
const esc=(t)=>t.replace(/[<>&"]/g,(c)=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
async function load(){if(files)return files;const r=await fetch('/api/p/${info.owner}/${info.name}/files${v ? `?v=${v}` : ''}');const j=await r.json();files=j.files||[];return files;}
// Matches in the file name rank above matches in folder names; shorter paths first. null = no match.
function score(p,q){const l=p.toLowerCase();const i=l.indexOf(q);if(i<0)return null;const base=l.lastIndexOf('/')+1;return (i>=base?1000:0)-i-p.length/100;}
$i.addEventListener('focus',load);
const API='/api/p/${info.owner}/${info.name}',V='${v ? `?v=${v}` : ''}',VQ='${v ? `&v=${v}` : ''}';
const codeUrl=(f,n)=>'/p/${info.owner}/${info.name}/code/'+encodeURI(f)+V+(n?'#L'+n:'');
const mark=(t,q)=>{const i=t.toLowerCase().indexOf(q);return i<0?esc(t):esc(t.slice(0,i))+'<b>'+esc(t.slice(i,i+q.length))+'</b>'+esc(t.slice(i+q.length));};
let seq=0;
$i.addEventListener('input',async()=>{const q=$i.value.trim().toLowerCase();const my=++seq;if(!q){$h.classList.remove('on');return;}
 const fs=await load();if(my!==seq)return;
 const hits=fs.map((f)=>[f,score(f,q)]).filter((x)=>x[1]!==null).sort((a,b)=>b[1]-a[1]).slice(0,30);
 $h.classList.add('on');
 $h.innerHTML=(hits.length?hits.map(([f])=>'<a href="'+codeUrl(f)+'">'+mark(f,q)+'</a>').join(''):'<p>No file name matches.</p>')+
  (q.length>=3?'<button type="button" class="deep" id="deep">Search file contents for “'+esc($i.value.trim())+'”</button>':'');});
$h.addEventListener('click',async(e)=>{if(!e.target.closest('#deep'))return;const q=$i.value.trim();const my=++seq;
 $h.innerHTML='<p>Searching the code. The first search of a version indexes it, a few seconds.</p>';
 let j;try{const r=await fetch(API+'/search?q='+encodeURIComponent(q)+VQ);j=await r.json();if(!r.ok||j.error)throw new Error(j.error||r.status);}catch(err){if(my===seq)$h.innerHTML='<p>'+esc(err.message)+'</p>';return;}
 if(my!==seq)return;const ql=q.toLowerCase();
 $h.innerHTML='<p>'+(j.results.length?j.results.length+' file'+(j.results.length>1?'s':'')+' contain “'+esc(q)+'”':'No file contains “'+esc(q)+'”')+', '+j.files+' files searched'+(j.skipped?', '+j.skipped+' skipped (binary or large)':'')+'</p>'+
  j.results.map((r)=>'<div class="sr"><a class="f" href="'+codeUrl(r.path)+'">'+esc(r.path)+'<span>'+r.count+'</span></a>'+r.lines.map((l)=>'<a class="l" href="'+codeUrl(r.path,l.n)+'"><span class="ln">'+l.n+'</span><span class="lt">'+mark(l.text.trim(),ql)+'</span></a>').join('')+'</div>').join('');});
})();</script>`;

const head = (info: ProjectInfo, v: string, at: string, title: string, rev?: Head | null) =>
  `${CODE_CSS}<a class="back" href="/p/${info.owner}/${info.name}">${esc(info.owner)} / ${esc(info.name)}</a>
<h1>${esc(title)}</h1>
${versionTabs(info, v, at)}${rev ? `<div class="fmeta"><span>at ${esc(rev.commit.slice(0, 7))}</span><span>${esc(rev.message)}</span></div>` : ''}`;

export function dirPage(o: { info: ProjectInfo; v: string; path: string; entries: TreeEntry[]; readme: string | null; rev: Head | null }) {
  const { info, v, path } = o;
  const q = v ? `?v=${v}` : '';
  const sorted = [...o.entries].sort((a, b) => (a.type === 'tree' ? 0 : 1) - (b.type === 'tree' ? 0 : 1) || a.name.localeCompare(b.name));
  const up = path ? `<a href="/p/${info.owner}/${info.name}/code/${esc(path.split('/').filter(Boolean).slice(0, -1).join('/'))}${path.split('/').filter(Boolean).length > 1 ? '/' : ''}${q}"><span class="k">..</span>up a folder</a>` : '';
  return shell(`${path || info.name} · code · forq`, `${head(info, v, path, 'Code', o.rev)}${gotoBox(info, v)}${crumbs(info, path, v)}
<div class="ls">${up}${sorted.map((e) => `<a class="${e.type === 'tree' ? 'dir' : ''}" href="/p/${info.owner}/${info.name}/code/${esc(path + e.name)}${e.type === 'tree' ? '/' : ''}${q}"><span class="k">${e.type === 'tree' ? '/' : ''}</span>${esc(e.name)}</a>`).join('') || '<p class="empty" style="padding:14px">Empty folder.</p>'}</div>
${o.readme ? `<h2>README</h2><div class="md">${markdown(o.readme)}</div>` : ''}`);
}

const LANG: Record<string, string> = { js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript', jsx: 'javascript', json: 'json', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', css: 'css', scss: 'scss', md: 'markdown', py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', sh: 'bash', yml: 'yaml', yaml: 'yaml', toml: 'ini', c: 'c', h: 'c', cpp: 'cpp', php: 'php', sql: 'sql' };

export function filePage(o: { info: ProjectInfo; v: string; path: string; file: Blob; rev: Head | null; runUrl: string }) {
  const { info, v, path, file } = o;
  const name = path.split('/').pop() || path;
  const ext = (name.split('.').pop() || '').toLowerCase();
  const size = file.bytes >= 1024 ? `${(file.bytes / 1024).toFixed(1)} KB` : `${file.bytes} bytes`;
  const isImg = /^(png|jpe?g|gif|webp|svg|ico|bmp)$/.test(ext);
  const actions = `<a class="chipbtn" href="${esc(o.runUrl)}" target="_blank" rel="noopener">Raw</a>${/^html?$/.test(ext) ? `<a class="chipbtn" href="${esc(o.runUrl)}" target="_blank" rel="noopener">Open in preview</a>` : ''}`;
  let body: string;
  if (isImg) body = `<div class="imgv"><img src="${esc(o.runUrl)}" alt="${esc(name)}"></div>`;
  else if (file.binary) body = `<p class="note">Binary file, not shown.</p>`;
  else if (file.tooBig || file.text === null) body = `<p class="note">Too large to show here (${size}). Use Raw.</p>`;
  else if (ext === 'md') {
    body = `<div class="md">${markdown(file.text)}</div><h2>Source</h2>${codeBlock(file.text, 'markdown')}`;
  } else body = codeBlock(file.text, LANG[ext]);
  const lines = file.text ? file.text.split('\n').length : 0;
  return shell(`${name} · code · forq`, `${head(info, v, path, name, o.rev)}${crumbs(info, path, v)}
<div class="fmeta"><span>${size}</span>${lines ? `<span>${lines} lines</span>` : ''}${actions}</div>${body}`);
}

function codeBlock(text: string, lang?: string) {
  const lines = text.replace(/\n$/, '').split('\n');
  const hl = lang && lines.length <= MAX_HIGHLIGHT_LINES;
  // Highlight the whole file once (multi-line strings/comments stay right),
  // then split the HTML back into lines, re-opening spans across line breaks.
  return `<div class="code" id="code"><table>${lines.map((l, i) => `<tr id="L${i + 1}"><td class="n">${i + 1}</td><td class="c">${esc(l) || ' '}</td></tr>`).join('')}</table></div>
${hl ? `<script src="${HLJS}"></script><script>(function(){try{
 const rows=[...document.querySelectorAll('#code td.c')];const src=rows.map((r)=>r.textContent).join('\\n');
 const html=hljs.highlight(src,{language:${JSON.stringify(lang)},ignoreIllegals:true}).value;
 let open=[];const out=html.split('\\n').map((ln)=>{const pre=open.join('');
  const re=/<span class="([^"]+)">|<\\/span>/g;let m;while((m=re.exec(ln)))m[1]?open.push('<span class="'+m[1]+'">'):open.pop();
  return pre+ln+'</span>'.repeat(open.length);});
 rows.forEach((r,i)=>{r.innerHTML=out[i]||' ';});}catch(e){console.warn('highlight',e)}})();</script>` : ''}
<script>(function(){function mark(){document.querySelectorAll('#code tr.hl').forEach((r)=>r.classList.remove('hl'));const m=location.hash.match(/^#L(\\d+)$/);if(!m)return;const r=document.getElementById('L'+m[1]);if(r){r.classList.add('hl');r.scrollIntoView({block:'center'});}}
 document.getElementById('code').addEventListener('click',(e)=>{const n=e.target.closest('td.n');if(!n)return;history.replaceState(null,'','#L'+n.textContent);mark();
  try{navigator.clipboard.writeText(location.href);n.textContent='copied';setTimeout(()=>{n.textContent=n.parentElement.id.slice(1)},900);}catch{}});
 mark();})();</script>`;
}

export type ChangeText = Change & { oldText: string | null; newText: string | null; note?: string };

export function changesPage(o: { info: ProjectInfo; agent: Agent; changes: ChangeText[]; baseNote: string; previewUrl: string }) {
  const { info, agent, changes } = o;
  const s = agent.id.split('--')[1];
  const data = JSON.stringify(changes.map((c) => ({ p: c.path, s: c.status, a: c.oldText, b: c.newText, n: c.note || null }))).replace(/</g, '\\u003c');
  return shell(`Changes by ${s} · forq`, `${CODE_CSS}<a class="back" href="/p/${info.owner}/${info.name}">${esc(info.owner)} / ${esc(info.name)}</a>
<h1>Changes by agent ${esc(s)}</h1>
<p class="desc">${esc(agent.task)}</p>
<div class="fmeta"><span>${esc(o.baseNote)}</span><a class="chipbtn" href="/p/${info.owner}/${info.name}/code/?v=${s}">Browse its code</a><a class="chipbtn" href="${esc(o.previewUrl)}" target="_blank" rel="noopener">Open its preview</a></div>
<p class="sum" id="sum">${changes.length ? `${changes.length} file${changes.length > 1 ? 's' : ''} changed` : 'No changes yet: the fork matches where it started.'}</p>
<div class="chg" id="chg"></div>
<script src="${JSDIFF}"></script>
<script>(function(){const C=${data};const $c=document.getElementById('chg');let ta=0,td=0;
const esc=(t)=>String(t).replace(/[<>&]/g,(c)=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
for(const c of C){let rows='',a=0,d=0;
 if(c.n){rows='<tr class="h"><td colspan="3">'+esc(c.n)+'</td></tr>';}
 else{const p=Diff.structuredPatch(c.p,c.p,c.a||'',c.b||'','','',{context:3});
  for(const h of p.hunks){rows+='<tr class="h"><td colspan="3">@@ -'+h.oldStart+','+h.oldLines+' +'+h.newStart+','+h.newLines+' @@</td></tr>';let o=h.oldStart,n=h.newStart;
   for(const l of h.lines){const k=l[0],t=esc(l.slice(1))||' ';
    if(k==='+'){a++;rows+='<tr class="a"><td class="n"></td><td class="n">'+(n++)+'</td><td>+'+t+'</td></tr>';}
    else if(k==='-'){d++;rows+='<tr class="d"><td class="n">'+(o++)+'</td><td class="n"></td><td>-'+t+'</td></tr>';}
    else if(k===' '){rows+='<tr><td class="n">'+(o++)+'</td><td class="n">'+(n++)+'</td><td> '+t+'</td></tr>';}}}}
 ta+=a;td+=d;
 const el=document.createElement('details');if(C.length<=6)el.open=true;
 el.innerHTML='<summary><span class="st '+c.s+'">'+c.s+'</span><span>'+esc(c.p)+'</span><span class="cnt"><span class="a">+'+a+'</span> <span class="d">−'+d+'</span></span></summary><div class="dl"><table>'+rows+'</table></div>';
 $c.appendChild(el);}
if(C.length)document.getElementById('sum').innerHTML=C.length+' file'+(C.length>1?'s':'')+' changed, <span class="a">+'+ta+'</span> <span class="d">−'+td+'</span>';
})();</script>`);
}
