// Build forq-release-selfhost/: qodebase prebuilt for the installer (template
// qodebase in src/install.ts). The installer deploys it with no_bundle into the
// person's account: main Worker from here, the run Worker from run/.
//   node scripts/selfhost-release.mjs   (then commit forq-release-selfhost/ and push forq/forq)
import { execSync } from 'node:child_process';
import fs from 'node:fs';
const OUT = 'forq-release-selfhost';
const BUILD = 'selfhost/.selfhost-build';   // wrangler resolves --outdir next to the config
fs.rmSync(BUILD, { recursive: true, force: true });
execSync(`npx wrangler deploy --dry-run --outdir .selfhost-build --config selfhost/wrangler.jsonc`, { stdio: 'inherit' });
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(`${OUT}/worker`, { recursive: true });
// Every module wrangler wrote (index.js plus the tgz and text modules), kept as is.
for (const f of fs.readdirSync(BUILD)) if (!f.endsWith('.map')) fs.cpSync(`${BUILD}/${f}`, `${OUT}/worker/${f}`, { recursive: true });
fs.cpSync('public', `${OUT}/public`, { recursive: true });
const c = JSON.parse(fs.readFileSync('selfhost/wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, ''));
delete c.$schema;
c.main = 'worker/index.js';
c.no_bundle = true;
c.find_additional_modules = true;
c.base_dir = 'worker';
c.assets = { directory: './public' };
// The bundle names its extra modules <hash>-<file>: the text ones must not be read as JS.
c.rules = [
  { type: 'Data', globs: ['**/*.tgz'], fallthrough: false },
  { type: 'Text', globs: ['**/*.rev', '**/*-qb.mjs', '**/*-box-api.mjs', '**/*-boot.sh'], fallthrough: false },
];
fs.writeFileSync(`${OUT}/wrangler.base.json`, JSON.stringify(c, null, 1));
fs.mkdirSync(`${OUT}/run`, { recursive: true });
fs.copyFileSync('selfhost/run-worker.js', `${OUT}/run/index.js`);
fs.writeFileSync(`${OUT}/run/wrangler.base.json`, JSON.stringify({ name: 'my-qodebase-run', main: 'index.js', compatibility_date: c.compatibility_date, observability: { enabled: true }, workers_dev: true }, null, 1));
console.log(`${OUT} ready:`, fs.readdirSync(`${OUT}/worker`).join(' '));
