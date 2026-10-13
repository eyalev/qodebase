// C-1: which Haiku calls of a real build crossed 100k prompt tokens, when, and what filled the context.
// Wakes each of the project's boxes (agents, reviewers, router), runs longcalls-inbox.cjs in it, stops it.
// No model call: a wake never re-sends a task (taskSent) and a halted project drops its messages.
//   node scripts/real/longcalls.mjs eyal/real-course-builder [--par 6] > out.jsonl
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const [o, n] = (process.argv[2] || '').split('/');
const par = Number(process.argv[process.argv.indexOf('--par') + 1]) || 6;
const API = 'https://forq.forqdev.workers.dev';
const H = { 'x-forq-secret': readFileSync(join(homedir(), '.config/forq/admin-secret'), 'utf8').trim(), 'user-agent': 'forq-cli/1' };
const script = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'longcalls-inbox.cjs'));
const call = async (path, method = 'GET', body) => { const r = await fetch(API + path, { method, headers: H, ...(body !== undefined ? { body } : {}) }); return r.json().catch(() => ({})); };
const info = await call(`/api/p/${o}/${n}`);
const slug = `${o}.${n}`;
const ids = [...(info.agents || []).map((a) => a.id), `${slug}--router`, `${slug}--review`, ...[2, 3, 4, 5, 6, 7, 8].map((k) => `${slug}--review${k}`)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function one(id) {
  const st0 = await call(`/api/agents/${id}/state`, 'POST');
  if (st0.error || (!st0.snapshot && !st0.awake && !st0.lastSnapshot)) return { id, skipped: st0.error || 'no box' };
  const woke = !st0.awake;
  if (woke) await call(`/api/agents/${id}/wake`, 'POST');
  for (let i = 0; i < 40; i++) { const s = await call(`/api/agents/${id}/state`, 'POST'); if (s.awake) break; await sleep(3000); }
  const r = await call(`/api/agents/${id}/exec`, 'POST', `echo ${script.toString('base64')} | base64 -d > /tmp/lc.cjs && node /tmp/lc.cjs`);
  if (woke) await call(`/api/agents/${id}/stop`, 'POST');
  const line = String(r.stdout || r.out || JSON.stringify(r)).split('\n').find((l) => l.startsWith('QB_LONG '));
  return { id, sessions: line ? JSON.parse(line.slice(8)) : null, raw: line ? undefined : JSON.stringify(r).slice(0, 300) };
}
let i = 0;
await Promise.all(Array.from({ length: par }, async () => { while (i < ids.length) { const id = ids[i++]; const r = await one(id).catch((e) => ({ id, error: String(e) })); console.log(JSON.stringify(r)); } }));
