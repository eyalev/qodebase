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
  { type: 'Text', globs: ['**/*.rev', '**/*-qb.mjs', '**/*-box-api.mjs', '**/*-boot.sh', '**/*-mergejob.mjs'], fallthrough: false },
];
fs.writeFileSync(`${OUT}/wrangler.base.json`, JSON.stringify(c, null, 1));
fs.mkdirSync(`${OUT}/run`, { recursive: true });
fs.copyFileSync('selfhost/run-worker.js', `${OUT}/run/index.js`);
fs.writeFileSync(`${OUT}/run/wrangler.base.json`, JSON.stringify({ name: 'my-qodebase-run', main: 'index.js', compatibility_date: c.compatibility_date, observability: { enabled: true }, workers_dev: true }, null, 1));
// The bundle's path comments name the build machine's directories (/home/<user>/...): published in a public repo, they
// leaked the laptop's layout (privacy scrub, 2026-10-14). Make them relative to the repo; refuse to finish if any remain.
const ROOT = process.cwd().replace(/\/+$/, '') + '/';
const HOME = (process.env.HOME || '/home/x').replace(/\/+$/, '') + '/';
for (const f of fs.readdirSync(`${OUT}/worker`)) {
  const fp = `${OUT}/worker/${f}`;
  if (!/\.(m?js|cjs)$/.test(f) || !fs.statSync(fp).isFile()) continue;
  let t = fs.readFileSync(fp, 'utf8');
  const n0 = t.split(ROOT).length - 1;
  t = t.split(ROOT).join('').split(HOME).join('~/');
  fs.writeFileSync(fp, t);
  if (n0) console.log(`  ${f}: ${n0} absolute path(s) made relative`);
}
const left = fs.readdirSync(`${OUT}/worker`).filter((f) => /\.(m?js|cjs)$/.test(f) && /\/home\/[a-z][a-z0-9_-]*\/[A-Za-z.]/.test(fs.readFileSync(`${OUT}/worker/${f}`, 'utf8')));
if (left.length) { console.error(`absolute /home paths remain in: ${left.join(', ')}`); process.exit(1); }
console.log(`${OUT} ready:`, fs.readdirSync(`${OUT}/worker`).join(' '));
