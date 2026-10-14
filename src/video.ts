// The video page (qb5, 2026-10-14, Eyal approved): qodebase.app/video, unlisted (linked from nowhere, noindex), always
// plays the LATEST cut of the qodebase video, for Eyal to watch and send to friends. Files live in R2 qodebase-video
// (binding VIDEO, forq account) under versioned names; latest.json points at the current one. Published by
// scripts/video-publish.sh <file.mp4> [file.srt] (uploads mp4 + a poster frame + WebVTT captions, then moves the pointer).
//
//   GET /video                the page (player, captions, share button, og tags for link previews)
//   GET|HEAD /video/file/<f>  a published file, with Range requests (seeking on phones); immutable, cached a year
import type { Env } from './env';
import { shell } from './ui';

type Chapter = { t: number; title: string };
type Latest = { v: string; mp4: string; jpg?: string; vtt?: string; chapters?: Chapter[]; title?: string; description?: string; bytes?: number; duration?: number; w?: number; h?: number; at?: number };
const NAME_RE = /^[\w.-]{1,120}$/;
const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const log = (event: string, data: Record<string, unknown>) => console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', module: 'video', event, ...data }));
let memo: { at: number; v: Latest | null } | null = null;
async function latest(env: Env): Promise<Latest | null> {
  if (memo && Date.now() - memo.at < 30_000) return memo.v;
  const o = await env.VIDEO!.get('latest.json');
  const v = o ? (await o.json() as Latest) : null;
  memo = { at: Date.now(), v };
  return v;
}
const TYPES: Record<string, string> = { mp4: 'video/mp4', jpg: 'image/jpeg', vtt: 'text/vtt; charset=utf-8', srt: 'text/plain; charset=utf-8', json: 'application/json' };

export async function videoRoute(request: Request, env: Env, url: URL): Promise<Response | null> {
  const p = url.pathname;
  if (p !== '/video' && p !== '/video/' && !p.startsWith('/video/file/') && p !== '/video/chapters.vtt') return null;
  if (!env.VIDEO) return new Response('Not on this copy.', { status: 404 });
  if (p.startsWith('/video/file/')) return file(request, env, p.slice('/video/file/'.length));
  if (p === '/video/chapters.vtt') {   // the current cut's chapters as a WebVTT chapters track (from latest.json)
    const v = await latest(env), ch = chaptersOf(v);
    if (!ch.length) return new Response('Not found', { status: 404 });
    return new Response(chaptersVtt(ch, v!.duration || 0), { headers: { 'content-type': 'text/vtt; charset=utf-8', 'cache-control': 'public, max-age=60' } });
  }
  const v = await latest(env);
  return new Response(page(v, url.origin), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'x-robots-tag': 'noindex, nofollow' } });
}

/** One published file. Range requests answer 206 with the slice R2 reads (a phone seeks without the whole file). */
async function file(request: Request, env: Env, name: string) {
  if (!NAME_RE.test(name) || name === 'latest.json') return new Response('Not found', { status: 404 });
  const ext = name.split('.').pop() || '';
  const head = await env.VIDEO!.head(name);
  if (!head) return new Response('Not found', { status: 404 });
  const size = head.size;
  const base = { 'content-type': TYPES[ext] || 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=31536000, immutable', etag: head.httpEtag, 'x-robots-tag': 'noindex' };
  if (request.method === 'HEAD') return new Response(null, { headers: { ...base, 'content-length': String(size) } });
  const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
  if (m && (m[1] || m[2])) {
    let start: number, end: number;
    if (m[1]) { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; } else { const n = Math.min(Number(m[2]), size); start = size - n; end = size - 1; }
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    const o = await env.VIDEO!.get(name, { range: { offset: start, length: end - start + 1 } });
    if (!o) return new Response('Not found', { status: 404 });
    return new Response(o.body, { status: 206, headers: { ...base, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) } });
  }
  const o = await env.VIDEO!.get(name);
  if (!o) return new Response('Not found', { status: 404 });
  if (ext === 'mp4') log('play', { name, size });
  return new Response(o.body, { headers: { ...base, 'content-length': String(size) } });
}

// Chapters (qb3's times, Eyal 2026-10-14): latest.json "chapters": [{t: seconds, title}], set by scripts/video-publish.sh
// (CHAPTERS=<file>) or scripts/video-chapters.sh. Sorted, deduplicated, inside the cut.
function chaptersOf(v: Latest | null): Chapter[] {
  const d = v?.duration || Infinity;
  return (v?.chapters || []).filter((c) => c && Number.isFinite(c.t) && c.t >= 0 && c.t < d && c.title).sort((a, b) => a.t - b.t);
}
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const vttTime = (t: number) => { const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`; };
function chaptersVtt(ch: Chapter[], dur: number) {
  return 'WEBVTT\n\n' + ch.map((c, i) => `${i + 1}\n${vttTime(c.t)} --> ${vttTime(ch[i + 1]?.t ?? (dur || c.t + 1))}\n${c.title.replace(/\n/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;')}\n`).join('\n');
}

function page(v: Latest | null, origin: string) {
  const title = v?.title || 'qodebase: many AI agents, one codebase';
  const desc = v?.description || 'A short film about qodebase: a git platform where many AI agents change one codebase at once and their work lands by itself.';
  const f = (n?: string) => (n ? `/video/file/${encodeURIComponent(n)}` : '');
  const ch = chaptersOf(v);
  const head = `<meta name="robots" content="noindex, nofollow">
<meta name="description" content="${esc(desc)}">
<meta property="og:site_name" content="qodebase"><meta property="og:type" content="video.other">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${origin}/video">
${v?.jpg ? `<meta property="og:image" content="${origin}${f(v.jpg)}"><meta property="og:image:width" content="1280"><meta property="og:image:height" content="${v.w && v.h ? Math.round((v.h * 1280) / v.w) : 720}"><meta name="twitter:card" content="summary_large_image">` : ''}
${v?.mp4 ? `<meta property="og:video" content="${origin}${f(v.mp4)}"><meta property="og:video:type" content="video/mp4">` : ''}
<style>
.vid{display:grid;gap:12px;max-width:960px;margin:0 auto}
.vid h1{margin:0;font-size:24px;line-height:1.2;letter-spacing:-.02em}
.vid .lede{margin:0;color:var(--dim);font-size:15px;max-width:62ch}
.vid video{display:block;width:100%;max-height:78dvh;border-radius:12px;background:#000;aspect-ratio:${v?.w && v?.h ? `${v.w}/${v.h}` : '16/9'}}
.vid .vrow{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center}
.vid .share{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 16px;border:0;border-radius:10px;background:var(--acc);color:var(--acc-fg);font-family:inherit;font-weight:500;font-size:15px;cursor:pointer}
.vid .share svg{width:18px;height:18px}
.vid .cc{min-width:44px;min-height:44px;padding:0 12px;border:0;border-radius:10px;background:var(--card);box-shadow:inset 0 0 0 1px var(--line);color:var(--dim);font-family:inherit;font-weight:600;font-size:14px;cursor:pointer}
.vid .cc[aria-pressed=true]{background:var(--acc-soft,var(--chip));color:var(--acc);box-shadow:inset 0 0 0 1.5px var(--acc)}
.vid .meta{color:var(--dim);font-size:13px;font-variant-numeric:tabular-nums}
.vid .vnote{color:var(--dim);font-size:14px;margin:0}
.vid .vnote:empty{display:none}
.vid .site{color:var(--acc)}
.vid .chap h2{margin:8px 0 4px;font-size:16px;font-weight:600}
.vid .chap ol{list-style:none;margin:0;padding:0;display:grid;border-radius:12px;background:var(--card);box-shadow:inset 0 0 0 1px var(--line);overflow:hidden}
.vid .chap li+li{box-shadow:inset 0 1px 0 var(--line)}
.vid .chap button{display:flex;gap:12px;align-items:baseline;width:100%;min-height:44px;padding:10px 14px;border:0;background:none;color:var(--fg);font:inherit;font-size:15px;text-align:left;cursor:pointer}
.vid .chap time{flex:none;min-width:3.2em;color:var(--dim);font-variant-numeric:tabular-nums}
.vid .chap button[aria-current=true]{background:var(--acc-soft,var(--chip))}
.vid .chap button[aria-current=true] time{color:var(--acc)}
@media (hover:hover){.vid .chap button:hover{background:var(--chip)}}
</style>`;
  const body = !v ? `<section class="vid"><h1>No video yet</h1><p class="lede">The first cut is not published yet.</p></section>` : `<section class="vid">
<h1>${esc(title)}</h1>
<p class="lede">${esc(desc)}</p>
<video controls playsinline preload="metadata"${v.jpg ? ` poster="${f(v.jpg)}"` : ''} aria-label="${esc(title)}">
<source src="${f(v.mp4)}" type="video/mp4">
${v.vtt ? `<track kind="captions" src="${f(v.vtt)}" srclang="en" label="English">` : ''}${ch.length ? '<track kind="chapters" src="/video/chapters.vtt" srclang="en" label="Chapters">' : ''}
</video>
<div class="vrow"><button type="button" class="share" id="share"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13"/></svg>Share</button>
${v.vtt ? '<button type="button" class="cc" id="cc" aria-pressed="false" aria-label="Captions">CC</button>' : ''}<span class="meta">${v.duration ? `${Math.floor(v.duration / 60)}:${String(Math.floor(v.duration % 60)).padStart(2, '0')}` : ''}${v.at ? `${v.duration ? ', ' : ''}cut of ${new Date(v.at).toISOString().slice(0, 10)}` : ''}</span>
<a class="site" href="/">Try qodebase</a></div>
<p class="vnote" id="note" role="status" aria-live="polite"></p>
${ch.length ? `<nav class="chap" aria-labelledby="chap-h"><h2 id="chap-h">Chapters</h2><ol>${ch.map((c) => `<li><button type="button" data-t="${c.t}"><time>${clock(c.t)}</time><span>${esc(c.title)}</span></button></li>`).join('')}</ol></nav>` : ''}
</section>
<script>(function(){
// Captions: off unless this device turned them on (Eyal, 2026-10-14); the CC button and the player's own menu agree.
var cc=document.getElementById('cc'),vd=document.querySelector('.vid video'),K='qb-video-cc';
function tr(){return vd&&vd.textTracks&&vd.textTracks[0];}
function setCC(on,keep){var t=tr();if(t)t.mode=on?'showing':'hidden';if(cc)cc.setAttribute('aria-pressed',on?'true':'false');if(keep){try{localStorage.setItem(K,on?'1':'0');}catch(e){}}}
var want=false;try{want=localStorage.getItem(K)==='1';}catch(e){}
setCC(want,false);if(vd)vd.addEventListener('loadedmetadata',function(){setCC(want,false);});
if(cc)cc.addEventListener('click',function(){var t=tr();want=!(t&&t.mode==='showing');setCC(want,true);});
if(vd&&vd.textTracks)vd.textTracks.addEventListener('change',function(){var t=tr();if(t&&cc)cc.setAttribute('aria-pressed',t.mode==='showing'?'true':'false');});
})();
(function(){
// Chapters: a tap seeks and plays; the chapter playing now is marked.
var vd=document.querySelector('.vid video'),bs=[].slice.call(document.querySelectorAll('.chap button[data-t]'));if(!vd||!bs.length)return;
bs.forEach(function(b){b.addEventListener('click',function(){vd.currentTime=+b.dataset.t;var p=vd.play();if(p&&p.catch)p.catch(function(){});});});
function mark(){var t=vd.currentTime,k=-1;bs.forEach(function(b,i){if(+b.dataset.t<=t+0.25)k=i;});bs.forEach(function(b,i){b.setAttribute('aria-current',i===k&&(t>0||!vd.paused)?'true':'false');});}
vd.addEventListener('timeupdate',mark);vd.addEventListener('seeked',mark);
})();
(function(){var b=document.getElementById('share'),n=document.getElementById('note'),u=location.origin+'/video';
b.addEventListener('click',function(){var d={title:${JSON.stringify(title)},text:${JSON.stringify(desc)},url:u};
if(navigator.share){navigator.share(d).catch(function(){});return;}
var done=function(){n.textContent='Link copied: '+u;};
if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(u).then(done,function(){n.textContent=u;});}else{n.textContent=u;}});})();</script>`;
  return shell(`${title}`, body).replace('</head>', `${head}</head>`);
}
