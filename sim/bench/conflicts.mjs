#!/usr/bin/env node
// Can a System One model (Jev, Clef, Clef-flash) predict, from two changes' intents and
// diffs, whether merging them goes wrong? Ground truth comes from real tools, not labels:
//   text      `git merge-file` on every file both changes touched (exit code = conflicts)
//   semantic  merged cleanly by git, but the project's tests (sim/real/project.mjs check)
//             fail on the result (e.g. one change calls a function the other renamed)
//
//   node sim/bench/conflicts.mjs [--n 60] [--seed 1] [--providers jev,clef-flash]
// One JSON line per (pair, provider) in ~/.local/share/qbsim-bench/runs.jsonl.
// Questions are versioned (merge-v1); probabilities are stored as facts, verdicts stay here.
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { generate, makeOp, randomOp, check, lineDiff, parseFile } from '../real/project.mjs';
import { provider } from '../../../../2026-09/desk/scripts/system-one.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => { if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]); return acc; }, []));
const N = Number(args.n || 60), SEED = Number(args.seed || 1);
const PROVIDERS = String(args.providers || 'jev,clef-flash').split(',');
const DIFF_ONLY = !!args['diff-only']; // hide the intent sentences: the model must read the code
const QV = DIFF_ONLY ? 'merge-v1-diff-only' : 'merge-v1';
const QUESTIONS = {
  text: { type: 'noul', instructions: 'Merging these two changes with git will produce a text conflict: they edit the same or directly adjacent lines of the same file.' },
  semantic: { type: 'noul', instructions: 'Even if git merges these two changes cleanly, the merged code will be broken: one change renames or removes a function that the other change imports or calls by its old name.' },
};
const OUT = join(homedir(), '.local/share/qbsim-bench'); mkdirSync(OUT, { recursive: true });
const TMP = join(OUT, 'tmp'); mkdirSync(TMP, { recursive: true });

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(SEED);
const base = generate({ modules: 12, filesPerModule: 6, rnd });
const get = (files) => (p) => files.get(p) ?? null, paths = (files) => () => files.keys();
const modFiles = [...base.keys()].filter((p) => p.startsWith('src/m'));
const pick = (a) => a[Math.floor(rnd() * a.length)];
// Files with an exported function someone imports: renaming one of those can break a caller.
const importedSlot = () => {
  for (;;) {
    const f = pick(modFiles), slot = pick(['a', 'b', 'c']);
    const name = parseFile(base.get(f)).exports[['a', 'b', 'c'].indexOf(slot)].name;
    if (modFiles.some((g) => g !== f && base.get(g).includes(name))) return { f, slot };
  }
};

// ---- build pairs: a third targeted (rename + call to it), the rest random --------
function pairOf(kind) {
  if (kind === 'targeted') {
    const t = pick(modFiles), slot = pick(['a', 'b', 'c']);
    let caller = pick(modFiles); while (caller === t) caller = pick(modFiles);
    const A = makeOp('rename', { file: t, slot, to: `renamed${Math.floor(rnd() * 1e4)}` });
    const B = makeOp('addCall', { file: caller, slot: pick(['a', 'b', 'c']), target: t, targetSlot: rnd() < 0.6 ? slot : pick(['a', 'b', 'c']) });
    return [A, B];
  }
  if (kind === 'sameFile') {
    const f = pick(modFiles);
    return [makeOp('edit', { file: f, slot: pick(['a', 'b', 'c']), value: 100 + Math.floor(rnd() * 800) }), rnd() < 0.5 ? makeOp('edit', { file: f, slot: pick(['a', 'b', 'c']), value: 100 + Math.floor(rnd() * 800) }) : makeOp('addFunction', { file: f, name: `extra${Math.floor(rnd() * 1e4)}` })];
  }
  const pf = () => pick(modFiles);
  return [randomOp(rnd, pf, get(base)), randomOp(rnd, pf, get(base))];
}

function merge3(ours, baseText, theirs, tag) {
  const [a, o, b] = ['a', 'o', 'b'].map((x) => join(TMP, `${tag}.${x}`));
  writeFileSync(a, ours); writeFileSync(o, baseText); writeFileSync(b, theirs);
  const r = spawnSync('git', ['merge-file', '-p', '--quiet', a, o, b], { encoding: 'utf8' });
  return { conflicts: r.status, text: r.stdout };
}

function label(A, B, tag) {
  const outA = A.apply(get(base), paths(base)), outB = B.apply(get(base), paths(base));
  if (!outA?.size || !outB?.size) return null;
  const merged = new Map(base);
  let textConflict = false;
  for (const p of new Set([...outA.keys(), ...outB.keys()])) {
    if (outA.has(p) && outB.has(p)) {
      const m = merge3(outA.get(p), base.get(p), outB.get(p), `${tag}-${p.replace(/\W/g, '_')}`);
      if (m.conflicts > 0) textConflict = true; else merged.set(p, m.text);
    } else merged.set(p, (outA.get(p) ?? outB.get(p)));
  }
  const semantic = textConflict ? null : check(get(merged), paths(merged)).length > 0;
  const diff = (out) => [...out.entries()].map(([p, t]) => `--- ${p}\n${lineDiff(base.get(p), t, 1).join('\n')}`).join('\n');
  const side = (op, out) => (DIFF_ONLY ? { diff: diff(out) } : { intent: op.text, diff: diff(out) });
  return { textConflict, semantic, state: { changeA: side(A, outA), changeB: side(B, outB) } };
}

const pairs = [];
const kinds = ['targeted', 'sameFile', 'random'];
for (let i = 0; pairs.length < N && i < N * 20; i++) {
  const kind = kinds[pairs.length % 3];
  const [A, B] = pairOf(kind);
  const l = label(A, B, `p${i}`);
  if (l) pairs.push({ id: pairs.length + 1, kind, a: A.text, b: B.text, ...l });
}
const count = (f) => pairs.filter(f).length;
console.log(`${pairs.length} pairs (seed ${SEED}): ${count((p) => p.textConflict)} text conflicts, ${count((p) => p.semantic === true)} clean-but-broken, ${count((p) => p.semantic === false)} clean and fine`);

// ---- ask the models ----------------------------------------------------------------
const results = [];
for (const prov of PROVIDERS) {
  const call = provider(prov);
  for (const p of pairs) {
    let r, err = null;
    try { r = await call(p.state, QUESTIONS, { timeout: 60000 }); } catch (e) { err = String(e).slice(0, 300); }
    const row = {
      ts: new Date().toISOString(), event: 'merge_bench', question_version: QV, provider: prov, model: r?.model ?? null, seed: SEED,
      pair: p.id, kind: p.kind, a: p.a, b: p.b, textConflict: p.textConflict, semantic: p.semantic,
      pText: r?.answers?.text?.noul ?? null, pSemantic: r?.answers?.semantic?.noul ?? null, ms: r?.ms ?? null, usage: r?.usage ?? null, err,
    };
    appendFileSync(join(OUT, 'runs.jsonl'), JSON.stringify(row) + '\n');
    results.push(row);
    process.stderr.write(err ? 'x' : '.');
  }
  process.stderr.write(` ${prov}\n`);
}

// ---- score -------------------------------------------------------------------------
function auc(rows, pk, yk) {
  const pos = rows.filter((r) => r[yk]).map((r) => r[pk]), neg = rows.filter((r) => !r[yk]).map((r) => r[pk]);
  if (!pos.length || !neg.length) return null;
  let s = 0; for (const a of pos) for (const b of neg) s += a > b ? 1 : a === b ? 0.5 : 0;
  return s / (pos.length * neg.length);
}
const brier = (rows, pk, yk) => rows.reduce((s, r) => s + (r[pk] - (r[yk] ? 1 : 0)) ** 2, 0) / rows.length;
function wilson(k, n) { if (!n) return [0, 0]; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; }
const pct = (x) => `${Math.round(x * 100)}%`;
for (const prov of PROVIDERS) {
  const rows = results.filter((r) => r.provider === prov && !r.err);
  const failed = results.filter((r) => r.provider === prov && r.err).length;
  const uniq = new Set(rows.map((r) => `${r.pText}|${r.pSemantic}`));
  console.log(`\n${prov} (${rows[0]?.model ?? '?'}): ${rows.length} answered, ${failed} failed, median ${rows.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(rows.length / 2)] ?? '-'} ms`);
  if (uniq.size <= 1 && rows.length > 1) console.log('  !! every answer identical: suspect the plumbing before the model');
  for (const [q, pk, yk, sel] of [['text conflict', 'pText', 'textConflict', () => true], ['clean but broken', 'pSemantic', 'semantic', (r) => r.semantic !== null]]) {
    const rs = rows.filter(sel);
    const k = rs.filter((r) => (r[pk] >= 0.5) === !!r[yk]).length, [lo, hi] = wilson(k, rs.length);
    const a = auc(rs, pk, yk);
    console.log(`  ${q.padEnd(17)} n=${rs.length} (${rs.filter((r) => r[yk]).length} true)  AUC ${a == null ? '-' : a.toFixed(2)}  Brier ${brier(rs, pk, yk).toFixed(3)}  right at 0.5: ${k}/${rs.length} = ${pct(k / rs.length)} [${pct(lo)}-${pct(hi)}]`);
    // Reliability: when it says p, how often is it true?
    const bins = [[0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 1.01]];
    console.log(`  ${''.padEnd(17)} ${bins.map(([l, h]) => { const b = rs.filter((r) => r[pk] >= l && r[pk] < h); return `p${l.toFixed(1)}-${Math.min(h, 1).toFixed(1)}: ${b.filter((r) => r[yk]).length}/${b.length}`; }).join('  ')}`);
  }
}
