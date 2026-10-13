# R3 vs R6: does each "Home inventory" build actually do what the prompt asked?

Same prompt, two builds: **R3** = a team of 9 Haiku coders (Balanced, allowed up to 12; its router started 9) with an Opus planner and 3 reviewers (eyal/real-home-inventory), **R6** = one Opus agent
(eyal/real-home-inventory-solo). Both private; opened with the owner's run pass. Checked 2026-10-13 by qb9 in headless
Chromium as a phone (390 x 844, touch, trusted taps), each app in a fresh profile, by doing each thing: add rooms
and a box, add an item with a photo, price, purchase date, warranty date and two tags, then search, move it, read
room values, filter by tag, lend it and get it back, print, download both exports. Nothing in either app's code was
changed; the test data lives only in the test browser's storage. No model runs.

## Counts

| | works | partial | missing |
|---|---|---|---|
| R3 (9-agent team) | 11 | 0 | 0 |
| R6 (one Opus) | 11 | 0 | 0 |

Both builds do every feature. The differences are in finish and small bugs, listed below the table.

## Feature by feature

| feature | R3 (9-agent team) | R6 (one Opus) |
|---|---|---|
| rooms | works: add, rename, delete on the Rooms page | works: "+ Add room" dialog; rename, delete per room |
| boxes | works: "Add box" inside a room; box shows its item count and value | works: "+ Box" dialog with a room picker; shown under its room |
| item with photo, price, date | works: photo upload (thumbnail shown), price, purchase date, notes | works: same, plus quantity (value = price x qty) |
| warranties expiring | works: Warranty page, window 30/60/90/180 days, "in 19 days" | works: Warranties tab with a count badge, 30–365 days; the item card also says "Warranty ends in 19 days" |
| search | works: matches name, tag, borrower; filters by room and tag; sort by name/price/date | works: matches name, tag, borrower; filter by room or box; five sorts |
| move items | works: item page → Location → room + box → Move (one item at a time) | works: tick items → bulk bar → place → Move (several at once); also in the edit dialog |
| value per room | works: per room and per box, home total on top | works: per room, insurance total, counts of items/rooms/boxes |
| tags | works: tag input (Enter per tag), Tags page with counts, tag filter in Search | works: comma-separated tags, tag chips on the item list filter it |
| lent out | works: Lent out page → pick item, borrower, dates → "Returned" | works: Lent out page → item, "To whom", since → "Got it back"; also in the edit dialog; borrower shown on the item card |
| printable list | works: Print → all rooms or one room, with photos, subtotals, grand total | works: "Print all rooms" / "Print list" per room open the print dialog; per-room pages + summary |
| export | works: JSON backup (with photos), CSV per room or all, restore | works: JSON backup (with photos), CSV, restore, currency setting |

## Bugs and rough edges

R3 (9-agent team):
- "0 boxs" on every room card (plural).
- The bottom bar holds 7 tabs and is 508 px wide at 390: it scrolls sideways, "Print" is cut and "Data" (where
  export is) is off screen until you scroll the bar.
- Lending happens only on the Lent out page, not from the item; its item picker is a list with nothing selected, so
  "Lend item" without tapping an item first answers "Choose an item to lend".
- The print preview's table is wider than the phone (Warranty and Price cut off; it scrolls). Printing is unaffected.
- One 404 in the console on every load (a missing static file; nothing visible breaks).

R6 (one Opus):
- "Lend" with "To whom" empty does nothing and says nothing.
- The top bar's 5 tabs are 421 px wide: "Export" sits half off screen until you scroll the bar.
- Extras the prompt did not ask for: quantity, currency, bulk select, example data.

## Reading

On this prompt the 9-agent team and the single Opus agent shipped the same feature coverage, 11 of 11 each. R6 is a
little more polished (bulk move, lending from the item, every tab nearly fits, no console error); R3 has more
small defects (plural, 7-tab bar, 404, print preview width). Neither has a blocking bug.
