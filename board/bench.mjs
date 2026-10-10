#!/usr/bin/env node
// E2 (docs/board/PLAN.md): latency of the board's Durable Object vs Workers KV, from this laptop.
//   node board/bench.mjs [--n 100] [--keys 10]      writes JSONL samples to board/bench-results.jsonl
// Token from ~/.config/qb-board/token (never printed).
import { readFileSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BOARD_BASE || 'https://qb-board.forqdev.workers.dev';
const TOKEN = readFileSync(join(homedir(), '.config/qb-board/token'), 'utf8').trim();
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'bench-results.jsonl');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const N = arg('--n', 100), KEYS = arg('--keys', 10);
const H = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const BOARD = `bench-${Date.now()}`;
const now = () => performance.now();
const call = async (path, init = {}) => { const r = await fetch(BASE + path, { ...init, headers: H }); if (!r.ok) throw new Error(`${path} ${r.status}`); return r.json(); };
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1) : null; };
const stats = (xs) => ({ n: xs.length, p50: q(xs, 0.5), p95: q(xs, 0.95), max: q(xs, 1) });
const record = (test, o) => { const line = { ts: new Date().toISOString(), test, ...o }; appendFileSync(OUT, JSON.stringify(line) + '\n'); console.log(JSON.stringify(line)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ONLY_FAR = process.argv.includes('--far');
// warm the isolate, the DO and the connection
await call(`/b/${BOARD}/events`, { method: 'POST', body: JSON.stringify({ agent: 'warm', kind: 'started' }) });
await call(`/bench/kv/raw?k=warm`);

if (!ONLY_FAR) {
// 1. DO: post, then read it back with a second request (write -> visible to another reader)
{
  const post = [], visible = [], firstRead = [];
  for (let i = 0; i < N; i++) {
    const t0 = now();
    const e = await call(`/b/${BOARD}/events`, { method: 'POST', body: JSON.stringify({ agent: 'w', kind: 'editing', intent: `i${i}` }) });
    const t1 = now();
    let tries = 0, seen = false;
    while (!seen && tries < 20) { tries++; const t = await call(`/b/${BOARD}/tail?n=1`); seen = t.at(-1)?.ts === e.ts && t.at(-1)?.intent === `i${i}`; }
    post.push(t1 - t0); visible.push(now() - t0); firstRead.push(tries === 1 ? 1 : 0);
  }
  record('do_post_then_read', { post: stats(post), writeToVisible: stats(visible), visibleOnFirstRead: firstRead.reduce((a, b) => a + b, 0) / N });
}

// 2. DO WebSocket push: time from sending the POST to the event arriving on an open socket
{
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/b/${BOARD}/ws?token=${TOKEN}`);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const pending = new Map(), push = [], postRtt = [], pushBeforeResponse = [];
  ws.onmessage = (m) => { const e = JSON.parse(m.data); const p = pending.get(e.intent); if (p) { p.got = now(); p.res(); } };
  for (let i = 0; i < N; i++) {
    const id = `ws${i}`, p = {}; const arrived = new Promise((res) => { p.res = res; }); pending.set(id, p);
    const t0 = now();
    await call(`/b/${BOARD}/events`, { method: 'POST', body: JSON.stringify({ agent: 'w', kind: 'editing', intent: id }) });
    const t1 = now();
    await Promise.race([arrived, sleep(5000)]);
    if (p.got) { push.push(p.got - t0); postRtt.push(t1 - t0); pushBeforeResponse.push(p.got < t1 ? 1 : 0); }
  }
  ws.close();
  record('do_ws_push', { postToPush: stats(push), postRtt: stats(postRtt), received: push.length / N, pushBeforePostResponse: pushBeforeResponse.reduce((a, b) => a + b, 0) / Math.max(1, push.length) });
}

// 3. KV, same request: put then get in one Worker invocation
{
  const same = [], get = [], put = []; let colo;
  for (let i = 0; i < N; i++) { const r = await call(`/bench/kv/raw?k=raw${i % 10}`); same.push(r.same ? 1 : 0); get.push(r.getMs); put.push(r.putMs); colo = r.colo; }
  record('kv_same_request', { colo, readAfterWrite: same.reduce((a, b) => a + b, 0) / N, putMs: stats(put), getMs: stats(get) });
}

// 4. KV, separate requests from this laptop (same colo): put, then poll get until the new value shows.
//    a) a key never read before; b) a key read just before the write (cached at the colo), default
//    cacheTtl (60 s) and cacheTtl 30 s.
for (const [name, prime, ttl] of [['kv_unread_key', false, 0], ['kv_read_before_default_ttl', true, 0], ['kv_read_before_ttl30', true, 30]]) {
  const run = Date.now();
  const one = async (j) => {
    const k = `${name}-${run}-${j}`, ttlQ = ttl ? `&ttl=${ttl}` : '';
    await call(`/bench/kv/put?k=${k}&v=old`);
    if (prime) { await sleep(2000); await call(`/bench/kv/get?k=${k}${ttlQ}`); }
    const t0 = now(); await call(`/bench/kv/put?k=${k}&v=new`); const tPut = now();
    let polls = 0, v;
    do { polls++; v = (await call(`/bench/kv/get?k=${k}${ttlQ}`)).v; if (v !== 'new') await sleep(1000); } while (v !== 'new' && now() - t0 < 100_000);
    return { staleS: v === 'new' ? (now() - tPut) / 1000 : null, polls };
  };
  const rs = await Promise.all(Array.from({ length: KEYS }, (_, j) => one(j)));
  const st = rs.map((r) => r.staleS).filter((x) => x != null);
  record(name, { keys: KEYS, newVisibleAfterS: stats(st), visibleOnFirstRead: rs.filter((r) => r.polls === 1).length / KEYS, neverSeenIn100s: rs.filter((r) => r.staleS == null).length });
}

}

// 5. Cross-location: the writer is this laptop's colo (LIS); the reader is a Durable Object placed in
//    another region (locationHint) reading the same KV key. Also the board's round trip from here to it.
for (const hint of (process.env.BENCH_HINTS || 'wnam,apac').split(',')) {
  const probe = `kvprobe-${hint}-${Date.now()}`;
  const first = await call(`/b/${probe}/kvget?k=none&where=${hint}`);
  const rtt = [];
  for (let i = 0; i < 20; i++) { const t0 = now(); await call(`/b/${probe}/kvget?k=none`); rtt.push(now() - t0); }
  record('do_far_rtt', { hint, doColo: first.colo, laptopToFarDoRtt: stats(rtt) });
  for (const [name, prime, ttl] of [['kv_far_unread_key', false, 0], ['kv_far_read_before_default_ttl', true, 0], ['kv_far_read_before_ttl30', true, 30]]) {
    const run = Date.now();
    const one = async (j) => {
      const k = `${name}-${hint}-${run}-${j}`, ttlQ = ttl ? `&ttl=${ttl}` : '';
      await call(`/bench/kv/put?k=${k}&v=old`);
      if (prime) { await sleep(2000); await call(`/b/${probe}/kvget?k=${k}${ttlQ}`); }
      await call(`/bench/kv/put?k=${k}&v=new`); const tPut = now();
      let polls = 0, v;
      do { polls++; v = (await call(`/b/${probe}/kvget?k=${k}${ttlQ}`)).v; if (v !== 'new') await sleep(1000); } while (v !== 'new' && now() - tPut < 100_000);
      return { staleS: v === 'new' ? (now() - tPut) / 1000 : null, polls };
    };
    const rs = await Promise.all(Array.from({ length: KEYS }, (_, j) => one(j)));
    const st = rs.map((r) => r.staleS).filter((x) => x != null);
    record(name, { hint, doColo: first.colo, keys: KEYS, newVisibleAfterS: stats(st), visibleOnFirstRead: rs.filter((r) => r.polls === 1).length / KEYS, neverSeenIn100s: rs.filter((r) => r.staleS == null).length });
  }
}
