#!/usr/bin/env node
// Read Eyal's experience trace (src/talk.ts /api/talk/trace): every page view, tap, Talk step,
// spoken reply and error from his own use of qodebase, as a timeline.
//   node scripts/talk-trace.mjs [--day YYYY-MM-DD] [--min 30] [--sid <id>] [--sessions] [-f]
//   node scripts/talk-trace.mjs --clips [--day …]   |   --clip <key> [-o file]   (the owner's kept recordings)
// Signs in with the qodebase.app session of the debug Chrome (CDP :9222), or QB_SESSION=<cookie value>.
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const day = opt('--day', new Date().toISOString().slice(0, 10));
const minutes = Number(opt('--min', 0));
const sidWant = opt('--sid', '');
const follow = args.includes('-f');

async function sessionCookie() {
  if (process.env.QB_SESSION) return process.env.QB_SESSION;
  const tabs = await (await fetch('http://127.0.0.1:9222/json')).json();
  const ws = tabs.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
  const cookies = await new Promise((res, rej) => {
    const w = new WebSocket(ws);
    w.onopen = () => w.send(JSON.stringify({ id: 1, method: 'Network.getAllCookies' }));
    w.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) { w.close(); res(d.result.cookies); } };
    w.onerror = rej;
  });
  const c = cookies.find((c) => /qodebase\.app$/.test(c.domain) && c.name === 'forq_session');
  if (!c) throw new Error('no qodebase.app session in the debug Chrome; set QB_SESSION');
  return c.value;
}

const cookie = `forq_session=${await sessionCookie()}`;
// Recordings (owner only, when "Keep my recordings" is on): --clips lists the day's, --clip <key> [-o file] downloads one.
if (args.includes('--clips')) {
  const r = await fetch(`https://qodebase.app/api/talk/clip?day=${day}`, { headers: { cookie } });
  const { clips = [] } = await r.json();
  for (const c of clips) console.log(`${c.key}  ${(c.bytes / 1024).toFixed(0)} KB  ${c.how || ''}  live=${JSON.stringify(c.live || '')}  final=${JSON.stringify(c.final || '')}`);
  process.exit(0);
}
if (args.includes('--clip')) {
  const key = opt('--clip', '');
  const r = await fetch(`https://qodebase.app/api/talk/clip?key=${encodeURIComponent(key)}`, { headers: { cookie } });
  if (!r.ok) { console.error(`clip ${r.status}: ${(await r.text()).slice(0, 200)}`); process.exit(1); }
  const out = opt('-o', key.split('/').pop());
  (await import('node:fs')).writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  console.log(`${out}  ${r.headers.get('x-talk-meta') || ''}`);
  process.exit(0);
}
const t = (ms) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: process.env.TZ || undefined, hour12: false }) + '.' + String(ms % 1000).padStart(3, '0');
let since = minutes ? Date.now() - minutes * 60_000 : 0;
let lastTs = 0;
const seen = new Set();

async function pull() {
  const r = await fetch(`https://qodebase.app/api/talk/trace?day=${day}&since=${since}&limit=5000`, { headers: { cookie } });
  if (!r.ok) throw new Error(`trace ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const { rows } = await r.json();
  if (args.includes('--sessions') && !follow) {
    const by = new Map();
    for (const x of rows) { const s = by.get(x.sid) || { first: x.ts, last: x.ts, n: 0, pages: new Set() }; s.last = x.ts; s.n++; s.pages.add(JSON.parse(x.data).path); by.set(x.sid, s); }
    for (const [sid, s] of by) console.log(`${sid}  ${t(s.first)} → ${t(s.last)}  ${s.n} events  ${[...s.pages].slice(0, 6).join(' ')}`);
    return;
  }
  for (const x of rows) {
    const key = `${x.ts}|${x.sid}|${x.ev}|${x.data}`;
    if (seen.has(key) || (sidWant && x.sid !== sidWant)) continue;
    seen.add(key);
    const d = JSON.parse(x.data);
    const path = d.path; delete d.path;
    const gap = lastTs ? `+${((x.ts - lastTs) / 1000).toFixed(1)}s` : '';
    lastTs = x.ts;
    const rest = Object.entries(d).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v)}`).join(' ');
    console.log(`${t(x.ts)} ${gap.padStart(7)} ${x.sid.slice(-4)} ${String(x.ev).padEnd(14)} ${path || ''}  ${rest}`);
    since = Math.max(since, x.ts);
  }
}

await pull();
if (follow) setInterval(() => pull().catch((e) => console.error(String(e))), 3000);
