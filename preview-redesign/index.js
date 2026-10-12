// Preview of a client-only UI branch on live data (qb3's qodebase-redesign): forwards every request to the live
// site like the qodebase.app front Worker (front/index.js), and swaps the Agents at work CSS/JS that the live
// pages inline (main's assets) for the branch's. Workers with Durable Objects get no preview URLs, hence this.
import * as MAIN from './main-assets.js';
import * as BRANCH from './branch-assets.js';
import { HERO, HERO_CSS } from './branch-home.js';
import { siteHeader } from './header.ts';
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/login') return new Response('Sign-in is not available on this preview; the public pages work without it.', { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    url.hostname = env.ORIGIN;
    const req = new Request(url, request);
    req.headers.set('x-qb-front', env.FRONT_SECRET);
    req.headers.set('x-qb-host', 'qodebase.app');
    req.headers.set('x-qb-ip', request.headers.get('cf-connecting-ip') || '');
    const res = await env.FORQ.fetch(req);   // a service binding: fetching a same-account Worker over its URL is error 1042
    if (!(res.headers.get('content-type') || '').startsWith('text/html')) return res;
    let html = await res.text(), swapped = 0;
    for (const k of ['WORK_CSS', 'WORK_JS']) if (MAIN[k] && BRANCH[k] && html.includes(MAIN[k])) { html = html.split(MAIN[k]).join(BRANCH[k]); swapped++; }
    // Home: the branch's hero (everything from the section start to the build form) and its CSS (qb3).
    if (HERO && url.pathname === '/' && html.includes('<section class="land">') && html.includes('<form class="landask"')) {
      const a = html.indexOf('<section class="land">'), b = html.indexOf('<form class="landask"');
      html = html.slice(0, a) + HERO + html.slice(b); html = html.replace('</head>', `<style>${HERO_CSS}</style></head>`); swapped++;
    }
    // Header (qb3): replace the live header with the branch's siteHeader; on a project page drop the crumb row and
    // put owner / project in the header. ?me=<handle>&inbox=<n> shows the signed-in look (sign-in does not work here).
    if (html.includes('<nav class="gtop"')) {
      const q = new URL(request.url).searchParams, me = q.get('me') || '', inbox = +(q.get('inbox') || 0);
      const m = /^\/p\/([^/]+)\/([^/]+)/.exec(url.pathname);
      let ctx;
      if (m) {
        const h3 = /<header class="h3 sub">[\s\S]*?<\/header>/.exec(html);
        ctx = { owner: m[1], ownerLabel: m[1] === 'forq' ? 'qodebase' : m[1], name: m[2], href: `/p/${m[1]}/${m[2]}`, private: !!(h3 && h3[0].includes('class="priv"')) };
        if (h3) html = html.replace(h3[0], '');
      }
      const p = url.pathname, active = m ? (me && me === m[1] ? 'projects' : 'explore') : p.startsWith('/explore') ? 'explore' : p.startsWith('/inbox') ? 'inbox' : p.startsWith('/mine') ? 'mine' : p.startsWith('/build') ? 'build' : p.startsWith('/settings') ? 'account' : 'home';
      const a = html.indexOf('<nav class="gtop"'), b = html.indexOf('</nav>', a) + 6;
      html = html.slice(0, a) + siteHeader({ active, inbox, me, ctx }) + html.slice(b);
      swapped++;
    }
    const h = new Headers(res.headers); h.set('x-preview-swapped', String(swapped)); h.delete('content-length');
    return new Response(html.replace('</title>', ' (redesign preview)</title>'), { status: res.status, headers: h });
  },
};
