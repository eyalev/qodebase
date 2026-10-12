# Design pass: the judge-facing surfaces (qb3, 2026-10-12)

Brief from s1007-1655: lift the UI/UX of what judges see, phone first (390 px), with Mobbin
references and the design skills. Redesign allowed (Eyal, via the manager, 2026-10-12), on branch
`qodebase-redesign`; merge only after Eyal tries it and says yes, by Oct 14 12:00 UTC (qb6 deploys).

Recorded as design-log effort `forq-20261012` (`design-log show forq-20261012`).

## How this was made

- **Live captures** at 390 px (phone emulation), light: home signed out, `/p/eyal/corner-cafe`
  idle, **one live Watch a run** (frames at 4, 15, 30, 50, 75, 110, 150 s), a change record
  (`#/change/eyal.corner-cafe--d5cy5e`, landed after a replay), `/lab`, `/sim/` before Play.
  Frames: `claude3/dp/shots/` (local, gitignored), scripts `claude3/dp/shoot.mjs`, `watch.mjs`.
- **Mobbin:** 8 searches, all `standard` mode or sections/flows, so 0 AI credits. 16 screens kept
  (14 used, 2 rejected with reasons), all logged with `design-log ref`.
- **Critique by a separate agent** (impeccable critique, a fixed rubric of hierarchy / clarity for
  a non-programmer / density at 390 / state design / DESIGN.md consistency). The same rubric
  scores the redesign afterwards, again by a separate agent.
- Evidence rule (Mobbin's redesign-screen skill): a pattern seen in **2 or more products** is
  *precedent*, in 1 it is an *example*; otherwise it is labelled opinion.

## Before scores (separate critique agent, 1-10)

| surface | hierarchy | clarity | density | states | DESIGN.md | overall |
|---|---|---|---|---|---|---|
| Home (signed out) | 5 | 6 | 6 | n/a | 7 | **6** |
| Agents at work, idle | 5 | 6 | 5 | 6 | 6 | **5.5** |
| Agents at work, live run | 6 | 6 | 4 | 7 | 6 | **6** |
| Change record | 8 | 8 | 7 | 7 | 7 | **7.5** |
| /lab | 4 | 4 | 3 | 6 | 6 | **4.5** |
| /sim before Play | 4 | 4 | 5 | 2 | 4 | **4** |
| **all** | | | | | | **5.6** |

The change record is already good (a clear story, the 5-step bar, the "Landed after a replay"
callout). Everywhere else **the original idea, a collision replayed instead of bounced, is buried
under routine noise**: "auto-approved (scripted)" / "joined the line" rows, nine legend marks,
ten dotted gloss terms, empty sim panels. That is the single theme of this pass: **make the
replay the loudest thing on every surface, and fold everything routine.**

## Ranked proposal

Effort: S = under 2 h, M = half a day, L = a day or more. Ship: **pre** = safe before
Oct 14 12:00 UTC (small, tokens/copy/one render function, no layout rewrite), **branch** = part
of the redesign on `qodebase-redesign` (Eyal tries it first), **after** = a rethink for after the
contest.

| # | change | surface | why (what a judge sees today) | Mobbin reference | effort | risk | ship |
|---|---|---|---|---|---|---|---|
| 1 | **Sim opens with a result, not dashes**: autoplay at 1 min/s on load (or show a finished example run with "Run it yourself"); the site header on the page; Play at the top of the controls | /sim | three screens of "–", an empty chart and a 400-square grey grid before Play; Play is below 11 chips; no site header, so the page is a dead end (critique: 2 blockers) | precedent: [Klaviyo](https://mobbin.com/screens/7428b876-62c2-4580-8a13-ca01cad6d684), [Railway](https://mobbin.com/screens/673d6c97-6841-4892-a14d-673019b53912) (empty dashboards show a ghost of the chart plus one action) | S | low (qb4 owns public/sim) | **pre** |
| 2 | **Live run scoreboard** at the top of Agents at work (mock 1): elapsed of about-total + a progress bar, one headline, a 5-cell stage strip (working / review / in line / landed / replayed, zeros dimmed), the latest *headline* event in one sentence, "How this works" instead of the paragraph of dotted terms. Idle: the same card says what the last run did ("14 landed, 6 replayed instead of rejected") with Watch a run as the one accent button | Agents at work | at t=4 s it says "Starting a run…" and "No agents are working" at once; no sense of how long a run lasts; idle headline is a negative over 3 lines; 10 dotted gloss terms in the first screen; "0 replayed" in accent green | precedent: [Swiggy](https://mobbin.com/screens/c238691c-c126-4e47-a56a-4cc0ec678093), [Glovo](https://mobbin.com/screens/688974b6-cb57-483b-b75f-e3b5606b7f7e) (time left + one bar + one sentence); [talabat](https://mobbin.com/screens/0efd243b-bc0b-4487-abf5-f5ba11334d8b), [Replit](https://mobbin.com/screens/edd409e4-4889-471b-90b6-cdb8bf61b432) (stage strip) | M | medium (work.js header; qb7's file) | **branch**; the contradiction fix + dim zeros + positive idle headline are **pre** (S) |
| 3 | **Feed = Right now + headlines + one folded row** (mock 2): "Right now" lists each active agent once with its state; "What just happened" shows only collisions/replays (warn bar + collided → replayed → tested → landed tags), trains that landed, and send-backs; approvals and joins fold into "11 routine steps" | Agents at work | the feed is three rows per agent of "auto-approved (scripted)", "joined the line", "sent it for review", all "just now"; the replays (the originality claim) are invisible in it | precedent: [Devin](https://mobbin.com/screens/8cf78f5a-a3eb-44b5-991a-772b2d1e8e2e) (events as headlines with coloured impact dots), [Perplexity](https://mobbin.com/screens/b102c0f7-33cc-462b-a53a-4999064b8a67) (routine steps as one-line rows), [Grab](https://mobbin.com/screens/2fd1cc96-aa61-42e0-bfd2-5d19cddf5178) (Ongoing above Recent) | M | medium (feed() in work.js) | **branch** |
| 4 | **Lab findings as one compare card per job** (mock 3): One agent / Several columns, the winner cell in accent with a dot, one verdict line; "not comparable" as one muted row, not two cells | /lab | a 4-column table at 390 px wraps cells to 5-6 lines ("One agent, +1 hidden test; several agents failed the strict type check") | precedent: [Cash App](https://mobbin.com/screens/4d260ea2-b691-4506-9d78-631a4d266070), [Lifesum](https://mobbin.com/screens/43d1ac57-cca2-4939-ba2e-bb0d4d6c3fbb) (compare card, winner column marked); rejected [Public](https://mobbin.com/screens/e9b83911-f8a1-4d86-9b43-e84acdfc096f) (sideways-scrolling columns hide the comparison) | S | low (lab.js render) | **pre** |
| 5 | **Lab story order (a product call, not design):** the first finding a judge reads is "one Opus agent alone was faster" on 2 of 4 jobs; the board results that support multi-agent work (-46 %, -40 % time, ✓) are a screen further down. Proposal: lead with the board result, then the one-agent comparison as honest context | /lab | the page's top message undercuts the pitch above the part that supports it | opinion (critique agent + me) | S | low to do, **needs the manager/Eyal** | decide first |
| 6 | **One primary per screen:** on project pages the header's Build becomes a chip; on the home page Watch a run becomes a real accent button in the hero and Build it a chip for signed-out visitors; the h1 sits above the demo card | home, project pages | two accent buttons in the first viewport (header Build + Watch a run); on home the demo card's green heading outranks the h1 and has no button | precedent: [Retool hero](https://mobbin.com/sites/sections/a36624ad-20ad-4f83-92e4-367c1a0cc7b7) (primary + "Watch demo 4 min"), [Retool](https://mobbin.com/sites/sections/dcbd55be-58cb-4e0e-9b70-cb4d184fa30a) (headline, then the real product under it) | S | low (v3.ts home + header) | **pre** |
| 7 | **The line as rows on cards:** queued changes in `--card` tiles with a hairline (not `--fg` slabs), task names wrap to 2 lines, the "main lands here" stop compact ("main") | Agents at work | black tiles are the heaviest object on the page and cut names to "Add an Openin…" | opinion + DESIGN.md (one accent, calm) | S | low (work.css) | **pre** |
| 8 | **Legend only for what is on screen**, under the map, not 9 marks before any data | Agents at work | 9 legend marks take ~200 px before the map | opinion | S-M | low | branch |
| 9 | **DESIGN.md fixes in landing UI:** area names ("top-level files", "src/pages") in Geist, mono only for real file paths; cards 14 px radius (landing CSS uses 12); the replay callout and lab sticky bar on tokens (`--card` + hairline, not tinted fills or `--fg` slabs) | all | monospace labels and off-token fills are on the forbidden list | DESIGN.md | S | low | **pre** |
| 10 | **Change record:** a `--warn` tick on the 5-step bar where the collision and replay happened; one time format (all relative, or durations "+4 s") | change record | the bar is all green, so the replay (the point of the page) does not show on it; "started 1 h ago" next to "14:33" | precedent: [Browserbase](https://mobbin.com/screens/b5e81a85-c4ac-4fae-8ee3-ef1f8ad5652b) (marks along the run), [talabat](https://mobbin.com/screens/0efd243b-bc0b-4487-abf5-f5ba11334d8b) (stepper) | S | low | **pre** |
| 11 | **Copy:** "approved (scripted)" said once in the run banner, not on every row; "Waiting for the owner … its lead is on it" → "Needs you: the agent that started it is redoing it" + what to tap; "Everything"/"All" → "All 14 changes"; home "OpenClaw, Hermes, T3 Code" in plain words | all | jargon and repetition | opinion | S | low | **pre** |
| 12 | **Chrome:** the header's Explore underline shows as active on project pages (wrong); bottom tab "Agents at work" → "Agents" with an accent active state; header + crumb + tab bar take ~190 of 844 px | project pages | wrong active state, a wide label, little room for content | opinion | S | low | **pre** (the label/active), after (chrome height) |

### After the contest (a rethink, not for this week)

- **One run page**: Agents at work and the change record become one timeline you can scrub
  (Browserbase's tick strip across the run, tap a tick to open that change), instead of an
  overview plus hash-route drill-downs.
- **One evidence page**: the lab and the sim under the site shell, with the same chart and
  legend language; today they look like two other products.
- **The map** ("Where they work") redone as a codebase strip with agents as markers, once the
  legend is gone; it is the least readable block at 390 px.

## Mockups (390 px, light + dark, DESIGN.md tokens only, not deployed)

Source: `docs/contest/design-pass/mockups.html` (open it in a browser; three phone frames).
Captures (local): `claude3/dp/mocks-light.png`, `claude3/dp/mocks-dark.png`.

1. **Live run scoreboard** (item 2): Live dot, "0:47 of about 2:00", bar, "6 agents are changing
   corner-cafe at once", stage strip (2 working, 1 review, 2 in line, **1 landed** outlined in
   accent, 0 replayed dimmed), the latest headline ("Agent 1 and Agent 3 both changed `site.js`.
   Agent 3's change is being redone on the newest code."), How this works; the line below as
   hairline cards.
2. **Feed** (item 3): Right now (3 agents, one row each), then three headline cards: *Collision,
   replayed* (warn bar, tags collided / replayed / tested / landed), *4 changes landed together*,
   *Sent back*, then "11 routine steps" folded.
3. **Lab compare cards** (item 4): bakery, padel, café; the winner cell in accent with a dot, a
   verdict line per job, "Not comparable: a person stepped in" as one muted row.

## DESIGN.md changes the redesign needs

- **Freshbar rule:** exempt live feeds measured in seconds ("just now", "22 s ago"); a freshbar
  with a 14-day horizon is full for every row there. (Also: the house rule changed on 2026-10-08,
  freshbars are no longer a default for new work.)
- **New patterns:** *live run card* (elapsed of total, bar, headline, stage strip, latest headline
  event) and *headline event* (3 px left bar: `--warn` for collided/sent back, `--acc` for landed;
  step tags in 4 px radius tags).
- **Gloss terms:** underline a glossed term once per screen, at most two per screen.

## Plan and ownership

- **Today:** this proposal + mockups; manager/Eyal pick items and answer item 5.
- **Pre-contest items** (S, marked **pre**): whoever owns the file implements them on main via
  qb6's deploy: qb4 for /sim (1), qb7 for src/landingui (2-part, 7, 9, 10, 11), and v3.ts for home
  and the header (6, 12). I can take any of them if the owner prefers.
- **Branch redesign** (items 2, 3, 4, 6, 8 together, plus the pre items, on `qodebase-redesign`):
  home, Agents at work, change record, lab, by **Oct 13 18:00 UTC**; a preview link for Eyal's
  phone (qb6 versions upload or a capp link), after-score by a separate critique agent with the
  same rubric, then merge via qb6 only after Eyal's OK, by Oct 14 12:00 UTC.
- **File overlap with qb7:** `src/landingui/work.js`, `work.css`, `lab.js`, `lab.css` are qb7's.
  On the branch I will edit them only after agreeing with qb7 which parts (proposal: I take the
  scoreboard, feed and lab findings; qb7 keeps the Adjust section and the rest), and rebase on
  main often so the branch stays mergeable.
