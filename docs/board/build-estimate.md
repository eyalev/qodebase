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
- **`agentTasks`**: how many agent tasks the planner makes from the pieces (Opus bundles ~0.37 of them, Haiku ~0.8, measured in stage 1). The router starts one agent per task, so a coders setting above `agentTasks` changes nothing: the coders knob is a cap. Example: a small app (8 pieces) with an Opus planner is ~3 agent tasks.
- **`sameSetup`**: how many of those runs used exactly this setup. Say "based on N real runs" with
  `basedOn`. When `sameSetup` is 0, say the setup itself was not run in the lab.
- **`quality`**: a direction only, never a number:
  - "Fewest misses in the lab." for one agent;
  - "The lab's middle setting." for Balanced;
  - otherwise "Fewer misses / About like / More misses than Balanced" (the sim, ±2 points).

  `notes` adds what the lab saw for the reviewers, planner and board knobs.
- **Monotonic in reviewers** (2026-10-12): each change is reviewed once, so going from 0 to 1 reviewer adds review
  time and cost once. After that more reviewers only shorten the wait for a free one: cost and quality never fall,
  and time never drops below the no-review time but can shrink from 1 to 3 reviewers. `quality` compares a
  one-coder setup with Fastest (never "better than Fastest") and a team with Balanced. It reads "Not measured in
  the lab." when no lab run had this coder model with the same review on/off. `qualityGuess` holds the sim's
  direction anyway. Pass `reviewerModel` explicitly, since the lab default is Sonnet (never measured, ~3x the
  cost of Haiku reviews).
- **`BUILD_PRESETS`**: `fastest`, `balanced` and `cheapest`, each `{ label, variant, why }`. Each `why` holds for any job size (checked at 3, 8, 25 and 60 tasks). All three were
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

**Stable across readings** (2026-10-12: the same bakery prompt was read as 20, 12, 20 and 20 pieces).
`suggestBuild` puts the piece count into log-scale buckets about 2.5× wide: 1–4, 5–11, 12–29 and 30+.
It decides, and writes its `why`, from the bucket's middle (3, 7, 18, 40), and returns that bucketed `job`
plus a `bucket` label ("12-29 pieces"). **Show the bucket label and estimate from the returned `job`**, so the
words, the job facts and the estimate all agree. A ±40% wobble mostly stays inside one bucket; only readings
on either side of 11/12 or 29/30 can still flip.

`suggestBuild`'s rules (on the bucket):
- **fastest** for the two small buckets, or when one agent costs at most 1.5× Balanced (midpoints);
- **cheapest** when the job is easy and has low overlap;
- **balanced** otherwise, with the board on when overlap is high.

## Start-up floor (2026-10-12, first real build)

First real data point: eyal/est-bar-test showed 70 s to 3 min and settled at 5:20. Two causes:
- **Wrong setup.** The build ran on code from before a810395, which ignored the page's setting: the page
  estimated Fastest (one agent) and the server ran a router that split the job between 2 Opus agents. For what
  ran, on a 2-piece job, the model says 90 s to 4 min. From a810395 on, a Build without Adjust is one Opus
  agent, so the shown estimate and the setup agree.
- **Fixed start-up time.** Of the 320 s, the router's split took 41 s and the agents pushed at 311 s; the queue's
  check and landing took 5-9 s. The lab's per-task fit scales start-up away on tiny jobs (one agent on 2 easy
  pieces: 20-40 s), which no real build can do.

So `predictBuild` takes the middle of the time range as at least `BUILD_FLOOR[shape].mid` and the low end as at least
`.low` (alone 50/90 s, team 170/320 s: the lab's quickest finished runs, 58 s alone and 172 s for a team, and the
real build), and adds the note "Mostly start-up time … measured on N real builds so far" when the floor applies.
Only tiny jobs change (a team on 2 pieces: 3 to 8 min; one agent: 50 s to 2 min); 8 pieces and up are as before.
`REAL_BUILDS` in predict.js lists each real build used. At 3+ finished builds, refit the floor from them
(Workers Logs: module `build`, events `started` and `build_settled`).
