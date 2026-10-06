// Project — one per project (idFromName(slug)). Owns the project's main
// Artifacts repo and its agents. Each agent = one fork of main + one AgentBox;
// the router (`<slug>--router`) is an AgentBox on a clone of main itself.

import { DurableObject } from 'cloudflare:workers';
import { NAME_RE, appHost, appWorkerName, previewAlias, slugOf, type Env } from './env';
import { excludeFromRunRoute } from './build';
import type { BuildJob, BuildResult } from './build';
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
  base?: { commit: string; tree: string };  // main when it was forked: what its Changes diff against
  review?: Review;
  preview?: Deploy;    // Worker projects: its fork deployed as a Preview
};
/** A deploy of a Worker project's main (app) or of an agent fork (preview). */
export type Deploy = { status: 'building' | 'live' | 'failed'; url?: string; commit?: string; at: number; error?: string; log?: string };
/** The reviewer agent's verdict on an agent's latest push. */
export type Review = { state: 'queued' | 'reviewing' | 'approved' | 'changes' | 'sent'; notes?: string; at: number; commit?: string };
/** The last thing the person asked the router agent, and how far delivery got. */
export type RouterRequest = { text: string; at: number; state: 'waking' | 'sent' | 'failed'; sentAt?: number; error?: string;
  /** What is actually typed to the router agent, when it differs from `text` (what the page quotes). */
  payload?: string; attempts?: number };
/** Where an imported project came from (GitHub metadata at import time). */
export type ImportedFrom = { url: string; fullName: string; stars: number; license: string | null; branch: string };
export type Role = 'agent' | 'router' | 'reviewer';
export const roleOf = (id: string): Role => id.endsWith('--router') ? 'router' : id.endsWith('--review') ? 'reviewer' : 'agent';
export type ProjectInfo = {
  slug: string; owner: string; name: string; description: string;
  repo: string; remote: string; forkedFrom: string | null; createdAt: number;
  importedFrom?: ImportedFrom;
  /** Path of the web page to preview ('' = root, 'demo/' …); null = none
   *  found; undefined = not looked yet (detected from main's tree). */
  entry?: string | null;
  /** 'worker' = has a wrangler config at the root: deployed by forq's builder. */
  kind?: 'worker' | 'static';
  app?: Deploy & { worker: string };
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
      forkedFrom: info.forkedFrom, createdAt: info.createdAt, updatedAt: Date.now(),
      importedFrom: info.importedFrom ? { fullName: info.importedFrom.fullName, stars: info.importedFrom.stars, license: info.importedFrom.license } : undefined };
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
  /** `fresh`: a new project started from a starter (Build), not shown as a fork of it. */
  async createFork(owner: string, name: string, source: ProjectInfo, description = source.description, fresh = false): Promise<ProjectInfo> {
    if (await this.info()) throw new Error('project exists');
    const slug = slugOf(owner, name);
    using repo = await this.env.ARTIFACTS.get(source.repo);
    const forked = await repo.fork(slug, { description, defaultBranchOnly: true });
    const info: ProjectInfo = { slug, owner, name, description, repo: forked.name, remote: forked.remote,
      forkedFrom: fresh ? null : source.slug, createdAt: Date.now(), agents: [], importedFrom: fresh ? undefined : source.importedFrom, entry: source.entry };
    await this.#register(info);
    log('project', fresh ? 'started' : 'forked', { slug, from: source.slug });
    return info;
  }

  /** A project imported from a public GitHub repo (shallow). Artifacts imports
   *  in the background; the page shows "Importing" until main can be read. */
  async createImported(owner: string, name: string, src: ImportedFrom, description: string): Promise<ProjectInfo> {
    if (!NAME_RE.test(owner) || !NAME_RE.test(name)) throw new Error('names: lowercase letters, digits, dashes');
    if (await this.info()) throw new Error('project exists');
    const slug = slugOf(owner, name);
    const imported = await this.env.ARTIFACTS.import({
      source: { url: src.url, branch: src.branch, depth: 1 },
      target: { name: slug, opts: { description: description.slice(0, 300) } },
    });
    const info: ProjectInfo = { slug, owner, name, description, repo: imported.name, remote: imported.remote,
      forkedFrom: null, createdAt: Date.now(), agents: [], importedFrom: src };
    await this.#register(info);
    log('project', 'imported', { slug, from: src.fullName, branch: src.branch });
    return info;
  }

  /** Owner override of the previewed page: a folder ('demo/') or a file ('demo.html'). */
  async setEntry(entry: string | null) {
    const info = await this.#need();
    if (entry !== null && !/^([\w.-]+\/)*([\w.-]+\.html?)?$/.test(entry)) throw new Error('entry: a folder like demo/ or a file like demo.html');
    info.entry = entry;
    await this.ctx.storage.put('info', info);
  }

  async mainToken(ttlS = 3600): Promise<{ remote: string; token: string }> {
    const info = await this.#need();
    using repo = await this.env.ARTIFACTS.get(info.repo);
    const t = await repo.createToken('write', ttlS);
    return { remote: info.remote, token: t.plaintext };
  }

  /** A git token for main (qb clone): write for the owner, read for others; 1 hour. */
  async gitToken(mode: 'read' | 'write'): Promise<{ remote: string; token: string; branch: string | null }> {
    const info = await this.#need();
    using repo = await this.env.ARTIFACTS.get(info.repo);
    const t = await repo.createToken(mode, 3600);
    return { remote: info.remote, token: t.plaintext, branch: info.importedFrom?.branch || null };
  }

  async addAgent(task: string): Promise<Agent> {
    const info = await this.#need();
    const max = Number(this.env.MAX_AGENTS_PER_PROJECT || 6);
    const live = info.agents.filter((a) => a.state === 'working' || a.state === 'pushed' || a.state === 'blocked');
    if (live.length >= max) throw new Error(`agent limit reached (${max} open per project)`);
    const id = `${info.slug}--${Math.random().toString(36).slice(2, 7)}`;
    using repo = await this.env.ARTIFACTS.get(info.repo);
    const baseC = (await repo.log({ limit: 1 }).catch(() => []))[0];
    const forked = await repo.fork(id, { description: task.slice(0, 200), defaultBranchOnly: true });
    const agent: Agent = { id, task, fork: forked.name, remote: forked.remote, createdAt: Date.now(), state: 'working',
      request: info.lastRequest && Date.now() - info.lastRequest.at < 30 * 60_000 ? info.lastRequest.text.slice(0, 1000) : undefined,
      base: baseC ? { commit: baseC.hash, tree: baseC.treeHash } : undefined };
    info.agents.push(agent);
    await this.ctx.storage.put('info', info);
    log('project', 'agent_added', { slug: info.slug, id });
    return agent;
  }

  /** Remote + write token for what a box clones: its fork, or main for the router. */
  async boxRepo(agentId: string, ttlS = 7 * 86400): Promise<{ task: string; remote: string; token: string; role: Role }> {
    const info = await this.#need();
    const role = roleOf(agentId);
    if (role !== 'agent') {
      // Router: main, writable (it merges). Reviewer: main, read-only (it only reads).
      using repo = await this.env.ARTIFACTS.get(info.repo);
      return { task: '', remote: info.remote, token: (await repo.createToken(role === 'router' ? 'write' : 'read', ttlS)).plaintext, role };
    }
    const agent = info.agents.find((a) => a.id === agentId);
    if (!agent) throw new Error('unknown agent');
    using repo = await this.env.ARTIFACTS.get(agent.fork);
    return { task: agent.task, remote: agent.remote, token: (await repo.createToken('write', ttlS)).plaintext, role };
  }

  // ---- builds (Worker projects): BuildBox `<slug>--build` --------------------
  /** Queue a deploy of main, or a Preview of an agent's fork. */
  async requestBuild(kind: 'deploy' | 'preview', agentId?: string) {
    const info = await this.#need();
    if (this.env.OWNER_HANDLE !== info.owner && info.owner !== 'forq') throw new Error('Worker deploys are reserved for the owner of this forq instance');
    const agent = agentId ? info.agents.find((a) => a.id === agentId) : undefined;
    if (kind === 'preview' && !agent) throw new Error('unknown agent');
    const repoName = agent ? agent.fork : info.repo;
    using repo = await this.env.ARTIFACTS.get(repoName);
    const token = (await repo.createToken('read', 3600)).plaintext;
    const job: BuildJob = { id: crypto.randomUUID().slice(0, 8), slug: info.slug, kind, repo: repoName, remote: agent ? agent.remote : info.remote,
      token, worker: appWorkerName(info.slug), alias: agent ? previewAlias(agent.id) : undefined, host: appHost(info.slug, this.env.APPS_DOMAIN), agentId, queuedAt: Date.now() };
    const building: Deploy = { status: 'building', at: Date.now() };
    if (agent) agent.preview = { ...agent.preview, ...building, error: undefined };
    else info.app = { ...(info.app || {}), ...building, error: undefined, worker: job.worker };
    await this.ctx.storage.put('info', info);
    await this.env.BuildBox.get(this.env.BuildBox.idFromName(`${info.slug}--build`)).enqueue(job);
  }

  /** BuildBox reports back. A ready preview of a pushed agent starts its review. */
  async buildDone(r: BuildResult) {
    const info = await this.#need();
    const d: Deploy = { status: r.ok ? 'live' : 'failed', url: r.url, commit: r.commit, at: Date.now(), error: r.error, log: r.log };
    if (r.agentId) {
      const a = info.agents.find((x) => x.id === r.agentId);
      if (!a) return;
      a.preview = { ...d, url: r.url || a.preview?.url };
      await this.ctx.storage.put('info', info);
      if (a.state === 'pushed') await this.#kick('review', a.id);
    } else {
      info.app = { ...d, url: r.url || info.app?.url, worker: info.app?.worker || appWorkerName(info.slug) };
      await this.ctx.storage.put('info', info);
      if (r.ok) await registry(this.env).touch(info.slug);
      const host = appHost(info.slug, this.env.APPS_DOMAIN);
      if (r.ok && host) await excludeFromRunRoute(this.env, host);
    }
    log('project', 'build_done', { slug: info.slug, agentId: r.agentId, ok: r.ok, url: r.url, ms: r.ms, error: r.error });
  }

  /** Ask the Worker to do something only it can (wake the reviewer box). */
  async #kick(what: 'review', agentId: string) {
    const info = await this.#need();
    const [owner, name] = info.slug.split('.');
    const r = await fetch(`${this.env.API_BASE}/api/p/${owner}/${name}/review`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forq-secret': this.env.ADMIN_SECRET, 'user-agent': 'forq-internal/1' },
      body: JSON.stringify({ agent: agentId }),
    }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }) as any);
    log('project', 'kick', { what, agentId, ok: r.ok, status: r.status });
  }

  async kindOf() { return (await this.#need()).kind; }

  // ---- reviews: one reviewer per project, one review at a time -----------
  /** Queue a review of an agent's latest push. Returns the agent to review
   *  now if the reviewer is free, else null (it is picked up on the next verdict). */
  async queueReview(agentId: string, commit?: string): Promise<string | null> {
    const info = await this.#need();
    const a = info.agents.find((x) => x.id === agentId);
    if (!a) throw new Error('unknown agent');
    a.review = { state: 'queued', at: Date.now(), commit };
    await this.ctx.storage.put('info', info);
    const busy = info.agents.some((x) => x.review?.state === 'reviewing');
    return busy ? null : this.#startNext(info);
  }

  async #startNext(info: ProjectInfo): Promise<string | null> {
    const next = info.agents.filter((x) => x.review?.state === 'queued').sort((x, y) => x.review!.at - y.review!.at)[0];
    if (!next) return null;
    next.review = { ...next.review!, state: 'reviewing', at: Date.now() };
    await this.ctx.storage.put('info', info);
    return next.id;
  }

  /** The reviewer's verdict. Returns the next agent to review, if any. */
  async setVerdict(agentId: string, verdict: 'approved' | 'changes', notes: string): Promise<string | null> {
    const info = await this.#need();
    const a = info.agents.find((x) => x.id === agentId);
    if (!a) throw new Error('unknown agent');
    a.review = { state: verdict, notes: notes.slice(0, 2000), at: Date.now(), commit: a.review?.commit };
    await this.ctx.storage.put('info', info);
    log('project', 'review_verdict', { slug: info.slug, agentId, verdict });
    return this.#startNext(info);
  }

  /** A review stuck in 'reviewing' (box died) goes back to the queue. */
  async requeueStale(maxMs = 20 * 60_000): Promise<string | null> {
    const info = await this.#need();
    let changed = false;
    for (const a of info.agents) if (a.review?.state === 'reviewing' && Date.now() - a.review.at > maxMs) { a.review.state = 'queued'; changed = true; }
    if (changed) await this.ctx.storage.put('info', info);
    return info.agents.some((x) => x.review?.state === 'reviewing') ? null : this.#startNext(info);
  }

  async markReviewSent(agentId: string) {
    const info = await this.#need();
    const a = info.agents.find((x) => x.id === agentId);
    if (a?.review) { a.review.state = 'sent'; a.review.at = Date.now(); await this.ctx.storage.put('info', info); }
  }

  /** What the reviewer needs: the fork (read token) and where the agent started. */
  async reviewInfo(agentId: string): Promise<{ remote: string; token: string; base: string | null; task: string; request?: string; entry: string; previewUrl?: string }> {
    const info = await this.#need();
    const a = info.agents.find((x) => x.id === agentId);
    if (!a) throw new Error('unknown agent');
    using repo = await this.env.ARTIFACTS.get(a.fork);
    return { remote: a.remote, token: (await repo.createToken('read', 1800)).plaintext, base: a.base?.commit || null,
      task: a.task, request: a.request, entry: info.entry || '', previewUrl: info.kind === 'worker' ? a.preview?.url : undefined };
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

  /** Deliver the last request to the router agent from an alarm, retrying.
   *  Waking a box plus typing can outlast a request's waitUntil (~30 s): a
   *  request sat at "waking" for 38 min with nothing delivered (2026-10-01).
   *  The alarm calls the Worker's deliver verb and waits for it. */
  async scheduleDelivery() {
    await this.ctx.storage.put('deliverPending', true);
    await this.ctx.storage.setAlarm(Date.now() + 50);
  }

  /** Review watchdog. Every review is handed to the reviewer from this alarm,
   *  which then keeps watching until a verdict lands: if the reviewer is idle
   *  or asleep for 3 minutes with no verdict, the review is handed over again
   *  (5 times at most), then recorded as unfinished. Replaces direct dispatch,
   *  which lost reviews three ways on 2026-10-01 (typed into a busy reviewer,
   *  typed during /clear, gave up while the reviewer was busy). */
  async scheduleReviewDispatch(agentId: string) {
    await this.ctx.storage.put('reviewDispatch', { agentId, tries: 0, sends: 0, sentAt: 0 });
    await this.ctx.storage.setAlarm(Date.now() + 1000);
  }

  async #reviewAlarm(): Promise<boolean> {
    type Job = { agentId: string; tries: number; sends: number; sentAt: number };
    const job = await this.ctx.storage.get<Job>('reviewDispatch');
    if (!job) return false;
    const info = await this.#need();
    const a = info.agents.find((x) => x.id === job.agentId);
    if (!a || a.review?.state !== 'reviewing') { await this.ctx.storage.delete('reviewDispatch'); return false; }   // verdict in
    const [owner, name] = info.slug.split('.');
    const call = async (verb: string, body: unknown) => {
      const r = await fetch(`${this.env.API_BASE}/api/p/${owner}/${name}/${verb}`, {
        method: 'POST', headers: { 'x-forq-secret': this.env.ADMIN_SECRET, 'user-agent': 'forq-internal/1', 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(5 * 60_000),
      }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: String(e) }) }) as any);
      return { ok: r.ok, status: r.status, ...(await r.json().catch(() => ({}))) } as { ok: boolean; status: number; busy?: boolean; idle?: boolean; error?: string };
    };
    // Every call above waits, and a verdict or a new job can land meanwhile (the DO
    // takes other calls while this one waits on fetch). Act and write only while this
    // is still the job and its agent is still in review; otherwise leave the newer
    // job alone. (2026-10-03: a check of a finished review handed it out again and
    // wrote it back over the next one; that review then sat in 'reviewing', unwatched.)
    const current = async () => {
      const j = await this.ctx.storage.get<Job>('reviewDispatch');
      if (!j || j.agentId !== job.agentId || j.sends !== job.sends || j.sentAt !== job.sentAt) return false;
      const now = (await this.#need()).agents.find((x) => x.id === job.agentId);
      return now?.review?.state === 'reviewing';
    };
    const superseded = async () => {
      log('project', 'review_job_superseded', { slug: info.slug, agentId: job.agentId, next: (await this.ctx.storage.get<Job>('reviewDispatch'))?.agentId ?? null });
      return !!(await this.ctx.storage.get<Job>('reviewDispatch'));
    };
    if (job.sentAt) {
      // Sent: is the reviewer still at it?
      const st = await call('reviewer-state', {});
      if (!(await current())) return superseded();
      if (!st.idle || Date.now() - job.sentAt < 3 * 60_000) return true;
      if (job.sends >= 5) {
        await this.ctx.storage.delete('reviewDispatch');
        log('project', 'review_unfinished', { slug: info.slug, agentId: job.agentId, sends: job.sends });
        const next = await this.setVerdict(job.agentId, 'changes', 'The reviewer agent did not finish this review. Look at the changes yourself, or push again to retry.');
        if (next) await this.scheduleReviewDispatch(next);
        return false;
      }
      log('project', 'review_resend', { slug: info.slug, agentId: job.agentId, sends: job.sends });
    }
    if (!(await current())) return superseded();
    const r = await call('review-dispatch', { agent: job.agentId });
    log('project', 'review_dispatch_attempt', { slug: info.slug, agentId: job.agentId, ok: r.ok, busy: r.busy, sends: job.sends, err: r.error });
    if (!(await current())) return superseded();
    if (r.ok) await this.ctx.storage.put('reviewDispatch', { ...job, sends: job.sends + 1, sentAt: Date.now() });
    else await this.ctx.storage.put('reviewDispatch', { ...job, tries: job.tries + 1 });
    return true;
  }

  async alarm() {
    const again = await this.#reviewAlarm();
    // A job not yet handed over (just queued while this run waited) goes at once.
    if (again) await this.ctx.storage.setAlarm(Date.now() + ((await this.ctx.storage.get<{ sentAt: number }>('reviewDispatch'))?.sentAt === 0 ? 1000 : 30_000));
    if (!(await this.ctx.storage.get<boolean>('deliverPending'))) return;
    const info = await this.#need();
    const q = info.lastRequest;
    if (!q || q.state !== 'waking') { await this.ctx.storage.delete('deliverPending'); return; }
    const attempt = (q.attempts || 0) + 1;
    await this.setRequest({ attempts: attempt });
    const [owner, name] = info.slug.split('.');
    let ok = false, err = '';
    try {
      const r = await fetch(`${this.env.API_BASE}/api/p/${owner}/${name}/deliver`, {
        method: 'POST', headers: { 'x-forq-secret': this.env.ADMIN_SECRET, 'user-agent': 'forq-internal/1', 'content-type': 'application/json' },
        body: JSON.stringify({ at: q.at }), signal: AbortSignal.timeout(5 * 60_000),
      });
      const j = await r.json().catch(() => ({})) as { ok?: boolean; error?: string };
      ok = r.ok && j.ok !== false; err = j.error || (r.ok ? '' : `HTTP ${r.status}`);
    } catch (e) { err = String((e as Error)?.message || e); }
    log('project', 'deliver_attempt', { slug: info.slug, attempt, ok, err });
    // Errors no retry can fix fail at once (a missing API key took 3 tries / 90 s to say so).
    if (!ok && /has not added an Anthropic API key|reserved for the owner/.test(err)) {
      await this.setRequest({ state: 'failed', error: err });
      await this.ctx.storage.delete('deliverPending');
      return;
    }
    if (ok) { await this.ctx.storage.delete('deliverPending'); if (again) await this.ctx.storage.setAlarm(Date.now() + 30_000); return; }
    if (attempt >= 3) {
      await this.setRequest({ state: 'failed', error: `could not reach the router agent after ${attempt} tries: ${err}` });
      await this.ctx.storage.delete('deliverPending');
      return;
    }
    await this.ctx.storage.setAlarm(Date.now() + attempt * 30_000);
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
    let repo: ArtifactsRepo;
    try { repo = await this.env.ARTIFACTS.get(info.repo); } catch (e) {
      // get() throws while an import or fork is still in progress.
      log('project', 'overview_not_ready', { slug: info.slug, err: String(e).slice(0, 160) });
      return { importing: true, entry: info.entry, commits: [], files: [], readme: null };
    }
    using _r = repo;
    const commits = await repo.log({ limit: 5 }).catch(() => []);   // HEAD: imports keep GitHub's branch name
    const tree = commits[0] ? await repo.readTree(commits[0].treeHash).catch(() => null) : null;
    const readmeName = (tree || []).find((e) => /^readme(\.md|\.markdown)?$/i.test(e.name))?.name || 'README.md';
    const readme = commits[0] ? await repo.readFile({ ref: commits[0].hash, path: readmeName }).catch(() => null) : null;
    if (tree && info.kind === undefined) {
      info.kind = tree.some((e) => e.type !== 'tree' && /^wrangler\.(toml|json|jsonc)$/.test(e.name)) ? 'worker' : 'static';
      await this.ctx.storage.put('info', info);
      log('project', 'kind_detected', { slug: info.slug, kind: info.kind });
    }
    if (tree && info.entry === undefined) {
      info.entry = await detectEntry(repo, commits[0].hash, tree);
      await this.ctx.storage.put('info', info);
      log('project', 'entry_detected', { slug: info.slug, entry: info.entry });
    }
    // First deploy of a Worker project. After every put above: requestBuild
    // re-reads and saves info itself, so nothing here may save over it later.
    if (info.kind === 'worker' && !info.app) {
      if (this.env.OWNER_HANDLE === info.owner || info.owner === 'forq') {
        await this.requestBuild('deploy');
        Object.assign(info, await this.#need());
      } else {
        // Deploys run other people's server code on this account: owner only.
        info.app = { status: 'failed', at: Date.now(), worker: '', error: 'Deploying Worker projects is reserved for the owner of this forq instance. Self-host forq to deploy your own (see SELF_HOST.md). Agents can still work on the code' };
        await this.ctx.storage.put('info', info);
      }
    }
    return {
      importing: false, entry: info.entry, kind: info.kind, app: info.app,
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

  // ---- content search ---------------------------------------------------
  // One FTS5 table (trigram: substring matches, like grep) holding the text
  // files of the few most recent versions searched, keyed by root tree hash.
  // Built on the first search of a version; the four newest versions are kept.
  #indexing = new Map<string, Promise<{ files: number; bytes: number; skipped: number }>>();

  #ensureSearchTables() {
    const sql = this.ctx.storage.sql;
    sql.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS code_fts USING fts5(ver UNINDEXED, path, body, tokenize='trigram')`);
    sql.exec(`CREATE TABLE IF NOT EXISTS code_idx (ver TEXT PRIMARY KEY, files INTEGER, bytes INTEGER, skipped INTEGER, at INTEGER)`);
  }

  async #buildIndex(repoName: string, rootTree: string) {
    const t0 = Date.now();
    const MAX_FILES = 3000, MAX_TOTAL = 20 * 1024 * 1024, MAX_FILE = 256 * 1024;
    const SKIP = /\.(png|jpe?g|gif|webp|ico|bmp|woff2?|ttf|otf|eot|mp3|ogg|wav|mp4|webm|mov|zip|gz|tgz|7z|pdf|wasm|lock|min\.js|min\.css|map)$/i;
    using repo = await this.env.ARTIFACTS.get(repoName);
    const files: { path: string; hash: string }[] = [];
    const walk = async (hash: string, prefix: string): Promise<void> => {
      const entries = (await repo.readTree(hash)) || [];
      const dirs: Promise<void>[] = [];
      for (const e of entries) {
        if (files.length >= MAX_FILES) return;
        if (e.type === 'tree') { if (!/^(node_modules|\.git|vendor)$/.test(e.name)) dirs.push(walk(e.hash, `${prefix}${e.name}/`)); }
        else if (e.type === 'blob' && !SKIP.test(e.name)) files.push({ path: prefix + e.name, hash: e.hash });
      }
      await Promise.all(dirs);
    };
    await walk(rootTree, '');
    let bytes = 0, skipped = 0, n = 0;
    const sql = this.ctx.storage.sql;
    for (let i = 0; i < files.length; i += 12) {
      const batch = await Promise.all(files.slice(i, i + 12).map(async (f) => {
        const b = await repo.readBlob(f.hash).catch(() => null);
        if (!b || b.size > MAX_FILE) return null;
        const buf = new Uint8Array(await b.arrayBuffer());
        if (buf.subarray(0, 8192).includes(0)) return null;
        return { path: f.path, text: new TextDecoder().decode(buf) };
      }));
      for (const r of batch) {
        if (!r || bytes + r.text.length > MAX_TOTAL) { skipped++; continue; }
        sql.exec(`INSERT INTO code_fts (ver, path, body) VALUES (?, ?, ?)`, rootTree, r.path, r.text);
        bytes += r.text.length; n++;
      }
    }
    sql.exec(`INSERT OR REPLACE INTO code_idx (ver, files, bytes, skipped, at) VALUES (?, ?, ?, ?, ?)`, rootTree, n, bytes, skipped, Date.now());
    // Keep the four most recently built versions.
    const old = sql.exec(`SELECT ver FROM code_idx ORDER BY at DESC LIMIT -1 OFFSET 4`).toArray() as { ver: string }[];
    for (const o of old) { sql.exec(`DELETE FROM code_fts WHERE ver = ?`, o.ver); sql.exec(`DELETE FROM code_idx WHERE ver = ?`, o.ver); }
    log('project', 'search_indexed', { repo: repoName, tree: rootTree.slice(0, 8), files: n, bytes, skipped, pruned: old.length, ms: Date.now() - t0 });
    return { files: n, bytes, skipped };
  }

  /** Search the text files of one version (repo + root tree) for `q`. */
  async searchCode(repoName: string, rootTree: string, q: string) {
    this.#ensureSearchTables();
    const sql = this.ctx.storage.sql;
    const have = sql.exec(`SELECT files, skipped FROM code_idx WHERE ver = ?`, rootTree).toArray()[0] as { files: number; skipped: number } | undefined;
    let indexedNow = false;
    if (!have) {
      let p = this.#indexing.get(rootTree);
      if (!p) { p = this.#buildIndex(repoName, rootTree).finally(() => this.#indexing.delete(rootTree)); this.#indexing.set(rootTree, p); }
      await p;
      indexedNow = true;
    }
    const needle = q.trim();
    if (needle.length < 3) return { error: 'type at least 3 characters', results: [] };
    // A trigram phrase query = case-insensitive substring match.
    const phrase = `"${needle.replace(/"/g, '""')}"`;
    const rows = sql.exec(`SELECT path, body FROM code_fts WHERE code_fts MATCH ? AND ver = ? LIMIT 60`, phrase, rootTree).toArray() as { path: string; body: string }[];
    const lower = needle.toLowerCase();
    const results = rows.map((r) => {
      const lines: { n: number; text: string }[] = [];
      const all = r.body.split('\n');
      for (let i = 0; i < all.length && lines.length < 6; i++) if (all[i].toLowerCase().includes(lower)) lines.push({ n: i + 1, text: all[i].slice(0, 300) });
      let count = 0; for (const l of all) if (l.toLowerCase().includes(lower)) count++;
      return { path: r.path, lines, count };
    }).filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
    const meta = sql.exec(`SELECT files, skipped FROM code_idx WHERE ver = ?`, rootTree).toArray()[0] as { files: number; skipped: number };
    return { results, indexedNow, files: meta?.files ?? 0, skipped: meta?.skipped ?? 0 };
  }

  async #need(): Promise<ProjectInfo> {
    const info = await this.info();
    if (!info) throw new Error('no such project');
    return info;
  }
}

/** Where the project's web page is: index.html at the root, else in one of the
 *  usual folders. The preview opens AT that folder (relative ../ links keep
 *  working because the whole repo is served). */
const ENTRY_DIRS = ['demo', 'docs', 'public', 'dist', 'www', 'site', 'example', 'examples', 'web', 'app'];
async function detectEntry(repo: ArtifactsRepo, ref: string, tree: ArtifactsTreeEntry[]): Promise<string | null> {
  if (tree.some((e) => e.type !== 'tree' && e.name.toLowerCase() === 'index.html')) return '';
  for (const d of ENTRY_DIRS) {
    const dir = tree.find((e) => e.type === 'tree' && e.name.toLowerCase() === d);
    if (!dir) continue;
    const f = await repo.readFile({ ref, path: `${dir.name}/index.html` }).catch(() => null);
    if (f) return `${dir.name}/`;
  }
  return null;
}
