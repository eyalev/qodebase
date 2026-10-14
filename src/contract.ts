// The team's contract (qb5, manager 2026-10-14, Eyal approved): the ONE contracts file a crew build's skeleton writes
// (record shapes + the signatures of functions modules call in each other; SKELETON_WHAT in src/buildsettings.ts),
// shown on the project's Board next to Intents, with the change that created it and the later ones that edited it.
//
//   GET /api/p/<o>/<n>/contract   (same readers as /landing: anyone who may see the project)
//
// Where the file is: the skeleton change's own record (the files it changed) first, then any change's files, then a
// name search over main (contracts.* / *contract*). Read from main's HEAD; nothing is written.
import type { Env } from './env';
import { head, resolvePath, blob, allFiles } from './code';

import { contractFromChanges, contractHistory, langOf, best, type View } from './contractcore';

const log = (event: string, data: Record<string, unknown>) => console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', module: 'contract', event, ...data }));

export async function contractAnswer(env: Env, ctx: ExecutionContext, info: { slug: string; repo: string }, view: View) {
  const t0 = Date.now();
  const changes = view?.changes || [];
  const h = await head(env, ctx, info.repo);
  if (!h) return { none: true, why: 'The project has no code on main yet.' };
  let hit = contractFromChanges(changes) as { path: string; via: 'skeleton' | 'change' | 'search' } | null;
  // The change records name a path that no longer exists (renamed) or there are none: search main by name.
  let entry = hit ? await resolvePath(env, ctx, info.repo, h.tree, hit.path) : null;
  if (!entry || entry.type !== 'blob') {
    const all = await allFiles(env, ctx, info.repo, h.tree, 5000);
    const p = best(all.files.map((f) => f.path));
    hit = p ? { path: p, via: 'search' } : null;
    entry = hit ? await resolvePath(env, ctx, info.repo, h.tree, hit.path) : null;
  }
  if (!hit || !entry || entry.type !== 'blob') { log('none', { slug: info.slug, changes: changes.length, ms: Date.now() - t0 }); return { none: true }; }
  const b = await blob(env, ctx, info.repo, entry.hash, hit.path);
  const hist = contractHistory(changes, hit.path);
  log('found', { slug: info.slug, path: hit.path, via: hit.via, bytes: b.bytes, edits: hist.edits.length, ms: Date.now() - t0 });
  return { path: hit.path, via: hit.via, lang: langOf(hit.path), text: b.text, bytes: b.bytes, tooBig: b.tooBig, binary: b.binary,
    main: { commit: h.commit, at: h.at }, lines: b.text ? b.text.replace(/\n$/, '').split('\n').length : 0, ...hist };
}
