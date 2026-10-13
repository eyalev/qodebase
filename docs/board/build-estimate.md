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
  - "About the same quality as a team in the lab." for one agent;
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
2. `suggestBuild(job)` returns `{ preset, why }`. Show it as "<Preset>: <why>". The board comes with the preset
   (R0, 2026-10-12): `board: true` in Balanced and Cheapest, none in Fastest; its effect with a planner handing out
   tasks is not measured (the lab measured it with self-picking agents), and the estimate's notes say so.
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
- **balanced** otherwise (the board is on in both team presets since R0; its effect with a planner is not measured, and the estimate's notes say so).

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

R2 (eyal/real-tip-splitter, 2026-10-12): a curated small idea with 3 pieces on the default Build (one Opus agent).
The page showed 50-120 s and $0.21-0.28. It took 149 s and cost $0.81 (Ledger, at lab rates). The one-agent
floor's mid is now 150 s, taken from this build (90 s was a placeholder), so one agent on a small job shows
1.5-4 min. Cost came in about 3x the estimate and is not refit yet: the lab's one-agent cafe-family run cost $0.39,
and the token split will show whether a fixed per-session cost or more work made the difference (asked qb6). The
cost refit waits for R2-R5.

## Refit on four real builds (R2-R5, 2026-10-13)

What the four builds cost and how long they took, by model, at lab rates: FINDINGS2 section 11, from the per-model
Ledger rows. Haiku prompts over 100k tokens are priced at 5x, and box costs are left out because the estimate is
API cost. `REAL_FIT` in predict.js sits on top of the lab-calibrated sim, and each term is named:

| term | value | from |
|---|---|---|
| one Opus agent's fixed cost per build | +$0.57 | R2: $0.81 real vs $0.24 sim. 3x the output and the cache reads of the lab's one-agent cafe run (the push and landing turns), plus Claude Code's start-up context written to a 1-hour cache |
| each Haiku team agent's own session | +$0.14 per agent | R3 ($2.40 - $1.2) / 9 agents = $0.13; R4 ($3.45 - $2.0) / 10 = $0.145 |
| long contexts at many agents | per-agent x1 at 10 agents, rising to x2.7 at 40 | R5: ($17.3 - $2.0) / 40 = $0.38; long-context Haiku calls were $8.16 of it |
| team time | sim x1.8 at 10 agents, rising to x2.3 at 40 | R3, R4 1.8x; R5 2.3x (as much time waiting for a reviewer as working) |
| agents opened | low end: the planner's bundling; high end: min(coders, pieces) | the router is now told how many agents it has; R5 used 40 of 40, R3 9 of 12, R4 10 of 20 |

The ranges are widened: the low end takes 40% of the fitted extra and the high end is x1.25. Each estimate adds the
note "Fitted to N real builds like this (M in all) on top of 25 lab runs" and carries `realBuilds`. With 20 or more
Haiku agents it also says that contexts grow past 100k tokens and that agents wait for reviewers.

Every real build falls inside its refit range: R2 1.5-4 min, $0.52-1.2 (149 s, $0.81); R3 12-33 min, $1.6-4.4
(1,940 s, $2.40); R4 20-55 min, $3.2-9.2 (1,762 s, $3.45); R5 23-63 min, $3.2-22.6 (2,257 s, $17.3). The R5 range
is wide because how many agents the router opens is still the largest unknown.

`suggestBuild` still compares the presets on the lab-only estimate (`predictBuild(job, v, { real: false })`). The
lab ran one agent and teams on the same jobs. The real builds are one small one-agent build and three teams, so
fitting only one side would tilt the choice: with the fit on both, one agent comes out about as cheap as a team and
3-4x faster at every size, but that rests on no real one-agent build bigger than 3 pieces. A real one-agent build of
a Large idea would settle it.

**R6 (2026-10-13) settled it.** R3's Large prompt was run on Fastest (one Opus agent): 457 s and $3.87, against R3's
team at 1,940 s and $2.40. The team was cheaper (0.62x) and 4x slower, as in the lab. The one agent built 7 files and
~1,340 lines, the team 22 files and ~4,140 lines; quality was not measured. The one-agent fit is now the line through
R2 and R6: real cost = 2.14 x sim + $0.30, time = 2.4 x sim (R2 sits on the 150 s floor). R6 falls in its range
(4-12 min, $2.2-4.9), and so do the other four. `suggestBuild` now compares on the real-fitted estimates and makes the
same picks as on lab-only ones: Fastest for Small and Medium, Balanced for Large and Huge. Its words no longer say
"in the lab". Sonnet and Opus crews have no real build: their per-agent extra ($0.57 Opus, half that for Sonnet) is a
guess.


## jobType(job, suggestion): the adaptive orchestrator's label (2026-10-12, qb7's contract)

`jobType(job, suggestion?)` in `public/lab/predict.js` returns
`{type, label, strategy, why, preset, board?, better?, evidence, from}`. The page shows
"Looks like: <label>. Strategy: <strategy> (<why>)."
- `strategy` is always what the builder runs: the preset `suggestBuild` picked, in words.
- `better` is a measured strategy the builder does not run yet. It is never shown as a promise.

| type | when | label | strategy (builder) | better (measured, not built) |
|---|---|---|---|---|
| small-app | 1-11 pieces | a new small app | one strong agent | |
| shared-list | 12+ pieces, high overlap | an app whose pieces overlap | team with the board on | |
| app | 12-29 pieces | a mid-size app | the preset's team | |
| big-app | 30+ pieces | a big app | the preset's team (up to 12 coders) | dependency-aware lanes + per-lane controller (L1-L2) |
| port | `job.kind === 'port'` only | a port of existing code | the preset (one agent at small sizes) | owned line ranges, land at once, check behind (BUN3) |
| sweep | `job.kind === 'sweep'` only | one change across many files | the preset | |

Port and sweep come only from `job.kind`, never guessed from words. qb6 can add `"kind": "build"|"port"|"sweep"` to
the suggest/idea JSON.

**Large on one agent (2026-10-13).** The rule (Eyal via the manager) is the best experience at every size: time to a working app first, then quality, then cost. qb9 checked R3 and R6
feature by feature (docs/board/R3-R6-quality.md): both built 11 of 11 features. `suggestBuild` now picks Fastest for
Small, Medium and Large. For Large the words are "One strong agent: about 4x faster in our real builds, same features;
a team costs about N% less (Balanced)". N comes from the job's own estimate: 40% for a mid-Large job; the R3/R6 pair
gave 38%. Huge stays Balanced, because no one-agent build that big has run. The Cheapest branch (easy, separate
pieces) now applies only to Huge. Large chip: 6-17 min, $3.0-6.7.
Huge's words now give "as in our real builds at this size" first and the cost second.
