// Agent board: shared "who is doing what" log (docs/board/PLAN.md). No dependencies.
// Two backends, chosen by env:
//   BOARD_FILE=<path.jsonl>              local: one appended JSON line per event
//   BOARD_URL=<https://…/b/<name>> + BOARD_TOKEN   HTTP: the qb-board Worker (board/worker.mjs)
// Event: {ts, agent, kind, intent, files, status}. Agent from BOARD_AGENT.
import { appendFileSync, writeFileSync, readFileSync, existsSync, mkdirSync, openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

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
export const parseDur = (s, d = 30 * 60_000) => { const m = String(s ?? '').match(/^(\d+(?:\.\d+)?)\s*(s|m|h)?$/); return m ? Number(m[1]) * { s: 1e3, m: 6e4, h: 36e5 }[m[2] || 'm'] : d; };
// FINISHED = on main only (round 2, qb9's W3a diagnosis): a `landed` event, or a legacy `committed` with
// status 'pushed'. A `done`/`committed` without it is only a claim ("says done, not on main"): at 20 agents,
// commits stranded mid-rebase were announced as finished and 3-5 agents per task deferred to them for good.
// A claim older than CLAIM_MS counts as abandoned and is not shown at all (also not as a live row).
export const CLAIM_MS = 5 * 60_000;
const LANDED = (e) => e.kind === 'landed' || (e.kind === 'committed' && e.status === 'pushed');
const CLAIM = (e) => (e.kind === 'done' || e.kind === 'committed') && !LANDED(e);

/** recent (ms): also list what others landed on main in that window (done:true, marked FINISHED), and their
 *  fresh unlanded claims (claim:true, marked SAYS DONE, NOT ON MAIN), one row per agent + intent, after the
 *  live rows (qb9: a task landed under another wording 15 s earlier was invisible once its agent moved on). */
export function nowView(events, { me = null, files = [], area = null, now = Date.now(), ttl = TTL_MS, recent = 0 } = {}) {
  const live = liveView(events, { me, now, ttl });
  const done = [], claims = [];
  if (recent > 0) {
    const landed = new Set(), seen = new Set();
    const sorted = [...events].filter(Boolean).sort((a, b) => b.ts - a.ts);
    for (const e of sorted) if (LANDED(e) && e.intent) landed.add(`${e.agent}\n${e.intent}`);
    for (const e of sorted) {
      if (now - e.ts > recent || e.agent === me || !e.intent) continue;
      const k = `${e.agent}\n${e.intent}`; if (seen.has(k)) continue;
      if (LANDED(e)) { seen.add(k); done.push({ ...e, done: true, ageS: Math.round((now - e.ts) / 1000) }); }
      else if (CLAIM(e) && !landed.has(k) && now - e.ts <= CLAIM_MS) { seen.add(k); claims.push({ ...e, claim: true, ageS: Math.round((now - e.ts) / 1000) }); }
    }
    // a live row that only repeats a landed or claim row shown below is dropped
    const shown = new Set([...done, ...claims].map((r) => `${r.agent}\n${r.intent}`));
    return filterRows([...live.filter((r) => !shown.has(`${r.agent}\n${r.intent}`)), ...done, ...claims], files, area);
  }
  return filterRows(live, files, area);
}

function filterRows(out, files, area) {
  const want = normFiles(files);
  if (want.length) out = out.filter((r) => r.files.some((f) => want.some((w) => touches(f, w))));
  if (area) { const a = area.toLowerCase(); out = out.filter((r) => (r.intent || '').toLowerCase().includes(a) || r.files.some((f) => f.toLowerCase().includes(a))); }
  return out;
}

function liveView(events, { me, now, ttl }) {
  const rows = new Map();
  for (const e of events) {
    if (!e || now - e.ts > ttl || e.agent === me) continue;
    const r = rows.get(e.agent) || { agent: e.agent, files: new Set(), last: e };
    if (e.ts >= r.last.ts) r.last = e;
    for (const f of e.files || []) r.files.add(f);
    rows.set(e.agent, r);
  }
  // An agent whose last word is an unlanded claim older than CLAIM_MS has stopped: not live.
  return [...rows.values()].filter((r) => !(CLAIM(r.last) && now - r.last.ts > CLAIM_MS))
    .map((r) => ({ ...r.last, files: [...r.files], ageS: Math.round((now - r.last.ts) / 1000) })).sort((x, y) => y.ts - x.ts);
}

export const fmtRow = (r) => `${r.done ? 'FINISHED (on main) ' : r.claim ? 'SAYS DONE, NOT ON MAIN ' : ''}${r.agent} ${r.kind}${r.ageS != null ? ` ${r.ageS}s ago` : ''}: ${clip(r.intent, 90) || "-"}${r.files?.length ? ` [${r.files.slice(0, 5).join(', ')}${r.files.length > 5 ? ', …' : ''}]` : ''}${r.status ? ` (${r.status})` : ''}`;

// Per-agent state shared by the hook and the CLI (the hook's debounce, and the agent's own intent).
export const stateDir = (env = process.env) => env.BOARD_STATE_DIR || join(homedir(), '.cache', 'qb-board');
export const statePath = (agent, env = process.env) => join(stateDir(env), `${String(agent).replace(/[^\w.-]/g, '_')}.json`);
export function readState(agent, env) { try { return JSON.parse(readFileSync(statePath(agent, env), 'utf8')); } catch { return { edits: {}, warned: {} }; } }
export function writeState(agent, st, env) { try { mkdirSync(stateDir(env), { recursive: true }); writeFileSync(statePath(agent, env), JSON.stringify(st)); } catch {} }

// ---- backends ------------------------------------------------------------------------------
function fileBackend(path) {
  // Read only the tail: the now-view needs the last TTL window, not the whole history.
  const readTail = (bytes = 4 * 1024 * 1024) => {
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
    who: ({ me, files, area, recent } = {}) => call(`/who?${new URLSearchParams({ ...(me ? { me } : {}), ...(recent ? { recent: String(recent) } : {}), ...(files?.length ? { files: normFiles(files).join(',') } : {}), ...(area ? { area } : {}) })}`),
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
