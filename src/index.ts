// forq Worker: auth, API, agent proxy, and (for now) a bare project page.
//
// Auth: forq.kapps.dev sits behind Cloudflare Access (JWT verified here too);
// workers.dev answers only with x-forq-secret = ADMIN_SECRET (laptop scripts).

import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env } from './env';
import { AgentBox, log, type BootSpec } from './box';
import { Project, type Agent } from './project';
import { projectPage, startingPage } from './pages';

export { AgentBox, Project };

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

async function authed(request: Request, env: Env): Promise<{ ok: boolean; admin: boolean; email?: string }> {
  const url = new URL(request.url);
  if (url.hostname.endsWith('.workers.dev')) {
    const ok = !!env.ADMIN_SECRET && request.headers.get('x-forq-secret') === env.ADMIN_SECRET;
    return { ok, admin: ok };
  }
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return { ok: false, admin: false };
  try {
    jwks ||= createRemoteJWKSet(new URL(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`));
    const { payload } = await jwtVerify(token, jwks, { issuer: `https://${env.ACCESS_TEAM_DOMAIN}`, audience: env.ACCESS_AUD });
    return { ok: true, admin: false, email: String(payload.email || '') };
  } catch (e) {
    log('auth', 'jwt_rejected', { err: String(e) });
    return { ok: false, admin: false };
  }
}

const json = (data: unknown, status = 200) => Response.json(data, { status });
const projectStub = (env: Env, name: string) => env.Project.get(env.Project.idFromName(name));
const boxStub = (env: Env, agentId: string) => env.AgentBox.get(env.AgentBox.idFromName(agentId));
const projectOf = (agentId: string) => agentId.split('--')[0];
const INLINE_BOOT_MS = 12_000;

async function bootSpec(env: Env, agentId: string): Promise<BootSpec> {
  const { agent, token } = await projectStub(env, projectOf(agentId)).forkToken(agentId);
  const cc = env.CLAUDE_CODE_OAUTH_TOKEN;
  return {
    agentId, task: agent.task, remote: agent.remote, gitToken: token,
    bootEnv: [
      `SBX_NAME=${JSON.stringify(agentId)}`,
      'AGENT=claude',
      `CC_ENV=${JSON.stringify(`CLAUDE_CODE_OAUTH_TOKEN=${cc}`)}`,
      `CC_KEY_TAIL=${JSON.stringify(cc.slice(-20))}`,
      'BILLING=sub',
      '',
    ].join('\n'),
  };
}

/** Boot an agent's box unless too many boxes in its project are awake. */
async function wake(env: Env, agentId: string) {
  const info = await projectStub(env, projectOf(agentId)).info();
  const max = Number(env.MAX_AWAKE_BOXES || 5);
  if (info) {
    const awake = await Promise.all(info.agents.filter((a) => a.id !== agentId).map((a) => boxStub(env, a.id).isAwake().catch(() => false)));
    if (awake.filter(Boolean).length >= max) return { ok: false, ms: 0, from: 'none', error: `${max} boxes already awake` };
  }
  return boxStub(env, agentId).ensureUp(await bootSpec(env, agentId));
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const auth = await authed(request, env);
    if (!auth.ok) return json({ error: 'unauthorized' }, 401);
    const path = url.pathname;
    try {
      // ---- pages
      if (path === '/') return Response.redirect(`${url.origin}/p/sleepsounds`, 302);
      let m = path.match(/^\/p\/([a-z0-9-]+)\/?$/);
      if (m) {
        const p = projectStub(env, m[1]);
        const info = await p.info();
        if (!info) return new Response('no such project', { status: 404 });
        const status = await agentStatuses(env, info.agents);
        return new Response(projectPage(info, status), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
      }

      // ---- agent proxy: /a/<agentId>/agent/* → the box's mobile-agent
      m = path.match(/^\/a\/([a-z0-9-]+--[a-z0-9]+)(\/.*)?$/);
      if (m) return agentProxy(request, env, ctx, m[1], m[2] || '/', url);

      // ---- API
      if (path === '/api/projects' && request.method === 'POST') {
        if (!auth.admin) return json({ error: 'admin only' }, 403);
        const b = await request.json() as { name: string; description?: string };
        const r = await projectStub(env, b.name).create(b.name, b.description || '');
        return json(r);
      }
      m = path.match(/^\/api\/projects\/([a-z0-9-]+)(\/[a-z-]+)?$/);
      if (m) {
        const p = projectStub(env, m[1]);
        const verb = m[2] || '';
        if (verb === '' && request.method === 'GET') {
          const info = await p.info();
          if (!info) return json({ error: 'no such project' }, 404);
          return json({ ...info, status: await agentStatuses(env, info.agents) });
        }
        if (verb === '/commits') return json(await p.commits());
        if (verb === '/main-token' && request.method === 'POST') {
          if (!auth.admin) return json({ error: 'admin only' }, 403);
          return json(await p.mainToken());
        }
        if (verb === '/agents' && request.method === 'POST') {
          const b = await request.json() as { task?: string };
          const task = String(b.task || '').trim();
          if (!task || task.length > 4000) return json({ error: 'task required (max 4000 chars)' }, 400);
          const agent = await p.addAgent(task);
          ctx.waitUntil(wake(env, agent.id).then((r) => log('api', 'agent_boot', { id: agent.id, ...r })).catch((e) => log('api', 'agent_boot_failed', { id: agent.id, err: String(e), stack: e?.stack })));
          return json(agent);
        }
      }
      m = path.match(/^\/api\/agents\/([a-z0-9-]+--[a-z0-9]+)\/([a-z]+)$/);
      if (m) {
        const [, id, verb] = m;
        const box = boxStub(env, id);
        if (verb === 'state') return json({ ...(await box.state()), cc: await box.ccStatus() });
        if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
        if (verb === 'wake') return json(await wake(env, id));
        if (verb === 'stop') { await box.letGo('manual'); return json(await box.state()); }
        if (verb === 'send') {
          const { text } = await request.json() as { text?: string };
          if (!text) return json({ error: 'text required' }, 400);
          return json(await box.send(text));
        }
        if (verb === 'exec' && auth.admin) return json(await box.adminExec(await request.text()));
        // Throw the box away (container, snapshot, task-sent flag) and boot it
        // fresh; the fork keeps whatever was pushed.
        if (verb === 'reset' && auth.admin) { await box.destroy(); return json(await wake(env, id)); }
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      log('api', 'error', { path, err: String(e), stack: (e as Error)?.stack });
      return json({ error: String((e as Error)?.message || e) }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function agentStatuses(env: Env, agents: Agent[]) {
  const out: Record<string, { awake: boolean; cc: string }> = {};
  await Promise.all(agents.map(async (a) => {
    const box = boxStub(env, a.id);
    const awake = await box.isAwake().catch(() => false);
    out[a.id] = { awake, cc: awake ? await box.ccStatus().catch(() => 'unknown') : 'asleep' };
  }));
  return out;
}

async function agentProxy(request: Request, env: Env, ctx: ExecutionContext, agentId: string, rest: string, url: URL) {
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
  const booting = wake(env, agentId);
  ctx.waitUntil(booting.then((b) => log('proxy', 'boot', { agentId, ...b })).catch((e) => log('proxy', 'boot_failed', { agentId, err: String(e) })));
  const done = await Promise.race([booting, new Promise<null>((r) => setTimeout(() => r(null), INLINE_BOOT_MS))]);
  if (done?.ok) {
    const r = await proxy();
    if (r.status < 500) return r;
  }
  return startingPage(agentId, done && !done.ok ? done.error : undefined);
}
