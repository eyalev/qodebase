// Run host: every static project and every agent fork is a live app served
// straight from Artifacts, no build step, each on its OWN origin:
//   https://<name>--<owner>.<RUN_HOST>/          a project (owner.name)
//   https://ag-<id>--<name>--<owner>.<RUN_HOST>/ an agent fork (owner.name--id)
// One label, so the zone's universal certificate covers every host. Own
// origins mean apps never share storage, cookies or service workers (until
// 2026-10-02 they shared https://<RUN_HOST>/<repo>/, kept as a 301 to the host
// and, for names too long for one label, as the fallback that still serves).
// Worker projects have their own custom domains on the same names; a request
// for one that reaches forq (its exclusion route missing) is passed through.
// The run domain is separate from the UI, so an app's script can never reach
// forq's API or Access cookie.
//
// Cost bounds: the branch head is memoised per colo for HEAD_TTL_S; files are
// memoised per colo by commit hash (immutable), so a page view is at most one
// log() + one readFile() per file per colo per commit. Crawlers are refused
// before any of it (v0 is demo content; noindex everywhere).

import { log } from './box';
import { repoOfHostLabel, runHost, type Env } from './env';

const HEAD_TTL_S = 15;
// Bump when what we serve for the same commit changes (e.g. the storage shim),
// or the per-commit cache keeps answering with the old bytes for a day.
const SERVE_V = 3;
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
  let repoName: string;
  let rest: string;
  let shim = false;
  if (url.hostname !== env.RUN_HOST) {
    // A project's or fork's own host.
    const label = url.hostname.slice(0, -(env.RUN_HOST.length + 1));
    const repo = label.includes('.') ? null : repoOfHostLabel(label);
    // Two labels deep is a Worker app's preview (<alias>.<name>--<owner>), and a
    // Worker project's host belongs to its own custom domain: hand it on.
    if (!repo || await isWorker(env, repo)) return fetch(request);
    repoName = repo;
    rest = url.pathname;
  } else {
    const m = url.pathname.match(/^\/([a-z0-9][a-z0-9.-]*\.[a-z0-9-]+(?:--[a-z0-9]+)?)(\/.*)?$/);
    if (!m) return deny(404, 'not found');
    repoName = m[1];
    // Old shared-origin links move to the repo's own host, path and query kept.
    const host = runHost(repoName, env.RUN_HOST);
    if (host) return Response.redirect(`https://${host}${m[2] || '/'}${url.search}`, 301);
    if (!m[2]) return Response.redirect(`${url.origin}/${repoName}/`, 301);
    rest = m[2];
    shim = true;   // still a shared origin: scope its storage
  }
  // Private projects (main and agent forks): only with a signed pass, handed out by the
  // project page to people who can see it (index.ts withRunPasses). It arrives once as
  // ?__qb=, becomes a cookie on this host (partitioned, so it works in the project
  // page's preview iframe too), and the URL is cleaned. No pass = no such project.
  const meta = await projectMeta(env, repoName);
  if (meta.private) {
    const slug = repoName.split('--')[0];
    const cookieName = `qbp_${slug.replace(/[^a-z0-9]/g, '_')}`;
    const given = url.searchParams.get('__qb');
    if (given) {
      if (!(await checkRunPass(env, slug, given))) return deny(404, 'no such project');
      url.searchParams.delete('__qb');
      return new Response(null, { status: 302, headers: { location: url.pathname + (url.search || ''), 'cache-control': 'no-store',
        'set-cookie': `${cookieName}=${given}; Path=/; Max-Age=${PASS_TTL_S}; HttpOnly; Secure; SameSite=None; Partitioned` } });
    }
    const c = (request.headers.get('cookie') || '').match(new RegExp(`${cookieName}=([0-9a-f.]+)`));
    if (!c || !(await checkRunPass(env, slug, c[1]))) return deny(404, 'no such project');
  }
  let path = decodeURIComponent(rest.slice(1));
  if (path === '' || path.endsWith('/')) path += 'index.html';
  if (path.split('/').some((s) => s === '..' || s.startsWith('.git'))) return deny(404, 'not found');

  const cache = caches.default;
  const headKey = new Request(`https://${env.RUN_HOST}/__head/${repoName}`);
  let head = await cache.match(headKey).then((r) => r?.text());
  if (!head) {
    try {
      using repo = await env.ARTIFACTS.get(repoName);
      head = (await repo.log({ limit: 1 }))[0]?.hash;   // HEAD = the repo's default branch (main, master, gh-pages…)
    } catch (e) {
      log('run', 'head_failed', { repoName, err: String(e) });
    }
    if (!head) return deny(404, 'no such project, or nothing pushed yet');
    ctx.waitUntil(cache.put(headKey, new Response(head, { headers: { 'cache-control': `max-age=${HEAD_TTL_S}` } })));
  }

  const fileKey = new Request(`https://${env.RUN_HOST}/__f${SERVE_V}${shim ? 's' : ''}/${repoName}/${head}/${encodeURIComponent(path)}`);
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
  if (shim && (ext === 'html' || ext === 'htm')) {
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

/** A repo's project: Worker project? private? Memoised per isolate for a minute (so
 *  making a project private closes its app within a minute everywhere). */
const kinds = new Map<string, { worker: boolean; private: boolean; at: number }>();
async function projectMeta(env: Env, repo: string): Promise<{ worker: boolean; private: boolean }> {
  const slug = repo.split('--')[0];
  const hit = kinds.get(slug);
  if (hit && Date.now() - hit.at < 60_000) return hit;
  const info = await env.Project.get(env.Project.idFromName(slug)).info().catch(() => null);
  const meta = { worker: info?.kind === 'worker', private: !!info?.private, at: Date.now() };
  kinds.set(slug, meta);
  return meta;
}
const isWorker = async (env: Env, repo: string) => (await projectMeta(env, repo)).worker;

// ---- private apps: signed passes (exp.hmac), one project each, 12 h
const PASS_TTL_S = 12 * 3600;
async function passSig(env: Env, slug: string, exp: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.ADMIN_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`runpass:${slug}:${exp}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function mintRunPass(env: Env, slug: string) {
  const exp = Math.floor(Date.now() / 1000) + PASS_TTL_S;
  return `${exp}.${await passSig(env, slug, exp)}`;
}
async function checkRunPass(env: Env, slug: string, pass: string) {
  const [e, sig] = pass.split('.');
  const exp = Number(e);
  return !!sig && exp > Date.now() / 1000 && sig === await passSig(env, slug, exp);
}

function withHeaders(r: Response, head: string) {
  const out = new Response(r.body, r);
  out.headers.set('cache-control', 'no-cache');   // the browser rechecks; our per-commit cache answers
  out.headers.set('x-robots-tag', 'noindex');
  out.headers.set('x-forq-commit', head.slice(0, 12));
  out.headers.set('referrer-policy', 'no-referrer');
  return out;
}
