// Preview of a client-only UI branch on live data (qb3's qodebase-redesign): forwards every request to the live
// site like the qodebase.app front Worker (front/index.js), and swaps the Agents at work CSS/JS that the live
// pages inline (main's assets) for the branch's. Workers with Durable Objects get no preview URLs, hence this.
import * as MAIN from './main-assets.js';
import * as BRANCH from './branch-assets.js';
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
    const h = new Headers(res.headers); h.set('x-preview-swapped', String(swapped)); h.delete('content-length');
    return new Response(html.replace('</title>', ' (redesign preview)</title>'), { status: res.status, headers: h });
  },
};
