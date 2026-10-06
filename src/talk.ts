// Talk to qodebase: speak or type a sentence on any page, and the app does it
// (go somewhere, open a project or one of its parts, search, type, press,
// scroll), answers it, or both. Layer over every UI page (/talk.js, injected by
// withBaseline), so no page has to know about it.
//
//   POST /api/talk/decide      one sentence -> command (clef-flash, ~0.5 s, src/talkdecide.ts)
//   POST /api/talk/chat        questions and "both": glm-4.7-flash with the same actions as tools
//   POST /api/talk/transcribe  audio -> text (Whisper large v3 turbo), for the Whisper dictation setting
//   GET  /api/talk/me          signed in? today's budget left
//   GET  /talk.js              the layer (src/talkclient.ts)
//
// Cost: every model call goes through the AI Gateway in TALK_GATEWAY (rate
// limited) and counts against TalkLog's daily caps, per person and in total.
// Signed-in people only.
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';
import { listFor } from './registry';
import { buildQuestions, candidateProjects, currentSlug, resolve, stateText, type Item, type Proj, type Screen } from './talkdecide';
import { TALK_JS } from './talkclient';

const DECIDE_MODEL = '@cf/cloudflare/clef-flash';
const CHAT_MODEL = '@cf/zai-org/glm-4.7-flash';
const STT_MODEL = '@cf/openai/whisper-large-v3-turbo';
// Daily caps (UTC day). A person's own, and everyone's together.
const CAPS = { decide: { me: 600, all: 5000 }, chat: { me: 150, all: 1500 }, stt: { me: 300, all: 3000 } };
type Kind = keyof typeof CAPS;

const log = (event: string, data: Record<string, unknown> = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), module: 'talk', event, ...data }));
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const day = () => new Date().toISOString().slice(0, 10);

/** Daily counts per kind, per person and in total. One object per UTC day. */
export class TalkLog extends DurableObject<Env> {
  async take(kind: Kind, who: string): Promise<{ ok: boolean; left: number }> {
    const me = `${kind}:${who}`, all = `${kind}:*`;
    const [a, b] = [(await this.ctx.storage.get<number>(me)) || 0, (await this.ctx.storage.get<number>(all)) || 0];
    if (a >= CAPS[kind].me || b >= CAPS[kind].all) return { ok: false, left: 0 };
    await this.ctx.storage.put({ [me]: a + 1, [all]: b + 1 });
    return { ok: true, left: Math.min(CAPS[kind].me - a - 1, CAPS[kind].all - b - 1) };
  }
  async counts(who: string) {
    const out: Record<string, number> = {};
    for (const k of Object.keys(CAPS) as Kind[]) out[k] = (await this.ctx.storage.get<number>(`${k}:${who}`)) || 0;
    return out;
  }
}
const talkLog = (env: Env) => env.TalkLog.get(env.TalkLog.idFromName(day()));

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

type Who = { handle: string; admin: boolean } | null;

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
  return list.slice(0, 400).map((e: any, i: number) => ({ id: `p${i + 1}`, slug: e.slug, name: e.name, owner: e.owner, description: String(e.description || '').slice(0, 120), mine: !!who && e.owner === who.handle }));
}

async function decide(request: Request, env: Env, who: Who & {}) {
  const t0 = Date.now();
  const body = await request.json().catch(() => null) as any;
  const utterance = String(body?.utterance || '').trim().slice(0, 300);
  if (!utterance) return json({ error: 'empty' }, 400);
  const budget = await talkLog(env).take('decide', who.handle);
  if (!budget.ok) return json({ error: 'budget', why: 'Talk has reached today\'s limit. It resets at midnight UTC.' }, 429);
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
    return json({ error: 'model', why: 'The model did not answer. Try again.' }, 502);
  }
  const cmd = resolve(res.answers, cands, s, projects, utterance);
  log('decide', { level: 'info', handle: who.handle, path: s.path, interim: !!body.interim, model_ms: Date.now() - tm, total_ms: Date.now() - t0, fired, won,
    n_items: s.items.length, n_projects: projects.length, n_questions: Object.keys(questions).length, mode: cmd.mode, mode_p: cmd.modeP, op: cmd.op, p: cmd.p, risky: cmd.risky, why: cmd.why, usage: res.usage });
  return json({ cmd, ms: { model: Date.now() - tm, total: Date.now() - t0 }, left: budget.left, ...(body.debug ? { answers: res.answers, state } : {}) });
}

// ---- Chat lane: answers questions about the page, and can act with the same verbs.
const TOOLS = [
  { type: 'function', function: { name: 'go', description: 'Open a page: a link id from the page (like l12) or a path on this site (like /p/forq/timer/app).', parameters: { type: 'object', properties: { to: { type: 'string' } }, required: ['to'] } } },
  { type: 'function', function: { name: 'press', description: 'Press a button on the page by its id (like b3). Never for deleting, merging, publishing or signing out.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'type_into', description: 'Type text into a field on the page by its id (like f1).', parameters: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] } } },
  { type: 'function', function: { name: 'show', description: 'Point at parts of the page while you explain them: heading, link, button or field ids, in the order you talk about them.', parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] } } },
];

async function chat(request: Request, env: Env, who: Who & {}) {
  const t0 = Date.now();
  const body = await request.json().catch(() => null) as any;
  const utterance = String(body?.utterance || '').trim().slice(0, 500);
  if (!utterance) return json({ error: 'empty' }, 400);
  const budget = await talkLog(env).take('chat', who.handle);
  if (!budget.ok) return json({ error: 'budget', why: 'Talk has reached today\'s chat limit. It resets at midnight UTC.' }, 429);
  const s = cleanScreen(body.screen);
  const pageText = String(body.pageText || '').slice(0, 5000);
  const did = body.did ? String(body.did).slice(0, 200) : '';
  const items = s.items.map((i) => `${i.id} ${i.kind}: ${i.text}${i.href ? ' → ' + i.href : ''}`).join('\n');
  const system = [
    'You are the voice of qodebase, a git platform made for the phone: every project runs as a live app, every fork gets its own AI agents, and people can install AI assistants into their own Cloudflare account.',
    `You talk with ${who.handle}, who is on ${s.path} ("${s.title}"). Answer in plain words, short: two or three sentences unless they ask for more. Spoken aloud too, so no markdown, no lists, no code.`,
    'You can act with the tools: open pages, press buttons, type into fields, and point at parts of the page while you explain. Act when asked; explain what is on the page when asked; never press anything that deletes, merges, publishes or signs out.',
    'What is true about qodebase (say you do not know rather than guess anything else):',
    '- Every project is a git repo stored in Cloudflare Artifacts. Static projects run live at <name>--<owner>.ttyview.dev; projects with a Worker config are deployed as Cloudflare Workers.',
    '- Fork copies a project to your account. Ask (the router agent) splits a request into tasks; each task gets an agent (Claude Code in a Cloudflare container) on its own fork; a reviewer agent checks pushes; you merge from the phone.',
    '- Your own AI assistant (/personal-agents) installs an assistant into YOUR Cloudflare account with Sign in with Cloudflare: Cloudflare Agent fits the free plan; OpenClaw, Hermes, T3 Code, Mobile Agent and Pi need Workers Paid ($5 a month per account, not per assistant). Mobile Agent and T3 Code can use your own Claude subscription.',
    '- Get your own qodebase (/own) installs a whole copy of qodebase into your Cloudflare account. The qb command line (/cli) does everything from a terminal or an agent.',
    did ? `The app already did this for their last sentence: ${did}.` : '',
    '', 'What is on the page (id, kind, text):', items || '(nothing)', '', 'The page text:', pageText || '(none)',
  ].filter((x) => x !== '').join('\n');
  const history = (Array.isArray(body.history) ? body.history : []).slice(-8).map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 800) }));
  const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content: utterance }];
  const tm = Date.now();
  const run = (msgs: unknown[]) => (env.AI as any).run(CHAT_MODEL, { messages: msgs, tools: TOOLS, max_tokens: 700, temperature: 0.3, chat_template_kwargs: { enable_thinking: false } }, aiOpts(env));
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
  } catch (e) {
    log('chat_error', { level: 'error', err: String(e), stack: (e as Error)?.stack, handle: who.handle });
    return json({ error: 'model', why: 'The model did not answer. Try again.' }, 502);
  }
  const { calls, reply } = out;
  log('chat', { level: 'info', handle: who.handle, path: s.path, rounds, model_ms: Date.now() - tm, total_ms: Date.now() - t0, tools: calls.map((c: any) => c.name), reply_len: reply.length, usage: res?.usage, usage2: res?.usage2 });
  return json({ reply, actions: calls.map((c: any) => ({ name: c.name, args: c.args })), ms: { model: Date.now() - tm }, left: budget.left });
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

export async function talkRoute(request: Request, env: Env, _ctx: ExecutionContext, url: URL, who: Who): Promise<Response | null> {
  if (url.pathname === '/talk.js') return new Response(TALK_JS, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=300' } });
  if (!url.pathname.startsWith('/api/talk/')) return null;
  if (!env.AI) return json({ error: 'off', why: 'Talk is not set up on this copy (no AI binding).' }, 404);
  if (url.pathname === '/api/talk/me') {
    if (!who) return json({ signedIn: false });
    return json({ signedIn: true, handle: who.handle, used: await talkLog(env).counts(who.handle), caps: CAPS });
  }
  if (!who) return json({ error: 'signin', why: 'Sign in to talk to qodebase.' }, 401);
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  if (url.pathname === '/api/talk/decide') return decide(request, env, who);
  if (url.pathname === '/api/talk/chat') return chat(request, env, who);
  if (url.pathname === '/api/talk/transcribe') return transcribe(request, env, who, url);
  return json({ error: 'not found' }, 404);
}
