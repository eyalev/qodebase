#!/usr/bin/env node
// Variants lab (docs/lab/PLAN.md): build each scenario's starter repo (public, in
// scripts/lab/scenarios/<id>/starter/) and its hidden acceptance tests (PRIVATE, in
// $LAB_HIDDEN_DIR/<id>/, never in this public repo, never in a box).
//
//   node --experimental-strip-types scripts/lab/make-starters.mjs [--validator <clone>]
//
// cafe-family: the Corner Café as the judges know it: the demo's seed with all 14 of its
//   tasks applied (src/landing/demoproject.ts). Hidden tests are hand-written in lab-hidden.
// port-ts: 54 modules of validator.js 13.12.0 (MIT, validatorjs/validator.js, 23.7k stars,
//   plain JS with typings only on DefinitelyTyped, so there is no official TypeScript
//   version to copy), the set closed under its own imports, 1,423 lines. Its own tests are
//   split: the first test block that covers a function is visible, the rest are hidden.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED, TASKS, applyEdits } from '../../src/landing/demoproject.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const VALIDATOR = opt('--validator', join(homedir(), 'projects/github/validatorjs/validator.js'));
const HIDDEN = opt('--hidden', join(homedir(), '<lab-hidden dir>'));

function writeTree(dir, files) {
  rmSync(dir, { recursive: true, force: true });
  for (const [p, t] of files) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), t); }
}

// ---------- cafe-family ----------
{
  const files = new Map(Object.entries(SEED));
  for (const t of TASKS) { applyEdits(files, t.edits); if (t.fix) applyEdits(files, t.fix); }
  const dir = join(HERE, 'scenarios/cafe-family/starter');
  writeTree(dir, files);
  execFileSync('node', ['--test'], { cwd: dir, stdio: 'pipe' }); // the starter's own tests pass
  console.log(`cafe-family: ${files.size} files, own tests pass`);
}

// ---------- port-ts ----------
{
  const tag = execFileSync('git', ['-C', VALIDATOR, 'describe', '--tags', '--exact-match'], { encoding: 'utf8' }).trim();
  if (tag !== '13.12.0') throw new Error(`validator.js clone must be at 13.12.0, is ${tag}`);
  const MODULES = ['util/assertString', 'util/merge', 'util/toString', 'util/includes', 'util/multilineRegex', 'alpha',
    'isEmail', 'isFQDN', 'isIP', 'isURL', 'isByteLength', 'isIPRange', 'isMACAddress', 'isPort', 'isInt', 'isLength',
    'isHexadecimal', 'isBase64', 'isJWT', 'isUUID', 'isSlug', 'isEmpty', 'contains', 'equals', 'escape', 'unescape',
    'trim', 'ltrim', 'rtrim', 'toInt', 'toFloat', 'toBoolean', 'blacklist', 'whitelist', 'stripLow', 'isAscii',
    'isLowercase', 'isUppercase', 'isIn', 'isDataURI', 'isMimeType', 'isSemVer', 'isHash', 'isMD5', 'isAlpha',
    'isAlphanumeric', 'isNumeric', 'isDecimal', 'isFloat', 'isBoolean', 'isJSON', 'isHexColor', 'isLatLong', 'isMagnetURI'];
  const FUNCS = MODULES.filter((m) => !m.includes('/') && m !== 'alpha');
  const files = new Map();
  let lines = 0;
  for (const m of MODULES) {
    let src = readFileSync(join(VALIDATOR, 'src/lib', m + '.js'), 'utf8');
    for (const [, dep] of src.matchAll(/from '(\.[^']+)'/g)) {
      const target = join(dirname(m), dep).replace(/^\.\//, '');
      if (!MODULES.includes(target)) throw new Error(`${m} imports ${target}, outside the subset`);
    }
    src = src.replace(/from '(\.[^']+)'/g, "from '$1.js'"); // Node ESM needs extensions
    files.set(`src/lib/${m}.js`, src);
    lines += src.split('\n').length - 1;
  }
  // alpha exports named tables; isAlpha/isAlphanumeric re-export their locales, as upstream
  files.set('src/index.js', `// validator.js 13.12.0, a subset of ${FUNCS.length} functions (see README.md).
${FUNCS.map((f) => `import ${f} from './lib/${f}.js';`).join('\n')}

export const version = '13.12.0';
export { ${FUNCS.join(', ')} };

const validator = { version, ${FUNCS.join(', ')} };
export default validator;
`);
  lines += files.get('src/index.js').split('\n').length - 1;

  // tests: split upstream's mocha files into it-blocks; keep blocks that only use the subset
  const blocksOf = (text) => {
    const body = text.slice(text.indexOf('\n', text.indexOf('describe(')) + 1, text.lastIndexOf('});'));
    const out = []; let cur = null;
    for (const line of body.split('\n')) {
      if (/^  it\(/.test(line)) { if (cur) out.push(cur); cur = [line]; } else if (cur) cur.push(line);
    }
    if (cur) out.push(cur);
    return out.map((b) => b.join('\n').trimEnd());
  };
  const uses = (block) => {
    const names = new Set();
    for (const [, n] of block.matchAll(/(?:validator|sanitizer): '(\w+)'/g)) names.add(n);
    for (const [, n] of block.matchAll(/validator\.(\w+)\(/g)) names.add(n);
    return names;
  };
  const visible = [], hidden = [], seen = new Set();
  let dropped = 0;
  for (const [file, kind] of [['test/validators.test.js', 'validators'], ['test/sanitizers.test.js', 'sanitizers']]) {
    for (const block of blocksOf(readFileSync(join(VALIDATOR, file), 'utf8'))) {
      const names = uses(block);
      const ok = names.size && [...names].every((n) => FUNCS.includes(n)) && !/validator_js|timezone_mock|vm\.|fs\./.test(block);
      if (!ok) { dropped++; continue; }
      const isNew = [...names].some((n) => !seen.has(n));
      names.forEach((n) => seen.add(n));
      (isNew ? visible : hidden).push({ kind, block });
    }
  }
  const fqdn = readFileSync(join(VALIDATOR, 'test/validators/isFQDN.test.js'), 'utf8');
  hidden.push({ kind: 'validators', block: blocksOf(fqdn).join('\n\n') });
  const missing = FUNCS.filter((f) => !seen.has(f));

  // the test helpers load the library whether it is still JavaScript or already TypeScript
  const loader = `// Loads the library from src/index.ts once it is ported, src/index.js before.
import { existsSync } from 'node:fs';
const ts = new URL('../src/index.ts', import.meta.url);
const lib = await import(existsSync(ts) ? ts : new URL('../src/index.js', import.meta.url));
export default lib.default;
`;
  const helpers = readFileSync(join(VALIDATOR, 'test/testFunctions.js'), 'utf8')
    .replace("import assert from 'assert';", "import assert from 'node:assert';")
    .replace("import { format } from 'util';", "import { format } from 'node:util';")
    .replace("import validator from '../src/index';", "import validator from './lib.js';");
  const sanitizeHelper = readFileSync(join(VALIDATOR, 'test/sanitizers.test.js'), 'utf8');
  const sanitizeFn = sanitizeHelper.slice(sanitizeHelper.indexOf('function test('), sanitizeHelper.indexOf("describe('Sanitizers'"))
    .replace('function test(', 'export function sanitize(');
  const header = (kind) => `import assert from 'node:assert';
import { describe, it } from 'node:test';
import validator from './lib.js';
import test from './testFunctions.js';
import { sanitize } from './sanitize.js';
`;
  const fileOf = (list, title) => header() + `\ndescribe('${title}', () => {\n` +
    list.map(({ kind, block }) => kind === 'sanitizers' ? block.replace(/\btest\(\{/g, 'sanitize({') : block).join('\n\n') + '\n});\n';
  const testFiles = [
    ['test/lib.js', loader],
    ['test/testFunctions.js', helpers],
    ['test/sanitize.js', "import { format } from 'node:util';\nimport validator from './lib.js';\n\n" + sanitizeFn.trimEnd() + '\n'],
  ];
  for (const [p, t] of testFiles) files.set(p, t);
  files.set('test/validators.test.js', fileOf(visible, 'validator.js'));
  files.set('package.json', JSON.stringify({ name: 'validator-subset', version: '13.12.0', private: true, type: 'module',
    license: 'MIT', scripts: { test: 'node --test', typecheck: 'tsc --noEmit' }, devDependencies: { typescript: '5.6.3' } }, null, 2) + '\n');
  files.set('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
    strict: true, noEmit: true, allowImportingTsExtensions: true, skipLibCheck: true }, include: ['src'] }, null, 2) + '\n');
  files.set('LICENSE', readFileSync(join(VALIDATOR, 'LICENSE'), 'utf8'));
  files.set('README.md', `# validator (subset)

${FUNCS.length} string validators and sanitizers from [validator.js](https://github.com/validatorjs/validator.js)
13.12.0 (MIT, see LICENSE): \`src/lib/\` holds one module per function, \`src/index.js\` exports them.

Tests: \`node --test\` (Node 22). Type check: \`npx tsc --noEmit\` (\`tsconfig.json\`, strict).
`);
  files.set('.gitignore', 'node_modules/\n');
  const dir = join(HERE, 'scenarios/port-ts/starter');
  writeTree(dir, files);
  execFileSync('node', ['--test'], { cwd: dir, stdio: 'pipe' });

  // hidden: the remaining upstream blocks, run by the scorer against the ported library
  const hdir = join(HIDDEN, 'port-ts');
  mkdirSync(hdir, { recursive: true });
  writeFileSync(join(hdir, 'behaviour.test.js'), fileOf(hidden, 'validator.js (hidden)'));
  console.log(`port-ts: ${FUNCS.length} functions, ${lines} lines; tests: ${visible.length} visible blocks, ${hidden.length} hidden (${dropped} dropped: outside the subset)${missing.length ? '; NO TEST for ' + missing.join(', ') : ''}`);
}
