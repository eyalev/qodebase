// qodebase's second Worker in a self-hosted copy (<name>-run.<sub>.workers.dev): its
// live apps (path form, <run host>/<owner>.<name>/) and its agent boxes' API calls,
// which cannot reach the main Worker through its Access sign-in. Everything is
// forwarded unchanged over the service binding; the main Worker tells the two apart
// by host (RUN_HOST) and path (/api/…). This Worker is not behind Access: apps of
// private projects need a signed pass (src/run.ts), the API needs the boxes' keys.
export default {
  async fetch(request, env) {
    try { return await env.MAIN.fetch(request); }
    catch (e) {
      console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'error', module: 'run-worker', event: 'forward_error', err: String(e) }));
      return new Response('qodebase could not be reached. Try again in a moment.', { status: 502 });
    }
  },
};
