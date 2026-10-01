// Registry — the one list of projects (a single DO, idFromName('main')).
// Explore reads only this, so a page view never touches Artifacts.

import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';

export type Entry = {
  slug: string;          // owner.name (also the Artifacts repo name)
  owner: string;
  name: string;
  description: string;
  forkedFrom: string | null;  // slug of the source project
  createdAt: number;
  updatedAt: number;     // last change to main that forq made or saw
  importedFrom?: { fullName: string; stars: number; license: string | null };
};

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
  async remove(slug: string): Promise<void> {
    await this.ctx.storage.delete(`p:${slug}`);
  }
}

export const registry = (env: Env) => env.Registry.get(env.Registry.idFromName('main'));
