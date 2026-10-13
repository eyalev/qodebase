#!/usr/bin/env node
// Talk dictation bench: Eyal's real dictations from tmux-web (<recordings dir>, audio + the
// final text tmux-web produced with Groq whisper-large-v3-turbo) through what Talk uses on qodebase's own account:
// Workers AI whisper-large-v3-turbo (the final pass) and Workers AI nova-3 (the live words, here on the whole clip).
// Scores word error rate against tmux-web's final (agreement, not ground truth). Audio never leaves the laptop
// except to Workers AI; nothing is committed. Run from the forq root:
//   node scripts/talk-stt-bench.mjs [--en 8] [--he 4]
// One JSONL line per clip to ~/.local/share/forq/talk-stt-bench.jsonl.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MERGE_MODEL, mergeMessages, cleanMerge } from '../src/talkmerge.ts';

const ACC = '887d7234a6b8d65ad355a4f6684cab67';
const TOKEN = fs.readFileSync(path.join(os.homedir(), '.config/forq-cf/api-token'), 'utf8').trim();
const DIR = path.join(os.homedir(), '.config/tmux-web/voice-recordings');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const nEn = arg('--en', 8), nHe = arg('--he', 4);
const OUT = path.join(os.homedir(), '.local/share/forq/talk-stt-bench.jsonl');
// --names <json file>: the speaker's names/terms for the merge prompt (Talk sends the person's project names).
const NAMES = process.argv.includes('--names') ? JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--names') + 1], 'utf8')) : [];

const clips = [];
for (const d of fs.readdirSync(DIR).filter((x) => /^2026-/.test(x)).sort().reverse()) {
  for (const f of fs.readdirSync(path.join(DIR, d)).filter((x) => x.endsWith('.json')).sort().reverse()) {
    let m; try { m = JSON.parse(fs.readFileSync(path.join(DIR, d, f), 'utf8')); } catch { continue; }
    if (m.endpoint !== 'groq' || m.partial === true || m.partial === 'True' || !m.stt?.text) continue;
    const audio = path.join(DIR, d, f.replace('.json', '.webm'));
    if (!fs.existsSync(audio)) continue;
    const words = m.stt.text.trim().split(/\s+/).length;
    const he = /[֐-׿]/.test(m.stt.text);
    clips.push({ id: m.id, audio, ref: m.stt.text.trim(), words, he, lang: m.sttLang || 'en' });
  }
}
const en = clips.filter((c) => !c.he && c.words >= 6 && c.words <= 60).slice(0, nEn);
const he = clips.filter((c) => c.he && c.words >= 4).slice(0, nHe);

const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean);
function wer(ref, hyp) {
  const r = norm(ref), h = norm(hyp);
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
  return r.length ? d[r.length][h.length] / r.length : 0;
}
async function whisper(buf, lang) {
  const t0 = Date.now();
  const r = await fetch(`https://gateway.ai.cloudflare.com/v1/${ACC}/qodebase-talk/workers-ai/@cf/openai/whisper-large-v3-turbo`, {
    method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ audio: buf.toString('base64'), ...(lang === 'en' || lang === 'he' ? { language: lang } : {}), vad_filter: true }),
  });
  const j = await r.json().catch(() => ({}));
  return { text: (j.result || j).text || '', ms: Date.now() - t0, err: j.errors?.[0]?.message };
}
async function nova(buf, lang) {
  const t0 = Date.now();
  const q = new URLSearchParams({ language: lang === 'he' ? 'he' : lang === 'auto' ? 'multi' : 'en', smart_format: 'true', punctuate: 'true' });
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACC}/ai/run/@cf/deepgram/nova-3?${q}`, {
    method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'audio/webm' }, body: buf,
  });
  const j = await r.json().catch(() => ({}));
  const res = j.result || j;
  const text = res?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? res?.text ?? '';
  return { text, ms: Date.now() - t0, err: j.errors?.[0]?.message || (r.ok ? undefined : `HTTP ${r.status}`) };
}

async function merge(live, whisper, lang) {
  const t0 = Date.now();
  const r = await fetch(`https://gateway.ai.cloudflare.com/v1/${ACC}/qodebase-talk/workers-ai/${MERGE_MODEL}`, {
    method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messages: mergeMessages(live, whisper, NAMES, lang), max_tokens: 400, temperature: 0, chat_template_kwargs: { enable_thinking: false } }),
  });
  const j = await r.json().catch(() => ({}));
  const res = j.result || j;
  const raw = res?.choices?.[0]?.message?.content ?? res?.response ?? '';
  const t = cleanMerge(raw, live, whisper);
  return { text: t ?? whisper, used: t != null, ms: Date.now() - t0 };
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const sum = { en: { w: [], n: [], m: [] }, he: { w: [], n: [], m: [] } };
for (const c of [...en, ...he]) {
  const buf = fs.readFileSync(c.audio);
  const lang = c.he ? 'he' : 'en';
  const [w, n] = await Promise.all([whisper(buf, lang), nova(buf, lang)]);
  const m = await merge(n.text, w.text, lang);
  const row = { ts: new Date().toISOString(), id: c.id, lang, words: c.words, wer_whisper: +wer(c.ref, w.text).toFixed(3), wer_nova: +wer(c.ref, n.text).toFixed(3), wer_merge: +wer(c.ref, m.text).toFixed(3), ms_merge: m.ms, merge_used: m.used, merged: m.text.slice(0, 160), ms_whisper: w.ms, ms_nova: n.ms, err: w.err || n.err, ref: c.ref.slice(0, 160), whisper: w.text.slice(0, 160), nova: n.text.slice(0, 160) };
  fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
  sum[lang].w.push(row.wer_whisper); sum[lang].n.push(row.wer_nova); sum[lang].m.push(row.wer_merge);
  console.log(`${lang} ${String(c.words).padStart(3)}w  whisper ${row.wer_whisper.toFixed(2)} (${w.ms} ms)  nova-3 ${row.wer_nova.toFixed(2)} (${n.ms} ms)  merge ${row.wer_merge.toFixed(2)} (${m.ms} ms${m.used ? '' : ', fell back'})${row.err ? '  ERR ' + row.err : ''}\n   ref:     ${row.ref}\n   whisper: ${row.whisper}\n   nova-3:  ${row.nova}\n   merged:  ${row.merged}`);
}
const mean = (a) => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(3) : '-';
console.log(`\nmean WER vs tmux-web's final  en (${sum.en.w.length}): whisper ${mean(sum.en.w)}  nova-3 ${mean(sum.en.n)}  merge ${mean(sum.en.m)}   he (${sum.he.w.length}): whisper ${mean(sum.he.w)}  nova-3 ${mean(sum.he.n)}  merge ${mean(sum.he.m)}`);
