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
import { buildQuestions, candidateProjects, currentSlug, isScaffold, quickCmd, resolve, stateText, type Item, type Proj, type Screen } from './talkdecide';
import { TALK_JS } from './talkclient';
import { talkAdmin } from './talkadmin';
import { recordCost } from './costs';
import { MERGE_MODEL, mergeMessages, cleanMerge } from './talkmerge';
import { convOp, convRoute, contextKnowledge } from './talkthreads';
import { chatSystem, TOOLS, CONTEXT_TOOLS, parseChat, ANSWER_MODELS, answerModel, DEFAULT_ANSWER, FALLBACK_ANSWER, PAID_FALLBACK, toGemini, fromGemini, toAnthropic, fromAnthropic, type AnswerModel } from './talkchat';
import { TALK_VOICE_JS } from './talkvoicejs.gen';
import { sttText, wordsOnly } from './talkstt';
import { routeAgentRequest } from 'agents';

const DECIDE_MODEL = '@cf/cloudflare/clef-flash';
const CHAT_MODEL = '@cf/zai-org/glm-4.7-flash';
const STT_MODEL = '@cf/openai/whisper-large-v3-turbo';
// Daily caps (UTC day). A person's own, and everyone's together.
// usd_milli: answering-model spend in thousandths of a dollar, $1 per person a day; usd_others: everyone but the owner
// together, $5 a day (Eyal, 2026-10-13: a burst of visitors must not drain the credits).
const CAPS = { usd_milli: { me: 1000, all: 50000 }, usd_others: { me: 5000, all: 5000 }, decide: { me: 600, all: 5000 }, chat: { me: 150, all: 1500 }, stt: { me: 1000, all: 3000 }, status: { me: 200, all: 2000 }, status_warm: { me: 3000, all: 20000 }, tts_chars: { me: 20000, all: 150000 }, voice_sec: { me: 3600, all: 36000 } };   // voice_sec: open conversation time (Flux bills it, silence too): 60 min/day each = $0.46   // tts in characters: 20k = $0.30 of Aura-1 a day each
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
    // A day's trace (and its counters) is deleted 15 days later (Eyal, 2026-10-13: keep 14 days).
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 15 * 86400_000);
    const n = (sql.exec('SELECT COUNT(*) AS n FROM trace WHERE handle = ?', handle).one() as any).n as number;
    if (n > 20000) return { ok: false, n };
    for (const r of rows) sql.exec('INSERT INTO trace (ts, handle, sid, ev, data) VALUES (?, ?, ?, ?, ?)', r.ts, handle, sid, r.ev, r.data);
    return { ok: true, n: n + rows.length };
  }
  async readTrace(handle: string, since: number, limit: number) {
    return this.#trace().exec('SELECT ts, sid, ev, data FROM trace WHERE handle = ? AND ts > ? ORDER BY ts LIMIT ?', handle, since, limit).toArray();
  }
  /** The admin's view: every traced person's rows (only the owner and people who said yes are ever traced). */
  async readAll(since: number, limit: number, handle = '') {
    const sql = this.#trace();
    return (handle ? sql.exec('SELECT ts, handle, sid, ev, data FROM trace WHERE handle = ? AND ts > ? ORDER BY ts LIMIT ?', handle, since, limit)
      : sql.exec('SELECT ts, handle, sid, ev, data FROM trace WHERE ts > ? ORDER BY ts LIMIT ?', since, limit)).toArray();
  }
  async alarm() { await this.ctx.storage.deleteAll(); }
  // Consent to be traced (people other than the owner; off unless they turn it on in Talk settings). Lives in the
  // 'consent' instance, which never traces, so the 15-day alarm never deletes it.
  async consent(handle: string, on?: boolean) {
    if (on !== undefined) { if (on) await this.ctx.storage.put(`consent:${handle}`, Date.now()); else await this.ctx.storage.delete(`consent:${handle}`); }
    return !!(await this.ctx.storage.get(`consent:${handle}`));
  }
  // Conversations (src/talkthreads.ts) live in the instance named conv:<handle>, which never traces or counts.
  async conv(op: string, a: any) { return convOp(this.ctx.storage.sql, op, a); }
  async counts(who: string) {
    const out: Record<string, number> = {};
    for (const k of Object.keys(CAPS) as Kind[]) out[k] = (await this.ctx.storage.get<number>(`${k}:${who}`)) || 0;
    return out;
  }
}
export const talkLog = (env: Env) => env.TalkLog.get(env.TalkLog.idFromName(day()));
const consentMemo = new Map<string, { at: number; on: boolean }>();
/** Traced: the owner always (Eyal, 2026-10-13: full traceability for his account); anyone else only after saying yes. */
export async function canTrace(env: Env, who: Who): Promise<boolean> {
  if (!who) return false;
  if (isOwner(env, who.handle)) return true;
  const m = consentMemo.get(who.handle);
  if (m && Date.now() - m.at < 60_000) return m.on;
  const on = await env.TalkLog.get(env.TalkLog.idFromName('consent')).consent(who.handle).catch(() => false);
  consentMemo.set(who.handle, { at: Date.now(), on });
  return on;
}
/** One server-side trace row for an utterance (u): what the model saw and chose, what the chat lane said. */
export async function strace(env: Env, who: Who & {}, sid: string, u: string, ev: string, data: Record<string, unknown>) {
  try { await talkLog(env).addTrace(who.handle, String(sid || '').slice(0, 40), [{ ts: Date.now(), ev, data: JSON.stringify({ u: String(u).slice(0, 24), ...data }).slice(0, 6000) }]); }
  catch (e) { log('strace_error', { level: 'error', err: String(e) }); }
}
/** The model's answers in short: each yes/no as a number, each choice as its top two with their probabilities. */
function topAnswers(answers: Record<string, any>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(answers || {})) {
    if (typeof v?.noul === 'number') { out[k] = Math.round(v.noul * 100) / 100; continue; }
    const ps = Object.entries((v?.probabilities || {}) as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 2);
    out[k] = ps.length ? ps.map(([c, p]) => `${c} ${Math.round(p * 100) / 100}`).join(', ') : v?.choice;
  }
  return out;
}

const aiOpts = (env: Env) => (env.TALK_GATEWAY ? { gateway: { id: env.TALK_GATEWAY } } : {});

// clef-flash latency is bimodal (talkui, 2026-10-02): most calls 0.3–0.9 s, about
// one in four 12–90 s upstream. Fire it again at each mark; the first answer wins.
const HEDGE_MS = [700, 1500];   // a second (and third) identical call if the first has not answered: p50 was 1.1 s (2026-10-13)
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
    id: String(i.id || '').slice(0, 24), kind: (['link', 'button', 'field', 'heading'].includes(i.kind) ? i.kind : 'link') as Item['kind'],
    text: String(i.text || '').slice(0, 140), href: i.href ? String(i.href).slice(0, 300) : undefined,
  })).filter((i: Item) => /^([lbfh]\d{1,4}|x[\w-]{1,23})$/.test(i.id) && i.text);   // x…: the page's own actions (window.__talkActions)
  return { path: String(b?.path || '/').slice(0, 200), title: String(b?.title || '').slice(0, 120), items, projects: [], last: b?.last ? String(b.last).slice(0, 120) : null };
}

export async function projectsFor(env: Env, who: Who): Promise<Proj[]> {
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
  const allProjects = await projectsFor(env, who);
  const projects = candidateProjects(utterance, allProjects, 24, currentSlug(s.path));
  (s as any).projects = allProjects.filter((p) => p.mine);   // for "list my projects" (not shown to the model)
  // Fixed phrases answer at once, no model (latency work, 2026-10-13).
  const quick = body.interim ? null : quickCmd(utterance, s as any, allProjects);
  if (quick) {
    log('decide', { level: 'info', handle: who.handle, path: s.path, quick: true, total_ms: Date.now() - t0, mode: quick.mode, op: quick.op, why: quick.why });
    return { ok: true as const, cmd: quick, ms: { model: 0, total: Date.now() - t0 }, left: budget.left, trace: { utterance, path: s.path, quick: true, cmd: quick, ms: Date.now() - t0 } };
  }
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
  return { ok: true as const, cmd, ms: { model: Date.now() - tm, total: Date.now() - t0 }, left: budget.left, ...(body.debug ? { answers: res.answers, state } : {}),
    trace: { utterance, path: s.path, items: s.items.length, projects: projects.length, fired, won, top: topAnswers(res.answers), cmd, ms: Date.now() - t0 } };
}

// ---- Chat lane: answers questions about the page, and can act with the same verbs (prompt, tools, parsing and the
// answering models: src/talkchat.ts, shared with scripts/talk-chat-bench.mjs).
export async function chatCore(env: Env, who: Who & {}, body: any) {
  const t0 = Date.now();
  const utterance = String(body?.utterance || '').trim().slice(0, 500);
  if (!utterance) return { ok: false as const, http: 400, error: 'empty' };
  const budget = await talkLog(env).take('chat', who.handle);
  if (!budget.ok) return { ok: false as const, http: 429, error: 'budget', why: 'Talk has reached today\'s chat limit. It resets at midnight UTC.' };
  const s = cleanScreen(body.screen);
  const pageText = String(body.pageText || '').slice(0, 5000);
  const did = body.did ? String(body.did).slice(0, 200) : '';
  // A conversation's project chips (Conversations, hidden setting): what each one is, and change requests to them.
  const ctxIn = Array.isArray(body?.context) ? body.context.map(String).slice(0, 6) : [];
  const know = ctxIn.length ? await contextKnowledge(env, who, ctxIn, listFor).catch((e) => { log('ctx_error', { level: 'error', err: String(e) }); return { text: '', slugs: [] as string[] }; }) : { text: '', slugs: [] as string[] };
  const system = chatSystem(who.handle, s, pageText, did, know.text);
  const tools = know.text ? [...TOOLS, ...CONTEXT_TOOLS] : TOOLS;
  const pick = await pickAnswer(env, who, String(body?.model || ''));
  const history = (Array.isArray(body.history) ? body.history : []).slice(-8).map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 800) }));
  const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content: utterance }];
  const tm = Date.now();
  // After a "both" sentence the app has already acted (did): answer only, no tools, or it acts again.
  // The chosen answering model (Talk setting; Gemini by default); any failure goes to GLM-4.7-flash for the rest of the turn.
  let used: AnswerModel = pick.m, fellBack: string | null = pick.why, spentMilli = 0;
  const run = async (msgs: unknown[], useTools = !did): Promise<any> => {
    try {
      const res = await callAnswer(env, used, msgs as any[], useTools ? tools : null);
      spentMilli += costMilli(used, res?.usage);
      return res;
    } catch (e) {
      if (used.id === FALLBACK_ANSWER) throw e;
      log('answer_fallback', { level: 'warn', from: used.id, err: String(e).slice(0, 300) });
      fellBack = `${used.label}: ${/insufficient balance|2021/i.test(String(e)) ? 'out of Cloudflare credits' : String((e as Error)?.message || e).slice(0, 120)}`;
      if (/insufficient balance|2021/i.test(String(e))) creditsMemo = { at: Date.now(), ok: false };
      // A paid model failed: Gemini next (if it can), else GLM.
      used = used.paid && (env as any).GEMINI_API_KEY ? answerModel(PAID_FALLBACK)! : answerModel(FALLBACK_ANSWER)!;
      try { const r2 = await callAnswer(env, used, msgs as any[], useTools ? tools : null); spentMilli += costMilli(used, r2?.usage); return r2; }
      catch (e2) { if (used.id === FALLBACK_ANSWER) throw e2; log('answer_fallback', { level: 'warn', from: used.id, err: String(e2).slice(0, 300) }); used = answerModel(FALLBACK_ANSWER)!; }
      const res = await callAnswer(env, used, msgs as any[], useTools ? tools : null);
      spentMilli += costMilli(used, res?.usage);
      return res;
    }
  };
  const parse = parseChat;
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
  if (spentMilli) {
    await talkLog(env).take('usd_milli', who.handle, Math.ceil(spentMilli)).catch(() => null);
    if (!(who.admin || isOwner(env, who.handle))) await talkLog(env).take('usd_others', 'others', Math.ceil(spentMilli)).catch(() => null);
  }
  return { ok: true as const, reply, actions: calls.map((c: any) => ({ name: c.name, args: c.args })), ms: { model: Date.now() - tm }, left: budget.left, model: used.model, modelLabel: used.label, fellBack,
    trace: { utterance, model: used.model, chosen: pick.m.id, ...(ctxIn.length ? { context: know.slugs } : {}), fellBack, usd: spentMilli / 1000, did: body?.did || '', tools: calls.map((c: any) => ({ name: c.name, args: c.args })), reply: String(reply || '').slice(0, 1500), ms: Date.now() - t0 } };
}

// ---- Answering models (src/talkchat.ts): how each is called, what it costs, who may pick it.
let creditsMemo: { at: number; ok: boolean } | null = null;
// Claude through unified billing needs an AUTHENTICATED gateway; qodebase-talk is not (turning that on would make every
// direct call to it, like Gemini's, carry a gateway token). So Claude goes through the account's default gateway,
// which is authenticated; Talk's own daily dollar cap (usd_milli) still bounds it (2026-10-13).
const UNIFIED = { gateway: { id: 'default' } };
/** Does the forq account have AI Gateway credits (Claude through unified billing)? One tiny call, memoised 10 min. */
async function hasCredits(env: Env): Promise<boolean> {
  if (creditsMemo && Date.now() - creditsMemo.at < 600_000) return creditsMemo.ok;
  try { await (env.AI as any).run('anthropic/claude-haiku-5.5', { messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }, UNIFIED); creditsMemo = { at: Date.now(), ok: true }; }
  catch (e) { creditsMemo = { at: Date.now(), ok: false }; log('credits_probe', { level: 'info', err: String(e).slice(0, 200) }); }
  return creditsMemo.ok;
}
// Everyone's default is Claude Haiku 5.5 (24/24 tools right, ~2 s, $0.10/$0.50 checked against the gateway's logged cost).
const defaultFor = (_env: Env, _who: Who & {}) => DEFAULT_ANSWER;
async function pickAnswer(env: Env, who: Who & {}, id: string): Promise<{ m: AnswerModel; why: string | null }> {
  const want = answerModel(id) || answerModel(defaultFor(env, who))!;
  if (want.ownerOnly && !(who.admin || isOwner(env, who.handle))) return { m: answerModel(DEFAULT_ANSWER)!, why: `${want.label} is for the owner` };
  if (want.via === 'gemini' && !(env as any).GEMINI_API_KEY) return { m: answerModel(FALLBACK_ANSWER)!, why: 'no Gemini key on this copy' };
  // Paid models: credits on the account, the person's $1 a day, and (for everyone but the owner) $5 a day together.
  // Out of any of them: Gemini, and the 'how this was answered' line says why.
  const gem = answerModel(PAID_FALLBACK)!;
  if (want.paid) {
    if (!(await hasCredits(env))) return { m: gem, why: `${want.label} needs Cloudflare credits` };
    const used = await talkLog(env).counts(who.handle).catch(() => ({} as any));
    if ((used.usd_milli || 0) >= CAPS.usd_milli.me) return { m: gem, why: 'your answering budget for today is used up' };
    if (!(who.admin || isOwner(env, who.handle))) {
      const all = await talkLog(env).take('usd_others', 'others', 0).catch(() => ({ ok: true }));
      if (!all.ok) return { m: gem, why: 'today\'s shared answering budget is used up' };
    }
  }
  return { m: want, why: null };
}
const costMilli = (m: AnswerModel, u: any) => !u ? 0 : ((u.prompt_tokens || u.input_tokens || 0) * m.usdIn + (u.completion_tokens || u.output_tokens || 0) * m.usdOut) / 1000;   // $/M tokens → thousandths of a dollar
async function callAnswer(env: Env, m: AnswerModel, messages: any[], tools: any[] | null): Promise<any> {
  if (m.via === 'gemini') {
    const gw = (env.AI as any).gateway(env.TALK_GATEWAY || 'qodebase-talk');
    const base = await gw.getUrl('google-ai-studio');
    const r = await fetch(`${base}/v1beta/models/${m.model}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': (env as any).GEMINI_API_KEY }, body: JSON.stringify(toGemini(messages, tools, 700)) });
    if (!r.ok) throw new Error(`gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return fromGemini(await r.json());
  }
  if (m.via === 'unified') return fromAnthropic(await (env.AI as any).run(m.model, toAnthropic(messages, tools, 700), UNIFIED));
  const input: any = { messages, ...(tools ? { tools } : {}), max_tokens: 700, temperature: 0.3, ...(m.thinkingOff ? { chat_template_kwargs: { enable_thinking: false } } : {}) };
  return (env.AI as any).run(m.model, input, aiOpts(env));
}
// The chat bench (admin only; scripts/talk-chat-bench.mjs sends the cases): each case through each answering model with
// the chat lane's own prompt and tools, first round only; returns the tool calls, the words and the time.
async function chatBench(request: Request, env: Env, who: Who) {
  if (!who || !(who.admin || isOwner(env, who.handle))) return json({ error: 'forbidden' }, 403);
  const b = await request.json().catch(() => ({})) as any;
  // A raw binding call, to see exactly what a provider says (b.probe = { model, input, opts }).
  if (b?.probe) {
    try { const r = await (env.AI as any).run(b.probe.model, b.probe.input, b.probe.opts); return json({ ok: true, r }); }
    catch (e: any) { return json({ ok: false, err: String(e?.message || e), name: e?.name, cause: String(e?.cause || ''), keys: Object.keys(e || {}) }); }
  }
  // Also any Workers AI model by its @cf/ id, to choose the "bigger Workers AI model" from candidates.
  const pickM = (id: string): AnswerModel | undefined => answerModel(id) || (/^@cf\/[\w.-]+\/[\w.-]+$/.test(id) ? { id, label: id, model: id, via: 'workers', usdIn: 0, usdOut: 0 } : undefined);
  const cases = (b?.cases || []).slice(0, 40), ids = (b?.models || []).filter((id: string) => pickM(id));
  const out: any[] = [];
  // Three at a time: the gateway allows 120 calls a minute and Talk's real traffic shares it.
  const jobs = cases.flatMap((c: any, i: number) => ids.map((id: string) => ({ c, i, id })));
  const worker = async () => { for (let j = jobs.shift(); j; j = jobs.shift()) await one(j.c, j.i, j.id); };
  const one = async (c: any, i: number, id: string) => {
    const m = pickM(id)!, t0 = Date.now();
    const s = cleanScreen(c.screen);
    const messages = [{ role: 'system', content: chatSystem(who.handle, s, String(c.pageText || ''), '') }, { role: 'user', content: String(c.utterance || '') }];
    try {
      const res = await callAnswer(env, m, messages, TOOLS);
      const p = parseChat(res);
      out.push({ i, model: id, ms: Date.now() - t0, tools: p.calls.map((x: any) => ({ name: x.name, args: x.args })), reply: p.reply.slice(0, 300), usage: res?.usage || null });
    } catch (e) { out.push({ i, model: id, ms: Date.now() - t0, error: String((e as Error)?.message || e).slice(0, 200) }); }
  };
  await Promise.all([worker(), worker(), worker()]);
  return json({ results: out });
}

/** For Talk settings: every answering model, and whether this person can use it now. */
export async function answerChoices(env: Env, who: Who & {}) {
  const owner = who.admin || isOwner(env, who.handle);
  const credits = owner ? await hasCredits(env) : false;
  return ANSWER_MODELS.filter((m) => !m.ownerOnly || owner).map((m) => ({ id: m.id, label: m.label, model: m.model,
    ok: m.via === 'gemini' ? !!(env as any).GEMINI_API_KEY : m.paid ? credits : true,
    why: m.via === 'gemini' && !(env as any).GEMINI_API_KEY ? 'no Gemini key' : m.paid && !credits ? 'needs Cloudflare credits' : null,
    price: `$${m.usdIn} / $${m.usdOut} per M tokens` }));
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
  // The person's project names as Whisper's prompt, so "reveal js" or "pomodoro streak" come out spelled
  // their way (tmux-web does the same with its vocabulary). On a silent clip Whisper can echo the prompt: dropped.
  let prompt = '';
  if (url.searchParams.get('names') === '1') {
    const names = (await projectsFor(env, who).catch(() => [] as Proj[])).filter((p) => p.mine && !isScaffold(p.name)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map((p) => p.name.replace(/[-_]+/g, ' '));
    if (names.length) prompt = 'qodebase. My projects: ' + [...new Set(names)].slice(0, 40).join(', ') + '.';
  }
  try {
    const res: any = await (env.AI as any).run(STT_MODEL, { audio: btoa(b64), ...(lang === 'en' || lang === 'he' ? { language: lang } : {}), vad_filter: true, ...(prompt ? { initial_prompt: prompt } : {}) }, aiOpts(env));
    const got = await sttText(res);   // the binding sometimes hands back a raw Response (src/talkstt.ts)
    if (got.shape !== 'object') log('stt_shape', { level: 'warn', handle: who.handle, shape: got.shape, chars: got.text.length });
    let text = got.text;
    if (prompt && text && (prompt.includes(text) || /^qodebase\. my projects:/i.test(text))) { log('stt_prompt_echo', { level: 'warn', handle: who.handle, text: text.slice(0, 200) }); text = ''; }
    log('stt', { level: 'info', handle: who.handle, bytes: buf.byteLength, lang, ms: Date.now() - t0, chars: text.length, detected: res?.transcription_info?.language });
    return json({ text, ms: Date.now() - t0 });
  } catch (e) {
    log('stt_error', { level: 'error', err: String(e), stack: (e as Error)?.stack, bytes: buf.byteLength, type: request.headers.get('content-type') });
    return json({ error: 'stt', why: 'Could not hear that. Try again, or use the phone\'s own dictation in Talk settings.' }, 502);
  }
}

// Live words + Whisper → one text (Talk setting "Clean up the words", off by default: on Eyal's 14 dictations the merge
// agreed less with tmux-web's final than Whisper alone, 8.0% vs 6.5% WER, and took 1-16 s; bench: scripts/talk-stt-bench.mjs).
async function merge(request: Request, env: Env, who: Who & {}) {
  const t0 = Date.now();
  const b = await request.json().catch(() => ({})) as any;
  const live = wordsOnly(String(b?.live || '').slice(0, 2000)), whisper = wordsOnly(String(b?.whisper || '').slice(0, 2000)), lang = String(b?.lang || 'en');
  if (!whisper && !live) return json({ text: '' });
  const budget = await talkLog(env).take('stt', who.handle);
  if (!budget.ok) return json({ text: whisper, why: 'budget' });
  const names = (await projectsFor(env, who).catch(() => [] as any[])).filter((p: any) => p.mine && !isScaffold(p.name)).map((p: any) => String(p.name).replace(/[-_]+/g, ' ')).slice(0, 40);
  try {
    const res: any = await (env.AI as any).run(MERGE_MODEL, { messages: mergeMessages(live, whisper, names, lang), max_tokens: 400, temperature: 0, chat_template_kwargs: { enable_thinking: false } }, aiOpts(env));
    const raw = res?.choices?.[0]?.message?.content ?? res?.response ?? '';
    const t = cleanMerge(raw, live, whisper);
    log('merge', { level: 'info', handle: who.handle, ms: Date.now() - t0, used: t != null, live_chars: live.length, whisper_chars: whisper.length });
    return json({ text: t ?? whisper, merged: t != null, ms: Date.now() - t0 });
  } catch (e) {
    log('merge_error', { level: 'error', err: String(e), ms: Date.now() - t0 });
    return json({ text: whisper, merged: false, error: 'model' });
  }
}

// What is said aloud (Talk setting "Spoken replies: Short summary", the default since 2026-10-13, after tmux-web's
// spoken summary): 1-3 conversational sentences about the answer on screen, by the chat model with thinking off.
async function summary(request: Request, env: Env, who: Who & {}) {
  const t0 = Date.now();
  const b = await request.json().catch(() => ({})) as any;
  const text = String(b?.text || '').slice(0, 4000), question = String(b?.question || '').slice(0, 500);
  if (!text) return json({ spoken: '' });
  const budget = await talkLog(env).take('chat', who.handle);
  if (!budget.ok) return json({ spoken: '', why: 'budget' });
  const messages = [
    { role: 'system', content: 'You turn an answer that is on the person\'s screen into what a helpful assistant says out loud: 1 to 3 short, natural sentences with the one or two things that matter most. No lists, no links, no markdown, no ids, round numbers. If there is more detail on screen, you may end with a short offer such as "Want the details?". Same language as the answer.' },
    { role: 'user', content: `${question ? `They asked: ${question}\n` : ''}The answer on screen:\n${text}` },
  ];
  try {
    const res: any = await (env.AI as any).run(CHAT_MODEL, { messages, max_tokens: 160, temperature: 0.3, chat_template_kwargs: { enable_thinking: false } }, aiOpts(env));
    const spoken = String(res?.choices?.[0]?.message?.content ?? res?.response ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim().slice(0, 600);
    log('summary', { level: 'info', handle: who.handle, ms: Date.now() - t0, chars_in: text.length, chars_out: spoken.length });
    return json({ spoken, model: CHAT_MODEL, ms: Date.now() - t0 });
  } catch (e) {
    log('summary_error', { level: 'error', err: String(e) });
    return json({ spoken: '', error: 'model' });
  }
}

/** Which model does what, from the code that runs (Talk settings → Models). */
export function talkModels(env: Env) {
  return {
    live: { model: '@cf/deepgram/nova-3', provider: 'Workers AI', note: 'live words; Hebrew: the phone\'s own recogniser' },
    final: { model: STT_MODEL, provider: 'Workers AI', note: 'reads the whole recording' },
    cleanup: { model: MERGE_MODEL, provider: 'Workers AI', note: 'only when "Clean up the words" is on' },
    decide: { model: DECIDE_MODEL, provider: 'Workers AI', note: 'picks what to do' },
    chat: { model: 'the model chosen under "Answering model"', provider: 'AI Gateway', note: 'answers questions about the page; GLM-4.7-flash if it fails' },
    status: { model: null, provider: 'qodebase', note: '"what\'s going on": read from your projects, no model' },
    code: { model: 'Claude (opus, sonnet or haiku by depth)', provider: 'your Claude plan', note: 'questions about a project\'s code' },
    summary: { model: CHAT_MODEL, provider: 'Workers AI', note: 'what is said aloud' },
    voice: { model: Object.values(VOICES).map((v) => v.id).join(' or '), provider: 'Workers AI', note: 'or the phone\'s own voice' },
    gateway: env.TALK_GATEWAY || null,
  };
}

// ---- Live words for dictation (manager, 2026-10-13: tmux-web's way instead of the agents voice kit): the page's own
// recorder (WebM/Opus chunks, the ones it keeps for Whisper) comes in over a WebSocket and goes straight to Workers AI
// nova-3 (no gateway: through it the first words came ~7 s late); its words go back as {type: interim|final, text}.
// No turns, no replies: the page decides when the person is done. Text 'close' = the recording ended.
const NOVA3_USD_PER_MIN = 0.0092;
async function sttLive(request: Request, env: Env, ctx: ExecutionContext, who: Who & {}, url: URL) {
  if ((request.headers.get('upgrade') || '').toLowerCase() !== 'websocket') return json({ error: 'websocket' }, 426);
  const pair = new WebSocketPair(); const [client, server] = Object.values(pair); server.accept();
  // Counted when the first audio arrives, not on connect: conversation mode opens the next turn's socket early, and
  // an unused one must not use up the day (300 went in one evening of benches, 2026-10-13).
  let charged: Promise<boolean> | null = null;
  const charge = () => (charged ||= talkLog(env).take('stt', who.handle).then((b) => {
    if (!b.ok) { try { server.send(JSON.stringify({ type: 'error', error: 'budget' })); server.close(1008, 'budget'); } catch { /* gone */ } }
    return b.ok;
  }).catch(() => true));
  const t0 = Date.now(), lang = url.searchParams.get('lang') || 'en';
  const names = (await projectsFor(env, who).catch(() => [] as Proj[])).filter((p) => p.mine && !isScaffold(p.name)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map((p) => p.name.replace(/[-_]+/g, ' '));
  const keyterm = [...new Set(['qodebase', 'Talk', 'fork', 'merge', 'router', 'idea', ...names])].slice(0, 40);   // 'idea': nova-3 heard 'a small ID' (2026-10-13)   // ≤ 40: 65 made the socket refuse (2026-10-13)
  let up: WebSocket | null = null, bytes = 0, chunks = 0, words = 0, closed = false;
  const pending: (ArrayBuffer | string)[] = [];
  const finish = (why: string) => {
    if (closed) return; closed = true;
    const sec = (Date.now() - t0) / 1000;
    log('stt_live', { level: 'info', handle: who.handle, why, sec: Math.round(sec), bytes, chunks, words, keyterms: keyterm.length });
    ctx.waitUntil(recordCost(env, who.handle, 'voice', '', { usd: (sec / 60) * NOVA3_USD_PER_MIN, covered: false, seconds: Math.round(sec), billing: 'api' }));
    try { up?.close(1000, why); } catch { /* gone */ }
    try { server.close(1000, why); } catch { /* gone */ }
  };
  // Binary frames arrive as an ArrayBuffer, a view or a Blob depending on the path: bytes in order either way
  // (2026-10-13: the first version forwarded something nova-3 could not read, and heard nothing).
  let chain: Promise<void> = Promise.resolve();
  const toBytes = async (d: any): Promise<ArrayBuffer | null> => d instanceof ArrayBuffer ? d : ArrayBuffer.isView(d) ? (d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer) : d && typeof d.arrayBuffer === 'function' ? await d.arrayBuffer() : null;
  server.addEventListener('message', (e: MessageEvent) => {
    if (typeof e.data === 'string') { chain = chain.then(() => { if (e.data === 'close') { const m = JSON.stringify({ type: 'CloseStream' }); if (up) up.send(m); else pending.push(m); } }); return; }
    chain = chain.then(async () => {
      if (!(await charge())) return;
      const b = await toBytes(e.data);
      if (!b) { log('stt_live_frame', { level: 'warn', kind: Object.prototype.toString.call(e.data) }); return; }
      bytes += b.byteLength; chunks++;
      if (up) up.send(b); else pending.push(b);
    });
  });
  server.addEventListener('close', () => { if (up) { try { up.send(JSON.stringify({ type: 'CloseStream' })); } catch { /* gone */ } } setTimeout(() => finish('client closed'), 1500); });
  ctx.waitUntil((async () => {
    try {
      const res: any = await (env.AI as any).run('@cf/deepgram/nova-3', { language: lang === 'en' ? 'en' : 'multi', interim_results: 'true', smart_format: 'true', punctuate: 'true', endpointing: '300', keyterm }, { websocket: true });
      up = res?.webSocket;
      if (!up) { log('stt_live_error', { level: 'error', err: 'no socket', status: res?.status }); server.send(JSON.stringify({ type: 'error', error: 'no socket' })); return finish('no socket'); }
      up.accept();
      for (const m of pending.splice(0)) up.send(m as any);   // what the page sent while nova-3 was connecting, in order
      const keep = setInterval(() => { try { up?.send(JSON.stringify({ type: 'KeepAlive' })); } catch { /* gone */ } }, 5000);
      up.addEventListener('message', (e: MessageEvent) => {
        let d: any = null; try { d = JSON.parse(String(e.data)); } catch { return; }
        if (d?.type !== 'Results') return;
        const text = d.channel?.alternatives?.[0]?.transcript || '';
        if (text) words++;
        // speech_final = nova-3's endpointing heard the speaker stop (300 ms): the page ends a conversation turn on it.
        try { server.send(JSON.stringify({ type: d.is_final ? 'final' : 'interim', text, start: d.start, duration: d.duration, end: !!d.speech_final })); } catch { /* page gone */ }
      });
      up.addEventListener('close', (e: CloseEvent) => { clearInterval(keep); try { server.send(JSON.stringify({ type: 'closed', code: e.code })); } catch { /* gone */ } finish(`nova-3 closed ${e.code}`); });
      // Never longer than 3 minutes (Talk's dictation cap); the page normally closes first.
      setTimeout(() => finish('3 min'), 180_000);
      await new Promise<void>((ok) => { const t = setInterval(() => { if (closed) { clearInterval(t); ok(); } }, 1000); });
    } catch (e) {
      log('stt_live_error', { level: 'error', err: String(e), stack: (e as Error)?.stack });
      try { server.send(JSON.stringify({ type: 'error', error: String(e).slice(0, 200) })); } catch { /* gone */ }
      finish('error');
    }
  })());
  return new Response(null, { status: 101, webSocket: client });
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
  // A background refresh (the page keeps a fresh answer ready while Talk is in use, latency work 2026-10-13) has its own cap.
  const budget = await talkLog(env).take(body?.warm ? 'status_warm' : 'status', who.handle);
  if (!budget.ok) return { ok: false as const, http: 429, error: 'budget', why: 'Talk has reached today\'s limit. It resets at midnight UTC.' };
  const today = /\btoday\b/i.test(String(body?.utterance || ''));
  const since = Date.now() - (today ? 24 : 7 * 24) * 3600_000;
  // Test projects a harness made (lab-, kata-, fleet-, selftest) are not news (Eyal, 2026-10-13).
  const own = (await listFor(env, who.handle, false)).filter((e: any) => e.owner === who.handle && !/^(lab|kata|fleet|selftest)-/.test(String(e.name || e.slug?.split('.')[1] || '')))
    .sort((a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 20);
  // The fleet's runs, fetched alongside (it was the slow part: 9 s for one answer, live 2026-10-13).
  const fleetP: Promise<any> = env.FLEET_KEY && isOwner(env, who.handle)
    ? (((env as any).FLEET ? (env as any).FLEET.fetch('https://qbfleet.internal/runs', { headers: { 'x-fleet-key': env.FLEET_KEY, 'user-agent': 'forq-internal/1' } }) : fetch('https://qbfleet.forqdev.workers.dev/runs', { headers: { 'x-fleet-key': env.FLEET_KEY, 'user-agent': 'forq-internal/1' } }))
      .then((r: Response) => r.json()).catch((e: unknown) => { log('fleet_error', { level: 'error', err: String(e) }); return null; }))
    : Promise.resolve(null);
  const infos = await Promise.all(own.map((e: any) => env.Project.get(env.Project.idFromName(e.slug)).info().catch(() => null)));
  type It = { t: string; href?: string; proj?: string; at?: number };
  const working: It[] = [], ready: It[] = [], blocked: It[] = [], waiting: It[] = [], stalled: It[] = [];
  // Every item says how old it is; work with no news for STALL_MS reads as stuck, not as in progress (Eyal, 2026-10-13:
  // a build at '0 of 1 changes, 1 in progress' for 10 h, whose agent had never got its task).
  const STALL_MS = 2 * 3600_000;
  const ago = (t: number) => { const m = Math.max(1, Math.round((Date.now() - t) / 60000)); return m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`; };
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
      const seen = a.noteAt || a.createdAt || 0;
      if (a.state === 'working' && seen && Date.now() - seen > STALL_MS) { stalled.push({ t: `${what}: no progress for ${ago(seen)}`, href: `${base}/changes`, proj: info.name }); note ||= 'stuck'; }
      else if (a.state === 'working') { working.push({ t: `${what}${seen ? `, started ${ago(seen)} ago` : ''}`, href: `${base}/changes` }); note ||= 'working'; }
      else if (a.state === 'pushed') { ready.push({ t: what + (a.review?.state === 'approved' ? ' (approved)' : a.review?.state === 'changes' ? ' (reviewer asked for changes)' : ''), href: `${base}/changes` }); note = 'ready to merge'; }
      else if (a.state === 'blocked') { blocked.push({ t: what, href: `${base}/changes` }); note ||= 'blocked'; }
      else if (a.state === 'merged' && (a.noteAt || a.createdAt) >= since) merged++;
    }
    if (info.lastRequest && info.lastRequest.state !== 'sent' && info.lastRequest.at >= since) { waiting.push({ t: `${info.name} (${info.lastRequest.state === 'failed' ? 'your request did not reach its agents' : 'delivering your request'})`, href: base }); note ||= info.lastRequest.state === 'failed' ? 'request failed' : 'delivering'; }
    if ((e.updatedAt || 0) >= since) changed++;
    if (note) links.push({ text: `${info.name}: ${note}`, href: `${base}/changes` });
  });
  // Builds (landing projects): running ones with how far they are, ones that finished today, and questions the
  // agents asked the person that nobody answered yet (X5 ask-person). Only projects touched in the last day, 8 at most.
  const builds: It[] = [], finished: It[] = [], asked: It[] = [];
  const recent = own.map((e: any, i: number) => ({ e, info: infos[i] as any })).filter((x) => x.info?.landing && (x.e.updatedAt || 0) >= Date.now() - 24 * 3600_000).slice(0, 8);
  if (env.Landing) await Promise.all(recent.map(async ({ info }) => {
    const L = env.Landing.get(env.Landing.idFromName(`${info.owner}.${info.name}`));
    const [ad, bi] = await Promise.all([L.asksData().catch(() => null) as Promise<any>, L.buildInfo().catch(() => null) as Promise<any>]);
    const base = `/p/${info.owner}/${info.name}`;
    const ch = (ad?.changes || []) as { state: string }[];
    const landed = ch.filter((c) => c.state === 'landed').length, open = ch.filter((c) => !['landed', 'bounced'].includes(c.state)).length;
    const started = bi?.estimate?.startedAt || 0, settled = bi?.progress?.settledAt || 0;
    const usd = (x: number | null | undefined) => x == null ? '' : x < 1 ? `${Math.round(x * 100)} cents` : `$${x.toFixed(2)}`;
    const moved = Math.max(started, ...((info.agents || []) as any[]).map((a) => a.noteAt || a.createdAt || 0));
    // Stopped by hand (every agent 'stopped', qb6's admin verb): not news, neither stuck nor in progress.
    const live = ((info.agents || []) as any[]).filter((a) => a.state !== 'stopped');
    if (started && !settled && (info.agents || []).length && !live.length) { /* stopped build */ }
    else if (started && !settled && Date.now() - moved > STALL_MS) {
      // Stuck: one line in 'Waiting for you' for the build, instead of its agents one by one.
      for (let k = stalled.length - 1; k >= 0; k--) if (stalled[k].proj === info.name) stalled.splice(k, 1);
      stalled.push({ t: `${info.name}: no progress for ${ago(moved)} (${landed} of ${ch.length || '?'} changes on main). Stop it?`, href: `${base}/work`, proj: info.name });
      links.push({ text: `${info.name}: stuck`, href: `${base}/work` });
    } else if (started && !settled && Date.now() - started < 24 * 3600_000) {
      builds.push({ t: `${info.name}, started ${ago(started)} ago (${landed} of ${ch.length || '?'} changes on main${open ? `, ${open} in progress` : ''}${bi?.progress?.spentUsd != null ? `, ${usd(bi.progress.spentUsd)} so far` : ''})`, href: `${base}/work` });
      links.push({ text: `${info.name}: in progress`, href: `${base}/work` });
    } else if (settled && settled >= since) {
      finished.push({ at: settled, t: `${info.name}, done ${ago(settled)} ago (${landed} change${landed === 1 ? '' : 's'}${bi?.progress?.actualUsd != null ? `, ${usd(bi.progress.actualUsd)}` : ''})`, href: base });
    }
    for (const n of (ad?.notes || []) as { kind: string; answered?: boolean; text: string }[]) {
      if (n.kind !== 'asked-person' || n.answered) continue;
      asked.push({ t: `${info.name} asks “${short(n.text)}”`, href: `${base}/asks` });
      if (!links.some((l) => l.href === `${base}/asks`)) links.unshift({ text: `${info.name}: answer`, href: `${base}/asks` });
    }
  }));
  // Fleet runs (the /runs page; the owner's): the ones running now. Needs FLEET_KEY on this Worker.
  const runs: It[] = [];
  if (env.FLEET_KEY && isOwner(env, who.handle)) {
    const fl: any = await fleetP;
    if (!fl?.runs) log('fleet_empty', { level: 'warn', keys: fl ? Object.keys(fl).slice(0, 5) : null });
    const live = ((fl?.runs || []) as any[]).filter((r) => !['done', 'stopped', 'ended'].includes(r.state));
    for (const r of live.slice(0, 3)) { const at = Number(r.startedAt || r.createdAt || r.at || 0); runs.push({ t: `${r.label || r.repo} (${r.state}${r.agents ? `, ${r.agents} agents` : ''}${at > 1e12 ? `, started ${ago(at)} ago` : ''})`, href: '/runs' }); }
    if (live.length) links.push({ text: `Runs: ${live.length} live`, href: '/runs' });
  }
  finished.sort((a, b) => (b.at || 0) - (a.at || 0));   // newest first
  const list = (ys: It[]) => { const xs = ys.map((y) => y.t); return xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, 2).join(', ')} and ${xs.length - 2} more`; };
  // For reading (Eyal, 2026-10-13: "no wall of text"): short sections, each line a link; the sentence form stays for
  // the voice and for clients that do not render sections.
  const sections = [
    { title: 'Waiting for you', items: [...asked, ...stalled, ...blocked, ...waiting] },
    { title: 'In progress', items: builds },
    { title: 'Experiments running', items: runs },
    { title: 'Agents at work', items: working },
    { title: 'Ready to merge', items: ready },
    { title: `Done ${today ? 'today' : 'this week'}`, items: finished },
  ].filter((x) => x.items.length).map((x) => ({ title: x.title, items: x.items.slice(0, 6).map((y) => ({ text: y.t, href: y.href })), more: Math.max(0, x.items.length - 6) }));
  const parts: string[] = [];
  if (asked.length) parts.push(`${asked.length === 1 ? 'One question is' : `${asked.length} questions are`} waiting for you: ${list(asked)}.`);
  if (stalled.length) parts.push(`${stalled.length === 1 ? 'One thing is' : `${stalled.length} things are`} stuck: ${list(stalled)}`.replace(/[.?]?$/, (m) => m || '.'));
  if (builds.length) parts.push(`In progress: ${list(builds)}.`);
  if (runs.length) parts.push(`Experiments running: ${list(runs)}.`);
  if (finished.length) parts.push(`Done ${today ? 'today' : 'this week'}: ${list(finished)}.`);
  if (working.length) parts.push(`${working.length === 1 ? 'One agent is' : `${working.length} agents are`} at work: ${list(working)}.`);
  if (ready.length) parts.push(`${ready.length === 1 ? 'One change is' : `${ready.length} changes are`} ready to merge: ${list(ready)}.`);
  if (blocked.length) parts.push(`Blocked and waiting for you: ${list(blocked)}.`);
  if (waiting.length) parts.push(`Also: ${list(waiting)}.`);
  if (!working.length && !ready.length && !blocked.length && !waiting.length && !asked.length && !builds.length && !runs.length && !stalled.length) parts.unshift(own.length ? 'Nothing is in progress: no agents working, no builds running and nothing waiting for you.' : 'You have no projects yet. Say what you want to build.');
  if (own.length) parts.push(`${today ? 'Today' : 'This week'} ${changed === 0 ? 'none of your projects changed' : changed === 1 ? 'one of your projects changed' : `${changed} of your projects changed`}${merged ? `, with ${merged} merged change${merged > 1 ? 's' : ''}` : ''}.`);
  log('status', { level: 'info', handle: who.handle, projects: own.length, working: working.length, ready: ready.length, blocked: blocked.length, waiting: waiting.length, builds: builds.length, stalled: stalled.length, finished: finished.length, asked: asked.length, runs: runs.length, fleet: !!env.FLEET_KEY, changed, merged, ms: Date.now() - t0 });
  // Never let the answer read as if the question started something: a framing line first, and for the folded bar a
  // count line ("Status: 1 build in progress, 1 experiment running"), never a heading fragment.
  const n = (k: number, one: string, many: string) => k ? `${k} ${k === 1 ? one : many}` : '';
  const brief = [n(asked.length + blocked.length + waiting.length, 'thing waiting for you', 'things waiting for you'), n(stalled.length, 'thing stuck', 'things stuck'), n(builds.length, 'build in progress', 'builds in progress'),
    n(runs.length, 'experiment running', 'experiments running'), n(working.length, 'agent at work', 'agents at work'), n(ready.length, 'change ready to merge', 'changes ready to merge')].filter(Boolean);
  const lead = 'Here\u2019s where things stand:';
  // What is said aloud: one short line from the counts, no summary model (it was 1.7 s of the turn).
  const say1 = (xs: string[]) => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
  const spoken = brief.length ? `Here\u2019s where things stand: ${say1(brief.map((x) => x.replace(/^1 /, 'one ')))}.${stalled.length === 1 ? ` ${stalled[0].proj || 'One build'} has made no progress, want to stop it?` : ''}` : parts[0] || '';
  if (sections.length) parts.unshift('Here\u2019s where things stand.');
  return { ok: true as const, text: parts.join(' '), lead: sections.length ? lead : '', spoken, brief: brief.length ? `Status: ${brief.join(', ')}` : 'Status: nothing in progress', sections, links: links.slice(0, 6), ms: Date.now() - t0, left: budget.left, trace: { text: parts.join(' ').slice(0, 1500), links: links.length, ms: Date.now() - t0 } };
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
    // Straight to Workers AI, not through the gateway: the gateway buffered the whole clip (first byte 2-2.8 s for one
    // sentence), Workers AI streams it (first byte ~0.35 s, measured 2026-10-13). Guarded by the tts_chars cap above.
    res = await (env.AI as any).run(v.id, { text, speaker, encoding: 'mp3' }, { returnRawResponse: true });
  } catch (e) {
    log('tts_error', { level: 'error', err: String(e), stack: (e as Error)?.stack, model, chars: text.length });
    return json({ error: 'tts', why: 'No voice right now.' }, 502);
  }
  if (!res.ok || !res.body) { log('tts_error', { level: 'error', status: res.status, body: (await res.text().catch(() => '')).slice(0, 200) }); return json({ error: 'tts' }, 502); }
  const [a, b] = res.body.tee();
  // When the first audio bytes reach this Worker (is the clip streamed or buffered upstream?), then the cache copy.
  const tRun = Date.now() - t0;
  ctx.waitUntil((async () => {
    const rd = b.getReader(), parts: Uint8Array[] = []; let first = -1;
    for (;;) { const x = await rd.read(); if (x.done) break; if (first < 0) first = Date.now() - t0; parts.push(x.value); }
    log('tts_stream', { level: 'info', model, chars: text.length, run_ms: tRun, first_chunk_ms: first, done_ms: Date.now() - t0, chunks: parts.length });
    await caches.default.put(key, new Response(new Blob(parts), { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=604800' } }));
  })().catch(() => {}));
  log('tts', { level: 'info', handle: who.handle, model, speaker, chars: text.length, usd: Math.round(text.length / 1000 * (model === 'aura-2' ? 0.03 : 0.015) * 1e5) / 1e5, cached: false, ms_first: Date.now() - t0, left: budget.left });
  return new Response(a, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'private, max-age=86400', 'x-talk-tts': 'fresh' } });
}

// HTTP wrappers over the cores (the voice agent, src/talkvoice.ts, calls the cores directly).
const wrap = (r: { ok: boolean; http?: number }) => json(r, r.ok ? 200 : (r as any).http || 500);
// Each lane's call, and (for people who are traced) one server row tied to the utterance id the page sends.
const traced = async (kind: string, request: Request, env: Env, who: Who & {}, core: (env: Env, who: Who & {}, body: any) => Promise<any>, ctx?: ExecutionContext) => {
  const body: any = await request.json().catch(() => ({}));
  const r: any = await core(env, who, body);
  const t = r.trace; delete r.trace;
  if (body?.uid && await canTrace(env, who)) {
    const p = strace(env, who, body.sid, body.uid, `srv_${kind}`, { ...(t || {}), ok: r.ok, error: r.error, why: r.ok ? undefined : r.why });
    if (ctx) ctx.waitUntil(p); else await p;
  }
  return wrap(r);
};
const decide = (request: Request, env: Env, who: Who & {}, ctx?: ExecutionContext) => traced('decide', request, env, who, decideCore, ctx);
const chat = (request: Request, env: Env, who: Who & {}, ctx?: ExecutionContext) => traced('chat', request, env, who, chatCore, ctx);
const status = (request: Request, env: Env, who: Who & {}, ctx?: ExecutionContext) => traced('status', request, env, who, statusCore, ctx);

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
    // forq passes its own version when Talk runs as its own Worker (x-talk-site); the label shows the site, then Talk's.
    let site: any = null; try { site = JSON.parse(request.headers.get('x-talk-site') || 'null'); } catch { /* none */ }
    const own = { sha: (env as any).CF_VERSION_METADATA?.tag || null, built: (env as any).CF_VERSION_METADATA?.timestamp || null };
    const v = owner ? (site?.sha ? { sha: site.sha, built: site.built, talk: own.sha } : own) : undefined;
    const traced = await canTrace(env, who);
    return json({ signedIn: true, handle: who.handle, used: await talkLog(env).counts(who.handle), caps: CAPS, trace: traced, consent: owner ? null : traced, clips: owner && !!env.CLIPS, version: v, models: talkModels(env), answer: { default: defaultFor(env, who), choices: await answerChoices(env, who) } });
  }
  if (url.pathname === '/api/talk/consent' && request.method === 'POST') {
    // "Help improve Talk" (Talk settings, off by default): keep what I say and what Talk did for 14 days.
    if (!who) return json({ error: 'signin' }, 401);
    const b = await request.json().catch(() => ({})) as any;
    const on = await env.TalkLog.get(env.TalkLog.idFromName('consent')).consent(who.handle, !!b?.on);
    consentMemo.delete(who.handle);
    log('consent', { level: 'info', handle: who.handle, on });
    return json({ ok: true, on });
  }
  if (url.pathname === '/api/talk/admin/chatbench' && request.method === 'POST') return chatBench(request, env, who);
  if (url.pathname.startsWith('/api/talk/admin')) return talkAdmin(request, env, url, who);
  if (url.pathname === '/api/talk/trace') {
    // The owner's own experience, step by step (Eyal, 2026-10-07: "log and instrument every part of the app
    // experience … so you really have a sense of what I'm going through"); since 2026-10-13 also anyone who said
    // yes in Talk settings ("Help improve Talk"). Reading it back stays the owner's (and the admin view's).
    if (!who || !(await canTrace(env, who))) return json({ error: 'forbidden' }, 403);
    if (request.method === 'GET' && !isOwner(env, who.handle)) return json({ error: 'forbidden' }, 403);
    const day = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('day') || '') ? url.searchParams.get('day')! : new Date().toISOString().slice(0, 10);
    const stub = env.TalkLog.get(env.TalkLog.idFromName(day));
    if (request.method === 'GET') return json({ day, rows: await stub.readTrace(who.handle, Number(url.searchParams.get('since')) || 0, Math.min(5000, Number(url.searchParams.get('limit')) || 2000)) });
    const b = await request.json().catch(() => null) as any;
    const sid = String(b?.sid || '').slice(0, 40);
    const rows = (Array.isArray(b?.events) ? b.events : []).slice(0, 200).map((e: any) => {
      const { ts, ev, ...rest } = e || {};
      return { ts: Number(ts) || Date.now(), ev: String(ev || '').slice(0, 40), data: JSON.stringify(rest).slice(0, 4000) };
    }).filter((r: any) => r.ev);
    return json(rows.length ? await env.TalkLog.get(env.TalkLog.idFromName(new Date().toISOString().slice(0, 10))).addTrace(who.handle, sid, rows) : { ok: true, n: 0 });
  }
  if (url.pathname === '/api/talk/clip') {
    // The owner's own recordings, kept for debugging only when they turn it on in Talk settings (Eyal, 2026-10-07:
    // "only for me, only as me as the owner. This shouldn't be the default"); on by default for the owner since 2026-10-13
    // (full traceability, kept 14 days: the bucket's lifecycle rule). Nobody else's audio is ever kept.
    if (!who || !isOwner(env, who.handle) || !env.CLIPS) return json({ error: 'forbidden' }, 403);
    if (request.method === 'POST') {
      const buf = await request.arrayBuffer();
      if (buf.byteLength < 800 || buf.byteLength > 8_000_000) return json({ error: 'size' }, 413);
      const type = (request.headers.get('content-type') || 'audio/webm').split(';')[0];
      const ext = /mp4/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm';
      const q = (k: string, n = 500) => String(url.searchParams.get(k) || '').slice(0, n);
      const u = q('u', 24).replace(/[^\w-]/g, '');
      const key = `${new Date().toISOString().slice(0, 10)}/${Date.now()}-${q('sid', 40).replace(/[^\w-]/g, '') || 'x'}${u ? '-' + u : ''}.${ext}`;
      await env.CLIPS.put(key, buf, { httpMetadata: { contentType: type }, customMetadata: { handle: who.handle, path: q('path', 200), live: q('live'), final: q('final'), how: q('how', 20), u } });
      log('clip_saved', { level: 'info', handle: who.handle, key, bytes: buf.byteLength });
      return json({ key });
    }
    const key = url.searchParams.get('key');
    if (key) {
      const o = await env.CLIPS.get(key);
      if (!o) return json({ error: 'gone', why: 'Not found (recordings are deleted after 14 days).' }, 404);
      return new Response(o.body, { headers: { 'content-type': o.httpMetadata?.contentType || 'audio/webm', 'cache-control': 'private, no-store', 'x-talk-meta': JSON.stringify(o.customMetadata || {}) } });
    }
    const day = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('day') || '') ? url.searchParams.get('day')! : new Date().toISOString().slice(0, 10);
    const list = await env.CLIPS.list({ prefix: day + '/', limit: 500, include: ['customMetadata'] } as any);
    return json({ day, clips: list.objects.map((o: any) => ({ key: o.key, bytes: o.size, at: o.uploaded, ...(o.customMetadata || {}) })) });
  }
  if (!who) return json({ error: 'signin', why: 'Sign in to talk to qodebase.' }, 401);
  // Conversations (src/talkthreads.ts): kept here for the owner and people who said yes to "Help improve Talk".
  if (url.pathname === '/api/talk/conv' || url.pathname.startsWith('/api/talk/conv/')) return convRoute(request, env, url, who, await canTrace(env, who), (k, h) => talkLog(env).take(k, h));
  if (url.pathname === '/api/talk/stt-live') return sttLive(request, env, _ctx, who, url);
  if (url.pathname === '/api/talk/tts' && request.method === 'GET') return tts(request, env, _ctx, who, url);
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  if (url.pathname === '/api/talk/decide') return decide(request, env, who, _ctx);
  if (url.pathname === '/api/talk/chat') return chat(request, env, who, _ctx);
  if (url.pathname === '/api/talk/transcribe') return transcribe(request, env, who, url);
  if (url.pathname === '/api/talk/status') return status(request, env, who, _ctx);
  if (url.pathname === '/api/talk/merge') return merge(request, env, who);
  if (url.pathname === '/api/talk/summary') return summary(request, env, who);
  if (url.pathname === '/api/talk/log') {
    // One row per page-tool call (window.__webmcp / WebMCP, src/talkclient.ts). No model, no budget.
    const b = await request.json().catch(() => null) as any;
    log('webmcp', { level: 'info', handle: who.handle, tool: String(b?.tool || '').slice(0, 40), args: JSON.stringify(b?.args ?? {}).slice(0, 300), ms: Number(b?.ms) || 0, ok: !!b?.ok, path: String(b?.path || '').slice(0, 200), text_len: Number(b?.text_len) || 0 });
    return json({ ok: true });
  }
  return json({ error: 'not found' }, 404);
}
