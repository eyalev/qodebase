# R8b vs R3: the same "Home inventory" prompt, built again with today's team changes

**R8b** = eyal/real-home-inventory-r8b: R3's exact prompt, Balanced team (13 agents on the project), built with
2026-10-13's changes (skeleton first, Done-when lines, compaction). **R3** = eyal/real-home-inventory (9 Haiku coders +
Opus planner + 3 reviewers), checked in docs/board/R3-R6-quality.md: 11/11.

Same method as R3/R6: headless Chromium as a phone (390 x 844, touch, trusted taps), a fresh profile, each feature
done by hand (2 rooms, a box, an item with photo / price / purchase date / warranty date / 2 tags, then move, value per
room, warranty list, tag page, search, lend, print, both downloads). App untouched; test data stays in the test
browser. No model runs. Checked 2026-10-13 ~08:00 UTC.

## Counts

| | works | partial | missing |
|---|---|---|---|
| R8b (Balanced, today's changes) | 11 | 0 | 0 |
| R3 (Balanced, 9 coders) | 11 | 0 | 0 |

## Feature by feature

| feature | R8b | R3 (for comparison) |
|---|---|---|
| rooms | works: add (form folds away once a room exists), rename, delete refused while the room holds boxes or items | works |
| boxes | works: "Add box" in the room; the item form's Box list follows the chosen room | works |
| item with photo, price, date | works: take photo or choose file, price, purchase date, notes; photo shown on the item page | works |
| warranties expiring | works: Warranties page, 30 / 90 days / all, "Ends in 19 days"; also on the item page | works |
| search | works: one box in the header on every page; finds items, tags and borrowers in separate groups | works |
| move items | works: item → Move → room + box → "Move here" | works |
| value per room | works: home total, per room, per box, subtotals in print | works |
| tags | works: add / remove on the item, Tags page with counts, a tag page that renames or removes a tag everywhere | works |
| lent out | works: "Lend" on the item page (borrower, date, due, notes), Lent out page by borrower, "Mark returned", returned history | works, but only from the Lent out page |
| printable list | works: per room, photos optional, subtotals; there is no all-rooms print | works, also all rooms |
| export | works: JSON backup with photos, CSV (with "Lent to"), restore | works |

## Bugs and rough edges

R8b:
- No currency anywhere: prices and totals read "129.90".
- Dates are raw ISO ("2025-11-20", "Printed 2026-10-13"), in lists and in print.
- "1 items (1 priced)" on the print page (plural).
- The header search box keeps the last query ("zzz") on every page after you leave Search.
- Printing is per room only; R3 also prints all rooms in one document.
- One 404 in the console on every load, as in R3.

R3's defects (from R3-R6-quality.md) that R8b no longer has: the 7-tab bottom bar that hid Export at 390 px (R8b's
7 links wrap onto two lines and all show), "0 boxs", lending only from the Lent out page, and the print table wider
than the phone.

## Reading

Feature coverage is the same, 11/11 in both. R8b fixes R3's layout and flow defects (every nav link visible at
390 px, lend from the item, print fits the phone, rooms with contents cannot be deleted by accident, tag rename) and
adds its own small polish gaps: no currency sign, ISO dates, a sticky search box, no all-rooms print. Neither has a
blocking bug.
