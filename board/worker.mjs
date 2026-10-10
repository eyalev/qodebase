// qb-board: the agent board's HTTP/WebSocket backend (docs/board/PLAN.md, E1) + the E2 latency bench.
// One Durable Object per board name (SQLite log), bearer token on every call.
//   POST /b/<name>/events   {agent, kind, intent, files, status}  -> the stored event (ts set here)
//   GET  /b/<name>/who?me=&files=a,b&area=X                       -> now-view (live = last 10 min)
//   GET  /b/<name>/tail?n=20                                      -> newest events, oldest first
//   GET  /b/<name>/ws   (WebSocket upgrade)                         -> every new event as JSON
// Bench (E2): /bench/kv/put?k=&v=, /bench/kv/get?k=&ttl=, /bench/kv/raw?k=  (same colo as the caller).
import { DurableObject } from 'cloudflare:workers';
import { makeEvent, nowView, TTL_MS } from './lib.mjs';

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const KEEP_DAYS = 7;

async function authed(request, env) {
  const h = request.headers.get('authorization') || '';
  const q = new URL(request.url).searchParams.get('token');   // browsers' WebSocket cannot set headers
  const got = h.startsWith('Bearer ') ? h.slice(7) : q || '';
  if (!env.BOARD_TOKEN || got.length !== env.BOARD_TOKEN.length) return false;
  const [a, b] = [new TextEncoder().encode(got), new TextEncoder().encode(env.BOARD_TOKEN)];
  return crypto.subtle.timingSafeEqual(a, b);
}

export class Board extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS ev (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, agent TEXT NOT NULL, body TEXT NOT NULL)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS ev_ts ON ev(ts)`);
  }
  async fetch(request) {
    const url = new URL(request.url), verb = url.pathname.split('/').pop();
    if (verb === 'kvget') {   // E2: read KV from wherever this DO lives (placed by locationHint)
      const k = url.searchParams.get('k'), ttl = Number(url.searchParams.get('ttl')) || undefined, t0 = Date.now();
      const v = await this.env.BENCH_KV.get(k, ttl ? { cacheTtl: ttl } : undefined);
      // where this DO really runs: the colo its own outbound request leaves from
      this.colo ||= ((await (await fetch('https://www.cloudflare.com/cdn-cgi/trace')).text()).match(/colo=(\w+)/) || [])[1];
      return json({ v, ms: Date.now() - t0, colo: this.colo });
    }
    if (verb === 'ws') {
      if (request.headers.get('upgrade') !== 'websocket') return json({ error: 'websocket only' }, 426);
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);   // hibernatable: idle sockets cost no duration
      return new Response(null, { status: 101, webSocket: client });
    }
    if (verb === 'events' && request.method === 'POST') {
      const e = makeEvent(await request.json());
      this.sql.exec(`INSERT INTO ev (ts, agent, body) VALUES (?, ?, ?)`, e.ts, e.agent, JSON.stringify(e));
      const msg = JSON.stringify(e);
      for (const ws of this.ctx.getWebSockets()) { try { ws.send(msg); } catch {} }
      if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 3_600_000);
      return json(e);
    }
    if (verb === 'who') {
      const recent = Math.min(24 * 3_600_000, Number(url.searchParams.get('recent')) || 0);
      const since = Date.now() - Math.max(TTL_MS, recent);
      const rows = this.sql.exec(`SELECT body FROM ev WHERE ts > ? ORDER BY ts`, since).toArray().map((r) => JSON.parse(r.body));
      return json(nowView(rows, { me: url.searchParams.get('me'), files: url.searchParams.get('files') || '', area: url.searchParams.get('area'), recent }));
    }
    if (verb === 'tail') {
      const n = Math.min(500, Math.max(1, Number(url.searchParams.get('n')) || 20));
      return json(this.sql.exec(`SELECT body FROM ev ORDER BY id DESC LIMIT ?`, n).toArray().map((r) => JSON.parse(r.body)).reverse());
    }
    return json({ error: 'not found' }, 404);
  }
  // Housekeeping: the log keeps 7 days (the now-view needs only the last 10 minutes).
  async alarm() {
    this.sql.exec(`DELETE FROM ev WHERE ts < ?`, Date.now() - KEEP_DAYS * 86_400_000);
    if (this.sql.exec(`SELECT 1 FROM ev LIMIT 1`).toArray().length) await this.ctx.storage.setAlarm(Date.now() + 86_400_000);
  }
  webSocketMessage() {}   // push only
  webSocketClose(ws, code) { try { ws.close(code, 'bye'); } catch {} }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/') return new Response('qb-board\n');
    if (!(await authed(request, env))) return json({ error: 'unauthorized' }, 401);
    const m = url.pathname.match(/^\/b\/([a-z0-9][a-z0-9._-]{0,63})\/(events|who|tail|ws|kvget)$/i);
    // ?where=<locationHint> places a NEW board's DO in that region (E2 cross-location runs); later calls ignore it.
    const where = url.searchParams.get('where');
    if (m) return env.BOARD.get(env.BOARD.idFromName(m[1]), where ? { locationHint: where } : undefined).fetch(request);
    // ---- E2 bench: KV in the caller's colo ----
    if (url.pathname.startsWith('/bench/kv/')) {
      const k = url.searchParams.get('k') || 'k', t0 = Date.now();
      if (url.pathname.endsWith('/put')) { await env.BENCH_KV.put(k, url.searchParams.get('v') || String(t0), { expirationTtl: 3600 }); return json({ ok: true, ms: Date.now() - t0, colo: request.cf?.colo }); }
      if (url.pathname.endsWith('/get')) {
        const ttl = Number(url.searchParams.get('ttl')) || undefined;   // undefined = KV default (60 s)
        const v = await env.BENCH_KV.get(k, ttl ? { cacheTtl: ttl } : undefined);
        return json({ v, ms: Date.now() - t0, colo: request.cf?.colo });
      }
      // put then read back in the same request (same isolate, same colo)
      if (url.pathname.endsWith('/raw')) {
        const v = String(t0); await env.BENCH_KV.put(k, v, { expirationTtl: 3600 });
        const t1 = Date.now(); const got = await env.BENCH_KV.get(k);
        return json({ same: got === v, putMs: t1 - t0, getMs: Date.now() - t1, colo: request.cf?.colo });
      }
    }
    return json({ error: 'not found' }, 404);
  },
};
