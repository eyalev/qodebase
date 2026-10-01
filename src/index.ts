// forq Worker.
//
// Hosts:
//   forq.kapps.dev      UI + API, behind Cloudflare Access (JWT verified here too)
//   forq-run.kapps.dev  public run host: any repo/fork as a live static app (run.ts)
//   *.workers.dev       admin (x-forq-secret) and the boxes' forq CLI (x-forq-agent)

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AGENT_RE, NAME_RE, projectOf, slugOf, type Env } from './env';
import { AgentBox, log, type BootSpec } from './box';
import { Project, type ProjectInfo } from './project';
import { Registry, registry } from './registry';
import { serveRun } from './run';
import { agentsHtml, explorePage, projectPage, type BoxStatus } from './ui';
import { startingPage } from './pages';

export { AgentBox, Project, Registry };

type Who = { kind: 'user'; handle: string; admin: boolean } | { kind: 'agent'; agentId: string; router: boolean };
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
const json = (data: unknown, status = 200) => Response.json(data, { status });
const projectStub = (env: Env, slug: string) => env.Project.get(env.Project.idFromName(slug));
const boxStub = (env: Env, agentId: string) => env.AgentBox.get(env.AgentBox.idFromName(agentId));
const INLINE_BOOT_MS = 12_000;

async function hmac(env: Env, msg: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.ADMIN_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`agent:${msg}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const agentToken = async (env: Env, agentId: string) => `${agentId}.${await hmac(env, agentId)}`;

async function who(request: Request, env: Env): Promise<Who | null> {
  const url = new URL(request.url);
  const handles = JSON.parse(env.HANDLES || '{}') as Record<string, string>;
  if (url.hostname.endsWith('.workers.dev')) {
    const at = request.headers.get('x-forq-agent');
    if (at) {
      const i = at.lastIndexOf('.');
      const id = at.slice(0, i);
      if (i > 0 && AGENT_RE.test(id) && at.slice(i + 1) === await hmac(env, id)) return { kind: 'agent', agentId: id, router: id.endsWith('--router') };
      return null;
    }
    if (env.ADMIN_SECRET && request.headers.get('x-forq-secret') === env.ADMIN_SECRET) {
      return { kind: 'user', handle: request.headers.get('x-forq-as') || 'eyal', admin: true };
    }
    return null;
  }
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return null;
  try {
    jwks ||= createRemoteJWKSet(new URL(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`));
    const { payload } = await jwtVerify(token, jwks, { issuer: `https://${env.ACCESS_TEAM_DOMAIN}`, audience: env.ACCESS_AUD });
    const handle = handles[String(payload.email || '').toLowerCase()];
    return handle ? { kind: 'user', handle, admin: false } : null;
  } catch (e) {
    log('auth', 'jwt_rejected', { err: String(e) });
    return null;
  }
}

async function bootSpec(env: Env, agentId: string, apiBase: string): Promise<BootSpec> {
  const slug = projectOf(agentId);
  const r = await projectStub(env, slug).boxRepo(agentId);
  const cc = env.CLAUDE_CODE_OAUTH_TOKEN;
  return {
    agentId, task: r.task, router: r.router, project: slug.replace('.', '/'), remote: r.remote, gitToken: r.token,
    agentToken: await agentToken(env, agentId), apiBase,
    bootEnv: [
      `SBX_NAME=${JSON.stringify(r.router ? `${slug.replace('.', '/')} router` : agentId)}`,
      'AGENT=claude',
      `CC_ENV=${JSON.stringify(`CLAUDE_CODE_OAUTH_TOKEN=${cc}`)}`,
      `CC_KEY_TAIL=${JSON.stringify(cc.slice(-20))}`,
      'BILLING=sub',
      '',
    ].join('\n'),
  };
}

/** Boot an agent's (or the router's) box unless too many boxes in its project are awake. */
async function wake(env: Env, agentId: string, apiBase: string) {
  const info = await projectStub(env, projectOf(agentId)).info();
  if (!info) throw new Error('no such project');
  const max = Number(env.MAX_AWAKE_BOXES || 5);
  const others = [...info.agents.map((a) => a.id), `${info.slug}--router`].filter((id) => id !== agentId);
  const awake = await Promise.all(others.map((id) => boxStub(env, id).isAwake().catch(() => false)));
  if (awake.filter(Boolean).length >= max) return { ok: false, ms: 0, from: 'none', error: `${max} boxes already awake in this project` };
  return boxStub(env, agentId).ensureUp(await bootSpec(env, agentId, apiBase));
}

async function boxStatus(env: Env, id: string, withReply = false): Promise<BoxStatus> {
  const box = boxStub(env, id);
  const awake = await box.isAwake().catch(() => false);
  if (!awake) return { awake, cc: 'asleep' };
  const [cc, said] = await Promise.all([box.ccStatus().catch(() => 'unknown'), withReply ? box.lastReply().catch(() => undefined) : undefined]);
  return { awake, cc, said };
}

async function renderAgents(env: Env, info: ProjectInfo, runBase: string) {
  const status: Record<string, BoxStatus> = {};
  const open = info.agents.filter((a) => a.state !== 'merged' && a.state !== 'stopped');
  await Promise.all(open.map(async (a) => { status[a.id] = await boxStatus(env, a.id); }));
  return agentsHtml(info, runBase, await boxStatus(env, `${info.slug}--router`, true), status);
}

/** Send text to a box's Claude Code, booting it first if needed. */
async function sendTo(env: Env, agentId: string, text: string, apiBase: string) {
  const box = boxStub(env, agentId);
  if (!(await box.isAwake())) {
    const b = await wake(env, agentId, apiBase);
    if (!b.ok) return { ok: false, error: b.error || 'the box did not start' };
  }
  await box.touch(agentId);
  return box.send(text);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname === env.RUN_HOST) return serveRun(request, env, ctx);
    const me = await who(request, env);
    if (!me) return json({ error: 'unauthorized' }, 401);
    const path = url.pathname;
    // Boxes call back through workers.dev (no Access in front of it).
    const apiBase = `https://${url.hostname.endsWith('.workers.dev') ? url.hostname : 'forq.<sub>.workers.dev'}`;
    const runBase = `https://${env.RUN_HOST}`;
    try {
      if (me.kind === 'agent') return agentApi(request, env, ctx, me, url, apiBase);
      let m: RegExpMatchArray | null;

      // ---- pages
      if (path === '/') {
        return html(explorePage(await registry(env).list(), me.handle));
      }
      if ((m = path.match(/^\/p\/([a-z0-9-]+)\/([a-z0-9-]+)\/?$/))) {
        const slug = slugOf(m[1], m[2]);
        const p = projectStub(env, slug);
        const info = await p.info();
        if (!info) return new Response('No such project', { status: 404 });
        const all = await registry(env).list();
        const entry = all.find((e) => e.slug === slug)!;
        return html(projectPage({ info, entry, forks: all.filter((e) => e.forkedFrom === slug), overview: await p.overview(),
          me: me.handle, runBase, agentsHtml: info.owner === me.handle ? await renderAgents(env, info, runBase) : '' }));
      }

      // ---- the boxes' own UIs: /a/<agentId>/agent/* → mobile-agent
      if ((m = path.match(/^\/a\/([a-z0-9.-]+--[a-z0-9]+)(\/.*)?$/))) {
        const id = m[1];
        const info = await projectStub(env, projectOf(id)).info();
        if (!info || (info.owner !== me.handle && !me.admin)) return json({ error: 'not your project' }, 403);
        return agentProxy(request, env, ctx, id, m[2] || '/', url, apiBase);
      }

      // ---- project API: /api/p/<owner>/<name>/<verb>
      if ((m = path.match(/^\/api\/p\/([a-z0-9-]+)\/([a-z0-9-]+)(?:\/([a-z-]+))?$/))) {
        const [, owner, name, verb = ''] = m;
        const slug = slugOf(owner, name);
        const p = projectStub(env, slug);
        if (verb === 'create' && request.method === 'POST') {
          if (!me.admin) return json({ error: 'admin only' }, 403);
          const b = await request.json().catch(() => ({})) as { description?: string };
          return json(await p.create(owner, name, b.description || ''));
        }
        const info = await p.info();
        if (!info) return json({ error: 'no such project' }, 404);
        if (verb === '' && request.method === 'GET') return json(info);
        if (verb === 'fork' && request.method === 'POST') {
          if (info.owner === me.handle) return json({ error: 'this is already yours' }, 400);
          let newName = info.name;
          for (let i = 2; await registry(env).get(slugOf(me.handle, newName)); i++) newName = `${info.name}-${i}`;
          if (!NAME_RE.test(newName)) return json({ error: 'name too long' }, 400);
          const fi = await projectStub(env, slugOf(me.handle, newName)).createFork(me.handle, newName, info);
          return json({ ...fi, path: `/p/${fi.owner}/${fi.name}` });
        }
        if (info.owner !== me.handle && !me.admin) return json({ error: 'not your project' }, 403);
        if (verb === 'main-token' && request.method === 'POST' && me.admin) return json(await p.mainToken());
        if (verb === 'touch' && request.method === 'POST' && me.admin) { await registry(env).touch(slug); return json({ ok: true }); }
        if (verb === 'agents-html') return json({ html: await renderAgents(env, info, runBase) });
        if (verb === 'agents' && request.method === 'POST') {
          const b = await request.json() as { task?: string };
          return json(await spawn(env, ctx, slug, String(b.task || ''), apiBase));
        }
        if (verb === 'router' && request.method === 'POST') {
          const b = await request.json() as { text?: string };
          const text = String(b.text || '').trim();
          if (!text || text.length > 8000) return json({ error: 'say something (max 8000 chars)' }, 400);
          const r = await sendTo(env, `${slug}--router`, text, apiBase);
          log('api', 'router_send', { slug, ok: r.ok, chars: text.length, err: r.error });
          return json(r, r.ok ? 200 : 502);
        }
        if (verb === 'merge' && request.method === 'POST') {
          const b = await request.json() as { agent?: string };
          const a = info.agents.find((x) => x.id === b.agent);
          if (!a) return json({ error: 'unknown agent' }, 404);
          const r = await sendTo(env, `${slug}--router`, `Merge agent ${a.id} into main: run \`forq merge ${a.id}\` and tell me the result in one line.`, apiBase);
          return json(r, r.ok ? 200 : 502);
        }
      }

      // ---- per-box ops: /api/agents/<id>/<verb>
      if ((m = path.match(/^\/api\/agents\/([a-z0-9.-]+--[a-z0-9]+)\/([a-z]+)$/))) {
        const [, id, verb] = m;
        const info = await projectStub(env, projectOf(id)).info();
        if (!info || (info.owner !== me.handle && !me.admin)) return json({ error: 'not your project' }, 403);
        const box = boxStub(env, id);
        if (verb === 'state') return json({ ...(await box.state()), ...(await boxStatus(env, id, true)) });
        if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
        if (verb === 'wake') return json(await wake(env, id, apiBase));
        if (verb === 'stop') { await box.letGo('manual'); return json(await box.state()); }
        if (verb === 'send') {
          const { text } = await request.json() as { text?: string };
          if (!text) return json({ error: 'text required' }, 400);
          return json(await sendTo(env, id, text, apiBase));
        }
        if (verb === 'exec' && me.admin) return json(await box.adminExec(await request.text()));
        if (verb === 'reset' && me.admin) { await box.destroy(); return json(await wake(env, id, apiBase)); }
      }

      // ---- admin: delete a repo (cleanup)
      if (path === '/api/admin/delete' && request.method === 'POST' && me.admin) {
        const b = await request.json() as { repo?: string; box?: string; project?: string };
        if (b.box) await boxStub(env, b.box).destroy();
        if (b.project) await projectStub(env, b.project).wipe();
        const ok = b.repo ? await env.ARTIFACTS.delete(b.repo).catch((e) => String(e)) : null;
        return json({ deleted: ok });
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      log('api', 'error', { path, err: String(e), stack: (e as Error)?.stack });
      return json({ error: String((e as Error)?.message || e) }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

async function spawn(env: Env, ctx: ExecutionContext, slug: string, task: string, apiBase: string) {
  task = task.trim();
  if (!task || task.length > 4000) throw new Error('task required (max 4000 chars)');
  const agent = await projectStub(env, slug).addAgent(task);
  ctx.waitUntil(wake(env, agent.id, apiBase)
    .then((r) => log('api', 'agent_boot', { id: agent.id, ...r }))
    .catch((e) => log('api', 'agent_boot_failed', { id: agent.id, err: String(e), stack: e?.stack })));
  return agent;
}

/** /api/agent/* — the forq CLI inside boxes. */
async function agentApi(request: Request, env: Env, ctx: ExecutionContext, me: Extract<Who, { kind: 'agent' }>, url: URL, apiBase: string) {
  const slug = projectOf(me.agentId);
  const p = projectStub(env, slug);
  const verb = url.pathname.replace(/^\/api\/agent\//, '');
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) as Record<string, string> : {};
  log('agent_api', verb, { agentId: me.agentId });
  if (verb === 'list') {
    const info = await p.info();
    return json({ agents: (info?.agents || []).map(({ id, task, state, note }) => ({ id, task, state, note })) });
  }
  if (verb === 'status' && !me.router) {
    if (!['working', 'pushed', 'blocked'].includes(body.state)) return json({ error: 'state: working|pushed|blocked' }, 400);
    await p.setState(me.agentId, body.state as 'working', String(body.note || ''));
    return json({ ok: true });
  }
  if (!me.router) return json({ error: 'only the router can do that' }, 403);
  if (verb === 'spawn') {
    return json(await spawn(env, ctx, slug, String(body.task || ''), apiBase));
  }
  if (verb === 'send') {
    if (projectOf(body.agent || '') !== slug) return json({ error: 'not an agent of this project' }, 400);
    return json(await sendTo(env, body.agent, String(body.text || ''), apiBase));
  }
  if (verb === 'merge-info') {
    const agent = url.searchParams.get('agent') || '';
    if (projectOf(agent) !== slug) return json({ error: 'not an agent of this project' }, 400);
    return json(await p.forkForMerge(agent));
  }
  if (verb === 'merged') {
    if (projectOf(body.agent || '') !== slug) return json({ error: 'not an agent of this project' }, 400);
    await p.setState(body.agent, 'merged');
    return json({ ok: true });
  }
  return json({ error: 'unknown verb' }, 404);
}

async function agentProxy(request: Request, env: Env, ctx: ExecutionContext, agentId: string, rest: string, url: URL, apiBase: string) {
  if (rest === '/' || rest === '/agent') return Response.redirect(`${url.origin}/a/${agentId}/agent/${url.search}`, 302);
  if (!rest.startsWith('/agent/')) return json({ error: 'not found' }, 404);
  const sub = rest.slice('/agent'.length);
  const box = boxStub(env, agentId);
  ctx.waitUntil(box.touch(agentId).catch(() => {}));
  const proxy = () => box.fetch(new Request(`https://container${sub}${url.search}`, request));
  const isWs = (request.headers.get('upgrade') || '').toLowerCase() === 'websocket';
  const isDoc = request.method === 'GET' && !isWs && (request.headers.get('accept') || '').includes('text/html');

  if (await box.isAwake()) {
    try {
      const r = await proxy();
      if (r.status === 101 || r.status < 500) return r;
    } catch (e) { log('proxy', 'failed', { agentId, sub, err: String(e) }); }
  }
  if (!isDoc) return new Response('starting', { status: 503, headers: { 'retry-after': '2' } });
  const booting = wake(env, agentId, apiBase);
  ctx.waitUntil(booting.then((b) => log('proxy', 'boot', { agentId, ...b })).catch((e) => log('proxy', 'boot_failed', { agentId, err: String(e) })));
  const done = await Promise.race([booting, new Promise<null>((r) => setTimeout(() => r(null), INLINE_BOOT_MS))]);
  if (done?.ok) {
    const r = await proxy();
    if (r.status < 500) return r;
  }
  return startingPage(agentId, done && !done.ok ? done.error : undefined);
}
