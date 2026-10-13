# R4 vs R7: does each "Café website" build actually do what the prompt asked?

Same prompt, two builds: **R4** = a 10-agent team (eyal/real-cafe-site; 8 HTML pages, ~5,940 lines), **R7** = one
Opus agent (eyal/real-cafe-site-solo; one page with hash routes, ~2,320 lines). Both private; opened with the owner's run pass. Checked by qb9 in headless Chromium as a
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
| R7 (one Opus) | 12 | 0 | 0 |

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

## R7 (one Opus), feature by feature (checked 2026-10-13, ~07:15 UTC)

| feature | R7 |
|---|---|
| home: hours + map link | works: open now / until, week table, Open in Maps, WhatsApp / phone / email, next event |
| menu: categories, photos, prices, allergens | works: 4 categories as filter chips, 19 items, every photo loads, prices, allergens named on every item ("No major allergens" too), a menu search |
| vegan / gluten-free filters | works: both, combined, and they apply to the specials too |
| cart to WhatsApp pickup order | works: add, +/-, line totals, total, name and pickup time required; opens wa.me with a greeting, one line per item, total, name, pickup time; the cart survives a reload |
| specials of the day | works: today's special on home and menu; the owner sets weekdays or one date |
| events page | works: 4 upcoming with date tiles, "Add to calendar" |
| gallery | works: 6 photos, tap opens a viewer |
| about page | works: story, hours, address, map link |
| stamp card on the phone | works: staff code entered on the card (wrong code refused), filled to 10, reward shown, "Redeem reward" with the code resets the card, survives a reload |
| edit mode behind a PIN, export to publish | works: PIN gate (wrong PIN refused); price, hours, a new special and a new event all edited; they show on this device's pages; Publish → "Download data file" gives cafe-data.js with every edit in it |
| English and Portuguese | works on every view, the print menu included |
| print-friendly menu | works: a print view in two columns, V / SG badges, allergens per item, in the chosen language |

R7 bugs and rough edges:
- The pickup time is not checked against opening hours: an order for 03:00 goes to WhatsApp (R4 limits the time).
- Portuguese dates are capitalised English-style ("Sexta-Feira, 23 De Outubro").
- No cooldown between stamps (staff can add several at once by design, with a 1–4 stamp choice).
- `manifest.webmanifest` 404 on every load, as in R4.
- README.md is served on the live site with the default PIN and stamp code, as in R4 (both READMEs say the PIN is a soft gate).

## Reading

On this prompt the single Opus agent shipped all 12 features; the 10-agent team shipped 10 fully and 2 partly. The
team's two partial features share one cause: the data file stores the café's name and address in both languages,
and two parts written by other agents (the About page and the admin's export check) still treat them as plain text.
The result is the worse of the two failures in either app: R4's owner can edit but can never export, so nothing
they change can be published. R7 has only small defects (pickup time unchecked, date capitals). R4 is the bigger
site (8 pages, ~2.5x the code) and does a few things R7 does not (pickup time inside opening hours, a 10-minute
stamp cooldown, "Ask about this event"), but the prompt's features are fully there only in R7.
