#!/usr/bin/env node
// Variants lab scorer: how good is what a run built? Runs on the LAPTOP only, after a run,
// on a clone of the run's final main. Hidden acceptance tests are read from the private
// lab-hidden repo ($LAB_HIDDEN_DIR), never from this public repo.
//
//   node scripts/lab/score.mjs --scenario <cafe-family|port-ts> --repo <clone> [--judge] [--app <url>]
//
// Prints ONE JSON line, the runs.jsonl quality block (docs/lab/runs-schema.md):
//   {hiddenPass, hiddenTotal, build, typecheck, ownTests, judgeScore, judgeModel, score,
//    scorer, failed, notes, ...details}
// Exit 0 whatever the code scored; exit 2 only when the scorer itself could not run.
// The repo is copied first; the clone you pass is never changed.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync, mkdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { qualityScore } from '../../public/lab/score.js';

const SCORER = '1';
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SCENARIO = opt('--scenario');
const REPO = opt('--repo', opt('--dir'));
const HIDDEN = opt('--hidden', process.env.LAB_HIDDEN_DIR || join(homedir(), '<lab-hidden dir>'));
const TSC = join(ROOT, 'node_modules/.bin/tsc');
const { NODE_TEST_CONTEXT, ...ENV } = process.env; // so nested `node --test` runs report normally

function fail(msg) { console.log(JSON.stringify({ scorer: SCORER, error: msg })); process.exit(2); }
if (!SCENARIO || !REPO) fail('usage: --scenario <id> --repo <dir>');
if (!existsSync(join(HIDDEN, SCENARIO))) fail(`no hidden tests for ${SCENARIO} in ${HIDDEN}`);

const run = (cmd, a, cwd, env = {}) => {
  const r = spawnSync(cmd, a, { cwd, encoding: 'utf8', env: { ...ENV, ...env }, timeout: 180_000, maxBuffer: 64 << 20 });
  return { code: r.status ?? (r.error ? -1 : 0), out: (r.stdout || '') + (r.stderr || '') };
};
// node --test TAP: count the results at one nesting depth (0 = top level, 1 = inside a describe)
const tap = (out, depth) => {
  const pad = ' '.repeat(4 * depth), res = [];
  for (const l of out.split('\n')) {
    const m = l.match(new RegExp(`^${pad}(ok|not ok) \\d+ - (.*?)(?: # .*)?$`));
    if (m && !l.startsWith(pad + ' ')) res.push({ ok: m[1] === 'ok', name: m[2] });
  }
  return res;
};
const files = (dir, ext) => {
  const out = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === '__hidden__') continue;
    const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (!ext || p.endsWith(ext)) out.push(p);
  } };
  walk(dir); return out;
};

const W = mkdtempSync(join(tmpdir(), `qblab-${SCENARIO}-`));
cpSync(REPO, W, { recursive: true, filter: (s) => !s.includes('/.git/') && !s.endsWith('/.git') && !s.includes('/node_modules') });
const H = join(W, '__hidden__'); mkdirSync(H);
const result = { hiddenPass: 0, hiddenTotal: 0, build: false, typecheck: false, ownTests: false,
  judgeScore: null, judgeModel: null, score: 0, scorer: SCORER, failed: [], notes: '' };
const notes = [];

try {
  if (SCENARIO === 'cafe-family') {
    // floor: every module parses; the site's own tests; build = the site renders and nothing
    // that worked before is broken (the hidden "keep:" tests)
    const js = files(W, '.js').concat(files(W, '.mjs'));
    const bad = js.filter((f) => run('node', ['--check', f], W).code !== 0);
    result.typecheck = bad.length === 0;
    if (bad.length) notes.push(`syntax errors in ${bad.map((f) => relative(W, f)).join(', ')}`);
    result.ownTests = run('node', ['--test'], W).code === 0;
    const t = run('node', ['--test', '--test-reporter=tap', join(HIDDEN, 'cafe-family/acceptance.test.mjs')], W, { LAB_REPO: W });
    const res = tap(t.out, 0);
    if (!res.length) notes.push('acceptance tests did not run: ' + t.out.split('\n').filter((l) => /Error/.test(l)).slice(0, 2).join(' | '));
    const keep = res.filter((r) => r.name.startsWith('keep:')), fam = res.filter((r) => r.name.startsWith('family:'));
    result.build = keep.length > 0 && keep.every((r) => r.ok);
    if (!result.build) notes.push('broken: ' + keep.filter((r) => !r.ok).map((r) => r.name.slice(6)).join('; '));
    result.hiddenTotal = 7; // fixed, so a crash scores 0 of 7 rather than 0 of 0
    // breaking what worked before costs hidden points too: family passes x share of keep passing
    const keepShare = keep.length ? keep.filter((r) => r.ok).length / keep.length : 0;
    result.hiddenPass = Math.floor(fam.filter((r) => r.ok).length * keepShare);
    result.failed = [...fam.filter((r) => !r.ok).map((r) => r.name), ...(fam.length ? [] : ['family: all (did not run)'])];
  } else if (SCENARIO === 'port-ts') {
    const index = join(W, 'src/index.ts');
    const ported = existsSync(index);
    const behaviour = readFileSync(join(HIDDEN, 'port-ts/behaviour.test.js'), 'utf8');
    const cases = readFileSync(join(HIDDEN, 'port-ts/types.ts'), 'utf8');
    const FUNCS = ['isEmail', 'isFQDN', 'isIP', 'isURL', 'isByteLength', 'isIPRange', 'isMACAddress', 'isPort', 'isInt', 'isLength',
      'isHexadecimal', 'isBase64', 'isJWT', 'isUUID', 'isSlug', 'isEmpty', 'contains', 'equals', 'escape', 'unescape',
      'trim', 'ltrim', 'rtrim', 'toInt', 'toFloat', 'toBoolean', 'blacklist', 'whitelist', 'stripLow', 'isAscii',
      'isLowercase', 'isUppercase', 'isIn', 'isDataURI', 'isMimeType', 'isSemVer', 'isHash', 'isMD5', 'isAlpha',
      'isAlphanumeric', 'isNumeric', 'isDecimal', 'isFloat', 'isBoolean', 'isJSON', 'isHexColor', 'isLatLong', 'isMagnetURI'];
    const nBehaviour = (behaviour.match(/^  it\(/gm) || []).length + (behaviour.match(/^    it\(/gm) || []).length;
    const typeCases = [...cases.split('\n').entries()].filter(([, l]) => / \/\/ CASE /.test(l))
      .map(([i, l]) => ({ line: i + 1, name: 'type: ' + l.split('// CASE ')[1].trim(), expectError: l.includes('// CASE !') }));
    const CHECKS = ['port: no JavaScript left in src', 'port: every function has a TypeScript module', 'port: no explicit any',
      'port: src/index.ts exports every function, the default object and version'];
    result.hiddenTotal = nBehaviour + typeCases.length + CHECKS.length;
    const failed = [];
    if (!ported) {
      notes.push('not ported: src/index.ts does not exist');
      failed.push('all (no src/index.ts)');
      result.ownTests = run('node', ['--test'], W).code === 0;
    } else {
      // floor
      const load = run('node', ['--input-type=module', '-e', `const m = await import(${JSON.stringify(index)}); if (!m.default) process.exit(3);`], W);
      result.build = load.code === 0;
      if (!result.build) notes.push('src/index.ts does not load: ' + load.out.split('\n').find((l) => /Error/.test(l)));
      writeFileSync(join(H, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext',
        moduleResolution: 'NodeNext', strict: true, noEmit: true, allowImportingTsExtensions: true, skipLibCheck: true,
        types: [] }, include: ['../src/**/*.ts'] }));
      const tc = run(TSC, ['-p', join(H, 'tsconfig.json')], W);
      const typeErrors = (tc.out.match(/error TS\d+/g) || []).length;
      result.typecheck = tc.code === 0;
      result.typeErrors = typeErrors;
      result.ownTests = run('node', ['--test'], W).code === 0;
      // hidden behaviour: upstream's own tests, with the scorer's pristine helpers, TypeScript only
      const starterTests = join(HERE, 'scenarios/port-ts/starter/test');
      for (const f of ['testFunctions.js', 'sanitize.js']) cpSync(join(starterTests, f), join(H, f));
      writeFileSync(join(H, 'lib.js'), "const lib = await import('../src/index.ts');\nexport default lib.default;\n");
      writeFileSync(join(H, 'behaviour.test.js'), behaviour);
      const b = tap(run('node', ['--test', '--test-reporter=tap', join(H, 'behaviour.test.js')], W).out, 1);
      const bOk = b.filter((r) => r.ok).length;
      failed.push(...b.filter((r) => !r.ok).map((r) => 'behaviour: ' + r.name));
      if (b.length < nBehaviour) failed.push(`behaviour: ${nBehaviour - b.length} did not run`);
      // hidden types
      writeFileSync(join(H, 'types.ts'), cases);
      writeFileSync(join(H, 'tsconfig.types.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext',
        moduleResolution: 'NodeNext', strict: true, noEmit: true, allowImportingTsExtensions: true, skipLibCheck: true,
        types: [] }, files: ['types.ts'] }));
      const tt = run(TSC, ['-p', join(H, 'tsconfig.types.json')], W);
      const errLines = new Map();
      for (const [, f, line, code] of tt.out.matchAll(/^(.*?)\((\d+),\d+\): error (TS\d+)/gm)) {
        if (!f.endsWith('__hidden__/types.ts')) continue;
        errLines.set(+line, (errLines.get(+line) || []).concat(code));
      }
      const importBroken = [...errLines.keys()].some((l) => l <= 6);
      let tOk = 0;
      for (const c of typeCases) {
        const ok = !importBroken && (c.expectError ? !errLines.has(c.line - 1) : !errLines.has(c.line));
        if (ok) tOk++; else failed.push(c.name);
      }
      if (importBroken) notes.push('the hidden type tests could not import src/index.ts');
      // hidden structure checks
      const srcJs = files(join(W, 'src'), '.js');
      const libTs = new Set(files(join(W, 'src'), '.ts').map((f) => f.split('/').pop().replace(/\.ts$/, '')));
      const anyHits = files(join(W, 'src'), '.ts').flatMap((f) => (readFileSync(f, 'utf8').match(/:\s*any\b|\bas any\b|<any>|any\[\]/g) || []));
      const ex = run('node', ['--input-type=module', '-e', `const m = await import(${JSON.stringify(index)});
        const need = ${JSON.stringify(FUNCS)};
        const ok = need.every((f) => typeof m[f] === 'function' && typeof m.default?.[f] === 'function') && typeof m.version === 'string';
        process.exit(ok ? 0 : 4);`], W);
      const checks = [srcJs.length === 0, FUNCS.every((f) => libTs.has(f)), anyHits.length === 0, ex.code === 0];
      if (srcJs.length) notes.push(`${srcJs.length} .js files left in src`);
      if (anyHits.length) notes.push(`${anyHits.length} explicit any`);
      checks.forEach((ok, i) => { if (!ok) failed.push(CHECKS[i]); });
      result.hiddenPass = bOk + tOk + checks.filter(Boolean).length;
      result.details = { behaviour: `${bOk}/${nBehaviour}`, types: `${tOk}/${typeCases.length}`, checks: `${checks.filter(Boolean).length}/${CHECKS.length}` };
    }
    result.failed = failed;
  } else {
    fail(`unknown scenario ${SCENARIO}`);
  }
  if (args.includes('--judge')) {
    const { judge } = await import('./judge.mjs');
    Object.assign(result, await judge({ scenario: SCENARIO, dir: W, app: opt('--app') }));
  }
} catch (e) {
  rmSync(W, { recursive: true, force: true });
  fail(String(e?.stack || e).slice(0, 500));
}
rmSync(W, { recursive: true, force: true });
result.failedCount = result.failed.length;
result.failed = result.failed.slice(0, 10);
result.notes = notes.join('; ');
result.score = qualityScore(result);
console.log(JSON.stringify(result));
