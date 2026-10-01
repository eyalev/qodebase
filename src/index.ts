// forq Worker.
//
// Hosts:
//   forq.kapps.dev      UI + API, behind Cloudflare Access (JWT verified here too)
//   forq-run.kapps.dev  public run host: any repo/fork as a live static app (run.ts)
//   *.workers.dev       admin (x-forq-secret) and the boxes' forq CLI (x-forq-agent)

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AGENT_RE, NAME_RE, projectOf, slugOf, type Env } from './env';
import { AgentBox, log, type BootSpec } from './box';
import { Project, roleOf, type ProjectInfo, type Role } from './project';
import { Registry, registry } from './registry';
import { BuildBox } from './build';
import { serveRun } from './run';
import { agentsHtml, buildLogPage, explorePage, projectPage, type BoxStatus } from './ui';
import { previewTabs } from './sheet';
import { MAX_IMPORT_KB, getRepo, nameFor, parseRepoRef, searchRepos } from './github';
import { importPage } from './ui';
import { allFiles, blob, diffTrees, forkBase, head, resolvePath, tree } from './code';
import { changesPage, dirPage, filePage, type ChangeText } from './codeui';
import { startingPage } from './pages';
// mobile-agent, newer than the image's copy: boxes unpack it at boot (box.ts).
import MA_TGZ from '../box/mobile-agent.tgz';
import MA_REV from '../box/mobile-agent.rev';

export { AgentBox, Project, Registry, BuildBox };

type Who = { kind: 'user'; handle: string; admin: boolean } | { kind: 'agent'; agentId: string; role: Role };
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
      if (i > 0 && AGENT_RE.test(id) && at.slice(i + 1) === await hmac(env, id)) return { kind: 'agent', agentId: id, role: roleOf(id) };
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
    agentId, task: r.task, role: r.role, project: slug.replace('.', '/'), remote: r.remote, gitToken: r.token,
    agentToken: await agentToken(env, agentId), apiBase, maRev: MA_REV.trim(),
    bootEnv: [
      `SBX_NAME=${JSON.stringify(r.role === 'agent' ? agentId : `${slug.replace('.', '/')} ${r.role}`)}`,
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
  const others = [...info.agents.map((a) => a.id), `${info.slug}--router`, `${info.slug}--review`].filter((id) => id !== agentId);
  const awake = await Promise.all(others.map((id) => boxStub(env, id).isAwake().catch(() => false)));
  if (awake.filter(Boolean).length >= max) return { ok: false, ms: 0, from: 'none', error: `${max} boxes already awake in this project` };
  return boxStub(env, agentId).ensureUp(await bootSpec(env, agentId, apiBase));
}

async function boxStatus(env: Env, id: string, withReply = false): Promise<BoxStatus> {
  const box = boxStub(env, id);
  const ph = await box.phase().catch(() => ({ awake: false, booting: false, taskSent: false }));
  if (!ph.awake) return { ...ph, cc: 'asleep' };
  const [cc, said] = await Promise.all([box.ccStatus().catch(() => 'unknown'), withReply ? box.lastReply().catch(() => undefined) : undefined]);
  return { ...ph, cc, said };
}

async function renderAgents(env: Env, info: ProjectInfo, runBase: string) {
  const status: Record<string, BoxStatus> = {};
  const open = info.agents.filter((a) => a.state !== 'merged' && a.state !== 'stopped');
  await Promise.all(open.map(async (a) => { status[a.id] = await boxStatus(env, a.id); }));
  const [router, reviewer] = await Promise.all([boxStatus(env, `${info.slug}--router`, true), boxStatus(env, `${info.slug}--review`)]);
  return agentsHtml(info, runBase, router, status, reviewer);
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
      if (path === '/import') return html(importPage(me.handle));
      // ---- GitHub: search, look up one repo, import it
      if (path === '/api/github/search') {
        const q = url.searchParams.get('q') || '';
        const ref = parseRepoRef(q);
        if (ref) { const r = await getRepo(ref, ctx); return 'error' in r ? json(r, r.status) : json({ repos: [r], exact: true }); }
        if (q.trim().length < 2) return json({ repos: [] });
        const r = await searchRepos(q, ctx);
        return Array.isArray(r) ? json({ repos: r }) : json(r, r.status);
      }
      if (path === '/api/import' && request.method === 'POST') {
        const b = await request.json() as { repo?: string; as?: string };
        const ref = parseRepoRef(String(b.repo || ''));
        if (!ref) return json({ error: 'give a GitHub URL or owner/repo' }, 400);
        const gh = await getRepo(ref, ctx);
        if ('error' in gh) return json(gh, gh.status);
        if (gh.private) return json({ error: 'private repos cannot be imported' }, 400);
        if (gh.sizeKb > MAX_IMPORT_KB) return json({ error: `${gh.fullName} is ${Math.round(gh.sizeKb / 1024)} MB; forq imports up to ${MAX_IMPORT_KB / 1024} MB` }, 400);
        // Admin may import on behalf of another handle (the forq showcase account).
        const owner = me.admin && b.as ? b.as : me.handle;
        let name = nameFor(gh.name);
        for (let i = 2; await registry(env).get(slugOf(owner, name)); i++) name = `${nameFor(gh.name).slice(0, 35)}-${i}`;
        const info = await projectStub(env, slugOf(owner, name)).createImported(owner, name,
          { url: `https://github.com/${gh.fullName}`, fullName: gh.fullName, stars: gh.stars, license: gh.license, branch: gh.branch }, gh.description);
        return json({ ...info, path: `/p/${owner}/${name}` });
      }
      if ((m = path.match(/^\/p\/([a-z0-9-]+)\/([a-z0-9-]+)\/build-log$/))) {
        const info = await projectStub(env, slugOf(m[1], m[2])).info();
        if (!info) return new Response('No such project', { status: 404 });
        const ag = url.searchParams.get('agent');
        const a = ag ? info.agents.find((x) => x.id.split('--')[1] === ag) : undefined;
        return html(buildLogPage(info, a ? `Preview of agent ${ag}` : 'Live app (main)', a ? a.preview : info.app));
      }
      // ---- code browser: /p/<o>/<n>/code/<path>[?v=<agent>], changes, file list
      if ((m = path.match(/^\/p\/([a-z0-9-]+)\/([a-z0-9-]+)\/(code|changes)(?:\/(.*))?$/))) {
        const info = await projectStub(env, slugOf(m[1], m[2])).info();
        if (!info) return new Response('No such project', { status: 404 });
        if (m[3] === 'changes') return changesRoute(env, ctx, info, decodeURIComponent(m[4] || ''), runBase);
        return codeRoute(env, ctx, info, url.searchParams.get('v') || '', decodeURIComponent(m[4] || ''), runBase);
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
        // Reading code is open to anyone who can see the project; acting on it is owner-only (below).
        if (verb === 'files') {
          const repo = versionRepo(info, url.searchParams.get('v') || '');
          if (!repo) return json({ error: 'unknown version' }, 404);
          const rev = await head(env, ctx, repo);
          if (!rev) return json({ files: [] });
          const r = await allFiles(env, ctx, repo, rev.tree);
          return json({ files: r.files.map((f) => f.path), truncated: r.truncated });
        }
        if (verb === 'search') {
          const repo = versionRepo(info, url.searchParams.get('v') || '');
          if (!repo) return json({ error: 'unknown version' }, 404);
          const rev = await head(env, ctx, repo);
          if (!rev) return json({ results: [] });
          return json(await p.searchCode(repo, rev.tree, (url.searchParams.get('q') || '').slice(0, 200)));
        }
        if (info.owner !== me.handle && !me.admin) return json({ error: 'not your project' }, 403);
        if (verb === 'main-token' && request.method === 'POST' && me.admin) return json(await p.mainToken());
        if (verb === 'entry' && request.method === 'POST') {
          const b = await request.json() as { entry?: string | null };
          await p.setEntry(b.entry === null ? null : String(b.entry ?? ''));
          return json({ ok: true, entry: (await p.info())?.entry });
        }
        if (verb === 'touch' && request.method === 'POST' && me.admin) { await registry(env).touch(slug); return json({ ok: true }); }
        if (verb === 'agents-html') {
          // Opportunistic: a review stuck in 'reviewing' (its box died) goes back to the queue.
          ctx.waitUntil(startReview(env, p, slug, apiBase, () => p.requeueStale()));
        }
        if (verb === 'agents-html') return json({ html: await renderAgents(env, info, runBase), tabs: previewTabs(info, runBase) });
        if (verb === 'agents' && request.method === 'POST') {
          const b = await request.json() as { task?: string };
          return json(await spawn(env, ctx, slug, String(b.task || ''), apiBase));
        }
        if (verb === 'router' && request.method === 'POST') {
          const b = await request.json() as { text?: string };
          const text = String(b.text || '').trim();
          if (!text || text.length > 8000) return json({ error: 'say something (max 8000 chars)' }, 400);
          return json(await askRouter(env, ctx, p, slug, text, apiBase));
        }
        if (verb === 'deploy' && request.method === 'POST') {
          const b = await request.json().catch(() => ({})) as { agent?: string };
          await p.requestBuild(b.agent ? 'preview' : 'deploy', b.agent);
          return json({ ok: true });
        }
        if (verb === 'build-state' && me.admin) return json(await env.BuildBox.get(env.BuildBox.idFromName(`${slug}--build`)).state());
        if (verb === 'review' && request.method === 'POST') {
          const b = await request.json() as { agent?: string };
          if (!info.agents.some((x) => x.id === b.agent)) return json({ error: 'unknown agent' }, 404);
          ctx.waitUntil(startReview(env, p, slug, apiBase, () => p.queueReview(b.agent!)));
          return json({ ok: true });
        }
        if (verb === 'fix' && request.method === 'POST') {
          const b = await request.json() as { agent?: string };
          const a = info.agents.find((x) => x.id === b.agent);
          if (!a?.review?.notes) return json({ error: 'no review notes for that agent' }, 400);
          const r = await sendTo(env, a.id, `The reviewer asked for changes:\n\n${a.review.notes}\n\nFix them, commit, push with \`git push origin HEAD\`, then run \`forq status pushed "<what you changed>"\`.`, apiBase);
          if (r.ok) { await p.markReviewSent(a.id); await p.setState(a.id, 'working'); }
          return json(r, r.ok ? 200 : 502);
        }
        if (verb === 'merge' && request.method === 'POST') {
          const b = await request.json() as { agent?: string };
          const a = info.agents.find((x) => x.id === b.agent);
          if (!a) return json({ error: 'unknown agent' }, 404);
          return json(await askRouter(env, ctx, p, slug, `Merge agent ${a.id} into the project's main line: run \`forq merge ${a.id}\` and tell me the result in one line.`, apiBase, `Merge ${a.id.split('--')[1]}`));
        }
      }

      // ---- per-box ops: /api/agents/<id>/<verb>
      if ((m = path.match(/^\/api\/agents\/([a-z0-9.-]+--[a-z0-9]+)\/([a-z]+)$/))) {
        const [, id, verb] = m;
        const info = await projectStub(env, projectOf(id)).info();
        if (!info || (info.owner !== me.handle && !me.admin)) return json({ error: 'not your project' }, 403);
        const box = boxStub(env, id);
        if (verb === 'state') return json({ ...(await box.state()), ...(await boxStatus(env, id, true)) });
        // The Chat tab: the box's Claude Code transcript as messages. Never wakes a box.
        if (verb === 'conversation') {
          if (!(await box.isAwake())) return json({ asleep: true });
          ctx.waitUntil(box.touch(id).catch(() => {}));
          const [conv, cc] = await Promise.all([
            box.fetch(new Request('https://container/api/conversation?session=claude&tail=200', { headers: { 'x-forq-port': '7681' } })),
            box.ccStatus().catch(() => 'unknown'),
          ]);
          if (conv.status === 404) return json({ messages: [], status: cc });
          if (!conv.ok) return json({ error: `conversation ${conv.status}` }, 502);
          const j = await conv.json() as { messages: unknown[] };
          return json({ messages: j.messages, status: cc });
        }
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

/** The repo behind a version: '' = main, else an agent's short id → its fork. */
function versionRepo(info: ProjectInfo, v: string): string | null {
  if (!v) return info.repo;
  const a = info.agents.find((x) => x.id.split('--')[1] === v);
  return a ? a.fork : null;
}

async function codeRoute(env: Env, ctx: ExecutionContext, info: ProjectInfo, v: string, path: string, runBase: string) {
  const repo = versionRepo(info, v);
  if (!repo) return new Response('No such version', { status: 404 });
  const rev = await head(env, ctx, repo).catch(() => null);
  if (!rev) return html(dirPage({ info, v, path: '', entries: [], readme: null, rev: null }));
  const clean = path.replace(/^\/+/, '');
  const e = await resolvePath(env, ctx, repo, rev.tree, clean);
  if (!e) return new Response(`${clean} is not in this version`, { status: 404 });
  if (e.type === 'tree') {
    const dir = clean && !clean.endsWith('/') ? clean + '/' : clean;
    const entries = await tree(env, ctx, repo, e.hash);
    const rd = entries.find((x) => x.type === 'blob' && /^readme(\.md|\.markdown)?$/i.test(x.name));
    const readme = rd ? (await blob(env, ctx, repo, rd.hash, rd.name)).text : null;
    return html(dirPage({ info, v, path: dir, entries, readme, rev }));
  }
  const file = await blob(env, ctx, repo, e.hash, clean);
  return html(filePage({ info, v, path: clean, file, rev, runUrl: `${runBase}/${repo}/${clean}` }));
}

async function changesRoute(env: Env, ctx: ExecutionContext, info: ProjectInfo, short: string, runBase: string) {
  const agent = info.agents.find((a) => a.id.split('--')[1] === short.replace(/\/$/, ''));
  if (!agent) return new Response('No such agent', { status: 404 });
  const base = agent.base || await forkBase(env, info.repo, agent.fork, agent.createdAt);
  const tip = await head(env, ctx, agent.fork);
  if (!base || !tip) return new Response('Could not find where this fork started', { status: 500 });
  const changes = await diffTrees(env, ctx, info.repo, base.tree, agent.fork, tip.tree);
  const CAP = 60;
  const withText: ChangeText[] = await Promise.all(changes.slice(0, CAP).map(async (c) => {
    const [a, b] = await Promise.all([
      c.oldHash ? blob(env, ctx, info.repo, c.oldHash, c.path) : null,
      c.newHash ? blob(env, ctx, agent.fork, c.newHash, c.path) : null,
    ]);
    const odd = (x: typeof a) => x && (x.binary || x.tooBig);
    return { ...c, oldText: a?.text ?? null, newText: b?.text ?? null,
      note: odd(a) || odd(b) ? `${(a || b)!.binary ? 'Binary' : 'Large'} file, ${c.status}; not shown` : undefined };
  }));
  log('code', 'changes', { agent: agent.id, files: changes.length, base: base.commit.slice(0, 8), tip: tip.commit.slice(0, 8) });
  return html(changesPage({ info, agent, changes: withText,
    baseNote: `Compared with main at ${base.commit.slice(0, 7)}, when it started${changes.length > CAP ? `; first ${CAP} of ${changes.length} files` : ''}`,
    previewUrl: `${runBase}/${agent.fork}/${info.entry || ''}` }));
}

const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

/** Hand text to the router agent. Recorded first and answered at once; waking
 *  (6-20 s) and delivery happen in the background, and the page shows each
 *  phase from the project's lastRequest. */
async function askRouter(env: Env, ctx: ExecutionContext, p: DurableObjectStub<Project>, slug: string, text: string, apiBase: string, shown = text) {
  const at = Date.now();
  // `shown` is what the page quotes as "You": the person's words, not forq's instruction to the router.
  await p.setRequest({ text: shown, at, state: 'waking', sentAt: undefined, error: undefined });
  ctx.waitUntil(sendTo(env, `${slug}--router`, text, apiBase)
    .then((r) => {
      log('api', 'router_send', { slug, ok: r.ok, chars: text.length, ms: Date.now() - at, err: r.error });
      return p.setRequest(r.ok ? { state: 'sent', sentAt: Date.now() } : { state: 'failed', error: r.error });
    })
    .catch((e) => {
      log('api', 'router_send_failed', { slug, err: String(e), stack: e?.stack });
      return p.setRequest({ state: 'failed', error: String(e?.message || e) });
    }));
  return { ok: true, at };
}

/** Run a review-queue step (queue, verdict, …) and hand the reviewer the agent
 *  it returns, if any. One review at a time per project. */
async function startReview(env: Env, p: DurableObjectStub<Project>, slug: string, apiBase: string, step: () => Promise<string | null>) {
  try {
    const next = await step();
    if (!next) return;
    const text = `Review agent ${next}: run \`forq fetch-agent ${next}\`, then follow your review steps and finish with \`forq verdict ${next} approve|changes "..."\`.`;
    const r = await sendTo(env, `${slug}--review`, text, apiBase);
    log('review', 'dispatched', { slug, agent: next, ok: r.ok, err: r.error });
    if (!r.ok) await p.setVerdict(next, 'changes', `The reviewer could not start: ${r.error}. Review it yourself, or push again to retry.`);
  } catch (e) {
    log('review', 'failed', { slug, err: String(e), stack: (e as Error)?.stack });
  }
}

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
  if (verb === 'mobile-agent.tgz') {
    return new Response(MA_TGZ, { headers: { 'content-type': 'application/gzip', 'x-forq-ma-rev': MA_REV.trim() } });
  }
  log('agent_api', verb, { agentId: me.agentId });
  if (verb === 'list') {
    const info = await p.info();
    return json({ agents: (info?.agents || []).map(({ id, task, state, note }) => ({ id, task, state, note })) });
  }
  if (verb === 'status' && me.role === 'agent') {
    if (!['working', 'pushed', 'blocked'].includes(body.state)) return json({ error: 'state: working|pushed|blocked' }, 400);
    await p.setState(me.agentId, body.state as 'working', String(body.note || ''));
    // Every push gets a review before the person merges.
    if (body.state === 'pushed') {
      // Worker projects: build the fork as a Preview first; buildDone starts the review.
      if ((await p.kindOf()) === 'worker') ctx.waitUntil(p.requestBuild('preview', me.agentId).catch((e) => log('build', 'request_failed', { err: String(e) })));
      else ctx.waitUntil(startReview(env, p, slug, apiBase, () => p.queueReview(me.agentId)));
    }
    return json({ ok: true });
  }
  if (me.role === 'reviewer') {
    if (verb === 'review-info') {
      const agent = url.searchParams.get('agent') || '';
      if (projectOf(agent) !== slug) return json({ error: 'not an agent of this project' }, 400);
      const r = await p.reviewInfo(agent);
      return json({ ...r, preview: r.previewUrl || `https://${env.RUN_HOST}/${agent}/${r.entry}` });
    }
    if (verb === 'verdict') {
      if (projectOf(body.agent || '') !== slug) return json({ error: 'not an agent of this project' }, 400);
      if (!['approve', 'changes'].includes(body.verdict)) return json({ error: 'verdict: approve|changes' }, 400);
      ctx.waitUntil(startReview(env, p, slug, apiBase, () => p.setVerdict(body.agent, body.verdict === 'approve' ? 'approved' : 'changes', String(body.notes || ''))));
      return json({ ok: true });
    }
    return json({ error: 'the reviewer can fetch-agent and verdict' }, 403);
  }
  if (me.role !== 'router') return json({ error: 'only the router agent can do that' }, 403);
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
    if ((await p.kindOf()) === 'worker') ctx.waitUntil(p.requestBuild('deploy').catch((e) => log('build', 'request_failed', { err: String(e) })));
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
