// Project — one per project (idFromName(slug)). Owns the project's main
// Artifacts repo and its agents. Each agent = one fork of main + one AgentBox;
// the router (`<slug>--router`) is an AgentBox on a clone of main itself.

import { DurableObject } from 'cloudflare:workers';
import { NAME_RE, slugOf, type Env } from './env';
import { log } from './box';
import { registry, type Entry } from './registry';

export type Agent = {
  id: string;          // `${slug}--${short}`: AgentBox name and fork repo name
  task: string;
  fork: string;
  remote: string;
  createdAt: number;
  state: 'working' | 'pushed' | 'merged' | 'stopped' | 'blocked';
  note?: string;       // the agent's last `forq status` note
  noteAt?: number;
  request?: string;    // the person's request that led to it (router-spawned agents)
};
/** The last thing the person asked the router agent, and how far delivery got. */
export type RouterRequest = { text: string; at: number; state: 'waking' | 'sent' | 'failed'; sentAt?: number; error?: string };
export type ProjectInfo = {
  slug: string; owner: string; name: string; description: string;
  repo: string; remote: string; forkedFrom: string | null; createdAt: number;
  agents: Agent[];
  lastRequest?: RouterRequest;
};

export class Project extends DurableObject<Env> {
  async info(): Promise<ProjectInfo | null> {
    return (await this.ctx.storage.get<ProjectInfo>('info')) || null;
  }

  async #register(info: ProjectInfo) {
    await this.ctx.storage.put('info', info);
    const e: Entry = { slug: info.slug, owner: info.owner, name: info.name, description: info.description,
      forkedFrom: info.forkedFrom, createdAt: info.createdAt, updatedAt: Date.now() };
    await registry(this.env).put(e);
  }

  /** A new, empty project (the first push fills main). Returns a write token for that push. */
  async create(owner: string, name: string, description: string): Promise<{ info: ProjectInfo; token: string }> {
    if (!NAME_RE.test(owner) || !NAME_RE.test(name)) throw new Error('names: lowercase letters, digits, dashes');
    if (await this.info()) throw new Error('project exists');
    const slug = slugOf(owner, name);
    const created = await this.env.ARTIFACTS.create(slug, { description, setDefaultBranch: 'main' });
    const info: ProjectInfo = { slug, owner, name, description, repo: created.name, remote: created.remote,
      forkedFrom: null, createdAt: Date.now(), agents: [] };
    await this.#register(info);
    log('project', 'created', { slug });
    return { info, token: created.token };
  }

  /** This project as a fork of `source` (a user-level fork: own page, own agents). */
  async createFork(owner: string, name: string, source: ProjectInfo): Promise<ProjectInfo> {
    if (await this.info()) throw new Error('project exists');
    const slug = slugOf(owner, name);
    using repo = await this.env.ARTIFACTS.get(source.repo);
    const forked = await repo.fork(slug, { description: source.description, defaultBranchOnly: true });
    const info: ProjectInfo = { slug, owner, name, description: source.description, repo: forked.name, remote: forked.remote,
      forkedFrom: source.slug, createdAt: Date.now(), agents: [] };
    await this.#register(info);
    log('project', 'forked', { slug, from: source.slug });
    return info;
  }

  async mainToken(ttlS = 3600): Promise<{ remote: string; token: string }> {
    const info = await this.#need();
    using repo = await this.env.ARTIFACTS.get(info.repo);
    const t = await repo.createToken('write', ttlS);
    return { remote: info.remote, token: t.plaintext };
  }

  async addAgent(task: string): Promise<Agent> {
    const info = await this.#need();
    const max = Number(this.env.MAX_AGENTS_PER_PROJECT || 6);
    const live = info.agents.filter((a) => a.state === 'working' || a.state === 'pushed' || a.state === 'blocked');
    if (live.length >= max) throw new Error(`agent limit reached (${max} open per project)`);
    const id = `${info.slug}--${Math.random().toString(36).slice(2, 7)}`;
    using repo = await this.env.ARTIFACTS.get(info.repo);
    const forked = await repo.fork(id, { description: task.slice(0, 200), defaultBranchOnly: true });
    const agent: Agent = { id, task, fork: forked.name, remote: forked.remote, createdAt: Date.now(), state: 'working',
      request: info.lastRequest && Date.now() - info.lastRequest.at < 30 * 60_000 ? info.lastRequest.text.slice(0, 1000) : undefined };
    info.agents.push(agent);
    await this.ctx.storage.put('info', info);
    log('project', 'agent_added', { slug: info.slug, id });
    return agent;
  }

  /** Remote + write token for what a box clones: its fork, or main for the router. */
  async boxRepo(agentId: string, ttlS = 7 * 86400): Promise<{ task: string; remote: string; token: string; router: boolean }> {
    const info = await this.#need();
    if (agentId === `${info.slug}--router`) {
      using repo = await this.env.ARTIFACTS.get(info.repo);
      return { task: '', remote: info.remote, token: (await repo.createToken('write', ttlS)).plaintext, router: true };
    }
    const agent = info.agents.find((a) => a.id === agentId);
    if (!agent) throw new Error('unknown agent');
    using repo = await this.env.ARTIFACTS.get(agent.fork);
    return { task: agent.task, remote: agent.remote, token: (await repo.createToken('write', ttlS)).plaintext, router: false };
  }

  /** What the router needs to merge an agent: the fork's remote + a read token. */
  async forkForMerge(agentId: string): Promise<{ remote: string; token: string }> {
    const info = await this.#need();
    const agent = info.agents.find((a) => a.id === agentId);
    if (!agent) throw new Error('unknown agent');
    using repo = await this.env.ARTIFACTS.get(agent.fork);
    return { remote: agent.remote, token: (await repo.createToken('read', 600)).plaintext };
  }

  async setRequest(patch: Partial<RouterRequest>) {
    const info = await this.#need();
    info.lastRequest = { ...(info.lastRequest || { text: '', at: Date.now(), state: 'waking' }), ...patch } as RouterRequest;
    await this.ctx.storage.put('info', info);
  }

  async setState(agentId: string, state: Agent['state'], note?: string) {
    const info = await this.#need();
    const a = info.agents.find((x) => x.id === agentId);
    if (!a) throw new Error('unknown agent');
    a.state = state;
    if (note !== undefined) { a.note = note.slice(0, 500); a.noteAt = Date.now(); }
    await this.ctx.storage.put('info', info);
    if (state === 'merged') await registry(this.env).touch(info.slug);
  }

  /** Main's newest commits + root files, for the project page. */
  async overview() {
    const info = await this.#need();
    using repo = await this.env.ARTIFACTS.get(info.repo);
    const commits = await repo.log({ ref: 'main', limit: 5 }).catch(() => []);
    const tree = commits[0] ? await repo.readTree(commits[0].treeHash).catch(() => null) : null;
    const readme = commits[0] ? await repo.readFile({ ref: commits[0].hash, path: 'README.md' }).catch(() => null) : null;
    return {
      commits: commits.map((c) => ({ hash: c.hash, message: c.message.split('\n')[0], at: c.committedAt * 1000, author: c.author.name })),
      files: (tree || []).map((e) => ({ name: e.name, dir: e.type === 'tree' })),
      readme: readme ? (await readme.text()).slice(0, 20000) : null,
    };
  }

  /** Admin cleanup: forget this project's state (does not delete repos). */
  async wipe(): Promise<void> {
    const info = await this.info();
    if (info?.slug) await registry(this.env).remove(info.slug);
    await this.ctx.storage.deleteAll();
  }

  async #need(): Promise<ProjectInfo> {
    const info = await this.info();
    if (!info) throw new Error('no such project');
    return info;
  }
}
