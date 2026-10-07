// A small real project, the scripted operations agents perform on it, and its tests.
//
// No model calls: an operation is an intent ("rename this function", "call that one
// from here") that can be applied to any version of the code. Applied to the version
// an agent started from, it produces the agent's commit; applied again to a newer main,
// it is "redo from intent" (what a lead or a redo does) instead of a text merge.

export const HOT = ['src/routes.ts', 'src/schema.ts', 'package.json'];

const FIELD_WORDS = ['email', 'avatar', 'locale', 'timezone', 'plan', 'role', 'bio', 'phone', 'company', 'title', 'country', 'city',
  'website', 'twitter', 'github', 'theme', 'currency', 'birthday', 'pronouns', 'status', 'score', 'credits', 'referrer', 'source'];
const DEPS = ['hono', 'zod', 'drizzle-orm', 'date-fns', 'nanoid', 'valibot', 'marked', 'jose', 'itty-router', 'p-limit'];
const SLOTS = ['a', 'b', 'c'];

const filePath = (m, f) => `src/m${m}/f${f}.ts`;

// ---- parsing helpers (the generated code is line-based on purpose) ----
const IMPORT_RE = /^import \{ (\w+) \} from '(.+)';$/;
const EXPORT_RE = /^export function (\w+)\(/;
const parseCache = new Map();
export function parseFile(text) {
  const hit = parseCache.get(text);
  if (hit) return hit;
  if (parseCache.size > 50000) parseCache.clear();
  const r = parseFileRaw(text);
  parseCache.set(text, r);
  return r;
}
function parseFileRaw(text) {
  const lines = text.split('\n');
  const imports = [], exports = [];
  lines.forEach((l, i) => {
    let mm = IMPORT_RE.exec(l); if (mm) imports.push({ name: mm[1], from: mm[2], line: i });
    mm = EXPORT_RE.exec(l); if (mm) exports.push({ name: mm[1], line: i });
  });
  return { lines, imports, exports };
}
function resolve(fromPath, rel) {
  const parts = fromPath.split('/'); parts.pop();
  for (const seg of rel.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
  return parts.join('/') + '.ts';
}
function relImport(fromPath, toPath) {
  const a = fromPath.split('/').slice(0, -1), b = toPath.replace(/\.ts$/, '').split('/');
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  const up = a.length - i;
  return (up ? '../'.repeat(up) : './') + b.slice(i).join('/');
}

// The function in a slot ("a" = first export of the file) — slots survive renames.
function slotName(text, slot) {
  const ex = parseFile(text).exports;
  return ex[SLOTS.indexOf(slot)]?.name ?? null;
}

// ---- generator ----
export function generate({ modules = 50, filesPerModule = 8, rnd }) {
  const files = new Map();
  const all = [];
  for (let m = 0; m < modules; m++) for (let f = 0; f < filesPerModule; f++) all.push([m, f]);
  for (const [m, f] of all) {
    const p = filePath(m, f);
    const [om, of] = all[Math.floor(rnd() * all.length)];
    const other = om === m && of === f ? all[(all.indexOf(all.find((x) => x[0] === m && x[1] === f)) + 1) % all.length] : [om, of];
    const otherName = `m${other[0]}f${other[1]}a`;
    const body = [
      `// ${p}`,
      `import { ${otherName} } from '${relImport(p, filePath(other[0], other[1]))}';`,
      '',
      ...SLOTS.flatMap((s, i) => [
        `export function m${m}f${f}${s}(x: number) {`,
        i === 1 ? `  return ${otherName}(x) + ${1 + Math.floor(rnd() * 9)};` : `  return x * ${2 + Math.floor(rnd() * 8)} + ${1 + Math.floor(rnd() * 9)};`,
        '}',
        '',
      ]),
    ];
    files.set(p, body.join('\n'));
  }
  const routeFiles = all.filter(() => rnd() < 0.5);
  files.set('src/routes.ts', [
    '// src/routes.ts',
    ...routeFiles.map(([m, f]) => `import { m${m}f${f}a } from '${relImport('src/routes.ts', filePath(m, f))}';`),
    '',
    'export const routes = [',
    ...routeFiles.map(([m, f]) => `  ['/m${m}/f${f}/a', m${m}f${f}a],`),
    '];',
    '',
  ].join('\n'));
  files.set('src/schema.ts', ['// src/schema.ts', 'export const fields = [', "  'id',", "  'name',", "  'created',", '];', ''].join('\n'));
  files.set('package.json', ['{', '  "name": "simapp",', '  "dependencies": {', ...DEPS.map((d, i) => `    "${d}": "^1.${i}.0"${i < DEPS.length - 1 ? ',' : ''}`), '  }', '}', ''].join('\n'));
  return files;
}

// ---- operations ----
// Each op: { kind, text, apply(get, paths) -> Map(path -> new content) | null (cannot apply here) }.
// `get(path)` reads a version of the code; `paths()` lists its files.

function insertBeforeClose(text, line) {
  const lines = text.split('\n');
  const i = lines.lastIndexOf('];');
  if (i < 0) return null;
  lines.splice(i, 0, line);
  return lines.join('\n');
}
function addImport(text, name, from) {
  const lines = text.split('\n');
  if (lines.includes(`import { ${name} } from '${from}';`)) return text;
  let last = 0; lines.forEach((l, i) => { if (IMPORT_RE.test(l)) last = i; });
  lines.splice(last + 1, 0, `import { ${name} } from '${from}';`);
  return lines.join('\n');
}

export function makeOp(kind, args) {
  const ops = {
    // Change a constant inside one function.
    edit: ({ file, slot, value }) => ({
      text: `Change the constant in ${slot} of ${file} to ${value}`,
      apply(get) {
        const t = get(file); if (t == null) return null;
        const name = slotName(t, slot); if (!name) return null;
        const lines = t.split('\n');
        const at = lines.findIndex((l) => l.startsWith(`export function ${name}(`));
        if (at < 0 || !/\+ \d+\b/.test(lines[at + 1])) return null;
        if (lines[at + 1].includes(`+ ${value}`)) return null;
        lines[at + 1] = lines[at + 1].replace(/\+ \d+\b/, `+ ${value}`);
        return new Map([[file, lines.join('\n')]]);
      },
    }),
    // New exported function, registered as a route (touches the hot routes file).
    addFunction: ({ file, name }) => ({
      text: `Add ${name} to ${file} and route /${name}`,
      apply(get) {
        const t = get(file), r = get('src/routes.ts'); if (t == null || r == null) return null;
        if (parseFile(t).exports.some((e) => e.name === name)) return null;
        const out = new Map();
        out.set(file, t.replace(/\n*$/, '\n') + `\nexport function ${name}(x: number) {\n  return x + 1;\n}\n`);
        let routes = addImport(r, name, relImport('src/routes.ts', file));
        routes = insertBeforeClose(routes, `  ['/${name}', ${name}],`);
        if (!routes) return null;
        out.set('src/routes.ts', routes);
        return out;
      },
    }),
    // Rename a function everywhere it is defined, imported and called.
    rename: ({ file, slot, to }) => ({
      text: `Rename ${slot} of ${file} to ${to}`,
      apply(get, paths) {
        const t = get(file); if (t == null) return null;
        const from = slotName(t, slot); if (!from || from === to) return null;
        const word = new RegExp(`\\b${from}\\b`, 'g');
        const out = new Map([[file, t.replace(word, to)]]);
        for (const p of paths()) {
          if (p === file || p === 'package.json') continue;
          const s = get(p);
          if (s.includes(from) && parseFile(s).imports.some((im) => im.name === from && resolve(p, im.from) === file)) out.set(p, s.replace(word, to));
        }
        return out;
      },
    }),
    // Call a function of another file from this one (adds an import). Targets a slot,
    // so replaying it after that function was renamed still calls the right one.
    addCall: ({ file, slot, target, targetSlot }) => ({
      text: `Make ${slot} of ${file} also call ${targetSlot} of ${target}`,
      apply(get) {
        const t = get(file), tt = get(target); if (t == null || tt == null || file === target) return null;
        const name = slotName(t, slot), callee = slotName(tt, targetSlot); if (!name || !callee) return null;
        let text = addImport(t, callee, relImport(file, target));
        const lines = text.split('\n');
        const at = lines.findIndex((l) => l.startsWith(`export function ${name}(`));
        if (at < 0) return null;
        lines[at + 1] = lines[at + 1].replace(/;$/, ` + ${callee}(1);`);
        return new Map([[file, lines.join('\n')]]);
      },
    }),
    addField: ({ field }) => ({
      text: `Add the ${field} field to the schema`,
      apply(get) {
        const s = get('src/schema.ts'); if (s == null) return null;
        if (s.includes(`'${field}'`)) return null;
        const out = insertBeforeClose(s, `  '${field}',`);
        return out ? new Map([['src/schema.ts', out]]) : null;
      },
    }),
    bumpDep: ({ dep, version }) => ({
      text: `Bump ${dep} to ${version}`,
      apply(get) {
        const s = get('package.json'); if (s == null) return null;
        const re = new RegExp(`"${dep}": "[^"]+"`);
        if (!re.test(s)) return null;
        return new Map([['package.json', s.replace(re, `"${dep}": "${version}"`)]]);
      },
    }),
  };
  return { kind, args, ...ops[kind](args) };
}

let nameSeq = 0;
// Pick an operation against the current main. `pickFile()` returns a module file (Zipf-busy).
export function randomOp(rnd, pickFile, get) {
  const u = rnd();
  const slot = SLOTS[Math.floor(rnd() * 3)];
  const file = pickFile();
  if (u < 0.40) return makeOp('edit', { file, slot, value: 10 + Math.floor(rnd() * 990) });
  if (u < 0.60) {
    let target = pickFile(); if (target === file) target = pickFile();
    return makeOp('addCall', { file, slot, target, targetSlot: SLOTS[Math.floor(rnd() * 3)] });
  }
  if (u < 0.75) return makeOp('addFunction', { file, name: `${file.slice(4, -3).replace('/', '')}n${++nameSeq}` });
  if (u < 0.83) {
    const cur = slotName(get(file) || '', slot) || 'fn';
    return makeOp('rename', { file, slot, to: `${cur.replace(/V\d+$/, '')}V${++nameSeq}` });
  }
  // Mostly new fields; sometimes two agents want the same one (a real duplicate).
  if (u < 0.93) return makeOp('addField', { field: `${FIELD_WORDS[Math.floor(rnd() * FIELD_WORDS.length)]}${rnd() < 0.1 ? '' : ++nameSeq}` });
  return makeOp('bumpDep', { dep: DEPS[Math.floor(rnd() * DEPS.length)], version: `^${1 + Math.floor(rnd() * 3)}.${Math.floor(rnd() * 20)}.${Math.floor(rnd() * 10)}` });
}

// ---- the project's tests ----
// Returns [] when green, else a list of failures. Catches what git cannot see:
// a merge that is textually clean but calls a function another change renamed.
export function check(get, paths) {
  const fails = [];
  const exportsOf = new Map();
  const ps = [...paths()];
  for (const p of ps) {
    const t = get(p);
    if (t.includes('<<<<<<<') || t.includes('>>>>>>>')) fails.push(`${p}: conflict markers`);
    if (p.endsWith('.ts')) exportsOf.set(p, new Set(parseFile(t).exports.map((e) => e.name)));
  }
  for (const p of ps) {
    if (!p.endsWith('.ts')) continue;
    const { imports, exports } = parseFile(get(p));
    const seen = new Set();
    for (const e of exports) { if (seen.has(e.name)) fails.push(`${p}: ${e.name} defined twice`); seen.add(e.name); }
    for (const im of imports) {
      const target = resolve(p, im.from);
      if (!exportsOf.has(target)) fails.push(`${p}: imports from missing ${target}`);
      else if (!exportsOf.get(target).has(im.name)) fails.push(`${p}: ${im.name} is not exported by ${target}`);
    }
  }
  const routes = get('src/routes.ts') || '';
  const pathsSeen = new Set();
  for (const mm of routes.matchAll(/\['(\/[^']+)', (\w+)\]/g)) {
    if (pathsSeen.has(mm[1])) fails.push(`src/routes.ts: route ${mm[1]} twice`);
    pathsSeen.add(mm[1]);
  }
  const fields = [...(get('src/schema.ts') || '').matchAll(/'(\w+)'/g)].map((x) => x[1]);
  if (new Set(fields).size !== fields.length) fails.push('src/schema.ts: a field twice');
  try { JSON.parse(get('package.json')); } catch { fails.push('package.json: not valid JSON'); }
  return fails;
}

// Unified-ish line diff for the UI (files here are short; LCS is fine).
export function lineDiff(a, b, context = 2) {
  const A = (a ?? '').split('\n'), B = (b ?? '').split('\n');
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { ops.push([' ', A[i], i + 1]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { ops.push(['-', A[i], i + 1]); i++; }
    else { ops.push(['+', B[j], j + 1]); j++; }
  }
  while (i < n) { ops.push(['-', A[i], i + 1]); i++; }
  while (j < m) { ops.push(['+', B[j], j + 1]); j++; }
  // Keep changed lines and `context` lines around them; '…' marks a gap.
  const keep = new Uint8Array(ops.length);
  ops.forEach((o, k) => { if (o[0] !== ' ') for (let d = -context; d <= context; d++) if (ops[k + d]) keep[k + d] = 1; });
  const out = []; let gap = false;
  ops.forEach((o, k) => { if (keep[k]) { out.push(o[0] + o[1]); gap = false; } else if (!gap) { out.push('…'); gap = true; } });
  return out;
}
