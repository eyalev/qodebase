// The triage agent's issue search: BM25 over every OpenClaw issue title (+ PR titles of the
// 30-day window), only items created BEFORE the issue being triaged (env TRIAGE_BEFORE, set by
// the harness; the agent cannot change it). Returns number, kind, created date and title only:
// no state, labels or later outcome, so nothing from after the issue leaks.
//   node issue-search.mjs "<words>"
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DATA = process.env.OPENCLAW_DATA || path.join(os.homedir(), 'projects/github/openclaw/data');
const before = process.env.TRIAGE_BEFORE;
const self = +process.env.TRIAGE_SELF || 0;
const query = process.argv.slice(2).join(' ').trim();
if (!before || !query) { console.log('usage: issue-search "<words>"'); process.exit(2); }

const read = (f) => (fs.existsSync(path.join(DATA, f)) ? fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const docs = new Map();
for (const i of read('titles.jsonl')) docs.set(i.number, { n: i.number, kind: 'issue', created: i.createdAt, title: i.title });
for (const f of ['prs.jsonl', 'prs-days.jsonl']) for (const p of read(f)) docs.set(p.number, { n: p.number, kind: 'PR', created: p.createdAt, title: p.title });
const pool = [...docs.values()].filter((d) => d.created < before && d.n !== self);

const STOP = new Set('the a an and or of to in on for with is are be not no when it its this that from by as at after before into does do can cannot fails fail error issue bug openclaw'.split(' '));
const tok = (s) => (s.toLowerCase().match(/[a-z0-9][a-z0-9_.-]*/g) || []).filter((w) => w.length > 1 && !STOP.has(w));
const q = [...new Set(tok(query))];
const df = new Map(); const toks = pool.map((d) => tok(d.title));
for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) || 0) + 1);
const N = pool.length, avg = toks.reduce((a, t) => a + t.length, 0) / Math.max(1, N);
const scored = pool.map((d, i) => {
  const t = toks[i]; let s = 0;
  for (const w of q) { const f = t.filter((x) => x === w).length; if (!f) continue; const idf = Math.log(1 + (N - df.get(w) + 0.5) / (df.get(w) + 0.5)); s += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * t.length / avg)); }
  return [s, d];
}).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]).slice(0, 12);
if (!scored.length) console.log('no matches');
for (const [, d] of scored) console.log(`#${d.n} ${d.kind} ${d.created.slice(0, 10)}  ${d.title}`);
