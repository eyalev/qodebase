// Agent board: shared "who is doing what" log (docs/board/PLAN.md). No dependencies.
// Two backends, chosen by env:
//   BOARD_FILE=<path.jsonl>              local: one appended JSON line per event
//   BOARD_URL=<https://…/b/<name>> + BOARD_TOKEN   HTTP: the qb-board Worker (board/worker.mjs)
// Event: {ts, agent, kind, intent, files, status}. Agent from BOARD_AGENT.
import { appendFileSync, readFileSync, existsSync, mkdirSync, openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';

export const TTL_MS = 10 * 60_000;
export const KINDS = ['started', 'editing', 'committed', 'blocked', 'landed', 'done', 'gave-up'];
const MAX_LINE = 2048;   // one write() of < PIPE_BUF-ish bytes with O_APPEND: lines from many writers never interleave

export const clip = (s, n) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim().slice(0, n));
export const normFiles = (files) => (Array.isArray(files) ? files : String(files || '').split(','))
  .map((f) => String(f).trim().replace(/^\.\//, '')).filter(Boolean).slice(0, 20);

export function makeEvent({ agent, kind, intent, files, status }) {
  if (!agent) throw new Error('no agent: set BOARD_AGENT');
  if (!KINDS.includes(kind)) throw new Error(`kind must be one of ${KINDS.join(', ')}`);
  return { ts: Date.now(), agent: clip(agent, 64), kind, intent: clip(intent, 200), files: normFiles(files), status: clip(status, 80) };
}

// A file "matches" another when one is the other or a folder holding it.
const touches = (a, b) => a === b || a.startsWith(b.replace(/\/?$/, '/')) || b.startsWith(a.replace(/\/?$/, '/'));

/** The now-view: one row per live agent (last event within TTL), newest first, without `me`.
 *  `files` on a row = every file that agent named in the TTL window (not only its last event). */
export function nowView(events, { me = null, files = [], area = null, now = Date.now(), ttl = TTL_MS } = {}) {
  const rows = new Map();
  for (const e of events) {
    if (!e || now - e.ts > ttl || e.agent === me) continue;
    const r = rows.get(e.agent) || { agent: e.agent, files: new Set(), last: e };
    if (e.ts >= r.last.ts) r.last = e;
    for (const f of e.files || []) r.files.add(f);
    rows.set(e.agent, r);
  }
  let out = [...rows.values()].map((r) => ({ ...r.last, files: [...r.files], ageS: Math.round((now - r.last.ts) / 1000) }));
  const want = normFiles(files);
  if (want.length) out = out.filter((r) => r.files.some((f) => want.some((w) => touches(f, w))));
  if (area) { const a = area.toLowerCase(); out = out.filter((r) => (r.intent || '').toLowerCase().includes(a) || r.files.some((f) => f.toLowerCase().includes(a))); }
  return out.sort((x, y) => y.ts - x.ts);
}

export const fmtRow = (r) => `${r.agent} ${r.kind}${r.ageS != null ? ` ${r.ageS}s ago` : ''}: ${clip(r.intent, 90) || "-"}${r.files?.length ? ` [${r.files.slice(0, 5).join(', ')}${r.files.length > 5 ? ', …' : ''}]` : ''}${r.status ? ` (${r.status})` : ''}`;

// ---- backends ------------------------------------------------------------------------------
function fileBackend(path) {
  // Read only the tail: the now-view needs the last TTL window, not the whole history.
  const readTail = (bytes = 512 * 1024) => {
    if (!existsSync(path)) return [];
    const fd = openSync(path, 'r');
    try {
      const size = fstatSync(fd).size, start = Math.max(0, size - bytes), buf = Buffer.alloc(size - start);
      readSync(fd, buf, 0, buf.length, start);
      const lines = buf.toString('utf8').split('\n');
      if (start > 0) lines.shift();   // a partial first line
      return lines.filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } finally { closeSync(fd); }
  };
  return {
    async post(e) {
      const line = JSON.stringify(e);
      if (Buffer.byteLength(line) + 1 > MAX_LINE) throw new Error('event too long');
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, line + '\n', { flag: 'a' });   // O_APPEND: atomic per write on a local disk
      return e;
    },
    async who(q) { return nowView(readTail(), q); },
    async tail(n = 20) { return readTail().slice(-n); },
  };
}

function httpBackend(url, token) {
  const base = url.replace(/\/$/, '');
  const H = { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': 'qb-board-cli/1' };
  const call = async (path, init = {}) => {
    const r = await fetch(base + path, { ...init, headers: H, signal: AbortSignal.timeout(4000) });
    if (!r.ok) throw new Error(`board ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  };
  return {
    post: (e) => call('/events', { method: 'POST', body: JSON.stringify(e) }),
    who: ({ me, files, area } = {}) => call(`/who?${new URLSearchParams({ ...(me ? { me } : {}), ...(files?.length ? { files: normFiles(files).join(',') } : {}), ...(area ? { area } : {}) })}`),
    tail: (n = 20) => call(`/tail?n=${n}`),
  };
}

export function backend(env = process.env) {
  if (env.BOARD_URL) {
    if (!env.BOARD_TOKEN) throw new Error('BOARD_URL needs BOARD_TOKEN');
    return httpBackend(env.BOARD_URL, env.BOARD_TOKEN);
  }
  if (env.BOARD_FILE) return fileBackend(env.BOARD_FILE);
  return null;
}
