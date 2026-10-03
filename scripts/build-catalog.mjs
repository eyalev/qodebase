// Builds src/catalog.json: popular GitHub projects that forq can run as they are
// (an index.html where forq looks for one, a licence, under 50 MB, no build step),
// grouped by category. The home page lists them; nothing is imported until someone
// taps Import.
//   node scripts/build-catalog.mjs             (every category; uses the gh CLI's login; about 5 minutes)
//   node scripts/build-catalog.mjs learning    (one category, merged into the existing catalogue)
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
const run = promisify(execFile);
const gh = async (path) => JSON.parse((await run('gh', ['api', path], { maxBuffer: 50 << 20 })).stdout);

// category → GitHub topics searched for it
const CATS = {
  games: ['html5-game', 'browser-game', 'javascript-game', 'puzzle-game'],
  creative: ['generative-art', 'drawing-app', 'pixel-art', 'creative-coding'],
  music: ['synthesizer', 'web-audio', 'drum-machine'],
  productivity: ['pomodoro', 'todo-app', 'kanban', 'habit-tracker'],
  tools: ['calculator', 'markdown-editor', 'json-viewer', 'color-picker', 'qr-code-generator'],
  learning: ['typing-test', 'flashcards', 'periodic-table', 'math-games', 'education', 'educational-game', 'quiz', 'language-learning',
    'typing-game', 'explorable-explanations', 'interactive-learning', 'physics-simulation', 'mathematics', 'learn-to-code'],
  slides: ['presentation', 'slides'],
  visual: ['particles', 'data-visualization', 'webgl-demos'],
};
const ENTRY_DIRS = ['', 'demo', 'docs', 'public', 'dist', 'www', 'site', 'examples'];   // forq's own search order
const PERMISSIVE = /^(MIT|Apache-2.0|BSD-2-Clause|BSD-3-Clause|ISC|0BSD|Unlicense|MPL-2.0|CC0-1.0|GPL-2.0|GPL-3.0|AGPL-3.0|LGPL-2.1|LGPL-3.0|WTFPL)$/;
/** Known to run as served although they have a build step (their built files are committed). */
const KEEP = new Set(['hakimel/reveal.js', 'williamngan/pts']);
/** Hand-picked, checked the same way as search results (category → repos). */
const PICKS = {
  // Nicky Case's explorable explanations: games and simulations that teach, plain HTML.
  learning: ['ncase/trust', 'ncase/polygons', 'ncase/ballot', 'ncase/fireflies', 'ncase/crowds', 'ncase/loopy', 'ncase/sight-and-light', 'ncase/remember'],
};
/** Listed by topic but not an app (a plugin's docs site, …). */
const SKIP = new Set(['reuseman/flashcards-obsidian']);

/** Where forq would find the web page: '' for the root, a folder name, or null. */
async function entryOf(r) {
  const root = (await gh(`repos/${r.full_name}/git/trees/${r.default_branch}`).catch(() => ({ tree: [] }))).tree || [];
  if (root.some((x) => x.type === 'blob' && x.path.toLowerCase() === 'index.html')) return '';
  for (const d of ENTRY_DIRS.slice(1)) {
    const dir = root.find((x) => x.type === 'tree' && x.path === d);
    if (!dir) continue;
    const t = (await gh(`repos/${r.full_name}/git/trees/${dir.sha}`).catch(() => ({ tree: [] }))).tree || [];
    if (t.some((x) => x.type === 'blob' && x.path.toLowerCase() === 'index.html')) return d;
  }
  return null;
}

/** Electron apps, and build templates (a React/Vue/Vite app's index.html that only works
 *  after a build) do not run as served; forq serves files as they are. */
async function needsBuild(r, entry) {
  const pkg = await run('gh', ['api', `repos/${r.full_name}/contents/package.json`, '-H', 'Accept: application/vnd.github.raw']).then((x) => JSON.parse(x.stdout)).catch(() => null);
  if (!pkg) return false;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps.electron) return true;
  const framework = deps.react || deps.vue || deps.svelte || deps['@angular/core'] || deps.vite || deps.webpack || deps['react-scripts'];
  return (entry === 'public' || entry === 'demo' || entry === '') && !!framework && !!pkg.scripts?.build;
}

async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const j = i++; out[j] = await fn(items[j]); } })); return out; }

const only = process.argv[2];
if (only && !CATS[only]) { console.error(`no category ${only}; one of ${Object.keys(CATS).join(', ')}`); process.exit(1); }
const cand = new Map();
for (const [cat, full] of Object.entries(PICKS).flatMap(([c, l]) => l.map((f) => [c, f]))) {
  if (only && cat !== only) continue;
  const r = await gh(`repos/${full}`).catch(() => null);
  if (r && !r.fork && !r.archived) cand.set(r.full_name, { r, cat, topic: 'picked' });
}
for (const [cat, topics] of Object.entries(CATS)) {
  if (only && cat !== only) continue;
  for (const t of topics) {
    const res = await gh(`search/repositories?q=${encodeURIComponent(`topic:${t} stars:>150 fork:false archived:false`)}&sort=stars&order=desc&per_page=15`);
    for (const r of res.items || []) if (!cand.has(r.full_name) && !SKIP.has(r.full_name)) cand.set(r.full_name, { r, cat, topic: t });
    await new Promise((s) => setTimeout(s, 2200));   // the search API allows 30 a minute
  }
}
process.stderr.write(`${cand.size} candidates\n`);
const ok = (await pool([...cand.values()], 8, async ({ r, cat, topic }) => {
  const lic = r.license?.spdx_id;
  if (!lic || !PERMISSIVE.test(lic) || r.size > 50 * 1024 || !r.description) return null;
  const entry = await entryOf(r);
  if (entry === null || (!KEEP.has(r.full_name) && await needsBuild(r, entry))) return null;
  process.stderr.write(`${cat}\t${r.stargazers_count}\t${r.full_name}\t${entry || '/'}\n`);
  return { full: r.full_name, desc: r.description.trim().slice(0, 140), stars: r.stargazers_count, license: lic, sizeKb: r.size,
    cat, topic, homepage: r.homepage || null, pushed: Date.parse(r.pushed_at), branch: r.default_branch, entry, lang: r.language || null };
})).filter(Boolean).sort((a, b) => b.stars - a.stars);
const file = new URL('../src/catalog.json', import.meta.url);
// One category: replace that category's entries in the existing catalogue, keep the rest.
const all = only ? [...JSON.parse(readFileSync(file, 'utf8')).projects.filter((p) => p.cat !== only && !ok.some((o) => o.full === p.full)), ...ok].sort((a, b) => b.stars - a.stars) : ok;
writeFileSync(file, JSON.stringify({ builtAt: new Date().toISOString(), projects: all }, null, 1));
console.log(`${ok.length} projects${only ? ` in ${only}, ${all.length} in the catalogue` : ''}`);
