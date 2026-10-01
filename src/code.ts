// Reading code out of Artifacts for the code browser, the diff view and search.
//
// Everything is addressed by git object hash, which is content-addressed and
// immutable, so it is memoised per colo in caches.default for a day under the
// hash alone: a folder or file that main and a fork share is read once, and a
// diff only descends into folders whose hashes differ. Only "what is HEAD of
// repo X" is short-lived (15 s), same as the run host.

import { log } from './box';
import type { Env } from './env';

export type TreeEntry = { name: string; type: 'tree' | 'blob' | 'commit'; hash: string; mode: string };
export type Head = { commit: string; tree: string; message: string; at: number };

const C = 'https://forq-code-cache.internal';
const IMMUTABLE = 'max-age=86400';
export const MAX_VIEW_BYTES = 512 * 1024;     // larger files: offer the raw link instead
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|bmp|svgz|woff2?|ttf|otf|eot|mp3|ogg|wav|mp4|webm|mov|zip|gz|tgz|bz2|7z|pdf|wasm|exe|dll|so|dylib|bin|psd|ai|sketch|fig)$/i;

async function memo<T>(ctx: ExecutionContext, key: string, ttl: string, make: () => Promise<T>): Promise<T> {
  const k = new Request(`${C}/${key}`);
  const hit = await caches.default.match(k);
  if (hit) return hit.json() as Promise<T>;
  const v = await make();
  if (v !== null && v !== undefined) ctx.waitUntil(caches.default.put(k, new Response(JSON.stringify(v), { headers: { 'cache-control': ttl } })));
  return v;
}

/** HEAD of a repo's default branch (15 s memo). */
export async function head(env: Env, ctx: ExecutionContext, repo: string): Promise<Head | null> {
  return memo(ctx, `head/${repo}`, 'max-age=15', async () => {
    using r = await env.ARTIFACTS.get(repo);
    const c = (await r.log({ limit: 1 }))[0];
    return c ? { commit: c.hash, tree: c.treeHash, message: c.message.split('\n')[0], at: c.committedAt * 1000 } : null;
  });
}

/** One folder's entries, by tree hash. */
export async function tree(env: Env, ctx: ExecutionContext, repo: string, hash: string): Promise<TreeEntry[]> {
  return memo(ctx, `tree/${hash}`, IMMUTABLE, async () => {
    using r = await env.ARTIFACTS.get(repo);
    const t = await r.readTree(hash);
    return (t || []).map((e) => ({ name: e.name, type: e.type as TreeEntry['type'], hash: e.hash, mode: e.mode }));
  });
}

/** Walk from the root tree to `path` ('' = root). Returns the entry, or null. */
export async function resolvePath(env: Env, ctx: ExecutionContext, repo: string, rootTree: string, path: string): Promise<TreeEntry | null> {
  let cur: TreeEntry = { name: '', type: 'tree', hash: rootTree, mode: '040000' };
  for (const seg of path.split('/').filter(Boolean)) {
    if (cur.type !== 'tree') return null;
    const next = (await tree(env, ctx, repo, cur.hash)).find((e) => e.name === seg);
    if (!next) return null;
    cur = next;
  }
  return cur;
}

export type Blob = { text: string | null; bytes: number; binary: boolean; tooBig: boolean };

/** A file's contents by blob hash: text if it is text and not huge. */
export async function blob(env: Env, ctx: ExecutionContext, repo: string, hash: string, name = ''): Promise<Blob> {
  return memo(ctx, `blob/${hash}`, IMMUTABLE, async () => {
    using r = await env.ARTIFACTS.get(repo);
    const b = await r.readBlob(hash);
    if (!b) return { text: null, bytes: 0, binary: false, tooBig: false };
    const bytes = b.size;
    if (BINARY_EXT.test(name)) return { text: null, bytes, binary: true, tooBig: false };
    if (bytes > MAX_VIEW_BYTES) return { text: null, bytes, binary: false, tooBig: true };
    const buf = new Uint8Array(await b.arrayBuffer());
    // NUL in the first 8 KB = binary, the same test git uses.
    if (buf.subarray(0, 8192).includes(0)) return { text: null, bytes, binary: true, tooBig: false };
    return { text: new TextDecoder().decode(buf), bytes, binary: false, tooBig: false };
  });
}

export type FileRef = { path: string; hash: string };

/** Every file under a tree, recursively (path + blob hash), capped. */
export async function allFiles(env: Env, ctx: ExecutionContext, repo: string, rootTree: string, cap = 5000): Promise<{ files: FileRef[]; truncated: boolean }> {
  return memo(ctx, `files/${rootTree}`, IMMUTABLE, async () => {
    const files: FileRef[] = [];
    let truncated = false;
    const walk = async (hash: string, prefix: string): Promise<void> => {
      const entries = await tree(env, ctx, repo, hash);
      const dirs: Promise<void>[] = [];
      for (const e of entries) {
        if (files.length >= cap) { truncated = true; return; }
        if (e.type === 'tree') dirs.push(walk(e.hash, `${prefix}${e.name}/`));
        else if (e.type === 'blob') files.push({ path: prefix + e.name, hash: e.hash });
      }
      await Promise.all(dirs);
    };
    await walk(rootTree, '');
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files, truncated };
  });
}

export type Change = { path: string; status: 'added' | 'removed' | 'modified'; oldHash?: string; newHash?: string };

/** Files that differ between two trees. Equal subtree hashes are skipped
 *  without being read, so the cost is proportional to what changed. */
export async function diffTrees(env: Env, ctx: ExecutionContext, oldRepo: string, oldTree: string, newRepo: string, newTree: string): Promise<Change[]> {
  const out: Change[] = [];
  const all = async (repo: string, hash: string, prefix: string, status: 'added' | 'removed') => {
    for (const f of (await allFiles(env, ctx, repo, hash)).files) {
      out.push(status === 'added' ? { path: prefix + f.path, status, newHash: f.hash } : { path: prefix + f.path, status, oldHash: f.hash });
    }
  };
  const walk = async (a: string, b: string, prefix: string): Promise<void> => {
    if (a === b) return;
    const [ta, tb] = await Promise.all([tree(env, ctx, oldRepo, a), tree(env, ctx, newRepo, b)]);
    const ma = new Map(ta.map((e) => [e.name, e])), mb = new Map(tb.map((e) => [e.name, e]));
    const jobs: Promise<void>[] = [];
    for (const [name, eb] of mb) {
      const ea = ma.get(name);
      const p = prefix + name;
      if (!ea) jobs.push(eb.type === 'tree' ? all(newRepo, eb.hash, p + '/', 'added') : Promise.resolve(void out.push({ path: p, status: 'added', newHash: eb.hash })));
      else if (ea.hash !== eb.hash) {
        if (ea.type === 'tree' && eb.type === 'tree') jobs.push(walk(ea.hash, eb.hash, p + '/'));
        else if (ea.type !== 'tree' && eb.type !== 'tree') out.push({ path: p, status: 'modified', oldHash: ea.hash, newHash: eb.hash });
        else { out.push({ path: p, status: 'removed', oldHash: ea.hash }); out.push({ path: p, status: 'added', newHash: eb.hash }); }
      }
    }
    for (const [name, ea] of ma) {
      if (mb.has(name)) continue;
      const p = prefix + name;
      jobs.push(ea.type === 'tree' ? all(oldRepo, ea.hash, p + '/', 'removed') : Promise.resolve(void out.push({ path: p, status: 'removed', oldHash: ea.hash })));
    }
    await Promise.all(jobs);
  };
  await walk(oldTree, newTree, '');
  out.sort((x, y) => x.path.localeCompare(y.path));
  return out;
}

/** Where a fork started, for agents created before forq recorded it: main's
 *  newest commit from before the fork was made (that is what fork() copied),
 *  checked to be in the fork's history. Diffing against it shows only the
 *  agent's own work, even once it or other agents were merged into main. */
export async function forkBase(env: Env, mainRepo: string, forkRepo: string, forkedAt: number): Promise<{ commit: string; tree: string } | null> {
  using m = await env.ARTIFACTS.get(mainRepo);
  using f = await env.ARTIFACTS.get(forkRepo);
  const [ml, fl] = await Promise.all([m.log({ limit: 300 }), f.log({ limit: 300 })]);
  const inFork = new Set(fl.map((c) => c.hash));
  const base = ml.find((c) => c.committedAt * 1000 <= forkedAt && inFork.has(c.hash));
  if (!base) log('code', 'fork_base_not_found', { mainRepo, forkRepo, main: ml.length, fork: fl.length });
  return base ? { commit: base.hash, tree: base.treeHash } : null;
}
