// The Talk Worker (qodebase-talk): Talk on its own, so deploying Talk never restarts
// qodebase's agent boxes (every forq deploy does). forq hands it /talk.js,
// /talk-voice.js, /api/talk/* and /agents/talk-voice/* over a service binding (env.TALK),
// with the signed-in person in x-talk-who and forq's own version in x-talk-site; it has
// no route of its own, so only forq reaches it. Same code as in-process Talk (src/talk.ts),
// which self-hosted copies still use. Config: talk/wrangler.jsonc.
import type { Env } from './env';
import { talkRoute } from './talk';
export { TalkLog } from './talk';
export { TalkVoice } from './talkvoice';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    let who: { handle: string; admin: boolean } | null = null;
    try { const w = JSON.parse(request.headers.get('x-talk-who') || 'null'); if (w && typeof w.handle === 'string' && w.handle) who = { handle: w.handle, admin: !!w.admin }; } catch { /* anonymous */ }
    const r = await talkRoute(request, env, ctx, url, who);
    return r || new Response('not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
