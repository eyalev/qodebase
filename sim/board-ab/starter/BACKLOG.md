# Backlog

Each task: implement it in `src/`, re-export new helpers from `src/index.js`, add a test in
`test/`, add a line to `CHANGELOG.md`, and keep `npm test` green. Commands go in the registry in
`src/commands.js` (alphabetical by name). A task is done when its code is on `main`.

- **T1** Add `slugify(text)` to `src/strings.js`: lower-case, every run of characters that are not
  letters or digits becomes one `-`, no `-` at either end. `slugify('Hello, World!')` is `'hello-world'`.
- **T2** Add a `parseNumberList(text)` helper to `src/numbers.js` that reads a comma-separated list
  of numbers (spaces allowed) and returns an array of numbers: `'1, 2,3.5'` gives `[1, 2, 3.5]`.
  Empty input gives `[]`.
- **T3** Titles should look like titles: add `titleCase(text)` that makes the first letter of every
  word upper-case and the rest lower-case (`'the QUICK fox'` gives `'The Quick Fox'`).
- **T4** Add a `sum` command: `runCommand('sum 1, 2, 3')` returns `'6'`. Use `parseNumberList` (T2).
- **T5** We often need to know how long a text is in words. Add `countWords(text)`: the number of
  whitespace-separated words, `0` for empty or blank text.
- **T6** Add `truncate(text, max)`: if the text is longer than `max` characters, cut it so the result,
  including a trailing `'…'`, is exactly `max` characters long; otherwise return it unchanged.
- **T7** Add `mean(numbers)` to `src/numbers.js`: the arithmetic mean of an array, `null` for an
  empty array.
- **T8** Add a `slug` command: `runCommand('slug Hello World')` returns `'hello-world'`. Use the
  slug helper (T1).
- **T9** URLs need clean identifiers. Add `toSlug(title)` that turns a title into a URL-safe id:
  `'Hello, World!'` becomes `'hello-world'`.
- **T10** Add a `stats` command: `runCommand('stats 1, 2, 3, 6')` returns `'count=4 mean=3 max=6'`.
  Use `parseNumberList` (T2) and `mean` (T7).
- **T11** Add `capitalizeWords(text)`: every word starts with a capital letter and continues in
  lower case, e.g. `'hello wORLD'` becomes `'Hello World'`.
- **T12** Add a `words` command: `runCommand('words a b  c')` returns `'3'`. Use the word-count helper (T5).
- **T13** Add `wordCount(text)`: how many words a text has (words are separated by whitespace);
  blank text has none.
- **T14** Add `shorten(text, limit)`: long texts are cut to `limit` characters, the last one being
  `'…'`; texts within the limit stay as they are.
- **T15** Add `reverseWords(text)` (`'a b c'` gives `'c b a'`) and a `reverse` command that uses it.
- **T16** Add a `help` command: `runCommand('help')` returns the names of all registered commands,
  sorted, joined by `', '` (it must list itself too).
