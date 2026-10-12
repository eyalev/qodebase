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

*Note added 2026-10-10, after W4c run r1e:* r1e: agents themselves recognised all 5 twins already on main (sim assumed ~1 of 5).

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

## (g) W8a: a throughput-probing controller (BBR-like), written before qb9's W8b runs (qb4, 2026-10-11)

**Recalibrated on the real s3 runs first** (E6-results.md). The sim was too optimistic about large teams. Real
E fixed 8 → 20 cut wall time 17% for +87% agent-minutes; the sim had −34% for +48%. Two terms close that gap
(`calls.mjs`):
- `slowPerAgent` 0.04: one laptop runs every agent (`claude -p` + `npm test`), so a call takes 4% longer
  per other agent building at that moment.
- `rebasePerCommitS` 0.5: a rebase costs 0.5 s more per commit landed since its base.

Work is ×1.1 E4's. Fit (sim vs real):

| | sim wall / agent-min | real wall / agent-min |
|---|---|---|
| A 20 | 551 / 152 | 594 / 170 |
| E 20 | 447 / 124 | 451 / 131 |
| E 8 | 580 / 71 | 544 / 70 |

The E4 calibration is unchanged (the new terms default to 0). `slowPerAgent` is specific to the laptop:
on Cloudflare every agent has its own box.

**The controller** (`calls.mjs` option `probe`; thresholds tuned in the sim; these are the ones qb9 should use):
- start at **8** agents; every 30 s look at **landings per minute over the last 4 min**;
- add **2**, wait **4 min**, compare with the 4 min before the add. Keep them if the rate rose by at least
  **0.2 × 2 / previous cap**, i.e. the new agents earn at least 20% of an average agent's landings. Then add
  2 more;
- otherwise step back 2 and **hold 3 min**, then probe again;
- while holding, landings down more than **25%** → one fewer;
- **halve only when dropped work (built, then thrown away) exceeds 1 per active agent per minute**. Rejected
  pushes never cut. A tighter drop rule (0.5) halved the no-board team 3 times a run, for nothing.
- Why these numbers: 2-minute windows and steps of +1 were too noisy at ~5 landings a minute. That
  controller stalled at 5–7 agents.

**Long backlog** = 2.5× s3: 150 tasks, 25 far-worded pairs, 30 needs. Haiku, 100 seeds, medians.
"wall × agent-min" is a single time-and-cost score; lower is better.

| | wall (s) | agent-min | wasted min | pairs built twice | wall × agent-min |
|---|---|---|---|---|---|
| A fixed 8 | 1434 | 184 | 31 | 23 | **264k** (best A) |
| A fixed 12 | 1195 | 224 | 46 | 23 | 268k |
| A fixed 20 | 1052 | 317 | 84 | 23 | 333k |
| A fixed 30 / 40 | 1031 / 1035 | 441 / 568 | 148 / 221 | 23 | 455k / 588k |
| **A controller** (pool 20 or 40) | 1304–1322 | 217–220 | 45 | 23 | 283–291k, settles at **10** |
| E fixed 8 | 1363 | 175 | 2 | 0 | 239k |
| E fixed 12 | 1116 | 209 | 3 | 0 | **233k** (best E) |
| E fixed 20 | 935 | 284 | 9 | 0 | 266k |
| E fixed 30 / 40 | 872 / 858 | 385 / 493 | 18 / 33 | 0 | 336k / 423k |
| **E controller** (pool 20 or 40) | 1177–1184 | 208–213 | 5–6 | 0 | 245–252k, settles at **12** |

Prediction:
1. **Without the board, 20–40 agents congest.** Wall time stops falling at ~20 (1052 → 1031 → 1035 s) while
   agent-minutes nearly double (317 → 568) and wasted minutes go 84 → 221. It plateaus; it does not
   collapse. Real A at 20 already had ~220 aborted rebases a run.
2. **With the board the knee moves out** to ~30. Wall keeps falling to 858 s at 40, and waste stays small
   (33 min at 40).
3. **The controller finds the sweet spot by itself, within 5–10%.**
   - With the board it settles at 12, the best fixed size by wall × agent-minutes (245k vs 233k).
   - Without the board it settles at 10 (283k vs the best fixed 264k at 8).
   - The pool (20 or 40 allowed) does not matter: it never runs up into the congestion.
   - It does **not** find the fastest setting: that is fixed 30–40, at about twice the cost.
4. **The board matters more than the controller.** At the same size E is 5–17% faster and uses 5–15%
   fewer agent-minutes. Only the board (dedupe) stops duplicates: 23 of 25 pairs vs 0.
5. **Expected W8b medians:** controller with board ≈ 1180 s / 210 agent-min, cap ~12; controller without
   board ≈ 1310 s / 220, cap ~10; fixed 40 without board no faster than fixed 20.

**Falsifiers:**
- the controller settling below 8 or above 16;
- fixed 40 clearly slower than fixed 20 (a true collapse: then the drop-halving rule earns its keep);
- the controller more than 15% worse by wall × agent-minutes than the best fixed size.

## (h) W9a: tasks that arrive during the run, written before qb9's W9b runs (qb4, 2026-10-11)

**Model** (`calls.mjs` option `arrive`; `sim/board/arrivals.mjs`):
- 10 agents, the s3-calibrated terms, 30 tasks at the start (5 far-worded pairs).
- Then n tasks arrive at Poisson times. A share of them (dupShare) reword work already landed or being
  built, worded far apart.
- Conditions:
  - **none:** no board, no dedupe;
  - **board + upfront dedupe:** E, where only the starting list is deduped;
  - **board + per-arrival dedupe:** each new task is checked against open, in-progress and landed work
    (0.97). A twin of landed work is closed as done; a twin of open work is marked and later lands as an
    alias.
- Agents with nothing to do wait for the next task, without cost. **Each arrival wakes one waiting agent.**
  Waking all of them sends the whole idle team at the one new task: in the sim that doubled E's wasted
  minutes (26 vs 14). qb9's harness should wake one.

200 seeds, medians [10–90%]:

| arrivals | condition | wall (s) | agent-min | wasted min | pairs built twice | closed as dup |
|---|---|---|---|---|---|---|
| 30 over 10 min, 30% dups (~9) | none | 764 | 113 | 52 | 13 [10–16] | 0 |
| | board + upfront | 717 | 87 | 14 | 6 [3–9] | 0 |
| | **board + per-arrival** | 696 | **79** | 12 | **0 [0–1]** | 6 |
| 30 over 10 min, 50% dups (~15) | none | 767 | 114 | 52 | 18 [14–22] | 0 |
| | board + upfront | 718 | 87 | 16 | 10 [6–13] | 0 |
| | **board + per-arrival** | 688 | **72** | 11 | **0 [0–1]** | 11 |
| 60 over 20 min, 30% dups (~18) | none | 1364 | 202 | 115 | 21 [18–26] | 0 |
| | board + upfront | 1330 | 131 | 27 | 13 [9–17] | 0 |
| | **board + per-arrival** | 1305 | **111** | 21 | **0 [0–1]** | 15 |

Prediction:
1. **Wall time hardly moves** (−3 to −10% between conditions, inside the spread). The run ends when the
   last task has arrived and been built, so cost and duplicates are the measures to read.
2. **Upfront dedupe stops missing duplicates once work arrives late.** It still builds ~6–13 pairs twice:
   the late twins are worded far apart, and the board alone recognises ~10% of them.
3. **Per-arrival dedupe takes duplicates to ~0** and saves another 9–17% of agent-minutes over upfront
   dedupe. More when more arrivals are duplicates: −9% at 30%, −17% at 50%.
4. **Against none, per-arrival dedupe uses 30–45% fewer agent-minutes** and wastes ~5× less.
5. **The per-arrival check costs one cheap call per arrival** (~$0.002, a few seconds; E4's dedupe call),
   off the agents' critical path.

**Falsifiers:**
- upfront-only builds fewer than 3 late pairs twice (then agents recognise reworded late work far better
  than in s2/s3);
- per-arrival saves no agent-minutes over upfront.

Reproduce:
- `node sim/board/probe.mjs 100` (W8);
- `node sim/board/arrivals.mjs 200` (W9);
- `node sim/board/calls.mjs calibrate` (E4, unchanged).

## (i) L1: one landing door vs many lanes, 10 to 10,000 agents (qb4, 2026-10-12, before L2/L3 run)

The thesis (docs/board/TASKS.md "Lanes"): many agents are limited by one landing door, so give each area of the
code its own landing lane, a throughput controller per lane, design the hot shared files out, and send changes
that span areas through a slower coordinated lane. This is the fast sim's prediction, zero tokens.

**Model** (`public/sim/engine.js`, opt-in `lanes`; with lanes off it gives the same output as before, checked):
- **The repo.** A big monorepo: 20,000 files in 500 areas of 40 files.
- **qodebase's landing.** Every change is reviewed. Trains of up to 16 changes are tested together (60 s).
  A conflict is replayed on the new main, else it goes to the area lead. No file claims, no people.
- **Lanes.** N lanes are areas of whole modules, balanced by how often they change. Each lane has its own
  queue, its own hot files (package.json-like, designed per area) and its own red/green main.
- **Cross-area changes.** A cross change cannot land in one lane. It goes to the coordinated lane, which waits
  until every lane it touches is idle, holds them, and lands with a 1.5× test. Main design: trains of up to 16
  cross changes, over as many lanes as they touch.
- **Controller (hold mode).** It is W8's probe per lane, with 15-minute windows, because a change takes about
  8–10 minutes here. An agent whose lane is full parks with its task, and a parked agent costs no box.
- **How areas are hit.** Zipf 1 means a few hot areas: the busiest area gets 15% of all changes. Zipf 0.5
  means the areas were drawn evenly.
- **Runs.** 16 simulated hours, measured over the last 8. Two seeds per cell, 832 cells, 392 s on 10 cores.

Measuring the first 4 hours overstated the cross-area cells by up to 2×: agents keep piling into the
coordinated queue for hours.

**Steady state, landed per hour** (fixed = every agent works; ctl = per-lane controller, % of agents awake):

| setup | 100 agents | 1,000 | 10,000 | saturates at |
|---|---|---|---|---|
| one queue | 401 | 818 | 820 | ~300 agents, ~830/h |
| 4 lanes, no cross | 408 | 3,256 | 3,230 | ~1,000 |
| 16 lanes, no cross, hot areas | 403 | 4,027 | 6,076 | ~10,000 |
| 16 lanes, no cross, even areas | 407 | 4,040 | 12,881 | ~3,000 |
| 256 lanes, no cross, hot areas | 405 | 4,052 | 5,851 | ~3,000 |
| 64 / 256 lanes, no cross, even areas | 403 | 4,055 | **40,191 / 40,322** | not reached (demand-bound) |
| 16 lanes, 5% cross, hot / even | 403 / 401 | 2,141 / 3,612 | 3,508 / 4,554 | ~10,000 |
| 256 lanes, 5% cross, hot / even | 407 / 403 | 2,336 / 4,046 | 3,015 / 9,104 | ~10,000 |
| 16 lanes, 20% cross, hot / even | 412 / 405 | 1,074 / 1,797 | 2,126 / 2,273 | ~10,000 |
| 256 lanes, 20% cross, hot / even | 404 / 401 | 1,134 / 2,005 | 1,332 / 1,856 | ~1,000-3,000 |
| 256 lanes, 5% cross, even, **ctl** | 404 | 4,058 (91% awake) | 11,221 (28% awake) | |
| 256 lanes, no cross, hot, **ctl** | 406 | 4,058 (90%) | 6,551 (44%) | |
| one queue, **ctl** | 386 | 807 (62%) | 791 (13%) | |

Per change, at 10,000 agents:
- **Collisions:** 0.3–0.9 per landed change, more with fewer lanes (one queue 0.86, 256 lanes 0.5).
- **Wasted work:** stays at 8.4–9.8% of agent time everywhere (replays absorb most collisions).
- **Broken main:** 3.7% of the time with one queue, 0.05–3.6% of a lane's time with 16–256 lanes. Lanes land
  more, so they break more often, but each break stops only its own lane.
- **Cost:** $2.0–2.6 per change, highest when agents wait longest.
- **Median time from asking to landing:** 11.7 h with one queue at 10,000 agents; about 9–14 min with 64–256 lanes.

**Predictions:**
1. **One door saturates at about 300 agents and 830 changes an hour** (16 changes per 63 s train). More agents
   only lengthen the line: the median time to land goes from minutes to 11.7 h at 10,000 agents.
2. **Lanes multiply the door until the hottest area fills its own lane.** With a few hot areas (the busiest
   gets 15% of changes), that cap is about 6,000 an hour: 16, 64 and 256 lanes all stop at 5,850–6,800 (with or without the controller). With
   areas drawn evenly, 64–256 lanes reach 40,000 an hour at 10,000 agents and still rise (demand-bound),
   48× one queue. **Splitting hot areas matters more than adding lanes.**
3. **Cross-area changes set the ceiling: about the coordinated lane's rate ÷ the cross share.**
   - At 5% cross, the best case is 9,000–11,000 an hour (even areas), 3,000–3,500 with hot areas.
   - At 20% cross, every lane count lands only 1,200–2,300 an hour (1.5–2.7× one queue), saturating by
     1,000–3,000 agents.
   - Small coordinated trains (4 changes over at most 8 lanes) never drain their queue: 1,150–2,300 an hour.
     Per-lane locks for cross changes are worse still: they convoy (16 lanes, 20% cross, 10,000 agents:
     106 an hour).
   - **Ordering is the price:** a cross change can only land with every lane it touches held.
4. **The controller lands about the same with far fewer agents.**
   - It stays within −20%…+23% of fixed throughput. At 10,000 agents it keeps 13–90% of them awake (one
     queue: 13%).
   - The gain is agents and boxes. Cost per change stays about $2–3, because model time is per change.
   - In "pick" mode (an agent draws a task in a lane with room) 256 lanes at 5% cross reach 13,243 an hour
     vs 2,849 in hold mode. That changes which work gets done, and only holds while the backlog has work
     elsewhere.
5. **People did not show as a ceiling in these cells.** With 5% of changes needing a person's approval, the
   total was 2,900 vs 3,000 without (5% cross). The 2 people approve about 80 an hour, so risky changes wait in
   their own line. This is an inference: the sim does not report that line's length.
6. **File claims are a ceiling of their own.** With claims on and one queue, 78% of 10,000 agents wait for a
   claim. With lanes plus claims, the 5%-cross cells rose 1.4–3.1× (likely because the claims policy redraws
   blocked work, as pick mode does; not isolated).

**Falsifiers for L2/L3:**
- one queue saturates below 200 or above 600 agents;
- lanes with no cross-area changes beat the hottest area's cap (about 1 / that area's share × one lane);
- 20% cross lands more than 4× one queue at steady state;
- the controller loses more than 30% of fixed throughput at steady state.

### For qb5's L2 (sim/real with lanes): the same model shaped like that project

The cells are shaped like L2:
- agents/10 folders of 8 files (400 files at 500 agents, 1,600 at 2,000), on the same 1/(i+1) curve: the
  busiest folder gets 22% (500) or 17% (2,000) of changes;
- **cross share measured from sim/real's own randomOp** (5,000 draws): 34% of changes are cross-area with
  the root files shared, 8.5% with them split per folder;
- L2's coordinated lane: trains of 4 over at most 8 lanes, tests ×1.5. L2 also has a door onto main and main's
  tests after each landing; this model has neither.

`sim/lanes/l2-cells.jsonl` holds 3 seeds per cell; `node sim/lanes-l2.mjs` reproduces it.

| agents | lanes | root files | 2 h run (2nd hour) | steady state (16 h) | steady, big coordinated trains |
|---|---|---|---|---|---|
| 500 | 1 | - | 850 | 818 | |
| 500 | 8 | shared | 457 | 347 | 592 |
| 500 | 8 | split | 1,172 | 989 | 1,148 |
| 500 | 32 | shared | 516 | 371 | 598 |
| 500 | 32 | split | 846 | 1,075 | 1,233 |
| 2,000 | 1 | - | 802 | 824 | |
| 2,000 | 8 | shared | 1,345 | 351 | 988 |
| 2,000 | 8 | split | 2,430 | 1,191 | 1,558 |
| 2,000 | 32 | shared | 937 | 364 | 896 |
| 2,000 | 32 | split | 2,851 | 1,379 | 1,467 |

With the controller (2 h / steady): 500 agents, 1 lane: 460 / 819; 2,000, 32 lanes split: 2,558 / 1,239 (13–34%
of agents awake).

Predictions for L2:
- **With shared root files, lanes do worse than one queue at steady state** (350–370 vs ~820 an hour): 34% of
  changes queue for the coordinated lane. Big coordinated trains help (590–990), but beat one queue only at
  2,000 agents with 8 lanes (988 vs 824).
- **With split root files, lanes beat one queue by 1.2–1.9×** (990–1,560 an hour, the high end with big
  coordinated trains). The busiest folder and the 8.5% cross share cap it.
- **A 2 h run overstates the cross-area cells by up to 2×** (2,000 agents, 32 lanes, split: 2,851 at 2 h vs
  1,379 steady) while agents are still piling into the coordinated queue.
- **A 2 h run understates the controller**, which spends most of 2 h growing from 8 (1 lane: 460 at 2 h, 819
  steady).

### For qb6's L3 (lanes on Cloudflare, sim/cloud): worked out from the 500-agent run's measurements

This is a different machine from the fast sim. Scripted agents work 20–60 s, have no review, push to their
fork, and take the next task without waiting. Trains run every trainEveryS. The numbers come from cloud-500
(sim/cloud/README.md):
- one queue Durable Object overloaded at about 11 changes a second (~40,000 an hour);
- main pushes took 400 ms median, agent pushes 280 ms.

Modules are drawn by the harness's `floor(-ln(1-u)·8)`, so module 0 gets 11.8%. Lane k owns modules m % N, so
lane 0 carries this share of the in-lane changes:

| lanes | 1 | 2 | 4 | 8 | 16 | 32 | 50 |
|---|---|---|---|---|---|---|---|
| lane 0's share | 100% | 53% | 30% | 19% | 14% | 12% | 12% |

With 100 modules, the same formula gives the same shares. More modules do not flatten the hot spot unless the
draw changes.

The working:
- **Demand** is about agents ÷ 40.5 s: 500 agents send 12.3 a second (44,000 an hour), 2,000 send 49 a second
  (178,000).
- **Per lane**, landed = min(that lane's demand, ~11 a second).
- **The total** is min(demand, 11 ÷ lane 0's share, lane X's cap ÷ cross share).
- **Lane X's cap** is min(11 a second, trainMax ÷ xEveryS).

| agents | lanes | predicted landed/h | lane 0 | quietest lane | what limits it |
|---|---|---|---|---|---|
| 500 | 1 | 35,000–40,000, with overload resets (as cloud-500) | all | | the one Durable Object |
| 500 | 8 | ~44,000 (demand) | ~8,200 (2.3/s, 21% busy) | ~3,400 | the agents |
| 2,000 | 1 | ~40,000, then overload and resets | all | | the one Durable Object |
| 2,000 | 4 | ~132,000 | ~40,000 (saturated) | | lane 0 |
| 2,000 | 8 | 150,000–178,000 | ~33,000 (9.1/s, 83% busy: the edge) | ~14,000 | lane 0 |
| 2,000 | 16 / 32 | ~178,000 (demand) | ~24,000 / ~21,000 | | the agents, and the main ref (below) |

**Freezes.** Each lane X landing freezes the lanes it touches. At 2,000 agents a train touches nearly every
lane, and its replay, test and push take about 2–3 s. With xEveryS 10, that freezes lanes ~25% of the time,
which tips lane 0 at 8 lanes into saturation (~150,000 an hour). At 20% cross, 2,000 agents put 9.8 a second
into lane X: xEveryS 30 caps it at 6.7 a second (trainMax 200), so the total is ≤ ~120,000 an hour.

**The main ref (compare-and-swap) becomes the visible limit before landings do.**
- Pushes per second = N ÷ trainEveryS + 1 ÷ xEveryS, each about 0.4 s plus a re-read of about 0.3 s when stale.
- With trainEveryS 10, I predict stale pushes at ~25% of main pushes with 8 lanes, ~50% with 16, and over 70%
  with 32 (the ref is busy more than 100% of the time).
- Landed per hour holds, because trains carry up to 200 changes, but each lane pushes less often and latency
  rises. Each stale retry also costs Artifacts operations.

Caveats:
- 11 a second per object was measured while that object also handed out tasks and took hand-ins for 500 agents.
  If one object still hands out every task, at 2,000 agents it gets about 49 task calls plus 49 hand-ins a
  second, and it becomes the door again. Hand out tasks per lane too.
- Agents push to their forks at 49 a second at 2,000 agents, 4× cloud-500's 12 a second (0.1% failed then).
  Artifacts has not been measured at that rate.

Cells worth running:
- **500 agents:** 1 vs 8 lanes at 5% cross: 35–40k with resets vs ~44k, no resets.
- **2,000 agents (100 modules):** 1, 8, 16 and 32 lanes at 5% cross, xEveryS 10.
  - The landed curve should flatten at 16 or more lanes, while stale pushes keep rising.
  - 8 lanes should sit at lane 0's edge.
- **One 20%-cross cell at 16 lanes:** lane X's cap shows there.

## (j) BUN: re-running the coordination of Bun's Zig→Rust port at 64 / 640 / 6,400 agents (qb4, 2026-10-12, before the sweep)

Bun's port (oven-sh/bun#30412, sim/bun/README.md) is the one large real multi-agent history we have: 6,479 commits
by ~64 Claude agents. `sim/bun/swarm.mjs` replays its **structure** with the work mocked:
- **Tasks:** one per real non-merge commit, with the real files (`sim/bun/tasks.json`, 3,056 files, from the
  blobless clone).
- **Phase gates:** a | b | c+d | e | tail (f, g, h and untagged). The next group opens when every task of the last
  one has landed and a 15-minute full check has passed.
- **Work times:** fitted so that Bun's own method at 64 agents takes the real phase times.

Four methods, plus the variant the manager asked for:
- **bun:** one shared tree. Agents own the line ranges they edit and commit straight onto the branch, with no
  per-commit check.
- **queue:** a fork per agent and one merge queue: trains of 16, a full `cargo check` (5 min).
- **lanes:** a queue per crate (`src/<crate>`, a 2-minute check). Changes spanning crates go through a
  coordinated lane that holds the lanes it touches. A controller runs per lane.
- **split:** lanes plus the hottest 1% of files split into parts.
- **fine:** split plus `src/runtime` cut into its modules (finer areas than crates; the manager's request).

**Calibration (already run).** Line ranges of about 10 edits each and a 400 s median per commit make Bun's method
at 64 agents take about 9 h for c+d (real d 9.7 h) and about 5.7 h for e (real 4.9 h). Phase b does **not** fit
(sim ~5 h, real 26 h): Bun ran it as b0/b1/b2 steps, so it was not agent-bound. b's sim time is a lower bound.
A stricter dependency model, where each edit waits for the previous edit to the same file range, was **rejected
by the same calibration**: Bun's method at 64 agents then takes 64 h for c+d and 39 h for e. So within a phase the
real work was mostly not ordered by file. The data cannot show dependency depth above 64 agents, so the sweep
orders work by the gates only. That is the **best case for speed-up**; real chains can only slow the bigger crowds.

**Data that decides it** (from tasks.json):
- **One crate dominates:** `src/runtime` is in 57% of commits.
- **Many commits span crates:** 38% overall (d 27%, e 48%); 34% if module roots and manifests are left out.
- **Finer areas cut both ways:** splitting `src/runtime` by module drops the busiest area to 18%, but raises the
  cross share to 57%.
- **The merge replay gives the conflict rate:** a file changed on both sides merged cleanly 84% of the time.

**Predictions** (from the calibration and about a dozen debug cells; the full sweep follows in (j) results):
1. **Bun's method stays about the fastest, and barely gains from more agents:** about 36 h at 64 agents, about 31
   h at 6,400. It has no check per commit, so nothing queues. More agents mostly wait on ranges other agents
   own, then on the gates and the longest tasks.
2. **One merge queue is slower than Bun's method at every size:** about 60–90 h. A queue with a 5-minute full
   check lands at most about 190 changes an hour, below Bun's real peak of 214 commits an hour with 64 agents.
   Long waits make about one conflict per task (≈1.1 collisions per landed change), so 30–35% of agent-hours are
   rework.
3. **Lanes by crate barely beat the queue** (about 60–70 h). `src/runtime` carries 57% of the work through one
   lane, and 38% of changes need the coordinated lane, which holds every crate they touch.
4. **Splitting the hottest files cuts collisions but not time.** Time is set by the queues and the coordinated
   lane, not by conflicts.
5. **Finer areas (runtime by module) do not rescue lanes.** The busiest lane falls from 57% to 18%, but cross-area
   changes rise from 38% to 57%, so the coordinated lane carries more. Expect within ±10% of lanes.
6. **The gates cap everything.** Five gated groups plus 4 × 15-minute checks set a floor even with unlimited
   agents: each group takes at least its longest task plus its landing. Above ~640 agents more agents add only
   idle time (idle > 95% at 6,400 in every method).
7. **Where the methods differ is the price of speed.**
   - **Bun's method:** no collisions or rework, because ownership prevents them. Its cost is a shared tree with
     no check per commit: the ~1% of commits that break the build are found by the next full check, or by an
     agent stuck in it.
   - **Queue methods:** they check every change but pay 30–35% rework.

**Falsifiers:**
- the queue beats Bun's method at 640 agents;
- finer areas finish more than 25% faster than lanes by crate;
- 6,400 agents finish more than 2× faster than 640 in any method (gates-only ordering is the best case, so that
  would mean gates are not the cap).

### (j) results: the sweep (2026-10-12, 142 cells in 37 s, `node sim/bun/swarm.mjs --sweep`, sim/bun/sweep.jsonl)

Means of 3 seeds. Times are hours to finish all 6,479 tasks; collisions are per landed task; rework is the
share of agent-hours.

| method | 64 agents | 640 | 6,400 | unlimited (64k) | agent-hours (640) | collisions (640) | rework (640) |
|---|---|---|---|---|---|---|---|
| bun (shared tree, line-range ownership) | **36.4** | **31.1** | **31.1** | 31.1 | **1,148** | 0 | 0% |
| one merge queue | 72.6 | 88.7 | 89.2 | 87.4 | 1,702 | 1.16 | 33% |
| lanes by crate | 87.0 | 66.7 | 67.1 | 67.8 | 1,632 | 1.02 | 30% |
| lanes + hottest files split | 77.7 | **55.0** | 58.2 | 59.2 | 1,544 | 0.83 | 26% |
| lanes + split + src/runtime by module | 78.4 | 62.7 | 63.5 | 62.7 | 1,571 | 0.89 | 28% |

Notes on the table:
- **Controller.** Lane cells are shown with the per-lane controller. Without it they are within ±5% (for example
  lanes at 640: 63.6 h without, 66.7 h with); in this sim it neither helps nor hurts.
- **Idle.** Above 640 agents, more than 95% of agent time is idle in every method.
- **Breaks.** Bun's shared tree lands ~66 build breaks unchecked (1% per commit). The queue methods catch 90% of
  theirs before landing.

**What caps the speed-up.**
- **The gates cost about a third, not most of it.** Bun's method with no gates finishes in 27.6 h at 64 agents
  and 21.0 h at 6,400, against 36.4 h and 31.1 h with gates. The queue methods barely notice the gates: their
  own queues are the limit (one queue: 68.7 h with no gates vs 72.6 h with them, at 64).
- **Ownership is the main cap for Bun's method.** With unlimited agents and no gates it still takes 21 h: tasks
  that need the same line range wait for each other. With ranges five times finer (1 edit per range vs the
  fitted 10) that floor halves to 10.8 h. Work-time spread matters less (no spread: 17.1 h).
- **Bun's method scales only as far as ownership gets finer.** The granularity was fitted at 64 agents, so the
  data cannot say how fine it can get with more agents.
- **Agents beyond 640 do nothing** in any method: 6,400 is never faster than 640.

**Against the prediction:**
1. **Held:** Bun's method fastest and flat (36 → 31 h).
2. **Held:** one queue slower at every size, 73–89 h. Rework 27–33% (predicted 30–35%); collisions 0.8–1.2 per
   task (predicted ≈1.1). It **gets worse with more agents** (73 → 89 h): more changes wait longer, so more of
   them collide.
3. **Partly wrong.** Lanes by crate are **slower than the queue at 64 agents** (87 vs 73 h): the runtime lane
   and the coordinated lane carry most of the work, and a crowd of only 64 cannot fill the other lanes. From 640
   agents they beat the queue by about 25% (67 vs 89 h), not "barely".
4. **Wrong.** Splitting the hottest files cuts collisions (−19%) **and** time (−13% to −18%): split is the best of
   the lane methods (55 h at 640).
5. **Held.** Finer areas do not rescue lanes. They are better than plain lanes (63 vs 67 h) but worse than split
   alone (63 vs 55 h), because the cross-area share rises from 38% to 57%.
6. **Half right.** The gates cap less than I said (about a third). Ownership and the queues cap more.
7. **Held.** Bun's speed comes from having no check per commit; the queue methods pay about 30% rework for
   checking every change.

None of the falsifiers fired:
- the queue never beats Bun's method;
- finer areas are only 6% faster than lanes;
- 6,400 agents are never 2× faster than 640.

**Phase b, honestly.** The sim runs b in 5–8 h; Bun took 26 h. Bun ran b as sequential steps (b0/b1/b2) with
probably fewer agents, so b was not agent-bound. Every method's total here is about 20 h shorter than a replay of
Bun's real schedule would be. That shifts all methods equally and does not change their order.

**Rejected dependency model, for the record.** If each edit waits for the previous edit to the same file range,
every method takes 146–517 h, and Bun's method at 64 agents is 6.6× slower than the real port. The real work was
not ordered that way.

**What it means for qodebase.**
- **On a migration like Bun's, one shared tree with fine-grained ownership beat every merge-queue design:** about
  half the time and about 30% fewer agent-hours.
- **The queue designs' cost is rework** from long waits plus one landing door. Lanes help from ~640 agents only
  when the hottest files are split.
- **A better design would combine the two.** Ownership of line ranges (claims at range granularity) to prevent
  collisions, plus a lane-level check instead of none. The sim suggests that keeps Bun's speed if the lane check
  is fast relative to work. That is a cell to try (BUN3), not a result.
