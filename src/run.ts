// Run host: https://forq-run.kapps.dev/<repo>/<path> serves a repo's files
// straight from Artifacts, so every project AND every agent fork is a live app
// with no build step (static apps; v0). A separate origin from the UI, so an
// app's script can never reach forq's API or Access cookie.
//
// Cost bounds: the branch head is memoised per colo for HEAD_TTL_S; files are
// memoised per colo by commit hash (immutable), so a page view is at most one
// log() + one readFile() per file per colo per commit. Crawlers are refused
// before any of it (v0 is demo content; noindex everywhere).

import { log } from './box';
import type { Env } from './env';

const HEAD_TTL_S = 15;
// Bump when what we serve for the same commit changes (e.g. the storage shim),
// or the per-commit cache keeps answering with the old bytes for a day.
const SERVE_V = 2;
const FILE_TTL_S = 86400;
const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  ico: 'image/x-icon', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', woff2: 'font/woff2',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', webmanifest: 'application/manifest+json', wasm: 'application/wasm',
};

const deny = (status: number, msg: string, extra: Record<string, string> = {}) =>
  new Response(msg, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'x-robots-tag': 'noindex', ...extra } });

export async function serveRun(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const cf = (request as any).cf || {};
  if (cf.verifiedBotCategory || cf.botManagement?.verifiedBot) return deny(403, 'not for crawlers', { 'retry-after': '86400' });
  if (request.method !== 'GET' && request.method !== 'HEAD') return deny(405, 'GET only');
  const url = new URL(request.url);
  if (url.pathname === '/robots.txt') return deny(200, 'User-agent: *\nDisallow: /\n');
  const m = url.pathname.match(/^\/([a-z0-9][a-z0-9.-]*\.[a-z0-9-]+(?:--[a-z0-9]+)?)(\/.*)?$/);
  if (!m) return deny(404, 'not found');
  const [, repoName, rest] = m;
  if (!rest) return Response.redirect(`${url.origin}/${repoName}/`, 301);
  let path = decodeURIComponent(rest.slice(1));
  if (path === '' || path.endsWith('/')) path += 'index.html';
  if (path.split('/').some((s) => s === '..' || s.startsWith('.git'))) return deny(404, 'not found');

  const cache = caches.default;
  const headKey = new Request(`https://${env.RUN_HOST}/__head/${repoName}`);
  let head = await cache.match(headKey).then((r) => r?.text());
  if (!head) {
    try {
      using repo = await env.ARTIFACTS.get(repoName);
      head = (await repo.log({ ref: 'main', limit: 1 }))[0]?.hash;
    } catch (e) {
      log('run', 'head_failed', { repoName, err: String(e) });
    }
    if (!head) return deny(404, 'no such project, or nothing pushed yet');
    ctx.waitUntil(cache.put(headKey, new Response(head, { headers: { 'cache-control': `max-age=${HEAD_TTL_S}` } })));
  }

  const fileKey = new Request(`https://${env.RUN_HOST}/__f${SERVE_V}/${repoName}/${head}/${encodeURIComponent(path)}`);
  const hit = await cache.match(fileKey);
  if (hit) return withHeaders(hit, head);

  let blob: Blob | null = null;
  try {
    using repo = await env.ARTIFACTS.get(repoName);
    blob = await repo.readFile({ ref: head, path });
    if (!blob && !path.endsWith('.html') && !/\.[a-z0-9]+$/i.test(path)) {
      path = `${path}/index.html`;
      blob = await repo.readFile({ ref: head, path });
    }
  } catch (e) {
    log('run', 'read_failed', { repoName, path, err: String(e) });
  }
  if (!blob) return deny(404, `${path} is not in ${repoName}`);
  const ext = (path.split('.').pop() || '').toLowerCase();
  let body: ArrayBuffer | string = await blob.arrayBuffer();
  if (ext === 'html' || ext === 'htm') {
    // The shim goes before anything else in the document, so it runs before
    // the app's own scripts (which may read storage at parse time).
    const text = new TextDecoder().decode(body);
    const at = text.search(/<head[^>]*>/i);
    const doctype = text.match(/^\s*<!doctype[^>]*>/i);
    body = at >= 0
      ? text.replace(/<head[^>]*>/i, (m) => m + storageShim(repoName))
      // No <head>: after the doctype, never before it (that flips quirks mode).
      : doctype ? doctype[0] + storageShim(repoName) + text.slice(doctype[0].length) : storageShim(repoName) + text;
  }
  const res = new Response(body, {
    headers: { 'content-type': TYPES[ext] || blob.type || 'application/octet-stream', 'cache-control': `max-age=${FILE_TTL_S}` },
  });
  ctx.waitUntil(cache.put(fileKey, res.clone()));
  return withHeaders(res, head);
}

// Every repo and fork shares this one origin, so their browser storage would
// mix (eyal/todo's tasks showed up in forq/todo). Each HTML page therefore gets
// this first: localStorage and sessionStorage become views prefixed with the
// repo name. Covers getItem/setItem/removeItem/clear/key/length and property
// access (storage.foo = …). Not covered: cookies, IndexedDB, Cache Storage —
// static demo apps here use none; a per-repo origin would be the full answer.
function storageShim(repo: string) {
  return `<script>/* forq: storage scoped to ${repo} */(function(){var P=${JSON.stringify(repo + '::')};
function scope(real){var own=function(){var k=[];for(var i=0;i<real.length;i++){var n=real.key(i);if(n&&n.indexOf(P)===0)k.push(n.slice(P.length));}return k;};
var api={getItem:function(k){return real.getItem(P+k);},setItem:function(k,v){real.setItem(P+k,String(v));},removeItem:function(k){real.removeItem(P+k);},
clear:function(){own().forEach(function(k){real.removeItem(P+k);});},key:function(i){var k=own();return i<k.length?k[i]:null;}};
return new Proxy(api,{get:function(t,k){if(k==='length')return own().length;if(k in api)return api[k];if(typeof k==='symbol')return undefined;return real.getItem(P+k)===null?undefined:real.getItem(P+k);},
set:function(t,k,v){if(k in api)return false;real.setItem(P+k,String(v));return true;},deleteProperty:function(t,k){real.removeItem(P+k);return true;},
has:function(t,k){return k in api||real.getItem(P+k)!==null;},ownKeys:function(){return own();},getOwnPropertyDescriptor:function(t,k){var v=real.getItem(P+k);return v===null?undefined:{value:v,enumerable:true,configurable:true,writable:true};}});}
['localStorage','sessionStorage'].forEach(function(n){try{var real=window[n];var s=scope(real);Object.defineProperty(window,n,{get:function(){return s;},configurable:true});}catch(e){}});})();</script>`;
}

function withHeaders(r: Response, head: string) {
  const out = new Response(r.body, r);
  out.headers.set('cache-control', 'no-cache');   // the browser rechecks; our per-commit cache answers
  out.headers.set('x-robots-tag', 'noindex');
  out.headers.set('x-forq-commit', head.slice(0, 12));
  out.headers.set('referrer-policy', 'no-referrer');
  return out;
}
