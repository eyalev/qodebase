# E3: what a board would be worth, zero-token estimates (qb4, 2026-10-10)

Two estimates, no model calls. Code: `sim/board/hono-board.mjs`, `sim/board/backlog.mjs`.
JSONL: `~/.local/share/qbsim-bench/board.jsonl`.

## (a) Hono: could a board have shown the "needs an earlier PR" cases in advance?

Input: the Hono replay (`sim/hono/replay.mjs`, after the out-of-order fixes, 395cbb5): the last
500 changes on honojs/hono's main replayed in waves of W pull requests opened at once. A PR that
could not be written on its wave's starting main "needed an earlier PR of the wave". For each, the
needed change = the nearest earlier change touching the same files (files only, not symbols). A PR
"started" at min(PR created, first commit), from the GitHub API. **Visible** = the needed PR had
already started (so its intent and files were on the board) when the later PR started.

| PRs opened at once | PRs that needed an earlier change | visible on a board | not visible (needed PR started later) | needed a direct push (no PR) | median head start when visible |
|---|---|---|---|---|---|
| 10 | 56 | 39 (70%) | 3 (5%) | 14 (25%) | 23 h |
| 50 | 139 | 93 (67%) | 7 (5%) | 39 (28%) | 101 h |
| 100 | 167 | 110 (66%) | 10 (6%) | 47 (28%) | 162 h |

- **Two-thirds of the ordering cases were visible in advance**, usually by a day or more. A board
  that shows "someone is changing these files" would have let those PRs stack on, or wait for,
  the PR they needed instead of being bounced.
- Only ~5% needed a PR that started later: a board can't help those.
- About a quarter needed a **direct push** to main (no PR): release bumps, lockfile updates
  (`bun.lock` is the most common file), "Merge next". A board only helps there if pushes are
  announced too, i.e. if the hooks also run for maintainers who push directly.
- Caveat: matching is by files, so "visible" means a board would show an overlap, not that the
  later author would have recognised the dependency. Hono's history was serial; this asks what
  the same work would have shown if it had run concurrently.

## (b) A decentralized backlog: agents pick their own tasks, with vs without a board

Scripted sim (seeded virtual clock, 5 seeds each): a backlog of 6 tasks per agent with 15%
duplicates (the same work worded differently), 30% of tasks needing another to land first, and 4
hot shared files (35% of tasks touch one; git merges a hot file both sides changed 20% of the
time, others 50%). Work ~10 min per task. Every agent sees the backlog (with its dependencies)
and main. **With a board** it also sees others' posted intents and files: it skips a task someone
posted (or a duplicate of it, spotted 80% of the time), stacks on a need someone is working on,
and before landing waits for an earlier poster on the same files (10 min cap) and replays its change on top.

| agents | setup | finish | landed/h | built twice | conflicts | given back (need not landed) | wasted agent-h | waiting agent-h |
|---|---|---|---|---|---|---|---|---|
| 5 | no board | 1.4 h | 18.9 | 1.6 | 4.4 | 0.8 | 0.9 | 0 |
| 5 | board | 1.4 h | 18.4 | 0.4 | 3.2 | 0 | 0.4 | 0.5 |
| 20 | no board | 1.6 h | 66.5 | 5.8 | 31.2 | 1.2 | 4.2 | 0 |
| 20 | board | 1.6 h | 64.4 | 1.4 | 23.2 | 0.2 | 2.2 | 3.8 |
| 100 | no board | 1.9 h | 271 | 38.2 | 195 | 20.4 | 27.4 | 0 |
| 100 | board | 2.1 h | 244 | 15.2 | 137 | 3 | 14.7 | 33.8 |

Who posts, and how stale the board is (100 agents):

| setup | finish | built twice | conflicts | wasted agent-h | waiting agent-h |
|---|---|---|---|---|---|
| no board | 1.9 h | 38.2 | 195 | 27.4 | 0 |
| board, everyone posts, live | 2.1 h | 15.2 | 137 | 14.7 | 33.8 |
| board, 70% post | 2.1 h | 22.8 | 139 | 17.0 | 29.9 |
| board, 40% post | 2.3 h | 29.6 | 134 | 20.0 | 20.6 |
| board 30 s stale | 2.0 h | 16.4 | 140 | 14.7 | 36.2 |
| board 60 s stale (KV-like) | 2.1 h | 17.2 | 132 | 14.8 | 33.8 |

What it says:
- **A board cuts waste, not finish time.** Duplicates built twice fall 60-75%, given-back tasks
  ~85% and wasted agent time ~50% (27 -> 15 agent-h at 100 agents). Finish time does not improve
  and is ~10% worse at 100 agents, because agents now wait for each other (34 agent-h of waiting).
  It is a cost/sanity win (fewer duplicate PRs, less redo), not a speed win.
- **Posting has to be automatic.** At 70% posting most of the benefit holds; at 40% duplicates
  are back near no-board levels (30 vs 38). Hooks, not discipline, as the plan says.
- **Staleness up to 60 s barely matters** for tasks that take ~10 min: duplicates 15 -> 17,
  conflicts unchanged. A KV-like board (writes visible within 60 s) would do almost as well as a
  live one for picking work; the "check before landing" step is where freshness would matter
  most, and even there 60 s against a ~10-min task is small.
- **Conflicts on hot shared files remain** (137 at 100 agents): a board shows overlap but does
  not make two edits to one list merge. That is still the landing system's job (handlers, replay).
- Waiting needs a cap: without one, chains of "wait for the earlier one" circled forever in one
  seed. A real board should say "X started before you on these files", never block.

All numbers are a scripted model (assumptions above, in `DEFAULTS`), meant to rank effects, not
to predict a real run; E4 (real agents) is the measurement.

## (c) Checked against E4, and a prediction for the scale test (qb4, 2026-10-10)

Zero tokens. Code: `sim/board/calls.mjs` (`calibrate`, `scale`); output `sim/board/out/calls-*.json`.

**backlog.mjs (b) was off in one structural way.** Its no-board agents could not pick a task someone
else was already building: an invisible claim, a board for free. E4 shows they can: in A, the main
waste is two agents building the *same* task (7 wasted calls a run, ~4 of them in the first half of
the run, so not just the end game). So (b) understates what a board saves on waste. Its finish-time
result came from ordered landing waits (wait for the earlier poster), which E4's board does not
have: E4's board only changes what agents pick. Treat (b) as superseded by this section for
"no board vs board"; its staleness and post-share sensitivities still stand.

**The new model works at E4's grain.** An agent is a loop of calls. Each call pulls, reads the backlog
and main (plus the board), picks one task, builds it and pushes. A rejected push means a rebase and
another push. A task someone else landed while you built it ends as a dropped call. It has 16
parameters (in `E4` at the top of the file); the ones that matter were fitted on E4's 20 runs:
- without a board, 65% of picks avoid a task someone is building ("they spread out"); (b) assumed 100%;
- reading main catches a differently named twin 90% of the time;
- C and D read `who` before choosing 92% of the time;
- the board costs 3-7 s a call (E4's pushed-call medians: A 35, B 40, C 42, D 44 s).

| E4, 5 agents, 16 tasks | A sim (real) | B sim (real) | C sim (real) | D sim (real) |
|---|---|---|---|---|
| wall time (s) | 219 (227) | 194 (219) | 195 (202) | 188 (200) |
| wasted calls (built, then dropped) | 8 (7) | 3 (3) | 2 (2) | 1 (1) |
| of them in the first half of the run | 4 (4) | 2 (2) | 1 | 0-1 |
| deferrals | 0 (0) | 0 (0) | 6 (6) | 10 (7) |
| duplicate pairs built twice (of 4) | 1 (1) | 2 (1) | 1 (1) | 0 (0) |
| runs with any pair built twice | 87% (80%) | 86% (80%) | 81% (60%) | 3% (0%) |
| rejected pushes | 26 (34) | 21 (24) | 19 (16) | 18 (17) |
| calls | 26 (28) | 22 (26) | 23 (29) | 26 (29) |
| agent-seconds | 949 (1090) | 824 (1070) | 807 (960) | 797 (973) |

Sim = median of 1000 seeds; real = median of 5 runs. The ratios fit: D/A wall 0.86 (real 0.88),
D/A agent-seconds 0.84 (real 0.89).

Known misses:
- absolute agent-seconds are ~15% low, so use the ratios;
- A's rejected pushes are low (26 vs 34): no-board agents fight a lost rebase longer than modelled;
- C and D end with fewer calls (23-26 vs 29): the model stops an agent after one skip when all
  that is left is claimed.

Two things only fitted once mechanisms were added:
- **D's zero twins** needed D's alias rule at rebase as well ("make yours an alias once theirs is on
  main"). Without it the sim built a twin twice in 43% of D runs; real D did it in 0 of 5.
- **B's low waste** needed agents that stop once the board shows everything left is taken (B's
  hooks show the now-view in every prompt). Without that, B wasted 7 calls, the same as A.

### Prediction: qb9's scale test (written before it runs)

Setup, from `sim/board-ab/starter2`:
- 10 Haiku agents, 30 tasks, 5 twin pairs (T19~T2, T20~T4, T21~T3, T22~T6, T23~T1);
- about 11 commands that need a helper task;
- tasks 3-5x bigger, so work per call ×4 (×3 and ×5 as the range).

Same calibrated parameters otherwise. Medians [10th-90th percentile] over 1000 seeds:

| measure | A, no board | D, who --recent + same-meaning rule | D vs A |
|---|---|---|---|
| wall time (×4 work) | 13.4 min [11.1-16.7] | 10.0 min [8.0-12.9] | -25% |
| wall time, ×3 / ×5 work | 10.4 / 16.4 min | 8.0 / 12.1 min | -23% / -26% |
| wasted calls (built, then dropped) | 20 [15-27] | 2 [0-5] | about 10× fewer |
| wasted agent time | 53 min [39-72] | 6 min [0-14] | |
| share of agent time wasted | ~49% | ~8% | |
| agent time (≈ API cost) | 109 min [94-127] | 75 min [63-89] | -31% |
| deferrals | 0 | 37 [16-82] | |
| twin pairs built twice (of 5) | 2 [1-4] | 0 | |
| runs with any pair built twice | 95% | 5% | |
| rejected pushes | 58 [50-67] | 37 [32-43] | -36% |
| calls | 58 [52-65] | 68 [46-113] | more, but cheap ones |

What it predicts, so it can be checked:
1. **Waste scales with agents, and so does the board's gain.** A's wasted calls go from 7 (5 agents)
   to ~20 (10 agents): a third of all calls and about half of all agent time. D keeps it at 1-5.
2. **At this size the board becomes a speed win too:** wall time -25% and agent time (cost) -31%,
   against -12% and n.s. in E4. Bigger tasks make each wasted build cost more, while the board's
   cost stays a few seconds a call. With 5 runs each, the wall-time gap should be visible
   (the 10-90% bands barely overlap).
3. **Twins:** A builds 1-4 of the 5 pairs twice; D builds 0 in nearly every run.
4. **Deferrals grow faster than anything else** (≈37 a run, wide: 16-82): ten agents keep
   bumping into each other's claims. They are cheap (~9 s each), but the most uncertain number here.

Where it could be wrong:
- The no-board spread (65% of picks avoid busy work) was fitted at 5 agents on 16 small tasks.
  With 0.4 or 0.85 instead, A's wasted calls range ~16-23, and D's lead holds.
- The rebase cost is held constant. Bigger tasks may conflict harder: at 3× the rebase time, both
  conditions get ~6% slower and rejected pushes rise (A ~70, D ~50).
- The model has no failing tasks, no red main and no quality effect. E4 had none either.

### Prediction vs actual (scale test, E4-results.md "Scale test", A vs D, 3 runs each)

| measure | predicted A -> D | actual A -> D | matched? | post-hoc sim A -> D |
|---|---|---|---|---|
| wall time | 13.4 -> 10.0 min (**-25%**) | 5.9 -> 4.2 min (**-28%**) | relative yes; absolute 2.3x too long | 6.3 -> 5.3 min (-17%) |
| agent time (≈ cost) | 109 -> 75 min (**-31%**) | 55 -> 38 min (**-30%**); $0.95 -> 0.67 (**-29%**) | relative yes | 53 -> 40 min (-24%) |
| wasted calls | 20 -> 2 | 11 -> 5 | direction yes, size no | 21 -> 4 |
| wasted agent-min | 53 -> 6 | 8.7 -> 5.2 | no | 22 -> 4.4 |
| twin pairs built twice (of 5) | 2 -> 0 | **4 -> 4** | no | 4 -> 3 |
| deferrals (D) | 37 [16-82] | 7 [4-13] | no, too high | 14 [9-31] |
| rejected pushes | 58 -> 37 | 103 -> 28 | direction yes; both ends too mild | 79 -> 56 |
| calls | 58 -> 68 | 54 -> 51 | roughly | 60 -> 48 |

- **The headline matched:** wall time -25% predicted vs -28% measured, cost -31% vs -29/-30%. At 10
  agents the board is a speed and cost win, not just a waste win.
- **The absolute times did not.** The tasks were not 4x E4's: the calls were ~1.6x (61 vs 39 agent-s
  per call). That was an input error, not a model error.
- **The twins missed, and that is a model error.** The sim recognised a renamed twin 90% of the time on
  main and 95% under D's rule. That was fitted on scenario 1's close wording (titleCase/capitalizeWords,
  countWords/wordCount). Scenario 2's pairs are mostly far apart: tags/hashtags, priority/urgency,
  completion rate/progress. Only dates/calendar was aliased reliably.
- **Recalibrated by wording distance** (`farPairs`, `farRecognition` in `calls.mjs`): each pair is
  close or far, and every recognition (on main, on the board, D's alias at rebase) for a far pair is
  scaled by 0.1. With 4 of 5 pairs far, the post-hoc sim builds 4 pairs twice in A and 3 in D
  (real 4 and 4). Scenario 1 stays fitted, since it had no far pairs.
- **Inputs measured after the run** (post-hoc column): ×1.6 work, 6 needs (the chains), and 4 far pairs.
  Three misses remain:
  - Without a board the sim still has twice the real wasted calls (21 vs 11), and its drops cost
    more (real drops were cheap: ~47 s a call).
  - The sim's D waits less often but rebases far more than real D (56 rejected pushes vs 28).
    Real D agents nearly stopped fighting git (2 aborts against A's 73), which the model doesn't
    capture. That is also why the post-hoc wall-time gain (-17%) is smaller than the real one (-28%).
  - Same-meaning recognition is a property of the wording, so a board plus a one-line rule can't be
    counted on for it. The fix the results point to is upstream: cluster the backlog into work units
    once, before any agent starts, and stagger the starts so the first claims are visible.

## (d) Round 2: E in the sim, and a prediction for W3a (qb4, 2026-10-10, before the runs)

**E added to `calls.mjs`** (D plus the two E changes): one dedupe call marks each twin pair with
probability 0.97, whatever the wording (E4 scenario 2: 15 of 15 pairs over 3 runs). A marked twin waits
for its partner like a need, then lands as a thin alias (half a call). Agent k starts at k × 5 s.
The calibration rows for A to D did not change.

Checked against scenario 2's real E (post-hoc inputs, 300 seeds):

| measure | sim E | real E | sim D | real D |
|---|---|---|---|---|
| duplicate pairs built twice (of 5) | 0 [0–1] | 0 [0–0] | 3 | 4 |
| wall time (s) | 319 | 268 | 316 | 254 |
| agent-minutes | 40 | 38.5 | 41 | 38.4 |
| wasted calls | 3 | 6 | 4 | 5 |
| deferrals | 25 | 5 | 14 | 7 |
| rejected pushes | 66 | 33 | 55 | 28 |

Duplicates and cost match. Wall time runs ~20% long for both board conditions. Rejected pushes come out
about 2× too high. Deferrals for E are 5× too high: real agents with the hint pick something else instead
of waiting on the marked twin.

### Prediction: qb9's W3a (20 agents, ~60 tasks, 10 far-worded pairs, A vs E)

Inputs (assumed, since qb9's starter is not out yet):
- scenario 2's task size (×1.6 E4's)
- 12 needs (chains)
- all 10 pairs worded far apart

The bias-corrected column scales each sim number by real/sim from scenario 2's post-hoc check
(A wall ×0.92, E ×0.84; agent time ×1.04 / ×0.96; A wasted ×0.52; rejected pushes A ×1.32, E ×0.5;
E deferrals ×0.2).

| measure | sim A | sim E | corrected A | corrected E | E vs A |
|---|---|---|---|---|---|
| wall time (s) | 464 [421–539] | 412 [367–485] | ~425 | ~345 | **−19%** (range −10 to −30%) |
| agent-minutes (cost) | 128 | 100 | ~133 | ~96 | **−28%** |
| duplicate pairs built twice (of 10) | 10 [8–10] | 0 [0–1] | 8–10 | 0–1 | the clearest effect |
| wasted calls | 49 | 10 | ~25 | 10–20 | about −50% |
| rejected pushes | 348 | 350 | ~460 | ~175 | about −60% |
| deferrals | 0 | 64 | 0 | ~13 | |
| D (no dedupe), for reference | wall 390 s, 98 min, **8 of 10 pairs twice** | | | | |

What to expect:
- **Duplicates are the result to watch.** Without the dedupe pass, far-worded pairs get built twice even
  with a board: D still builds 8 of 10 pairs twice. E builds 0–1 of them. This holds in every variant
  (6 of 10 pairs far, or tasks ×1.5 bigger).
- **Cost drops about as much as at 10 agents** (−28% vs −29% real). The time gain stays around −20%
  in the sim. At 10 agents the real gain was larger than the sim's (−28% vs −17%), because real
  no-board agents fight git much harder. With 20 agents doing so, A could be worse still, so a real
  wall gain beyond −30% would not surprise me.
- **E's wall time may sit a little above D's** (sim 412 vs 390 s). The stagger costs 95 s at 20 agents
  and waiting on marked twins also adds time. If real E comes in slower than a D control, that is the
  reason, and a 2 s stagger would be the fix.
- **Risk:** git contention on the hot files at 20 agents (A: ~460 rejected pushes). A run that stalls
  goes out of the timing, as before.

**At qb9's ~1 s stagger** (19 s in total, `stagger_s` logged per run; manager, 2026-10-10), E with
10 far pairs gives:

| | E at 5 s (above) | E at 1 s |
|---|---|---|
| sim wall time | 412 [367–485] s | 384 [344–451] s |
| corrected wall time | ~345 s | **~323 s, −24% vs A** |
| corrected agent-minutes | ~96 | ~100, −25% vs A |
| duplicate pairs built twice | 0 [0–1] | 0 [0–1] |
| wasted calls | 10 | 12 |

The tighter stagger wins back most of the stagger's wall time, and E ends up level with D (390 s).
It costs a few more early collisions: 2 more wasted calls and ~3% more agent time. Duplicates do not
change, because the dedupe pass does that work, not the stagger.

Reproduce: `node sim/board/calls.mjs w3a --seeds 300` (and `scale` for the scenario-2 rows); outputs go to
`sim/board/out/calls-*.json` and `~/.local/share/qbsim-bench/board.jsonl`.

## (e) W4b: board off vs on, on Cloudflare (qodebase boxes + the landing queue), written before W4c runs

**The model is the lab's own (`public/lab/predict.js`, lab-0.11),** so the runner records this
prediction before every W4c run, the same way as for every other lab run. What was added:
- The scenarios `backlog` and `two-teams` (qb5, 682e05f):
  - 30 tasks: 25 units plus 5 twin pairs worded far apart;
  - the backlog states every need;
  - no planner splitting or dedupe;
  - qb9's todokit task size (~45 Haiku-seconds a task, so `aloneS` 430);
  - spec clear (30/30 hidden in every local run).
- A `board` flag on the variant. It goes into `variantKey` as `;board=1` only when on, so old keys
  don't change. `crossDedupe` is for two-teams.

What the flag does in the model (all numbers from `calls.mjs` / E4):
- **Same-task picks:** without a board, 20% of picks build a task another coder is already building,
  and that copy is dropped at landing (s2 A: 11 of 54 calls). With the board it is 6%.
- **Twins:**
  - board off: each twin is still reused by chance with probability 0.2, because its agent finds it on
    main. That gives ~4 of 5 pairs built twice (qb5's scorer on s2: A 4, 4, 3; D 4);
  - board on, one list: the dedupe pass catches each pair with probability 0.97, and the twin becomes
    a thin alias (0.3 of a task) that waits for its partner;
  - two teams: only a dedupe pass that sees **both** lists (`crossDedupe`) catches them. With the board
    alone (finished intents + the same-meaning rule) a far-worded pair is caught ~10% of the time
    (s2: D built 4 of 5 twice).
- **Overhead:** the board costs ~7 s a call.

Prediction (200 seeds; Haiku planner, coders and reviewer; land by intent, trains of 8; medians):

| scenario | coders, reviewers | board off: wall / $ / pairs built twice | board on: wall / $ / pairs built twice |
|---|---|---|---|
| backlog, land by intent | 12, 0 | 694 s / $1.26 / 4.1 | 715 s / $1.29 / 0.1 |
| backlog, land by intent | 12, 1 | ~1845 s / $2.34 / 4.1 | ~1855 s / $2.36 / 0.1 |
| two-teams, land by intent | 12, 0 | 694 s / $1.41 / 4.1 | 718 s / $1.49 / **3.7** (board only) · 720 s / $1.45 / 0.1 (`crossDedupe`) |
| **backlog, policy github** (trains of 1, a conflict goes back to the agent) | 12, 0 | 3497 s [2550–4851] / $4.80 / 2.9 + 1.2 dropped | **2876 s [2231–4118] / $4.67 / 0.1** |
| backlog, policy github | 12, 1 | 3535 s / $6.68 / 3.0 + 1.1 dropped | 3025 s / $6.41 / 0.1 |

The 6-coder rows are the same within 3%. All rows are in `public/lab/board-w4-predictions.json`.

What this says, and why it differs from the local tests:
- **Duplicates are the effect W4c can measure:** ~4 of 5 pairs built twice with the board off (3–5),
  ~0 with it on. That needs a dedupe pass over the list, and in two-teams a pass that sees both teams' lists.
  If W2b's dedupe only reads the list one router hands out, two-teams with the board on will still
  build ~4 pairs twice. That would be the round-1 lesson again (seen but not recognised), not a
  board failure.
- **No time or cost gain on qodebase** (within ±3%; the ranges overlap completely). Locally, the board's
  −28% time and −29% cost came from git thrash: 103 rejected pushes and 73 aborted rebases in A. On
  qodebase every agent has its own fork and the landing queue lands changes one train at a time, so
  that thrash isn't there to remove. Wall time is set by the queue (30 landings, ~60 s a train)
  and, with one reviewer, by the reviewer (~45 s × 30).
  - The 7 s per call the board costs about cancels what it saves: about 1.7 fewer same-task copies
    and 5 aliases instead of 5 full twins.
  - Three things would make it pay: Sonnet coders (a duplicate costs minutes), more agents than the
    queue can feed, or same-task collisions much more common than 20%. Without a board, qodebase
    agents see nothing until landing, so it could be higher. At 35% the board saves ~6% of cost and
    still no time.
- **Under policy github the board does pay in time** (manager's added cell): −18% wall (3497 → 2876 s),
  bounces 27 → 16, cost −3 to −4%.
  - Every conflict goes back to the agent, so twins that are not aliased and same-task copies turn into
    rebase rounds. This is the closest cell to the local git-push tests.
  - With the board off, a twin that keeps bouncing is dropped after 8 tries (~1.2 a run), so
    "built twice" reads lower (2.9), and one task may be missing on main.
  - Predicted contrast: intent board-on ≈ board-off; github board-on ≈ −18%. That would mean the board
    matters where the queue does not already absorb conflicts.
- **Bounces and conflicts:** ~13 conflicts per run in both arms. Most are replayed by land-by-intent,
  leaving ~1.5 bounces. Twins that are not aliased add ~1 conflict each.
- **Quality:** 30/30 expected in both arms (quality 97.5 is the formula's ceiling without a judge).

What would prove the model wrong: board-on wall time more than 10% below board-off (then same-task
waste or queue contention is bigger on boxes than modelled), or two-teams with the board on catching
3 or more pairs without `crossDedupe`.

## (f) W7: congestion control for agents (AIMD on the board's thrash), written before qb9's runs

**Model** (`sim/board/aimd.mjs`; the AIMD part is in `calls.mjs`, option `aimd`):
- **Thrash** = rejected pushes + 3 × dropped work, per minute. The board sees all of it live.
- **The controller** checks it every minute:
  - thrash ≤ lo × cap: cap + 1 (a clean minute);
  - thrash > hi × cap: cap halved (never below 2);
  - otherwise the cap holds.
- **Who works:** only the `cap` lowest-numbered agents still working start calls. The newest pause at
  their next call boundary and wake when the cap allows.
- **Setup:** start 4, qb9's s3 profile (20 agents, 60 tasks, 10 far-worded pairs, 12 needs, s2 task
  size, 1 s stagger), 100 seeds, medians.
- **Thresholds picked in the sim:** lo 1, hi 3 thrash per allowed agent per minute. That is the middle
  of the sweep (lo 0.25–2, hi 1–6). Lower settles at cap 2–3, higher never cuts.
- **Units:** "Agent-min" is all calls. $ ≈ $0.018 per Haiku agent-minute on `claude -p`
  (E4: $0.71 for 38.5 agent-minutes).

| | fixed 20 | AIMD (start 4, +1/min, halve; lo 1, hi 3) | change | AIMD's median cap | fixed at that size |
|---|---|---|---|---|---|
| **A, no board**: wall | 462 s | 1034 s [914–1214] | ×2.2 | 6 | fixed 6: 828 s |
| A: agent-min / $ | 127 / ~$2.3 | 82 / ~$1.5 | −35% | | fixed 6: 77 |
| A: pairs built twice (of 10) | 10 | 9 | | | |
| **D, board**: wall | 388 s | 794 s [734–857] | ×2.0 | 7 | fixed 6: 779 s, 8: 635 s |
| D: agent-min | 99 | 77 | −22% | | fixed 8: 75 |
| D: pairs built twice | 8 | 8 | | | |
| **E, board + dedupe**: wall | 387 s | 794 s [683–854] | ×2.1 | 7 | fixed 6: 735 s, 8: 583 s |
| E: agent-min / $ | 105 / ~$1.9 | 73 / ~$1.3 | −30% | | fixed 8: 71 |
| E: pairs built twice | 0 | 0 | | | |

Faster control variants: a 20 s tick; TCP slow start (double the cap until the first spike, 30 s tick);
looser thresholds. They all sit on the same line between the two columns. E with slow start and hi 6
gives 458 s / 98 min; E with slow start and hi 4 gives 584 s / 84 min.

**The prediction:**
1. **AIMD trades time for cost. It does not win both.** Against a fixed 20 it cuts agent-minutes by
   22–35% and roughly doubles wall time. Duplicates don't change: only the dedupe pass removes those.
2. **It does no better than simply running a fixed team of the size it settles at (6–8 agents).**
   Fixed 8 with E gives 583 s / 71 min, faster than AIMD's 794 s at the same cost. AIMD's ramp
   (4 → 7 takes 3+ minutes of a ~7-minute job) and its pauses are pure overhead.
3. **Why:** in the sim there is no congestion collapse. Each extra agent still shortens the wall time
   (A: fixed 4, 6, 10, 14, 20 → 1118, 828, 609, 520, 462 s); it just pays more thrash for it. TCP's AIMD
   wins when throughput *falls* past the knee. Here throughput only flattens.
4. **The board moves the whole curve, which matters more than the controller.** At the same size,
   E uses 18–25% fewer agent-minutes than A (fixed 10: 75 vs 91 min; fixed 20: 105 vs 127 min) and is
   faster (508 vs 609 s; 387 vs 462 s).

**What would prove this wrong (and make W7 a real feature):** fixed 20 slower than fixed ~8 in the real
run, i.e. a collapse. arXiv 2603.21489's score peaks at 4 and falls at 8, but that is quality, not time.
Real no-board agents fought git much harder than the sim (s2 A: 73 aborted rebases, 84 resets). At 20
agents that could turn into a collapse, and then AIMD would beat fixed 20 on both time and cost.
Suggested runs for qb9: E fixed 20, E AIMD, and **E fixed 8** as the control (also A fixed 20 vs A AIMD
if the meter allows).

**Thresholds in real counts:** the sim over-counts rejected pushes for board conditions about 2×
(s2 post-hoc: D 55 vs 28 real), and under-counts them for A (×1.3). For E on real runs, use lo 0.5,
hi 1.5 per agent per minute. Log the cap each minute (`cap`, `thrashPerMin`) so the run can be
replayed here.
