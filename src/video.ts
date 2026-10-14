// The video page (qb5, 2026-10-14, Eyal approved): qodebase.app/video, unlisted (linked from nowhere, noindex), always
// plays the LATEST cut of the qodebase video, for Eyal to watch and send to friends. Files live in R2 qodebase-video
// (binding VIDEO, forq account) under versioned names; latest.json points at the current one. Published by
// scripts/video-publish.sh <file.mp4> [file.srt] (uploads mp4 + a poster frame + WebVTT captions, then moves the pointer).
//
//   GET /video                the page (player, captions, share button, og tags for link previews)
//   GET|HEAD /video/file/<f>  a published file, with Range requests (seeking on phones); immutable, cached a year
import type { Env } from './env';
import { shell } from './ui';

type Latest = { v: string; mp4: string; jpg?: string; vtt?: string; title?: string; description?: string; bytes?: number; duration?: number; w?: number; h?: number; at?: number };
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
  if (p !== '/video' && p !== '/video/' && !p.startsWith('/video/file/')) return null;
  if (!env.VIDEO) return new Response('Not on this copy.', { status: 404 });
  if (p.startsWith('/video/file/')) return file(request, env, p.slice('/video/file/'.length));
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

function page(v: Latest | null, origin: string) {
  const title = v?.title || 'qodebase: many AI agents, one codebase';
  const desc = v?.description || 'A short film about qodebase: a git platform where many AI agents change one codebase at once and their work lands by itself.';
  const f = (n?: string) => (n ? `/video/file/${encodeURIComponent(n)}` : '');
  const head = `<meta name="robots" content="noindex, nofollow">
<meta name="description" content="${esc(desc)}">
<meta property="og:site_name" content="qodebase"><meta property="og:type" content="video.other">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${origin}/video">
${v?.jpg ? `<meta property="og:image" content="${origin}${f(v.jpg)}"><meta property="og:image:width" content="${v.w || 1280}"><meta property="og:image:height" content="${v.h || 720}"><meta name="twitter:card" content="summary_large_image">` : ''}
${v?.mp4 ? `<meta property="og:video" content="${origin}${f(v.mp4)}"><meta property="og:video:type" content="video/mp4">` : ''}
<style>
.vid{display:grid;gap:12px;max-width:960px;margin:0 auto}
.vid h1{margin:0;font-size:24px;line-height:1.2;letter-spacing:-.02em}
.vid .lede{margin:0;color:var(--dim);font-size:15px;max-width:62ch}
.vid video{display:block;width:100%;max-height:78dvh;border-radius:12px;background:#000;aspect-ratio:${v?.w && v?.h ? `${v.w}/${v.h}` : '16/9'}}
.vid .row{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center}
.vid .share{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 16px;border:0;border-radius:10px;background:var(--acc);color:var(--acc-fg);font-family:inherit;font-weight:500;font-size:15px;cursor:pointer}
.vid .share svg{width:18px;height:18px}
.vid .meta{color:var(--dim);font-size:13px;font-variant-numeric:tabular-nums}
.vid .note{color:var(--dim);font-size:14px;min-height:20px}
.vid .site{color:var(--acc)}
</style>`;
  const body = !v ? `<section class="vid"><h1>No video yet</h1><p class="lede">The first cut is not published yet.</p></section>` : `<section class="vid">
<h1>${esc(title)}</h1>
<p class="lede">${esc(desc)}</p>
<video controls playsinline preload="metadata"${v.jpg ? ` poster="${f(v.jpg)}"` : ''} aria-label="${esc(title)}">
<source src="${f(v.mp4)}" type="video/mp4">
${v.vtt ? `<track kind="captions" src="${f(v.vtt)}" srclang="en" label="English" default>` : ''}
</video>
<div class="row"><button type="button" class="share" id="share"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13"/></svg>Share</button>
<span class="meta">${v.duration ? `${Math.floor(v.duration / 60)}:${String(Math.round(v.duration % 60)).padStart(2, '0')}` : ''}${v.at ? `${v.duration ? ', ' : ''}cut of ${new Date(v.at).toISOString().slice(0, 10)}` : ''}</span>
<a class="site" href="/">Try qodebase</a></div>
<p class="note" id="note" role="status" aria-live="polite"></p>
</section>
<script>(function(){var b=document.getElementById('share'),n=document.getElementById('note'),u=location.origin+'/video';
b.addEventListener('click',function(){var d={title:${JSON.stringify(title)},text:${JSON.stringify(desc)},url:u};
if(navigator.share){navigator.share(d).catch(function(){});return;}
var done=function(){n.textContent='Link copied: '+u;};
if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(u).then(done,function(){n.textContent=u;});}else{n.textContent=u;}});})();</script>`;
  return shell(`${title}`, body).replace('</head>', `${head}</head>`);
}
