// Talk to qodebase: speak or type a sentence on any page, and the app does it
// (go somewhere, open a project or one of its parts, search, type, press,
// scroll), answers it, or both. Layer over every UI page (/talk.js, injected by
// withBaseline), so no page has to know about it.
//
//   POST /api/talk/decide      one sentence -> command (clef-flash, ~0.5 s, src/talkdecide.ts)
//   POST /api/talk/chat        questions and "both": glm-4.7-flash with the same actions as tools
//   POST /api/talk/transcribe  audio -> text (Whisper large v3 turbo), for the Whisper dictation setting
//   POST /api/talk/status      "what's going on": their agents, what is ready, what changed (real data, no model)
//   GET  /api/talk/tts         spoken reply: Deepgram Aura (Workers AI), MP3 streamed while it is made, cached per colo
//   POST /api/talk/trace       the owner's experience trace (page views, taps, Talk steps, errors); GET reads it
//   GET  /api/talk/me          signed in? today's budget left
//   POST /api/talk/log         one row per page-tool call (window.__webmcp, Jarvis hands)
//   GET  /talk.js              the layer (src/talkclient.ts)
//
// Cost: every model call goes through the AI Gateway in TALK_GATEWAY (rate
// limited) and counts against TalkLog's daily caps, per person and in total.
// Signed-in people only.
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';
import { listFor } from './registry';
import { isOwner } from './auth';
import { buildQuestions, candidateProjects, currentSlug, resolve, stateText, type Item, type Proj, type Screen } from './talkdecide';
import { TALK_JS } from './talkclient';
import { TALK_VOICE_JS } from './talkvoicejs.gen';
import { routeAgentRequest } from 'agents';

const DECIDE_MODEL = '@cf/cloudflare/clef-flash';
const CHAT_MODEL = '@cf/zai-org/glm-4.7-flash';
const STT_MODEL = '@cf/openai/whisper-large-v3-turbo';
// Daily caps (UTC day). A person's own, and everyone's together.
const CAPS = { decide: { me: 600, all: 5000 }, chat: { me: 150, all: 1500 }, stt: { me: 300, all: 3000 }, status: { me: 200, all: 2000 }, tts_chars: { me: 20000, all: 150000 }, voice_sec: { me: 3600, all: 36000 } };   // voice_sec: open conversation time (Flux bills it, silence too): 60 min/day each = $0.46   // tts in characters: 20k = $0.30 of Aura-1 a day each
type Kind = keyof typeof CAPS;

const log = (event: string, data: Record<string, unknown> = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), module: 'talk', event, ...data }));
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const day = () => new Date().toISOString().slice(0, 10);

/** Daily counts per kind, per person and in total. One object per UTC day. */
export class TalkLog extends DurableObject<Env> {
  async take(kind: Kind, who: string, n = 1): Promise<{ ok: boolean; left: number }> {
    const me = `${kind}:${who}`, all = `${kind}:*`;
    const [a, b] = [(await this.ctx.storage.get<number>(me)) || 0, (await this.ctx.storage.get<number>(all)) || 0];
    if (a + n > CAPS[kind].me || b + n > CAPS[kind].all) return { ok: false, left: 0 };
    await this.ctx.storage.put({ [me]: a + n, [all]: b + n });
    return { ok: true, left: Math.min(CAPS[kind].me - a - n, CAPS[kind].all - b - n) };
  }
  // ---- Experience trace (the owner's own use only): what happened, step by step, per tab session.
  #traceReady = false;
  #trace() {
    if (!this.#traceReady) { this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS trace (ts INTEGER, handle TEXT, sid TEXT, ev TEXT, data TEXT)'); this.#traceReady = true; }
    return this.ctx.storage.sql;
  }
  async addTrace(handle: string, sid: string, rows: { ts: number; ev: string; data: string }[]) {
    const sql = this.#trace();
    const n = (sql.exec('SELECT COUNT(*) AS n FROM trace WHERE handle = ?', handle).one() as any).n as number;
    if (n > 20000) return { ok: false, n };
    for (const r of rows) sql.exec('INSERT INTO trace (ts, handle, sid, ev, data) VALUES (?, ?, ?, ?, ?)', r.ts, handle, sid, r.ev, r.data);
    return { ok: true, n: n + rows.length };
  }
  async readTrace(handle: string, since: number, limit: number) {
    return this.#trace().exec('SELECT ts, sid, ev, data FROM trace WHERE handle = ? AND ts > ? ORDER BY ts LIMIT ?', handle, since, limit).toArray();
  }
  async counts(who: string) {
    const out: Record<string, number> = {};
    for (const k of Object.keys(CAPS) as Kind[]) out[k] = (await this.ctx.storage.get<number>(`${k}:${who}`)) || 0;
    return out;
  }
}
export const talkLog = (env: Env) => env.TalkLog.get(env.TalkLog.idFromName(day()));

const aiOpts = (env: Env) => (env.TALK_GATEWAY ? { gateway: { id: env.TALK_GATEWAY } } : {});

// clef-flash latency is bimodal (talkui, 2026-10-02): most calls 0.3–0.9 s, about
// one in four 12–90 s upstream. Fire it again at each mark; the first answer wins.
const HEDGE_MS = [1200, 2500];
async function hedged<T>(call: () => Promise<T>, marks: number[]): Promise<{ res: T; fired: number; won: number }> {
  let fired = 1;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const first = call().then((res) => ({ res, which: 0 }));
  const extra = marks.map((ms, i) => new Promise<{ res: T; which: number }>((ok, bad) => {
    timers.push(setTimeout(() => { fired++; call().then((res) => ok({ res, which: i + 1 }), bad); }, ms));
  }));
  try {
    const w = await Promise.any([first, ...extra]);
    return { res: w.res, fired, won: w.which };
  } finally { timers.forEach(clearTimeout); }
}

export type Who = { handle: string; admin: boolean } | null;

/** Keep what the page sends to a known shape and size (it is the model's input). */
function cleanScreen(b: any): Screen {
  const items: Item[] = (Array.isArray(b?.items) ? b.items : []).slice(0, 140).map((i: any) => ({
    id: String(i.id || '').slice(0, 8), kind: (['link', 'button', 'field', 'heading'].includes(i.kind) ? i.kind : 'link') as Item['kind'],
    text: String(i.text || '').slice(0, 140), href: i.href ? String(i.href).slice(0, 300) : undefined,
  })).filter((i: Item) => /^[lbfh]\d{1,4}$/.test(i.id) && i.text);
  return { path: String(b?.path || '/').slice(0, 200), title: String(b?.title || '').slice(0, 120), items, projects: [], last: b?.last ? String(b.last).slice(0, 120) : null };
}

async function projectsFor(env: Env, who: Who): Promise<Proj[]> {
  const list = await listFor(env, who?.handle || '', !!who?.admin);
  return list.slice(0, 400).map((e: any, i: number) => ({ id: `p${i + 1}`, slug: e.slug, name: e.name, owner: e.owner, description: String(e.description || '').slice(0, 120), mine: !!who && e.owner === who.handle, updatedAt: e.updatedAt || 0 }));
}

export async function decideCore(env: Env, who: Who & {}, body: any) {
  const t0 = Date.now();
  const utterance = String(body?.utterance || '').trim().slice(0, 300);
  if (!utterance) return { ok: false as const, http: 400, error: 'empty' };
  const budget = await talkLog(env).take('decide', who.handle);
  if (!budget.ok) return { ok: false as const, http: 429, error: 'budget', why: 'Talk has reached today\'s limit. It resets at midnight UTC.' };
  const s = { ...cleanScreen(body.screen), me: who.handle };
  const projects = candidateProjects(utterance, await projectsFor(env, who), 24, currentSlug(s.path));
  const { questions, cands } = buildQuestions(utterance, s, projects);
  const state = stateText(utterance, s, projects);
  const tm = Date.now();
  let res: any, fired = 1, won = 0;
  try {
    ({ res, fired, won } = await hedged(() => (env.AI as any).run(DECIDE_MODEL, { model: 'clef-flash', state, questions }, aiOpts(env)), body.interim ? [] : HEDGE_MS));
  } catch (e) {
    log('decide_error', { level: 'error', err: String(e), stack: (e as Error)?.stack, handle: who.handle });
    return { ok: false as const, http: 502, error: 'model', why: 'The model did not answer. Try again.' };
  }
  const cmd = resolve(res.answers, cands, s, projects, utterance);
  log('decide', { level: 'info', handle: who.handle, path: s.path, interim: !!body.interim, model_ms: Date.now() - tm, total_ms: Date.now() - t0, fired, won,
    n_items: s.items.length, n_projects: projects.length, n_questions: Object.keys(questions).length, mode: cmd.mode, mode_p: cmd.modeP, op: cmd.op, p: cmd.p, risky: cmd.risky, why: cmd.why, usage: res.usage });
  return { ok: true as const, cmd, ms: { model: Date.now() - tm, total: Date.now() - t0 }, left: budget.left, ...(body.debug ? { answers: res.answers, state } : {}) };
}

// ---- Chat lane: answers questions about the page, and can act with the same verbs.
const TOOLS = [
  { type: 'function', function: { name: 'go', description: 'Open a page: a link id from the page (like l12) or a path on this site (like /p/forq/timer/app).', parameters: { type: 'object', properties: { to: { type: 'string' } }, required: ['to'] } } },
  { type: 'function', function: { name: 'press', description: 'Press a button on the page by its id (like b3). Never for deleting, merging, publishing or signing out.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'type_into', description: 'Type text into a field on the page by its id (like f1).', parameters: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] } } },
  { type: 'function', function: { name: 'show', description: 'Point at parts of the page while you explain them: heading, link, button or field ids, in the order you talk about them.', parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] } } },
];

export async function chatCore(env: Env, who: Who & {}, body: any) {
  const t0 = Date.now();
  const utterance = String(body?.utterance || '').trim().slice(0, 500);
  if (!utterance) return { ok: false as const, http: 400, error: 'empty' };
  const budget = await talkLog(env).take('chat', who.handle);
  if (!budget.ok) return { ok: false as const, http: 429, error: 'budget', why: 'Talk has reached today\'s chat limit. It resets at midnight UTC.' };
  const s = cleanScreen(body.screen);
  const pageText = String(body.pageText || '').slice(0, 5000);
  const did = body.did ? String(body.did).slice(0, 200) : '';
  const items = s.items.map((i) => `${i.id} ${i.kind}: ${i.text}${i.href ? ' → ' + i.href : ''}`).join('\n');
  const system = [
    'You are the voice of qodebase, a git platform made for the phone: every project runs as a live app, every fork gets its own AI agents, and people can install AI assistants into their own Cloudflare account.',
    `You talk with ${who.handle}, who is on ${s.path} ("${s.title}"). Answer in plain words, short: two or three sentences unless they ask for more. Spoken aloud too, so no markdown, no lists, no code, and never read out paths, URLs or ids (say "this page", "the Hermes card").`,
    'You can act with the tools: open pages, press buttons, type into fields, and point at parts of the page while you explain. Act when asked; explain what is on the page when asked; never press anything that deletes, merges, publishes or signs out.',
    'What is true about qodebase (say you do not know rather than guess anything else):',
    '- Every project is a git repo stored in Cloudflare Artifacts. Static projects run live at <name>--<owner>.ttyview.dev; projects with a Worker config are deployed as Cloudflare Workers.',
    '- Fork copies a project to your account. Ask (the router agent) splits a request into tasks; each task gets an agent (Claude Code in a Cloudflare container) on its own fork; a reviewer agent checks pushes; you merge from the phone.',
    '- Your own AI assistant (/personal-agents) installs an assistant into YOUR Cloudflare account with Sign in with Cloudflare: Cloudflare Agent fits the free plan; OpenClaw, Hermes, T3 Code, Mobile Agent and Pi need Workers Paid ($5 a month per account, not per assistant). Mobile Agent and T3 Code can use your own Claude subscription.',
    '- Get your own qodebase (/own) installs a whole copy of qodebase into your Cloudflare account. The qb command line (/cli) does everything from a terminal or an agent.',
    did ? `The app has ALREADY done this for their sentence: ${did}. Do not do it again; answer the rest of what they asked, about the page they are on now.` : '',
    '', 'What is on the page (id, kind, text):', items || '(nothing)', '', 'The page text:', pageText || '(none)',
  ].filter((x) => x !== '').join('\n');
  const history = (Array.isArray(body.history) ? body.history : []).slice(-8).map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 800) }));
  const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content: utterance }];
  const tm = Date.now();
  // After a "both" sentence the app has already acted (did): answer only, no tools, or it acts again.
  const run = (msgs: unknown[], tools = !did) => (env.AI as any).run(CHAT_MODEL, { messages: msgs, ...(tools ? { tools: TOOLS } : {}), max_tokens: 700, temperature: 0.3, chat_template_kwargs: { enable_thinking: false } }, aiOpts(env));
  const parse = (res: any) => {
    const msg = res?.choices?.[0]?.message || res;
    const raw = msg?.tool_calls || res?.tool_calls || [];
    const calls = raw.map((c: any) => {
      const f = c.function || c;
      let args: any = f.arguments;
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
      return { id: c.id, name: String(f.name || ''), args: args || {} };
    }).filter((c: any) => ['go', 'press', 'type_into', 'show'].includes(c.name)).slice(0, 4);
    return { msg, raw, calls, reply: String(msg?.content ?? res?.response ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim() };
  };
  let res: any, out: ReturnType<typeof parse>, rounds = 1;
  try {
    res = await run(messages);
    out = parse(res);
    // A tool call usually comes without words: report the tools as done and ask once more for what to say.
    if (!out.reply && out.raw.length) {
      rounds = 2;
      const res2 = await run([...messages, { role: 'assistant', content: '', tool_calls: out.raw },
        ...out.raw.map((c: any) => ({ role: 'tool', tool_call_id: c.id, content: 'done' }))]);
      const out2 = parse(res2);
      out = { ...out, reply: out2.reply };
      res = { ...res, usage2: res2?.usage };
    }
    if (!out.reply) {
      // Still no words: ask once more with no tools at all.
      rounds++;
      const res3 = await run(messages, false);
      out = { ...out, reply: parse(res3).reply };
    }
  } catch (e) {
    log('chat_error', { level: 'error', err: String(e), stack: (e as Error)?.stack, handle: who.handle });
    return { ok: false as const, http: 502, error: 'model', why: 'The model did not answer. Try again.' };
  }
  const { calls, reply } = out;
  log('chat', { level: 'info', handle: who.handle, path: s.path, rounds, model_ms: Date.now() - tm, total_ms: Date.now() - t0, tools: calls.map((c: any) => c.name), reply_len: reply.length, usage: res?.usage, usage2: res?.usage2 });
  return { ok: true as const, reply, actions: calls.map((c: any) => ({ name: c.name, args: c.args })), ms: { model: Date.now() - tm }, left: budget.left };
}

async function transcribe(request: Request, env: Env, who: Who & {}, url: URL) {
  const t0 = Date.now();
  const buf = await request.arrayBuffer();
  if (buf.byteLength < 800) return json({ text: '', why: 'too short' });
  if (buf.byteLength > 8_000_000) return json({ error: 'too long' }, 413);
  const budget = await talkLog(env).take('stt', who.handle);
  if (!budget.ok) return json({ error: 'budget', why: 'Dictation has reached today\'s limit. Use the phone\'s own dictation in Talk settings.' }, 429);
  const lang = url.searchParams.get('lang');
  let b64 = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) b64 += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  try {
    const res: any = await (env.AI as any).run(STT_MODEL, { audio: btoa(b64), ...(lang === 'en' || lang === 'he' ? { language: lang } : {}), vad_filter: true }, aiOpts(env));
    const text = String(res?.text || '').trim();
    log('stt', { level: 'info', handle: who.handle, bytes: buf.byteLength, lang, ms: Date.now() - t0, chars: text.length, detected: res?.transcription_info?.language });
    return json({ text, ms: Date.now() - t0 });
  } catch (e) {
    log('stt_error', { level: 'error', err: String(e), stack: (e as Error)?.stack, bytes: buf.byteLength, type: request.headers.get('content-type') });
    return json({ error: 'stt', why: 'Could not hear that. Try again, or use the phone\'s own dictation in Talk settings.' }, 502);
  }
}

let etagMemo: string | null = null;
async function talkEtag() {
  if (!etagMemo) {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(TALK_JS)));
    etagMemo = '"' + [...h.slice(0, 8)].map((x) => x.toString(16).padStart(2, '0')).join('') + '"';
  }
  return etagMemo;
}

// ---- "What's going on": from the projects themselves, not the page. No model:
// one Registry list + one Project info() per own project (newest 20), no boxes.
export async function statusCore(env: Env, who: Who & {}, body: any) {
  const t0 = Date.now();
  const budget = await talkLog(env).take('status', who.handle);
  if (!budget.ok) return { ok: false as const, http: 429, error: 'budget', why: 'Talk has reached today\'s limit. It resets at midnight UTC.' };
  const today = /\btoday\b/i.test(String(body?.utterance || ''));
  const since = Date.now() - (today ? 24 : 7 * 24) * 3600_000;
  const own = (await listFor(env, who.handle, false)).filter((e: any) => e.owner === who.handle)
    .sort((a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 20);
  const infos = await Promise.all(own.map((e: any) => env.Project.get(env.Project.idFromName(e.slug)).info().catch(() => null)));
  const working: string[] = [], ready: string[] = [], blocked: string[] = [], waiting: string[] = [];
  const links: { text: string; href: string }[] = [];
  const short = (t: string) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > 48 ? x.slice(0, 46).replace(/\s\S*$/, '') + '…' : x; };
  let changed = 0, merged = 0;
  own.forEach((e: any, i: number) => {
    const info: any = infos[i];
    if (!info) return;
    const base = `/p/${info.owner}/${info.name}`;
    let note = '';
    for (const a of info.agents || []) {
      const what = `“${short(a.request || a.task)}” in ${info.name}`;
      if (a.state === 'working') { working.push(what); note ||= 'working'; }
      else if (a.state === 'pushed') { ready.push(what + (a.review?.state === 'approved' ? ' (approved)' : a.review?.state === 'changes' ? ' (reviewer asked for changes)' : '')); note = 'ready to merge'; }
      else if (a.state === 'blocked') { blocked.push(what); note ||= 'blocked'; }
      else if (a.state === 'merged' && (a.noteAt || a.createdAt) >= since) merged++;
    }
    if (info.lastRequest && info.lastRequest.state !== 'sent' && info.lastRequest.at >= since) { waiting.push(`${info.name} (${info.lastRequest.state === 'failed' ? 'your request did not reach its agents' : 'delivering your request'})`); note ||= info.lastRequest.state === 'failed' ? 'request failed' : 'delivering'; }
    if ((e.updatedAt || 0) >= since) changed++;
    if (note) links.push({ text: `${info.name}: ${note}`, href: `${base}/changes` });
  });
  const list = (xs: string[]) => xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, 2).join(', ')} and ${xs.length - 2} more`;
  const parts: string[] = [];
  if (working.length) parts.push(`${working.length === 1 ? 'One agent is' : `${working.length} agents are`} working: ${list(working)}.`);
  if (ready.length) parts.push(`${ready.length === 1 ? 'One change is' : `${ready.length} changes are`} ready to merge: ${list(ready)}.`);
  if (blocked.length) parts.push(`Blocked and waiting for you: ${list(blocked)}.`);
  if (waiting.length) parts.push(`Also: ${list(waiting)}.`);
  if (!parts.length) parts.push(own.length ? 'Nothing is in progress: no agents working and nothing waiting to merge.' : 'You have no projects yet. Say what you want to build.');
  if (own.length) parts.push(`${today ? 'Today' : 'This week'} ${changed === 0 ? 'none of your projects changed' : changed === 1 ? 'one of your projects changed' : `${changed} of your projects changed`}${merged ? `, with ${merged} merged change${merged > 1 ? 's' : ''}` : ''}.`);
  log('status', { level: 'info', handle: who.handle, projects: own.length, working: working.length, ready: ready.length, blocked: blocked.length, waiting: waiting.length, changed, merged, ms: Date.now() - t0 });
  return { ok: true as const, text: parts.join(' '), links: links.slice(0, 6), ms: Date.now() - t0, left: budget.left };
}

// ---- Spoken replies: Aura on Workers AI, streamed (first sound ~0.5 s). Same voices
// and prices as jarvis (lib/voice.js): Aura-1 $0.015, Aura-2 $0.03 per 1k characters.
// Cached per colo by voice + text, so fixed lines and repeats never pay twice.
const VOICES: Record<string, { id: string; speakers: string[]; def: string }> = {
  'aura-1': { id: '@cf/deepgram/aura-1', def: 'helios', speakers: ['helios', 'angus', 'arcas', 'orion', 'orpheus', 'perseus', 'zeus', 'athena', 'asteria', 'luna', 'hera', 'stella'] },
  'aura-2': { id: '@cf/deepgram/aura-2-en', def: 'draco', speakers: ['draco', 'apollo', 'arcas', 'atlas', 'hermes', 'orion', 'zeus', 'asteria', 'athena', 'aurora', 'cora', 'helena', 'hera', 'iris', 'juno', 'luna', 'minerva', 'thalia'] },
};
async function tts(request: Request, env: Env, ctx: ExecutionContext, who: Who & {}, url: URL) {
  const t0 = Date.now();
  const text = String(url.searchParams.get('text') || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  if (!text) return json({ error: 'empty' }, 400);
  const model = VOICES[url.searchParams.get('model') || ''] ? url.searchParams.get('model')! : 'aura-2';   // Aura-2 default (Eyal, 2026-10-07)
  const v = VOICES[model];
  const speaker = v.speakers.includes(url.searchParams.get('speaker') || '') ? url.searchParams.get('speaker')! : v.def;
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${model}|${speaker}|${text}`)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const key = new Request(`https://talk-tts.cache/${hash}.mp3`);
  const hit = await caches.default.match(key);
  if (hit) { log('tts', { level: 'info', handle: who.handle, model, speaker, chars: text.length, cached: true, ms: Date.now() - t0 }); return new Response(hit.body, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'private, max-age=86400', 'x-talk-tts': 'cache' } }); }
  const budget = await talkLog(env).take('tts_chars', who.handle, text.length);
  if (!budget.ok) return json({ error: 'budget', why: 'Spoken replies have reached today\'s limit.' }, 429);
  let res: Response;
  try {
    res = await (env.AI as any).run(v.id, { text, speaker, encoding: 'mp3' }, { ...aiOpts(env), returnRawResponse: true });
  } catch (e) {
    log('tts_error', { level: 'error', err: String(e), stack: (e as Error)?.stack, model, chars: text.length });
    return json({ error: 'tts', why: 'No voice right now.' }, 502);
  }
  if (!res.ok || !res.body) { log('tts_error', { level: 'error', status: res.status, body: (await res.text().catch(() => '')).slice(0, 200) }); return json({ error: 'tts' }, 502); }
  const [a, b] = res.body.tee();
  ctx.waitUntil(new Response(b).arrayBuffer().then((buf) => caches.default.put(key, new Response(buf, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=604800' } }))).catch(() => {}));
  log('tts', { level: 'info', handle: who.handle, model, speaker, chars: text.length, usd: Math.round(text.length / 1000 * (model === 'aura-2' ? 0.03 : 0.015) * 1e5) / 1e5, cached: false, ms_first: Date.now() - t0, left: budget.left });
  return new Response(a, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'private, max-age=86400', 'x-talk-tts': 'fresh' } });
}

// HTTP wrappers over the cores (the voice agent, src/talkvoice.ts, calls the cores directly).
const wrap = (r: { ok: boolean; http?: number }) => json(r, r.ok ? 200 : (r as any).http || 500);
const decide = async (request: Request, env: Env, who: Who & {}) => wrap(await decideCore(env, who, await request.json().catch(() => null)));
const chat = async (request: Request, env: Env, who: Who & {}) => wrap(await chatCore(env, who, await request.json().catch(() => null)));
const status = async (request: Request, env: Env, who: Who & {}) => wrap(await statusCore(env, who, await request.json().catch(() => ({}))));

export async function talkRoute(request: Request, env: Env, _ctx: ExecutionContext, url: URL, who: Who): Promise<Response | null> {
  if (url.pathname.startsWith('/agents/talk-voice/')) {
    // The conversation agent is one per person, named by their handle; nobody else's.
    if (!who) return json({ error: 'signin', why: 'Sign in to talk to qodebase.' }, 401);
    if (!env.AI || !env.TalkVoice) return json({ error: 'off', why: 'Talk is not set up on this copy.' }, 404);
    const name = decodeURIComponent(url.pathname.split('/')[3] || '');
    if (name !== who.handle) return json({ error: 'forbidden' }, 403);
    return (await routeAgentRequest(request, env as any)) || json({ error: 'not found' }, 404);
  }
  if (url.pathname === '/talk-voice.js') return new Response(TALK_VOICE_JS, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' } });
  if (url.pathname === '/talk.js') {
    // Revalidate on every page load (304 when unchanged), so a deploy's new page tools reach the next load, not 5 min later.
    const etag = await talkEtag();
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag, 'cache-control': 'no-cache' } });
    return new Response(TALK_JS, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache', etag } });
  }
  if (!url.pathname.startsWith('/api/talk/')) return null;
  if (!env.AI) return json({ error: 'off', why: 'Talk is not set up on this copy (no AI binding).' }, 404);
  if (url.pathname === '/api/talk/me') {
    if (!who) return json({ signedIn: false });
    const owner = isOwner(env, who.handle);
    // The owner sees which deploy a page came from (so a screenshot says its version).
    const v = owner ? { sha: (env as any).CF_VERSION_METADATA?.tag || null, built: (env as any).CF_VERSION_METADATA?.timestamp || null } : undefined;
    return json({ signedIn: true, handle: who.handle, used: await talkLog(env).counts(who.handle), caps: CAPS, trace: owner, version: v });
  }
  if (url.pathname === '/api/talk/trace') {
    // The owner's own experience, step by step (Eyal, 2026-10-07: "log and instrument every part of the app
    // experience … so you really have a sense of what I'm going through"). Nobody else's is collected.
    if (!who || !isOwner(env, who.handle)) return json({ error: 'forbidden' }, 403);
    const day = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('day') || '') ? url.searchParams.get('day')! : new Date().toISOString().slice(0, 10);
    const stub = env.TalkLog.get(env.TalkLog.idFromName(day));
    if (request.method === 'GET') return json({ day, rows: await stub.readTrace(who.handle, Number(url.searchParams.get('since')) || 0, Math.min(5000, Number(url.searchParams.get('limit')) || 2000)) });
    const b = await request.json().catch(() => null) as any;
    const sid = String(b?.sid || '').slice(0, 40);
    const rows = (Array.isArray(b?.events) ? b.events : []).slice(0, 200).map((e: any) => {
      const { ts, ev, ...rest } = e || {};
      return { ts: Number(ts) || Date.now(), ev: String(ev || '').slice(0, 40), data: JSON.stringify(rest).slice(0, 2000) };
    }).filter((r: any) => r.ev);
    return json(rows.length ? await env.TalkLog.get(env.TalkLog.idFromName(new Date().toISOString().slice(0, 10))).addTrace(who.handle, sid, rows) : { ok: true, n: 0 });
  }
  if (!who) return json({ error: 'signin', why: 'Sign in to talk to qodebase.' }, 401);
  if (url.pathname === '/api/talk/tts' && request.method === 'GET') return tts(request, env, _ctx, who, url);
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  if (url.pathname === '/api/talk/decide') return decide(request, env, who);
  if (url.pathname === '/api/talk/chat') return chat(request, env, who);
  if (url.pathname === '/api/talk/transcribe') return transcribe(request, env, who, url);
  if (url.pathname === '/api/talk/status') return status(request, env, who);
  if (url.pathname === '/api/talk/log') {
    // One row per page-tool call (window.__webmcp / WebMCP, src/talkclient.ts). No model, no budget.
    const b = await request.json().catch(() => null) as any;
    log('webmcp', { level: 'info', handle: who.handle, tool: String(b?.tool || '').slice(0, 40), args: JSON.stringify(b?.args ?? {}).slice(0, 300), ms: Number(b?.ms) || 0, ok: !!b?.ok, path: String(b?.path || '').slice(0, 200), text_len: Number(b?.text_len) || 0 });
    return json({ ok: true });
  }
  return json({ error: 'not found' }, 404);
}
