// L3: run lane cells on Cloudflare one after another (docs/board/sim.md (i) "For qb6's L3", qb4's cells).
// Each cell: reset the run object (so it runs the deployed code), start, wait until done (or stop it after a hard
// limit), save the full report to sim/cloud/results/L3-<name>.json, then clone main and check it (verify.mjs).
//   node sim/cloud/run-cells.mjs [cellName…]        (key: ~/.config/qbsim/key; log: ~/.local/share/qbsim/l3.jsonl)
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = 'https://qbsim-cloud.forqdev.workers.dev';
const KEY = readFileSync(join(homedir(), '.config/qbsim/key'), 'utf8').trim();
const LOG = join(homedir(), '.local/share/qbsim/l3.jsonl');
mkdirSync(dirname(LOG), { recursive: true }); mkdirSync(join(HERE, 'results'), { recursive: true });
const log = (event, data) => { const l = JSON.stringify({ ts: new Date().toISOString(), event, ...data }); appendFileSync(LOG, l + '\n'); console.log(l); };
const H = { 'x-sim-key': KEY, 'user-agent': 'qbsim-cli/1', 'content-type': 'application/json' };
const call = async (path, body) => (await fetch(BASE + path, body === undefined ? { headers: H } : { method: 'POST', headers: H, body: JSON.stringify(body) })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Shared knobs: cloud-500's work times, qb4's train cadence.
const BASEC = { minutes: 10, workMinS: 20, workMaxS: 60, trainEveryS: 10, trainMax: 200, crossShare: 0.05, xEveryS: 10, forkConcurrency: 16 };
export const CELLS = [
  { name: '500-1lane', agents: 500, lanes: 1, door: 'cas' },
  { name: '500-8lanes-cas', agents: 500, lanes: 8, door: 'cas' },
  { name: '500-8lanes-combine', agents: 500, lanes: 8, door: 'combine' },
  { name: '2000-1lane', agents: 2000, lanes: 1, door: 'cas', modules: 100, forkConcurrency: 32 },
  { name: '2000-8lanes-combine', agents: 2000, lanes: 8, door: 'combine', modules: 100, forkConcurrency: 32 },
  { name: '2000-16lanes-combine', agents: 2000, lanes: 16, door: 'combine', modules: 100, forkConcurrency: 32 },
  { name: '2000-32lanes-combine', agents: 2000, lanes: 32, door: 'combine', modules: 100, forkConcurrency: 32 },
  { name: '2000-16lanes-combine-x20', agents: 2000, lanes: 16, door: 'combine', modules: 100, forkConcurrency: 32, crossShare: 0.2 },
  { name: '2000-8lanes-cas', agents: 2000, lanes: 8, door: 'cas', modules: 100, forkConcurrency: 32 },
];

async function runCell(cell) {
  const cfg = { ...BASEC, ...cell }; delete cfg.name;
  await call('/abort', {}).catch(() => {});
  await sleep(3000);
  const started = await call('/start', cfg);
  log('cell_started', { cell: cell.name, runId: started.runId, error: started.error });
  if (!started.runId) return { cell: cell.name, error: started.error || 'no run' };
  const t0 = Date.now(), hardMs = (cfg.minutes + 25) * 60_000;
  let st;
  for (;;) {
    await sleep(20_000);
    st = await call('/status').catch((e) => ({ error: String(e) }));
    if (st.runId !== started.runId && !st.error) { log('cell_lost', { cell: cell.name, st }); break; }
    log('cell_tick', { cell: cell.name, phase: st.phase, s: Math.round((Date.now() - t0) / 1000), forks: st.forks, landed: st.landed, queue: st.queue, cas: st.cas, busy: st.busy, pending: st.pending, errors: (st.errors || []).length });
    if (st.phase === 'done') break;
    if (Date.now() - t0 > hardMs) { log('cell_stopped', { cell: cell.name }); await call('/stop', {}); break; }
  }
  const report = await call('/report');
  let verify = null;
  try { verify = JSON.parse(execFileSync('node', [join(HERE, 'verify.mjs')], { encoding: 'utf8', maxBuffer: 1 << 26, timeout: 15 * 60_000 }).trim().split('\n').pop()); }
  catch (e) { verify = { error: String(e.message || e).slice(0, 300) }; }
  const out = { cell: cell.name, cfg, ranAt: new Date(t0).toISOString(), wallS: Math.round((Date.now() - t0) / 1000), verify, ...report };
  writeFileSync(join(HERE, 'results', `L3-${cell.name}.json`), JSON.stringify(out, null, 1));
  const s = report.status || {};
  log('cell_done', { cell: cell.name, landed: s.landed, landedPerHour: s.landedPerHour, cas: s.cas, busy: s.busy, mainPushes: s.mainPushes, testFails: s.testFails, dropped: s.dropped, forks: s.forks, forkFailed: s.forkFailed,
    agentPushFail: s.agentPushFail, artifactsOps: s.artifactsOps, verify });
  return out;
}

const want = process.argv.slice(2);
for (const cell of CELLS.filter((c) => !want.length || want.includes(c.name))) await runCell(cell);
log('all_done', {});
