// The chat lane's prompt, tools and parsing, and the answering models it can use (manager, 2026-10-13: Gemini 3.1
// Flash-Lite as the default through qodebase's own key, a bigger Workers AI model, GLM-4.7-flash, and Claude Haiku /
// Sonnet 5.5 through AI Gateway unified billing for the owner once the account has credits). Every call goes
// through the qodebase-talk gateway; anything that fails falls back to GLM-4.7-flash. Shared with
// scripts/talk-chat-bench.mjs, so erasable TypeScript only and no imports.

export type ChatScreen = { path: string; title: string; items: { id: string; kind: string; text: string; href?: string }[] };

// context: what the conversation's project chips say (src/talkthreads.ts contextKnowledge); '' = today's prompt, unchanged.
export function chatSystem(handle: string, s: ChatScreen, pageText: string, did: string, context = '') {
  const items = s.items.map((i) => `${i.id} ${i.kind}: ${i.text}${i.href ? ' → ' + i.href : ''}`).join('\n');
  const system = [
    'You are the voice of qodebase, a git platform made for the phone: every project runs as a live app, every fork gets its own AI agents, and people can install AI assistants into their own Cloudflare account.',
    `You talk with ${handle}, who is on ${s.path} ("${s.title}"). Answer in plain words, short: two or three sentences unless they ask for more. Spoken aloud too, so no markdown, no lists, no code, and never read out paths, URLs or ids (say "this page", "the Hermes card").`,
    'You can act with the tools: open pages, press buttons, type into fields, and point at parts of the page while you explain. Act when asked; explain what is on the page when asked; never press anything that deletes, merges, publishes or signs out.',
    'What is true about qodebase (say you do not know rather than guess anything else):',
    '- Every project is a git repo stored in Cloudflare Artifacts. Static projects run live at <name>--<owner>.ttyview.dev; projects with a Worker config are deployed as Cloudflare Workers.',
    '- Fork copies a project to your account. Ask (the router agent) splits a request into tasks; each task gets an agent (Claude Code in a Cloudflare container) on its own fork; a reviewer agent checks pushes; you merge from the phone.',
    '- Your own AI assistant (/personal-agents) installs an assistant into YOUR Cloudflare account with Sign in with Cloudflare: Cloudflare Agent fits the free plan; OpenClaw, Hermes, T3 Code, Mobile Agent and Pi need Workers Paid ($5 a month per account, not per assistant). Mobile Agent and T3 Code can use your own Claude subscription.',
    '- Get your own qodebase (/own) installs a whole copy of qodebase into your Cloudflare account. The qb command line (/cli) does everything from a terminal or an agent.',
    context ? `This conversation is about these projects (the person put them on it; this is what is true about them now):\n${context}\nTo ask one of them for a change, call send_change with the project as owner/name and the request in the person's words; the app asks the person to confirm before anything is sent, so never say it was sent.` : '',
    did ? `The app has ALREADY done this for their sentence: ${did}. Do not do it again; answer the rest of what they asked, about the page they are on now.` : '',
    '', 'What is on the page (id, kind, text):', items || '(nothing)', '', 'The page text:', pageText || '(none)',
  ].filter((x) => x !== '').join('\n');
  return system;
}

export const TOOLS = [
  { type: 'function', function: { name: 'go', description: 'Open a page: a link id from the page (like l12) or a path on this site (like /p/forq/timer/app).', parameters: { type: 'object', properties: { to: { type: 'string' } }, required: ['to'] } } },
  { type: 'function', function: { name: 'press', description: 'Press a button on the page by its id (like b3). Never for deleting, merging, publishing or signing out.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'type_into', description: 'Type text into a field on the page by its id (like f1).', parameters: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] } } },
  { type: 'function', function: { name: 'show', description: 'Point at parts of the page while you explain them: heading, link, button or field ids, in the order you talk about them.', parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] } } },
];

// Only when the conversation has projects on it (Conversations, qb5): a change request to one of them, confirmed on the page.
export const CONTEXT_TOOLS = [
  { type: 'function', function: { name: 'send_change', description: 'Ask one of this conversation\'s projects for a change: its agents get the request after the person confirms on screen. project = owner/name from the conversation\'s projects; text = the request, in the person\'s words.', parameters: { type: 'object', properties: { project: { type: 'string' }, text: { type: 'string' } }, required: ['project', 'text'] } } },
];
TOOLS.push({ type: 'function', function: { name: 'idea', description: 'Get an idea for something new to build from qodebase\'s idea generator (it fills the build box with the idea and settings that suit it). Use it whenever they ask for an idea or a suggestion of what to build.', parameters: { type: 'object', properties: { size: { type: 'string', enum: ['Small', 'Medium', 'Large', 'Huge'] } }, required: [] } } } as any);
export const TOOL_NAMES = ['go', 'press', 'type_into', 'show', 'send_change', 'idea'];
/** One model answer (OpenAI-shaped, Workers AI, or Gemini's) → { raw tool calls, calls, reply }. */
export function parseChat(res: any) {
  const msg = res?.choices?.[0]?.message || res;
  const raw = msg?.tool_calls || res?.tool_calls || [];
  const calls = raw.map((c: any) => {
    const f = c.function || c;
    let args: any = f.arguments;
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
    return { id: c.id, name: String(f.name || ''), args: args || {} };
  }).filter((c: any) => TOOL_NAMES.includes(c.name)).slice(0, 4);
  return { msg, raw, calls, reply: String(msg?.content ?? res?.response ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim() };
}

/** A usable answer: words, or tool calls that all parsed (no malformed or unknown ones). */
export function validAnswer(res: any) {
  const p = parseChat(res);
  const bad = p.raw.length !== p.calls.length || p.raw.some((c: any) => { const a = (c.function || c).arguments; if (typeof a !== 'string') return false; try { JSON.parse(a); return false; } catch { return true; } });
  return !bad && (p.calls.length > 0 || p.reply.length > 0);
}
export type AnswerModel = { id: string; label: string; model: string; via: 'workers' | 'gemini' | 'unified'; paid?: boolean; ownerOnly?: boolean; usdIn: number; usdOut: number; thinkingOff?: boolean; temperature?: number; hedge?: { backup: string; afterMs: number } };
export const ANSWER_MODELS: AnswerModel[] = [
  { id: 'gemini', label: 'Gemini 3.1 Flash-Lite', model: 'gemini-3.1-flash-lite', via: 'gemini', usdIn: 0.25, usdOut: 1.5 },
  // The best tool-caller of the bigger Workers AI models on the chat bench (2026-10-13, 12 cases x 2): DeepSeek V4 Flash
  // 22/24 (median 2.8 s); gpt-oss-120b 18/24, glm-5.3-flash 21/24 (9.4 s), qwen3.8-27b 20/24 (9.0 s).
  { id: 'big', label: 'DeepSeek V4 Flash (Workers AI)', model: '@cf/deepseek-ai/deepseek-v4-flash-0731', via: 'workers', usdIn: 0.44, usdOut: 1.32 },
  // Temperature 0 + thinking off: 24/24 on the chat bench (2026-10-17; 22/24 at 0.3).
  { id: 'glm', label: 'GLM-4.7-flash (Workers AI, cheapest)', model: '@cf/zai-org/glm-4.7-flash', via: 'workers', usdIn: 0.0605, usdOut: 0.4, thinkingOff: true, temperature: 0 },
  // Everyone's default since 2026-10-17 (manager): GLM first; no valid answer within 1.5 s (or an empty / malformed tool
  // call) and Claude Haiku 5.5 races it, the first valid answer wins. Per turn: who won, both times (trace 'won').
  { id: 'fast', label: 'GLM-4.7-flash, Claude Haiku as backup', model: '@cf/zai-org/glm-4.7-flash', via: 'workers', usdIn: 0.0605, usdOut: 0.4, thinkingOff: true, temperature: 0, hedge: { backup: 'haiku', afterMs: 1500 } },
  { id: 'haiku', label: 'Claude Haiku 5.5', model: 'anthropic/claude-haiku-5.5', via: 'unified', paid: true, usdIn: 0.105, usdOut: 0.525 },   // $0.10/$0.50 + unified billing's 5% (CLAUDE.md prices, 2026-10-08)
  { id: 'sonnet', label: 'Claude Sonnet 5.5', model: 'anthropic/claude-sonnet-5.5', via: 'unified', paid: true, usdIn: 2.1, usdOut: 10.5 },   // $2/$10 + 5%
];
// Everyone's default: 'fast' (GLM with Haiku racing after 1.5 s; was Haiku alone 2026-10-13..17). When credits or a cap
// run out the backup is Gemini (PAID_FALLBACK); any failure after that is GLM-4.7-flash (FALLBACK_ANSWER).
export const DEFAULT_ANSWER = 'fast';
export const PAID_FALLBACK = 'gemini';
export const FALLBACK_ANSWER = 'glm';
export const answerModel = (id: string) => ANSWER_MODELS.find((m) => m.id === id);

// Gemini's own API (qb6's fleet calls it the same way): OpenAI-shaped messages and tools in, an OpenAI-shaped answer out.
export function toGemini(messages: any[], tools: any[] | null, maxTokens: number) {
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const contents: any[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') { contents.push({ role: 'user', parts: [{ functionResponse: { name: m.name || 'tool', response: { result: m.content } } }] }); continue; }
    if (m.role === 'assistant' && m.tool_calls?.length) { contents.push({ role: 'model', parts: m.tool_calls.map((c: any) => ({ functionCall: { name: c.function?.name, args: typeof c.function?.arguments === 'string' ? JSON.parse(c.function.arguments || '{}') : c.function?.arguments || {} } })) }); continue; }
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content || ' ') }] });
  }
  const body: any = { contents, generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens } };
  if (sys) body.systemInstruction = { parts: [{ text: sys }] };
  if (tools?.length) body.tools = [{ functionDeclarations: tools.map((t: any) => ({ name: t.function.name, description: t.function.description, parameters: t.function.parameters })) }];
  return body;
}
export function fromGemini(j: any) {
  const parts = j?.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((p: any) => p.text).map((p: any) => p.text).join('').trim();
  const tool_calls = parts.filter((p: any) => p.functionCall).map((p: any, i: number) => ({ id: 'g' + i, type: 'function', function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) } }));
  const u = j?.usageMetadata || {};
  return { choices: [{ message: { role: 'assistant', content: text, tool_calls } }], usage: { prompt_tokens: u.promptTokenCount || 0, completion_tokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) } };
}

// Claude through the AI binding speaks Anthropic's own Messages API (system apart, tools with input_schema, tool_use /
// tool_result blocks, usage.input_tokens): OpenAI-shaped in, OpenAI-shaped out (2026-10-13: OpenAI-shaped input gave 7003).
export function toAnthropic(messages: any[], tools: any[] | null, maxTokens: number) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const out: any[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') { out.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: String(m.content || 'done') }] }); continue; }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      out.push({ role: 'assistant', content: [...(m.content ? [{ type: 'text', text: m.content }] : []), ...m.tool_calls.map((c: any) => ({ type: 'tool_use', id: c.id, name: c.function?.name, input: typeof c.function?.arguments === 'string' ? JSON.parse(c.function.arguments || '{}') : c.function?.arguments || {} }))] });
      continue;
    }
    out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || ' ') });
  }
  const body: any = { messages: out, max_tokens: maxTokens };   // no temperature: Claude 5.5 refuses it here (7003)
  if (system) body.system = system;
  if (tools?.length) body.tools = tools.map((t: any) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters }));
  return body;
}
export function fromAnthropic(r: any) {
  if (r?.choices) return r;   // already OpenAI-shaped
  const blocks = r?.content || [];
  const text = blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
  const tool_calls = blocks.filter((b: any) => b.type === 'tool_use').map((b: any) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input || {}) } }));
  return { choices: [{ message: { role: 'assistant', content: text, tool_calls } }], usage: { prompt_tokens: r?.usage?.input_tokens || 0, completion_tokens: r?.usage?.output_tokens || 0 } };
}
