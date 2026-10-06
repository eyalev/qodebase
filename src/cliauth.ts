// The qodebase CLI (cli/qb.mjs): sign-in, tokens, and the pages that hand it out.
//
// Sign-in is a device flow, so it works from a laptop, a server or an agent's
// shell with no browser: `qb login` asks POST /api/cli/start for a short code,
// the person opens /cli/login on their phone (signed in), checks the code and
// approves; the CLI polls POST /api/cli/token and receives a long-lived token
// (`qb_…`). Requests then carry `authorization: Bearer qb_…` and act as that
// person (index.ts who()). The Registry keeps only SHA-256 hashes of device
// codes and tokens. Tokens are listed and revoked in Settings and by `qb tokens`.

import type { Env } from './env';
import { registry } from './registry';
import { esc, shell } from './ui';
import { log } from './box';
import QB_CLI from '../cli/qb.mjs';

const LOGIN_TTL_MS = 10 * 60_000;
const ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ23456789';   // no vowels (no words), no 0/O/1/I
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });

const b64url = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
async function sha(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const userCode = () => { const r = random(8); const c = [...r].map((b) => ALPHABET[b % ALPHABET.length]).join(''); return `${c.slice(0, 4)}-${c.slice(4)}`; };
const normCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2');

/** The email behind `authorization: Bearer qb_…`; undefined = no bearer header, null = a bad one. */
export async function bearerEmail(env: Env, request: Request): Promise<string | null | undefined> {
  const m = (request.headers.get('authorization') || '').match(/^Bearer\s+(qb_[A-Za-z0-9_-]{20,})$/);
  if (!m) return request.headers.has('authorization') ? null : undefined;
  const t = await registry(env).cliToken(await sha(m[1]));
  return t ? t.email : null;
}

/** Routes that answer before sign-in: start, poll, the CLI file, install script, llms.txt. */
export async function cliPublicRoute(request: Request, env: Env, url: URL): Promise<Response | null> {
  const p = url.pathname;
  if (p === '/api/cli/start' && request.method === 'POST') {
    const b = await request.json().catch(() => ({})) as { label?: string };
    const device = `qbd_${b64url(random(32))}`;
    const code = userCode();
    await registry(env).cliStart(await sha(device), code, Date.now() + LOGIN_TTL_MS);
    log('cli', 'login_start', { label: String(b.label || '').slice(0, 60) });
    return json({ device_code: device, user_code: code, verification_uri: `${url.origin}/cli/login`,
      verification_uri_complete: `${url.origin}/cli/login?code=${code}`, interval: 3, expires_in: LOGIN_TTL_MS / 1000 });
  }
  if (p === '/api/cli/token' && request.method === 'POST') {
    const b = await request.json().catch(() => ({})) as { device_code?: string };
    if (!b.device_code) return json({ error: 'device_code missing' }, 400);
    const token = `qb_${b64url(random(32))}`;
    const r = await registry(env).cliClaim(await sha(b.device_code), await sha(token));
    if (r.status === 'pending') return json({ status: 'pending' }, 428);
    if (r.status === 'expired') return json({ status: 'expired', error: 'This sign-in expired. Run qb login again.' }, 410);
    const u = await registry(env).getUser(r.email!);
    log('cli', 'login_done', { handle: u?.handle });
    return json({ status: 'ok', token, handle: u?.handle || null });
  }
  if (p === '/cli/qb.mjs') return new Response(QB_CLI, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=300' } });
  if (p === '/cli/install.sh') return new Response(installSh(url.origin), { headers: { 'content-type': 'text/x-shellscript; charset=utf-8', 'cache-control': 'public, max-age=300' } });
  if (p === '/llms.txt') return new Response(llmsTxt(url.origin), { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
  if (p === '/cli' || p === '/cli/') return new Response(cliPage(url.origin), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  return null;
}

/** Signed-in routes: the approve page, whoami, tokens. `email` is the signed-in person. */
export async function cliUserRoute(request: Request, env: Env, url: URL, email: string, handle: string): Promise<Response | null> {
  const p = url.pathname;
  if (p === '/cli/login' && request.method === 'GET') {
    const code = normCode(url.searchParams.get('code') || '');
    const pend = code ? await registry(env).cliPending(code) : null;
    return html(approvePage(code, !!pend && !pend.email, handle));
  }
  if (p === '/cli/login' && request.method === 'POST') {
    const form = await request.formData();
    const code = normCode(String(form.get('code') || ''));
    const label = String(form.get('label') || '').trim().slice(0, 60) || 'CLI';
    const ok = await registry(env).cliApprove(code, email, label);
    log('cli', ok ? 'login_approved' : 'login_refused', { handle });
    return html(ok ? donePage(handle) : approvePage(code, false, handle, true), ok ? 200 : 400);
  }
  if (p === '/api/cli/me') return json({ handle, email });
  if (p === '/api/cli/tokens' && request.method === 'GET') {
    return json({ tokens: (await registry(env).cliTokens(email)).map(({ id, label, createdAt, usedAt }) => ({ id, label, createdAt, usedAt })) });
  }
  if (p === '/api/cli/revoke' && request.method === 'POST') {
    const b = await request.json().catch(() => ({})) as { id?: string };
    return json({ ok: await registry(env).cliRevoke(email, String(b.id || '')) });
  }
  return null;
}

const html = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
const CSS = `<style>.field{width:100%;font:16px 'Instrument Sans',sans-serif;padding:12px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg)}
.code{font:600 28px 'JetBrains Mono',monospace;letter-spacing:.06em;margin:8px 0 4px}.cmd{font:14px 'JetBrains Mono',monospace;background:var(--chip);border-radius:8px;padding:10px 12px;white-space:pre-wrap;overflow-wrap:anywhere}
form .btn{margin-top:12px;width:100%}.err{color:var(--bad,#b3261e)}</style>`;

function approvePage(code: string, live: boolean, handle: string, failed = false) {
  if (!code || !live) {
    return shell('Sign in the CLI · qodebase', `${CSS}<a class="back" href="/">qodebase</a>
<h1>Sign in the CLI</h1>
${failed || code ? `<p class="desc err">${code ? 'That code has expired or was already used.' : ''} Run <b>qb login</b> again for a new one.</p>` : ''}
<form method="get" action="/cli/login"><label class="desc" for="c">The code <b>qb login</b> printed</label>
<input class="field" id="c" name="code" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ABCD-EFGH" required>
<button class="btn">Continue</button></form>`);
  }
  return shell('Sign in the CLI · qodebase', `${CSS}<a class="back" href="/">qodebase</a>
<h1>Sign in the CLI</h1>
<p class="desc">Check that this is the code on the computer where you ran <b>qb login</b>:</p>
<p class="code">${esc(code)}</p>
<p class="desc">Approving lets that CLI act as <b>${esc(handle)}</b>: create and fork projects, start agents, merge. Approve only a code you started yourself just now.</p>
<form method="post" action="/cli/login"><input type="hidden" name="code" value="${esc(code)}">
<label class="desc" for="l">Name it (shown in Settings, where you can revoke it)</label>
<input class="field" id="l" name="label" maxlength="60" placeholder="Laptop" autocomplete="off">
<button class="btn">Approve</button></form>`);
}

const donePage = (handle: string) => shell('CLI signed in · qodebase', `${CSS}<a class="back" href="/">qodebase</a>
<h1>Done</h1><p class="desc">The CLI is signed in as <b>${esc(handle)}</b>. Go back to your terminal; it continues by itself.</p>`);

function cliPage(origin: string) {
  return shell('Command line · qodebase', `${CSS}<a class="back" href="/">qodebase</a>
<h1>qodebase from the command line</h1>
<p class="desc">For you and for your agents (Claude Code, Codex, anything with a shell). Needs Node 18 or newer.</p>
<h2>Install</h2><div class="cmd">curl -fsSL ${esc(origin)}/cli/install.sh | sh</div>
<h2>Sign in</h2><div class="cmd">qb login</div>
<p class="desc">It prints a code and a link. Open the link on your phone, check the code, approve.</p>
<h2>Your own AI assistant</h2><div class="cmd">qb install pi</div>
<p class="desc">Installs it into <b>your</b> Cloudflare account. The first time it asks you to approve twice on your phone: qodebase sign-in, then Cloudflare. <span class="cmd" style="display:inline;padding:1px 6px">qb installs</span> lists the others.</p>
<h2>Use it</h2><div class="cmd">qb new "a tip calculator with a dark mode"
qb import github.com/owner/repo
qb fork forq/todo
qb ask eyal/todo "add due dates"
qb agents eyal/todo
qb merge eyal/todo &lt;agent&gt;
qb clone eyal/todo</div>
<p class="desc">Every command prints JSON when its output is piped, so agents can read it. <a href="/llms.txt">llms.txt</a> describes all of them for agents.</p>`);
}

const installSh = (origin: string) => `#!/bin/sh
# Installs the qodebase CLI as ~/.local/bin/qb (needs Node 18+).
set -e
command -v node >/dev/null 2>&1 || { echo "qb needs Node 18 or newer: https://nodejs.org" >&2; exit 1; }
mkdir -p "$HOME/.local/bin"
curl -fsSL ${origin}/cli/qb.mjs -o "$HOME/.local/bin/qb"
chmod +x "$HOME/.local/bin/qb"
echo "Installed qb in $HOME/.local/bin. Next: qb install pi (your own AI assistant), or qb help"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo "Add $HOME/.local/bin to your PATH.";; esac
`;

function llmsTxt(origin: string) {
  return `# qodebase

> A git platform for the age of agents, on Cloudflare, made for the phone. Every
> project runs as a live app; every fork comes with its own agents (Claude Code in a
> container, one fork each). Open source: run your own copy on your Cloudflare account.

## For agents: the qb CLI

Install: \`curl -fsSL ${origin}/cli/install.sh | sh\` (Node 18+), then \`qb login\`
(prints a code; a person approves it at ${origin}/cli/login). Output is JSON when piped
or with --json. Projects are named owner/name. Another instance: --host <url> or QB_HOST.

- \`qb whoami\` — who the token acts as
- \`qb ls [--mine] [--owner <handle>]\` — projects
- \`qb info <owner/name>\` — a project: description, live URL, agents and their states
- \`qb new "<what to build>" [--name <name>]\` — a new project; agents build it
- \`qb import <github url or owner/repo>\` — copy a public GitHub repo in
- \`qb fork <owner/name>\` — your own copy
- \`qb ask <owner/name> "<request>"\` — the project's router agent splits it into tasks, one agent each
- \`qb spawn <owner/name> "<task>"\` — one agent on its own fork, directly
- \`qb agents <owner/name>\` — agents and states (working, pushed, blocked, merged)
- \`qb send <agent-id> "<text>"\` — message an agent
- \`qb chat <agent-id>\` — an agent's conversation so far
- \`qb merge <owner/name> <agent-id>\` — merge an agent's fork into main
- \`qb files <owner/name>\`, \`qb search <owner/name> "<text>"\` — read code without cloning
- \`qb installs\` — your own AI assistants (installed into YOUR Cloudflare account) and the ones you can install
- \`qb install <agents-starter|openclaw|pi|t3code|hermes> [--name n] [--account id]\` — installs one; the first time it prints one link where a person lets qodebase into their Cloudflare account, then waits and prints the assistant's URL (locked to that person by Cloudflare Access). An existing name for the same agent updates it in place (keeps its data); a name used by a different agent is refused. Without a token it starts qb login first
- \`qb clone <owner/name> [dir]\` — git clone (a short-lived token: write for your own projects, read otherwise)
- \`qb open <owner/name>\` — the project's page and live app URLs
- \`qb tokens\`, \`qb revoke <id>\`, \`qb logout\`

## HTTP API

Everything qb does is HTTP with \`authorization: Bearer qb_…\` on ${origin}:
GET /api/projects, GET /api/p/<owner>/<name>, POST /api/build {prompt,name}, POST /api/import {repo},
POST /api/p/<o>/<n>/fork, /router {text}, /agents {task}, /merge {agent}, /git-token,
GET /api/p/<o>/<n>/files, /search?q=, GET|POST /api/installs {template,name,account} (409 + approve_url until Cloudflare is connected), GET /personal-agents/i/<id>.json, GET /api/agents/<id>/state, /conversation, POST /api/agents/<id>/send {text}.
`;
}
