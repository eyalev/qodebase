# Backlog

These are bigger features: expect each to take a while. Each task: implement it in `src/` (the module named
in the task), re-export every new function from `src/index.js`, add tests in `test/`, add a line to
`CHANGELOG.md`, and for every new command add it to the registry in `src/commands.js` (alphabetical) and a
line to `docs/COMMANDS.md`. Keep `npm test` green. A task is done when its code is on `main`. Dates are
'YYYY-MM-DD' strings; use the helpers in `src/dates.js`.

- **T1** Query language, in `src/query.js`: `query(items, text)` returns the items matching a query, in their
  order. Terms: `tag:home` (has the tag), `due<2026-10-10`, `due>2026-10-10`, `due=2026-10-10` (items without
  a due date never match these), `done`, `open`, `!high` / `!medium` / `!low` (priority), a bare word (the title
  contains it, case-insensitively) and a `"quoted phrase"` (same, for several words). Operators `not`, `and`,
  `or` (in that order of precedence; two terms side by side mean `and`) and parentheses. A query that cannot be
  parsed throws an Error whose message starts with `'bad query'`. Command `q <query>` returns `formatList` of
  the matches, or the error message.
- **T2** iCalendar export, in `src/ics.js`: `toIcs(items)` returns the text of a calendar: `BEGIN:VCALENDAR`,
  `VERSION:2.0`, `PRODID:-//todokit//EN`, then one `VTODO` per item (`BEGIN:VTODO`, `UID:<id>@todokit`,
  `SUMMARY:<title>`, `DUE;VALUE=DATE:20261005` if due, `PRIORITY:1` / `5` / `9` for high / medium / low if set,
  `STATUS:COMPLETED` or `STATUS:NEEDS-ACTION`, `CATEGORIES:home,work` if it has tags, `END:VTODO`), then
  `END:VCALENDAR`. Lines end in `\r\n` (the last one too). In SUMMARY, escape `\` `;` `,` and newlines as
  `\\` `\;` `\,` `\n`. Fold lines longer than 75 characters: the first 75 characters, then `\r\n` and a space
  and the next up to 74, and so on. Command `ics` returns it.
- **T3** iCalendar import, in `src/ics.js` (next to T2): `fromIcs(text)` returns a store (like `createStore()`)
  with one item per VTODO, reading everything `toIcs` writes: unfold lines, unescape SUMMARY, the id from the
  UID, `nextId` = the highest id + 1. Accepts `\n` as well as `\r\n` line ends. `fromIcs(toIcs(items))` gives
  back the same items.
- **T4** Sync, in `src/sync.js`: `diffStores(a, b)` returns `{ added, removed, changed }`: ids in b and not a,
  ids in a and not b (both ascending), and `[{ id, fields }]` for ids in both whose `title`, `done`, `due`,
  `priority` or `tags` differ (`fields` sorted by name; ids ascending). `mergeStores(base, ours, theirs)`
  returns `{ store, conflicts }`: a three-way merge per item and field. A field changed on one side takes that
  side's value; changed on both sides to different values, ours wins and `{ id, field }` goes into conflicts.
  An item deleted on one side and unchanged on the other is deleted; deleted on one side and changed on the
  other is kept (the changed version) with a conflict `{ id, field: 'deleted' }`. Items added on both sides
  are all kept: ours keep their ids, theirs get new ids after the highest id in use, in their order. The
  merged store's items are sorted by id and its `nextId` is the highest id + 1.
- **T5** Tables, in `src/table.js`: `renderTable(rows, columns)`: `columns` is
  `[{ key, title, align: 'left' | 'right', max }]` (`align` defaults to left, `max` is optional). Each column is
  as wide as its widest cell or title, but at most `max`; a longer value is cut to `max` characters, the last
  one being `'…'`. Lines: the titles, then a line of `-` (each column's width of them), then one line per row.
  Columns are separated by two spaces; `null`/`undefined` cells are empty; trailing spaces are removed from
  every line; lines are joined by `'\n'`. Command `table` renders the items with columns `id` (title `#`,
  right), `title` (`Title`, max 30), `due` (`Due`), `priority` (`Pri`) and `tags` (`Tags`, joined by a space).
- **T6** Natural dates, in `src/when.js`: `parseWhen(text, today)` returns a date or null. Understands
  (case-insensitively) `today`, `tomorrow`, `yesterday`, `in 3 days`, `in 2 weeks`, a weekday name or its
  first three letters (`friday`, `fri`: the next such day on or after today), `next friday` (the next one
  strictly after today), `oct 12` and `12 oct` (month names or their first three letters: this year, or next
  year if that date is before today) and plain `2026-10-12`.
- **T7** Command `add` understands natural due dates (T6): `due:tomorrow`, `due:next-fri`, `due:in-3-days` (a
  `-` stands for a space); today is `store.today` when it is set, else the current date. A due text that
  cannot be read makes `add` return `'bad due date'` and add nothing.
- **T8** Recurrence rules, in `src/rrule.js`: `nextDates(rule, from, count)` returns the first `count` dates of
  the rule strictly after `from`. Rules: `every day`, `every 3 days`, `every weekday` (Monday to Friday),
  `every week on mon,thu`, `every 2 weeks on mon` (weeks counted from the week of `from`; weeks start on
  Monday), `every month on the 31st` (`1st`, `2nd`, `3rd`, `15th`…; in a shorter month, its last day). Any
  other rule throws an Error with the message `'bad rule'`.
- **T9** Dependencies, in `src/deps.js`: an item may have `after: [ids]` (it waits for those items).
  `topoOrder(items)` returns all ids so that every item comes after the items it waits for, the smallest ready
  id first; a cycle throws an Error `'cycle: 2 -> 3 -> 2'` (the cycle's smallest id first). `blockedBy(items, id)`
  returns the ids of the not-done items it waits for, directly or through others, ascending. Command `blocked`
  returns one line per not-done item that waits for a not-done item, `'#3 waits for #1, #2'` (all of
  `blockedBy`), ids ascending; `'(none)'` if none.
- **T10** Time tracking, in `src/timer.js`: times are `'YYYY-MM-DDTHH:MM'`. `startTimer(item, at)` starts a
  session (`item.sessions`, an array of `{ start, end }`, created if missing; throws `'already running'` if one
  is open); `stopTimer(item, at)` closes it (throws `'not running'` if none is open); `timeSpent(item)` is the
  minutes of the closed sessions; `formatMinutes(95)` is `'1:35'` (`'0:05'`); `timeByTag(items)` returns
  `{ tag: minutes }`. Commands `start <id> <time>` and `stop <id> <time>` return `'started #<id>'` /
  `'stopped #<id> 1:35'` (the item's total) or the error message.
- **T11** Fuzzy search, in `src/fuzzy.js`: `fuzzyScore(query, text)` is null unless the query's characters
  appear in the text in order (case-insensitively, spaces in the query ignored). Otherwise match each query
  character at its earliest possible place and score 1 per character, +5 when the character starts a word
  (the text's first character, or one after a space), and +3 when it comes right after the previous matched
  character. `fuzzyFind(items, query)` returns the items whose title matches, best score first, ties by id.
  Command `ff <query>` returns `formatList` of them.
- **T12** Saving, in `src/persist.js`: `saveStore(store, file)` writes `{ "version": 2, "items", "nextId" }` as
  JSON, safely: to `file + '.tmp'`, then renamed over `file`. `loadStore(file)` reads it back; a file without
  `version` (version 1) is upgraded: items without `priority` get null and without `tags` get `[]`. A missing
  file gives an empty store. A version above 2 throws `'unsupported version 3'`.
- **T13** Power users want one box where they can type conditions instead of clicking filters. In
  `src/smartfilter.js`, `smartFilter(items, text)` keeps the items the text describes: `tag:work`, a due date
  before / after / on a day (`due<…`, `due>…`, `due=…`; undated items never pass these), finished (`done`) or
  not (`open`), a priority (`!low` etc.), words or a `"phrase in quotes"` from the title (any case); combine with
  `and` (or just a space), `or`, `not` and parentheses, `not` binding tightest and `or` loosest. If the text
  makes no sense, throw an Error starting with `'bad query'`.
- **T14** Laptop and phone each keep a copy of the list and we need to bring them together. In
  `src/reconcile.js`: `compareCopies(a, b)` reports which ids b has that a lacks (`added`), which a has that b
  lacks (`removed`) and, for ids in both, which of title / done / due / priority / tags differ
  (`changed: [{ id, fields }]`, fields alphabetical, everything ascending). `reconcile(base, mine, yours)`
  merges two copies that both started from `base`, field by field, and returns `{ store, conflicts }`: an edit
  on one side wins; edits on both sides that disagree keep mine and are listed as `{ id, field }`; a delete
  beats an untouched item but loses to an edit (listed as field `'deleted'`); new items from both sides are
  kept, mine with their ids, yours renumbered after the highest id in use in their order; items sorted by id,
  `nextId` one past the highest.
- **T15** Our text output looks ragged. In `src/columns.js`, `alignColumns(rows, spec)` lines rows up under
  headings: `spec` lists `{ key, title, align, max }` per column (left alignment unless `'right'`; `max`, if
  given, caps the width and an over-long value is shortened to exactly `max` characters ending in `'…'`). A
  column is as wide as the widest of its heading and values. Output: headings, a row of dashes as wide as each
  column, then the rows; two spaces between columns; empty for null/undefined; no spaces at line ends; lines
  joined with newlines.
- **T16** People mistype when they search. In `src/loose.js`, `looseMatch(query, text)` says how well a text
  matches a query typed with letters left out: null when the query's letters (ignoring case and spaces) are not
  in the text in that order; otherwise take each letter at the first place it can go, and give 1 point per
  letter, 5 more when it is the first letter of a word (start of text or after a space) and 3 more when it
  directly follows the previous matched letter. `looseSearch(items, query)` lists the items whose title
  matches, highest score first, equal scores by id.
