// Fleet F0 benchmark: N VS Code TypeScript files x M Workers AI models through AI Gateway qodebase-fleet.
// Each model returns comment insertions as JSON; we insert them, verify the code is unchanged (verify.mjs), judge a
// sample with a stronger model, and record tokens, neurons ($), latency. Writes sim/fleet/f0-results.jsonl.
// node sim/fleet/bench.mjs [--files 20] [--models a,b] [--judge @cf/openai/gpt-oss-120b] [--budget 2]
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { sameCode, insertComments } from './verify.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = path.join(process.env.HOME, 'projects/github/microsoft/vscode');
const ACC = '887d7234a6b8d65ad355a4f6684cab67', GW = 'qodebase-fleet';
const TOKEN = fs.readFileSync(path.join(process.env.HOME, '.config/forq-cf/api-token'), 'utf8').trim();
const USD_PER_NEURON = 0.011 / 1000;
const MODELS = {
  '@cf/zai-org/glm-4.7-flash': { chat_template_kwargs: { enable_thinking: false } },
  '@cf/google/gemma-4-26b-a4b-it': { chat_template_kwargs: { enable_thinking: false } },
  '@cf/zai-org/glm-5.3-flash': { reasoning_effort: 'low' },
};
// Google AI Studio through the same gateway (provider google-ai-studio), key from ~/.config/qodebase-fleet/gemini.key
// (never printed). $ per M tokens, ai.google.dev/gemini-api/docs/pricing (updated 2026-10-09); thoughts bill as output.
// Gemma 4 on AI Studio: free tier only (paid 'not available'), so $0 here and low limits.
const GOOGLE = {
  'google/gemini-3.5-flash-lite': { in: 0.30, out: 2.50 },
  'google/gemini-3.1-flash-lite': { in: 0.25, out: 1.50 },
  'google/gemma-4-26b-a4b-it': { in: 0, out: 0 },
};
const GKEY = (() => { try { return fs.readFileSync(path.join(process.env.HOME, '.config/qodebase-fleet/gemini.key'), 'utf8').trim(); } catch { return null; } })();
const models = (arg('models') || Object.keys(MODELS).join(',')).split(',');
const JUDGE = arg('judge', '@cf/openai/gpt-oss-120b');
const BUDGET = +arg('budget', 2);
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), arg('out', 'f0-results.jsonl'));
let spentUsd = 0;
const log = (o) => fs.appendFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), ...o }) + '\n');

// Pick files: non-test .ts under src/vs, 2-24 KB, spread over the four layers, seeded so reruns pick the same.
function pick(n) {
  const all = execSync(`cd ${ROOT} && find src/vs -name '*.ts' -not -path '*/test/*' -not -name '*.d.ts' -size +2k -size -24k`, { encoding: 'utf8' }).trim().split('\n').sort();
  let s = 42; const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const layers = ['src/vs/base/', 'src/vs/platform/', 'src/vs/editor/', 'src/vs/workbench/'];
  const out = [];
  for (let i = 0; out.length < n; i++) { const L = layers[i % 4]; const pool = all.filter((f) => f.startsWith(L) && !out.includes(f)); out.push(pool[Math.floor(rnd() * pool.length)]); }
  return out;
}

async function callGoogle(model, messages, maxTokens) {
  const m = model.slice('google/'.length), price = GOOGLE[model];
  const sys = messages.find((x) => x.role === 'system')?.content;
  const t0 = Date.now();
  const r = await fetch(`https://gateway.ai.cloudflare.com/v1/${ACC}/${GW}/google-ai-studio/v1beta/models/${m}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': GKEY, 'content-type': 'application/json', 'cf-aig-metadata': JSON.stringify({ run: 'f0' }) },
    body: JSON.stringify({ ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}),
      contents: messages.filter((x) => x.role !== 'system').map((x) => ({ role: 'user', parts: [{ text: x.content }] })),
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'minimal' } } }) });
  const ms = Date.now() - t0;
  const d = await r.json().catch(() => ({}));
  const u = d.usageMetadata || {};
  const out = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
  const usd = ((u.promptTokenCount || 0) * price.in + out * price.out) / 1e6; spentUsd += usd;
  const text = (d.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  return { ok: r.ok, status: r.status, ms, text, in: u.promptTokenCount, out, neurons: null, usd, err: r.ok ? null : JSON.stringify(d).slice(0, 300) };
}

async function call(model, messages, extra = {}, maxTokens = 4000) {
  if (spentUsd >= BUDGET) throw new Error(`budget ${BUDGET} reached`);
  if (model.startsWith('google/')) return callGoogle(model, messages, maxTokens);
  const t0 = Date.now();
  const r = await fetch(`https://gateway.ai.cloudflare.com/v1/${ACC}/${GW}/workers-ai/v1/chat/completions`, {
    method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', 'cf-aig-metadata': JSON.stringify({ run: 'f0' }) },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.2, ...extra }) });
  const ms = Date.now() - t0;
  const d = await r.json().catch(() => ({}));
  const u = d.usage || {};
  const usd = (u.neurons || 0) * USD_PER_NEURON; spentUsd += usd;
  return { ok: r.ok, status: r.status, ms, text: d.choices?.[0]?.message?.content ?? '', in: u.prompt_tokens, out: u.completion_tokens, neurons: u.neurons, usd, err: r.ok ? null : JSON.stringify(d).slice(0, 300) };
}

const SYS = 'You add documentation comments to TypeScript source code. You never change code.';
const ask = (file, text) => `Below is ${file} from VS Code, with line numbers. For each exported or public declaration (function, class, method, interface, type alias, enum, exported const) that has NO doc comment right above it, write a short, accurate JSDoc comment (/** ... */) that says what it does and, where useful, its parameters and return value. Skip trivial getters, overrides and anything whose name already says it all. Use the line number of the declaration's first line (its first decorator, if any). Answer ONLY with JSON, no prose: {"comments":[{"line":<number>,"comment":"/** ... */"}]}. At most 25 comments.\n\n` +
  text.split('\n').map((l, i) => `${String(i + 1).padStart(5)}| ${l}`).join('\n');

function parseJson(t) {
  const m = t.match(/\{[\s\S]*\}/); if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

const JUDGE_ASK = (items) => `You review documentation comments added to VS Code TypeScript code. For each item, the comment is shown with the code right below it. Score: accurate (true if nothing in the comment is wrong about the code), helpful (1-5: 1 = noise or restates the name, 3 = fine, 5 = says what a reader needs), placed (true if it sits right above the declaration it describes). Answer ONLY with JSON: {"scores":[{"i":<n>,"accurate":true|false,"helpful":1-5,"placed":true|false}]}\n\n` +
  items.map((it, i) => `--- item ${i}\n${it.comment}\n${it.code}`).join('\n\n');

async function pool(items, n, fn) { const res = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; res[k] = await fn(items[k]); } })); return res; }

const files = pick(+arg('files', 20));
console.log('files', files.length, 'models', models.join(' '));
for (const model of models) {
  const rows = await pool(files, 5, async (file) => {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const r = await call(model, [{ role: 'system', content: SYS }, { role: 'user', content: ask(file, text) }], MODELS[model] || {});
    const j = r.ok ? parseJson(r.text) : null;
    const items = Array.isArray(j?.comments) ? j.comments.filter((c) => Number.isInteger(c.line) && typeof c.comment === 'string' && c.comment.trim().startsWith('/**') && c.comment.trim().endsWith('*/')) : [];
    const after = insertComments(text, items);
    const v = sameCode(text, after, file);
    const lines = text.split('\n');
    const row = { model, file, bytes: text.length, ok: r.ok, status: r.status, ms: r.ms, in: r.in, out: r.out, neurons: r.neurons, usd: r.usd, json: !!j, comments: items.length, dropped: (j?.comments?.length || 0) - items.length, same: v.same, why: v.why, err: r.err };
    row.sample = items.map((c) => ({ line: c.line, comment: c.comment.trim(), code: lines.slice(c.line - 1, c.line + 11).join('\n') }));
    return row;
  });
  // Judge: every comment of the model, batched per file.
  for (const row of rows) {
    if (!row.sample.length) { row.judge = null; log(row); continue; }
    const jr = await call(JUDGE, [{ role: 'user', content: JUDGE_ASK(row.sample) }], { reasoning_effort: 'low' }, 3000);
    const js = parseJson(jr.text)?.scores || [];
    row.judge = { n: js.length, accurate: js.filter((s) => s.accurate === true).length, placed: js.filter((s) => s.placed === true).length, helpful: js.length ? +(js.reduce((a, s) => a + (+s.helpful || 0), 0) / js.length).toFixed(2) : null, usd: jr.usd };
    log(row);
  }
  const ok = rows.filter((r) => r.ok);
  const sum = (k) => ok.reduce((a, r) => a + (r[k] || 0), 0);
  const jn = rows.reduce((a, r) => a + (r.judge?.n || 0), 0);
  const s = { event: 'summary', model, files: rows.length, ok: ok.length, json: rows.filter((r) => r.json).length, same: rows.filter((r) => r.same && r.comments > 0).length,
    comments: sum('comments'), in: sum('in'), out: sum('out'), usd: +sum('usd').toFixed(4), msMedian: ok.map((r) => r.ms).sort((a, b) => a - b)[ok.length >> 1],
    accurate: jn ? +(rows.reduce((a, r) => a + (r.judge?.accurate || 0), 0) / jn).toFixed(2) : null, placed: jn ? +(rows.reduce((a, r) => a + (r.judge?.placed || 0), 0) / jn).toFixed(2) : null,
    helpful: jn ? +(rows.reduce((a, r) => a + (r.judge?.helpful || 0) * (r.judge?.n || 0), 0) / jn).toFixed(2) : null, judgeUsd: +rows.reduce((a, r) => a + (r.judge?.usd || 0), 0).toFixed(4) };
  log(s); console.log(JSON.stringify(s));
}
console.log('spent', spentUsd.toFixed(4));
