// F0 summary: re-verifies every bench row with verify.mjs, then per model: pass rate, judge scores, tokens, $, latency,
// and an extrapolation to 1,000 files and to all of src/vs using the real file sizes (one call per <= CHUNK lines).
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { sameCode, insertComments } from './verify.mjs';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.join(process.env.HOME, 'projects/github/microsoft/vscode');
const IN = process.argv.slice(2).filter((a) => a.endsWith('.jsonl'));
const rows = (IN.length ? IN : ['f0-results.jsonl']).flatMap((f) => fs.readFileSync(path.join(HERE, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l))).filter((r) => !r.event);
const CHUNK = 600;   // lines per call for big files (a call answered up to ~38 comments on ~550 lines)
const sizes = execSync(`cd ${ROOT} && find src/vs -name '*.ts' -not -path '*/test/*' -not -name '*.d.ts' -exec wc -lc {} +`, { encoding: 'utf8' }).trim().split('\n')
  .map((l) => l.trim().split(/\s+/)).filter((p) => p[2] && p[2] !== 'total').map(([lines, bytes]) => ({ lines: +lines, bytes: +bytes }));
const corpus = { files: sizes.length, bytes: sizes.reduce((a, s) => a + s.bytes, 0), calls: sizes.reduce((a, s) => a + Math.max(1, Math.ceil(s.lines / CHUNK)), 0) };
const out = { corpus, models: {} };
for (const model of [...new Set(rows.map((r) => r.model))]) {
  const R = rows.filter((r) => r.model === model);
  let same = 0, withComments = 0;
  for (const r of R) { if (!r.ok || !r.comments) continue; withComments++; const t = fs.readFileSync(path.join(ROOT, r.file), 'utf8'); if (sameCode(t, insertComments(t, r.sample), r.file).same) same++; }
  const ok = R.filter((r) => r.ok), sum = (k) => ok.reduce((a, r) => a + (r[k] || 0), 0);
  const bytes = sum('bytes'), jn = R.reduce((a, r) => a + (r.judge?.n || 0), 0), jsum = (k) => R.reduce((a, r) => a + (r.judge?.[k] || 0), 0);
  const ms = ok.map((r) => r.ms).sort((a, b) => a - b);
  // Scale by bytes: input tokens and $ grow with the code read; output with the comments written (also ~ per byte).
  const perByte = { in: sum('in') / bytes, out: sum('out') / bytes, usd: sum('usd') / bytes };
  // (the instructions, ~330 tokens a call, are already inside the measured per-byte rate)
  const est = (b, calls) => ({ calls: Math.round(calls), usd: +(perByte.usd * b).toFixed(2), inM: +((perByte.in * b) / 1e6).toFixed(2), outM: +((perByte.out * b) / 1e6).toFixed(2) });
  const per1k = est((corpus.bytes / corpus.files) * 1000, (corpus.calls / corpus.files) * 1000);
  out.models[model] = {
    files: R.length, answered: ok.length, json: R.filter((r) => r.json).length, withComments, codeUnchanged: same,
    comments: sum('comments'), perFile: +(sum('comments') / ok.length).toFixed(1),
    judge: { n: jn, accurate: +(jsum('accurate') / jn).toFixed(2), placed: +(jsum('placed') / jn).toFixed(2), helpful: +(R.reduce((a, r) => a + (r.judge?.helpful || 0) * (r.judge?.n || 0), 0) / jn).toFixed(2) },
    tokens: { in: sum('in'), out: sum('out') }, usd: +sum('usd').toFixed(4), judgeUsd: +R.reduce((a, r) => a + (r.judge?.usd || 0), 0).toFixed(4),
    latencyS: { p50: +(ms[ms.length >> 1] / 1000).toFixed(1), p90: +(ms[Math.floor(ms.length * 0.9)] / 1000).toFixed(1), max: +(ms[ms.length - 1] / 1000).toFixed(1) },
    per1kFiles: per1k, allSrcVs: est(corpus.bytes, corpus.calls),
  };
}
fs.writeFileSync(path.join(HERE, IN.includes('f0-google.jsonl') ? 'f0-summary-all.json' : 'f0-summary.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
