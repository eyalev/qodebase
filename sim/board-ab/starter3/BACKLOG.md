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
- **T31** Notes, in `src/notes.js`: `addNote(item, text)` appends `text` to `item.notes` (an array, created if
  missing) and returns the item; `noteCount(item)` is the number of notes (0 when none). Command
  `note <id> <text>` adds a note and returns `'noted #<id>'`, or `'no item #<id>'`.
- **T32** Command `copy <id>`: adds a new item with the same title, tags (a new array), due and priority, not
  done, and returns `'copied #<id> to #<new id>'`, or `'no item #<id>'`.
- **T33** Sorting, in `src/sort.js`: `sortByDue(items)` returns a new array, earliest due date first, items
  without a due date last, ties in their original order. Command `sort-due` returns `formatList` (T7) of it.
- **T34** Weekdays, in `src/weekday.js`: `weekday('2026-10-09')` returns `'Fri'` (one of `'Mon'`…`'Sun'`);
  `isWeekend(date)` is true for Saturday and Sunday. Use the date helpers (T1).
- **T35** Command `on <date>`: `formatList` (T7) of the items due exactly on that date, `'(empty)'` if none.
- **T36** Pages, in `src/page.js`: `paginate(items, page, size)` returns `{ items, page, pages }`: page is
  1-based, `pages` is the number of pages (at least 1), and `items` is that page's slice (empty past the end).
- **T37** Command `page <n> <size>`: `formatList` (T7) of that page (T36), then a last line `'page <n>/<pages>'`.
- **T38** Summary, in `src/summary.js`: `summarize(items, today)` returns
  `{ total, open, done, overdue, dueToday }` (overdue = not done and due before today; dueToday = not done and
  due on today).
- **T39** Command `summary <today>`: returns `'total=3 open=2 done=1 overdue=1 today=0'` from `summarize` (T38).
- **T40** Markdown, in `src/markdown.js`: `toMarkdown(items)` returns one line per item, `'- [ ] Buy milk'` or
  `'- [x] Call mom'`, plus `' (due 2026-10-05)'` when it has a due date, joined by `'\n'` (`''` for none).
  Command `md` returns it.
- **T41** Command `untag <id> <#tag>`: removes the tag (normalised, T3) and returns `'untagged #<id>'`, or
  `'no item #<id>'`.
- **T42** Command `prio <id> <high|medium|low|none>`: sets the priority (`none` = null) and returns
  `'priority #<id> high'` (or `none`); `'bad priority'` for any other word; `'no item #<id>'` for a missing item.
- **T43** Command `set-due <id> <date>`: sets the due date and returns `'due #<id> 2026-10-12'`; `'bad date'` if
  the date is not valid (T1); `'no item #<id>'` for a missing item.
- **T44** Archive, in `src/archive.js`: `archiveDone(store)` moves the done items into `store.archive` (an array,
  created if missing, oldest first) and returns how many it moved. Command `archive` returns `'archived <n>'`.
- **T45** Tag completion, in `src/tagstats.js`: `tagCompletion(items)` returns `{ tag: done / items with that
  tag }` for every tag.
- **T46** Command `rate <#tag>`: returns `'home 50%'` (rounded to a whole percent, from `tagCompletion`, T45),
  or `'no items #home'` when no item has the tag.
- **T47** Relative days, in `src/relative.js`: `relativeDay(date, today)` returns `'today'`, `'tomorrow'`,
  `'yesterday'`, `'in 3 days'` or `'2 days ago'`. Use `daysBetween` (T1).
- **T48** Command `agenda <today>`: the items that are not done and have a due date, sorted by due (T33), one
  line each: `'<relativeDay> <title>'` (T47), e.g. `'tomorrow Buy milk'`; `'(empty)'` if none.
- **T49** Command `move <id> <position>`: moves the item to that 1-based position in the list (clamped to the
  ends) and returns `'moved #<id> to <position>'`, or `'no item #<id>'`.
- **T50** Redo, in `src/undo.js` (next to undo, T18): `redo(store)` re-applies the last change that `undo`
  took back and returns true, or false if there is nothing to redo; a new `add` or `done` clears what can be
  redone. Command `redo` returns `'redone'` or `'nothing to redo'`.
- **T51** Durations, in `src/duration.js`: `parseDuration('1h30m')` returns `90` (minutes; `'2h'` is 120,
  `'45m'` is 45, null for anything else); `formatDuration(90)` returns `'1h30m'` (`'2h'`, `'45m'`).
- **T52** Id lists, in `src/idlist.js`: `parseIdList('1,3-5,8')` returns `[1, 3, 4, 5, 8]` (ascending, no
  repeats); `formatIdList([8, 1, 3, 4, 5])` returns `'1,3-5,8'` (runs of 3 or more become a range; `[1, 2]` is
  `'1,2'`).
- **T53** Weeks, in `src/week.js`: `startOfWeek('2026-10-09')` returns `'2026-10-05'` (the Monday on or before
  the date); `weekDates(date)` returns the 7 dates Monday to Sunday of that week. Use the date helpers (T1).
- **T54** Wrapping, in `src/wrap.js`: `wrapText(text, width)` returns an array of lines, filled greedily word by
  word with single spaces, none longer than `width` except a single word that is longer on its own;
  `padRight(text, width)` adds spaces on the right up to `width` (longer text unchanged).
- **T55** Plurals, in `src/plural.js`: `plural(n, word, pluralWord)` returns `'1 item'`, `'0 items'`,
  `'2 items'` (`pluralWord` defaults to word + `'s'`); `listJoin(['a', 'b', 'c'])` returns `'a, b and c'`
  (`'a and b'` for two, `'a'` for one, `''` for none).
- **T56** People want to jot down how long a to-do will take, the way they would say it out loud. In
  `src/estimate.js`, `readEstimate(text)` should understand things like `'1h30m'`, `'2h'` or `'45m'` and give a
  number of minutes (null when it can't), and `showEstimate(minutes)` should write such a number back in that
  same short form.
- **T57** Bulk actions: users pick several to-dos at once by typing a selection like `'2-4,7'`. In
  `src/ranges.js`, `expandSelection(text)` gives every number the selection covers, smallest first, each once;
  `compactSelection(numbers)` writes numbers back in that short form, collapsing three or more consecutive ones
  into `a-b`.
- **T58** A weekly planning screen is coming. In `src/planner.js`, `mondayOf(day)` returns the date of the
  Monday on or before a given day, and `daysOfWeek(day)` the seven dates of that Monday-to-Sunday week, in order.
- **T59** Narrow terminals: long to-do titles run off the screen. In `src/layout.js`, `breakLines(text, columns)`
  splits text at spaces into an array of lines that each fit in `columns` (a single word that is longer gets a
  line of its own), and `fillTo(text, columns)` pads text with spaces on the right to `columns` characters.
- **T60** Our messages read badly ("1 items", "a, b, c"). In `src/english.js`, `countOf(n, noun, nounPlural)`
  says `'1 task'` / `'3 tasks'` (or the given plural form), and `naturalList(words)` joins words with commas and a
  final "and".
