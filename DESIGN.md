# forq design

Phone first: every screen is designed at 390 px, one thumb, then widened.
Calm, dense and factual. Reference: Luma's list rows; GitHub's information,
none of its chrome.

## Tokens

| token | light | dark | use |
|---|---|---|---|
| `--bg` | `#f7f7fa` | `#0d0c12` | page: a cool gray one step below the cards |
| `--card` | `#ffffff` | `#16151e` | rows, cards, inputs (white on the gray page, with a `--line` hairline) |
| `--chip` | `#efeff4` | `#211f2b` | tags, secondary buttons |
| `--line` | `#e4e4ec` | `#2a2836` | hairlines |
| `--frame` | `#d4d4de` | `#3b3849` | the edge of a framed app preview (a hairline that must read against `--chip`) |
| `--fg` | `#14121f` | `#eeedf3` | text |
| `--dim` | `#646177` | `#a3a0b3` | secondary text |
| `--acc` | `#6a2ff0` | `#a585ff` | one accent, used in many small places: primary buttons, links, the selected tab, live dots, focus |
| `--acc-fg` | `#ffffff` | `#120c24` | text on accent |
| `--acc-soft` | `#f0ebfe` | `#231b3d` | tinted wells: an icon square, a selected row, a quiet highlight (never a button) |
| `--busy` | `#94600f` | `#e0a948` | an agent that is working (light darkened from #b7791f with violet: amber text must pass 4.5:1 on the page, 2026-10-14) |
| `--warn` | `#c2321f` | `#f08a7e` | something needs a decision or went wrong: sent back, collided, with its lead, needs a fix (design v2; added 2026-10-07 because `--busy` already means "working") |

**Violet since 2026-10-14** (Eyal picked direction A of three, tried live on the app with `?theme=`; reference
aced.io's signed-in pages). Was teal `#17695a` / `#4fbf9f` on white. **Surface treatment** (src/look.ts): the page is
`--bg`, a step below white cards; cards, inputs and tiles carry a 1 px `--line` hairline (inset box-shadow, no drop
shadows); colour enters through the accent in small places and `--acc-soft` wells, never through big fills.

- **Type (2026-10-07, after Executor's look and feel):** Geist (UI, 400/500/600, headings −0.02em) + JetBrains Mono (file names,
  commit hashes, code only; never labels). Body 16 px, rows 15 px, meta 13 px,
  title 24 px. Numbers `tabular-nums`.
- **Spacing:** 4, 8, 12, 16, 24, 32. Page gutter 16 px.
- **Radius:** cards 14 px, the app preview 12 px, inputs 12 px, buttons 10 px; tags
  4 px. Site-wide layer: src/look.ts (sizes a step down, home h1 28 px). Never pill-shaped.
  One exception: the Talk voice bar's mic is a filled accent circle (Eyal, 2026-10-13: the bar blended into the page).
- **Motion:** colour/background transitions 120 ms; the agent sheet slides
  (transform + height, 220 ms ease) because it is a surface arriving, not
  decoration. No entrance animation on content.
- **Touch:** targets ≥ 44 px; inputs 16 px (no iOS zoom); no sticky hover
  (`@media (hover:hover)` for hover styles); `-webkit-tap-highlight-color: transparent`.

## Patterns

- **Project row:** `owner / name` (name in 600), one-line description, then a
  meta line of separate items (freshbar for last update, forks count,
  "forked from …") with 12 px gaps — never `A · B · C` strings.
- **Dates:** every date in a list gets a freshbar (draining tag, house default,
  `src/fresh.ts`), horizon 14 days; legend + popover on the page.
- **Agent card = input → output:** status dot + one-word state, then a small
  labelled list: "You asked" (the request that led to it), "Its task, from the
  router agent" (input), "Result" (the agent's report, or "Not yet"), then
  actions: Preview (the result running), Chat, Merge. Long fields clamp to 3
  lines; tap to expand.
- **Router agent panel:** your last request ("You …", 3 lines max), then a
  phase line with a ticking seconds counter (Sending → Waking up → Starting
  Claude Code → Working on it · N agents started), then its reply. Anything in
  progress shows the `--busy` dot and the page polls every 2 s instead of 5 s.
  A failed delivery says why and offers Retry. Never a silent button.
- **Review on the card:** a "Review" line after Result: Waiting for the
  reviewer / Reviewing now (ticking) / Approved (accent) / Changes suggested
  with the notes, then "Ask agent to fix". Merge stays available; after a
  "changes" verdict it reads "Merge anyway". A Reviewer agent row sits under
  the router agent panel (state + Chat/Terminal).
- **Agent states, one word:** starting (until its task has gone in), working,
  waiting for you, pushed, blocked, asleep, merged. Never "idle" for a box that
  has not started its task.
- **Preview tabs:** above the app, `Live` (main) + one tab per open agent
  fork; the selected tab is filled `--fg`. "Open in new tab" opens whichever is
  showing. A card's Preview switches the inline view, never navigates.
- **Agent sheet:** Chat | Terminal for any agent or the router agent, sliding
  up over the project page (72 dvh by default; drag the handle to any height,
  remembered per viewer; tap it for full/half; drag to the bottom or × closes).
  Chat = web bubbles (you in accent, the agent plain, tool steps folded into one
  tappable "N steps" row); Terminal = mobile-agent in an iframe, loaded only
  when chosen. Nothing about an agent navigates away from its project.
- **Primary action** per screen is one accent button; everything else is a
  chip button or a text link.

## Forbidden here

The house list: Inter/Roboto/system fonts for UI, purple gradients, centred
hero with three cards, nested cards, ALL-CAPS eyebrows, `→` on links, one
radius on everything, fade-up sections, cream backgrounds, numbered section
labels, monospace labels, pill buttons.
