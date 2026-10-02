// A design-variant preview of forq (docs/design-v2.md): forwards every request
// to the forq Worker over a service binding, marked with the variant to render
// (x-forq-ui) and this host (x-forq-host, for sign-in hand-over). Same data,
// same API, different pages; production (UI_HOST) is unchanged.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname;
    url.hostname = env.UI_HOST;
    const req = new Request(url, request);
    req.headers.set('x-forq-ui', env.UI);
    req.headers.set('x-forq-host', host);
    const t0 = Date.now();
    try {
      const res = await env.FORQ.fetch(req);
      // A 5xx from forq is logged here too: a one-off 500 on c/d right after a
      // deploy (2026-10-02) left no trace in forq's own logs.
      if (res.status >= 500) log('forward_5xx', { ui: env.UI, path: url.pathname, status: res.status, ms: Date.now() - t0 });
      return res;
    } catch (e) {
      log('forward_error', { ui: env.UI, path: url.pathname, ms: Date.now() - t0, err: String(e), stack: e?.stack });
      return new Response('This preview could not reach forq. Try again in a moment.', { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
  },
};

function log(event, data) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: event === 'forward_error' ? 'error' : 'warn', module: 'variant', event, ...data }));
}
