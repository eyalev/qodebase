// Forwards qodebase.app to forq (see wrangler.jsonc). Redirects and WebSocket
// upgrades pass through untouched; www goes to the apex.
// PAUSED (2026-11-03, Eyal): the forq Cloudflare account was emptied and its
// Workers Paid plan cancelled, so there is nothing to forward to. Every path
// answers this page; set PAUSED to "0" in wrangler.jsonc to forward again
// (after forq is redeployed: repos are bundled in ~/.local/share/forq-backup-2026-11-03).
const PAUSED_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>qodebase is paused</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600&display=swap" rel="stylesheet">
<style>
:root{--bg:#f7f7fa;--card:#fff;--line:#e4e4ec;--fg:#14121f;--dim:#646177;--acc:#6a2ff0}
@media (prefers-color-scheme:dark){:root{--bg:#0d0c12;--card:#16151e;--line:#2a2836;--fg:#eeedf3;--dim:#a3a0b3;--acc:#a585ff}}
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;background:var(--bg);color:var(--fg);font:16px/1.5 Geist,ui-sans-serif,sans-serif;padding:32px 16px}
main{max-width:520px;margin:12vh auto 0;background:var(--card);border-radius:14px;box-shadow:inset 0 0 0 1px var(--line);padding:24px}
h1{font-size:24px;font-weight:600;letter-spacing:-0.02em;margin:0 0 8px}
p{margin:0;color:var(--dim)}
a{color:var(--acc)}
</style></head><body><main>
<h1>qodebase is paused</h1>
<p>The hosted version is switched off for now. The code is open at <a href="https://github.com/eyalev/qodebase">github.com/eyalev/qodebase</a>.</p>
</main></body></html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (env.PAUSED === '1') {
      if (url.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain' } });
      return new Response(PAUSED_HTML, { status: url.pathname === '/' ? 200 : 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600', 'x-robots-tag': 'noindex' } });
    }
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
