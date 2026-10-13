// The code collision dial (2026-10-13): fleet agents implement or change one kata function per task (qb4's
// sim/kata/seed-1), and every change goes through qodebase's REAL merge queue (Landing DO + MergeBox, land by intent).
// Pure helpers here (prompt, answer parsing, the local check); the agent itself is KataAgent in index.js.
import ts from 'typescript';

/** The prompt for one task: the task text, the file as it is on main right now, and the rules. */
export function kataPrompt(task, path, text) {
  return [
    'You edit ONE JavaScript file of a small library (ES modules, no dependencies, Node 22).',
    `Task: ${task}`,
    'Rules: change only this file; keep every export that is there; keep all behaviour that is already implemented working ' +
      '(an earlier change request must still work after yours); update the doc comment to describe the options you add; ' +
      'no console output; no imports.',
    'Reply with the COMPLETE new file in one ```js code block and nothing else.',
    '', `File: ${path}`, '```js', text, '```',
  ].join('\n');
}

/** The code block of an answer (the last ```js block, or the whole answer when it is plain code). */
export function parseCode(raw) {
  const s = String(raw || '');
  const blocks = [...s.matchAll(/```(?:js|javascript|mjs)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const code = blocks.length ? blocks.sort((a, b) => b.length - a.length)[0] : (/^\s*(\/\*\*|export|function|const)/.test(s) ? s : '');
  return code.trim() ? code.replace(/\s*$/, '\n') : '';
}

/** Before pushing: it parses, it still exports the function, and it no longer only throws 'not implemented'. */
export function checkCode(path, code, fn) {
  if (!code) return { ok: false, why: 'no code in the answer' };
  const sf = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const errs = sf.parseDiagnostics || [];
  if (errs.length) return { ok: false, why: `syntax: ${ts.flattenDiagnosticMessageText(errs[0].messageText, ' ').slice(0, 120)}` };
  const name = fn.split('/').pop();
  const exported = sf.statements.some((st) => (ts.getCombinedModifierFlags(st) & ts.ModifierFlags.Export) && ((ts.isFunctionDeclaration(st) && st.name?.text === name) || (ts.isVariableStatement(st) && st.declarationList.declarations.some((d) => d.name.getText(sf) === name))));
  if (!exported) return { ok: false, why: `${name} is no longer exported` };
  if (/throw new Error\(['"]not implemented['"]\)/.test(code)) return { ok: false, why: 'still not implemented' };
  if (/\bimport\s|\brequire\(/.test(code)) return { ok: false, why: 'imports something' };
  return { ok: true };
}
