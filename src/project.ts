// Project — one per project (idFromName(project name)). Owns the project's
// main Artifacts repo and the list of its agents. Each agent = one fork of the
// main repo + one AgentBox. v0 keeps this in DO storage; no D1.

import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';
import { log } from './box';

export type Agent = {
  id: string;          // `${project}--${short}` — also the AgentBox name and the fork name
  task: string;
  fork: string;        // Artifacts repo name of the fork
  remote: string;
  createdAt: number;
  state: 'working' | 'pushed' | 'merged' | 'stopped';
};
export type ProjectInfo = { name: string; repo: string; remote: string; createdAt: number; agents: Agent[] };

const NAME_RE = /^[a-z0-9][a-z0-9-]{1,38}$/;

export class Project extends DurableObject<Env> {
  async info(): Promise<ProjectInfo | null> {
    return (await this.ctx.storage.get<ProjectInfo>('info')) || null;
  }

  /** Create the main repo (empty; the first push fills it). */
  async create(name: string, description = ''): Promise<{ info: ProjectInfo; token: string }> {
    if (!NAME_RE.test(name)) throw new Error('name: lowercase letters, digits, dashes');
    if (await this.info()) throw new Error('project exists');
    const created = await this.env.ARTIFACTS.create(name, { description, setDefaultBranch: 'main' });
    const info: ProjectInfo = { name, repo: created.name, remote: created.remote, createdAt: Date.now(), agents: [] };
    await this.ctx.storage.put('info', info);
    log('project', 'created', { name, remote: created.remote });
    return { info, token: created.token };
  }

  /** A write token for the main repo (laptop pushes, merges). */
  async mainToken(ttlS = 3600): Promise<{ remote: string; token: string }> {
    const info = await this.#need();
    using repo = await this.env.ARTIFACTS.get(info.repo);
    const t = await repo.createToken('write', ttlS);
    return { remote: info.remote, token: t.plaintext };
  }

  /** Fork the main repo for a new agent. */
  async addAgent(task: string): Promise<Agent> {
    const info = await this.#need();
    const max = Number(this.env.MAX_AGENTS_PER_PROJECT || 6);
    const live = info.agents.filter((a) => a.state !== 'merged' && a.state !== 'stopped');
    if (live.length >= max) throw new Error(`agent limit reached (${max} per project)`);
    const short = Math.random().toString(36).slice(2, 7);
    const id = `${info.name}--${short}`;
    using repo = await this.env.ARTIFACTS.get(info.repo);
    const forked = await repo.fork(id, { description: task.slice(0, 200), defaultBranchOnly: true });
    const agent: Agent = { id, task, fork: forked.name, remote: forked.remote, createdAt: Date.now(), state: 'working' };
    info.agents.push(agent);
    await this.ctx.storage.put('info', info);
    log('project', 'agent_added', { project: info.name, id, fork: forked.name });
    return agent;
  }

  /** A fresh write token for an agent's fork (minted at every boot). */
  async forkToken(agentId: string, ttlS = 7 * 86400): Promise<{ agent: Agent; token: string }> {
    const info = await this.#need();
    const agent = info.agents.find((a) => a.id === agentId);
    if (!agent) throw new Error('unknown agent');
    using repo = await this.env.ARTIFACTS.get(agent.fork);
    const t = await repo.createToken('write', ttlS);
    return { agent, token: t.plaintext };
  }

  async setState(agentId: string, state: Agent['state']) {
    const info = await this.#need();
    const a = info.agents.find((x) => x.id === agentId);
    if (!a) throw new Error('unknown agent');
    a.state = state;
    await this.ctx.storage.put('info', info);
  }

  /** Newest commits on main and on each fork (no git operation billed: control-plane reads). */
  async commits(limit = 5) {
    const info = await this.#need();
    const read = async (name: string) => {
      try {
        using repo = await this.env.ARTIFACTS.get(name);
        return (await repo.log({ ref: 'main', limit })).map((c: any) => ({
          hash: String(c.hash || c.id || '').slice(0, 8), message: String(c.message || '').split('\n')[0], at: c.author?.date || c.committer?.date || null,
        }));
      } catch (e) { return [{ error: String(e).slice(0, 120) }]; }
    };
    const main = await read(info.repo);
    const forks: Record<string, unknown> = {};
    for (const a of info.agents) forks[a.id] = await read(a.fork);
    return { main, forks };
  }

  async #need(): Promise<ProjectInfo> {
    const info = await this.info();
    if (!info) throw new Error('no such project');
    return info;
  }
}
