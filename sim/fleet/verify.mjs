// Fleet F0: is the code unchanged? Compare the TypeScript token streams of two versions of a file with comments and
// whitespace skipped (the scanner's trivia), plus a parse of the new one with no new syntax errors. Same tokens in the
// same order = same syntax tree. Template literals are rescanned so their text counts.
import ts from 'typescript';

export function tokens(text, fileName = 'f.ts') {
  // The parser's own tokens (getChildren leaves), so template literals, regexes and JSX are scanned in context.
  // A plain scanner loses its place after `${...}` and reads code after the template as template text. JSDoc nodes
  // are skipped: they are comments.
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const walk = (n) => {
    if (n.kind >= ts.SyntaxKind.FirstJSDocNode && n.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const kids = n.getChildren(sf);
    if (!kids.length) { if (n.kind !== ts.SyntaxKind.EndOfFileToken) out.push(n.kind + ':' + n.getText(sf)); return; }
    for (const k of kids) walk(k);
  };
  walk(sf);
  return out;
}

// -> { same: bool, why?, at? }
export function sameCode(before, after, fileName = 'f.ts') {
  const a = tokens(before, fileName), b = tokens(after, fileName);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return { same: false, why: 'token differs', at: i, was: a[i], now: b[i] };
  if (a.length !== b.length) return { same: false, why: 'token count differs', was: a.length, now: b.length };
  const diag = (t) => ts.createSourceFile(fileName, t, ts.ScriptTarget.Latest, true).parseDiagnostics?.length ?? 0;
  const da = diag(before), db = diag(after);
  if (db > da) return { same: false, why: 'new parse errors', was: da, now: db };
  return { same: true };
}

// Insert comments before 1-based lines, indented like the line. -> new text
export function insertComments(text, items) {
  const lines = text.split('\n');
  const byLine = new Map();
  for (const it of items) if (Number.isInteger(it.line) && it.line >= 1 && it.line <= lines.length && typeof it.comment === 'string') byLine.set(it.line, it.comment);
  const out = [];
  lines.forEach((l, i) => {
    const c = byLine.get(i + 1);
    if (c) { const ind = l.match(/^\s*/)[0]; for (const cl of c.trim().split('\n')) out.push(ind + cl.trim().replace(/^\*/, ' *').replace(/^ \*\//, ' */').replace(/^ \*\*/, '/**')); }
    out.push(l);
  });
  return out.join('\n');
}
