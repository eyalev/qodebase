// Real builds (docs/board/TASKS.md R2-R5): build a project the way a person does, through the real endpoints, as the
// owner. An idea of a size (POST /api/build/idea), the estimate the Build sheet would show for the chosen settings
// (predictBuild, the page's own code), POST /api/build (private), then the Landing budget. Prints the project's links.
//   node scripts/real/build.mjs --size small|medium|large|huge --preset default|balanced|cheapest|custom
//        [--v '{"coders":20,...}'] --budget 3 [--name real-x] [--avoid 'Title A,Title B'] [--title 'Curated title'] [--dry]
//   (--title needs: node --experimental-strip-types)
// Admin header (acts as eyal): ~/.config/forq/admin-secret. Log: ~/.local/share/qodebase-real/builds.jsonl
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { predictBuild, BUILD_PRESETS } from '../../public/lab/predict.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const size = arg('size', 'small'), preset = arg('preset', 'default'), budget = Number(arg('budget', 3)), dry = process.argv.includes('--dry');
const API = 'https://forq.forqdev.workers.dev';
const H = { 'x-forq-secret': readFileSync(join(homedir(), '.config/forq/admin-secret'), 'utf8').trim(), 'user-agent': 'forq-cli/1', 'content-type': 'application/json' };
const LOG = join(homedir(), '.local/share/qodebase-real/builds.jsonl');
mkdirSync(dirname(LOG), { recursive: true });
const log = (event, data) => { const l = JSON.stringify({ ts: new Date().toISOString(), event, ...data }); appendFileSync(LOG, l + '\n'); console.log(l); };
const call = async (path, body) => { const r = await fetch(API + path, { method: body ? 'POST' : 'GET', headers: H, ...(body ? { body: JSON.stringify(body) } : {}) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${path} ${r.status}: ${JSON.stringify(j).slice(0, 300)}`); return j; };

const avoid = (arg('avoid', '') || '').split(',').map((x) => x.trim()).filter(Boolean);   // titles already built
// --title: a named curated idea, the exact prompt an earlier build used (R6 reruns R3's 'Home inventory' on Fastest).
const title = arg('title', '');
const idea = title
  ? await import('../../src/buildsettings.ts').then((m) => { const i = m.CURATED_IDEAS[size].find((x) => x.title === title); if (!i) throw new Error(`no curated ${size} idea '${title}'`); return { ...i, model: null, fallback: true }; })
  : await call('/api/build/idea', { size, ...(avoid.length ? { avoid } : {}) });
log('idea', { size, title: idea.title, tasks: idea.job?.tasks, model: idea.model, fallback: !!idea.fallback });
// The settings and the variant the estimate uses: the page's mapping (default = one Opus agent = Fastest).
const variant = preset === 'custom' ? JSON.parse(arg('v', '{}')) : preset === 'default' ? BUILD_PRESETS.fastest.variant : BUILD_PRESETS[preset].variant;
const settings = preset === 'default' ? undefined : { preset, ...(preset === 'custom' ? { v: variant } : {}) };
const est = predictBuild({ tasks: idea.job.tasks, overlap: idea.job.overlap, difficulty: idea.job.difficulty, label: idea.job.summary }, variant);
const estimate = { wallS: est.wallS, apiUsd: est.apiUsd, basis: 'idea', basedOn: est.basedOn ?? null, simVersion: est.simVersion ?? null };
const name = arg('name', `real-${idea.job.name || size}`).slice(0, 40);
log('plan', { name, preset, variant, estimate: { wallS: est.wallS, apiUsd: est.apiUsd }, budget });
if (dry) process.exit(0);

const t0 = Date.now();
const b = await call('/api/build', { name, prompt: idea.prompt, private: true, ...(settings ? { settings } : {}), estimate });
const [owner, proj] = String(b.slug || b.info?.slug || '').split('.');
if (!proj) throw new Error(`build: no slug in ${JSON.stringify(b).slice(0, 300)}`);
await call(`/api/p/${owner}/${proj}/landing/flags`, { budgetUsd: budget });
log('built', { slug: `${owner}.${proj}`, ms: Date.now() - t0, budget,
  links: { project: `https://qodebase.app/p/${owner}/${proj}`, work: `https://qodebase.app/p/${owner}/${proj}/work`, timeline: `https://qodebase.app/p/${owner}/${proj}/work#/timeline` } });
