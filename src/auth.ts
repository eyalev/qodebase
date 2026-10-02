// Accounts for the public forq.
//
// Sign-in: Cloudflare Access protects only /login (anyone, emailed one-time code). /login
// verifies the Access JWT, finds or creates the user, and sets forq's own
// session cookie (HMAC-signed, 30 days). Everything else reads that cookie;
// pages are public, actions need a session.
//
// Model credentials: the instance owner (OWNER_HANDLE, Eyal) runs boxes on the
// Claude subscription (CLAUDE_CODE_OAUTH_TOKEN). Everyone else brings an
// Anthropic API key, checked against the API and stored AES-GCM encrypted with
// KEY_ENC_SECRET; only its last 4 characters are ever shown.

import type { Env } from './env';
import { log } from './box';
import { registry } from './registry';
import { pushAlert } from './alert';

export type User = {
  email: string;
  handle: string;
  createdAt: number;
  apiKeyEnc?: string;      // base64(iv | ciphertext)
  apiKeyTail?: string;     // last 4 characters, for display
  apiKeyCheckedAt?: number;
  model?: string;          // Claude Code model for their boxes (API-key users)
};

const COOKIE = 'forq_session';
const SESSION_DAYS = 30;
export const DEFAULT_API_MODEL = 'claude-sonnet-5-5';
export const HANDLE_RE = /^[a-z][a-z0-9-]{1,23}$/;
const RESERVED = new Set(['forq', 'admin', 'api', 'login', 'logout', 'settings', 'import', 'explore', 'about', 'privacy', 'p', 'a', 'www', 'help', 'eyal-admin']);

const enc = new TextEncoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function hmacHex(secret: string, msg: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** `email|exp|sig` (base64url) — the cookie value. */
export async function sessionCookie(env: Env, email: string) {
  const exp = Date.now() + SESSION_DAYS * 86400_000;
  const body = `${email}|${exp}`;
  const v = btoa(`${body}|${await hmacHex(env.ADMIN_SECRET, `session:${body}`)}`).replace(/=+$/, '');
  return `${COOKIE}=${v}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`;
}
/** A 2-minute token that hands a session to a design-variant host (variants/). */
export async function handoffToken(env: Env, email: string, host: string) {
  const body = `${email}|${Date.now() + 120_000}|${host}`;
  return btoa(`${body}|${await hmacHex(env.ADMIN_SECRET, `handoff:${body}`)}`);
}
export async function handoffEmail(env: Env, token: string, host: string): Promise<string | null> {
  try {
    const [email, exp, h, sig] = atob(token).split('|');
    if (!email || h !== host || Number(exp) < Date.now()) return null;
    return sig === await hmacHex(env.ADMIN_SECRET, `handoff:${email}|${exp}|${h}`) ? email : null;
  } catch { return null; }
}
export const clearCookie = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

/** The signed-in email, or null. */
export async function sessionEmail(env: Env, request: Request): Promise<string | null> {
  const m = (request.headers.get('cookie') || '').match(new RegExp(`${COOKIE}=([A-Za-z0-9+/]+)`));
  if (!m) return null;
  try {
    const [email, exp, sig] = atob(m[1]).split('|');
    if (!email || Number(exp) < Date.now()) return null;
    return sig === await hmacHex(env.ADMIN_SECRET, `session:${email}|${exp}`) ? email : null;
  } catch { return null; }
}

// ---- API keys -------------------------------------------------------------
async function aesKey(env: Env) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`forq-api-keys:${env.KEY_ENC_SECRET}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptKey(env: Env, plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(plain)));
  const out = new Uint8Array(iv.length + ct.length); out.set(iv); out.set(ct, iv.length);
  return b64(out);
}
export async function decryptKey(env: Env, blob: string) {
  const all = unb64(blob);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, await aesKey(env), all.slice(12));
  return new TextDecoder().decode(pt);
}

/** Is this a working Anthropic API key? One cheap call (list models). */
export async function checkApiKey(key: string): Promise<{ ok: boolean; error?: string }> {
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) return { ok: false, error: 'That does not look like an Anthropic API key (sk-ant-…).' };
  const r = await fetch('https://api.anthropic.com/v1/models?limit=1', {
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
  }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }) as any);
  if (r.ok) return { ok: true };
  log('auth', 'api_key_rejected', { status: r.status });
  return { ok: false, error: r.status === 401 ? 'Anthropic rejected this key (401).' : `Could not check the key (HTTP ${r.status}).` };
}

// ---- users ----------------------------------------------------------------
export const userByEmail = (env: Env, email: string) => registry(env).getUser(email.toLowerCase());
export const userByHandle = (env: Env, handle: string) => registry(env).getUserByHandle(handle);

/** A free handle suggestion from an email's local part. */
export async function suggestHandle(env: Env, email: string) {
  let base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^[^a-z]+/, '').replace(/-+$/, '').slice(0, 20) || 'user';
  if (base.length < 2) base = `user-${base}`;
  for (let i = 0; i < 50; i++) {
    const h = i ? `${base}-${i + 1}` : base;
    if (!RESERVED.has(h) && !(await userByHandle(env, h))) return h;
  }
  return `user-${crypto.randomUUID().slice(0, 6)}`;
}

export async function claimHandle(env: Env, email: string, handle: string): Promise<{ ok: boolean; error?: string; user?: User }> {
  handle = handle.trim().toLowerCase();
  if (!HANDLE_RE.test(handle)) return { ok: false, error: '2–24 characters: lowercase letters, digits and dashes, starting with a letter.' };
  if (RESERVED.has(handle)) return { ok: false, error: 'That name is reserved.' };
  const taken = await userByHandle(env, handle);
  if (taken && taken.email !== email.toLowerCase()) return { ok: false, error: 'That name is taken.' };
  const user: User = { email: email.toLowerCase(), handle, createdAt: Date.now() };
  await registry(env).putUser(user);
  log('auth', 'user_created', { handle });
  if (!taken) await pushAlert(env, 'forq: new sign-up', `${handle} (${user.email}) chose a name on forq.`, `https://${env.UI_HOST}/`);
  return { ok: true, user };
}

/** The owner of this instance runs on the subscription; nobody else does. */
export const isOwner = (env: Env, handle: string) => handle === env.OWNER_HANDLE || handle === 'forq';
