# forq design

Phone first: every screen is designed at 390 px, one thumb, then widened.
Calm, dense and factual. Reference: Luma's list rows; GitHub's information,
none of its chrome.

## Tokens

| token | light | dark | use |
|---|---|---|---|
| `--bg` | `#ffffff` | `#0f1112` | page |
| `--card` | `#f6f7f8` | `#171a1c` | rows, cards, inputs |
| `--chip` | `#eceef1` | `#202427` | tags, secondary buttons |
| `--line` | `#e2e5e9` | `#272b2f` | hairlines |
| `--fg` | `#15171a` | `#e8eaec` | text |
| `--dim` | `#5f6670` | `#9ba2a9` | secondary text |
| `--acc` | `#17695a` | `#4fbf9f` | one accent: primary buttons, links, live dots |
| `--acc-fg` | `#ffffff` | `#0f1112` | text on accent |
| `--busy` | `#b7791f` | `#e0a948` | an agent that is working |

- **Type:** Instrument Sans (UI, 400/500/600) + JetBrains Mono (file names,
  commit hashes, code only; never labels). Body 16 px, rows 15 px, meta 13 px,
  title 24 px. Numbers `tabular-nums`.
- **Spacing:** 4, 8, 12, 16, 24, 32. Page gutter 16 px.
- **Radius:** cards and the app preview 12 px; buttons and inputs 8 px; tags
  4 px. Never pill-shaped.
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
