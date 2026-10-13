# R4 vs R7: does each "Café website" build actually do what the prompt asked?

Same prompt, two builds: **R4** = a 10-agent team (eyal/real-cafe-site), **R7** = one Opus agent
(eyal/real-cafe-site-solo). Both private; opened with the owner's run pass. Checked by qb9 in headless Chromium as a
phone (390 x 844, touch, trusted taps), a fresh profile per app, by doing each thing. Nothing in either app was
changed; test edits stayed in the test browser's storage (drafts, cart, stamps). No model runs. The owner PIN and
staff code came from each project's own README, as an owner would have them.

The prompt: "A website for a small neighbourhood café. Home page with hours and a map link; a menu with categories,
photos, prices and allergens; filters for vegan and gluten-free; a cart that turns a pickup order into a WhatsApp
message to the café; specials of the day; an events page; a gallery; an about page; a stamp card for regulars kept
on their phone; an edit mode behind a PIN where the owner changes the menu, prices, specials, hours and events on
this device and exports them as a file to publish; English and Portuguese; and a print-friendly menu."
That is 12 features.

## Counts

| | works | partial | missing |
|---|---|---|---|
| R4 (10 agents) | 10 | 2 | 0 |
| R7 (one Opus) | (pending: R7 not settled yet) | | |

## R4 (10 agents), feature by feature (checked 2026-10-13, ~07:00 UTC)

| feature | R4 |
|---|---|
| home: hours + map link | works: open/closed now, the week's hours with today marked, Google Maps link, call / WhatsApp / email links |
| menu: categories, photos, prices, allergens | works: 6 categories with a jump bar, 26 items, every photo loads, prices, allergen labels |
| vegan / gluten-free filters | works: both, and combined; but the specials card ignores them (a ham-and-cheese toastie special stays visible under Vegan) |
| cart to WhatsApp pickup order | works: add, +/-, total, name, pickup time limited to opening hours; opens wa.me with one line per item and the total, then offers to clear the cart |
| specials of the day | works: on the home page and the menu; the owner sets weekly days or one date |
| events page | works: 4 upcoming, "Add to calendar", "Ask about this event" |
| gallery | works: 8 photos, tap opens a viewer |
| about page | **partial**: the story and contact list are there, but the address reads "[object Object]" |
| stamp card on the phone | works: a staff code is asked in a dialog (wrong code refused), 10-minute wait between stamps, survives a reload; redeeming needs 10 stamps (not reached) |
| edit mode behind a PIN, export to publish | **partial**: the PIN gate works (wrong PIN refused); hours, prices, specials and events save as a draft and show on this device's pages; but **Export site.json never downloads**: the page throws `cafe.name?.trim is not a function`, with or without edits, so the owner cannot publish anything |
| English and Portuguese | works on every page, including the print menu, dates and € format |
| print-friendly menu | works: print.html, allergen key, A4 hint, both languages |

R4 bugs and rough edges:
- **Export is broken** (above). Cause, read from the served code: site.json keeps the café's name and address in
  both languages (`{en, pt}`), while the admin's check calls `.trim()` on them as strings. The same mismatch prints
  "[object Object]" on the About page. Two parts written by different agents disagree on one data shape.
- The specials card is not filtered by Vegan / Gluten-free.
- `manifest.webmanifest` is missing (404 on every page), so "Add to home screen" for the stamp card gets no app manifest.
- README.md is served on the live site and lists the owner PIN and the staff code (the README itself calls the PIN a soft gate).
- Portuguese names the stamp card two ways: "Cartão de selos" (nav) and "Cartão de carimbos" (page).

## R7 (one Opus)

(pending: waiting for qb6 to say R7 has settled)
