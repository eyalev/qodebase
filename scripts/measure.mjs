#!/usr/bin/env node
// What did a window of forq work cost? Four meters, one report.
//
//   node scripts/measure.mjs --from 2026-10-01T20:40:00Z --to 2026-10-01T21:20:00Z \
//        [--boxes eyal.calculator--router,eyal.calculator--ab12c,...] [--json]
//
// 1. Artifacts: artifactsEventsAdaptiveGroups for namespace forq, by eventType
//    (billed: create, push, pull/clone; $0.15 per 1k past 10k a month).
// 2. Containers: containersMetricsAdaptiveGroups per app (forq-agentbox,
//    forq-buildbox): memory GiB-s, CPU s, disk GB-s, priced with cloudcost's
//    rates before the monthly free allowance (so: an upper bound).
// 3. Subscription: ~/.claude/data/history.jsonl, the account-wide 5-hour and
//    weekly meters at the window's ends. Account-wide: includes every other
//    Claude Code session running meanwhile.
// 4. Per box: tokens from each box's own Claude Code transcripts inside the
//    window (deduplicated by message id), via forq's admin exec. Wakes a box
//    that is asleep (a few seconds of container).
// Tokens: CF_ANALYTICS_TOKEN_FILE (a Cloudflare analytics read token) and FORQ_ADMIN_SECRET_FILE
// (paths in CLAUDE.local.md); CF_ACCOUNT_ID; FORQ_API.

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const FROM = arg('from'), TO = arg('to', new Date().toISOString().replace(/\.\d+Z$/, 'Z'));
if (!FROM) { console.error('usage: measure.mjs --from <ISO> [--to <ISO>] [--boxes a,b] [--json]'); process.exit(2); }
const BOXES = (arg('boxes', '') || '').split(',').filter(Boolean);
const ACCOUNT = process.env.CF_ACCOUNT_ID;
const home = (p) => p.replace(/^~/, homedir());
const CF = readFileSync(home(process.env.CF_ANALYTICS_TOKEN_FILE), 'utf8').trim();
const ADMIN = readFileSync(home(process.env.FORQ_ADMIN_SECRET_FILE || '~/.config/forq/admin-secret'), 'utf8').trim();
const API = process.env.FORQ_API || 'https://forq.forqdev.workers.dev';
const RATE = { memGiBs: 0.0000025, cpuS: 0.00002, diskGBs: 0.00000007, artifactsPer1k: 0.15 };
// What the agents' tokens would cost on the Claude API (what a public forq pays
// without subscriptions). Sonnet 5 / 5.5, $ per token, from the claude-api skill
// (cached 2026-09-25): input $2/M, 5-min cache write 1.25x = $2.50/M, cache read
// $0.20/M, output $10/M. If Claude Code wrote 1-hour cache entries, writes are 2x.
const PRICE = { input: 2e-6, cacheWrite: 2.5e-6, cacheRead: 0.2e-6, output: 10e-6 };
const apiUsd = (b) => b.input_tokens * PRICE.input + b.cache_creation_input_tokens * PRICE.cacheWrite + b.cache_read_input_tokens * PRICE.cacheRead + b.output_tokens * PRICE.output;

async function gql(query) {
  const r = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST', headers: { authorization: `Bearer ${CF}`, 'content-type': 'application/json' }, body: JSON.stringify({ query }),
  });
  const j = await r.json();
  if (j.errors?.length) throw new Error(j.errors.map((e) => e.message).join('; '));
  return j.data.viewer.accounts[0];
}

async function artifacts() {
  const a = await gql(`{viewer{accounts(filter:{accountTag:"${ACCOUNT}"}){artifactsEventsAdaptiveGroups(limit:100,filter:{datetime_geq:"${FROM}",datetime_leq:"${TO}",repositoryNamespace:"forq"}){count dimensions{eventType eventKind}}}}}`);
  const by = {};
  for (const g of a.artifactsEventsAdaptiveGroups) by[g.dimensions.eventType] = (by[g.dimensions.eventType] || 0) + g.count;
  const billed = ['create', 'push', 'pull', 'clone', 'fork'].reduce((n, k) => n + (by[k] || 0), 0);
  return { byType: by, billedOps: billed, usdBeyondFree: +(billed / 1000 * RATE.artifactsPer1k).toFixed(4) };
}

async function containers() {
  // The analytics token cannot list container apps; forq's two app ids (wrangler containers list).
  const names = { a777ed0d039549b7a4a41414afbb553b: 'forq-agentbox', '49aa82a8bbab4a909f8f9ddc3ba19c9e': 'forq-buildbox' };
  const apps = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/containers/applications`, { headers: { authorization: `Bearer ${CF}` } }).then((r) => r.json()).catch(() => ({}));
  for (const x of apps.result || []) names[x.id] = x.name;
  const a = await gql(`{viewer{accounts(filter:{accountTag:"${ACCOUNT}"}){containersMetricsAdaptiveGroups(limit:100,filter:{datetime_geq:"${FROM}",datetime_leq:"${TO}"}){sum{allocatedMemory allocatedDisk cpuTimeSec} dimensions{applicationId}}}}}`);
  return a.containersMetricsAdaptiveGroups.map((g) => {
    const memGiBs = g.sum.allocatedMemory / 1024 ** 3, diskGBs = g.sum.allocatedDisk / 1e9, cpuS = g.sum.cpuTimeSec;
    return { app: names[g.dimensions.applicationId.replace(/-/g, '')] || g.dimensions.applicationId, memGiBs: Math.round(memGiBs), boxHoursAt3GiB: +(memGiBs / 3 / 3600).toFixed(2),
      cpuS: Math.round(cpuS), usdBeforeFree: +(memGiBs * RATE.memGiBs + cpuS * RATE.cpuS + diskGBs * RATE.diskGBs).toFixed(4) };
  }).filter((x) => /forq/.test(x.app));
}

function subscription() {
  const f = home('~/.claude/data/history.jsonl');
  if (!existsSync(f)) return null;
  const t0 = Date.parse(FROM), t1 = Date.parse(TO);
  const rows = readFileSync(f, 'utf8').trim().split('\n').slice(-50000).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  // The scraper writes nanoseconds (…:01.690775167Z), which Date.parse rejects: keep milliseconds.
  const ms = (ts) => Date.parse(String(ts).replace(/(\.\d{3})\d+Z$/, '$1Z'));
  const at = (t) => rows.filter((r) => ms(r.timestamp) <= t).pop();
  // history.jsonl is rotated (12 lines seen): fall back to its earliest reading and say so.
  const a = at(t0) || rows[0], b = at(t1);
  if (!a || !b) return null;
  const startNote = ms(a.timestamp) > t0 ? ` (earliest reading available: ${a.timestamp.slice(11, 16)} UTC)` : '';
  const sameWindow = Math.abs((a.session_reset_epoch || 0) - (b.session_reset_epoch || 0)) < 300;   // the reset time jitters by a minute
  return { fiveHour: { from: a.session_pct, to: b.session_pct, sameWindow }, weekly: { from: a.weekly_all_pct, to: b.weekly_all_pct },
    note: 'account-wide: includes every Claude Code session running in the window' + startNote };
}

const TOKENS_PY = String.raw`
import json,glob,os,sys
t0,t1=sys.argv[1],sys.argv[2]
seen={};models={}
for f in glob.glob('/workspace/.claude/projects/*/*.jsonl'):
    for line in open(f,errors='ignore'):
        try: d=json.loads(line)
        except Exception: continue
        m=d.get('message') or {}
        u=m.get('usage'); ts=d.get('timestamp','')
        if not u or not (t0<=ts<=t1): continue
        seen[m.get('id') or d.get('uuid')]=u
        models[m.get('model','?')]=models.get(m.get('model','?'),0)+1
tot={k:sum(int(u.get(k) or 0) for u in seen.values()) for k in ['input_tokens','output_tokens','cache_creation_input_tokens','cache_read_input_tokens']}
print(json.dumps({'messages':len(seen),'models':models,**tot}))
`;

async function boxTokens(id) {
  const h = { 'x-forq-secret': ADMIN, 'content-type': 'text/plain' };
  let st = await fetch(`${API}/api/agents/${id}/state`, { headers: h }).then((r) => r.json()).catch(() => ({}));
  if (!st.running) await fetch(`${API}/api/agents/${id}/wake`, { method: 'POST', headers: h }).catch(() => {});
  const cmd = `cat > /tmp/forq_tokens.py <<'PY'\n${TOKENS_PY}\nPY\npython3 /tmp/forq_tokens.py '${FROM}' '${TO}'`;
  const r = await fetch(`${API}/api/agents/${id}/exec`, { method: 'POST', headers: h, body: cmd }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
  try { return { box: id, ...JSON.parse((r.stdout || '').trim().split('\n').pop()) }; } catch { return { box: id, error: r.error || r.stderr || 'no output' }; }
}

const [art, cont] = await Promise.all([artifacts(), containers()]);
const boxes = [];
for (const b of BOXES) boxes.push(await boxTokens(b));
const out = { window: { from: FROM, to: TO, minutes: Math.round((Date.parse(TO) - Date.parse(FROM)) / 60000) }, artifacts: art, containers: cont, subscription: subscription(), boxes };
if (process.argv.includes('--json')) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }
console.log(`window ${FROM} → ${TO} (${out.window.minutes} min)`);
console.log(`artifacts: ${JSON.stringify(art.byType)}; billed ops ${art.billedOps} ($${art.usdBeyondFree} if past the free 10k)`);
for (const c of cont) console.log(`containers ${c.app}: ${c.memGiBs} GiB·s (${c.boxHoursAt3GiB} box-hours at 3 GiB), CPU ${c.cpuS} s, ≤ $${c.usdBeforeFree}`);
if (out.subscription) console.log(`subscription (account-wide): 5-hour ${out.subscription.fiveHour.from}% → ${out.subscription.fiveHour.to}%${out.subscription.fiveHour.sameWindow ? '' : ' (window reset in between)'}, weekly ${out.subscription.weekly.from}% → ${out.subscription.weekly.to}%; ${out.subscription.note}`);
let sumOut = 0, sumIn = 0, sumUsd = 0;
for (const b of boxes) {
  if (b.error) { console.log(`box ${b.box}: ${b.error}`); continue; }
  sumOut += b.output_tokens; sumIn += b.input_tokens + b.cache_creation_input_tokens + b.cache_read_input_tokens;
  sumUsd += apiUsd(b);
  console.log(`box ${b.box}: ${b.messages} replies, in ${b.input_tokens} + cache write ${b.cache_creation_input_tokens} + cache read ${b.cache_read_input_tokens}, out ${b.output_tokens}, ≈ $${apiUsd(b).toFixed(2)} at API prices, models ${JSON.stringify(b.models)}`);
}
if (boxes.length) console.log(`all boxes: ${sumIn} input-side tokens (mostly cache reads), ${sumOut} output tokens, ≈ $${sumUsd.toFixed(2)} at Sonnet API prices (on the subscription: no per-token charge)`);
