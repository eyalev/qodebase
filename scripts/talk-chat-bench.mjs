#!/usr/bin/env node
// Talk's chat lane, model by model: page situations from scripts/talk-fixtures with the tool a good answer uses
// (or none), run inside the Talk Worker (POST /api/talk/admin/chatbench, owner only: Gemini's key and Claude's billing
// live there) with the lane's own prompt and tools. Scores tool choice and latency. Auth: the qodebase.app session
// cookie of the debug Chrome (port 9222). Run from the forq root:
//   node scripts/talk-chat-bench.mjs [--models gemini,glm,big,haiku,sonnet,@cf/openai/gpt-oss-120b] [--runs 2]
// One JSONL line per call to ~/.local/share/forq/talk-chat-bench.jsonl.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MODELS = arg('--models', 'gemini,glm,big').split(','), RUNS = Number(arg('--runs', '2'));
const FX = path.join(path.dirname(new URL(import.meta.url).pathname), 'talk-fixtures');
const fx = (f) => JSON.parse(fs.readFileSync(path.join(FX, f + '.json'), 'utf8'));
const idOf = (page, re, kind) => fx(page).items.filter((i) => (!kind || i.kind === kind) && re.test(i.text)).map((i) => i.id);
// [page, sentence, expectation]: tool (name), ids (one of), arg (substring of an argument), none (no tool at all is right), never (tools that must not be used)
const CASES = [
  ['deck', 'go to the next slide', { tool: 'press', ids: idOf('deck', /^Next slide/) }],
  ['home_build', 'type a habit tracker into the idea box', { tool: 'type_into', ids: idOf('home_build', /what do you want to build/i, 'field'), arg: 'habit' }],
  ['home_build', 'point at the presets and explain them', { tool: 'show', ids: idOf('home_build', /^(Fastest|Balanced|Cheapest)/) }],
  ['work', 'switch to the timeline tab', { tool: 'press', ids: idOf('work', /^Timeline/, 'button') }],
  ['asks', 'show only the landed ones', { tool: 'press', ids: idOf('asks', /^Landed/, 'button') }],
  ['settings', 'where do I turn off the build notification? show me', { tool: 'show', ids: idOf('settings', /^When a build finishes/) }],
  ['p_forq_calculator', 'open its live app', { tool: 'go', arg: '/app' }],
  ['mine', 'open my tip split app', { tool: 'go', arg: 'tipsplit' }],
  ['home', 'what is qodebase?', { none: true, never: ['press', 'type_into', 'go'] }],
  ['runs', 'what is a scale run?', { none: true, never: ['press', 'type_into'] }],
  ['home', 'how much does it cost to run agents?', { none: true, never: ['press', 'type_into'] }],
  ['work', 'what does the line tab show? point at it', { tool: 'show', ids: idOf('work', /^Line/, 'button') }],
];
function judge(r, want, page) {
  if (r.error) return 'error';
  const t = r.tools || [];
  if (want.never && t.some((x) => want.never.includes(x.name))) return 'wrong tool';
  if (want.none) return r.reply ? 'ok' : (t.length ? 'ok' : 'no words');
  const hit = t.find((x) => x.name === want.tool);
  if (!hit) return t.length ? `wrong tool (${t.map((x) => x.name).join(',')})` : 'no tool';
  // A link id is right when its link goes to the right place: judge the address it points at too.
  let vals = JSON.stringify(hit.args);
  const linked = page && Object.values(hit.args || {}).map((v) => fx(page).items.find((i) => i.id === v)?.href).filter(Boolean);
  if (linked && linked.length) vals += ' ' + JSON.stringify(linked);
  if (want.ids && want.ids.length && !want.ids.some((id) => vals.includes(`"${id}"`))) return `wrong target ${vals.slice(0, 60)}`;
  if (want.arg && !vals.toLowerCase().includes(want.arg)) return `wrong arg ${vals.slice(0, 60)}`;
  return 'ok';
}
const tabs = await (await fetch('http://127.0.0.1:9222/json')).json();
const ws = tabs.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
const cookies = await new Promise((res, rej) => { const s = new WebSocket(ws); s.onopen = () => s.send(JSON.stringify({ id: 1, method: 'Network.getAllCookies' })); s.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) { s.close(); res(d.result.cookies); } }; s.onerror = rej; });
const cookie = cookies.filter((c) => /qodebase\.app$/.test(c.domain)).map((c) => `${c.name}=${c.value}`).join('; ');
const OUT = path.join(os.homedir(), '.local/share/forq/talk-chat-bench.jsonl');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const cases = CASES.map(([page, utterance]) => ({ screen: fx(page), utterance, pageText: '' }));
const score = {};
for (let run = 0; run < RUNS; run++) {
  const r = await fetch('https://qodebase.app/api/talk/admin/chatbench', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ cases, models: MODELS }) });
  const j = await r.json();
  if (!j.results) { console.log('bench error', JSON.stringify(j).slice(0, 300)); process.exit(1); }
  for (const x of j.results) {
    const [page, utterance, want] = CASES[x.i];
    const v = judge(x, want, page);
    (score[x.model] ||= { ok: 0, n: 0, ms: [], errors: 0, misses: [], won: {}, usd: [] });
    const s = score[x.model]; s.n++; s.ms.push(x.ms);
    if (x.won) s.won[x.won] = (s.won[x.won] || 0) + 1;   // a hedged default ('fast'): which model answered
    if (x.usdMilli != null) s.usd.push(x.usdMilli / 1000); if (v === 'ok') s.ok++; else { if (v === 'error') s.errors++; s.misses.push(`${utterance} → ${v}${x.error ? ': ' + x.error.slice(0, 80) : ''}`); }
    fs.appendFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), model: x.model, page, utterance, verdict: v, ms: x.ms, tools: x.tools, reply: x.reply, usage: x.usage, error: x.error, won: x.won, race: x.race, usdMilli: x.usdMilli }) + '\n');
  }
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const p90 = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * 0.9)]; };
for (const [m, s] of Object.entries(score)) {
  const won = Object.keys(s.won).length ? '  answered by ' + Object.entries(s.won).map(([k, n]) => `${k} ${n}`).join(', ') : '';
  const usd = s.usd.length ? `  cost/turn $${(s.usd.reduce((a, b) => a + b, 0) / s.usd.length).toFixed(5)} (both models' calls until the winner; a backup that lands later bills on its own)` : '';
  console.log(`${m.padEnd(36)} tools right ${s.ok}/${s.n}  median ${med(s.ms)} ms  p90 ${p90(s.ms)} ms${s.errors ? `  errors ${s.errors}` : ''}${won}${usd}`);
  for (const x of [...new Set(s.misses)].slice(0, 6)) console.log('    ' + x);
}

