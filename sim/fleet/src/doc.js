// The fleet's code step (F1): find a file's exported functions and classes that have no doc comment, put the model's
// comments above them, and VERIFY the code did not change: the TypeScript scanner's token stream with comments and
// whitespace skipped must be identical, and parsing must not add errors. The model never rewrites code: it only answers
// with {name: comment} and this module does the insertion.
import ts from 'typescript';

/** Exported top-level functions and classes (and exported const arrow/function values) with no /** comment above. */
export function targets(path, text) {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out = [];
  for (const st of sf.statements) {
    const exported = (ts.getCombinedModifierFlags(st) & ts.ModifierFlags.Export) !== 0;
    if (!exported) continue;
    let name = null, kind = null;
    if (ts.isFunctionDeclaration(st) && st.name) { name = st.name.text; kind = 'function'; }
    else if (ts.isClassDeclaration(st) && st.name) { name = st.name.text; kind = 'class'; }
    else if (ts.isVariableStatement(st) && st.declarationList.declarations.length === 1) {
      const d = st.declarationList.declarations[0];
      if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) { name = d.name.text; kind = 'function'; }
    }
    if (!name) continue;
    const ranges = ts.getLeadingCommentRanges(text, st.pos) || [];
    if (ranges.some((r) => text.slice(r.pos, r.pos + 3) === '/**')) continue;   // already documented
    const start = st.getStart(sf, false);   // after leading trivia: decorators/export included
    const line = sf.getLineAndCharacterOfPosition(start).line;
    out.push({ name, kind, line, signature: text.slice(start, Math.min(text.length, start + 240)).split('{')[0].trim().slice(0, 200) });
  }
  // Names must be unique to be addressed by name (overloads: the first one only).
  const seen = new Set();
  return out.filter((t) => (seen.has(t.name) ? false : (seen.add(t.name), true)));
}

/** A comment the model wrote, made safe: plain text, no comment delimiters, at most 6 lines of 100 chars. */
export function cleanComment(c) {
  const s = String(c || '').replace(/\/\*+|\*+\//g, '').replace(/^\s*\*\s?/gm, '').replace(/\r/g, '').trim();
  if (!s || s.length < 8) return null;
  const words = s.split(/\s+/);
  const lines = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > 100) { lines.push(cur.trim()); cur = w; } else cur += ' ' + w; }
  if (cur.trim()) lines.push(cur.trim());
  return lines.slice(0, 6);
}

/** Insert one JSDoc block above each target that got a comment. Returns the new text and how many were inserted. */
export function insert(text, tgts, comments) {
  const lines = text.split('\n');
  const byLine = new Map();
  for (const t of tgts) { const c = cleanComment(comments[t.name]); if (c) byLine.set(t.line, c); }
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const c = byLine.get(i);
    if (c) {
      const indent = (lines[i].match(/^\s*/) || [''])[0];
      out.push(`${indent}/**`, ...c.map((l) => `${indent} * ${l}`), `${indent} */`);
    }
    out.push(lines[i]);
  }
  return { text: out.join('\n'), inserted: byLine.size };
}

/** The syntax tree's leaf tokens (kind + text), comments and whitespace skipped. The parser decides what a token is
 *  (a lone scanner misreads template literals and regexes without the parser's context). JSDoc nodes are not code. */
function tokens(path, text) {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out = [];
  const walk = (n) => {
    if (n.kind >= ts.SyntaxKind.FirstJSDocNode && n.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const kids = n.getChildren(sf);
    if (!kids.length) { if (n.kind !== ts.SyntaxKind.EndOfFileToken || n.getText(sf)) out.push(`${n.kind}:${n.getText(sf)}`); return; }
    for (const k of kids) walk(k);
  };
  walk(sf);
  return out;
}
const parseErrors = (path, text) => (ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS).parseDiagnostics || []).length;

/** The change only added comments: same code tokens, no new parse errors. */
export function verify(path, before, after) {
  const a = tokens(path, before), b = tokens(path, after);
  if (a.length !== b.length) return { ok: false, why: `token count ${a.length} -> ${b.length}` };
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return { ok: false, why: `token ${i} differs: ${a[i].slice(0, 40)} -> ${b[i].slice(0, 40)}` };
  const e0 = parseErrors(path, before), e1 = parseErrors(path, after);
  if (e1 > e0) return { ok: false, why: `parse errors ${e0} -> ${e1}` };
  return { ok: true, tokens: a.length };
}

/** The prompt for one file: its path, the targets, and the code (trimmed for very large files). */
export function prompt(path, text, tgts) {
  const code = text.length > 24_000 ? text.slice(0, 24_000) + '\n// … (file continues)' : text;
  return [
    `You write documentation comments for a TypeScript file from the VS Code codebase: ${path}.`,
    `For each of these exported declarations, write one short doc comment (1-3 sentences, plain English, no markdown, no @param tags, no code): what it is or does and when to use it. Base it on the code; do not guess beyond it.`,
    tgts.map((t) => `- ${t.name} (${t.kind}): ${t.signature}`).join('\n'),
    `Answer with ONE JSON object only, mapping each name to its comment, e.g. {"${tgts[0]?.name || 'name'}": "Returns ..."}. No other text.`,
    '', 'The file:', '```ts', code, '```',
  ].join('\n');
}

/** The model's answer -> {name: comment} for the target names it covered. */
export function parseAnswer(raw, tgts) {
  const s = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return {};
  let j; try { j = JSON.parse(m[0]); } catch { return {}; }
  const names = new Set(tgts.map((t) => t.name));
  return Object.fromEntries(Object.entries(j || {}).filter(([k, v]) => names.has(k) && typeof v === 'string'));
}
