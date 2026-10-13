#!/usr/bin/env node
// Batching bench (2026-10-13): the same files documented one-per-call (run A) and packed several per call (run B).
// For each file both got, a blind judge (gpt-oss-120b through the fleet's /judge, counted in the day cap) sees the
// declarations with both comment sets (order shuffled) and says which is more accurate, and how many comments in each
// describe something other than their declaration (the batching risk: a comment meant for another file).
//   node sim/fleet/scripts/bench-pack-judge.mjs <repoA> <runA> <repoB> <runB> [maxFiles]
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const [repoA, runA, repoB, runB, max = '60'] = process.argv.slice(2);
if (!runB) { console.error('usage: bench-pack-judge.mjs <repoA> <runA> <repoB> <runB> [maxFiles]'); process.exit(2); }
const U = 'https://qbfleet.forqdev.workers.dev', K = readFileSync(`${homedir()}/.config/qbfleet/key`, 'utf8').trim();
const H = { 'x-fleet-key': K, 'user-agent': 'qbfleet-cli/1', 'content-type': 'application/json' };
const get = async (p) => (await fetch(`${U}${p}`, { headers: H })).json();
const recs = async (repo, run) => (await (await fetch(`${U}/records?repo=${repo}&run=${run}`, { headers: H })).text()).trim().split('\n').map((l) => JSON.parse(l));

const ok = (r) => r.status === 'landed' || r.status === 'ready';
const a = new Map((await recs(repoA, runA)).filter(ok).map((r) => [r.file, r]));
const b = new Map((await recs(repoB, runB)).filter(ok).map((r) => [r.file, r]));
const both = [...a.keys()].filter((f) => b.has(f)).slice(0, Number(max));
const added = (diff) => diff ? diff.split('\n').filter((l) => l.startsWith('@@') || l.startsWith(' ') || l.startsWith('+')).filter((l) => !l.startsWith('+++')).join('\n') : '';

const out = []; let usd = 0;
for (const file of both) {
  const [da, db] = await Promise.all([get(`/file?repo=${repoA}&run=${runA}&path=${encodeURIComponent(file)}`), get(`/file?repo=${repoB}&run=${runB}&path=${encodeURIComponent(file)}`)]);
  const flip = Math.random() < 0.5;
  const [x, y] = flip ? [db, da] : [da, db];
  const q = [`File: ${file}. Two sets of doc comments (X and Y) were written for the same exported declarations; each hunk shows the declaration lines around the inserted comment.`,
    'Judge only from what is shown. A comment is WRONG if it describes something other than the declaration right below it (another function, another file, made up). Which set is more accurate and specific overall?',
    'Answer ONE JSON object: {"better": "X" | "Y" | "tie", "wrong_X": <count>, "wrong_Y": <count>}.', '', '--- X', added(x.diff).slice(0, 6000), '', '--- Y', added(y.diff).slice(0, 6000)].join('\n');
  const j = await (await fetch(`${U}/judge`, { method: 'POST', headers: H, body: JSON.stringify({ model: '@cf/openai/gpt-oss-120b', messages: [{ role: 'user', content: q }], max_tokens: 1500, reasoning_effort: 'low' }) })).json();
  usd += j.usd || 0;
  const raw = j.result?.choices?.[0]?.message?.content ?? j.result?.response ?? '';
  let v = null; try { v = JSON.parse(String(raw).match(/\{[\s\S]*\}/)?.[0] || 'null'); } catch {}
  if (!v) { out.push({ file, error: String(raw || j.error).slice(0, 120) }); continue; }
  // Back to A (one per call) / B (packed).
  const better = v.better === 'tie' ? 'tie' : (v.better === 'X') !== flip ? 'A' : 'B';
  out.push({ file, better, wrongA: flip ? v.wrong_Y : v.wrong_X, wrongB: flip ? v.wrong_X : v.wrong_Y, packN: b.get(file).pack_n || 1 });
  process.stderr.write('.');
}
const n = (k) => out.filter((o) => o.better === k).length, sum = (k) => out.reduce((s, o) => s + (Number(o[k]) || 0), 0);
console.log(JSON.stringify({ files: both.length, judged: out.filter((o) => o.better).length, A_one_per_call: n('A'), B_packed: n('B'), tie: n('tie'),
  wrongA: sum('wrongA'), wrongB: sum('wrongB'), errors: out.filter((o) => o.error).length, judgeUsd: Math.round(usd * 1e4) / 1e4, detail: out }));
