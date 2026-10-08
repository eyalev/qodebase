// forq Worker.
//
// Hosts:
//   UI_HOST (forq.kapps.dev)  UI + API; public read, sign-in via /login (Access)
//   forq-run.kapps.dev  public run host: any repo/fork as a live static app (run.ts)
//   *.workers.dev       admin (x-forq-secret) and the boxes' forq CLI (x-forq-agent)

import { withBaseline, kstatsForward, feedback, health } from './baseline';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AGENT_RE, NAME_RE, appWorkerName, frontHosts, isUiHost, projectOf, slugOf, type Env } from './env';
import { AgentBox, log, REVIEW_STEPS, type BootSpec } from './box';
import { Project, roleOf, type ProjectInfo, type Role } from './project';
import { Registry, canSee, listFor, registry, type Entry } from './registry';
import { BuildBox } from './build';
import { mintRunPass, serveRun } from './run';
import { aboutPage, agentsHtml, buildLogPage, explorePage, privacyPage, projectPage, settingsPage, type BoxStatus } from './ui';
import { previewTabs } from './sheet';
import { catalogReadme } from './catalog';
import { STARTER, buildPayload } from './newproject';
import { buildV3, catalogV3, docLabel, docRank, fixtureV3, homeV3, liveV3, needsOf, projectV3, withGlobal, withTabs, VIEW_IDS, type Docs, type Global, type InboxItem, type Nav, type ViewId } from './v3';
import { changesOf, runUrl } from './v2';
import { fixtureV2, homeV2, liveV2, projectV2, uiOf, type HomeStatus, type UI } from './v2';
import { MAX_IMPORT_KB, getRepo, nameFor, parseRepoRef, searchRepos } from './github';
import { DEFAULT_API_MODEL, isClaudeToken, onSubscription, checkApiKey, handoffEmail, handoffToken, claimHandle, clearCookie, decryptKey, encryptKey, isOwner, sessionCookie, sessionEmail, suggestHandle, userByEmail, userByHandle } from './auth';
import { importPage } from './ui';
import { allFiles, blob, diffTrees, forkBase, head, resolvePath, tree } from './code';
import { changesPage, dirPage, filePage, type ChangeText } from './codeui';
import { startingPage } from './pages';
import { personalAgentsPage } from './personal';
import { ownPage } from './own';
import { withLook } from './look';
import { Installs, installRoute } from './install';
import { TalkLog, talkRoute } from './talk';
import { TalkVoice } from './talkvoice';
import { Ledger, costSummary, costsPage } from './costs';
import { bearerEmail, cliPublicRoute, cliUserRoute } from './cliauth';
// mobile-agent, newer than the image's copy: boxes unpack it at boot (box.ts).
import MA_TGZ from '../box/mobile-agent.tgz';
import MA_REV from '../box/mobile-agent.rev';

export { AgentBox, Project, Registry, BuildBox, Installs, TalkLog, Ledger, TalkVoice };
import { landingRoute } from './landing/routes';
import * as landingHooks from './landing/hooks';
import { landingOn } from './landing/hooks';
export { Landing } from './landing/landing';
export { MergeBox } from './landing/merger';
export { DemoAgent } from './landing/demo';

type Who = { kind: 'user'; handle: string; admin: boolean; anon?: boolean; email?: string } | { kind: 'agent'; agentId: string; role: Role };
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
  // workers.dev = the API for boxes and the laptop, unless it is this site's own host
  // (a self-hosted copy lives on workers.dev).
  if (url.hostname.endsWith('.workers.dev') && !isUiHost(env, url.hostname)) {
    const at = request.headers.get('x-forq-agent');
    if (at) {
      const i = at.lastIndexOf('.');
      const id = at.slice(0, i);
      if (i > 0 && AGENT_RE.test(id) && at.slice(i + 1) === await hmac(env, id)) return { kind: 'agent', agentId: id, role: roleOf(id) };
      return null;
    }
    if (env.ADMIN_SECRET && request.headers.get('x-forq-secret') === env.ADMIN_SECRET) {
      // Admin acting as a real user (tests, demo recordings): that user's rights, not admin's.
      const asEmail = request.headers.get('x-forq-as-email');
      if (asEmail) {
        let u = await userByEmail(env, asEmail.toLowerCase());
        if (!u && request.headers.get('x-forq-create-handle')) u = (await claimHandle(env, asEmail.toLowerCase(), request.headers.get('x-forq-create-handle')!)).user || null;
        return u ? { kind: 'user', handle: u.handle, admin: false, email: u.email } : null;
      }
      return { kind: 'user', handle: request.headers.get('x-forq-as') || 'eyal', admin: true };
    }
    return null;
  }
  // The qb CLI: a bearer token (src/cliauth.ts). A bad one is refused, never anonymous.
  const bearer = await bearerEmail(env, request);
  if (bearer === null) return null;
  if (bearer) {
    const u = await userByEmail(env, bearer);
    return u ? { kind: 'user', handle: u.handle, admin: false, email: u.email } : null;
  }
  // Public site: a forq session cookie (set by /login). No session = anonymous
  // reader (handle '' owns nothing, so every ownership check fails by itself).
  const email = (await sessionEmail(env, request)) || (await accessEmail(request, env));
  if (email) {
    let u = await userByEmail(env, email);
    // A self-hosted copy sits wholly behind Access: its owner's first visit makes the account.
    if (!u && env.SELF_HOST) {
      const mapped = (JSON.parse(env.HANDLES || '{}') as Record<string, string>)[email];
      u = (await claimHandle(env, email, mapped || await suggestHandle(env, email))).user || null;
    }
    if (u) return { kind: 'user', handle: u.handle, admin: false, email: u.email };
  }
  return { kind: 'user', handle: '', admin: false, anon: true };
}

/** The email in a valid Cloudflare Access JWT (only /login is behind Access). */
async function accessEmail(request: Request, env: Env): Promise<string | null> {
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return null;
  try {
    jwks ||= createRemoteJWKSet(new URL(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`));
    const { payload } = await jwtVerify(token, jwks, { issuer: `https://${env.ACCESS_TEAM_DOMAIN}`, audience: env.ACCESS_AUD });
    return String(payload.email || '').toLowerCase() || null;
  } catch (e) {
    log('auth', 'jwt_rejected', { err: String(e) });
    return null;
  }
}

/** Hosts of the design-variant preview Workers, which forward here with x-forq-host. */
const variantHosts = (env: Env) => (env.UI_VARIANT_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);

const safeNext = (n: string | null) => (n && /^\/[^/\\]/.test(n) ? n : null);

/** /login (behind Access): find or create the user, set the session, go on. */
async function loginRoute(request: Request, env: Env, url: URL): Promise<Response> {
  const email = await accessEmail(request, env);
  if (!email) return new Response('Sign-in did not complete. Try again from the qodebase home page.', { status: 401 });
  let user = await userByEmail(env, email);
  let fresh = false;
  if (!user) {
    const mapped = (JSON.parse(env.HANDLES || '{}') as Record<string, string>)[email];
    const r = await claimHandle(env, email, mapped || await suggestHandle(env, email));
    if (!r.ok || !r.user) return new Response(`Could not create your account: ${r.error}`, { status: 500 });
    user = r.user; fresh = true;
  }
  const next = safeNext(url.searchParams.get('next')) || (fresh ? '/settings?welcome=1' : '/');
  // Signing in for a design-variant host (variants/): hand the session over
  // with a short-lived token; its cookie is set on that host by /session.
  const to = url.searchParams.get('to');
  if (to && (variantHosts(env).includes(to) || frontHosts(env).includes(to))) {
    log('auth', 'handoff', { handle: user.handle, to });
    return new Response(null, { status: 302, headers: { location: `https://${to}/session?t=${encodeURIComponent(await handoffToken(env, email, to))}&next=${encodeURIComponent(next)}`, 'cache-control': 'no-store' } });
  }
  log('auth', 'login', { handle: user.handle, fresh });
  return new Response(null, { status: 302, headers: { location: next, 'set-cookie': await sessionCookie(env, email), 'cache-control': 'no-store' } });
}

async function bootSpec(env: Env, agentId: string, apiBase: string): Promise<BootSpec> {
  const slug = projectOf(agentId);
  const r = await projectStub(env, slug).boxRepo(agentId);
  // Whose Claude: the owner of this instance runs on the subscription; any
  // other project owner's boxes run on that person's own API key.
  const owner = slug.split('.')[0];
  let ccEnv: string, keyTail: string, billing: string;
  if (onSubscription(env, owner)) {
    ccEnv = `CLAUDE_CODE_OAUTH_TOKEN=${env.CLAUDE_CODE_OAUTH_TOKEN}`; keyTail = env.CLAUDE_CODE_OAUTH_TOKEN.slice(-20); billing = 'sub';
    // A landing project can pin its boxes' model (landing flags.agentModel, e.g. Sonnet for a test).
    const pinfo = await projectStub(env, slug).info();
    const lm = landingOn(pinfo) ? (await env.Landing.get(env.Landing.idFromName(slug)).flags().catch(() => null))?.agentModel : undefined;
    if (lm) ccEnv += ` ANTHROPIC_MODEL=${lm}`;
  } else {
    const u = await userByHandle(env, owner);
    if (!u?.apiKeyEnc) throw new Error(`${owner} has not added an Anthropic API key yet (Settings)`);
    const key = await decryptKey(env, u.apiKeyEnc);
    if (isClaudeToken(key)) { ccEnv = `CLAUDE_CODE_OAUTH_TOKEN=${key}`; keyTail = key.slice(-20); billing = 'sub'; }
    else { ccEnv = `ANTHROPIC_API_KEY=${key} ANTHROPIC_MODEL=${u.model || DEFAULT_API_MODEL}`; keyTail = key.slice(-20); billing = 'api'; }
  }
  return {
    agentId, task: r.task, role: r.role, project: slug.replace('.', '/'), remote: r.remote, gitToken: r.token,
    agentToken: await agentToken(env, agentId), apiBase, uiHost: env.UI_HOST, maRev: MA_REV.trim(),
    billing: billing === 'sub' ? 'sub' : 'api',
    // Hosted qodebase pays for other people's boxes; its owner and a self-hosted copy pay their own.
    costCovered: !env.SELF_HOST && !isOwner(env, owner),
    bootEnv: [
      `SBX_NAME=${JSON.stringify(r.role === 'agent' ? agentId : `${slug.replace('.', '/')} ${r.role}`)}`,
      'AGENT=claude',
      `CC_ENV=${JSON.stringify(ccEnv)}`,
      `CC_KEY_TAIL=${JSON.stringify(keyTail)}`,
      `BILLING=${billing}`,
      '',
    ].join('\n'),
  };
}

/** Boot a box. The caps count change agents only: a project's router and reviewer
 *  (one each) always start, because nothing gets planned or checked without them.
 *  (2026-10-03: a Build split into 4 agents filled the old cap of 5 with the router,
 *  and all 4 reviews failed with "5 boxes already awake".) */
async function wake(env: Env, agentId: string, apiBase: string) {
  const info = await projectStub(env, projectOf(agentId)).info();
  if (!info) throw new Error('no such project');
  const box = boxStub(env, agentId);
  // Already awake: no new container starts, so there is nothing to cap.
  if (await box.isAwake().catch(() => false)) return box.ensureUp(await bootSpec(env, agentId, apiBase));
  const refuse = (why: string, data: Record<string, unknown>, error: string) => {
    log('wake', 'refused', { agentId, why, ...data });
    return { ok: false, ms: 0, from: 'none', error };
  };

  // Every box on the account, awake or not: each project's agents, router and reviewer.
  const entries = await registry(env).list();
  const infos = await Promise.all(entries.map((e) => (e.slug === info.slug ? info : projectStub(env, e.slug).info().catch(() => null))));
  const awake: { id: string; slug: string; owner: string; role: string }[] = [];
  // A landing project's reviewer pool adds --review2, --review3… (src/landing/).
  const pool = (pi: ProjectInfo) => (pi.landing ? [2, 3, 4].map((n) => `${pi.slug}--review${n}`) : []);
  await Promise.all(infos.flatMap((pi) => (pi ? [...pi.agents.map((a) => a.id), `${pi.slug}--router`, `${pi.slug}--review`, ...pool(pi)] : [])
    .filter((id) => id !== agentId)
    .map(async (id) => {
      if (await boxStub(env, id).isAwake().catch(() => false)) awake.push({ id, slug: projectOf(id), owner: id.split('.')[0], role: roleOf(id) });
    })));

  // 1. Account-wide ceiling, every role, owner included: a safety net on what
  //    the containers can bill at once (each awake box bills its full 3 GiB).
  const total = Number(env.MAX_TOTAL_AWAKE || 20);
  if (awake.length >= total) return refuse('account cap', { total, awake: awake.length }, `qodebase is busy: ${total} boxes are awake across all projects. Try again in a few minutes`);

  // 2. Per project: change agents only. A project's router and reviewer always
  //    start (2026-10-03: a Build split into 4 agents filled the old cap of 5
  //    with the router, and all 4 reviews failed with "5 boxes already awake").
  const role = roleOf(agentId);
  const max = (await landingCaps(env, info.slug))?.awake || Number(env.MAX_AWAKE_BOXES || 5);
  if (role === 'agent' && awake.filter((b) => b.slug === info.slug && b.role === 'agent').length >= max) {
    return refuse('project cap', { max }, `${max} agents already awake in this project`);
  }

  // 3. Per person, other people only (their boxes run on this account even with
  //    their own API key): their agents everywhere, plus the router and reviewer
  //    of their OTHER projects. This project's router and reviewer stay exempt,
  //    so nothing here can stop the project being worked on from being checked.
  if (!isOwner(env, info.owner)) {
    const cap = Number(env.OTHERS_MAX_AWAKE || 2);
    const n = awake.filter((b) => b.owner === info.owner && (b.role === 'agent' || b.slug !== info.slug)).length;
    if (n >= cap) return refuse('person cap', { cap, n, role }, `${cap} of your boxes are already awake; they sleep after 5 idle minutes`);
  }
  return box.ensureUp(await bootSpec(env, agentId, apiBase));
}

async function boxStatus(env: Env, id: string, withReply = false): Promise<BoxStatus> {
  const box = boxStub(env, id);
  const ph = await box.phase().catch(() => ({ awake: false, booting: false, taskSent: false }));
  if (!ph.awake) return { ...ph, cc: 'asleep' };
  const [cc, said] = await Promise.all([box.ccStatus().catch(() => 'unknown'), withReply ? box.lastReply().catch(() => undefined) : undefined]);
  return { ...ph, cc, said };
}

/** A project's documents (root text files and docs/*.md, README first) and one of them read. */
async function docsOf(env: Env, ctx: ExecutionContext, info: ProjectInfo, want: string | null): Promise<Docs> {
  const h = await head(env, ctx, info.repo).catch(() => null);
  if (!h) return { list: [], current: null, text: null };
  const root = await tree(env, ctx, info.repo, h.tree);
  const found: { path: string; hash: string; rank: number }[] = [];
  for (const e of root) if (e.type === 'blob') { const r = docRank(e.name); if (r !== null) found.push({ path: e.name, hash: e.hash, rank: r }); }
  const dd = root.find((e) => e.type === 'tree' && /^docs?$/i.test(e.name));
  if (dd) for (const e of (await tree(env, ctx, info.repo, dd.hash)).slice(0, 40)) if (e.type === 'blob') { const p = `${dd.name}/${e.name}`; const r = docRank(p); if (r !== null) found.push({ path: p, hash: e.hash, rank: r }); }
  found.sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path));
  const list = found.slice(0, 16);
  const cur = (want && list.find((d) => d.path === want)) || list.find((d) => d.rank === 0) || null;
  const text = cur ? (await blob(env, ctx, info.repo, cur.hash, cur.path).catch(() => null))?.text ?? null : null;
  return { list: list.map((d) => ({ path: d.path, label: docLabel(d.path) })), current: cur?.path || null, text };
}

/** Which design to render: a preview host's choice (x-forq-ui), else D on the real site. */
const uiFor = (request: Request, env: Env): UI | null => uiOf(request) ?? (isUiHost(env, new URL(request.url).hostname) ? 'd' : null);

/** Your projects with changes in progress (no box calls: states from the Project DO). */
async function inboxOf(env: Env, me: string, entries: Entry[], runBase: string): Promise<InboxItem[]> {
  if (!me) return [];
  const out = await Promise.all(entries.filter((e) => e.owner === me).map(async (entry) => {
    const info = await projectStub(env, entry.slug).info().catch(() => null);
    return info ? { entry, info, open: changesOf(info, {}, runBase).open } : null;
  }));
  return out.filter((x): x is InboxItem => !!x && x.open.length > 0);
}
const inboxCount = (items: InboxItem[]) => items.reduce((n, it) => n + needsOf(it.open).length, 0);

/** Box states for a project's open agents, its router and its reviewer. */
async function statusesOf(env: Env, info: ProjectInfo) {
  const status: Record<string, BoxStatus> = {};
  const open = info.agents.filter((a) => a.state !== 'merged' && a.state !== 'stopped');
  await Promise.all(open.map(async (a) => { status[a.id] = await boxStatus(env, a.id); }));
  const [router, reviewer] = await Promise.all([boxStatus(env, `${info.slug}--router`, true), boxStatus(env, `${info.slug}--review`)]);
  return { status, router, reviewer };
}

async function renderAgents(env: Env, info: ProjectInfo, runBase: string, ui: UI | null = null) {
  const status: Record<string, BoxStatus> = {};
  const open = info.agents.filter((a) => a.state !== 'merged' && a.state !== 'stopped');
  await Promise.all(open.map(async (a) => { status[a.id] = await boxStatus(env, a.id); }));
  const [router, reviewer] = await Promise.all([boxStatus(env, `${info.slug}--router`, true), boxStatus(env, `${info.slug}--review`)]);
  return ui ? liveV2(ui, info, router, status, runBase) : agentsHtml(info, runBase, router, status, reviewer);
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

const app = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // The run host serves apps. A self-hosted copy's run host also carries the boxes'
    // API calls (/api/…: no repo path starts so, repo names have a dot), because its
    // UI host is behind Access.
    if ((url.hostname === env.RUN_HOST || url.hostname.endsWith(`.${env.RUN_HOST}`)) && !(env.SELF_HOST && url.pathname.startsWith('/api/'))) return serveRun(request, env, ctx);
    // Cloudflare Issues → Notifications webhook. Its own auth (cf-webhook-auth), before the user/agent auth.
    if (url.pathname === '/api/hooks/issues' && request.method === 'POST') return issuesHook(request, env, ctx);
    // Public-site basics (baseline): about, privacy, robots, version, health.
    if (isUiHost(env, url.hostname)) {
      const cf = (request as any).cf || {};
      if (url.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /p/\nDisallow: /import\nDisallow: /api/\nDisallow: /a/\nDisallow: /login\n', { headers: { 'content-type': 'text/plain' } });
      if (url.pathname === '/icon.svg') return new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="48" fill="#17695a"/><circle cx="121" cy="110" r="48" fill="none" stroke="#fff" stroke-width="30"/><path d="M154 58h30v138h-30z" fill="#fff"/></svg>', { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } });
      if (url.pathname === '/version.json') return json({ name: 'forq', version: env.CF_VERSION_METADATA?.id || null, at: env.CF_VERSION_METADATA?.timestamp || null });
      if (url.pathname === '/health.json') return health(env, ctx, url.origin);
      if (url.pathname === '/e') return kstatsForward(request, env, ctx);
      if (url.pathname === '/feedback') return feedback(request, env);
      if (url.pathname === '/about') {
        // The site header like any page (signed in or not): one session read, no Registry list.
        const em = await sessionEmail(env, request);
        const u = em ? await userByEmail(env, em) : null;
        return html(withGlobal(aboutPage(!!env.SELF_HOST), 'home', 0, u?.handle || '', 'd'));
      }
      if (url.pathname === '/privacy') return html(privacyPage());
      if (url.pathname === '/personal-agents' && env.CF_OAUTH_CLIENT_ID) return html(personalAgentsPage());
      if (url.pathname === '/own' && !env.SELF_HOST) return html(ownPage(true));
      if (url.pathname.startsWith('/connect/cf/') || url.pathname.startsWith('/personal-agents/') || url.pathname === '/api/installs') { const r = await installRoute(request, env, ctx, url); if (r) return r; }
      if (url.pathname === '/talk.js' || url.pathname === '/talk-voice.js' || url.pathname.startsWith('/api/talk/') || url.pathname.startsWith('/agents/talk-voice/')) {
        const w = await who(request, env);
        const me = w?.kind === 'user' && !w.anon ? { handle: w.handle, admin: w.admin } : null;
        // Talk is its own Worker (qodebase-talk, src/talkworker.ts) so its deploys never restart boxes; a copy without it runs Talk here.
        if (env.TALK) {
          const h = new Headers(request.headers);
          h.delete('x-talk-who'); h.delete('x-talk-site');
          if (me) h.set('x-talk-who', JSON.stringify(me));
          if (env.CF_VERSION_METADATA?.tag) h.set('x-talk-site', JSON.stringify({ sha: env.CF_VERSION_METADATA.tag, built: env.CF_VERSION_METADATA.timestamp }));
          return env.TALK.fetch(new Request(url.toString(), { method: request.method, headers: h, body: request.body, redirect: 'manual', ...(request.body ? { duplex: 'half' } : {}) } as RequestInit));
        }
        const r = await talkRoute(request, env, ctx, url, me); if (r) return r;
      }
      if (url.pathname.startsWith('/api/cli/') || url.pathname.startsWith('/cli') || url.pathname === '/llms.txt') { const r = await cliPublicRoute(request, env, url); if (r) return r; }
      // Crawler gate on WHO, not on paths: verified bots get the front page only
      // (project and code pages read Artifacts on every view).
      if ((cf.verifiedBotCategory || cf.botManagement?.verifiedBot) && url.pathname !== '/') {
        return new Response('forq pages are for people; see /about.', { status: 403, headers: { 'retry-after': '86400', 'x-robots-tag': 'noindex' } });
      }
    }
    // Design-variant and front-Worker hosts: sign in on the real host (Access
    // sits on UI_HOST/login only), come back with a token.
    const vhost = frontHosts(env).includes(url.hostname) ? url.hostname : request.headers.get('x-forq-host');
    if (vhost && (variantHosts(env).includes(vhost) || frontHosts(env).includes(vhost))) {
      if (url.pathname === '/login') {
        return new Response(null, { status: 302, headers: { location: `https://${env.UI_HOST}/login?to=${vhost}&next=${encodeURIComponent(safeNext(url.searchParams.get('next')) || '/')}` } });
      }
      if (url.pathname === '/session') {
        const email = await handoffEmail(env, url.searchParams.get('t') || '', vhost);
        if (!email) return new Response('That sign-in link has expired. Sign in again.', { status: 401 });
        return new Response(null, { status: 302, headers: { location: safeNext(url.searchParams.get('next')) || '/', 'set-cookie': await sessionCookie(env, email), 'cache-control': 'no-store' } });
      }
    }
    if (url.pathname === '/login' && url.hostname === env.UI_HOST) return loginRoute(request, env, url);
    if (url.pathname === '/logout') return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': clearCookie() } });
    const me = await who(request, env);
    if (!me) return json({ error: 'unauthorized' }, 401);
    // Anonymous readers: pages and read APIs only.
    if (me.kind === 'user' && me.anon) {
      const p0 = url.pathname;
      // Watch a run (src/landing/routes.ts) is the one anonymous POST: capped per IP and per day there.
      const anonPost = request.method === 'POST' && /^\/api\/p\/[a-z0-9-]+\/[a-z0-9-]+\/landing\/watch$/.test(p0);
      const needsUser = (request.method !== 'GET' && request.method !== 'HEAD' && !anonPost) || p0 === '/api/costs' || p0 === '/cli/login' || p0.startsWith('/api/cli/') || p0.startsWith('/a/') || p0.endsWith('/agents-html') || p0.startsWith('/api/github') || p0 === '/settings' || p0.startsWith('/api/me');
      if (needsUser) {
        const login = `/login?next=${encodeURIComponent(request.method === 'GET' ? p0 + url.search : (request.headers.get('referer') ? new URL(request.headers.get('referer')!).pathname : '/'))}`;
        return request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html')
          ? new Response(null, { status: 302, headers: { location: login } })
          : json({ error: 'Sign in first', login }, 401);
      }
    }
    const path = url.pathname;
    if (me.kind === 'user' && me.email && me.handle && (path.startsWith('/cli/') || path.startsWith('/api/cli/'))) {
      const r = await cliUserRoute(request, env, url, me.email, me.handle);
      if (r) return r;
    }
    // Boxes call back through workers.dev (no Access in front of it).
    const apiBase = url.hostname.endsWith('.workers.dev') ? `https://${url.hostname}` : env.API_BASE;
    const runBase = `https://${env.RUN_HOST}`;
    try {
      if (me.kind === 'agent') return agentApi(request, env, ctx, me, url, apiBase);
      let m: RegExpMatchArray | null;
      // Private projects: one gate for every page and API under /p/<o>/<n> and /api/p/<o>/<n>.
      // Someone else's private project answers exactly like one that does not exist.
      if ((m = path.match(/^\/(?:api\/)?p\/([a-z0-9-]+)\/([a-z0-9-]+)(?:\/|$)/))) {
        const e = await registry(env).get(slugOf(m[1], m[2]));
        if (e && !canSee(e, me.handle, me.admin)) return path.startsWith('/api/') ? json({ error: 'no such project' }, 404) : new Response('No such project', { status: 404 });
      }
      // The landing system (qb6, src/landing/routes.ts): /api/p/<o>/<n>/landing[/<verb>].
      if ((m = path.match(/^\/api\/p\/([a-z0-9-]+)\/([a-z0-9-]+)\/landing(?:\/([a-z-]+))?$/))) {
        const info = await projectStub(env, slugOf(m[1], m[2])).info();
        return info ? landingRoute(request, env, info, m[3] || '', me) : json({ error: 'no such project' }, 404);
      }

      // ---- pages
      // Production renders design D (views, home tabs, Build) since 2026-10-03; the
      // preview hosts a/b/c still pick theirs with x-forq-ui.
      const ui = uiFor(request, env);
      // The views design: 'c' alone; 'a', 'b' and 'd' with home tabs (three navigation takes).
      const views = ui === 'a' || ui === 'b' || ui === 'c' || ui === 'd';
      const tabsNav = ui === 'a' || ui === 'b' || ui === 'd';
      const globalOf = async (entries?: Entry[]): Promise<Global> => ({ nav: (ui || 'c') as Nav,
        inbox: tabsNav && me.handle ? inboxCount(await inboxOf(env, me.handle, entries || await listFor(env, me.handle, me.admin), runBase)) : 0 });
      if (views && uiOf(request) && (m = path.match(/^\/design-fixture(?:\/([a-z]+))?\/?$/))) {
        return html(fixtureV3(runBase, url.searchParams.get('state') || 'full', (VIEW_IDS as string[]).includes(m[1] || '') ? m[1] as ViewId : null, url.searchParams.get('try') || undefined, await globalOf()));
      }
      // Home tabs (A and B): Projects, Inbox, Explore; signed out, Explore only.
      // D: Home is the world (same for everyone), Yours is your projects.
      if (ui === 'd' && (path === '/' || path === '/mine' || path === '/inbox' || path === '/explore')) {
        // The catalogue lives at /explore since 2026-10-04; old home links with its filters follow it.
        if (path === '/' && ['s', 'cat', 'tag', 'sort'].some((k) => url.searchParams.has(k))) return new Response(null, { status: 301, headers: { location: `/explore${url.search}` } });
        const entries = await listFor(env, me.handle, me.admin);
        const tab = path === '/mine' && me.handle ? 'mine' : path === '/inbox' && me.handle ? 'inbox' : path === '/explore' ? 'explore' : 'home';
        const s = url.searchParams.get('s');
        return html(homeV3('d', tab, entries, me.handle, await inboxOf(env, me.handle, entries, runBase), s === 'people' ? s : 'projects',
          { tag: url.searchParams.get('cat') || url.searchParams.get('tag') || undefined, sort: url.searchParams.get('sort') || undefined }, !!env.SELF_HOST));
      }
      // Build: a new project from one sentence (src/newproject.ts).
      if (ui === 'd' && path === '/build' && request.method === 'GET') {
        const own = me.handle && !onSubscription(env, me.handle);
        const needsKey = !!own && !(await userByHandle(env, me.handle))?.apiKeyEnc;
        const inbox = me.handle ? inboxCount(await inboxOf(env, me.handle, await listFor(env, me.handle, me.admin), runBase)) : 0;
        return html(buildV3('d', me.handle, inbox, needsKey, env.RUN_HOST));
      }
      // The catalogue: a GitHub project's page, and its README fetched only when the page asks.
      if (ui === 'd' && (m = path.match(/^\/gh\/([\w.-]+)\/([\w.-]+?)(\/readme)?\/?$/))) {
        const full = `${m[1]}/${m[2]}`;
        if (m[3]) { const h = await catalogReadme(full, ctx); return h == null ? new Response('No README', { status: 404 }) : new Response(h, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600' } }); }
        const entries = await listFor(env, me.handle, me.admin);
        const pg = catalogV3('d', full, entries, me.handle, me.handle ? inboxCount(await inboxOf(env, me.handle, entries, runBase)) : 0);
        return pg ? html(pg) : new Response('Not in the catalogue', { status: 404 });
      }
      if (tabsNav && (path === '/' || path === '/inbox' || path === '/explore')) {
        const entries = await listFor(env, me.handle, me.admin);
        const tab = !me.handle || path === '/explore' ? 'explore' : path === '/inbox' ? 'inbox' : 'projects';
        return html(homeV3(ui as Nav, tab, entries, me.handle, await inboxOf(env, me.handle, entries, runBase)));
      }
      if (uiOf(request) && path === '/design-fixture') return html(fixtureV2(uiOf(request)!, runBase, url.searchParams.get('state') || 'full'));
      if (path === '/') {
        const entries = await listFor(env, me.handle, me.admin);
        if (ui) {
          // Each of your projects' changes, from its Project DO (no box calls).
          const status: Record<string, HomeStatus> = {};
          await Promise.all(entries.filter((e) => me.handle && e.owner === me.handle).map(async (e) => {
            const pi = await projectStub(env, e.slug).info().catch(() => null);
            const ag = (pi?.agents || []).filter((a) => a.state !== 'merged' && a.state !== 'stopped');
            status[e.slug] = { ready: ag.filter((a) => a.state === 'pushed' && a.review?.state !== 'changes' && a.review?.state !== 'queued' && a.review?.state !== 'reviewing' && a.review?.state !== 'sent').length,
              fix: ag.filter((a) => a.review?.state === 'changes' || a.state === 'blocked').length,
              working: ag.filter((a) => a.state === 'working' || ['queued', 'reviewing', 'sent'].includes(a.review?.state || '')).length };
          }));
          return html(homeV2(ui, entries, me.handle, status));
        }
        return html(explorePage(entries, me.handle));
      }
      if (path === '/import') return html(importPage(me.handle));
      // ---- account: settings page, API key, handle
      if (path === '/settings') {
        const u = await userByEmail(env, me.email || '');
        if (!u) return new Response(null, { status: 302, headers: { location: '/login?next=/settings' } });
        const mine = (await listFor(env, me.handle, me.admin)).filter((e) => e.owner === u.handle).length;
        const page = settingsPage(u, onSubscription(env, u.handle), mine, url.searchParams.has('welcome'), await registry(env).cliTokens(u.email));
        return html(tabsNav ? withGlobal(page, 'account', (await globalOf()).inbox, u.handle, ui as Nav) : page);
      }
      if (path.startsWith('/api/me/') && request.method !== 'GET') {
        const u = await userByEmail(env, me.email || '');
        if (!u) return json({ error: 'Sign in first' }, 401);
        if (path === '/api/me/key' && request.method === 'POST') {
          const { key } = await request.json() as { key?: string };
          const k = String(key || '').trim();
          const c = await checkApiKey(k);
          if (!c.ok) return json({ error: c.error }, 400);
          await registry(env).putUser({ ...u, apiKeyEnc: await encryptKey(env, k), apiKeyTail: k.slice(-4), apiKeyCheckedAt: Date.now() });
          log('auth', 'api_key_saved', { handle: u.handle });
          return json({ ok: true, tail: k.slice(-4) });
        }
        if (path === '/api/me/key' && request.method === 'DELETE') {
          const { apiKeyEnc, apiKeyTail, apiKeyCheckedAt, ...rest } = u;
          await registry(env).putUser(rest);
          return json({ ok: true });
        }
        if (path === '/api/me/handle' && request.method === 'POST') {
          const { handle } = await request.json() as { handle?: string };
          if ((await listFor(env, me.handle, me.admin)).some((e) => e.owner === u.handle)) return json({ error: 'You already own projects under this name, so it cannot change.' }, 400);
          const r = await claimHandle(env, u.email, String(handle || ''));
          if (!r.ok) return json({ error: r.error }, 400);
          await registry(env).putUser({ ...u, handle: r.user!.handle });
          return json({ ok: true, handle: r.user!.handle });
        }
      }
      // ---- GitHub: search, look up one repo, import it
      // The project list as JSON (qb ls): the Registry only, no Artifacts reads.
      if (path === '/api/projects' && request.method === 'GET') {
        const owner = url.searchParams.get('owner') || (url.searchParams.has('mine') ? me.handle : '');
        const list = (await listFor(env, me.handle, me.admin)).filter((e) => !owner || e.owner === owner);
        return json({ projects: list.slice(0, 500).map((e) => ({ ...e, path: `/p/${e.owner}/${e.name}`, live: runUrl(runBase, e.slug) })) });
      }
      // Costs (src/costs.ts): the header chip's numbers and the /costs page.
      if (path === '/api/costs' && me.handle) {
        const c = await costSummary(env, me.handle);
        return json({ today: c.today, week: c.week, month: c.month, pricesChecked: c.pricesChecked });
      }
      if (path === '/costs') {
        if (!me.handle) return new Response(null, { status: 302, headers: { location: '/login?next=/costs' } });
        return html(withGlobal(costsPage(await costSummary(env, me.handle), !!env.SELF_HOST), 'home', 0, me.handle, 'd'));
      }
      if (path === '/api/github/search') {
        const q = url.searchParams.get('q') || '';
        const ref = parseRepoRef(q);
        if (ref) { const r = await getRepo(ref, ctx); return 'error' in r ? json(r, r.status) : json({ repos: [r], exact: true }); }
        if (q.trim().length < 2) return json({ repos: [] });
        const r = await searchRepos(q, ctx);
        return Array.isArray(r) ? json({ repos: r }) : json(r, r.status);
      }
      if (path === '/api/build' && request.method === 'POST') {
        if (!me.handle) return json({ error: 'Sign in first' }, 401);
        const b = await request.json().catch(() => ({})) as { name?: string; prompt?: string; private?: boolean };
        const prompt = String(b.prompt || '').trim().slice(0, 3000);
        if (prompt.length < 4) return json({ error: 'Say what to build' }, 400);
        if (!onSubscription(env, me.handle) && !(await userByHandle(env, me.handle))?.apiKeyEnc) return json({ error: 'Add your Anthropic API key in Settings first' }, 400);
        const tooMany = await overProjectLimit(env, me.handle);
        if (tooMany) return json({ error: tooMany }, 400);
        // A self-hosted copy has no forq/blank starter: its new projects start empty and
        // the router writes the first files on main before it splits the work.
        const starter = await projectStub(env, STARTER).info();
        const base = nameFor(String(b.name || '')) || 'my-app';
        let name = base;
        for (let i = 2; await registry(env).get(slugOf(me.handle, name)); i++) name = `${base.slice(0, 35)}-${i}`;
        if (!NAME_RE.test(name)) return json({ error: 'That name does not work; use letters, digits and dashes' }, 400);
        const slug = slugOf(me.handle, name);
        const p = projectStub(env, slug);
        const desc = prompt.split('\n')[0].slice(0, 140);
        if (starter) await p.createFork(me.handle, name, starter, desc, true);
        else await p.create(me.handle, name, desc);
        if (b.private) await p.setPrivate(true);
        await askRouter(env, ctx, p, slug, buildPayload(prompt, !starter), apiBase, prompt);
        log('build', 'started', { slug, chars: prompt.length });
        return json({ ok: true, slug, path: `/p/${me.handle}/${name}/changes` });
      }
      if (path === '/api/import' && request.method === 'POST') {
        const b = await request.json() as { repo?: string; as?: string; private?: boolean };
        const ref = parseRepoRef(String(b.repo || ''));
        if (!ref) return json({ error: 'give a GitHub URL or owner/repo' }, 400);
        const gh = await getRepo(ref, ctx);
        if ('error' in gh) return json(gh, gh.status);
        if (gh.private) return json({ error: 'private repos cannot be imported' }, 400);
        if (gh.sizeKb > MAX_IMPORT_KB) return json({ error: `${gh.fullName} is ${Math.round(gh.sizeKb / 1024)} MB; qodebase imports up to ${MAX_IMPORT_KB / 1024} MB` }, 400);
        // Admin may import on behalf of another handle (the forq showcase account).
        const owner = me.admin && b.as ? b.as : me.handle;
        const tooMany = await overProjectLimit(env, owner);
        if (tooMany) return json({ error: tooMany }, 400);
        let name = nameFor(gh.name);
        for (let i = 2; await registry(env).get(slugOf(owner, name)); i++) name = `${nameFor(gh.name).slice(0, 35)}-${i}`;
        const info = await projectStub(env, slugOf(owner, name)).createImported(owner, name,
          { url: `https://github.com/${gh.fullName}`, fullName: gh.fullName, stars: gh.stars, license: gh.license, branch: gh.branch }, gh.description);
        if (b.private) await projectStub(env, info.slug).setPrivate(true);
        return json({ ...info, private: !!b.private, path: `/p/${owner}/${name}` });
      }
      if ((m = path.match(/^\/p\/([a-z0-9-]+)\/([a-z0-9-]+)\/build-log$/))) {
        const info = await projectStub(env, slugOf(m[1], m[2])).info();
        if (!info) return new Response('No such project', { status: 404 });
        const ag = url.searchParams.get('agent');
        const a = ag ? info.agents.find((x) => x.id.split('--')[1] === ag) : undefined;
        return html(buildLogPage(info, a ? `Preview of agent ${ag}` : 'Live app (main)', a ? a.preview : info.app));
      }
      // ---- design v3 (views): /p/<o>/<n>[/<view>] on the views host
      if (views && (m = path.match(/^\/p\/([a-z0-9-]+)\/([a-z0-9-]+)(?:\/(readme|changes|app|history|more|agents|errors|about|work))?\/?$/))) {
        const slug = slugOf(m[1], m[2]);
        const p = projectStub(env, slug);
        const info = await p.info();
        if (!info) return new Response('No such project', { status: 404 });
        const all = await listFor(env, me.handle, me.admin);
        const own = info.owner === me.handle;
        const st = own ? await statusesOf(env, info) : { status: {}, router: { awake: false, cc: 'asleep' }, reviewer: { awake: false, cc: 'asleep' } };
        return html(projectV3({ info, entry: all.find((e) => e.slug === slug)!, forks: all.filter((e) => e.forkedFrom === slug), overview: await p.overview(),
          me: me.handle, runBase, liveHtml: '', view: m[3] === 'about' ? 'readme' : (m[3] as ViewId) || null, tryAgent: url.searchParams.get('try') || undefined, ...st,
          docs: !m[3] || m[3] === 'readme' || m[3] === 'about' ? await docsOf(env, ctx, info, url.searchParams.get('doc')) : undefined,
          g: await globalOf(all),
          needsKey: own && !onSubscription(env, me.handle) && !(await userByHandle(env, me.handle))?.apiKeyEnc }));
      }
      // ---- code browser: /p/<o>/<n>/code/<path>[?v=<agent>], changes, file list
      if ((m = path.match(/^\/p\/([a-z0-9-]+)\/([a-z0-9-]+)\/(code|changes)(?:\/(.*))?$/))) {
        const info = await projectStub(env, slugOf(m[1], m[2])).info();
        if (!info) return new Response('No such project', { status: 404 });
        const r = m[3] === 'changes' ? await changesRoute(env, ctx, info, decodeURIComponent(m[4] || ''), runBase)
          : await codeRoute(env, ctx, info, url.searchParams.get('v') || '', decodeURIComponent(m[4] || ''), runBase);
        // The views design keeps its tab bar on the code pages.
        if (views && (r.headers.get('content-type') || '').includes('text/html')) return html(withTabs(await r.text(), info, me.handle, await globalOf()));
        return r;
      }
      if ((m = path.match(/^\/p\/([a-z0-9-]+)\/([a-z0-9-]+)\/?$/))) {
        const slug = slugOf(m[1], m[2]);
        const p = projectStub(env, slug);
        const info = await p.info();
        if (!info) return new Response('No such project', { status: 404 });
        const all = await listFor(env, me.handle, me.admin);
        const entry = all.find((e) => e.slug === slug)!;
        if (ui) return html(projectV2(ui, { info, entry, forks: all.filter((e) => e.forkedFrom === slug), overview: await p.overview(),
          me: me.handle, runBase, liveHtml: info.owner === me.handle ? await renderAgents(env, info, runBase, ui) : '',
          needsKey: info.owner === me.handle && !onSubscription(env, me.handle) && !(await userByHandle(env, me.handle))?.apiKeyEnc }));
        return html(projectPage({ info, entry, forks: all.filter((e) => e.forkedFrom === slug), overview: await p.overview(),
          me: me.handle, runBase, agentsHtml: info.owner === me.handle ? await renderAgents(env, info, runBase) : '',
          needsKey: info.owner === me.handle && !onSubscription(env, me.handle) && !(await userByHandle(env, me.handle))?.apiKeyEnc }));
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
          const tooMany = await overProjectLimit(env, me.handle);
          if (tooMany) return json({ error: tooMany }, 400);
          let newName = info.name;
          for (let i = 2; await registry(env).get(slugOf(me.handle, newName)); i++) newName = `${info.name}-${i}`;
          if (!NAME_RE.test(newName)) return json({ error: 'name too long' }, 400);
          const fi = await projectStub(env, slugOf(me.handle, newName)).createFork(me.handle, newName, info);
          // Land where you change it (2026-10-04: landing on the README left it unclear how).
          return json({ ...fi, path: `/p/${fi.owner}/${fi.name}/changes` });
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
        // qb clone: a short-lived git token for main, write for the owner, read for anyone else.
        if (verb === 'git-token' && request.method === 'POST') {
          if (!me.handle) return json({ error: 'Sign in first' }, 401);
          const mine = info.owner === me.handle;
          log('cli', 'git_token', { slug, handle: me.handle, write: mine });
          return json({ ...(await p.gitToken(mine ? 'write' : 'read')), write: mine });
        }
        if (info.owner !== me.handle && !me.admin) return json({ error: 'not your project' }, 403);
        if (verb === 'main-token' && request.method === 'POST' && me.admin) return json(await p.mainToken());
        // Ask Claude (the ask box, src/box.ts): owner-only, read-only, on the owner's Claude.
        if (verb === 'ask' && request.method === 'POST') {
          const b = await request.json().catch(() => ({})) as { question?: string; model?: string };
          const question = String(b.question || '').trim().slice(0, 2000);
          const model = ['opus', 'sonnet', 'haiku'].includes(String(b.model)) ? String(b.model) : 'opus';
          if (question.length < 3) return json({ error: 'Ask a question' }, 400);
          const askId = `${slug}--ask`;
          const id = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
          await boxStub(env, askId).startAsk(id, question, await bootSpec(env, askId, apiBase), model);
          return json({ id, model, result: `/api/p/${owner}/${name}/ask-result?id=${id}` });
        }
        if (verb === 'ask-result') {
          const r = await boxStub(env, `${slug}--ask`).askResult(url.searchParams.get('id') || '');
          return r ? json(r) : json({ error: 'no such question' }, 404);
        }
        if (verb === 'visibility' && request.method === 'POST') {
          const b = await request.json().catch(() => ({})) as { private?: boolean };
          const ni = await p.setPrivate(!!b.private);
          return json({ ok: true, private: !!ni.private });
        }
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
        if (verb === 'agents-html' && ['a', 'b', 'c', 'd'].includes(uiFor(request, env) || '')) {
          const st = await statusesOf(env, info);
          return json({ html: liveV3(url.searchParams.get('view') || 'changes', { info, me: me.handle, runBase, ...st, entry: undefined as unknown as Entry, forks: [], overview: { commits: [], files: [], readme: null }, liveHtml: '' }) });
        }
        if (verb === 'agents-html') return json({ html: await renderAgents(env, info, runBase, uiFor(request, env)), tabs: previewTabs(info, runBase) });
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
        if (verb === 'reviewer-state' && request.method === 'POST' && me.admin) {
          const rb = boxStub(env, `${slug}--review`);
          const awake = await rb.isAwake();
          const cc = awake ? await rb.ccStatus().catch(() => 'unknown') : 'asleep';
          return json({ ok: true, awake, cc, idle: !awake || !/busy|thinking|working|running|tool|compact/i.test(cc) });
        }
        if (verb === 'review-dispatch' && request.method === 'POST' && me.admin) {
          const b = await request.json() as { agent?: string; reviewer?: string };
          // reviewer: one of a landing project's pool (<slug>--review, --review2…); default the single one.
          const rv = b.reviewer && new RegExp(`^${slug.replace('.', '\\.')}--review\\d*$`).test(b.reviewer) ? b.reviewer : undefined;
          const r = await dispatchReview(env, p, slug, apiBase, String(b.agent || ''), rv);
          return json(r, r.ok ? 200 : r.busy ? 409 : 502);
        }
        if (verb === 'deliver' && request.method === 'POST' && me.admin) {
          const b = await request.json() as { at?: number };
          const r = await deliverToRouter(env, p, slug, Number(b.at), apiBase);
          return json(r, r.ok ? 200 : 502);
        }
        if (verb === 'review' && request.method === 'POST') {
          const b = await request.json() as { agent?: string };
          if (!info.agents.some((x) => x.id === b.agent)) return json({ error: 'unknown agent' }, 404);
          // Awaited, not waitUntil: waking the reviewer can outlast waitUntil's ~30 s.
          await startReview(env, p, slug, apiBase, () => p.queueReview(b.agent!));
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
          // Landing projects: the merge tap queues the change (src/landing/), no router turn.
          if (landingOn(info)) return json({ queued: true, change: await landingHooks.onMerge(env, slug, a.id) });
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
        if (b.project) {
          // Its boxes too: a re-created project otherwise boots the old router
          // and reviewer from their snapshots (tipsplit, 2026-10-02).
          const pi = await projectStub(env, b.project).info();
          const boxes = [...(pi?.agents || []).map((a) => a.id), `${b.project}--router`, `${b.project}--review`];
          await Promise.all(boxes.map((id) => boxStub(env, id).destroy().catch(() => {})));
          await projectStub(env, b.project).wipe();
        }
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

// Every HTML page on the UI host (and the variants) leaves through the
// baseline rewriter: kstats tag and share-card tags (src/baseline.ts).
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    request = fromFront(request, env);
    let res = await app.fetch(request, env, ctx);
    res = await withRunPasses(request, env, res);
    const u = new URL(request.url);
    if (!isUiHost(env, u.hostname)) return res;
    res = await withBaseline(request, env, res);
    return withLook(res);   // the site-wide look layer (src/look.ts)
  },
} satisfies ExportedHandler<Env>;

/** A private project's pages (and the agents-html JSON that refreshes them) link to its
 *  live app and agent forks on the run host, which only opens with a signed pass
 *  (run.ts): add one to every such link, for viewers who may see the project. Public
 *  projects pay one Registry read on project paths and nothing else. */
async function withRunPasses(request: Request, env: Env, res: Response): Promise<Response> {
  const url = new URL(request.url);
  const m = url.pathname.match(/^\/(?:api\/)?p\/([a-z0-9-]+)\/([a-z0-9-]+)(?:\/|$)/);
  const type = res.headers.get('content-type') || '';
  if (!m || res.status !== 200 || !(type.includes('text/html') || type.includes('json'))) return res;
  const slug = slugOf(m[1], m[2]);
  const e = await registry(env).get(slug);
  if (!e?.private) return res;
  const me = await who(request, env);
  if (!me || me.kind !== 'user' || !canSee(e, me.handle, me.admin)) return res;
  const pass = await mintRunPass(env, slug);
  // https://<name>--<owner>.<run>/… and https://ag-<id>--<name>--<owner>.<run>/…
  const run = env.RUN_HOST.replace(/\./g, '\\.');
  // Host form (…--owner.<run>/) and the path form a self-hosted copy uses (<run>/owner.name[--id]/).
  const host = `(?:(?:ag-[a-z0-9]+--)?${m[2]}--${m[1]}\\.${run}|${run}/${m[1]}\\.${m[2]}(?:--[a-z0-9]+)?)`;
  const re = new RegExp(`(https://${host}/[^"'\\\\\\s<>?#]*)(\\?[^"'\\\\\\s<>#]*)?`, 'g');   // a URL ends at quotes, backslashes (JSON's \"), space, < >
  const text = (await res.text()).replace(re, (_x, base: string, q?: string) => `${base}${q ? `${q}&` : '?'}__qb=${pass}`);
  const out = new Response(text, res);
  out.headers.delete('content-length');
  out.headers.set('cache-control', 'private, no-store');
  return out;
}

/** A request the front Worker (front/, another Cloudflare account) forwarded
 *  for one of FRONT_HOSTS: carry on as if it had arrived on that host, with
 *  the visitor's IP and cf facts (the hop itself would show the front's). */
function fromFront(request: Request, env: Env): Request {
  const host = request.headers.get('x-qb-host');
  if (!host || !env.FRONT_SECRET || request.headers.get('x-qb-front') !== env.FRONT_SECRET || !frontHosts(env).includes(host)) return request;
  const url = new URL(request.url);
  url.hostname = host;
  const req = new Request(url, request);
  let cf: Record<string, unknown> = {};
  try { cf = JSON.parse(req.headers.get('x-qb-cf') || '{}'); } catch {}
  const ip = req.headers.get('x-qb-ip');
  if (ip) req.headers.set('cf-connecting-ip', ip);
  for (const h of ['x-qb-front', 'x-qb-host', 'x-qb-cf', 'x-qb-ip']) req.headers.delete(h);
  Object.defineProperty(req, 'cf', { value: cf });
  return req;
}

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
  return html(filePage({ info, v, path: clean, file, rev, runUrl: runUrl(runBase, repo, clean) }));
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
    previewUrl: runUrl(runBase, agent.fork, info.entry || '') }));
}

const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

/** Hand text to the router agent. Recorded first and answered at once; waking
 *  (6-20 s) and delivery happen in the background, and the page shows each
 *  phase from the project's lastRequest. */
async function askRouter(env: Env, ctx: ExecutionContext, p: DurableObjectStub<Project>, slug: string, text: string, apiBase: string, shown = text) {
  const at = Date.now();
  // `shown` is what the page quotes as "You": the person's words, not forq's instruction to the router.
  await p.setRequest({ text: shown, payload: text === shown ? undefined : text, at, state: 'waking', sentAt: undefined, error: undefined, attempts: 0 });
  // Delivered from the project DO's alarm (Project.scheduleDelivery), which survives this request.
  await p.scheduleDelivery();
  return { ok: true, at };
}

/** The deliver verb (called by the project DO's alarm, which waits): wake the
 *  router agent if needed and type the pending request. */
async function deliverToRouter(env: Env, p: DurableObjectStub<Project>, slug: string, at: number, apiBase: string) {
  const info = await p.info();
  const q = info?.lastRequest;
  if (!q || q.at !== at || q.state !== 'waking') return { ok: true, skipped: 'no pending request' };
  const r = await sendTo(env, `${slug}--router`, q.payload || q.text, apiBase);
  log('api', 'router_send', { slug, ok: r.ok, ms: Date.now() - at, attempt: q.attempts, err: r.error });
  if (r.ok) await p.setRequest({ state: 'sent', sentAt: Date.now() });
  return r;
}

/** Run a review-queue step (queue, verdict, …) and hand the reviewer the agent
 *  it returns, if any. One review at a time per project. */
async function startReview(env: Env, p: DurableObjectStub<Project>, slug: string, apiBase: string, step: () => Promise<string | null>, deferred = false) {
  try {
    const next = await step();
    if (!next) return;
    void deferred;   // every hand-off goes through the project DO's review watchdog
    await p.scheduleReviewDispatch(next);
  } catch (e) {
    log('review', 'failed', { slug, err: String(e), stack: (e as Error)?.stack });
  }
}

/** Clear the reviewer and give it one review. Returns busy if it is mid-turn. */
async function dispatchReview(env: Env, p: DurableObjectStub<Project>, slug: string, apiBase: string, next: string, reviewer = `${slug}--review`): Promise<{ ok: boolean; busy?: boolean; error?: string }> {
  try {
    const info = await p.info();
    const ag = info?.agents.find((x) => x.id === next);
    const tip = ag ? await head(env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext, ag.fork).catch(() => null) : null;
    // Fresh context per review: the reviewer once answered a new request from
    // its memory of the previous one and never looked at the new commit.
    // Wake first: a box restored from its snapshot resumes the old conversation.
    const rbox = boxStub(env, reviewer);
    if (await rbox.isAwake()) {
      const cc = await rbox.ccStatus().catch(() => 'unknown');
      if (/busy|thinking|working|running|tool|compact/i.test(cc)) return { ok: false, busy: true, error: `reviewer is ${cc}` };
    } else await wake(env, reviewer, apiBase).catch(() => null);
    await rbox.clearContext().catch(() => false);
    const text = [
      `Review agent ${next}${tip ? ` at commit ${tip.commit.slice(0, 7)} ("${tip.message}")` : ''}. This is a new review: ignore any earlier review of this agent.`,
      ag?.note ? `The agent reports: ${ag.note}` : '',
      `You are the reviewer agent of this project (${slug.replace('.', '/')}). The agent id is ${next}.`,
      ...REVIEW_STEPS.map((x) => x.replaceAll('<agent-id>', next)),
    ].filter(Boolean).join('\n\n');
    let r = await sendTo(env, reviewer, text, apiBase);
    // Confirm it landed: Claude Code should start working within ~15 s. If it
    // stays idle the text was lost; type it once more.
    if (r.ok) {
      let started = false;
      for (let i = 0; i < 8 && !started; i++) {
        await new Promise((res) => setTimeout(res, 2000));
        started = /busy|thinking|working|running|tool/i.test(await rbox.ccStatus().catch(() => ''));
      }
      if (!started) { log('review', 'resend', { slug, agent: next }); r = await sendTo(env, reviewer, text, apiBase); }
    }
    log('review', 'dispatched', { slug, agent: next, ok: r.ok, err: r.error });
    if (!r.ok) await p.setVerdict(next, 'changes', `The reviewer could not start: ${r.error}. Review it yourself, or push again to retry.`);
    return r;
  } catch (e) {
    log('review', 'dispatch_failed', { slug, err: String(e), stack: (e as Error)?.stack });
    return { ok: false, error: String(e) };
  }
}

/** A Cloudflare Issues notification for one of the forq-app-* Workers: find the
 *  project whose app it is and give the error to its router agent, which starts
 *  an agent to fix it. The payload format is logged whole (first contact with
 *  it), and only plain text from it reaches the router agent. */
async function issuesHook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!env.ISSUES_WEBHOOK_SECRET || request.headers.get('cf-webhook-auth') !== env.ISSUES_WEBHOOK_SECRET) {
    log('issues', 'rejected', { hasHeader: request.headers.has('cf-webhook-auth') });
    return json({ error: 'unauthorized' }, 401);
  }
  const raw = await request.text();
  let body: any = {};
  try { body = JSON.parse(raw); } catch { body = { text: raw }; }
  log('issues', 'received', { bytes: raw.length, keys: Object.keys(body), payload: raw.slice(0, 4000) });
  // Which Worker? Look for a forq-app-* name anywhere in the payload.
  const worker = (raw.match(/forq-app-[a-z0-9-]+/) || [])[0];
  if (!worker) { log('issues', 'no_worker', {}); return json({ ok: true, ignored: 'no forq-app worker named (a test message?)' }); }
  const entries = await registry(env).list();
  const e = entries.find((x) => appWorkerName(x.slug) === worker);
  if (!e) { log('issues', 'unknown_worker', { worker }); return json({ ok: true, ignored: `no project deploys as ${worker}` }); }
  const p = projectStub(env, e.slug);
  const text = String(body.text || body.data?.text || body.message || raw).slice(0, 3000);
  const title = (text.split('\n').find((l) => l.trim()) || 'an error').slice(0, 140);
  // The alert says only what failed ("HTTP 500"), not where. The issue's
  // occurrences name the failing requests; without them the router agent
  // guessed the cause from recent commits and fixed the wrong thing (2026-10-01).
  const issueId = (text.match(/Issue ID: ([0-9a-f-]{36})/) || [])[1];
  const occ = issueId ? await issueOccurrences(env, issueId) : null;
  const info = await p.info();
  const live = info?.app?.url || `(not deployed yet; Worker ${worker})`;
  const ask = [
    `Cloudflare Issues reported a production error in this project's live app (Worker ${worker}, live at ${live}):`,
    text.split('\n\nAI-assisted investigation')[0],
    occ ? `The failing requests, from the issue's occurrences (dynamic path parts are shown as REDACTED by Cloudflare):\n${occ}` : 'The occurrences could not be fetched.',
    `First reproduce it: send the SAME request to the live URL with curl (same method, path and headers as above; a plain GET is not a WebSocket upgrade), trying realistic values where the path says REDACTED, until you get the same status, and read the response body. Only then decide the cause from the code. If you cannot reproduce it, say so rather than picking a theory. Start one agent with \`forq spawn\` to fix it, giving it the exact failing request, what the response showed, and the cause. If an agent is already working on this error with a different theory, tell it with \`forq send\`. Reply with one line saying what you found and did.`,
  ].join('\n\n');
  const r = await askRouter(env, ctx, p, e.slug, ask, env.API_BASE, `Production error from Cloudflare Issues: ${title}`);
  log('issues', 'routed', { worker, slug: e.slug });
  return json({ routed: e.slug, ...r });
}

/** An issue's failing requests, grouped: "3× GET /api/room/REDACTED/websocket → 500 (HttpServerError: HTTP 500)". */
async function issueOccurrences(env: Env, issueId: string): Promise<string | null> {
  if (!env.OBS_READ_TOKEN) return null;
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/workers/observability/issues/${issueId}/occurrences`, {
      headers: { authorization: `Bearer ${env.OBS_READ_TOKEN}` },
    });
    const j = await r.json() as { success?: boolean; result?: any[] };
    if (!r.ok || !j.result) { log('issues', 'occurrences_failed', { issueId, status: r.status }); return null; }
    const groups = new Map<string, number>();
    for (const o of j.result.slice(0, 50)) {
      // Headers matter for reproducing: the chat demo answers a WebSocket
      // upgrade with a 101 that carries the error, a plain GET with a 500.
      const h = o.request?.headers || {};
      const how = [h['user-agent'] ? `user-agent ${h['user-agent']}` : null, h.upgrade ? `Upgrade: ${h.upgrade}` : 'no Upgrade header'].filter(Boolean).join(', ');
      const k = `${o.invocation?.method || '?'} ${o.invocation?.path || o.invocation?.url || '?'} → ${o.invocation?.statusCode ?? '?'} (${o.error?.name || 'error'}: ${o.error?.message || ''}${o.error?.handled === false ? ', unhandled' : ''}; ${how})`;
      groups.set(k, (groups.get(k) || 0) + 1);
    }
    const trail = j.result.flatMap((o) => (o.trail || []).map((t: any) => typeof t === 'string' ? t : JSON.stringify(t))).slice(0, 10);
    return [...groups].map(([k, n]) => `- ${n}× ${k}`).join('\n') + (trail.length ? `\nTrail:\n${trail.join('\n')}` : '');
  } catch (e) {
    log('issues', 'occurrences_error', { issueId, err: String(e) });
    return null;
  }
}

/** Other people get 10 projects; the instance owner is unlimited. */
async function overProjectLimit(env: Env, handle: string): Promise<string | null> {
  if (isOwner(env, handle)) return null;
  const n = (await registry(env).list()).filter((e) => e.owner === handle).length;
  return n >= 10 ? 'You have 10 projects, the limit for now. Self-host qodebase for more.' : null;
}

/** A landing project's own caps (crew runs, src/landing/), or null for the instance's. */
async function landingCaps(env: Env, slug: string): Promise<{ agents?: number; awake?: number } | null> {
  const info = await projectStub(env, slug).info().catch(() => null);
  if (!landingOn(info)) return null;
  return (await env.Landing.get(env.Landing.idFromName(slug)).flags().catch(() => null))?.caps || null;
}

async function spawn(env: Env, ctx: ExecutionContext, slug: string, task: string, apiBase: string, o: { files?: string[]; on?: string } = {}) {
  task = task.trim();
  if (!task || task.length > 4000) throw new Error('task required (max 4000 chars)');
  const caps = await landingCaps(env, slug);
  const agent = await projectStub(env, slug).addAgent(task, o.on || undefined, caps?.agents);
  // The landing system (src/landing/hooks.ts): the change's record with its claims.
  const pinfo = await projectStub(env, slug).info();
  if (landingOn(pinfo)) await landingHooks.onSpawn(env, pinfo!, agent, o).catch((e) => log('landing', 'spawn_hook_failed', { id: agent.id, err: String(e) }));
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
  // A box using its forq CLI is working, whatever its UI traffic says.
  ctx.waitUntil(boxStub(env, me.agentId).touch(me.agentId).catch(() => {}));
  if (verb === 'list') {
    const info = await p.info();
    const agents = (info?.agents || []).map(({ id, task, state, note }) => ({ id, task, state, note } as Record<string, unknown>));
    // Landing projects: each agent's claims and where its change is in the queue (`forq list`).
    if (landingOn(info)) for (const a of agents) {
      const c = await env.Landing.get(env.Landing.idFromName(slug)).change(String(a.id)).catch(() => null);
      if (c) { a.claims = [...new Set([...c.claims, ...c.files])]; a.landing = c.state; }
    }
    return json({ agents });
  }
  if (verb === 'status' && me.role === 'agent') {
    if (!['working', 'pushed', 'blocked'].includes(body.state)) return json({ error: 'state: working|pushed|blocked' }, 400);
    await p.setState(me.agentId, body.state as 'working', String(body.note || ''));
    // Every push gets a review before the person merges.
    if (body.state === 'pushed') {
      // Worker projects: build the fork as a Preview first; buildDone starts the review.
      const ownerDeploys = isOwner(env, slug.split('.')[0]);
      const pinfo = await p.info();
      // A landing project with a reviewer pool: Landing hands the review to a free reviewer.
      const pooled = landingOn(pinfo) && ((await env.Landing.get(env.Landing.idFromName(slug)).flags().catch(() => null))?.reviewers || 1) > 1;
      if ((await p.kindOf()) === 'worker' && ownerDeploys) ctx.waitUntil(p.requestBuild('preview', me.agentId).catch((e) => log('build', 'request_failed', { err: String(e) })));
      else if (!pooled) await startReview(env, p, slug, apiBase, () => p.queueReview(me.agentId));   // awaited: see the review verb
      if (landingOn(pinfo)) await landingHooks.onPushed(env, ctx, pinfo!, me.agentId, String(body.note || ''), pooled).catch((e) => log('landing', 'push_hook_failed', { id: me.agentId, err: String(e) }));
    }
    return json({ ok: true });
  }
  // An agent's own main, read-only: `forq sync-main` rebases its work on it (landing tier 2).
  if (verb === 'main-info' && me.role === 'agent') {
    const t = await p.gitToken('read');
    return json({ remote: t.remote, token: t.token, branch: t.branch });
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
      // A verdict counts only for the agent's latest push. A reviewer working
      // from an old fetch approved a superseded commit once (2026-10-01).
      const info = await p.info();
      const ag = info?.agents.find((x) => x.id === body.agent);
      const tip = ag ? await head(env, ctx, ag.fork).catch(() => null) : null;
      if (tip && body.commit && tip.commit !== body.commit) {
        log('review', 'stale_verdict', { agent: body.agent, reviewed: String(body.commit).slice(0, 8), latest: tip.commit.slice(0, 8) });
        return json({ error: `you reviewed ${String(body.commit).slice(0, 7)} but the agent's latest push is ${tip.commit.slice(0, 7)}: run \`forq fetch-agent ${body.agent}\` and review again` }, 409);
      }
      // Deferred: the reviewer is still inside this very command; the next review waits until it is idle.
      await startReview(env, p, slug, apiBase, () => p.setVerdict(body.agent, body.verdict === 'approve' ? 'approved' : 'changes', String(body.notes || '')), true);
      if (landingOn(info)) await landingHooks.onVerdict(env, slug, body.agent, body.verdict === 'approve' ? 'approved' : 'changes', String(body.notes || '')).catch((e) => log('landing', 'verdict_hook_failed', { err: String(e) }));
      return json({ ok: true });
    }
    return json({ error: 'the reviewer can fetch-agent and verdict' }, 403);
  }
  if (me.role !== 'router') return json({ error: 'only the router agent can do that' }, 403);
  if (verb === 'spawn') {
    const b = body as Record<string, unknown>;
    return json(await spawn(env, ctx, slug, String(b.task || ''), apiBase, { files: Array.isArray(b.files) ? b.files.map(String) : undefined, on: b.on ? String(b.on) : undefined }));
  }
  if (verb === 'send') {
    if (projectOf(body.agent || '') !== slug) return json({ error: 'not an agent of this project' }, 400);
    return json(await sendTo(env, body.agent, String(body.text || ''), apiBase));
  }
  if (verb === 'merge-info') {
    const agent = url.searchParams.get('agent') || '';
    if (projectOf(agent) !== slug) return json({ error: 'not an agent of this project' }, 400);
    // Landing projects: `forq merge` puts the change in the merge queue instead.
    if (landingOn(await p.info())) { const c = await landingHooks.onMerge(env, slug, agent); return json({ queued: true, state: c.state }); }
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
  // The box's mobile-agent allows one origin (UI_HOST, set at boot); the other
  // site hosts are the same site.
  const origin = request.headers.get('origin');
  const fwd = new Request(request);
  if (origin && isUiHost(env, new URL(origin).hostname)) fwd.headers.set('origin', `https://${env.UI_HOST}`);
  const proxy = () => box.fetch(new Request(`https://container${sub}${url.search}`, fwd));
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
