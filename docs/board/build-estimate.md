# Build settings: the estimate (B1) and the prompt analysis (B4)

qb4, 2026-10-12. Code: `public/lab/predict.js` (served at `/lab/predict.js`; no dependencies beyond
`./score.js` and `./estimate-cal.js`; about 60 ms per call in node).

## B1: `predictBuild(job, variant)`

```js
import { predictBuild, suggestBuild, BUILD_PRESETS, SMALL_APP } from '/lab/predict.js';
predictBuild(SMALL_APP, BUILD_PRESETS.balanced.variant)
// { wallS: [300, 780], apiUsd: [0.68, 0.92], basedOn: 25, sameSetup: 7,
//   quality: "The lab's middle setting.", notes: ['3 reviewers: more reviewers, fewer misses, a little slower.'],
//   simVersion: 'lab-0.11', job: { tasks: 8, overlap: 0.5, difficulty: 1, label: 'a small app' } }
```

- **`job`**:
  - `tasks`: 1–80 pieces of work;
  - `overlap`: `'low' | 'some' | 'high'` or 0–1;
  - `difficulty`: `'easy' | 'normal' | 'hard'`;
  - `label`: optional.

  With no prompt analysis yet, use `SMALL_APP` (8 tasks, some overlap, normal, "a small app").
- **`variant`**: the lab knobs. They are `planner`, `coders`, `coderModel`, `reviewers`, `reviewerModel`,
  `board`, `policy` and `trainMax`, or `{ baseline: 'opus-alone' }` for one agent. Missing knobs take the
  lab defaults.
- **Ranges**: the model's median times real/predicted at p10 and p90, over every finished lab run
  (`basedOn`: 25 now).
  - Time: 0.59–1.59×. Wall time is the shaky part.
  - Cost: 0.86–1.17×.
  - Lab-only GitHub-policy runs are left out: their time was off by about 3×.
  - Rounding: 10 s steps under 2 min, then whole minutes; cents under $1, then $0.1.
- **`sameSetup`**: how many of those runs used exactly this setup. Say "based on N real runs" with
  `basedOn`. When `sameSetup` is 0, say the setup itself was not run in the lab.
- **`quality`**: a direction only, never a number:
  - "Fewest misses in the lab." for one agent;
  - "The lab's middle setting." for Balanced;
  - otherwise "Fewer misses / About like / More misses than Balanced" (the sim, ±2 points).

  `notes` adds what the lab saw for the reviewers, planner and board knobs.
- **`BUILD_PRESETS`**: `fastest`, `balanced` and `cheapest`, each `{ label, variant, why }`. All three were
  run for real (sameSetup 7, 7, 1).
- **Recalibrate after new runs:** `node sim/lab/estimate-cal.mjs` rewrites `public/lab/estimate-cal.js`.
  Commit it, then deploy.

## B4: "Suggest settings for my prompt"

The Haiku call reads only the prompt and returns the **job**. The preset is picked in code by
`suggestBuild(job)` from the estimates (house rule: the model gives facts, code gives the verdict).

The Haiku call returns exactly this JSON (no prose). Use temperature 0 and about 200 output tokens:

```json
{
  "v": 1,
  "tasks": 14,
  "overlap": "some",
  "difficulty": "normal",
  "vague": false,
  "summary": "A bakery site: menu, cart, checkout, order admin and emails.",
  "confidence": 0.7
}
```

| field | meaning | how to judge it |
|---|---|---|
| `tasks` | pieces of work a careful planner would split this into, at the grain of "one page / one feature / one module" | integer 1–80; a one-page tweak is 1–3, a small app 6–10, a full site 20–30 |
| `overlap` | how much the pieces touch the same files or repeat each other | `low`: separate modules; `some`: a shared layout, index or nav; `high`: many pieces edit the same few files, or the prompt lists near-duplicates |
| `difficulty` | how hard each piece is for a model | `easy`: copy, styling, CRUD; `normal`; `hard`: algorithms, auth, payments, concurrency, migrations |
| `vague` | true if the prompt leaves key requirements to guesswork | the lab's Haiku planners missed requirements on vague prompts |
| `summary` | one plain sentence, shown under the suggestion | at most 120 characters |
| `confidence` | 0–1 | below 0.4: show the estimate but not the suggestion |

Then:
1. `const job = { tasks, overlap, difficulty, label: summary }`.
2. `suggestBuild(job)` returns `{ preset, why, board? }`. Show it as "<Preset>: <why>". Apply `board` on top
   of the preset when present.
3. `predictBuild(job, BUILD_PRESETS[preset].variant)` gives the estimate.

Bad or missing JSON, or a timeout (keep it short, 4 s): fall back to `SMALL_APP` and no suggestion.

`suggestBuild`'s rules:
- **fastest** when `tasks` ≤ 10, or when one agent costs at most 1.5× Balanced's high end;
- **cheapest** when the job is easy and has low overlap;
- **balanced** otherwise, with the board on when overlap is high.
