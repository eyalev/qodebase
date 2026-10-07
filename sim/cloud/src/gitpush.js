// Minimal git for Workers: build blobs, trees and commits in memory, pack them and
// push with git's smart-HTTP receive-pack. Enough for an agent that only writes.
// No dependencies: SHA-1 below, zlib through CompressionStream('deflate').

const enc = new TextEncoder();

// ---- SHA-1 (sync; inputs here are small) ----
export function sha1(bytes) {
  const ml = bytes.length, words = ((ml + 8) >> 6) + 1, w = new Uint32Array(words * 16);
  for (let i = 0; i < ml; i++) w[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
  w[ml >> 2] |= 0x80 << (24 - (ml % 4) * 8);
  w[words * 16 - 1] = ml * 8;
  w[words * 16 - 2] = Math.floor((ml * 8) / 2 ** 32);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const x = new Uint32Array(80);
  for (let b = 0; b < words * 16; b += 16) {
    for (let i = 0; i < 16; i++) x[i] = w[b + i];
    for (let i = 16; i < 80; i++) { const v = x[i - 3] ^ x[i - 8] ^ x[i - 14] ^ x[i - 16]; x[i] = (v << 1) | (v >>> 31); }
    let a = h0, bb = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (bb & c) | (~bb & d) : i < 40 ? bb ^ c ^ d : i < 60 ? (bb & c) | (bb & d) | (c & d) : bb ^ c ^ d;
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const tmp = (((a << 5) | (a >>> 27)) + f + e + k + x[i]) >>> 0;
      e = d; d = c; c = (bb << 30) | (bb >>> 2); bb = a; a = tmp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + bb) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
}
const hexBytes = (hex) => Uint8Array.from(hex.match(/../g), (h) => parseInt(h, 16));
function concat(parts) {
  const n = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// An object store that remembers what it built: sha -> { type, body }.
export class Objects {
  constructor() { this.map = new Map(); }
  put(type, body) {
    const sha = sha1(concat([enc.encode(`${type} ${body.length}\0`), body]));
    if (!this.map.has(sha)) this.map.set(sha, { type, body });
    return sha;
  }
  blob(text) { return this.put('blob', enc.encode(text)); }
  // snapshot: Map(path -> blob sha) -> root tree sha (every subtree is stored too)
  tree(snapshot) {
    const root = new Map();
    for (const [p, sha] of snapshot) {
      const parts = p.split('/'); let node = root;
      for (let i = 0; i < parts.length - 1; i++) { if (!node.has(parts[i])) node.set(parts[i], new Map()); node = node.get(parts[i]); }
      node.set(parts[parts.length - 1], sha);
    }
    const write = (node) => {
      const entries = [...node.entries()].map(([name, v]) => (v instanceof Map ? { name, mode: '40000', sha: write(v), key: name + '/' } : { name, mode: '100644', sha: v, key: name }));
      entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      return this.put('tree', concat(entries.flatMap((e) => [enc.encode(`${e.mode} ${e.name}\0`), hexBytes(e.sha)])));
    };
    return write(root);
  }
  commit(tree, parents, message, whenMs) {
    const who = `qodebase sim <sim@qodebase.app> ${Math.floor(whenMs / 1000)} +0000`;
    return this.put('commit', enc.encode([`tree ${tree}`, ...parents.map((p) => `parent ${p}`), `author ${who}`, `committer ${who}`, '', message, ''].join('\n')));
  }
}

async function deflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
const TYPE = { commit: 1, tree: 2, blob: 3 };
export async function pack(objects) {
  const parts = [enc.encode('PACK'), new Uint8Array([0, 0, 0, 2]), new Uint8Array(new Uint32Array([objects.length]).buffer).reverse()];
  for (const { type, body } of objects) {
    let size = body.length;
    const head = [(TYPE[type] << 4) | (size & 15)]; size >>= 4;
    while (size) { head[head.length - 1] |= 0x80; head.push(size & 0x7f); size >>= 7; }
    parts.push(new Uint8Array(head), await deflate(body));
  }
  const body = concat(parts);
  return concat([body, hexBytes(sha1(body))]);
}

function pktLine(s) { const b = enc.encode(s); return concat([enc.encode((b.length + 4).toString(16).padStart(4, '0')), b]); }

// Push `newSha` to refs/heads/<branch> (expected current value `oldSha`), sending `objs`.
export async function push({ remote, token, branch = 'main', oldSha, newSha, objs }) {
  const body = concat([pktLine(`${oldSha} ${newSha} refs/heads/${branch}\0report-status agent=qodebase-sim\n`), enc.encode('0000'), await pack(objs)]);
  const res = await fetch(`${remote.replace(/\/$/, '')}/git-receive-pack`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-git-receive-pack-request',
      accept: 'application/x-git-receive-pack-result',
      authorization: `Basic ${btoa(`x:${token.split('?')[0]}`)}`,
      'user-agent': 'git/2.43.0 qodebase-sim',
    },
    body,
  });
  const text = await res.text();
  const ok = res.ok && /unpack ok/.test(text) && new RegExp(`ok refs/heads/${branch}`).test(text);
  return { ok, status: res.status, bytes: body.length, detail: ok ? '' : text.slice(0, 300) };
}
