# Backlog

Each task is a whole small library: expect it to take a while, and read its spec closely (the details are tested).
Each task: implement it in the module named, re-export every function it names from `src/index.js`, add tests in
`test/`, add a line to `CHANGELOG.md` and a line to the "Modules" list in `README.md` (alphabetical). Keep
`npm test` green. A task is done when its code is on `main`. No dependencies.

- **T1** Markdown, in `src/markdown.js`: `renderMarkdown(text)` returns HTML for this subset, one block per group
  of lines separated by blank lines, blocks joined by `'\n'`:
  - `# ` to `###### ` headings → `<h1>`…`<h6>`;
  - a fenced code block (a line ```` ``` ````, lines, a line ```` ``` ````) → `<pre><code>…</code></pre>` with the lines
    joined by `'\n'`, HTML-escaped, nothing else applied (a fence may contain blank lines);
  - lines starting with `> ` → `<blockquote>` around the rendered inner text (the `> ` removed; the inner text is
    rendered as markdown);
  - lines starting with `- ` → `<ul>` with one `<li>` per line; a line indented by two more spaces than the one
    before it starts a nested `<ul>` inside the previous `<li>`; lines starting with `1. ` (any number) → `<ol>` the
    same way;
  - anything else → `<p>` with the lines joined by a space.
  No whitespace is added inside a block: `<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>`, and a quote is
  `<blockquote>` + the inner HTML + `</blockquote>` (`> hi` → `<blockquote><p>hi</p></blockquote>`).
  Inline (in headings, paragraphs, list items, quotes): first HTML-escape `&` `<` `>` `"`; then `` `code` `` →
  `<code>code</code>` (its content not processed further), `**bold**` → `<strong>`, `*em*` → `<em>`,
  `[text](url)` → `<a href="url">text</a>`. A `\` before `*`, `` ` ``, `[` or `\` makes it literal.
  Output has no trailing newline. Example: `'# Hi\n\nSome *very* `x<y` text'` →
  `'<h1>Hi</h1>\n<p>Some <em>very</em> <code>x&lt;y</code> text</p>'`.
- **T2** Cron, in `src/cron.js`: `parseCron(expr)` and `nextRun(expr, from)`. Five fields: minute (0-59), hour
  (0-23), day of month (1-31), month (1-12 or `jan`…`dec`), day of week (0-7, 0 and 7 are Sunday, or `sun`…`sat`;
  names case-insensitive). Each field: `*`, a number, a name, a range `a-b`, a step `*/n` or `a-b/n`, or a comma
  list of those. Shortcuts `@hourly` (`0 * * * *`), `@daily` (`0 0 * * *`), `@weekly` (`0 0 * * 0`), `@monthly`
  (`0 0 1 * *`). `parseCron` returns `{ minute, hour, dom, month, dow }`, each a sorted array of the allowed
  numbers (day of week uses 0-6). If both day of month and day of week are restricted (neither is `*`), a day
  matches when EITHER matches; otherwise both must. `nextRun(expr, from)` takes and returns `'YYYY-MM-DDTHH:MM'`
  (UTC) and returns the first matching minute strictly after `from` (null if none within 5 years). Anything invalid
  (a value out of range, a reversed range, a zero step, a wrong field count, an unknown name) throws an Error whose
  message starts with `'bad cron'`.
- **T3** Line diff, in `src/diff.js`: `diffLines(a, b)` compares two texts split on `'\n'` and returns
  `[{ op: '=' | '-' | '+', line }]` with the fewest `-` and `+` (a longest common subsequence); when there is a
  choice, removals come before additions and the earliest lines are kept. `unifiedDiff(a, b, { context = 3,
  from = 'a', to = 'b' } = {})` returns `''` when the texts are equal, else `'--- a\n+++ b\n'` followed by hunks:
  `'@@ -l,s +l,s @@'` (1-based start line and line count in each text; a count of 0 uses the line before, as GNU
  diff does) and the lines prefixed `' '`, `'-'`, `'+'`; two changes with at most 2 × context unchanged lines between
  them share one hunk; each line ends in `'\n'`. `applyPatch(a, patch)` applies such a patch and returns the new text; if a hunk's context or removed
  lines don't match, it throws `'patch does not apply'`.
- **T4** Templates, in `src/template.js`: `render(template, data)`. `{{ path }}` inserts a value (spaces inside the
  braces are allowed), HTML-escaping `& < > " '` (as `&amp; &lt; &gt; &quot; &#39;`); `{{{ path }}}` inserts it
  raw. A path is `name` or `a.b.c`; a missing value or null inserts `''`. `{{#if path}}…{{else}}…{{/if}}` (the
  else part optional): truthy except for `false`, `0`, `''`, null, missing and an empty array.
  `{{#each path}}…{{/each}}` repeats for each element of an array (nothing for a missing or empty one); inside,
  `{{this}}` is the element, `{{@index}}` its 0-based index, and a name is looked up on the element first, then
  outward. Blocks nest. An unclosed or mismatched block throws an Error whose message starts with
  `'bad template'`.
- **T5** Versions, in `src/semver.js`: `parseVersion('1.2.3-beta.2')` returns `{ major, minor, patch, pre: ['beta',
  2] }` (pre identifiers that are all digits become numbers; `pre: []` when none; null for an invalid version; a
  leading `v` is allowed). `compareVersions(a, b)` returns -1, 0 or 1 by SemVer 2.0 precedence (a version with a
  pre-release is lower than the same version without; identifiers compare one by one, numbers numerically and
  lower than strings, a shorter list lower). `satisfies(version, range)`: comparators `>`, `>=`, `<`, `<=`, `=` (or
  none) joined by spaces (all must hold), alternatives joined by `||`; `^1.2.3` = `>=1.2.3 <2.0.0` (`^0.2.3` =
  `>=0.2.3 <0.3.0`, `^0.0.3` = `>=0.0.3 <0.0.4`); `~1.2.3` = `>=1.2.3 <1.3.0`; `1.2.x` / `1.2` = `>=1.2.0 <1.3.0`,
  `1.x` / `1` = `>=1.0.0 <2.0.0`, `*` = any; `1.2.3 - 2.3.4` = `>=1.2.3 <=2.3.4`. A version with a pre-release
  satisfies a range only if one of the comparators of the matching alternative names the same major.minor.patch
  with a pre-release. `maxSatisfying(versions, range)` returns the highest that satisfies, or null.
- **T6** Expressions, in `src/expr.js`: `evaluate(text, vars = {})` evaluates numbers (`12`, `3.5`, `.5`),
  variables (letters, digits, `_`; not starting with a digit), `+ - * / %`, `^` (power, right-associative, binding
  tighter than a unary minus: `-2^2` is -4, `2^3^2` is 512), unary minus, parentheses, and the functions `min`,
  `max` (one or more arguments), `abs`, `round`, `sqrt` (one argument). Errors are Errors with exactly these
  messages: `'unknown variable x'`, `'unknown function f'`, `'division by zero'` (for `/` and `%`), and
  `'bad expression at N'` (N = the 0-based index of the first character that cannot be parsed, or the text's length
  when it ends too early).
- **T7** Config files, in `src/config.js`: `parseConfig(text)` returns an object. Lines: blank, a comment (`#` or `;`
  first on the line, after spaces), a section `[name]` or `[a.b]` (nested objects; later keys go there), or
  `key = value`. Values: a double-quoted string (escapes `\n`, `\t`, `\"`, `\\`), an integer or decimal number,
  `true` / `false`, an array `[v, v, …]` of values (arrays may nest; one line), or a parenthesised expression
  `(2 * 60)` evaluated with `evaluate` from T6 using the numbers set so far in the same section as variables. A
  `#` after a value starts a comment unless it is inside a string. Errors: `'line N: duplicate key k'`, and for
  anything else that cannot be read `'line N: '` plus a short reason (N is 1-based). `stringifyConfig(obj)` writes
  an object back so that `parseConfig(stringifyConfig(o))` deep-equals `o` (top-level plain keys first, then one
  section per nested object).
- **T8** Routes, in `src/router.js`: `createRouter()` returns `{ add(pattern, name), match(path), url(name, params) }`.
  Patterns are `/`-separated: a static segment, `:name` (one segment), `:name?` (optional, last only), `*name` (the
  rest of the path, one or more segments, last only). `match(path)` returns `{ name, params }` or null; params are
  URI-decoded; a trailing `/` on the path is ignored. When several patterns match, compare them segment by segment
  from the left: static beats `:param` beats `*wildcard`; the first difference decides; if they tie, the one added
  first wins. `url(name, params)` builds the path (params URI-encoded, except that a wildcard's value keeps its `/`
  separators; an optional param left out drops its segment); a missing required param throws `'missing param <name>'`, an unknown route name `'unknown route <name>'`.
- **T9** Cache, in `src/cache.js`: `createCache({ max, ttl, now = Date.now })` returns `{ get, set, has, delete,
  size, stats }`. It keeps at most `max` entries, evicting the least recently used (`get` and `set` both count as
  use; `has` does not). An entry older than `ttl` ms (by `now()`, measured from its last `set`) is expired: `get`
  and `has` treat it as missing and remove it. `size()` counts entries that are not expired. `stats()` returns
  `{ hits, misses, evictions, expired }` (a `get` of an expired entry is a miss and counts one expired). `delete`
  returns whether the key was there (and not expired).
- **T10** The server people want the same schedule strings their machines use for recurring to-dos ("every weekday
  at 9:30" is `30 9 * * 1-5`). In `src/schedule.js`, `readSchedule(text)` turns one of those five-part strings
  (minute, hour, day of month, month, weekday; with `*`, numbers, `a-b`, `*/n` and `a-b/n` steps, comma lists,
  month names jan–dec and weekday names sun–sat in any case, weekday 7 also meaning Sunday, and the shortcuts
  `@hourly`, `@daily`, `@weekly`, `@monthly`) into `{ minute, hour, dom, month, dow }` lists of allowed numbers,
  sorted, with weekdays 0–6. `nextTime(text, after)` gives the next matching UTC minute after `after`, both written
  `'YYYY-MM-DDTHH:MM'`, or null if nothing matches in five years. When both the day of month and the weekday are
  limited, either one is enough for a day to match. Bad input (out of range, backwards range, step 0, wrong
  number of parts, unknown name) throws an Error starting with `'bad cron'`.
- **T11** Reminder texts should be mail-merged, e.g. "Hi {{name}}, you have {{#each tasks}}…". In
  `src/mailmerge.js`, `fillIn(text, values)` fills `{{ field }}` / `{{ a.b }}` with the value made HTML-safe
  (`&amp; &lt; &gt; &quot; &#39;`), `{{{ field }}}` without that, and nothing for missing or null. It supports
  conditional parts `{{#if field}}…{{else}}…{{/if}}` (false, 0, empty text, null, missing and empty lists count as
  no) and repeated parts `{{#each list}}…{{/each}}` where `{{this}}` is the current element, `{{@index}}` counts
  from 0, and other names are looked up on the element before the surrounding data. Parts can be nested; a part
  that is not closed properly throws an Error whose message starts with `'bad template'`.
- **T12** Plugins declare which app versions they work with, npm style. In `src/compat.js`:
  `versionInfo(text)` splits `'v2.0.1-rc.1'` into `{ major: 2, minor: 0, patch: 1, pre: ['rc', 1] }` (numeric
  parts as numbers, `pre: []` without one, null when invalid); `versionOrder(a, b)` sorts like SemVer 2.0 (-1, 0,
  1; a pre-release before its release; parts compared left to right, numbers by value and before words, fewer
  parts first); `compatible(version, rule)` understands `>=`, `<`, `>`, `<=`, `=`/bare versions combined with spaces
  (and) and `||` (or), caret (`^1.2.3` up to the next major, `^0.2.3` up to the next minor, `^0.0.3` up to the next
  patch), tilde (`~1.2.3` up to the next minor), wildcards (`1.2.x`, `1.2`, `1.x`, `1`, `*`) and hyphen ranges
  (`1.2.3 - 2.3.4`, both ends included), and lets a pre-release through only when a comparator in the matching
  alternative has a pre-release on the same major.minor.patch; `bestMatch(versions, rule)` returns the highest
  compatible one, or null.
