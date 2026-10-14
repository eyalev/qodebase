// forq Worker.
//
// Hosts:
//   UI_HOST (forq.kapps.dev)  UI + API; public read, sign-in via /login (Access)
//   forq-run.kapps.dev  public run host: any repo/fork as a live static app (run.ts)
//   *.workers.dev       admin (x-forq-secret) and the boxes' forq CLI (x-forq-agent)

import { withBaseline, kstatsForward, feedback, health } from './baseline';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AGENT_RE, NAME_RE, appWorkerName, frontHosts, isUiHost, uiHosts, projectOf, slugOf, type Env } from './env';
import { AgentBox, log, REVIEW_STEPS, type BootSpec } from './box';
import { buildAsks } from './landing/asks';
import { handleArtifactsBatch } from './events';
import { Project, roleOf, type ProjectInfo, type Role, type RouterRequest } from './project';
import { Registry, canSee, listFor, registry, type Entry } from './registry';
import { BuildBox } from './build';
import { mintRunPass, serveRun } from './run';
import { labPage } from './landingui/labview';
import { runsPage } from './landingui/runsview';
import { howPage } from './how';
import { aboutPage, agentsHtml, buildLogPage, explorePage, privacyPage, projectPage, settingsPage, type BoxStatus } from './ui';
import { previewTabs } from './sheet';
import { catalogReadme } from './catalog';
import { STARTER, buildPayload } from './newproject';
import { buildSettingsOn, resolveBuildPlan, planFlags, crewRules, singleTask, skeletonTask, cleanEstimate, DEFAULT_PLAN } from './buildsettings';
import { suggestRoute, ideaRoute } from './buildsuggest';
import { withPicker } from './picker';
import { screenshotRoute } from './screenshot';
import { requestsRoute, myRequestsRoute } from './requests';
import { cleanStart, estimate as fleetEstimate } from './fleetjob';
import { ATTACH_TYPES, ATTACH_MAX, newAttachId, isAttachId, attachKey, composeMessage, parseMarker, attachedLines } from './attach';
import { viewShown, buildV3, catalogV3, docLabel, docRank, fixtureV3, homeV3, liveV3, needsOf, projectV3, withGlobal, withTabs, VIEW_IDS, type Docs, type Global, type InboxItem, type Nav, type ViewId } from './v3';
import { changesOf, runUrl } from './v2';
import { fixtureV2, homeV2, liveV2, projectV2, uiOf, type HomeStatus, type UI } from './v2';
import { MAX_IMPORT_KB, getRepo, nameFor, parseRepoRef, searchRepos } from './github';
import { DEFAULT_API_MODEL, isClaudeToken, onSubscription, checkApiKey, handoffEmail, handoffToken, claimHandle, clearCookie, decryptKey, encryptKey, isOwner, sessionCookie, sessionEmail, suggestHandle, userByEmail, userByHandle , billingOf } from './auth';
import { importPage } from './ui';
import { allFiles, blob, diffTrees, forkBase, head, resolvePath, tree } from './code';
import { changesPage, dirPage, filePage, type ChangeText, type FileWhy } from './codeui';
import { startingPage } from './pages';
import { personalAgentsPage } from './personal';
import { ownPage } from './own';
import { withLook } from './look';
import { Installs, installRoute } from './install';
import { TalkLog, talkRoute } from './talk';
import { TalkVoice } from './talkvoice';
import { Ledger, costSummary, costsPage, recordCost } from './costs';
import { bearerEmail, cliPublicRoute, cliUserRoute } from './cliauth';
import { pushAlert } from './alert';
// mobile-agent, newer than the image's copy: boxes unpack it at boot (box.ts).
import MA_TGZ from '../box/mobile-agent.tgz';
import MA_REV from '../box/mobile-agent.rev';

export { AgentBox, Project, Registry, BuildBox, Installs, TalkLog, Ledger, TalkVoice };
import { landingRoute } from './landing/routes';
import { contractAnswer } from './contract';
import { videoRoute } from './video';
import { projectTree, fleetTree, parseRecords, answer as intentsAnswer, memoTree } from './intents';
import * as landingHooks from './landing/hooks';
import { landingOn } from './landing/hooks';
import { boardName } from './landing/landing';
import { backlogItems, dedupePrompt, parseDedupe, fmtBoardRow, boardText, twinPrompt, parseTwin, aliasTask, type TwinCandidate } from './landing/board';
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
  const handles = JSON.parse(env.HANDLES_SECRET || env.HANDLES || '{}') as Record<string, string>;
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
      const mapped = (JSON.parse(env.HANDLES_SECRET || env.HANDLES || '{}') as Record<string, string>)[email];
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
    const mapped = (JSON.parse(env.HANDLES_SECRET || env.HANDLES || '{}') as Record<string, string>)[email];
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

/** Stop every awake box of one person's projects (their key changed, was deleted, or stopped working). Returns how many. */
async function stopUserBoxes(env: Env, handle: string, why: string): Promise<number> {
  const entries = (await registry(env).list()).filter((e) => e.slug.split('.')[0] === handle);
  let n = 0;
  for (const e of entries) {
    const pi = await projectStub(env, e.slug).info().catch(() => null);
    if (!pi) continue;
    const ids = [...pi.agents.map((a) => a.id), `${pi.slug}--router`, `${pi.slug}--router2`, `${pi.slug}--review`, `${pi.slug}--ask`, ...[2, 3, 4, 5, 6].map((k) => `${pi.slug}--review${k}`)];
    for (const id of ids) if (await boxStub(env, id).isAwake().catch(() => false)) { await boxStub(env, id).letGo(why).catch(() => {}); n++; }
  }
  log('auth', 'user_boxes_stopped', { handle, why, n });
  return n;
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
    // Landing flag billing 'gateway': Claude via AI Gateway on forq's credits instead of the plan (see aigAnthropic).
    const lfb = await env.Landing.get(env.Landing.idFromName(slug)).flags().catch(() => null);
    if (lfb?.billing === 'gateway' && env.REPLAY_GATEWAY_TOKEN) {
      const k = await agentToken(env, agentId);
      ccEnv = `ANTHROPIC_BASE_URL=${apiBase}/api/aig/anthropic ANTHROPIC_API_KEY=${k}`; keyTail = 'gateway'; billing = 'gateway';
    }
    // A landing project can pin its boxes' model (landing flags.agentModel, e.g. Sonnet for a test).
    const pinfo = await projectStub(env, slug).info();
    // Lab variants pin a model per role (plannerModel = the router, reviewerModel, coderModel).
    const lf = landingOn(pinfo) ? await env.Landing.get(env.Landing.idFromName(slug)).flags().catch(() => null) : null;
    const role = roleOf(agentId);
    const lm = lf ? (role === 'router' ? lf.plannerModel : role === 'reviewer' ? lf.reviewerModel : role === 'agent' ? lf.coderModel : undefined) || lf.agentModel : undefined;
    if (lm) ccEnv += ` ANTHROPIC_MODEL=${modelId(lm)}`;
  } else {
    const u = await userByHandle(env, owner);
    if (!u?.apiKeyEnc) throw new Error(`${owner} has not added an Anthropic API key yet (Settings)`);
    // Subscription only: a key that stopped working stops their boxes; nothing falls back to another key or plan.
    if (u.keyFailed) throw new Error(`${owner}'s Claude sign-in stopped working (${u.keyFailed.why}): connect it again in Settings`);
    const key = await decryptKey(env, u.apiKeyEnc);
    if (isClaudeToken(key)) { ccEnv = `CLAUDE_CODE_OAUTH_TOKEN=${key}`; keyTail = key.slice(-20); billing = 'sub'; }
    else { ccEnv = `ANTHROPIC_API_KEY=${key} ANTHROPIC_MODEL=${u.model || DEFAULT_API_MODEL}`; keyTail = key.slice(-20); billing = 'api'; }
  }
  // C-2 (2026-10-13): Haiku 5.5 runs with a 1M window in Claude Code and compacts only at ~967K, but its price goes x5 for a
  // prompt over 100k tokens (code.claude.com/docs/en/env-vars). Measured on real build r8b: window 100000 x 88% compacted at
  // ~66k (the percentage applies after a reserve), ~50 compactions in 13 coders, each a full cache rewrite: about as costly as
  // the surcharge it avoided. Window 125000 x 88% aims at ~88k, still under 100k. Also caps what one command or file read
  // puts into the context (defaults 30k chars / 25k tokens).
  if (/ANTHROPIC_MODEL=\S*haiku/i.test(ccEnv)) ccEnv += ' CLAUDE_CODE_AUTO_COMPACT_WINDOW=125000 CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=88';
  ccEnv += ' BASH_MAX_OUTPUT_LENGTH=15000 CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS=12000';
  if (roleOf(agentId) === 'agent') ccEnv += ' CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS=1';
  // The agent board (landing flag `board`): the box gets the hook and the prompts mention `qb-agent who`.
  const lfl = landingOn(await projectStub(env, slug).info().catch(() => null)) ? await env.Landing.get(env.Landing.idFromName(slug)).flags().catch(() => null) : null;
  const boardOn = !!lfl?.board;
  const autoLand = !!lfl?.autoMerge;   // the merge queue lands approved changes itself: the router never asks to merge
  return {
    agentId, task: r.task, role: r.role, project: slug.replace('.', '/'), remote: r.remote, gitToken: r.token, board: boardOn, autoLand,
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
  const pool = (pi: ProjectInfo) => (pi.landing ? [2, 3, 4, 5, 6].map((n) => `${pi.slug}--review${n}`) : []);
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

/** The fleet Worker (sim/fleet, qbfleet) with its key; the key never leaves this Worker. */
async function fleetCall(env: Env, path: string, body?: unknown) {
  // Over the service binding: a same-account workers.dev fetch never reached qbfleet once it bound forq's objects
  // (every call 404, 2026-10-13).
  const init = { method: body ? 'POST' : 'GET', headers: { 'x-fleet-key': env.FLEET_KEY || '', 'user-agent': 'forq-internal/1', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) };
  const r = env.FLEET ? await env.FLEET.fetch(`https://qbfleet.internal${path}`, init) : await fetch(`https://qbfleet.forqdev.workers.dev${path}`, init);
  return r.json().catch(() => ({ error: `fleet ${r.status}` }));
}
// The real builds the /runs page lists (only public ones are shown to people who are not the owner).
const REAL_BUILDS: [string, string][] = [['eyal.real-tip-splitter', 'R2'], ['eyal.real-home-inventory', 'R3'], ['eyal.real-cafe-site', 'R4'], ['eyal.real-course-builder', 'R5 flagship'],
  ['eyal.real-home-inventory-solo', 'R6'], ['eyal.real-cafe-site-solo', 'R7'], ['eyal.real-budget-tracker-10', 'proof build'], ['eyal.real-home-inventory-r8b', 'R8b']];
// The merged list, memoised per isolate for 8 s (owner and public apart): it fans out to every copy's Run (~180 after S4),
// 4.6 s cold (qb7, 2026-10-13).
const runsMemo = new Map<boolean, { at: number; p: Promise<unknown> }>();
let runsRefreshing = false;   // one background refresh of the public runs list per isolate at a time
async function runsData(env: Env, me: { handle?: string | null; admin?: boolean }) {
  const owner = !!(me.admin || (me.handle && isOwner(env, me.handle)));
  const m = runsMemo.get(owner);
  if (m && Date.now() - m.at < 8000) return m.p;
  const p = runsDataFresh(env, owner).catch((e) => { runsMemo.delete(owner); throw e; });
  runsMemo.set(owner, { at: Date.now(), p });
  return p;
}
async function runsDataFresh(env: Env, owner: boolean) {
  const fl = await fleetCall(env, '/runs') as { runs?: { repo: string; runId: string; state: string }[] };
  const rows = fl.runs || [];
  // The live status of each repo's newest run, merged in: only for runs not finished (an ended run's row already says it all).
  const latest = new Map<string, { runId: string; state: string }>(); for (const r of rows) latest.set(r.repo, r);
  const open = [...latest.entries()].filter(([, r]) => !['done', 'stopped', 'ended'].includes(r.state)).map(([repo]) => repo);
  const live = new Map(await Promise.all(open.map(async (repo) => [repo, await fleetCall(env, `/status?repo=${repo}`)] as const)));
  const fleet = rows.map((r) => { const st = live.get(r.repo) as { runId?: string } | undefined; return st && st.runId === r.runId ? { ...r, live: st } : r; });
  const real = (await Promise.all(REAL_BUILDS.map(async ([slug, label]) => {
    const info = await projectStub(env, slug).info().catch(() => null);
    if (!info || (info.private && !owner)) return null;
    const v = await env.Landing.get(env.Landing.idFromName(slug)).view(slug).catch(() => null) as any;
    return { slug, label, private: !!info.private, state: v?.run?.stopped ? 'stopped' : v?.progress?.settledAt ? 'settled' : 'running', startedAt: v?.estimate?.startedAt ?? null, settledAt: v?.progress?.settledAt ?? null,
      usd: v?.progress?.actualUsd ?? v?.progress?.spentUsd ?? null, parts: v?.build?.parts ?? null, landed: v?.build?.landed ?? null, link: `/p/${slug.replace('.', '/')}/work#/timeline` };
  }))).filter(Boolean);
  return { owner, fleet, real };
}

/** X3: tell a project's owner (Inbox notice always; a phone push unless they turned it off). Phone pushes go through the
 *  instance's Pushover, which reaches only the instance owner: others get the Inbox item. */
async function notifyOwner(env: Env, slug: string, kind: 'build-done' | 'decision', title: string, href: string) {
  const p = projectStub(env, slug);
  const info = await p.info();
  if (!info) return;
  await p.addNotice({ kind, title: title.slice(0, 200), at: Date.now(), href });
  const u = await userByHandle(env, info.owner).catch(() => null);
  const on = (u?.notify?.[kind === 'decision' ? 'decisions' : 'done']) !== false;
  const push = on && info.owner === env.OWNER_HANDLE;
  if (push) await pushAlert(env, `qodebase: ${info.name}`, title, `https://${env.UI_HOST}${href}`, 0);
  log('notify', 'sent', { slug, kind, push, on });
}

/** Your projects with changes in progress (no box calls: states from the Project DO). */
async function inboxOf(env: Env, me: string, entries: Entry[], runBase: string): Promise<InboxItem[]> {
  if (!me) return [];
  const out = await Promise.all(entries.filter((e) => e.owner === me).map(async (entry) => {
    const info = await projectStub(env, entry.slug).info().catch(() => null);
    return info ? { entry, info, open: changesOf(info, {}, runBase).open } : null;
  }));
  return out.filter((x): x is InboxItem => !!x && (x.open.length > 0 || !!x.info.notices?.length));
}
const inboxCount = (items: InboxItem[]) => items.reduce((n, it) => n + needsOf(it.open).length + (it.info.notices?.length || 0), 0);

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
  // Attached images (src/attach.ts): the box downloads them first, the text then names where they are.
  const mk = parseMarker(text);
  if (mk) {
    const got = mk.slug === projectOf(agentId) ? await box.fetchAttachments(mk.ids).catch((e) => ({ fetched: [] as string[], error: String(e) })) : { fetched: [] as string[] };
    const failed = mk.ids.filter((id) => !got.fetched.includes(id));
    log('attach', 'to_box', { agentId, fetched: got.fetched.length, failed: failed.length });
    text = attachedLines(mk.rest, got.fetched, failed);
  }
  return box.send(text);
}

const app = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // The run host serves apps. A self-hosted copy's run host also carries the boxes'
    // API calls (/api/…: no repo path starts so, repo names have a dot), because its
    // UI host is behind Access.
    // The picker (src/picker.ts) only on ?__qbpick=1 pages, for the App view's Pick (S2).
    if ((url.hostname === env.RUN_HOST || url.hostname.endsWith(`.${env.RUN_HOST}`)) && !(env.SELF_HOST && url.pathname.startsWith('/api/')))
      return withPicker(request, await serveRun(request, env, ctx), [...uiHosts(env), ...(env.UI_VARIANT_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean)].map((h) => `https://${h}`));
    // Cloudflare Issues → Notifications webhook. Its own auth (cf-webhook-auth), before the user/agent auth.
    if (url.pathname === '/api/hooks/issues' && request.method === 'POST') return issuesHook(request, env, ctx);
    // Claude through Cloudflare AI Gateway, paid from forq's unified-billing credits (2026-10-14, Eyal): a box of a project
    // whose landing flag billing is 'gateway' gets ANTHROPIC_BASE_URL = here and its own agent token as the API key. We check
    // it, drop it (x-api-key would be forwarded and unified billing would not apply), add cf-aig-authorization with the
    // gateway token (never in a box or a log) and stream Anthropic's answer back.
    if (url.pathname.startsWith('/api/aig/anthropic/')) return aigAnthropic(request, env, url);
    // Admin: landing flags for a slug that may not exist yet (a build about to be started by voice gets billing 'gateway').
    if (url.pathname === '/api/admin/landing-flags' && request.method === 'POST' && env.ADMIN_SECRET && request.headers.get('x-forq-secret') === env.ADMIN_SECRET) {
      const b = await request.json().catch(() => ({})) as { slug?: string; flags?: Record<string, unknown> };
      if (!/^[a-z0-9-]+\.[a-z0-9-]+$/.test(String(b.slug || '')) || !b.flags) return json({ error: 'slug owner.name and flags' }, 400);
      const f: Record<string, unknown> = {};
      if (b.flags.billing === 'gateway' || b.flags.billing === 'plan') f.billing = b.flags.billing;
      return json(await env.Landing.get(env.Landing.idFromName(String(b.slug))).setFlags(String(b.slug), f as never));
    }
    // GitHub push webhook for a mirror project (signed with its secret: X-Hub-Signature-256); the sync runs after the reply.
    { const mh = url.pathname.match(/^\/api\/hooks\/mirror\/([a-z0-9-]+)\/([a-z0-9-]+)$/);
      if (mh && request.method === 'POST') {
        const slug = `${mh[1]}.${mh[2]}`, body = await request.text();
        const want = 'sha256=' + await hmacHex(await mirrorSecret(env, slug), body);
        if ((request.headers.get('x-hub-signature-256') || '') !== want) { log('mirror', 'hook_refused', { slug }); return json({ error: 'bad signature' }, 401); }
        if (request.headers.get('x-github-event') === 'ping') return json({ ok: true, ping: true });
        ctx.waitUntil(syncMirror(env, slug).catch((e) => log('mirror', 'sync_failed', { slug, err: String(e).slice(0, 200) })));
        return json({ ok: true, syncing: true });
      } }
    // Public-site basics (baseline): about, privacy, robots, version, health.
    // Talk's traces as JSON with the admin key (workers.dev + x-forq-secret), for agents reviewing Talk (2026-10-13).
    if (url.pathname.startsWith('/api/talk/admin') && env.TALK && !isUiHost(env, url.hostname)) {
      const w = await who(request, env);
      if (!(w?.kind === 'user' && w.admin)) return json({ error: 'forbidden' }, 403);
      const h = new Headers(); h.set('x-talk-who', JSON.stringify({ handle: w.handle, admin: true }));
      return env.TALK.fetch(new Request(url.toString(), { method: 'GET', headers: h }));
    }
    if (isUiHost(env, url.hostname)) {
      const cf = (request as any).cf || {};
      if (url.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /p/\nDisallow: /import\nDisallow: /api/\nDisallow: /a/\nDisallow: /login\n', { headers: { 'content-type': 'text/plain' } });
      if (url.pathname === '/icon.svg') return new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="48" fill="#6a2ff0"/><circle cx="121" cy="110" r="48" fill="none" stroke="#fff" stroke-width="30"/><path d="M154 58h30v138h-30z" fill="#fff"/></svg>', { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } });
      if (url.pathname === '/version.json') return json({ name: 'qodebase', version: env.CF_VERSION_METADATA?.id || null, at: env.CF_VERSION_METADATA?.timestamp || null });
      if (url.pathname === '/health.json') return health(env, ctx, url.origin);
      if (url.pathname === '/e') return kstatsForward(request, env, ctx);
      if (url.pathname === '/feedback') return feedback(request, env);
      if (url.pathname === '/about') {
        // The site header like any page (signed in or not): one session read, no Registry list.
        const em = await sessionEmail(env, request);
        const u = em ? await userByEmail(env, em) : null;
        return html(withGlobal(aboutPage(!!env.SELF_HOST), 'home', 0, u?.handle || '', 'd'));
      }
      // The video page (src/video.ts): unlisted, before the crawler gate so link previews (WhatsApp, X) can read it.
      if (url.pathname === '/video' || url.pathname.startsWith('/video/')) { const r = await videoRoute(request, env, url); if (r) return r; }
      if (url.pathname === '/how' || url.pathname === '/how/') {
        // How qodebase works (qb3, 2026-10-12): the demo, land by intent, the board, the numbers; home stays the product.
        const em = await sessionEmail(env, request);
        const u = em ? await userByEmail(env, em) : null;
        return html(withGlobal(howPage(!!env.SELF_HOST), 'home', 0, u?.handle || '', 'd'));
      }
      // Variants lab (qb7, docs/lab/PLAN.md): public; the lab's owner (eyal) also gets "Run for real".
      if (url.pathname === '/lab' || url.pathname === '/lab/') {
        const em = await sessionEmail(env, request);
        const u = em ? await userByEmail(env, em) : null;
        return html(withGlobal(labPage({ own: u?.handle === 'eyal' }), 'home', 0, u?.handle || '', 'd'));
      }
      // Runs (qb7): every fleet run and real build, live; the owner gets pause/resume/stop (/api/runs decides).
      if (url.pathname === '/runs' || url.pathname === '/runs/') {
        const em = await sessionEmail(env, request);
        const u = em ? await userByEmail(env, em) : null;
        return html(withGlobal(runsPage({ own: !!u && isOwner(env, u.handle) }), 'home', 0, u?.handle || '', 'd'));
      }
      if (url.pathname === '/privacy') return html(privacyPage());
      if (url.pathname === '/personal-agents' && env.CF_OAUTH_CLIENT_ID) return html(personalAgentsPage());
      if (url.pathname === '/own' && !env.SELF_HOST) return html(ownPage(true));
      if (url.pathname.startsWith('/connect/cf/') || url.pathname.startsWith('/personal-agents/') || url.pathname === '/api/installs') { const r = await installRoute(request, env, ctx, url); if (r) return r; }
      // Talk's traces for the admin (Eyal, 2026-10-13): the page lives in the Talk Worker (src/talkadmin.ts).
      if (url.pathname === '/admin/talk' || url.pathname === '/admin/talk/') url.pathname = '/api/talk/admin';
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
      // Requests from people to a public project's owner (src/requests.ts, qb7): the private gate above already answers
      // 404 for someone else's private project.
      if ((m = path.match(/^\/api\/p\/([a-z0-9-]+)\/([a-z0-9-]+)\/requests(?:\/(.*))?$/))) {
        const slug = slugOf(m[1], m[2]), P = projectStub(env, slug), info0 = await P.info();
        if (!info0) return json({ error: 'no such project' }, 404);
        return requestsRoute(request, { env, me, slug, p: P, info: info0, toRouter: (payload, shown) => askRouter(env, ctx, P, slug, payload, apiBase, shown, 'person') }, m[3] || '');
      }
      if (path === '/api/me/requests' && request.method === 'GET') return myRequestsRoute(env, me, (s) => projectStub(env, s));
      // Attached images (src/attach.ts): upload and read back, the project's owner only.
      if ((m = path.match(/^\/api\/p\/([a-z0-9-]+)\/([a-z0-9-]+)\/attach(?:\/([a-z0-9.]+))?$/))) {
        const slug = slugOf(m[1], m[2]);
        const info0 = await projectStub(env, slug).info();
        if (!info0) return json({ error: 'no such project' }, 404);
        if (info0.owner !== me.handle && !me.admin) return json({ error: 'not your project' }, 403);
        if (!env.ATTACH) return json({ error: 'attachments are not set up on this copy' }, 501);
        if (request.method === 'POST' && !m[3]) {
          const type = (request.headers.get('content-type') || '').split(';')[0].trim();
          const id = newAttachId(type);
          if (!id) return json({ error: `an image: ${Object.keys(ATTACH_TYPES).join(', ')}` }, 415);
          const body = await request.arrayBuffer();
          if (!body.byteLength || body.byteLength > ATTACH_MAX) return json({ error: `an image of at most ${ATTACH_MAX / 1048576} MB` }, 413);
          const name = (request.headers.get('x-file-name') || id).replace(/[^\w. -]/g, '').slice(0, 80) || id;
          await env.ATTACH.put(attachKey(slug, id), body, { httpMetadata: { contentType: type }, customMetadata: { name, by: me.handle } });
          log('attach', 'stored', { slug, id, size: body.byteLength, type });
          return json({ id, name, type, size: body.byteLength, url: `/api/p/${m[1]}/${m[2]}/attach/${id}` });
        }
        if (request.method === 'GET' && m[3] && isAttachId(m[3])) {
          const o = await env.ATTACH.get(attachKey(slug, m[3]));
          if (!o) return json({ error: 'gone (attachments are kept 30 days)' }, 404);
          return new Response(o.body, { headers: { 'content-type': o.httpMetadata?.contentType || 'application/octet-stream', 'cache-control': 'private, max-age=86400' } });
        }
        return json({ error: 'POST an image, or GET …/attach/<id>' }, 405);
      }
      // Screenshot of the project's running app (src/screenshot.ts), stored as an attachment: owner only.
      if ((m = path.match(/^\/api\/p\/([a-z0-9-]+)\/([a-z0-9-]+)\/screenshot$/)) && request.method === 'POST') {
        const info0 = await projectStub(env, slugOf(m[1], m[2])).info();
        if (!info0) return json({ error: 'no such project' }, 404);
        if (info0.owner !== me.handle && !me.admin) return json({ error: 'not your project' }, 403);
        return screenshotRoute(request, env, ctx, info0, me.handle || info0.owner);
      }
      // Turn an existing project over to automatic landing (owner): the merge queue on, approved changes land by
      // themselves, and every change already pushed goes into the queue now (Eyal's first build sat at 'Ready to merge').
      if ((m = path.match(/^\/api\/p\/([a-z0-9-]+)\/([a-z0-9-]+)\/landing\/adopt$/)) && request.method === 'POST') {
        const slug = slugOf(m[1], m[2]);
        const P = projectStub(env, slug);
        const info0 = await P.info();
        if (!info0) return json({ error: 'no such project' }, 404);
        if (info0.owner !== me.handle && !me.admin) return json({ error: 'not your project' }, 403);
        await P.setLanding(true);
        await env.Landing.get(env.Landing.idFromName(slug)).setFlags(slug, { autoMerge: true });
        const info = (await P.info())!;
        const queued: string[] = [];
        for (const a of info.agents.filter((x) => x.state === 'pushed')) {
          await landingHooks.onPushed(env, ctx, info, a.id, a.note || '', 'none').catch((e) => log('landing', 'adopt_failed', { id: a.id, err: String(e) }));
          queued.push(a.id);
        }
        // The router may be waiting for a 'merge' it will never get: tell it.
        if (info.agents.length) ctx.waitUntil(sendTo(env, `${slug}--router`, 'Merging is automatic now: approved changes land through the merge queue by themselves. Never ask the person to merge; keep going until the request is done and report progress briefly.', apiBase).catch(() => null));
        log('landing', 'adopt', { slug, queued });
        return json({ ok: true, landing: true, autoMerge: true, queued });
      }
      // The landing system (qb6, src/landing/routes.ts): /api/p/<o>/<n>/landing[/<verb>].
      if ((m = path.match(/^\/api\/p\/([a-z0-9-]+)\/([a-z0-9-]+)\/landing(?:\/([a-z-]+))?$/))) {
        const info = await projectStub(env, slugOf(m[1], m[2])).info();
        return info ? landingRoute(request, env, info, m[3] || '', me) : json({ error: 'no such project' }, 404);
      }
      // The intent tree (qb5, src/intents.ts): request -> areas -> intents -> change, status rolled up. Same readers as /landing.
      if ((m = path.match(/^\/api\/p\/([a-z0-9-]+)\/([a-z0-9-]+)\/intents$/)) && request.method === 'GET') {
        const info = await projectStub(env, slugOf(m[1], m[2])).info();
        if (!info) return json({ error: 'no such project' }, 404);
        // One Landing view per project per 5 s per isolate, however many viewers and open nodes.
        const T = await memoTree(`p:${info.slug}`, 5_000, async () => projectTree(info as any, await env.Landing.get(env.Landing.idFromName(info.slug)).view(info.slug) as any));
        return json(intentsAnswer(T, url.searchParams));
      }
      // The team's contract (qb5, src/contract.ts): the skeleton's contracts file on main + the changes that created/edited it.
      if ((m = path.match(/^\/api\/p\/([a-z0-9-]+)\/([a-z0-9-]+)\/contract$/)) && request.method === 'GET') {
        const info = await projectStub(env, slugOf(m[1], m[2])).info();
        if (!info) return json({ error: 'no such project' }, 404);
        const view = await env.Landing.get(env.Landing.idFromName(info.slug)).view(info.slug).catch(() => null) as any;
        return json(await contractAnswer(env, ctx, info as any, view || {}));
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
        const mine = (await listFor(env, me.handle, me.admin, true)).filter((e) => e.owner === u.handle).length;
        const page = settingsPage(u, onSubscription(env, u.handle), mine, url.searchParams.has('welcome'), await registry(env).cliTokens(u.email));
        return html(tabsNav ? withGlobal(page, 'account', (await globalOf()).inbox, u.handle, ui as Nav) : page);
      }
      // Is a Claude plan or API key connected (qb7: the phone tab re-checks after the person connected on a computer)? No secrets.
      if (path === '/api/me/key' && request.method === 'GET') {
        const u = await userByEmail(env, me.email || '');
        if (!u) return json({ error: 'Sign in first' }, 401);
        const kind = onSubscription(env, u.handle) ? 'plan' : u.apiKeyEnc ? (u.apiKeyKind || 'api') : null;
        return json({ kind, tail: u.apiKeyEnc ? u.apiKeyTail || null : null, ...(u.keyFailed ? { failed: u.keyFailed } : {}) });
      }
      // qb7's /runs page: the fleet runs (qbfleet Worker, its key stays here) + the real builds. Public read; control owner-only.
      if (path === '/api/runs' && request.method === 'GET') {
        // Everyone but the owner gets the same list: kept at the edge, fresh for 30 s, then served stale while one refresh
        // runs (desktop walk 2026-10-14: a fresh browser waited 5-17 s for it and the page gave up; the fleet's own list
        // took 6 s). The owner's (private builds included) is always computed.
        if (me.admin || (me.handle && isOwner(env, me.handle))) return json(await runsData(env, me));
        const ck = new Request('https://runs.cache/api/runs?v=1');
        const fresh = async () => {
          const t0 = Date.now(), body = JSON.stringify(await runsData(env, {}));
          await caches.default.put(ck, new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600', 'x-at': String(Date.now()) } }));
          console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', module: 'runs', event: 'list_refreshed', ms: Date.now() - t0, bytes: body.length }));
          return body;
        };
        const hit = await caches.default.match(ck);
        const age = hit ? Date.now() - Number(hit.headers.get('x-at') || 0) : Infinity;
        if (hit && age > 30_000 && !runsRefreshing) { runsRefreshing = true; ctx.waitUntil(fresh().catch((e) => console.log(JSON.stringify({ level: 'error', module: 'runs', event: 'refresh_failed', err: String(e) }))).finally(() => { runsRefreshing = false; })); }
        const body = hit ? await hit.text() : await fresh();
        return new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-runs-age': String(Number.isFinite(age) ? Math.round(age / 1000) : 0) } });
      }
      if ((m = path.match(/^\/api\/runs\/(fleet-[a-z0-9-]{1,40})\/([a-z0-9]{4,20})\/(series|timeline)$/)) && request.method === 'GET') return json(await fleetCall(env, `/series?repo=${m[1]}&run=${m[2]}`));
      // /runs v2 drill-down (qb7), public reads, bounded by the fleet (<= 200 rows, offset paging).
      if (request.method === 'GET' && (m = path.match(/^\/api\/runs\/(fleet-[a-z0-9-]{1,40})\/([a-z0-9]{4,20})\/(agents|agent\/(\d{1,5})|slice|change|commits|commit\/([0-9a-f]{40})|indexcheck)$/))) {
        const q = url.searchParams, pg = `&offset=${Math.max(0, Number(q.get('offset')) || 0)}&limit=${Math.min(200, Number(q.get('limit')) || 200)}`;
        const base = `repo=${m[1]}&run=${m[2]}`;
        if (m[3] === 'agents') return json(await fleetCall(env, `/agents?${base}${pg}`));
        if (m[4]) return json(await fleetCall(env, `/agents?${base}&agent=${m[4]}${pg}`));
        if (m[3] === 'slice') return json(await fleetCall(env, `/slice?${base}&t=${Number(q.get('t')) || 0}&to=${Number(q.get('to')) || 0}${pg}`));
        // The hotspot job's checker: docs/API.md on main has every landed declaration exactly once, sorted.
        // a run without an index job has no docs/API.md to check: answer 'not applicable', not a 500 (submission review H1)
        if (m[3] === 'indexcheck') { try { return json(await fleetCall(env, `/indexcheck?${base}`)); } catch (e) { console.log(JSON.stringify({ module: 'runs', event: 'indexcheck_na', repo: m[1], run: m[2], error: String(e).slice(0, 160) })); return json({ notApplicable: true, error: String(e).slice(0, 160) }); } }
        if (m[3] === 'commits') return json(await fleetCall(env, `/commits?${base}&t=${Number(q.get('t')) || 0}&to=${Number(q.get('to')) || 0}${pg}`));
        if (m[5]) return json(await fleetCall(env, `/commit?${base}&sha=${m[5]}`));
        const sha = /^[0-9a-f]{40}$/.test(String(q.get('sha') || '')) ? `&sha=${q.get('sha')}` : '';
        return json(await fleetCall(env, `/file?${base}&path=${encodeURIComponent(String(q.get('file') || '').slice(0, 300))}${sha}`));
      }
      // A fleet run's intent tree (qb5, src/intents.ts): folders nested by path, each file's status rolled up; 10k files paged.
      if (request.method === 'GET' && (m = path.match(/^\/api\/runs\/(fleet-[a-z0-9-]{1,40})\/([a-z0-9]{4,20})\/intents$/))) {
        const [repo, run] = [m[1], m[2]];
        const t0 = Date.now(), ms: Record<string, number> = {};
        // An ended run never changes: its answers are kept at the edge for a day (qb8: the first open took 13.5 s cold).
        const qs = [...url.searchParams.entries()].sort().map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
        const ck = new Request(`https://intents.cache/${repo}/${run}?${qs}`);
        const hit = await caches.default.match(ck);
        if (hit) { console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', module: 'intents', event: 'run_edge_hit', repo, run, ms: Date.now() - t0 })); return hit; }
        const st = await fleetCall(env, `/status?repo=${repo}`) as { runId?: string; state?: string; files?: number; counts?: Record<string, number> };
        ms.status = Date.now() - t0;
        const live = st.runId === run && !['done', 'stopped', 'ended'].includes(String(st.state));
        const T = await memoTree(`${repo}/${run}`, live ? 15_000 : 3_600_000, async () => {
          const ri = { headers: { 'x-fleet-key': env.FLEET_KEY || '', 'user-agent': 'forq-internal/1' } };
          const t1 = Date.now();
          // The title comes from the runs list (server side), never from the request; fetched alongside the records.
          const rowP = runsData(env, me).catch(() => null);
          const r = env.FLEET ? await env.FLEET.fetch(`https://qbfleet.internal/records?repo=${repo}&run=${run}`, ri) : await fetch(`https://qbfleet.forqdev.workers.dev/records?repo=${repo}&run=${run}`, ri);
          if (!r.ok) throw new Error(`fleet records ${r.status}`);
          const recs = parseRecords(await r.text());
          ms.records = Date.now() - t1;
          const row = ((await rowP) as { fleet?: { repo: string; runId: string; label?: string; intent?: string }[] } | null)?.fleet?.find((x) => x.repo === repo && x.runId === run);
          ms.runs = Date.now() - t1;
          const t2 = Date.now();
          const T = fleetTree(recs, { label: row?.label || repo, intent: row?.intent, stopped: st.runId === run && st.state === 'stopped', pending: live && st.files ? Math.max(0, st.files - recs.length) : 0 });   // an ended run has nothing still to start
          ms.build = Date.now() - t2; ms.files = recs.length;
          return T;
        });
        const out = json(intentsAnswer(T, url.searchParams));
        console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', module: 'intents', event: 'run_answer', repo, run, live, ...ms, total: Date.now() - t0 }));
        // Kept only when the run has ended and it is public data (no owner-only fields in it).
        if (!live && st.runId) { const c = out.clone(); const h = new Headers(c.headers); h.set('cache-control', 'public, max-age=86400'); ctx.waitUntil(caches.default.put(ck, new Response(c.body, { status: 200, headers: h }))); }
        return out;
      }
      if (request.method === 'GET' && (m = path.match(/^\/api\/runs\/ladder\/([A-Za-z0-9-]{1,20})\/series$/))) return json(await fleetCall(env, `/ladder-series?ladder=${m[1]}`));
      // Start a fleet job from the app (qb7, src/fleetjob.ts): owner/admin only; the fleet key stays here (fleetCall).
      if (path === '/api/runs/copies' || path === '/api/runs/count' || path === '/api/runs/estimate' || path === '/api/runs/start') {
        if (!(me.admin || (me.handle && isOwner(env, me.handle)))) return json({ error: 'owner only' }, 403);
        if (path === '/api/runs/copies' && request.method === 'GET') return json(await fleetCall(env, '/copies'));
        if (path === '/api/runs/count' && request.method === 'GET') {
          const repo = url.searchParams.get('repo') || '', root = url.searchParams.get('root') || '';
          if (!/^fleet-[a-z0-9-]{1,40}$/.test(repo) || !/^[\w.\-/]{0,120}$/.test(root)) return json({ error: 'repo and folder' }, 400);
          return json(await fleetCall(env, `/count?repo=${repo}&root=${encodeURIComponent(root)}`));
        }
        const b = await request.json().catch(() => ({})) as Record<string, unknown>;
        const c = cleanStart(b);
        if ('error' in c) return json(c, 400);
        if (path === '/api/runs/estimate' && request.method === 'POST') return json(fleetEstimate({ files: Number(b.files) || 0, models: c.models, agents: c.agents, budgetUsd: c.budgetUsd, job: c.job, overflow: c.overflow }) || { error: 'Pick a copy with files.' });
        if (path === '/api/runs/start' && request.method === 'POST') {
          const r = await fleetCall(env, '/start', c) as { runId?: string; error?: string };
          log('fleet', 'job_start', { by: me.handle || 'admin', repo: c.repo, root: c.root, agents: c.agents, budgetUsd: c.budgetUsd, job: c.job || 'comments', runId: r.runId || null, error: r.error || null });
          return json(r.runId ? { ...r, repo: c.repo } : r, r.runId ? 200 : 409);
        }
        return json({ error: 'GET copies, POST estimate or start' }, 405);
      }
      if ((m = path.match(/^\/api\/runs\/(fleet-[a-z0-9-]{1,40})\/(pause|resume|stop)$/)) && request.method === 'POST') {
        if (!(me.admin || (me.handle && isOwner(env, me.handle)))) return json({ error: 'owner only' }, 403);
        const b = await request.json().catch(() => ({})) as { why?: string };
        return json(await fleetCall(env, `/${m[2]}`, { repo: m[1], why: String(b.why || `${m[2]} from /runs by ${me.handle || 'admin'}`).slice(0, 200) }));
      }
      // X3: build-done / decision pushes (qb7's Settings). push says whether this person can get a phone push at all.
      if (path === '/api/me/notify' && (request.method === 'GET' || request.method === 'POST')) {
        const u = await userByEmail(env, me.email || '');
        if (!u) return json({ error: 'Sign in first' }, 401);
        let n = { done: u.notify?.done !== false, decisions: u.notify?.decisions !== false };
        if (request.method === 'POST') {
          const b = await request.json().catch(() => ({})) as { done?: unknown; decisions?: unknown };
          n = { done: typeof b.done === 'boolean' ? b.done : n.done, decisions: typeof b.decisions === 'boolean' ? b.decisions : n.decisions };
          await registry(env).putUser({ ...u, notify: n });
        }
        return json({ ...n, push: u.handle === env.OWNER_HANDLE ? 'pushover' : 'none' });
      }
      if (path.startsWith('/api/me/') && request.method !== 'GET') {
        const u = await userByEmail(env, me.email || '');
        if (!u) return json({ error: 'Sign in first' }, 401);
        if (path === '/api/me/key' && request.method === 'POST') {
          const { key } = await request.json() as { key?: string };
          const k = String(key || '').trim();
          const c = await checkApiKey(k);
          if (!c.ok) return json({ error: c.error }, 400);
          // A plan token (claude setup-token) is checked with one tiny run of the real claude binary; never by an API call.
          const kind: 'plan' | 'api' = isClaudeToken(k) ? 'plan' : 'api';
          if (kind === 'plan') {
            const pc = await env.BuildBox.get(env.BuildBox.idFromName('keycheck')).checkClaude(k);
            if (!pc.ok) return json({ error: pc.error }, 400);
          }
          const { keyFailed, ...clean } = u;
          await registry(env).putUser({ ...clean, apiKeyEnc: await encryptKey(env, k), apiKeyTail: k.slice(-4), apiKeyCheckedAt: Date.now(), apiKeyKind: kind });
          // Boxes still running on the previous key keep it until they sleep: stop them now.
          ctx.waitUntil(stopUserBoxes(env, u.handle, 'key changed'));
          log('auth', 'api_key_saved', { handle: u.handle, kind, hadFailed: !!keyFailed });
          return json({ ok: true, tail: k.slice(-4), kind });
        }
        if (path === '/api/me/key' && request.method === 'DELETE') {
          const { apiKeyEnc, apiKeyTail, apiKeyCheckedAt, apiKeyKind, keyFailed, ...rest } = u;
          await registry(env).putUser(rest);
          ctx.waitUntil(stopUserBoxes(env, u.handle, 'key deleted'));
          log('auth', 'api_key_deleted', { handle: u.handle });
          return json({ ok: true });
        }
        if (path === '/api/me/handle' && request.method === 'POST') {
          const { handle } = await request.json() as { handle?: string };
          if ((await listFor(env, me.handle, me.admin, true)).some((e) => e.owner === u.handle)) return json({ error: 'You already own projects under this name, so it cannot change.' }, 400);
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
      if (path === '/api/build/idea' && request.method === 'POST') {
        if (!me.handle || !buildSettingsOn(env.BUILD_SETTINGS, me.handle, env.OWNER_HANDLE)) return json({ error: 'not available' }, 404);
        return ideaRoute(request, env, ctx, me.handle);
      }
      if (path === '/api/build/suggest' && request.method === 'POST') {
        if (!me.handle || !buildSettingsOn(env.BUILD_SETTINGS, me.handle, env.OWNER_HANDLE)) return json({ error: 'not available' }, 404);
        return suggestRoute(request, env, ctx, me.handle);
      }
      if (path === '/api/build' && request.method === 'POST') {
        if (!me.handle) return json({ error: 'Sign in first' }, 401);
        const b = await request.json().catch(() => ({})) as { name?: string; prompt?: string; private?: boolean; settings?: unknown; estimate?: unknown };
        const prompt = String(b.prompt || '').trim().slice(0, 3000);
        if (prompt.length < 4) return json({ error: 'Say what to build' }, 400);
        if (!onSubscription(env, me.handle)) {
          const bu = await userByHandle(env, me.handle);
          if (!bu?.apiKeyEnc) return json({ error: 'Connect your Claude plan or add an Anthropic API key first', need: 'key' }, 400);
          if (bu.keyFailed) return json({ error: `Your Claude sign-in stopped working (${bu.keyFailed.why}). Connect it again first.`, need: 'key' }, 400);
        }
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
        // Build settings (Adjust): only with the flag on for this person; otherwise (and with no settings) today's Build.
        // Adjust settings (flag on for this person) or, by default, one Opus agent with the merge queue landing on its own.
        const plan = (buildSettingsOn(env.BUILD_SETTINGS, me.handle, env.OWNER_HANDLE)
          ? resolveBuildPlan(b.settings, { maxCoders: isOwner(env, me.handle) ? Number(env.OWNER_MAX_CODERS) || 12 : Number(env.MAX_AGENTS_PER_PROJECT) || 6 }) : null) || DEFAULT_PLAN;
        if (plan) {
          await p.setLanding(true);
          await env.Landing.get(env.Landing.idFromName(slug)).setFlags(slug, planFlags(plan));
          // One agent with the whole job (Fastest); an empty project (self-host) goes through the router, told to start one.
          if (plan.kind === 'single' && starter) await spawn(env, ctx, slug, singleTask(prompt, false), apiBase);
          else if (plan.kind === 'crew' && starter) {
            // B-3 (2026-10-13): the skeleton starts now, while the router plans the rest (it waited ~35 s for the router's
            // wake and plan), and the first reviewer and the merger box warm up so they are ready when it pushes.
            await spawn(env, ctx, slug, skeletonTask(prompt), apiBase, { skeleton: true });
            await askRouter(env, ctx, p, slug, buildPayload(prompt, false) + '\n\n' + crewRules(plan, true), apiBase, prompt);
            ctx.waitUntil(Promise.all([
              plan.reviewers > 0 ? wake(env, `${slug}--review`, apiBase).then((r) => log('build', 'warm_reviewer', { slug, ...r })) : null,
              env.MergeBox.get(env.MergeBox.idFromName(`${slug}--merge`)).warm().then((r) => log('build', 'warm_merger', { slug, ...r })),
            ]).catch((e) => log('build', 'warm_failed', { slug, err: String(e) })));
          }
          else await askRouter(env, ctx, p, slug, buildPayload(prompt, !starter) + '\n\n' + (plan.kind === 'crew' ? crewRules(plan) : 'Start exactly ONE agent with the whole job; do not split it.'), apiBase, prompt);
        } else await askRouter(env, ctx, p, slug, buildPayload(prompt, !starter), apiBase, prompt);
        // The estimate the page showed (estimate vs elapsed bar), stamped with the start.
        const est = buildSettingsOn(env.BUILD_SETTINGS, me.handle, env.OWNER_HANDLE) ? cleanEstimate(b.estimate, plan) : null;
        if (est) await env.Landing.get(env.Landing.idFromName(slug)).setBuild(slug, est);
        log('build', 'started', { slug, chars: prompt.length, estimate: est ? { wallS: est.wallS, apiUsd: est.apiUsd, basis: est.basis } : null, plan: plan ? { kind: plan.kind, preset: plan.preset, ...(plan.kind === 'crew' ? { coders: plan.coders, reviewers: plan.reviewers, board: plan.board } : {}) } : null });
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
      if (views && (m = path.match(/^\/p\/([a-z0-9-]+)\/([a-z0-9-]+)(?:\/(readme|changes|app|history|more|agents|errors|about|work|asks|requests))?\/?$/))) {
        const slug = slugOf(m[1], m[2]);
        const p = projectStub(env, slug);
        const info = await p.info();
        if (!info) return new Response('No such project', { status: 404 });
        const all = await listFor(env, me.handle, me.admin);
        const own = info.owner === me.handle;
        if (own && info.notices?.length) ctx.waitUntil(p.clearNotices().catch(() => {}));   // X3: the owner has seen them
        const st = own ? await statusesOf(env, info) : { status: {}, router: { awake: false, cc: 'asleep' }, reviewer: { awake: false, cc: 'asleep' } };
        // Estimate vs elapsed (Build): the Changes tab reads info.estimate / info.progress.
        const bi0 = { ...(await env.Landing.get(env.Landing.idFromName(slug)).pageExtras().catch(() => null)), billing: await billingOf(env, slug.split('.')[0]) };
        return html(projectV3({ info: bi0 ? { ...info, ...bi0 } : info, entry: all.find((e) => e.slug === slug)!, forks: all.filter((e) => e.forkedFrom === slug), overview: await p.overview(),
          me: me.handle, runBase, liveHtml: '', view: m[3] === 'about' ? 'readme' : (m[3] as ViewId) || null, tryAgent: url.searchParams.get('try') || undefined, ...st,
          docs: viewShown(m[3] || null, own, info) === 'readme' ? await docsOf(env, ctx, info, url.searchParams.get('doc')) : undefined,
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
        if (verb === '' && request.method === 'GET') {
          // Estimate vs elapsed (Build): the estimate shown and the progress, when the project was built with one.
          const bi = { ...(await env.Landing.get(env.Landing.idFromName(slug)).pageExtras().catch(() => null)), billing: await billingOf(env, slug.split('.')[0]) };
          // Visitors never see the owner's notices (a request's words and handle) or the requests counters (critique).
          const pub = info.owner === me.handle || me.admin ? info : (({ notices: _n, requestsOpen: _o, requestsOff: _f, waiting: _w, ...rest }) => rest)(info);
          return json(bi ? { ...pub, ...bi } : pub);
        }
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
        // G4 Asks: every request the router got and every board task, with what became of it (src/landing/asks.ts).
        if (verb === 'asks' && request.method === 'GET') {
          const ld = await env.Landing.get(env.Landing.idFromName(slug)).asksData().catch(() => null);
          const last = info.lastRequest;
          const reqs = info.requests?.length ? info.requests : last ? [{ text: last.text, at: last.at, from: last.from }] : [];
          return json(buildAsks({ requests: reqs.map((r) => ({ ...r, state: last && r.at === last.at ? last.state : 'sent' })),
            changes: ld?.changes || [], lists: ld?.lists || [], done: ld?.done || [], claims: ld?.claims || {}, aliases: ld?.aliases || [], gitPushes: ld?.gitPushes || [],
            notes: ld?.notes || [], owner: info.owner === me.handle || !!me.admin, base: `/p/${slug.replace('.', '/')}` }));
        }
        if (info.owner !== me.handle && !me.admin) return json({ error: 'not your project' }, 403);
        if (verb === 'main-token' && request.method === 'POST' && me.admin) return json(await p.mainToken());
        // Admin: make this project a mirror of a public GitHub repo ({github: 'owner/repo', branch}) and sync it now; the
        // answer carries the webhook secret to set on GitHub (push events -> /api/hooks/mirror/<owner>/<name>).
        if (verb === 'mirror' && request.method === 'POST' && me.admin) {
          const b = await request.json().catch(() => ({})) as { github?: string; branch?: string };
          if (!/^[\w.-]+\/[\w.-]+$/.test(String(b.github || ''))) return json({ error: 'github: owner/repo' }, 400);
          await p.setMirror(String(b.github), String(b.branch || 'main'));
          const r = await syncMirror(env, slug);
          return json({ ...r, webhook: `https://${env.UI_HOST}/api/hooks/mirror/${slug.replace('.', '/')}`, secret: await mirrorSecret(env, slug) });
        }
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
        if (verb === 'notify' && request.method === 'POST' && me.admin) {   // X3: Landing says a build finished
          const b = await request.json().catch(() => ({})) as { kind?: string; title?: string; href?: string };
          await notifyOwner(env, slug, b.kind === 'decision' ? 'decision' : 'build-done', String(b.title || 'Build finished'), String(b.href || `/p/${slug.replace('.', '/')}`));
          return json({ ok: true });
        }
        if (verb === 'description' && request.method === 'POST') {
          const b = await request.json().catch(() => ({})) as { description?: string };
          if (!String(b.description || '').trim()) return json({ error: 'description required' }, 400);
          return json({ ok: true, description: await p.setDescription(String(b.description)) });
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
          const bi1 = { ...(await env.Landing.get(env.Landing.idFromName(info.slug)).pageExtras().catch(() => null)), billing: await billingOf(env, info.owner) };
          return json({ html: liveV3(url.searchParams.get('view') || 'changes', { info: bi1 ? { ...info, ...bi1 } : info, me: me.handle, runBase, ...st, entry: undefined as unknown as Entry, forks: [], overview: { commits: [], files: [], readme: null }, liveHtml: '' }) });
        }
        if (verb === 'agents-html') return json({ html: await renderAgents(env, info, runBase, uiFor(request, env)), tabs: previewTabs(info, runBase) });
        if (verb === 'agents' && request.method === 'POST') {
          const b = await request.json() as { task?: string };
          return json(await spawn(env, ctx, slug, String(b.task || ''), apiBase));
        }
        if (verb === 'router' && request.method === 'POST') {
          const b = await request.json() as { text?: string; attachments?: unknown; context?: unknown; from?: string };
          const text = String(b.text || '').trim();
          if (!text || text.length > 8000) return json({ error: 'say something (max 8000 chars)' }, 400);
          // Attached images and picked elements (src/attach.ts) ride along; the page quotes the person's words.
          const msg = composeMessage(text, slug, b.attachments, b.context);
          return json(await askRouter(env, ctx, p, slug, msg.text, apiBase, text, b.from === 'talk' ? 'talk' : 'person'));
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
          const b = await request.json() as { agent?: string; reviewer?: string; style?: string };
          // reviewer: one of a landing project's pool (<slug>--review, --review2…); default the single one.
          const rv = b.reviewer && new RegExp(`^${slug.replace('.', '\\.')}--review\\d*$`).test(b.reviewer) ? b.reviewer : undefined;
          const r = await dispatchReview(env, p, slug, apiBase, String(b.agent || ''), rv, b.style === 'adversarial' ? 'adversarial' : 'read');
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
          const b = await request.json() as { agent?: string; notes?: string };
          const a = info.agents.find((x) => x.id === b.agent);
          // G5: the owner's own note ("Ask for changes"): on a landing project through Landing (record + outbox).
          if (a && typeof b.notes === 'string' && b.notes.trim()) {
            if (landingOn(info)) { const r = await env.Landing.get(env.Landing.idFromName(slug)).sendBack(a.id, b.notes, me.handle || 'owner'); return json(r, r.ok ? 200 : (r as { status?: number }).status || 400); }
            const r = await sendTo(env, a.id, `The project's owner asked for changes:\n\n${b.notes.trim().slice(0, 4000)}\n\nMake them, commit, push with \`qb-agent push\`, then run \`qb-agent status pushed "<what you changed>"\`.`, apiBase);
            if (r.ok) await p.setState(a.id, 'working');
            return json(r, r.ok ? 200 : 502);
          }
          if (!a?.review?.notes) return json({ error: 'no review notes for that agent' }, 400);
          const r = await sendTo(env, a.id, `The reviewer asked for changes:\n\n${a.review.notes}\n\nFix them, commit, push with \`qb-agent push\`, then run \`qb-agent status pushed "<what you changed>"\`.`, apiBase);
          if (r.ok) { await p.markReviewSent(a.id); await p.setState(a.id, 'working'); }
          return json(r, r.ok ? 200 : 502);
        }
        if (verb === 'merge' && request.method === 'POST') {
          const b = await request.json() as { agent?: string };
          const a = info.agents.find((x) => x.id === b.agent);
          if (!a) return json({ error: 'unknown agent' }, 404);
          // Landing projects: the merge tap queues the change (src/landing/), no router turn.
          if (landingOn(info)) return json({ queued: true, change: await landingHooks.onMerge(env, slug, a.id) });
          return json(await askRouter(env, ctx, p, slug, `Merge agent ${a.id} into the project's main line: run \`qb-agent merge ${a.id}\` and tell me the result in one line.`, apiBase, `Merge ${a.id.split('--')[1]}`, 'merge'));
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
          const { text, attachments, context } = await request.json() as { text?: string; attachments?: unknown; context?: unknown };
          if (!text) return json({ error: 'text required' }, 400);
          return json(await sendTo(env, id, composeMessage(text, projectOf(id), attachments, context).text, apiBase));
        }
        if (verb === 'exec' && me.admin) return json(await box.adminExec(await request.text()));
        // Admin: set an agent's state by hand (an abandoned build's agent that never got its task, 2026-10-13).
        if (verb === 'mark' && me.admin && request.method === 'POST') {
          const b = await request.json().catch(() => ({})) as { state?: string; note?: string };
          if (!['working', 'pushed', 'merged', 'stopped', 'blocked'].includes(String(b.state))) return json({ error: 'state: working|pushed|merged|stopped|blocked' }, 400);
          await projectStub(env, projectOf(id)).setState(id, b.state as 'stopped', String(b.note || 'marked by an admin').slice(0, 200));
          return json({ ok: true, id, state: b.state });
        }
        if (verb === 'busy' && me.admin) return json({ busy: await box.busy() });
        if (verb === 'reset' && me.admin) { await box.destroy(); return json(await wake(env, id, apiBase)); }
      }

      // ---- admin: delete a repo (cleanup)
      // Every Build's estimate and, once settled, what it really took (Landing meta, durable): for refitting the predictor.
      if (path === '/api/admin/build-estimates' && me.admin) {
        const rows = [];
        for (const e of await registry(env).list()) {
          const x = await env.Landing.get(env.Landing.idFromName(e.slug)).pageExtras().catch(() => null) as { estimate?: unknown; progress?: unknown } | null;
          if (x?.estimate) rows.push({ slug: e.slug, estimate: x.estimate, progress: x.progress });
        }
        return json({ builds: rows });
      }
      // The cost Ledger's raw daily rows for one person (and optionally one project): token columns per model row,
      // for the predictor's refit after real builds (qb4, 2026-10-12). Admin only.
      if (path === '/api/admin/ledger' && request.method === 'GET' && me.admin) {
        const handle = url.searchParams.get('handle') || me.handle || '', proj = url.searchParams.get('project') || '';
        const rows = await env.Ledger.get(env.Ledger.idFromName(handle)).rows(Math.min(30, Number(url.searchParams.get('days')) || 7));
        return json({ handle, rows: proj ? rows.filter((r) => r.project === proj || r.project.startsWith(`${proj}:`) || r.project === proj.replace('/', '.')) : rows });
      }
      // A box saw Claude Code's auth error for a person's own key (box.ts): mark it failed, stop all their boxes.
      if (path === '/api/admin/key-failed' && request.method === 'POST' && me.admin) {
        const b = await request.json() as { handle?: string; why?: string };
        const handle = String(b.handle || '');
        if (!handle || onSubscription(env, handle)) return json({ ok: false, error: 'not a key owner' }, 400);
        const ku = await userByHandle(env, handle);
        if (!ku?.apiKeyEnc) return json({ ok: false, error: 'no key' }, 404);
        if (!ku.keyFailed) await registry(env).putUser({ ...ku, keyFailed: { at: Date.now(), why: String(b.why || 'Claude rejected the sign-in').slice(0, 200) } });
        const stopped = await stopUserBoxes(env, handle, 'key failed');
        log('auth', 'key_failed', { handle, why: b.why, stopped });
        return json({ ok: true, stopped });
      }
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
      // /p/<owner> alone (Eyal landed there from Talk): your own projects, or Explore for someone else's.
      if ((m = path.match(/^\/p\/([a-z0-9-]+)\/?$/))) return Response.redirect(new URL(m[1] === me.handle ? '/mine' : '/explore', url).toString(), 302);
      // A browser never gets raw JSON for a page that does not exist.
      if (!path.startsWith('/api/') && (request.headers.get('accept') || '').includes('text/html'))
        return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found · qodebase</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:48px 16px;max-width:520px;margin:auto;color:#222}a{color:#0a58ca}@media(prefers-color-scheme:dark){body{background:#111;color:#ddd}a{color:#7ab0ff}}</style><h1 style="font-size:22px">Nothing here</h1><p>This page does not exist, or it is private.</p><p><a href="/">Home</a> · <a href="/explore">Explore projects</a></p>`, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
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
  // Artifacts events (events.ts): pushes to project mains + project repo lifecycle, from queue forq-artifacts-events.
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> { await handleArtifactsBatch(batch, env); },
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    request = fromFront(request, env);
    return pageCache(request, env, ctx, () => serveUi(request, env, ctx));
  },
} satisfies ExportedHandler<Env>;

// Signed-out project pages from the edge (Eyal, 2026-10-14: switching a project's tabs felt slow; each view took 220-590
// ms to render on the server). GET /p/<o>/<n>[/readme|/code/…|/history|/app] with no session and no Access cookie: kept
// in caches.default for up to 5 min, refreshed in the background once older than 30 s (stale-while-revalidate). Never
// kept: anything with a session, a Set-Cookie, a non-200 or non-HTML answer. Private projects answer 404 signed out.
const PC_PATH = /^\/p\/[a-z0-9-]+\/[a-z0-9-]+(\/(readme|history|app|code(\/.*)?))?\/?$/;
const pcBusy = new Set<string>();
async function pageCache(request: Request, env: Env, ctx: ExecutionContext, serve: () => Promise<Response>): Promise<Response> {
  const u = new URL(request.url), ck = request.headers.get('cookie') || '';
  const ok = request.method === 'GET' && isUiHost(env, u.hostname) && PC_PATH.test(u.pathname) && ![...u.searchParams.keys()].some((k) => k !== 'doc')
    && !/(^|;\s*)(forq_session|CF_Authorization)=/.test(ck) && !request.headers.get('authorization');
  if (!ok) return serve();
  // Keyed by the deployed version: a deploy never serves the previous code's pages (qb6, 2026-10-14: it kept a fixed bug live).
  const ver = (env as { CF_VERSION_METADATA?: { id?: string } }).CF_VERSION_METADATA?.id || 'v';
  const key = new Request(`https://pagecache.internal/${ver}${u.pathname}${u.search}`);
  const fresh = async () => {
    const res = await serve();
    if (res.status !== 200 || !(res.headers.get('content-type') || '').startsWith('text/html') || res.headers.has('set-cookie')) return res;
    const body = await res.arrayBuffer();
    const h = new Headers(res.headers); h.set('x-pc-at', String(Date.now())); h.set('cache-control', 'public, max-age=300');
    await caches.default.put(key, new Response(body, { status: 200, headers: h }));
    return new Response(body, { status: 200, headers: res.headers });
  };
  const hit = await caches.default.match(key);
  if (hit) {
    const age = Date.now() - Number(hit.headers.get('x-pc-at') || 0);
    if (age > 30_000 && !pcBusy.has(key.url)) { pcBusy.add(key.url); ctx.waitUntil(fresh().catch((e) => log('pagecache', 'refresh_failed', { path: u.pathname, err: String(e) })).finally(() => pcBusy.delete(key.url))); }
    const h = new Headers(hit.headers); h.set('cache-control', 'no-store'); h.set('x-page-cache', `hit ${Math.round(age / 1000)}s`); h.delete('x-pc-at');
    return new Response(hit.body, { status: 200, headers: h });
  }
  return fresh();
}

async function serveUi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  {
    let res = await app.fetch(request, env, ctx);
    res = await withRunPasses(request, env, res);
    const u = new URL(request.url);
    if (!isUiHost(env, u.hostname)) return res;
    res = await withBaseline(request, env, res);
    // Build settings (flag BUILD_SETTINGS): pages say whether this viewer may adjust a Build (the Adjust link).
    if (env.BUILD_SETTINGS && env.BUILD_SETTINGS !== 'off' && (res.headers.get('content-type') || '').startsWith('text/html')) {
      const w = await who(request, env).catch(() => null);
      if (w?.kind === 'user' && !w.anon && buildSettingsOn(env.BUILD_SETTINGS, w.handle, env.OWNER_HANDLE))
        res = new HTMLRewriter().on('body', { element(e) { e.setAttribute('data-build-settings', '1'); } }).transform(res);
    }
    // Claude-plan onboarding (qb7): a signed-in person with no usable key gets data-needs-key, so Build opens the connect step.
    if ((res.headers.get('content-type') || '').startsWith('text/html')) {
      const w = await who(request, env).catch(() => null);
      if (w?.kind === 'user' && !w.anon && !onSubscription(env, w.handle)) {
        const ku = await userByHandle(env, w.handle).catch(() => null);
        if (!ku?.apiKeyEnc || ku.keyFailed) res = new HTMLRewriter().on('body', { element(e) { e.setAttribute('data-needs-key', '1'); } }).transform(res);
      }
    }
    return withLook(res);   // the site-wide look layer (src/look.ts)
  }
}

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
  return html(filePage({ info, v, path: clean, file, rev, runUrl: runUrl(runBase, repo, clean), why: !v && info.landing ? await fileWhy(env, info, clean) : null }));
}

/** Blame by intent (G3): the change records that touched a file on main, from the Landing DO; one read, never throws. */
async function fileWhy(env: Env, info: ProjectInfo, path: string): Promise<FileWhy | null> {
  try {
    const view: any = await env.Landing.get(env.Landing.idFromName(info.slug)).view(info.slug);
    const on = (view.changes || []).filter((c: any) => (c.files || []).includes(path));
    if (!on.length) return null;
    const collided = on.filter((c: any) => (c.landing?.conflicts || []).includes(path) || (c.events || []).some((e: any) => e.what === 'conflict' && String(e.detail || '').split(':')[0].includes(path)));
    const title = (c: any) => String(c.title || c.intent || '').split(/(?<=[.!?])\s/)[0].slice(0, 80);
    return { changes: on.length, collisions: collided.length, titles: on.map(title).filter(Boolean), href: `/p/${info.owner}/${info.name}/work#/file/${encodeURIComponent(path)}` };
  } catch (err) {
    console.log(JSON.stringify({ event: 'file_why_failed', slug: info.slug, path, error: String(err) }));
    return null;
  }
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
async function askRouter(env: Env, ctx: ExecutionContext, p: DurableObjectStub<Project>, slug: string, text: string, apiBase: string, shown = text, from: RouterRequest['from'] = 'person') {
  const at = Date.now();
  // `shown` is what the page quotes as "You": the person's words, not forq's instruction to the router.
  await p.setRequest({ text: shown, payload: text === shown ? undefined : text, at, state: 'waking', sentAt: undefined, error: undefined, attempts: 0, from });
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
async function dispatchReview(env: Env, p: DurableObjectStub<Project>, slug: string, apiBase: string, next: string, reviewer = `${slug}--review`, style: 'read' | 'adversarial' = 'read'): Promise<{ ok: boolean; busy?: boolean; error?: string }> {
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
      // Lab variant reviewStyle 'adversarial': the review must try to break the change.
      style === 'adversarial' ? 'ADVERSARIAL REVIEW: before your verdict, try to write ONE test that this change fails (an edge case, a wrong input, a missed requirement of the task). Run it. If it fails, the verdict is changes, with the test in your notes. Approve only if you tried and could not break it. Do not commit the test.' : '',
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
    `First reproduce it: send the SAME request to the live URL with curl (same method, path and headers as above; a plain GET is not a WebSocket upgrade), trying realistic values where the path says REDACTED, until you get the same status, and read the response body. Only then decide the cause from the code. If you cannot reproduce it, say so rather than picking a theory. Start one agent with \`qb-agent spawn\` to fix it, giving it the exact failing request, what the response showed, and the cause. If an agent is already working on this error with a different theory, tell it with \`qb-agent send\`. Reply with one line saying what you found and did.`,
  ].join('\n\n');
  const r = await askRouter(env, ctx, p, e.slug, ask, env.API_BASE, `Production error from Cloudflare Issues: ${title}`, 'issues');
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
/** Lab model names (haiku|sonnet|opus) to Claude Code model ids; full ids pass through. */
const modelId = (m: string) => ({ haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' } as Record<string, string>)[m] || m;

async function landingCaps(env: Env, slug: string): Promise<{ agents?: number; awake?: number } | null> {
  const info = await projectStub(env, slug).info().catch(() => null);
  if (!landingOn(info)) return null;
  return (await env.Landing.get(env.Landing.idFromName(slug)).flags().catch(() => null))?.caps || null;
}

async function spawn(env: Env, ctx: ExecutionContext, slug: string, task: string, apiBase: string, o: { files?: string[]; on?: string; skeleton?: boolean } = {}) {
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
    // Landing projects: each agent's claims and where its change is in the queue (`qb-agent list`).
    if (landingOn(info)) for (const a of agents) {
      const c = await env.Landing.get(env.Landing.idFromName(slug)).change(String(a.id)).catch(() => null);
      if (c) { a.claims = [...new Set([...c.claims, ...c.files])]; a.landing = c.state; }
    }
    return json({ agents });
  }
  // The agent board (src/landing/board.ts) on landing projects: the box hook posts edits and commits,
  // `qb-agent who` asks, `qb-agent intent` states the agent's own task, `qb-agent dedupe` stores same-work pairs.
  // The box downloads an image attached to a message for it (sendTo -> AgentBox.fetchAttachments).
  if (verb === 'attachment') {
    const id = url.searchParams.get('id') || '';
    if (!isAttachId(id) || !env.ATTACH) return json({ error: 'no such attachment' }, 404);
    const o = await env.ATTACH.get(attachKey(slug, id));
    return o ? new Response(o.body, { headers: { 'content-type': o.httpMetadata?.contentType || 'application/octet-stream' } }) : json({ error: 'no such attachment' }, 404);
  }
  // W9c: the router's new task checked against work under way / just landed (src/landing/board.ts twinPrompt).
  if (verb === 'twin' && request.method === 'POST') {
    if (me.role !== 'router') return json({ error: 'the router checks its new tasks' }, 403);
    const b = body as Record<string, unknown>;
    const { on, cands } = await env.Landing.get(env.Landing.idFromName(slug)).twinCandidates().catch(() => ({ on: false, cands: [] as TwinCandidate[] }));
    const task = String(b.task || '').slice(0, 4000);
    if (!on || !cands.length || !task) return json({ on, items: [] });
    if (b.stage === 'prompt') return json({ on, ...twinPrompt(cands, task) });
    const twin = parseTwin(String(b.answer || ''), cands);
    const u = b.usage as { in?: number; out?: number; cr?: number; cw?: number; model?: string } | undefined;
    if (u) ctx.waitUntil(recordCost(env, slug.split('.')[0], 'claude', `${slug.replace('.', '/')}:${u.model || 'claude-haiku-5-5'}`, { usd: null, covered: false, billing: 'sub',
      tokens: { in: Number(u.in) || 0, out: Number(u.out) || 0, cw: Number(u.cw) || 0, cr: Number(u.cr) || 0 } }).catch(() => {}));
    log('board', 'twin', { slug, twin: twin?.change || null, candidates: cands.length });
    return json({ twin, task: twin ? aliasTask(task, twin) : task });
  }
  if (['board', 'who', 'intent', 'dedupe', 'tasks', 'next'].includes(verb)) {
    const info = await p.info();
    if (!landingOn(info)) return json({ on: false, off: true, rows: [], aliases: [], text: '' });
    const L = env.Landing.get(env.Landing.idFromName(slug));
    const name = boardName(me.agentId);
    const b = body as Record<string, unknown>;
    if (verb === 'who') {
      const recent = Math.min(24 * 3_600_000, Number(url.searchParams.get('recent')) || 0);
      return json(await L.boardWho({ me: name, recent, files: url.searchParams.get('files') || '', area: url.searchParams.get('area') }));
    }
    if (request.method !== 'POST' || (me.role !== 'agent' && me.role !== 'router')) return json({ error: 'agents and the router post to the board' }, 403);
    if (verb === 'board') {
      // Only what a hook may say: edits, commits, blocked. Platform events (pushed, landed…) come from the platform.
      if (!['editing', 'committed', 'blocked', 'done', 'alive'].includes(String(b.kind))) return json({ error: 'kind: editing|committed|blocked|done|alive' }, 400);
      const e = await L.boardPost({ agent: name, kind: String(b.kind), intent: b.intent ? String(b.intent) : '', files: Array.isArray(b.files) ? b.files.map(String) : String(b.files || ''), status: String(b.status || ''), change: me.agentId });
      // who: true (the edit hook): the others who touched these files, in the same round trip.
      if (b.who && !('off' in e)) return json({ ...e, rows: (await L.boardWho({ me: name, files: e.files })).rows.map((r) => ({ ...r, line: fmtBoardRow(r) })) });
      return json(e);
    }
    if (verb === 'intent') {
      const intent = String(b.intent || '').trim();
      if (!intent) return json({ error: 'intent required' }, 400);
      const files = (Array.isArray(b.files) ? b.files.map(String) : String(b.files || '').split(',')).map((f) => f.trim().replace(/^\.?\//, '')).filter(Boolean).slice(0, 20);
      const e = await L.stateIntent(me.agentId, intent, files);
      if ('off' in e) return json(e);
      // The reply carries the conflicts (prior-art.md, Agent Mail): live work on these files + everything landed in the last 30 min.
      const near = files.length ? (await L.boardWho({ me: name, files })).rows.filter((r) => !r.done) : [];
      const done = (await L.boardWho({ me: name, recent: 30 * 60_000 })).rows.filter((r) => r.done);
      const live = (await L.boardWho({ me: name })).rows.filter((r) => !near.some((x) => x.agent === r.agent));
      const taken = Object.entries((e as { takenBy?: Record<string, string> }).takenBy || {});
      return json({ ...e, ...(taken.length ? { taken: `Already claimed earlier by another agent: ${taken.map(([id, a]) => `${id} by ${a}`).join(', ')}. The earliest claim keeps the task: pick another one and announce it with qb-agent intent.` } : {}), others: boardText([...near, ...live.slice(0, Math.max(0, 8 - near.length)), ...done], (await L.boardWho({})).aliases, { live: 8, done: 8 }) });
    }
    if (verb === 'next') {
      if (me.role !== 'agent') return json({ error: 'qb-agent next is for agents' }, 403);
      return json(await L.claimNextTask(me.agentId));
    }
    // Task lists and alias pairs come only from the router (the planner): an agent posting pairs could make
    // others skip real work (adversarial review, 2026-10-11).
    if (me.role !== 'router') return json({ error: 'only the router registers task lists and runs the dedupe pass' }, 403);
    if (verb === 'tasks') {
      const items = backlogItems(String(b.text || ''));
      await L.dedupeList(name, items);
      log('board', 'tasks', { slug, by: name, items: items.length });
      return json({ items: items.length, ids: items.filter((i) => !i.id.startsWith('#')).length });
    }
    // dedupe: {stage: 'prompt', text} -> the items + the prompt the box runs through Haiku;
    //         {stage: 'answer', ids, answer, usage?} -> the pairs, stored as aliases on the board.
    if (b.stage === 'prompt') { const items = await L.dedupeList(name, backlogItems(String(b.text || ''))); return json({ items, prompt: dedupePrompt(items) }); }
    if (b.stage === 'answer') {
      const pairs = parseDedupe(String(b.answer || ''), Array.isArray(b.ids) ? b.ids.map(String) : undefined);
      const u = b.usage as { in?: number; out?: number; cr?: number; cw?: number; model?: string } | undefined;
      if (u) ctx.waitUntil(recordCost(env, slug.split('.')[0], 'claude', `${slug.replace('.', '/')}:${u.model || 'claude-haiku-5-5'}`, { usd: null, covered: false, billing: 'sub',
        tokens: { in: Number(u.in) || 0, out: Number(u.out) || 0, cw: Number(u.cw) || 0, cr: Number(u.cr) || 0 } }).catch(() => {}));
      log('board', 'dedupe', { slug, by: name, pairs: pairs.length, ids: Array.isArray(b.ids) ? b.ids.length : null, isError: !!b.isError, exit: b.exit ?? null, answer: String(b.answer || '').slice(0, 300) });
      return json({ pairs, aliases: await L.boardAliases(pairs, name) });
    }
    return json({ error: 'stage: prompt|answer' }, 400);
  }
  // X5: decisions taken on the person's behalf, and the rare question that needs them (secrets, money, a change that
  // keeps failing). Agents note on their change; the router on the project.
  if ((verb === 'decided' || verb === 'ask-person') && request.method === 'POST' && (me.role === 'agent' || me.role === 'router')) {
    const b = body as Record<string, unknown>;
    const by = me.role === 'router' ? 'router' : me.agentId;
    const why = verb === 'ask-person' ? (['secret', 'money', 'failing'].includes(String(b.why)) ? String(b.why) : 'other') : (b.why ? String(b.why) : undefined);
    const r = await env.Landing.get(env.Landing.idFromName(slug)).personNote(by, verb === 'decided' ? 'decided' : 'asked-person', String(b.text || ''), why)
      .catch((e) => { log('landing', 'note_failed', { slug, by, err: String(e) }); return { ok: true }; });   // a project without the landing system: nothing to record
    if (!r.ok) return json({ error: 'text required' }, 400);
    if (verb === 'ask-person') ctx.waitUntil(notifyOwner(env, slug, 'decision', `${by === 'router' ? 'The router' : `Agent ${by.split('--')[1]}`} asks: ${String(b.text).slice(0, 140)}`, by === 'router' ? `/p/${slug.replace('.', '/')}` : `/p/${slug.replace('.', '/')}/work#/change/${encodeURIComponent(by)}`).catch((e) => log('notify', 'failed', { slug, err: String(e) })));
    return json({ ok: true });
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
      // reviewers explicitly set (lab variants, crew runs): 0 = no review at all, 1+ = Landing's pool.
      const lfl = landingOn(pinfo) ? await env.Landing.get(env.Landing.idFromName(slug)).flags().catch(() => null) : null;
      const pooled = typeof lfl?.reviewers === 'number' && lfl.reviewers >= 1 && (lfl.reviewers > 1 || !!lfl.policy);
      const noReview = lfl?.reviewers === 0;
      if ((await p.kindOf()) === 'worker' && ownerDeploys) ctx.waitUntil(p.requestBuild('preview', me.agentId).catch((e) => log('build', 'request_failed', { err: String(e) })));
      else if (!pooled && !noReview) await startReview(env, p, slug, apiBase, () => p.queueReview(me.agentId));   // awaited: see the review verb
      if (landingOn(pinfo)) await landingHooks.onPushed(env, ctx, pinfo!, me.agentId, String(body.note || ''), noReview ? 'none' : pooled).catch((e) => log('landing', 'push_hook_failed', { id: me.agentId, err: String(e) }));
    }
    return json({ ok: true });
  }
  // An agent's own main, read-only: `qb-agent sync-main` rebases its work on it (landing tier 2).
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
        return json({ error: `you reviewed ${String(body.commit).slice(0, 7)} but the agent's latest push is ${tip.commit.slice(0, 7)}: run \`qb-agent fetch-agent ${body.agent}\` and review again` }, 409);
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
    // R1: the owner paused or stopped this project: no new agents until they resume.
    if (await env.Landing.get(env.Landing.idFromName(slug)).isPaused().catch(() => false)) return json({ error: 'paused by the owner: no new agents until the project is resumed' }, 409);
    // X1: features wait for the skeleton to land, so each forks from a runnable app (the router is told when it lands).
    if (b.skeleton !== true) {
      const hold = await env.Landing.get(env.Landing.idFromName(slug)).skeletonHold().catch(() => null);
      if (hold) return json({ error: `wait: the skeleton (${hold.id}, "${hold.title}") has not landed yet. End your turn; qodebase tells you when it lands, then start the features.` }, 409);
    }
    const out = await spawn(env, ctx, slug, String(b.task || ''), apiBase, { files: Array.isArray(b.files) ? b.files.map(String) : undefined, on: b.on ? String(b.on) : undefined, skeleton: b.skeleton === true });
    // A held task that now has its agent leaves the waiting list.
    await env.Landing.get(env.Landing.idFromName(slug)).unhold(String(b.task || '')).catch(() => null);
    return json(out);
  }
  // qb-agent hold "<task>": a task the router holds until an agent is free (the person sees it waiting); --done "<task>" / --clear.
  if (verb === 'hold') {
    const b = body as Record<string, unknown>;
    const L = env.Landing.get(env.Landing.idFromName(slug));
    if (b.clear === true) return json(await L.unhold('*'));
    if (b.done) return json(await L.unhold(String(b.done)));
    return json(await L.hold(String(b.task || '')));
  }
  if (verb === 'parts') {
    const n = Number((body as Record<string, unknown>).parts);
    if (!(n >= 1)) return json({ error: 'parts: a number of tasks, 1 or more' }, 400);
    return json(await env.Landing.get(env.Landing.idFromName(slug)).setParts(n));
  }
  if (verb === 'send') {
    if (projectOf(body.agent || '') !== slug) return json({ error: 'not an agent of this project' }, 400);
    return json(await sendTo(env, body.agent, String(body.text || ''), apiBase));
  }
  if (verb === 'merge-info') {
    const agent = url.searchParams.get('agent') || '';
    if (projectOf(agent) !== slug) return json({ error: 'not an agent of this project' }, 400);
    // Landing projects: `qb-agent merge` puts the change in the merge queue instead.
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

// ---- mirrors (qodebase's own code on qodebase, 2026-10-14) ----
async function hmacHex(key: string, data: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** Per mirror, derived (nothing stored): the GitHub webhook's secret. */
async function mirrorSecret(env: Env, slug: string) { return (await hmacHex(env.ADMIN_SECRET, `mirror:${slug}`)).slice(0, 40); }
async function syncMirror(env: Env, slug: string) {
  const p = projectStub(env, slug);
  const info = await p.info();
  if (!info?.mirror) return { error: 'not a mirror' };
  const t = await p.mainToken(900);
  const r = await env.BuildBox.get(env.BuildBox.idFromName('mirror')).mirrorSync(`https://github.com/${info.mirror.from}.git`, t.remote, t.token, info.mirror.branch);
  await p.mirrorSynced(r);
  await registry(env).touch(slug).catch(() => {});
  log('mirror', r.head ? 'synced' : 'sync_error', { slug, from: info.mirror.from, head: r.head?.slice(0, 12), ms: r.ms, err: r.error?.slice(0, 200) });
  return r;
}

// ---- Claude via AI Gateway with unified billing (landing flag billing: 'gateway') ----
async function aigAnthropic(request: Request, env: Env, url: URL): Promise<Response> {
  const key = request.headers.get('x-api-key') || (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const i = key.lastIndexOf('.'), id = key.slice(0, i);
  if (!(i > 0 && AGENT_RE.test(id) && key.slice(i + 1) === await hmac(env, id))) return json({ type: 'error', error: { type: 'authentication_error', message: 'not a qodebase box' } }, 401);
  const slug = projectOf(id);
  const f = await env.Landing.get(env.Landing.idFromName(slug)).flags().catch(() => null);
  if (f?.billing !== 'gateway' || !env.REPLAY_GATEWAY_TOKEN) return json({ type: 'error', error: { type: 'permission_error', message: 'this project is not on gateway billing' } }, 403);
  // AI Gateway's native Anthropic route bills unified credits for the models in Cloudflare's catalog: Opus 5.5, Sonnet 5.5
  // and the 4.x models answer; Haiku 5.5 is not covered yet (forwarded without a key: 'x-api-key header is required',
  // measured 2026-10-14). Claude Code's Haiku 5.5 calls (its background model and the default coder) go as Sonnet 5.5,
  // logged on every call (as Sonnet 5.5: Haiku 4.5 refused them). Cloudflare's REST /ai/v1/messages refused Claude Code's requests (system blocks, roles).
  const acct = '887d7234a6b8d65ad355a4f6684cab67', gw = env.REPLAY_GATEWAY || 'qodebase-replay';
  const target = `https://gateway.ai.cloudflare.com/v1/${acct}/${gw}/anthropic/${url.pathname.slice('/api/aig/anthropic/'.length)}${url.search}`;
  const h = new Headers();
  for (const [k, v] of request.headers) if (/^(content-type|anthropic-version|anthropic-beta|accept)$/i.test(k)) h.set(k, v);
  h.set('cf-aig-authorization', `Bearer ${env.REPLAY_GATEWAY_TOKEN}`);
  h.set('cf-aig-metadata', JSON.stringify({ project: slug, agent: id.split('--')[1] || id }));
  let body: BodyInit | undefined, swapped: string | null = null;
  if (request.method !== 'GET') {
    const txt = await request.text();
    try {
      const j = JSON.parse(txt);
      // Haiku 4.5 refuses Claude Code's 5.5 requests (a 'system' role in messages, 128k max_tokens): Sonnet 5.5 takes them.
      if (typeof j.model === 'string' && /^claude-haiku-5-5/.test(j.model)) { swapped = j.model; j.model = 'claude-sonnet-5-5'; }
      body = JSON.stringify(j);
    } catch { body = txt; }
  }
  const t0 = Date.now();
  const res = await fetch(target, { method: request.method, headers: h, body });
  log('aig', 'call', { slug, agent: id, path: url.pathname.slice(19, 60), status: res.status, ms: Date.now() - t0, ...(swapped ? { model: `${swapped} -> claude-sonnet-5-5` } : {}) });
  const out = new Headers(res.headers); out.delete('set-cookie');
  return new Response(res.body, { status: res.status, headers: out });
}
