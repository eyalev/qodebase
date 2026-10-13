#!/usr/bin/env node
// F4 quality check for the Workers AI comment fleet (docs/board/TASKS.md "Fleet on Workers AI").
// Reads the fleet's repo straight from git (base = before the fleet, head = what landed), so it does not depend on
// the fleet's own records:
//   1. every changed file: re-verify "code unchanged" (TypeScript AST printed without comments, base vs head), list
//      the doc comments added or changed, and run mechanical checks on each (an @param naming no parameter = a
//      hallucinated parameter, parameters left out, @returns on a void function / constructor, one-word comments);
//   2. a seeded random sample, spread over folders in proportion: the first --n files for the hand check (hand.md +
//      hand.jsonl to fill in), the first --judge-n for the judge (the hand files are inside it, to calibrate the judge);
//   3. --records <jsonl>: tallies of the fleet's own outcome fields (verify-fail, rejected, landed ...);
//   4. --judge: asks a cheap model through AI Gateway (qodebase-fleet) to grade each sampled comment; capped by --max-usd,
//      one ledger line per call. Without --judge nothing calls a model.
//
//   node scripts/fleet/quality-sample.mjs --repo <clone> --base <sha> [--head HEAD] [--path src/vs] [--n 50]
//        [--judge-n 300] [--seed 7] [--out <dir>] [--records <fleet jsonl>]
//        [--judge --model @cf/... --price-in <$/M> --price-out <$/M> --max-usd 2]
// Output dir (default ~/.local/share/qodebase-fleet/quality/<head8>): auto.jsonl, summary.json, sample.json,
// hand.md, hand.jsonl, judge-items.jsonl, judge.jsonl, judge-ledger.jsonl. Log: <out>/run.jsonl.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(`--${k}`);
const REPO = opt('repo'); const BASE = opt('base'); const HEAD = opt('head', 'HEAD');
if (!REPO || !BASE) { console.error('need --repo <clone> --base <sha> (see the header)'); process.exit(2); }
const PATH = opt('path', 'src/vs'); const N = +opt('n', 50); const JN = Math.max(N, +opt('judge-n', 300)); const SEED = +opt('seed', 7);
const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 1 << 30 });
const headSha = git('rev-parse', HEAD).trim(); const baseSha = git('rev-parse', BASE).trim();
const OUT = opt('out', path.join(os.homedir(), '.local/share/qodebase-fleet/quality', headSha.slice(0, 8)));
fs.mkdirSync(OUT, { recursive: true });
const log = (event, o = {}) => fs.appendFileSync(path.join(OUT, 'run.jsonl'), JSON.stringify({ ts: new Date().toISOString(), event, ...o }) + '\n');
const jsonl = (f, rows) => fs.writeFileSync(path.join(OUT, f), rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
log('start', { repo: REPO, base: baseSha, head: headSha, path: PATH, n: N, judgeN: JN, seed: SEED });

// ---- 1. changed files ------------------------------------------------------------------------------------------
const status = git('diff', '--name-status', '--no-renames', baseSha, headSha, '--', PATH).split('\n').filter(Boolean).map((l) => l.split('\t'));
const notModified = status.filter(([s]) => s !== 'M').map(([s, f]) => ({ status: s, file: f }));   // the fleet should only modify
const files = status.filter(([s, f]) => s === 'M' && /\.(m?ts|tsx)$/.test(f) && !f.endsWith('.d.ts')).map(([, f]) => f);
const show = (sha, f) => git('show', `${sha}:${f}`);
const folderOf = (f) => f.slice(PATH.length + 1).split('/').slice(0, 2).join('/');   // e.g. workbench/contrib = one lane-sized stratum
const kindOf = (f) => (f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const parse = (f, text) => ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, kindOf(f));
const printer = ts.createPrinter({ removeComments: true });

function declName(n) {
  if (ts.isConstructorDeclaration(n)) return 'constructor';
  if (n.name && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name) || ts.isPrivateIdentifier(n.name))) return n.name.text;
  if (ts.isVariableStatement(n)) return n.declarationList.declarations.map((d) => d.name.getText()).join(',');
  return null;
}
const fnOf = (n) => (ts.isFunctionLike(n) ? n : ts.isVariableStatement(n) ? (() => { const i = n.declarationList.declarations[0]?.initializer; return i && (ts.isArrowFunction(i) || ts.isFunctionExpression(i)) ? i : null; })() : null);
// Every declaration that carries (or could carry) a JSDoc, keyed by its path (Class.method#k for overloads).
function docMap(sf) {
  const map = new Map();
  const walk = (n, scope) => {
    const name = declName(n); let key = null;
    if (name && (ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)
      || ts.isEnumDeclaration(n) || ts.isMethodDeclaration(n) || ts.isMethodSignature(n) || ts.isPropertyDeclaration(n) || ts.isPropertySignature(n)
      || ts.isConstructorDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n) || ts.isVariableStatement(n) || ts.isEnumMember(n) || ts.isModuleDeclaration(n))) {
      key = scope ? `${scope}.${name}` : name; let k = key, i = 1; while (map.has(k)) k = `${key}#${++i}`;
      const docs = (n.jsDoc || []).map((d) => d.getText());
      const fn = fnOf(n);
      map.set(k, { key: k, kind: ts.SyntaxKind[n.kind], line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, doc: docs.join('\n'), node: n, fn,
        params: fn ? fn.parameters.map((p) => p.name.getText().replace(/^\.\.\./, '')) : null,
        returnsVoid: fn ? (ts.isConstructorDeclaration(fn) || ts.isSetAccessor(fn) || (fn.type && /^(void|Promise<void>)$/.test(fn.type.getText()))) : false,
        exported: !!(ts.getCombinedModifierFlags(n) & ts.ModifierFlags.Export) || /^[A-Z]/.test(scope || '') });
    }
    const sub = ts.isClassDeclaration(n) || ts.isInterfaceDeclaration(n) || ts.isModuleDeclaration(n) || ts.isEnumDeclaration(n) ? (key || scope) : scope;
    if (!ts.isFunctionLike(n) || ts.isClassDeclaration(n)) ts.forEachChild(n, (c) => walk(c, sub));
  };
  walk(sf, '');
  return map;
}
const tagsOf = (d) => [...d.matchAll(/@(\w+)(?:\s+\{[^}]*\})?\s+(\[?[\w$.]+\]?)?/g)].map((m) => ({ tag: m[1], name: (m[2] || '').replace(/^\[|\]$/g, '').split('=')[0] }));
function checks(e) {
  const tags = tagsOf(e.doc); const issues = [];
  const pTags = tags.filter((t) => t.tag === 'param').map((t) => t.name.split('.')[0]);
  if (e.params) {
    const unknown = pTags.filter((p) => !e.params.includes(p)); if (unknown.length) issues.push({ kind: 'unknown_param', names: unknown });   // a parameter that does not exist
    const missing = e.params.filter((p) => !pTags.includes(p) && !/^[{[]/.test(p)); if (pTags.length && missing.length) issues.push({ kind: 'missing_param', names: missing });
    if (e.returnsVoid && tags.some((t) => /^returns?$/.test(t.tag))) issues.push({ kind: 'returns_on_void' });
  } else if (pTags.length) issues.push({ kind: 'param_on_non_function', names: pTags });
  const words = e.doc.replace(/^\/\*\*|\*\/$/g, '').replace(/^\s*\*/gm, '').replace(/@\w+/g, '').trim().split(/\s+/).filter(Boolean);
  if (words.length < 3) issues.push({ kind: 'trivial', words: words.length });
  const nameWords = e.key.split(/[.#]/).at(-1).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  if (words.length && words.join(' ').toLowerCase().replace(/[^a-z ]/g, '').trim() === nameWords) issues.push({ kind: 'restates_name' });
  return issues;
}

const auto = []; let n = 0;
for (const f of files) {
  const row = { file: f, folder: folderOf(f) };
  try {
    const a = parse(f, show(baseSha, f)), b = parse(f, show(headSha, f));
    row.unchanged = printer.printFile(a) === printer.printFile(b);
    row.parse_errors = b.parseDiagnostics?.length || 0;
    const ma = docMap(a), mb = docMap(b);
    row.docs = [...mb.values()].filter((e) => e.doc && e.doc !== (ma.get(e.key)?.doc || '')).map((e) => ({ key: e.key, kind: e.kind, line: e.line, exported: e.exported, changed: !!ma.get(e.key)?.doc, doc: e.doc, issues: checks(e) }));
    row.decls = mb.size; row.undocumented_after = [...mb.values()].filter((e) => !e.doc).length;
  } catch (e) { row.error = String(e.message || e).slice(0, 300); log('file_error', { file: f, error: row.error, stack: e.stack?.split('\n').slice(0, 4).join(' | ') }); }
  auto.push(row);
  if (++n % 500 === 0) log('progress', { done: n, of: files.length });
}
jsonl('auto.jsonl', auto);

// ---- 2. seeded sample, proportional per folder ---------------------------------------------------------------------
const rng = ((s) => () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; })(SEED);
const eligible = auto.filter((r) => r.docs?.length);
const byFolder = new Map(); for (const r of eligible) (byFolder.get(r.folder) || byFolder.set(r.folder, []).get(r.folder)).push(r);
for (const list of byFolder.values()) for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
// Interleave folders by their share (largest remainder each round), so any prefix of the order is spread like the whole.
const order = []; const taken = new Map([...byFolder.keys()].map((k) => [k, 0]));
while (order.length < eligible.length) {
  let best = null, bestGap = -Infinity;
  for (const [k, list] of byFolder) { if (taken.get(k) >= list.length) continue; const gap = (list.length / eligible.length) * (order.length + 1) - taken.get(k) + rng() * 1e-6; if (gap > bestGap) { bestGap = gap; best = k; } }
  order.push(byFolder.get(best)[taken.get(best)]); taken.set(best, taken.get(best) + 1);
}
const hand = order.slice(0, N), judge = order.slice(0, JN);
fs.writeFileSync(path.join(OUT, 'sample.json'), JSON.stringify({ seed: SEED, base: baseSha, head: headSha, hand: hand.map((r) => r.file), judge: judge.map((r) => r.file) }, null, 1));

// Code shown with each comment: the declaration's own text (bodies cut at 40 lines).
function codeFor(f, key) {
  const sf = parse(f, show(headSha, f)); const e = docMap(sf).get(key); if (!e) return '';
  const text = e.node.getText(sf).split('\n'); return text.slice(0, 40).join('\n') + (text.length > 40 ? `\n… (${text.length - 40} more lines)` : '');
}
const items = []; for (const r of judge) for (const d of r.docs) items.push({ file: r.file, folder: r.folder, key: d.key, line: d.line, comment: d.doc, code: codeFor(r.file, d.key), auto_issues: d.issues.map((i) => i.kind), hand: hand.includes(r) });
jsonl('judge-items.jsonl', items);
const handItems = items.filter((i) => i.hand);
jsonl('hand.jsonl', handItems.map((i) => ({ file: i.file, key: i.key, correct: null, useful: null, hallucinates: null, note: '' })));
fs.writeFileSync(path.join(OUT, 'hand.md'), [`# Hand check: ${hand.length} files, ${handItems.length} comments (seed ${SEED}, ${baseSha.slice(0, 8)}..${headSha.slice(0, 8)})`, '',
  'For each comment: correct (says what the code does) / useful (more than the name says) / hallucinates (parameters, behaviour or callers that are not there). Record verdicts in hand.jsonl.', '',
  ...handItems.flatMap((i) => [`## ${i.file}:${i.line} \`${i.key}\`${i.auto_issues.length ? `  (auto: ${i.auto_issues.join(', ')})` : ''}`, '', '```ts', i.comment, i.code, '```', ''])].join('\n'));

// ---- 3. the fleet's own records ---------------------------------------------------------------------------------------
let records = null;
if (opt('records')) {
  const rows = fs.readFileSync(opt('records'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  records = { rows: rows.length, by_field: {} };
  for (const k of ['status', 'outcome', 'state', 'verdict', 'result', 'stage', 'event', 'reason', 'error']) {
    const c = {}; for (const r of rows) if (r[k] != null) { const v = String(typeof r[k] === 'object' ? JSON.stringify(r[k]) : r[k]).slice(0, 60); c[v] = (c[v] || 0) + 1; }
    if (Object.keys(c).length) records.by_field[k] = Object.fromEntries(Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 25));
  }
}

// ---- summary ----------------------------------------------------------------------------------------------------------
const allDocs = auto.flatMap((r) => r.docs || []); const count = (k) => allDocs.filter((d) => d.issues.some((i) => i.kind === k)).length;
const summary = { base: baseSha, head: headSha, path: PATH, files_changed: files.length, not_modified_changes: notModified.slice(0, 50), not_modified_n: notModified.length,
  code_changed: auto.filter((r) => r.unchanged === false).map((r) => r.file), code_changed_n: auto.filter((r) => r.unchanged === false).length,
  parse_errors_n: auto.filter((r) => r.parse_errors).length, file_errors_n: auto.filter((r) => r.error).length, files_with_docs: eligible.length,
  docs_added: allDocs.filter((d) => !d.changed).length, docs_changed: allDocs.filter((d) => d.changed).length,
  issues: { unknown_param: count('unknown_param'), missing_param: count('missing_param'), returns_on_void: count('returns_on_void'), param_on_non_function: count('param_on_non_function'), trivial: count('trivial'), restates_name: count('restates_name') },
  folders: Object.fromEntries([...byFolder].map(([k, v]) => [k, v.length]).sort((a, b) => b[1] - a[1])),
  hand: { files: hand.length, comments: handItems.length }, judge: { files: judge.length, comments: items.length }, records };
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
log('summary', { files: files.length, code_changed: summary.code_changed_n, docs: allDocs.length, issues: summary.issues });
console.log(JSON.stringify({ out: OUT, ...summary, code_changed: summary.code_changed.slice(0, 10), folders: undefined, not_modified_changes: summary.not_modified_changes.slice(0, 5) }, null, 1));

// ---- 4. judge (only with --judge) ---------------------------------------------------------------------------------------
if (flag('judge')) {
  const MODEL = opt('model'); const PIN = +opt('price-in', NaN), POUT = +opt('price-out', NaN); const MAX = +opt('max-usd', 2);
  if (!MODEL || !(PIN >= 0) || !(POUT >= 0)) { console.error('--judge needs --model, --price-in and --price-out ($ per 1M tokens)'); process.exit(2); }
  const ACCOUNT = opt('account', process.env.CF_ACCOUNT_ID); const TOKEN = process.env.FLEET_AI_TOKEN;   // a token for the forq account's Workers AI; never printed
  if (!ACCOUNT || !TOKEN) { console.error('--judge needs --account (or CF_ACCOUNT_ID) and FLEET_AI_TOKEN in the environment'); process.exit(2); }
  const url = `https://gateway.ai.cloudflare.com/v1/${ACCOUNT}/qodebase-fleet/workers-ai/${MODEL}`;
  const done = new Set(fs.existsSync(path.join(OUT, 'judge.jsonl')) ? fs.readFileSync(path.join(OUT, 'judge.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { const j = JSON.parse(l); return `${j.file}|${j.key}`; }) : []);
  let spent = fs.existsSync(path.join(OUT, 'judge-ledger.jsonl')) ? fs.readFileSync(path.join(OUT, 'judge-ledger.jsonl'), 'utf8').split('\n').filter(Boolean).reduce((s, l) => s + (JSON.parse(l).usd || 0), 0) : 0;
  const sys = 'You review documentation comments added to TypeScript code. Answer with one JSON object only: {"correct": true|false, "useful": true|false, "hallucinates": true|false, "why": "<one short sentence>"}. correct = the comment matches what the code does. useful = it says more than the name. hallucinates = it mentions parameters, return values, behaviour or callers that are not in the code.';
  for (const it of items) {
    if (done.has(`${it.file}|${it.key}`)) continue;
    if (spent >= MAX) { log('judge_budget_stop', { spent, max: MAX }); console.error(`judge stopped at the budget: $${spent.toFixed(4)} of $${MAX}`); break; }
    const t0 = Date.now(); let res, body;
    try {
      res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', 'cf-aig-metadata': JSON.stringify({ run: 'f4-quality', head: headSha.slice(0, 8) }) },
        body: JSON.stringify({ messages: [{ role: 'system', content: sys }, { role: 'user', content: `Comment:\n${it.comment}\n\nCode it documents:\n${it.code}` }], max_tokens: 200 }) });
      body = await res.json();
    } catch (e) { log('judge_error', { file: it.file, key: it.key, error: String(e), stack: e.stack?.split('\n').slice(0, 3).join(' | ') }); continue; }
    const u = body?.result?.usage || {}; const usd = ((u.prompt_tokens || 0) * PIN + (u.completion_tokens || 0) * POUT) / 1e6; spent += usd;
    fs.appendFileSync(path.join(OUT, 'judge-ledger.jsonl'), JSON.stringify({ ts: new Date().toISOString(), model: MODEL, status: res.status, ms: Date.now() - t0, in: u.prompt_tokens ?? null, out: u.completion_tokens ?? null, usd: u.prompt_tokens == null ? null : +usd.toFixed(6) }) + '\n');
    if (!res.ok) { log('judge_http', { status: res.status, file: it.file, body: JSON.stringify(body).slice(0, 300) }); if (res.status === 429) break; continue; }
    const text = typeof body.result?.response === 'string' ? body.result.response : JSON.stringify(body.result?.response ?? body.result);
    let v = null; try { v = JSON.parse(text.match(/\{[\s\S]*\}/)[0]); } catch {}
    fs.appendFileSync(path.join(OUT, 'judge.jsonl'), JSON.stringify({ file: it.file, key: it.key, hand: it.hand, auto_issues: it.auto_issues, verdict: v, raw: v ? undefined : text.slice(0, 300) }) + '\n');
  }
  log('judge_done', { spent });
  console.error(`judge: $${spent.toFixed(4)} spent; verdicts in ${path.join(OUT, 'judge.jsonl')}`);
}

// ---- 5. --publish <path>: the tally for results.json (qb4's scripts/results/build.mjs reads sim/fleet/quality.json) ----
if (opt('publish')) {
  const read = (f) => (fs.existsSync(path.join(OUT, f)) ? fs.readFileSync(path.join(OUT, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const judged = read('judge.jsonl'), ledger = read('judge-ledger.jsonl'), handRows = read('hand.jsonl').filter((h) => h.correct != null);
  const recs = records?.by_field?.status || records?.by_field?.outcome || {};
  const pick = (re) => Object.entries(recs).filter(([k]) => re.test(k)).reduce((s, [, v]) => s + v, 0);
  const models = [...new Set(ledger.map((l) => l.model))];
  const worst = handRows.filter((h) => h.correct === false || h.hallucinates === true).slice(0, 5).map((h) => ({ file: h.file, key: h.key, comment: items.find((i) => i.file === h.file && i.key === h.key)?.comment, why: h.note }));
  const q = { status: handRows.length && judged.length ? 'done' : 'partial', base: baseSha, head: headSha, checked_at: new Date().toISOString(), files_changed: files.length, code_changed: summary.code_changed_n,
    fleet_records: { landed: pick(/^landed|^merged|^pushed/), verify_fail: pick(/verify/), rejected: pick(/reject/), other: Object.fromEntries(Object.entries(recs).filter(([k]) => !/^landed|^merged|^pushed|verify|reject/.test(k))) },
    auto: { comments: allDocs.length, invented_params: summary.issues.unknown_param, missing_params: summary.issues.missing_param, returns_on_void: summary.issues.returns_on_void, trivial: summary.issues.trivial + summary.issues.restates_name },
    judge: (models.length ? models : [opt('model') || null]).map((m) => ({ model: m, n: judged.length, accurate: judged.filter((j) => j.verdict?.correct === true).length, helpful: judged.filter((j) => j.verdict?.useful === true).length,
      invented: judged.filter((j) => j.verdict?.hallucinates === true).length, unparsed: judged.filter((j) => !j.verdict).length, usd: +ledger.filter((l) => l.model === m).reduce((s, l) => s + (l.usd || 0), 0).toFixed(4) })),
    hand: { files: new Set(handRows.map((h) => h.file)).size, comments: handRows.length, ok: handRows.filter((h) => h.correct && !h.hallucinates).length, accurate: handRows.filter((h) => h.correct).length, helpful: handRows.filter((h) => h.useful).length, invented: handRows.filter((h) => h.hallucinates).length },
    worst };
  fs.writeFileSync(opt('publish'), JSON.stringify(q, null, 1) + '\n'); log('published', { to: opt('publish'), status: q.status });
  console.error(`published ${opt('publish')} (${q.status})`);
}
