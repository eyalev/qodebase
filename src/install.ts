// Install an agent into the user's OWN Cloudflare account, with no GitHub and no
// pasted tokens (docs/deploy-without-github.md, path A).
//
// "Sign in with Cloudflare" is forq's OAuth client (CF_OAUTH_CLIENT_ID, private
// until projectsbase.dev is verified). The user picks an account on Cloudflare's
// consent screen; forq keeps the refresh token (rotating, AES-GCM like API keys)
// in one Installs DO per forq user. An install is a short step machine run from
// the DO's alarm, so it outlives the request:
//   account  → the account has a workers.dev subdomain (made if missing)
//   storage  → the agent's R2 bucket
//   deploy   → BuildBox ("installs" instance) runs `wrangler deploy` on the
//              template's prebuilt forq-release/ with the user's access token
//   lock     → Access on the Worker itself: members of that account + the
//              user's forq email; Cloudflare's own sign-in when the account has it
//   ready    → https://<name>.<subdomain>.workers.dev
// Templates live in forq's Artifacts (forq/container-agents, forq/pi-on-cf): the user's
// account only runs the agent.

import { DurableObject } from 'cloudflare:workers';
import { isUiHost, type Env } from './env';
import { log } from './box';
import { decryptKey, encryptKey, sessionEmail } from './auth';
import type { BuildJob, BuildResult } from './build';
import { installPage, installProgressPage, type InstallView } from './personal';

export type Template = {
  id: string; title: string; repo: string; dir: string; defaultName: string;
  bucketBinding?: string;              // an R2 bucket to make (none: the template keeps its data in Durable Objects)
  vars?: Record<string, string>;       // fixed vars for this template
  secretVar?: string;                  // a var set to a fresh random value per install (the agent's own login)
  container?: boolean;                 // runs a Cloudflare Container: needs Workers Paid
  paid?: boolean;                      // needs Workers Paid for another reason (Dynamic Workers)
};
export const TEMPLATES: Record<string, Template> = {
  openclaw: { id: 'openclaw', title: 'OpenClaw', repo: 'forq.container-agents', dir: 'forq-release-openclaw', defaultName: 'my-openclaw',
    vars: { AGENT_KIND: 'openclaw', MODEL: '@cf/zai-org/glm-4.7-flash' }, secretVar: 'AGENT_SECRET', container: true },
  'agents-starter': { id: 'agents-starter', title: 'Cloudflare Agent', repo: 'forq.agents-starter', dir: 'forq-release', defaultName: 'my-agent' },
  pi: { id: 'pi', title: 'Pi', repo: 'forq.pi-on-cf', dir: 'forq-release', defaultName: 'my-pi', paid: true },
  t3code: { id: 't3code', title: 'T3 Code', repo: 'forq.container-agents', dir: 'forq-release-t3code', defaultName: 'my-t3code',
    vars: { AGENT_KIND: 't3code', MODEL: '@cf/zai-org/glm-4.7-flash' }, secretVar: 'AGENT_SECRET', container: true },
  hermes: { id: 'hermes', title: 'Hermes', repo: 'forq.container-agents', dir: 'forq-release-hermes', defaultName: 'my-hermes',
    vars: { AGENT_KIND: 'hermes', MODEL: '@cf/zai-org/glm-4.7-flash' }, secretVar: 'AGENT_SECRET', container: true },
};

const API = 'https://api.cloudflare.com/client/v4';
const AUTH_URL = 'https://dash.cloudflare.com/oauth2/auth';
const TOKEN_URL = 'https://dash.cloudflare.com/oauth2/token';
const SCOPES = ['memberships.read', 'account-settings.read', 'workers-scripts.read', 'workers-scripts.write', 'containers.write',
  'ai.read', 'aig.read', 'aig.write', 'browser-rendering.write', 'access-app.write', 'access-policy.write', 'access-org.read', 'access-org.write',
  'access-idp.read', 'access-idp.write', 'offline_access'];
export const WORKER_NAME_RE = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

export type StepKey = 'account' | 'storage' | 'deploy' | 'lock' | 'ready';
const STEPS: { key: StepKey; label: string }[] = [
  { key: 'account', label: 'Check your Cloudflare account' },
  { key: 'storage', label: 'Make its private storage' },
  { key: 'deploy', label: 'Put the assistant in your account' },
  { key: 'lock', label: 'Lock it so only you can open it' },
  { key: 'ready', label: 'Ready' },
];
export type Install = {
  id: string; template: string; name: string; accountId: string; accountName: string; email: string;
  createdAt: number; updatedAt: number;
  steps: { key: StepKey; label: string; state: 'todo' | 'doing' | 'done' | 'failed'; note?: string }[];
  subdomain?: string; url?: string; error?: string; fix?: { text: string; href: string }; log?: string;
};
type Conn = { refreshEnc: string; accessEnc: string; accessExp: number; accounts: { id: string; name: string }[]; connectedAt: number; scopes?: string[] };

const enc = new TextEncoder();
async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const safePath = (p: string | null) => (p && p.startsWith('/') && !p.startsWith('//') ? p : '/personal-agents');
const html = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const redirect = (location: string, headers: Record<string, string> = {}) => new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store', ...headers } });
const installsStub = (env: Env, email: string) => env.Installs.get(env.Installs.idFromName(email.toLowerCase()));

async function cf(token: string, path: string, init: RequestInit = {}) {
  const r = await fetch(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) } })
    .catch((e) => new Response(JSON.stringify({ success: false, errors: [{ message: String(e) }] }), { status: 599 }));
  const j = await r.json().catch(() => ({})) as { success?: boolean; result?: any; errors?: { code?: number; message?: string }[] };
  return { ok: r.ok && j.success !== false, status: r.status, result: j.result, errors: j.errors || [] };
}
const errText = (e: { code?: number; message?: string }[]) => e.map((x) => `${x.message || ''}${x.code ? ` (${x.code})` : ''}`).join('; ') || 'unknown error';

/** /connect/cf/* and /personal-agents/install|i/* on the UI host. */
/** The OAuth callback on the host the person is on (each host is registered with the client). */
const callbackUrl = (env: Env, url: URL) => `https://${isUiHost(env, url.hostname) ? url.hostname : env.UI_HOST}/connect/cf/callback`;

export async function installRoute(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response | null> {
  const p = url.pathname;
  if (!p.startsWith('/connect/cf/') && !p.startsWith('/personal-agents/install/') && !p.startsWith('/personal-agents/i/')) return null;
  const email = await sessionEmail(env, request);
  const back = p + url.search;
  if (!email) return redirect(`/login?next=${encodeURIComponent(back)}`);
  const stub = installsStub(env, email);

  if (p === '/connect/cf/start') {
    const next = safePath(url.searchParams.get('next'));
    const nonce = crypto.randomUUID();
    const exp = Date.now() + 15 * 60_000;
    const body = `${email}|${exp}|${next}|${nonce}`;
    const state = btoa(`${body}|${await hmac(env.ADMIN_SECRET, `cfstate:${body}`)}`).replace(/=+$/, '');
    const q = new URLSearchParams({ response_type: 'code', client_id: env.CF_OAUTH_CLIENT_ID, redirect_uri: callbackUrl(env, url), scope: SCOPES.join(' '), state });
    // Asking again for a permission the user has not granted yet: show the consent screen even if Cloudflare remembers an older grant.
    if (url.searchParams.get('again')) q.set('prompt', 'consent');
    log('install', 'oauth_start', { email, next });
    return redirect(`${AUTH_URL}?${q}`, { 'set-cookie': `forq_cfstate=${nonce}; Path=/connect/cf; Max-Age=900; HttpOnly; Secure; SameSite=Lax` });
  }
  if (p === '/connect/cf/callback') {
    const fail = (why: string, extra: Record<string, unknown> = {}) => { log('install', 'oauth_failed', { email, why, ...extra }); return html(installPage({ kind: 'error', text: why, next: '/personal-agents' }), 400); };
    if (url.searchParams.get('error')) return fail(url.searchParams.get('error') === 'access_denied' ? 'Cloudflare sign-in was cancelled.' : `Cloudflare said: ${url.searchParams.get('error_description') || url.searchParams.get('error')}`);
    let parts: string[];
    try { parts = atob(url.searchParams.get('state') || '').split('|'); } catch { return fail('That sign-in link is broken. Start again.'); }
    const [sEmail, sExp, sNext, sNonce, sig] = parts;
    const cookieNonce = ((request.headers.get('cookie') || '').match(/forq_cfstate=([0-9a-f-]+)/) || [])[1];
    if (!sig || sig !== await hmac(env.ADMIN_SECRET, `cfstate:${sEmail}|${sExp}|${sNext}|${sNonce}`) || sEmail !== email || Number(sExp) < Date.now() || cookieNonce !== sNonce) return fail('That sign-in link has expired. Start again.');
    const tok = await tokenRequest(env, { grant_type: 'authorization_code', code: url.searchParams.get('code') || '', redirect_uri: callbackUrl(env, url) });
    if (!tok.access_token || !tok.refresh_token) return fail('Cloudflare did not hand over a sign-in token. Try again.', { status: tok.status, error: tok.error });
    const accts = await cf(tok.access_token, '/accounts?per_page=50');
    const accounts = (accts.result || []).map((a: any) => ({ id: a.id, name: a.name }));
    if (!accounts.length) return fail('No Cloudflare account was shared with forq. Start again and tick an account.');
    await stub.saveConnection(tok.access_token, tok.refresh_token, Number(tok.expires_in || 3600), accounts, String(tok.scope || '').split(/\s+/).filter(Boolean));
    log('install', 'oauth_connected', { email, accounts: accounts.length, scope: tok.scope });
    return redirect(safePath(sNext), { 'set-cookie': 'forq_cfstate=; Path=/connect/cf; Max-Age=0; HttpOnly; Secure; SameSite=Lax' });
  }
  if (p === '/connect/cf/disconnect' && request.method === 'POST') {
    await stub.disconnect();
    return redirect(safePath(url.searchParams.get('next')));
  }

  const m = p.match(/^\/personal-agents\/install\/([a-z0-9-]+)$/);
  if (m) {
    const t = TEMPLATES[m[1]];
    if (!t) return html('No such agent', 404);
    const conn = await stub.connection();
    if (request.method === 'POST') {
      const f = await request.formData();
      const r = await stub.start(t.id, String(f.get('name') || '').trim().toLowerCase(), String(f.get('account') || ''), email);
      if (!r.ok) return html(installPage({ kind: 'form', template: t, accounts: conn.accounts, name: String(f.get('name') || ''), error: r.error }), 400);
      return new Response(null, { status: 303, headers: { location: `/personal-agents/i/${r.id}` } });
    }
    // A container agent needs containers.write, which older connections were not asked for.
    if (!conn.connected || (t.container && !conn.scopes.includes('containers.write'))) return html(installPage({ kind: 'connect', template: t, startHref: `/connect/cf/start?next=${encodeURIComponent(p)}${conn.connected ? '&again=1' : ''}` }));
    return html(installPage({ kind: 'form', template: t, accounts: conn.accounts, name: t.defaultName }));
  }
  const s = p.match(/^\/personal-agents\/i\/([a-z0-9]+)(\.json)?$/);
  if (s) {
    const inst = await stub.get(s[1]);
    if (!inst) return html('No such install', 404);
    if (s[2]) return Response.json(view(inst), { headers: { 'cache-control': 'no-store' } });
    return html(installProgressPage(view(inst)));
  }
  return null;
}

const view = (i: Install): InstallView => ({ id: i.id, title: TEMPLATES[i.template]?.title || i.template, name: i.name, accountName: i.accountName, steps: i.steps, url: i.url, error: i.error, fix: i.fix, log: i.log,
  wakes: !!TEMPLATES[i.template]?.container,
  extra: i.url && i.template === 't3code' ? { text: 'Sign in to Claude Code (optional)', href: `${i.url}/__forq/claude` } : undefined });

async function tokenRequest(env: Env, params: Record<string, string>): Promise<any> {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { authorization: `Basic ${btoa(`${env.CF_OAUTH_CLIENT_ID}:${env.CF_OAUTH_CLIENT_SECRET}`)}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  }).catch((e) => new Response(JSON.stringify({ error: String(e) }), { status: 599 }));
  const j = await r.json().catch(() => ({})) as any;
  return { ...j, status: r.status };
}

export class Installs extends DurableObject<Env> {
  async connection() {
    const c = await this.ctx.storage.get<Conn>('conn');
    return { connected: !!c, accounts: c?.accounts || [], connectedAt: c?.connectedAt, scopes: c?.scopes || [] };
  }
  async saveConnection(access: string, refresh: string, expiresIn: number, accounts: { id: string; name: string }[], scopes: string[] = []) {
    await this.ctx.storage.put('conn', {
      refreshEnc: await encryptKey(this.env, refresh), accessEnc: await encryptKey(this.env, access),
      accessExp: Date.now() + (expiresIn - 120) * 1000, accounts, connectedAt: Date.now(), scopes,
    } satisfies Conn);
  }
  async disconnect() {
    const c = await this.ctx.storage.get<Conn>('conn');
    if (c) {
      // Tell Cloudflare too, so the grant disappears from the user's profile.
      const rt = await decryptKey(this.env, c.refreshEnc).catch(() => '');
      if (rt) await fetch('https://dash.cloudflare.com/oauth2/revoke', { method: 'POST', headers: { authorization: `Basic ${btoa(`${this.env.CF_OAUTH_CLIENT_ID}:${this.env.CF_OAUTH_CLIENT_SECRET}`)}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: rt, token_type_hint: 'refresh_token' }) }).catch(() => {});
    }
    await this.ctx.storage.delete('conn');
  }
  /** A live access token, refreshing (and saving the rotated refresh token) when needed. */
  async #token(): Promise<string> {
    const c = await this.ctx.storage.get<Conn>('conn');
    if (!c) throw new Error('not connected to Cloudflare');
    if (Date.now() < c.accessExp) return decryptKey(this.env, c.accessEnc);
    const t = await tokenRequest(this.env, { grant_type: 'refresh_token', refresh_token: await decryptKey(this.env, c.refreshEnc) });
    if (!t.access_token) { log('install', 'refresh_failed', { status: t.status, error: t.error }); throw new Error('Cloudflare sign-in expired: sign in with Cloudflare again'); }
    await this.ctx.storage.put('conn', { ...c, accessEnc: await encryptKey(this.env, t.access_token), refreshEnc: t.refresh_token ? await encryptKey(this.env, t.refresh_token) : c.refreshEnc, accessExp: Date.now() + (Number(t.expires_in || 3600) - 120) * 1000 });
    return t.access_token;
  }

  async get(id: string) { return (await this.ctx.storage.get<Install>(`i:${id}`)) || null; }
  async list() { return [...(await this.ctx.storage.list<Install>({ prefix: 'i:' })).values()].sort((a, b) => b.createdAt - a.createdAt); }

  async start(template: string, name: string, accountId: string, email: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
    const c = await this.ctx.storage.get<Conn>('conn');
    if (!c) return { ok: false, error: 'Sign in with Cloudflare first.' };
    if (!TEMPLATES[template]) return { ok: false, error: 'Unknown agent.' };
    if (!WORKER_NAME_RE.test(name)) return { ok: false, error: 'Use 3 to 40 lowercase letters, numbers and dashes, starting with a letter.' };
    const acct = c.accounts.find((a) => a.id === accountId) || (c.accounts.length === 1 ? c.accounts[0] : undefined);
    if (!acct) return { ok: false, error: 'Pick the Cloudflare account to install into.' };
    const running = (await this.list()).find((i) => i.steps.some((s) => s.state === 'doing'));
    if (running) return { ok: false, error: `${running.name} is still installing. Wait for it to finish.` };
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const inst: Install = { id, template, name, accountId: acct.id, accountName: acct.name, email, createdAt: Date.now(), updatedAt: Date.now(),
      steps: STEPS.map((s) => ({ ...s, state: 'todo' as const })) };
    await this.ctx.storage.put(`i:${id}`, inst);
    await this.ctx.storage.put('active', id);
    await this.ctx.storage.setAlarm(Date.now() + 50);
    log('install', 'start', { email, template, name, account: acct.id });
    return { ok: true, id };
  }

  async #save(i: Install) { i.updatedAt = Date.now(); await this.ctx.storage.put(`i:${i.id}`, i); }
  #step(i: Install, key: StepKey, state: Install['steps'][number]['state'], note?: string) {
    const s = i.steps.find((x) => x.key === key)!; s.state = state; s.note = note;
  }
  async #fail(i: Install, key: StepKey, error: string, fix?: Install['fix']) {
    this.#step(i, key, 'failed', error); i.error = error; i.fix = fix;
    await this.#save(i); await this.ctx.storage.delete('active');
    log('install', 'failed', { id: i.id, step: key, error });
  }

  async alarm() {
    const id = await this.ctx.storage.get<string>('active');
    const i = id ? await this.get(id) : null;
    if (!i) return;
    const next = i.steps.find((s) => s.state !== 'done');
    if (!next || next.state === 'failed') { await this.ctx.storage.delete('active'); return; }
    if (next.key === 'deploy' && next.state === 'doing') {
      // Waiting for BuildBox; a lost result fails the step after 12 minutes.
      if (Date.now() - i.updatedAt > 12 * 60_000) return this.#fail(i, 'deploy', 'The upload did not finish. Try again.');
      await this.ctx.storage.setAlarm(Date.now() + 30_000);
      return;
    }
    let token: string;
    try { token = await this.#token(); } catch (e) { return this.#fail(i, next.key, String((e as Error).message), { text: 'Sign in with Cloudflare again', href: `/connect/cf/start?next=${encodeURIComponent(`/personal-agents/install/${i.template}`)}` }); }
    this.#step(i, next.key, 'doing'); await this.#save(i);
    const a = i.accountId;
    try {
      if (next.key === 'account') {
        const sub = await cf(token, `/accounts/${a}/workers/subdomain`);
        let subdomain: string | undefined = sub.result?.subdomain;
        if (!subdomain) {
          const base = i.email.split('@')[0].toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'me';
          for (const candidate of [base, `${base}-${crypto.randomUUID().slice(0, 4)}`]) {
            const put = await cf(token, `/accounts/${a}/workers/subdomain`, { method: 'PUT', body: JSON.stringify({ subdomain: candidate }) });
            if (put.ok) { subdomain = put.result?.subdomain || candidate; break; }
          }
          if (!subdomain) return this.#fail(i, 'account', 'Could not give your account a workers.dev address.', { text: 'Open Workers in Cloudflare', href: `https://dash.cloudflare.com/${a}/workers-and-pages` });
        }
        i.subdomain = subdomain;
        this.#step(i, 'account', 'done', `${i.accountName}`);
      } else if (next.key === 'storage') {
        if (!TEMPLATES[i.template].bucketBinding) { this.#step(i, 'storage', 'done', 'Built in, nothing to set up'); await this.#save(i); await this.ctx.storage.setAlarm(Date.now() + 50); return; }
        const bucket = `${i.name}-vault`;
        const r = await cf(token, `/accounts/${a}/r2/buckets`, { method: 'POST', body: JSON.stringify({ name: bucket }) });
        const exists = r.errors.some((e) => e.code === 10004 || /already exists/i.test(e.message || ''));
        if (!r.ok && !exists) {
          if (r.errors.some((e) => e.code === 10042)) return this.#fail(i, 'storage', 'Your account needs R2 turned on first. It is free up to 10 GB; Cloudflare asks for a card.', { text: 'Turn on R2', href: `https://dash.cloudflare.com/${a}/r2/overview` });
          return this.#fail(i, 'storage', `Could not make the storage: ${errText(r.errors)}`);
        }
        this.#step(i, 'storage', 'done', bucket);
      } else if (next.key === 'deploy') {
        const t = TEMPLATES[i.template];
        const info = await this.env.Project.get(this.env.Project.idFromName(t.repo)).info();
        if (!info) return this.#fail(i, 'deploy', 'The agent template is missing on forq.');
        using repo = await this.env.ARTIFACTS.get(info.repo);
        const read = await repo.createToken('read', 1800);
        const job: BuildJob = {
          id: `install-${i.id}`, slug: t.repo, kind: 'install', repo: info.repo, remote: info.remote, token: read.plaintext.split('?')[0],
          worker: i.name, queuedAt: Date.now(),
          install: { owner: i.email, installId: i.id, accountId: a, cfToken: token, dir: t.dir,
            vars: { CF_ACCOUNT_ID: a, ...(t.vars || {}), ...(t.secretVar ? { [t.secretVar]: await this.#agentSecret(a, i.name) } : {}) },
            bucket: t.bucketBinding ? { binding: t.bucketBinding, name: `${i.name}-vault` } : undefined },
        };
        await this.env.BuildBox.get(this.env.BuildBox.idFromName('installs')).enqueue(job);
        await this.#save(i);
        await this.ctx.storage.setAlarm(Date.now() + 30_000);
        return;
      } else if (next.key === 'lock') {
        await this.#lock(i, token);
        this.#step(i, 'lock', 'done', 'Only you');
      } else if (next.key === 'ready') {
        i.url = `https://${i.name}.${i.subdomain}.workers.dev`;
        this.#step(i, 'ready', 'done');
        await this.#save(i); await this.ctx.storage.delete('active');
        log('install', 'ready', { id: i.id, url: i.url });
        return;
      }
    } catch (e) {
      return this.#fail(i, next.key, `Something broke: ${String((e as Error).message || e).slice(0, 200)}`);
    }
    await this.#save(i);
    await this.ctx.storage.setAlarm(Date.now() + 50);
  }

  /** Access on the Worker itself: account members + the user's email. */
  async #lock(i: Install, token: string) {
    const a = i.accountId;
    const org = await cf(token, `/accounts/${a}/access/organizations`);
    if (!org.ok || !org.result?.auth_domain) {
      const team = `${(i.subdomain || 'forq').slice(0, 20)}-${crypto.randomUUID().slice(0, 6)}`;
      const made = await cf(token, `/accounts/${a}/access/organizations`, { method: 'POST', body: JSON.stringify({ name: team, auth_domain: `${team}.cloudflareaccess.com` }) });
      if (!made.ok) throw new Error(`could not set up sign-in (Zero Trust): ${errText(made.errors)}`);
    }
    const idps = await cf(token, `/accounts/${a}/access/identity_providers`);
    const list = (idps.result || []) as { id: string; type: string }[];
    let allowed = list.filter((p) => p.type === 'cloudflare' || p.type === 'onetimepin').map((p) => p.id);
    if (!allowed.length) {
      const otp = await cf(token, `/accounts/${a}/access/identity_providers`, { method: 'POST', body: JSON.stringify({ name: 'One-time PIN', type: 'onetimepin', config: {} }) });
      if (otp.ok) allowed = [otp.result.id];
    }
    const scripts = await cf(token, `/accounts/${a}/workers/scripts`);
    const tag = ((scripts.result || []) as { id: string; tag: string }[]).find((s) => s.id === i.name)?.tag;
    if (!tag) throw new Error('the assistant was not found after upload');
    const apps = await cf(token, `/accounts/${a}/access/apps?per_page=100`);
    if (((apps.result || []) as any[]).some((ap) => (ap.destinations || []).some((d: any) => d.type === 'worker' && d.worker_id === tag))) return;
    const r = await cf(token, `/accounts/${a}/access/apps`, { method: 'POST', body: JSON.stringify({
      type: 'self_hosted', name: `${i.name} (forq)`, destinations: [{ type: 'worker', worker_id: tag }], session_duration: '720h',
      ...(allowed.length ? { allowed_idps: allowed, auto_redirect_to_identity: allowed.length === 1 } : {}),
      policies: [{ name: 'Only you', decision: 'allow', include: [{ cloudflare_account_member: { account_id: a } }, { email: { email: i.email } }] }],
    }) });
    if (!r.ok) throw new Error(`could not lock it: ${errText(r.errors)}`);
  }

  /** The agent's own login secret, the same on every reinstall of one Worker
   *  (a new one would lock the running container out until it restarts). */
  async #agentSecret(accountId: string, name: string): Promise<string> {
    const key = `secret:${accountId}/${name}`;
    const have = await this.ctx.storage.get<string>(key);
    if (have) return decryptKey(this.env, have);
    const fresh = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');
    await this.ctx.storage.put(key, await encryptKey(this.env, fresh));
    return fresh;
  }

  /** BuildBox reports the deploy. */
  async buildDone(result: BuildResult) {
    const id = result.id.replace(/^install-/, '');
    const i = await this.get(id);
    if (!i) return;
    if (!result.ok) {
      log('install', 'deploy_failed', { id, error: result.error, tail: result.log.slice(-800) });
      i.log = result.log.slice(-4000);
      const t = TEMPLATES[i.template];
      if ((t?.container || t?.paid) && /paid|subscription|containers? (are|is) not (enabled|available)|not entitled|plan/i.test(`${result.error} ${result.log.slice(-1500)}`)) {
        return this.#fail(i, 'deploy', `${t.title} needs the Workers Paid plan ($5/month).`, { text: 'Turn on Workers Paid', href: `https://dash.cloudflare.com/${i.accountId}/workers/plans` });
      }
      return this.#fail(i, 'deploy', `The upload failed: ${result.error || 'no reason given'}`);
    }
    this.#step(i, 'deploy', 'done');
    await this.#save(i);
    await this.ctx.storage.setAlarm(Date.now() + 50);
  }
}
