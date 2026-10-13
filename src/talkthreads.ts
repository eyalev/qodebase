// Conversations in Talk (qb5, manager's brief 2026-10-13, Eyal approved): instant threads, each with its own log, its
// context (project chips), an automatic title and a status dot; saved here so they survive reloads and devices.
// Behind a per-device setting (off by default; src/talkconv.ts is the page side).
//
//   GET  /api/talk/conv             the person's conversations, newest first (no messages)
//   GET  /api/talk/conv?id=         one, with its messages
//   POST /api/talk/conv             upsert {id, title?, ctx?, status?, unseen?, msgs?, chat?}
//   POST /api/talk/conv/delete      {id}
//   POST /api/talk/conv/wipe        delete all of them (Talk settings)
//   POST /api/talk/conv/title       {id}: a 2-5 word title from the exchange so far (a fast model; kept unless the topic moved)
//
// Storage: one TalkLog instance per person, named `conv:<handle>` (its own SQL table; no new class, no migration).
// That instance never traces or counts (TalkLog.alarm() deletes everything and addTrace() arms it); conversations keep
// their own retention: 30 days after the last change, swept on every write.
// Whose words are kept here: the owner's, and people who said yes to "Help improve Talk" (qb2, 2026-10-13: keeping
// what people say is new storage, not silent). Everyone else's conversations stay on their device (the page keeps them).
// The chat lane's context: `contextKnowledge()` turns the chips into what the answering model knows about each project.
import type { Env } from './env';

export type ConvCtx = { slug: string; state: 'on' | 'maybe'; why?: string };
type Who = { handle: string; admin: boolean };

const ID_RE = /^[a-z0-9]{6,24}$/;
const SLUG_RE = /^[a-z0-9-]{1,40}\.[a-z0-9-]{1,80}$/;
const KEEP_MS = 30 * 86400_000, MAX_CONVS = 200, MAX_MSGS = 40, MAX_CHAT = 12, MAX_CTX = 8;
const STATUSES = ['idle', 'working', 'replied', 'needs'];
const TITLE_MODEL = '@cf/zai-org/glm-4.7-flash';
const log = (event: string, data: Record<string, unknown> = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), module: 'talk-conv', event, ...data }));
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

// ---- The store (runs inside the person's TalkLog instance; TalkLog.conv() calls it) -----------------------------
let ready = new WeakSet<object>();
function table(sql: SqlStorage) {
  if (!ready.has(sql)) {
    sql.exec('CREATE TABLE IF NOT EXISTS conv (id TEXT PRIMARY KEY, title TEXT, ctx TEXT, status TEXT, unseen INTEGER, msgs TEXT, chat TEXT, n INTEGER, last TEXT, titled_n INTEGER, created INTEGER, updated INTEGER, dev TEXT)');
    ready.add(sql);
  }
  return sql;
}
/** Messages as Talk keeps them ({who, text, links?, sections?, via?}), bounded in count and size. */
export function cleanMsgs(xs: unknown): any[] {
  const out = (Array.isArray(xs) ? xs : []).slice(-MAX_MSGS).filter((m: any) => m && typeof m.text === 'string' && ['you', 'app', 'ai', 'note'].includes(m.who))
    .map((m: any) => {
      const o: any = { who: m.who, text: m.text.slice(0, 4000) };
      if (Array.isArray(m.links)) o.links = m.links.slice(0, 8).map((l: any) => ({ text: String(l?.text || '').slice(0, 120), href: String(l?.href || '').slice(0, 300) }));
      if (Array.isArray(m.sections)) o.sections = m.sections.slice(0, 8);
      if (m.via && typeof m.via === 'object') o.via = m.via;
      if (typeof m.at === 'number') o.at = m.at;
      if (JSON.stringify(o).length > 16_000) { delete o.sections; delete o.via; delete o.links; }
      return o;
    });
  // The whole log stays under ~64 KB: drop the oldest until it fits.
  while (out.length > 1 && JSON.stringify(out).length > 64_000) out.shift();
  return out;
}
export function cleanChat(xs: unknown) {
  return (Array.isArray(xs) ? xs : []).slice(-MAX_CHAT).map((m: any) => ({ role: m?.role === 'assistant' ? 'assistant' : 'user', content: String(m?.content || '').slice(0, 1500) }));
}
export function cleanCtx(xs: unknown): ConvCtx[] {
  const seen = new Set<string>();
  return (Array.isArray(xs) ? xs : []).filter((c: any) => c && SLUG_RE.test(String(c.slug || '')) && !seen.has(c.slug) && seen.add(c.slug))
    .slice(0, MAX_CTX).map((c: any) => ({ slug: String(c.slug), state: c.state === 'maybe' ? 'maybe' : 'on', ...(c.why ? { why: String(c.why).slice(0, 80) } : {}) }));
}
const lastLine = (msgs: any[]) => { for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].who !== 'you') return String(msgs[i].text).replace(/\s+/g, ' ').slice(0, 160); return msgs.length ? String(msgs[msgs.length - 1].text).replace(/\s+/g, ' ').slice(0, 160) : ''; };
const row = (r: any, full: boolean) => ({
  id: r.id, title: r.title || '', ctx: JSON.parse(r.ctx || '[]'), status: r.status || 'idle', unseen: !!r.unseen, n: r.n || 0, last: r.last || '',
  titledN: r.titled_n || 0, created: r.created, updated: r.updated,
  ...(full ? { msgs: JSON.parse(r.msgs || '[]'), chat: JSON.parse(r.chat || '[]') } : {}),
});

export function convOp(sql0: SqlStorage, op: string, a: any): any {
  const sql = table(sql0);
  if (op === 'wipe') { sql.exec('DELETE FROM conv'); return { ok: true }; }
  if (op === 'list') return sql.exec('SELECT id, title, ctx, status, unseen, n, last, titled_n, created, updated FROM conv ORDER BY updated DESC LIMIT ?', Math.min(100, Number(a?.limit) || 50)).toArray().map((r) => row(r, false));
  const id = String(a?.id || '');
  if (!ID_RE.test(id)) return { error: 'id' };
  if (op === 'get') { const r = sql.exec('SELECT * FROM conv WHERE id = ?', id).toArray()[0]; return r ? row(r, true) : null; }
  if (op === 'delete') { sql.exec('DELETE FROM conv WHERE id = ?', id); return { ok: true }; }
  if (op === 'put') {
    const now = Date.now();
    sql.exec('DELETE FROM conv WHERE updated < ?', now - KEEP_MS);
    const old: any = sql.exec('SELECT * FROM conv WHERE id = ?', id).toArray()[0];
    // Written by another tab or device since this page read it: refuse, and hand back what is stored. (dev = the
    // writing tab, so a tab's own saves racing each other never count.)
    const dev = String(a.dev || '').slice(0, 24);
    if (old && a.msgs !== undefined && Number(a.base) > 0 && old.updated > Number(a.base) && old.dev && dev && old.dev !== dev) return { error: 'stale', conv: row(old, true) };
    if (!old) {
      const n = (sql.exec('SELECT COUNT(*) AS n FROM conv').one() as any).n as number;
      if (n >= MAX_CONVS) sql.exec('DELETE FROM conv WHERE id IN (SELECT id FROM conv ORDER BY updated ASC LIMIT ?)', n - MAX_CONVS + 1);
    }
    const msgs = a.msgs !== undefined ? cleanMsgs(a.msgs) : JSON.parse(old?.msgs || '[]');
    const v = {
      title: a.title !== undefined ? String(a.title || '').replace(/\s+/g, ' ').trim().slice(0, 60) : old?.title || '',
      ctx: JSON.stringify(a.ctx !== undefined ? cleanCtx(a.ctx) : JSON.parse(old?.ctx || '[]')),
      status: STATUSES.includes(a.status) ? a.status : old?.status || 'idle',
      unseen: a.unseen !== undefined ? (a.unseen ? 1 : 0) : old?.unseen || 0,
      msgs: JSON.stringify(msgs),
      chat: JSON.stringify(a.chat !== undefined ? cleanChat(a.chat) : JSON.parse(old?.chat || '[]')),
      n: a.msgs !== undefined ? Math.max(Number(a.n) || 0, msgs.length) : old?.n || 0,
      last: lastLine(msgs),
      titled_n: a.titledN !== undefined ? Number(a.titledN) || 0 : old?.titled_n || 0,
    };
    sql.exec(`INSERT INTO conv (id, title, ctx, status, unseen, msgs, chat, n, last, titled_n, created, updated, dev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, ctx = excluded.ctx, status = excluded.status, unseen = excluded.unseen, msgs = excluded.msgs,
      chat = excluded.chat, n = excluded.n, last = excluded.last, titled_n = excluded.titled_n, updated = excluded.updated,
      dev = CASE WHEN ? THEN excluded.dev ELSE conv.dev END`,
      id, v.title, v.ctx, v.status, v.unseen, v.msgs, v.chat, v.n, v.last, v.titled_n, old?.created || now, now, dev || old?.dev || '', a.msgs !== undefined && dev ? 1 : 0);
    return row(sql.exec('SELECT id, title, ctx, status, unseen, n, last, titled_n, created, updated FROM conv WHERE id = ?', id).one(), false);
  }
  return { error: 'op' };
}
const store = (env: Env, handle: string) => env.TalkLog.get(env.TalkLog.idFromName(`conv:${handle}`)) as any;

// ---- Titles ------------------------------------------------------------------------------------------------------
export function titleMessages(msgs: any[], current: string) {
  const lines = msgs.filter((m) => m.who === 'you' || m.who === 'ai').slice(-10).map((m) => `${m.who === 'you' ? 'Person' : 'Assistant'}: ${String(m.text).replace(/\s+/g, ' ').slice(0, 300)}`).join('\n').slice(-2500);
  return [
    { role: 'system', content: 'You name chat threads, like a messaging app does. Answer with the title only: 2 to 5 words, plain, no quotes, no full stop, no emoji. Name the topic (a project, a task, a question), never "Conversation" or "Chat".' + (current ? ` The thread is called "${current}" now: answer with exactly that unless the newest messages are clearly about something else.` : '') },
    { role: 'user', content: lines || '(empty)' },
  ];
}
export function cleanTitle(raw: string) {
  const t = String(raw || '').replace(/<think>[\s\S]*?<\/think>/g, '').split('\n').map((x) => x.trim()).filter(Boolean)[0] || '';
  return t.replace(/^(title|thread)\s*:\s*/i, '').replace(/^["'“”‘’*]+|["'“”‘’*.!]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 48);
}

// ---- What a chip tells the answering model ------------------------------------------------------------------------
const knowMemo = new Map<string, { at: number; text: string }>();
/** Projects this person may put in a conversation: their own, and public ones (never someone else's private project). */
// listFor (src/registry.ts) is passed in, so this file has no imports and its tests run in plain Node.
type ListFor = (env: Env, handle: string, admin: boolean) => Promise<any[]>;
export async function allowedSlugs(env: Env, who: Who, slugs: string[], listFor: ListFor) {
  const want = slugs.filter((s) => SLUG_RE.test(s)).slice(0, 6);
  if (!want.length) return [];
  const list = await listFor(env, who.handle, !!who.admin);
  const ok = new Set(list.filter((e: any) => e.owner === who.handle || !e.private).map((e: any) => e.slug));
  return want.filter((s) => ok.has(s));
}
export async function contextKnowledge(env: Env, who: Who, slugs: string[], listFor: ListFor): Promise<{ text: string; slugs: string[] }> {
  const ok = await allowedSlugs(env, who, slugs, listFor);
  const parts = await Promise.all(ok.map(async (slug) => {
    const key = `${who.handle}|${slug}`, m = knowMemo.get(key);
    if (m && Date.now() - m.at < 20_000) return m.text;
    const text = await oneProject(env, who, slug).catch((e) => { log('ctx_error', { level: 'error', slug, err: String(e) }); return `${slug.replace('.', '/')}: (could not read it just now)`; });
    knowMemo.set(key, { at: Date.now(), text });
    if (knowMemo.size > 500) knowMemo.delete(knowMemo.keys().next().value!);
    return text;
  }));
  return { text: parts.join('\n\n'), slugs: ok };
}
const short = (t: unknown, n = 90) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n - 2).replace(/\s\S*$/, '') + '…' : x; };
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
async function oneProject(env: Env, who: Who, slug: string) {
  const info: any = await env.Project.get(env.Project.idFromName(slug)).info();
  if (!info) return `${slug.replace('.', '/')}: not found`;
  const name = `${info.owner}/${info.name}`, mine = info.owner === who.handle;
  const lines = [`Project ${name} (${mine ? 'theirs' : `by ${info.owner}, public`})${info.description ? `: ${short(info.description, 200)}` : ''}`];
  const agents = (info.agents || []) as any[];
  const by = (s: string) => agents.filter((a) => a.state === s);
  if (by('working').length) lines.push(`- Agents working: ${by('working').slice(0, 4).map((a) => `"${short(a.request || a.task, 70)}"`).join('; ')}`);
  if (by('pushed').length) lines.push(`- Ready to merge: ${by('pushed').slice(0, 4).map((a) => `"${short(a.request || a.task, 70)}"${a.review?.state === 'approved' ? ' (approved)' : ''}`).join('; ')}`);
  if (by('blocked').length) lines.push(`- Blocked: ${by('blocked').slice(0, 3).map((a) => `"${short(a.request || a.task, 70)}"`).join('; ')}`);
  const merged = agents.filter((a) => a.state === 'merged').sort((a, b) => (b.noteAt || b.createdAt || 0) - (a.noteAt || a.createdAt || 0)).slice(0, 4);
  if (merged.length) lines.push(`- Recently merged: ${merged.map((a) => `"${short(a.request || a.task, 60)}" (${ago(a.noteAt || a.createdAt || Date.now())})`).join('; ')}`);
  if (info.lastRequest) lines.push(`- Last request to its agents: "${short(info.lastRequest.text, 90)}" (${info.lastRequest.state}, ${ago(info.lastRequest.at)})`);
  if (info.landing && env.Landing && mine) {
    const L = env.Landing.get(env.Landing.idFromName(slug));
    const [ad, bi] = await Promise.all([L.asksData().catch(() => null) as Promise<any>, L.buildInfo().catch(() => null) as Promise<any>]);
    const ch = (ad?.changes || []) as { state: string; title: string; createdAt: number }[];
    const landed = ch.filter((c) => c.state === 'landed');
    const open = ch.filter((c) => !['landed', 'bounced'].includes(c.state));
    const started = bi?.estimate?.startedAt || 0, settled = bi?.progress?.settledAt || 0;
    if (started && !settled) lines.push(`- Build running: ${landed.length} of ${ch.length} changes on main, ${open.length} in progress${bi?.progress?.spentUsd != null ? `, $${Number(bi.progress.spentUsd).toFixed(2)} so far` : ''}`);
    else if (settled) lines.push(`- Last build finished ${ago(settled)}: ${landed.length} changes landed${bi?.progress?.actualUsd != null ? `, $${Number(bi.progress.actualUsd).toFixed(2)}` : ''}`);
    if (landed.length) lines.push(`- Landed changes: ${landed.slice(-5).map((c) => `"${short(c.title, 50)}"`).join('; ')}`);
    const asks = ((ad?.notes || []) as any[]).filter((n) => n.kind === 'asked-person' && !n.answered).slice(0, 3);
    if (asks.length) lines.push(`- Open questions from its agents to them: ${asks.map((n) => `"${short(n.text, 90)}"`).join('; ')}`);
  }
  if (!mine) lines.push('- Not theirs: a change would need a fork first, or a suggestion to its owner.');
  return lines.join('\n');
}

// ---- Routes ------------------------------------------------------------------------------------------------------
// keep: may this person's conversations be stored here (the owner, or "Help improve Talk" on)? If not, every answer
// says {local: true} and nothing is written; titles are made from the messages the page sends.
export async function convRoute(request: Request, env: Env, url: URL, who: Who, keep: boolean, take: (kind: 'chat', who: string) => Promise<{ ok: boolean }>): Promise<Response> {
  const t0 = Date.now();
  const s = store(env, who.handle);
  const p = url.pathname;
  try {
    if (p === '/api/talk/conv' && request.method === 'GET') {
      if (!keep) return json({ convs: [], local: true });
      const id = url.searchParams.get('id');
      if (id) { const c = await s.conv('get', { id }); return c ? json(c) : json({ error: 'gone' }, 404); }
      return json({ convs: await s.conv('list', { limit: url.searchParams.get('limit') }) });
    }
    if (request.method !== 'POST') return json({ error: 'method' }, 405);
    if (Number(request.headers.get('content-length') || 0) > 200_000) return json({ error: 'size' }, 413);
    const b: any = await request.json().catch(() => ({}));
    if (p === '/api/talk/conv/wipe') { const r = await s.conv('wipe', {}); log('wipe', { level: 'info', handle: who.handle }); return json(r); }
    if (p === '/api/talk/conv') {
      if (!keep) return json({ local: true });
      if (JSON.stringify(b).length > 200_000) return json({ error: 'size' }, 413);
      const r = await s.conv('put', b);
      if (r?.error === 'stale') { log('stale', { level: 'info', handle: who.handle, id: b?.id }); return json(r); }
      if (r?.error) return json(r, 400);
      return json(r);
    }
    if (p === '/api/talk/conv/delete') { const r = await s.conv('delete', b); log('delete', { level: 'info', handle: who.handle, id: b?.id }); return json(r, r?.error ? 400 : 200); }
    if (p === '/api/talk/conv/title') {
      // Kept here: the stored messages. On the device only: the ones the page sends.
      const c = keep ? await s.conv('get', { id: b?.id }) : (ID_RE.test(String(b?.id || '')) ? { id: b.id, title: String(b?.title || ''), msgs: cleanMsgs(b?.msgs), n: Number(b?.n) || 0 } : null);
      if (!c) return json({ error: 'gone' }, 404);
      if (!(await take('chat', who.handle)).ok) return json({ title: c.title, why: 'budget' });
      const res: any = await (env.AI as any).run(TITLE_MODEL, { messages: titleMessages(c.msgs, c.title), max_tokens: 24, temperature: 0.2, chat_template_kwargs: { enable_thinking: false } }, env.TALK_GATEWAY ? { gateway: { id: env.TALK_GATEWAY } } : {});
      const title = cleanTitle(res?.choices?.[0]?.message?.content ?? res?.response ?? '');
      const changed = !!title && title.toLowerCase() !== String(c.title || '').toLowerCase();
      if (title && keep) await s.conv('put', { id: c.id, title, titledN: c.n });
      log('title', { level: 'info', handle: who.handle, id: c.id, n: c.n, ...(keep ? { title, was: c.title } : {}), changed, ms: Date.now() - t0, usage: res?.usage });
      return json({ title: title || c.title, changed, model: TITLE_MODEL, ms: Date.now() - t0 });
    }
    return json({ error: 'not found' }, 404);
  } catch (e) {
    log('error', { level: 'error', path: p, err: String(e), stack: (e as Error)?.stack });
    return json({ error: 'conv', why: 'Could not reach your conversations.' }, 502);
  }
}
