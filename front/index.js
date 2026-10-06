// Forwards qodebase.app to forq (see wrangler.jsonc). Redirects and WebSocket
// upgrades pass through untouched; www goes to the apex.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === 'www.qodebase.app') return Response.redirect(`https://qodebase.app${url.pathname}${url.search}`, 301);
    const host = url.hostname;
    // Access guards ORIGIN/login at the edge, so the forward would only meet
    // Access's own redirect: send the browser to sign in there, handed back
    // to this host through /session (forq's handoff, src/index.ts loginRoute).
    if (url.pathname === '/login') {
      const next = url.searchParams.get('next');
      const q = new URLSearchParams({ to: host, next: next && /^\/[^/\\]/.test(next) ? next : '/' });
      return new Response(null, { status: 302, headers: { location: `https://${env.ORIGIN}/login?${q}`, 'cache-control': 'no-store' } });
    }
    url.hostname = env.ORIGIN;
    const req = new Request(url, request);
    const cf = request.cf || {};
    req.headers.set('x-qb-front', env.FRONT_SECRET);
    req.headers.set('x-qb-host', host);
    req.headers.set('x-qb-ip', request.headers.get('cf-connecting-ip') || '');
    req.headers.set('x-qb-cf', JSON.stringify({
      country: cf.country, asn: cf.asn, asOrganization: cf.asOrganization, colo: cf.colo,
      verifiedBotCategory: cf.verifiedBotCategory, botManagement: cf.botManagement ? { verifiedBot: cf.botManagement.verifiedBot } : undefined,
    }));
    const t0 = Date.now();
    try {
      const res = await fetch(req, { redirect: 'manual' });
      if (res.status >= 500) log('forward_5xx', { path: url.pathname, status: res.status, ms: Date.now() - t0 });
      return res;
    } catch (e) {
      log('forward_error', { path: url.pathname, ms: Date.now() - t0, err: String(e), stack: e?.stack });
      return new Response('qodebase could not be reached. Try again in a moment.', { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
  },
};

function log(event, data) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: event === 'forward_error' ? 'error' : 'warn', module: 'front', event, ...data }));
}
