// S3 cached-answer mode: the comments the fleet already produced, keyed by the ORIGINAL file's git blob hash, so a copy of a
// repo made from its original base gets the same answers without a model call (everything else stays real).
//   node sim/fleet/scripts/build-cache.mjs ~/.local/share/qbfleet/landed > cache.json   (KV bulk format)
import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { targets } from '../src/doc.js';
const root = process.argv[2];
const git = (dir, args) => execSync(`git -C ${dir} ${args}`, { maxBuffer: 1 << 28 }).toString();
const out = new Map(); let files = 0, names = 0, miss = 0;
for (const repo of readdirSync(root)) {
  const dir = join(root, repo);
  const base = git(dir, 'rev-list --max-parents=0 HEAD').trim().split('\n').pop();
  for (const path of git(dir, `diff --name-only ${base} HEAD`).trim().split('\n').filter(Boolean)) {
    const hash = git(dir, `rev-parse ${base}:${path}`).trim();
    if (out.has(hash)) continue;
    const before = git(dir, `show ${base}:${path}`), after = git(dir, `show HEAD:${path}`).split('\n');
    const bl = before.split('\n');
    const c = {};
    let from = 0;
    for (const t of targets(path, before)) {
      const line = bl[t.line];
      const k = after.indexOf(line, from);
      if (k < 1) { miss++; continue; }
      from = k + 1;
      if (after[k - 1].trim() !== '*/') continue;   // no comment was added above this one
      let j = k - 2; const body = [];
      while (j >= 0 && !after[j].trim().startsWith('/**')) body.unshift(after[j--].trim().replace(/^\* ?/, ''));
      if (j >= 0) { c[t.name] = body.join(' ').trim(); names++; }
    }
    if (Object.keys(c).length) { out.set(hash, { c, p: `${repo}:${path}` }); files++; }
  }
}
console.error(JSON.stringify({ files, names, miss }));
console.log(JSON.stringify([...out].map(([key, v]) => ({ key, value: JSON.stringify(v) }))));
