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
- **Motion:** colour/background transitions 120 ms only. No entrance animation.
- **Touch:** targets ≥ 44 px; inputs 16 px (no iOS zoom); no sticky hover
  (`@media (hover:hover)` for hover styles); `-webkit-tap-highlight-color: transparent`.

## Patterns

- **Project row:** `owner / name` (name in 600), one-line description, then a
  meta line of separate items (freshbar for last update, forks count,
  "forked from …") with 12 px gaps — never `A · B · C` strings.
- **Dates:** every date in a list gets a freshbar (draining tag, house default,
  `src/fresh.ts`), horizon 14 days; legend + popover on the page.
- **Agent card:** status dot (grey asleep, accent idle, `--busy` working), the
  task, the agent's last note, then actions: Preview, Chat, Merge.
- **Primary action** per screen is one accent button; everything else is a
  chip button or a text link.

## Forbidden here

The house list: Inter/Roboto/system fonts for UI, purple gradients, centred
hero with three cards, nested cards, ALL-CAPS eyebrows, `→` on links, one
radius on everything, fade-up sections, cream backgrounds, numbered section
labels, monospace labels, pill buttons.
