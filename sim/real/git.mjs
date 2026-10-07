// Just enough git to run thousands of commits fast: blobs, trees and commits are
// written as loose objects in-process; only merges shell out (`git merge-tree`,
// which reports real conflicts without a working tree, git ≥ 2.38).
import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';

export function openRepo(dir) {
  if (!existsSync(join(dir, 'HEAD'))) execFileSync('git', ['init', '-q', '--bare', '-b', 'main', dir]);
  const known = new Set();
  const blobText = new Map(); // blob sha -> text
  const treeCache = new Map(); // tree sha -> Map(path -> blob sha)

  function write(type, body) {
    const head = Buffer.from(`${type} ${body.length}\0`);
    const raw = Buffer.concat([head, body]);
    const sha = createHash('sha1').update(raw).digest('hex');
    if (!known.has(sha)) {
      const d = join(dir, 'objects', sha.slice(0, 2)), f = join(d, sha.slice(2));
      if (!existsSync(f)) { mkdirSync(d, { recursive: true }); writeFileSync(f, deflateSync(raw)); }
      known.add(sha);
    }
    return sha;
  }
  function read(sha) {
    const raw = inflateSync(readFileSync(join(dir, 'objects', sha.slice(0, 2), sha.slice(2))));
    const nul = raw.indexOf(0);
    return { type: raw.subarray(0, nul).toString().split(' ')[0], body: raw.subarray(nul + 1) };
  }

  function blob(text) {
    const sha = write('blob', Buffer.from(text));
    blobText.set(sha, text);
    return sha;
  }
  function text(sha) {
    if (!blobText.has(sha)) blobText.set(sha, read(sha).body.toString());
    return blobText.get(sha);
  }

  // snapshot: Map(path -> blob sha) -> root tree sha
  function tree(snapshot) {
    const root = new Map();
    for (const [p, sha] of snapshot) {
      const parts = p.split('/'); let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!node.has(parts[i])) node.set(parts[i], new Map());
        node = node.get(parts[i]);
      }
      node.set(parts[parts.length - 1], sha);
    }
    const writeNode = (node) => {
      // git sorts tree entries by name, with directories compared as "name/".
      const entries = [...node.entries()].map(([name, v]) => (v instanceof Map ? { name, mode: '40000', sha: writeNode(v), key: name + '/' } : { name, mode: '100644', sha: v, key: name }));
      entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      const body = Buffer.concat(entries.map((e) => Buffer.concat([Buffer.from(`${e.mode} ${e.name}\0`), Buffer.from(e.sha, 'hex')])));
      return write('tree', body);
    };
    const sha = writeNode(root);
    treeCache.set(sha, new Map(snapshot));
    return sha;
  }
  function readTree(sha, prefix = '', out = new Map()) {
    if (!prefix && treeCache.has(sha)) return new Map(treeCache.get(sha));
    const b = read(sha).body; let i = 0;
    while (i < b.length) {
      const sp = b.indexOf(32, i), nul = b.indexOf(0, sp);
      const mode = b.subarray(i, sp).toString(), name = b.subarray(sp + 1, nul).toString();
      const child = b.subarray(nul + 1, nul + 21).toString('hex');
      if (mode === '40000') readTree(child, prefix + name + '/', out); else out.set(prefix + name, child);
      i = nul + 21;
    }
    if (!prefix) treeCache.set(sha, new Map(out));
    return out;
  }

  function commit(treeSha, parents, message, when) {
    const ts = Math.floor(when / 1000);
    const who = `qodebase sim <sim@qodebase.app> ${ts} +0000`;
    const body = [`tree ${treeSha}`, ...parents.map((p) => `parent ${p}`), `author ${who}`, `committer ${who}`, '', message, ''].join('\n');
    return write('commit', Buffer.from(body));
  }
  function treeOf(commitSha) {
    return /^tree ([0-9a-f]{40})/.exec(read(commitSha).body.toString())[1];
  }

  // Real three-way merge of two commits. -> { tree, conflicts: [paths] }
  // `base` (optional): apply only base -> theirs onto ours (a change built on a stacked base).
  function merge(ours, theirs, base) {
    const r = spawnSync('git', ['--git-dir', dir, 'merge-tree', '--write-tree', '--name-only', ...(base ? [`--merge-base=${base}`] : []), ours, theirs], { encoding: 'utf8' });
    if (r.status !== 0 && r.status !== 1) throw new Error(`merge-tree failed (${r.status}): ${r.stderr}`);
    const lines = r.stdout.split('\n');
    const conflicts = [];
    for (let i = 1; i < lines.length && lines[i] !== ''; i++) conflicts.push(lines[i]);
    return { tree: lines[0].trim(), conflicts: r.status === 1 ? [...new Set(conflicts)] : [] };
  }

  function setRef(name, sha) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), sha + '\n');
  }

  return { dir, blob, text, tree, readTree, commit, treeOf, merge, setRef };
}
