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
  base?: { commit: string; tree: string };  // main when it was forked: what its Changes diff against
};
/** The last thing the person asked the router agent, and how far delivery got. */
export type RouterRequest = { text: string; at: number; state: 'waking' | 'sent' | 'failed'; sentAt?: number; error?: string };
/** Where an imported project came from (GitHub metadata at import time). */
export type ImportedFrom = { url: string; fullName: string; stars: number; license: string | null; branch: string };
export type ProjectInfo = {
  slug: string; owner: string; name: string; description: string;
  repo: string; remote: string; forkedFrom: string | null; createdAt: number;
  importedFrom?: ImportedFrom;
  /** Path of the web page to preview ('' = root, 'demo/' …); null = none
   *  found; undefined = not looked yet (detected from main's tree). */
  entry?: string | null;
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
  async createFork(owner: string, name: string, source: ProjectInfo): Promise<ProjectInfo> {
    if (await this.info()) throw new Error('project exists');
    const slug = slugOf(owner, name);
    using repo = await this.env.ARTIFACTS.get(source.repo);
    const forked = await repo.fork(slug, { description: source.description, defaultBranchOnly: true });
    const info: ProjectInfo = { slug, owner, name, description: source.description, repo: forked.name, remote: forked.remote,
      forkedFrom: source.slug, createdAt: Date.now(), agents: [], importedFrom: source.importedFrom, entry: source.entry };
    await this.#register(info);
    log('project', 'forked', { slug, from: source.slug });
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
    if (tree && info.entry === undefined) {
      info.entry = await detectEntry(repo, commits[0].hash, tree);
      await this.ctx.storage.put('info', info);
      log('project', 'entry_detected', { slug: info.slug, entry: info.entry });
    }
    return {
      importing: false, entry: info.entry,
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
