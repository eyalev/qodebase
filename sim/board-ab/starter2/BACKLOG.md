# Backlog

Each task: implement it in `src/` (one module per topic, named in the task), re-export every new
function from `src/index.js`, add tests in `test/`, add a line to `CHANGELOG.md`, and for every new
command add it to the registry in `src/commands.js` (alphabetical) and a line to `docs/COMMANDS.md`.
Keep `npm test` green. A task is done when its code is on `main`. Dates are 'YYYY-MM-DD' strings.

- **T1** Dates, in `src/dates.js`: `parseDate('2026-10-09')` returns `{ y: 2026, m: 10, d: 9 }` (null if the
  text is not a valid date); `formatDate({ y, m, d })` returns `'2026-10-09'`; `addDays('2026-10-30', 3)` returns
  `'2026-11-02'` (negative n goes back); `daysBetween('2026-10-01', '2026-10-09')` returns `8` (negative if the
  second is earlier).
- **T2** Text, in `src/text.js`: `slugify('Hello, World!')` returns `'hello-world'` (lower case, runs of other
  characters become one `-`, none at the ends); `titleCase('the QUICK fox')` returns `'The Quick Fox'`;
  `truncate(text, max)` cuts text longer than `max` so the result, ending in `'…'`, is exactly `max` long.
- **T3** Tags, in `src/tags.js`: `parseTags('buy #Milk and #eggs #milk')` returns `['milk', 'eggs']` (lower case,
  no `#`, no repeats, first-seen order); `normalizeTag('#Home')` returns `'home'`; `tagCounts(items)` returns an
  object `{ tag: number of items with it }`.
- **T4** Priority, in `src/priority.js`: `priorityRank(p)` is 0 for `'high'`, 1 for `'medium'`, 2 for `'low'`,
  3 for anything else; `sortByPriority(items)` returns a new array sorted by rank, keeping the original order
  for equal ranks.
- **T5** Filters, in `src/filters.js`: `byTag(items, tag)`, `byDone(items, done)`, and `dueBefore(items, date)`
  (items with a due date strictly before `date`; items without one are left out). Use the date helpers (T1).
- **T6** Stats, in `src/stats.js`: `completionRate(items)` = done / all (`null` for no items);
  `overdueCount(items, today)` = items not done whose due date is before `today`.
- **T7** Formatting, in `src/format.js`: `formatItem(item)` gives `'[ ] #3 Buy milk'`, with `'[x]'` when done,
  then ` (due 2026-10-12)` if it has a due date, ` !high` if it has a priority, then ` #tag` for each tag;
  `formatList(items)` is the items' lines joined by `'\n'`, or `'(empty)'` for none.
- **T8** Command `add`: `runCommand(store, 'add Buy milk #home due:2026-10-12 !high')` adds an item with title
  `'Buy milk'`, tags `['home']`, due `'2026-10-12'`, priority `'high'`, and returns `'added #<id>'`. The title is
  the words that are not tags, `due:` or `!priority`. Use `parseTags` (T3).
- **T9** Command `list`: returns `formatList` (T7) of all items.
- **T10** Command `done <id>`: marks the item done and returns `'done #<id>'`, or `'no item #<id>'`.
- **T11** Command `tags`: returns `'home=2, work=1'`: every tag with its count, sorted by tag; `'(no tags)'` if
  none. Use `tagCounts` (T3).
- **T12** Command `stats`: returns `'items=4 done=1 rate=25%'` (rate rounded to a whole percent, `rate=-` with
  no items). Use `completionRate` (T6).
- **T13** Command `due <date>`: `formatList` (T7) of the items due before that date (T5), `'(empty)'` if none.
- **T14** JSON, in `src/json.js`: `exportJson(store)` returns a JSON string of the store; `importJson(text)`
  returns a store that works with every helper and keeps the ids and next id.
- **T15** Search, in `src/search.js`: `search(items, query)` finds items whose title or one of whose tags
  contains the query, case-insensitively; command `find <query>` returns `formatList` (T7) of the hits.
- **T16** Recurrence, in `src/recur.js`: `nextOccurrence('2026-01-31', 'monthly')` returns `'2026-02-28'`
  (last day if the month is shorter); `'daily'` adds 1 day and `'weekly'` 7 (use T1).
- **T17** CSV, in `src/csv.js`: `toCsv(items)` returns a header line `id,title,done,due,priority,tags` and one
  line per item (`done` is `true`/`false`, empty fields for nulls, tags joined by `;`); a field containing a
  comma or a `"` is wrapped in `"` with inner `"` doubled. Command `csv` returns it.
- **T18** Undo, in `src/undo.js`: `snapshot(store)` saves the store's state on a history stack kept on the
  store; `undo(store)` restores the last snapshot and returns true, or false if there is none. Command `undo`
  returns `'undone'` or `'nothing to undo'`; commands `add` and `done` take a snapshot before changing anything.
- **T19** People keep asking for nicer strings. In `src/strings.js` add `makeSlug(text)` (a URL-safe id from any
  text: `'Hello, World!'` gives `'hello-world'`), `toTitle(text)` (each word capitalised, the rest lower case)
  and `clip(text, n)` (long text shortened to n characters, the last one being `'…'`).
- **T20** Urgency, in `src/urgency.js`: `urgencyScore(item)` is 0 for high, 1 for medium, 2 for low and 3 when
  there is none; `orderByUrgency(items)` returns the items most urgent first, ties in their original order.
- **T21** Hashtags, in `src/hashtags.js`: `extractHashtags(text)` lists the distinct `#words` in a text, lower
  case without `#`, in order of first appearance; `cleanHashtag('#Work')` is `'work'`; `countHashtags(items)`
  maps each tag to how many items carry it.
- **T22** Progress, in `src/progress.js`: `progress(items)` is the share of items that are done (`null` when there
  are none) and `lateItems(items, today)` is how many unfinished items were due before today.
- **T23** Calendar math, in `src/calendar.js`: `toDateParts('2026-10-09')` gives `{ y: 2026, m: 10, d: 9 }` or
  `null` for an invalid date, `fromDateParts({ y, m, d })` gives back the string, `shiftDate(date, n)` moves a
  date by n days and `dayDiff(a, b)` counts the days from a to b.
- **T24** Command `rename <id> <new title>`: returns `'renamed #<id>'` or `'no item #<id>'`.
- **T25** Command `tag <id> <#tag>`: adds the tag (normalised, T3) if missing; returns `'tagged #<id>'`.
- **T26** Command `clear-done`: removes done items, returns `'removed <n>'`.
- **T27** Validation, in `src/validate.js`: `validateItem(item)` returns a list of problems: `'missing title'`
  for an empty title, `'bad due date'` for a due date that is not a valid date (T1), `'bad priority'` for a
  priority other than high/medium/low/null. An empty list when fine.
- **T28** Command `help`: the names of all commands, sorted, joined by `', '` (it lists itself).
- **T29** Groups, in `src/groups.js`: `groupByTag(items)` returns `{ tag: [ids] }` (ids ascending); command
  `groups` returns lines `'home: 1, 3'`, sorted by tag, joined by `'\n'`.
- **T30** Command `overdue <today>`: `formatList` (T7) of the items not done and due before `today`.
