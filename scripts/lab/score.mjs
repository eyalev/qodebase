#!/usr/bin/env node
// Variants lab scorer: how good is what a run built? Runs on the LAPTOP only, after a run,
// on a clone of the run's final main. Hidden acceptance tests are read from the private
// lab-hidden repo ($LAB_HIDDEN_DIR), never from this public repo.
//
//   node scripts/lab/score.mjs --scenario <cafe-family|port-ts|bakery|club|backlog|two-teams> --repo <clone> [--judge] [--app <url>]
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
const HIDDEN_DIR = SCENARIO === 'two-teams' ? 'backlog' : SCENARIO; // two-teams shares backlog's tests
if (!existsSync(join(HIDDEN, HIDDEN_DIR))) fail(`no hidden tests for ${SCENARIO} in ${HIDDEN}`);

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
  } else if (SCENARIO === 'bakery' || SCENARIO === 'club') {
    // black box over HTTP. floor: every file parses; own tests pass AND there are at least
    // 5 of them (greenfield: writing tests is part of the job); build = the server starts
    // and serves its basics (bakery: the first two hidden tests; club: the "core:" tests on
    // the foundations the starter already has). Hidden = the "<scenario>:" tests.
    const js = files(W, '.js').concat(files(W, '.mjs'));
    const bad = js.filter((f) => run('node', ['--check', f], W).code !== 0);
    result.typecheck = bad.length === 0;
    if (bad.length) notes.push(`syntax errors in ${bad.map((f) => relative(W, f)).join(', ')}`);
    const own = run('node', ['--test', '--test-reporter=tap'], W);
    const ownCount = +(own.out.match(/^# tests (\d+)/m) || [])[1] || 0;
    result.ownTests = own.code === 0 && ownCount >= 5;
    result.ownTestCount = ownCount;
    if (own.code === 0 && ownCount < 5) notes.push(`only ${ownCount} own tests`);
    const file = join(HIDDEN, SCENARIO, 'acceptance.test.mjs');
    const t = run('node', ['--test', '--test-reporter=tap', file], W, { LAB_REPO: W });
    const all = tap(t.out, 0), res = all.filter((r) => r.name.startsWith(SCENARIO + ':'));
    const core = all.filter((r) => r.name.startsWith('core:'));
    const started = !/server did not start/.test(t.out) && all.length > 0;
    result.build = started && (SCENARIO === 'club' ? core.length > 0 && core.every((r) => r.ok) : res.slice(0, 2).some((r) => r.ok));
    if (!result.build) notes.push(!started ? 'the server did not start' : SCENARIO === 'club' ? 'the basics do not work: ' + core.filter((r) => !r.ok).map((r) => r.name.slice(6)).join('; ') : 'the server serves no menu');
    const total = (readFileSync(file, 'utf8').match(new RegExp(`^test\\(['"]${SCENARIO}:`, 'gm')) || []).length;
    result.hiddenTotal = total;
    result.hiddenPass = res.filter((r) => r.ok).length;
    result.failed = [...res.filter((r) => !r.ok).map((r) => r.name), ...(res.length < total ? [`${SCENARIO}: ${total - res.length} did not run`] : [])];
  } else if (SCENARIO === 'backlog' || SCENARIO === 'two-teams') {
    // The board scenarios (docs/board/PLAN2.md W4): todokit, 30 tasks, one hidden test each
    // (lab-hidden/backlog, both scenarios). Quality is not what they measure (round 1: every run
    // passed every test); the extra block is the duplicate work: of the five far-worded pairs, how
    // many were BUILT TWICE (both pass, neither module imports the other: qb9's rule) vs aliased.
    const js = files(W, '.js').concat(files(W, '.mjs'));
    const bad = js.filter((f) => run('node', ['--check', f], W).code !== 0);
    result.typecheck = bad.length === 0;
    if (bad.length) notes.push(`syntax errors in ${bad.map((f) => relative(W, f)).join(', ')}`);
    result.ownTests = run('node', ['--test'], W).code === 0;
    const load = run('node', ['--input-type=module', '-e', `await import(${JSON.stringify(join(W, 'src/index.js'))});`], W);
    result.build = load.code === 0;
    if (!result.build) notes.push('src/index.js does not load: ' + (load.out.split('\n').find((l) => /Error/.test(l)) || ''));
    const file = join(HIDDEN, 'backlog/acceptance.test.mjs');
    const t = run('node', ['--test', '--test-reporter=tap', file], W, { LAB_REPO: W });
    const hidden = {};
    for (const m of t.out.matchAll(/^(not ok|ok) \d+ - (T\d+)/gm)) hidden[m[2]] = m[1] === 'ok';
    const total = (readFileSync(file, 'utf8').match(/^test\(['"]T\d+/gm) || []).length;
    result.hiddenTotal = total;
    result.hiddenPass = Object.values(hidden).filter(Boolean).length;
    result.failed = Object.entries(hidden).filter(([, ok]) => !ok).map(([k]) => k).concat(Object.keys(hidden).length < total ? [`${total - Object.keys(hidden).length} did not run`] : []);
    const { pairs } = JSON.parse(readFileSync(join(HIDDEN, 'backlog/pairs.json'), 'utf8'));
    const mod = (m) => { const f = join(W, 'src', m + '.js'); return existsSync(f) ? readFileSync(f, 'utf8') : null; };
    const links = (src, m) => src != null && new RegExp(`from\\s+['"]\\./${m}(\\.js)?['"]`).test(src);
    const rows = pairs.map(([ta, ma, tb, mb]) => {
      const a = mod(ma), b = mod(mb), both = !!(hidden[ta] && hidden[tb]);
      const twice = both && a != null && b != null && !links(a, mb) && !links(b, ma);
      return { pair: `${ta}/${tb}`, modules: `${ma}/${mb}`, [ta]: !!hidden[ta], [tb]: !!hidden[tb], builtTwice: twice, aliased: both && !twice };
    });
    result.duplicates = { pairs: rows.length, builtTwice: rows.filter((r) => r.builtTwice).length, aliased: rows.filter((r) => r.aliased).length,
      rows, rule: 'built twice = both tasks pass and neither module imports the other' };
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
    result.trulyHiddenPass = 0;
    result.trulyHiddenTotal = typeCases.length + CHECKS.length;
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
      // the behaviour tests are validator.js's own, public upstream; the type cases and
      // structure checks exist only in lab-hidden (manager, 2026-10-08): report both
      result.trulyHiddenPass = tOk + checks.filter(Boolean).length;
      result.details = { behaviour: `${bOk}/${nBehaviour}`, types: `${tOk}/${typeCases.length}`, checks: `${checks.filter(Boolean).length}/${CHECKS.length}` };
    }
    result.failed = failed;
  } else {
    fail(`unknown scenario ${SCENARIO}`);
  }
  if (args.includes('--judge') && existsSync(join(HIDDEN, SCENARIO, 'rubric.md'))) {
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
if (result.trulyHiddenTotal) result.scoreTrulyHidden = qualityScore({ ...result, hiddenPass: result.trulyHiddenPass, hiddenTotal: result.trulyHiddenTotal });
console.log(JSON.stringify(result));
