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
    return env.FORQ.fetch(req);
  },
};
