// Registry — the one list of projects (a single DO, idFromName('main')).
// Explore reads only this, so a page view never touches Artifacts.

import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';
import type { User } from './auth';

export type Entry = {
  slug: string;          // owner.name (also the Artifacts repo name)
  owner: string;
  name: string;
  description: string;
  forkedFrom: string | null;  // slug of the source project
  createdAt: number;
  updatedAt: number;     // last change to main that forq made or saw
  importedFrom?: { fullName: string; stars: number; license: string | null };
  private?: boolean;     // only its owner sees it anywhere (lists, pages, code, API, live app)
};

export type CliPending = { userCode: string; exp: number; email?: string; label?: string };
export type CliToken = { id: string; email: string; label: string; createdAt: number; usedAt: number };

export class Registry extends DurableObject<Env> {
  async list(): Promise<Entry[]> {
    const m = await this.ctx.storage.list<Entry>({ prefix: 'p:' });
    return [...m.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async get(slug: string): Promise<Entry | null> {
    return (await this.ctx.storage.get<Entry>(`p:${slug}`)) || null;
  }
  async put(e: Entry): Promise<void> {
    await this.ctx.storage.put(`p:${e.slug}`, e);
  }
  async touch(slug: string, at = Date.now()): Promise<void> {
    const e = await this.get(slug);
    if (e) { e.updatedAt = at; await this.put(e); }
  }
  // ---- users: u:<email> → User, h:<handle> → email
  async getUser(email: string): Promise<User | null> {
    return (await this.ctx.storage.get<User>(`u:${email}`)) || null;
  }
  async getUserByHandle(handle: string): Promise<User | null> {
    const email = await this.ctx.storage.get<string>(`h:${handle}`);
    return email ? this.getUser(email) : null;
  }
  async putUser(u: User): Promise<void> {
    const old = await this.getUser(u.email);
    if (old && old.handle !== u.handle) await this.ctx.storage.delete(`h:${old.handle}`);
    await this.ctx.storage.put({ [`u:${u.email}`]: u, [`h:${u.handle}`]: u.email });
  }
  async userCount(): Promise<number> {
    return (await this.ctx.storage.list({ prefix: 'u:' })).size;
  }

  // ---- CLI sign-in (src/cliauth.ts): cd:<device hash> → pending login,
  // cu:<user code> → device hash, ct:<token hash> → CliToken. Only hashes are stored.
  async cliStart(deviceHash: string, userCode: string, exp: number): Promise<void> {
    const old = await this.ctx.storage.list<CliPending>({ prefix: 'cd:' });
    const dead = [...old].filter(([, v]) => v.exp < Date.now()).flatMap(([k, v]) => [k, `cu:${v.userCode}`]);
    if (dead.length) await this.ctx.storage.delete(dead);
    await this.ctx.storage.put({ [`cd:${deviceHash}`]: { userCode, exp } satisfies CliPending, [`cu:${userCode}`]: deviceHash });
  }
  async cliPending(userCode: string): Promise<CliPending | null> {
    const dh = await this.ctx.storage.get<string>(`cu:${userCode}`);
    const p = dh ? await this.ctx.storage.get<CliPending>(`cd:${dh}`) : null;
    return p && p.exp > Date.now() ? p : null;
  }
  async cliApprove(userCode: string, email: string, label: string): Promise<boolean> {
    const dh = await this.ctx.storage.get<string>(`cu:${userCode}`);
    const p = dh ? await this.ctx.storage.get<CliPending>(`cd:${dh}`) : null;
    if (!dh || !p || p.exp < Date.now() || p.email) return false;
    await this.ctx.storage.put(`cd:${dh}`, { ...p, email, label });
    return true;
  }
  /** The approved login for this device, once: stores the new token's hash and forgets the login. */
  async cliClaim(deviceHash: string, tokenHash: string): Promise<{ status: 'pending' | 'expired' | 'ok'; email?: string }> {
    const p = await this.ctx.storage.get<CliPending>(`cd:${deviceHash}`);
    if (!p || p.exp < Date.now()) return { status: 'expired' };
    if (!p.email) return { status: 'pending' };
    await this.ctx.storage.delete([`cd:${deviceHash}`, `cu:${p.userCode}`]);
    const t: CliToken = { email: p.email, label: p.label || 'CLI', createdAt: Date.now(), usedAt: Date.now(), id: tokenHash.slice(0, 8) };
    await this.ctx.storage.put(`ct:${tokenHash}`, t);
    return { status: 'ok', email: p.email };
  }
  async cliToken(tokenHash: string): Promise<CliToken | null> {
    const t = await this.ctx.storage.get<CliToken>(`ct:${tokenHash}`);
    if (t && Date.now() - t.usedAt > 3600_000) { t.usedAt = Date.now(); await this.ctx.storage.put(`ct:${tokenHash}`, t); }
    return t || null;
  }
  async cliTokens(email: string): Promise<CliToken[]> {
    const m = await this.ctx.storage.list<CliToken>({ prefix: 'ct:' });
    return [...m.values()].filter((t) => t.email === email).sort((a, b) => b.createdAt - a.createdAt);
  }
  async cliRevoke(email: string, id: string): Promise<boolean> {
    const m = await this.ctx.storage.list<CliToken>({ prefix: 'ct:' });
    const hit = [...m].find(([, t]) => t.email === email && t.id === id);
    if (hit) await this.ctx.storage.delete(hit[0]);
    return !!hit;
  }

  async remove(slug: string): Promise<void> {
    await this.ctx.storage.delete(`p:${slug}`);
  }
}

export const registry = (env: Env) => env.Registry.get(env.Registry.idFromName('main'));

/** Can this person see this project? Private ones: the owner (and admin) only. */
export const canSee = (e: { owner: string; private?: boolean } | null | undefined, handle: string, admin = false) => !!e && (!e.private || admin || (!!handle && e.owner === handle));
/** The registry as one person may see it. */
export async function listFor(env: Env, handle: string, admin = false): Promise<Entry[]> {
  return (await registry(env).list()).filter((e) => canSee(e, handle, admin));
}
