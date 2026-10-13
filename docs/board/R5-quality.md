# R5: does the flagship "travel planner" build do what its prompt asked?

**R5** = eyal/real-course-builder (public; app https://real-course-builder--eyal.ttyview.dev/), built by 40 agents plus a
41st repair agent. Checked 2026-10-13 ~12:15 UTC by qb9 in headless Chromium as a phone (390 x 844, touch, trusted
taps and real touch drags), each feature done by hand: a new trip of my own, then the built-in sample trip ("Lisbon +
Porto") for the features that need data. Nothing in the app was changed; test data stayed in the test browser. No
model runs.

The prompt: "A travel planner and journal. Trips with dates and places; a day-by-day itinerary with drag to reorder;
bookings for flights, trains and hotels with confirmation numbers I type in; a budget in several currencies with rates
I enter; a packing list; a documents checklist; places to see with notes and a map link; a journal with photos per
day; a shared-cost splitter; a countdown; works offline; a printable itinerary; and a past-trips archive with stats."
That is 13 features.

## Count

| | works | partial | missing |
|---|---|---|---|
| R5 (40 + 1 agents) | 11 | 1 | 1 |

## Feature by feature

| feature | result |
|---|---|
| trips with dates and places | works: name, start, end, places; the trip opens on an overview of every section |
| day-by-day itinerary with drag to reorder | **partial**: one section per day; reordering works by touch drag, mouse drag and ↑/↓ buttons, and survives a reload; but the itinerary's own **"+ Add item" and "Edit" are broken**: the Day list holds only "Invalid Date (undefined)", Add saves nothing and shows no error, and Edit opens an empty "Add item" form. Items only get in through bookings ("Add to itinerary") and places to see ("Add to day") |
| bookings: flights, trains, hotels with confirmation numbers | works: each type has its own form, the confirmation number is shown with a Copy button, flights and hotels add themselves to the itinerary, all survive a reload |
| budget in several currencies with rates I enter | works: rates typed per currency ("nothing is fetched"), a converter, expenses in any currency converted to the base (£20 at 0.8 → $25.00), planned vs spent by category, a budget summary with daily pace |
| packing list | works: add with category and quantity, check off, "5 of 10 packed", templates |
| documents checklist | works: suggestions, expiry dates, "needs attention" when a document expires within 6 months of the trip |
| places to see with notes and a map link | works: name, address or coordinates, notes; Google Maps, Apple Maps and OpenStreetMap links; must-see / maybe, visited |
| journal with photos per day | works: a page per day with the day's plan, mood, entry text, photos (upload or take); entry and photo survive a reload |
| shared-cost splitter | **missing**: no screen for it. `js/core/settle.js` holds the splitting math (largest-remainder split in cents, per-currency), but nothing in the app calls it, and expenses have no "paid by" or "split between" fields |
| countdown | works: days, hours, minutes until departure on the Countdown page and the trip overview |
| works offline | works: a service worker controls the page; with the network cut, trips, itinerary and journal load, and an item added offline survives a reload |
| printable itinerary | works: a print view per trip, day by day, with times, places, booking confirmations and notes |
| past-trips archive with stats | works: archive by year with each trip's summary; stats for trips, days away, countries, places, total spent, longest trip, photos, journal words |

## Bugs and rough edges

- **Itinerary add/edit broken** (above). Cause, read from the served code: `js/features/itinerary.js` calls
  `TP.itineraryEditor.open({ tripId, day, item })` with one options object, while `js/features/itinerary-editor.js`
  defines `open(trip, date, item)`. The editor gets no trip and no date. Two agents' files disagree on one call, the
  same kind of seam as R4's export bug (docs/board/R4-R7-quality.md).
- **The shared-cost splitter was built as a library but never given a screen.**
- The overview's Countdown card links to `#/trip/<id>/countdown`, which answers "Page not found"; the working page is
  `#/countdown`.
- The section bar inside a trip has 13 links and is 581 px wide at 390: it scrolls sideways, so Budget summary, Print,
  Calendar export and Trip settings are off screen until you scroll it.
- The sample trip's flights show their times as "? → ?" in the bookings list (the sample data uses `departAt`/`arriveAt`,
  the list reads other names); flights entered through the form show their times correctly.
- The train form requires a train number but does not mark it (no asterisk); Save shows "Required" only afterwards.

## Reading

Eleven of thirteen features work fully, several with more than the prompt asked (three map providers, packing
templates, calendar export, budget pace, a converter). The two gaps are both seams: the itinerary's own editor and its
caller were written against different signatures, and the splitter's math was built but never wired to a screen.
Neither was caught by the repair agent.
