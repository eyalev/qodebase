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

### (i) L1 prediction vs L2 actual (qb5's sim/real lanes, e45fbdf, sim/real/out/lanes.jsonl; 2026-10-12)

L2 used real git and real tests, one seed per cell. Landed per hour, 2,000 agents unless noted:

| cell | predicted (L1, shaped like L2) | measured (L2) | |
|---|---|---|---|
| one queue, 500 / 2,000 / 10,000 agents | 818–850, saturated | 851–896 at all three | held (within 5–9%) |
| 32 lanes, root files split, steady state | 1,379 | 1,271 (6 h, last hour; dependency-aware lanes + controller, main never red) | held (−8%) |
| 8 lanes, root files split, steady state | 1,191 | 540 (6 h, last hour; same design) | **missed (2.2× too high)** |
| 8 lanes, big coordinated trains | 1,558 | 1,133 | missed (1.4× too high) |
| shared root files vs split | lanes worse than one queue when shared | "shared hot files cancel the gain; split is a precondition" | held |
| 2 h runs overstate the cross-area cells | up to 2× | "without a controller the coordinated queue grows by hundreds an hour; 2 h averages overstate" | held |

**What L1 did not model, and L2 found:**
- **Lane-local tests break main.** Lanes that test only their own area left main red 20–88% of the time. Every
  break was a call into another area racing a rename there. L1's breaks are a flat 0.3% per change with no
  cross-area semantics, so it could not see this.
- **The fix is dependency-aware lanes.** A change that calls into another area counts as cross-area, and lanes
  test their reverse dependencies. That gave 0 breaks in all 26 such cells, but raised the coordinated share at
  8 lanes from ~4% to 15%.

**The 8-lane miss is not explained by the cross share alone.** Re-running L1's L2-shaped model with L2's measured
15% gives 1,269 an hour at 8 lanes (last hour of 6 h, 3 seeds: 952, 984, 1,871).

Candidates, not yet isolated:
- **L2's door onto main:** one train at a time.
- **Main's full tests after every landing.**
- **Slower lane tests:** testing reverse dependencies makes each lane's test longer.
- **Noise:** one seed's last hour swings ±40% in L1, and L2 has one seed per cell.

The 32-lane design that L2 recommends (dependency-aware, controller) matched within 8%.

**Update: the 8-lane miss is structural** (qb5, 3 seeds, last hour of 6 h: 540, 501, 734; mean 592, below one
queue's 896). In both models the coordinated lane holds all 8 of 8 lanes, so that cannot be the difference: L1
still gives about 1,270. What L1 lacks is the rest of L2's machinery:
- the door onto main (one train at a time);
- main's full tests after every landing;
- reverse-dependency tests in each lane.

L2's coordinated queue was still growing at 6 h (116–288 waiting). The lesson for the write-up: with few lanes,
the coordinated lane plus serial landing on main eats the gain. 32 dependency-aware lanes are the design that
holds (1.4× one queue).

### (j) addendum: what BUN3 (qb5, b89a003, real patches on real content) overturns

BUN3 replayed Bun's real patches and rebuilt the history exactly (c+d+e: 1,221 of 1,221 files; tail: 2,168 of
2,171). It found that **Bun's commits are chains**:
- 89% of c+d+e commits edit lines an earlier commit wrote; the longest chain is 322 commits;
- 82% would not apply in random parallel order;
- so 640 agents finish no sooner than 64 (26.3 vs 26.2 h; calibrated, real c+d+e 25.3 h).

That changes four things in (j):
- **"Bun's method scales from 36 to 31 h" is an artifact of ordering by gates only.** With the real chains, adding
  agents above 64 buys nothing.
- **"Ownership granularity is the main cap" is wrong.** The cap is the content chain, so finer ranges cannot help.
- **My rejection of the chain model was right about my model but wrong about Bun.** My chains (per file range, at
  ~400 s per task) were 6.6× too slow. BUN3's chains run on content with ~65 s per commit (Bun's mainline commits
  were 9 s apart at the median) and fit within 4%. Short tasks hid the chains from my fit: a gates-only model can
  match the 64-agent times while getting the structure wrong. **Lesson:** calibrating total time at one crowd size
  does not identify the dependency structure; it needs content (BUN3) or a second crowd size.
- **The method ranking needs re-reading.**
  - With chains, every blocking check sits on the critical path. qb5 measured +23% (30 s check) to +92% (120 s)
    time for a blocking per-crate check.
  - So a merge queue with a 5-minute full check would be far slower than (j)'s 73–89 h. (j)'s ranking (Bun's
    method fastest, one queue slowest) stands, and the gap widens.
  - The design BUN3 points to is **land at once, check behind the commit, fix forward**. It kept Bun's 26.2 h and
    cut red crate-minutes by 59–73%.
  - Real tail regressions were mostly runtime or test failures (a compile check catches 1 of 4).

What still stands from (j):
- the data facts (src/runtime 57%, 38% cross-crate);
- lanes by crate do not fit Bun's port, and finer areas do not rescue them;
- phase b is not agent-bound;
- above ~640 agents nothing improves (BUN3: already above 64).

## (k) BUN5: is Bun's chain a property of porting, or of how the work was cut? (qb4, 2026-10-12, before the runs)

BUN3 found Bun's commits are content chains (89% edit lines an earlier commit wrote, longest 322), so 640 agents
finish c+d+e no sooner than 64 (26.2 h, real 25.3 h). BUN5 re-cuts the same work: **one owner's task per Rust
module (file)**. That merges the port, make-it-compile and test fixes for a file into one agent, so every content
chain (chains are per line, hence per file) runs inside one agent with no handoffs.

Ordering comes from the real module structure (`use`/`mod` in the tip's 1,448 `.rs` files; crate edges from
`Cargo.toml`). Work time per module task = the sum of its commits' times (BUN3's calibration: 65 s median per
commit × (1 + 0.3 ln files), lognormal 0.6), each commit's time split across the files it touched.

Two orderings:
- **interfaces-first:** each module's interface (20% of its work) is written first, and waits only for the
  interfaces of the crates its crate depends on (the crate graph has no cycles). The rest of the module waits for
  the interfaces of the modules it uses.
- **strict:** a module waits until every module it uses is completely done. The cycles inside a crate are merged
  into one task, which one agent must do in sequence.

**Data before any run** (same c..e window as BUN3: 4,097 commits, 1,221 files):
- **Total work:** ~119 agent-hours. Spread perfectly over 64 agents that is 1.9 h; BUN3 took 26.2 h, so its agents
  were busy ~7% of the time.
- **Biggest single module:** `runtime/bake/DevServer.rs` at ~2.2 h. Next: `bundle_v2.rs` 1.9 h, `Blob.rs` 1.7 h,
  `server_body.rs` 1.7 h.

**Predictions:**
1. **Interfaces-first finishes c+d+e in ~5–7 h at 64 agents, 4–5× faster than BUN3's 26.2 h.** The critical path is
   the interface layers through the crate graph (~0.3–0.5 h per layer) plus the biggest module's remaining 80%
   (~1.8 h).
2. **640 and 6,400 agents gain little over 64** (≤ 20%). The work spread over 64 agents (~1.9 h) is already
   shorter than the critical path. Most parallelism appears right after the interfaces: hundreds of modules at
   once for a short while.
3. **Strict ordering is no better than BUN3, likely worse.** The modules inside a crate use each other in cycles,
   so whole crates merge into single tasks, and `src/runtime` (~57% of the work) becomes one agent's serial job.
4. **Agent-hours ≈ 119** in both orderings, against BUN3's 64 agents × 26.2 h mostly waiting. No collisions:
   owners never share a file.

So **the chain is mostly how the work was cut, if a port can be cut interfaces-first.** If it cannot, the chain is
real.

**Caveats** (as the manager asked):
- **No handoff cost.** Merging a file's commits assumes one agent could do them in sequence, without the
  re-reading a handoff costs, and that it would take as long as the many agents did.
- **Module order from imports is an approximation.** `use` lines show what a module needs, not when; "interface =
  20% of the work" is an assumption (sensitivity 10–30%).
- **Bun did do a draft port first** (phase a, 100-file batches), which plays the role of interfaces here.

**Falsifiers:**
- interfaces-first takes more than 13 h at 64 agents (less than 2× BUN3);
- 640 agents are more than 1.5× faster than 64 (then work, not the critical path, binds).

### (k) results (2026-10-12, `node sim/bun/modules.mjs --graph` then `--sweep`; sim/bun/modules.json, sim/bun/bun5-sweep.jsonl)

**Label: simulated from Bun's real structure, not replayed.** The tasks, files, commit counts, crates, modules and
`use` edges are real, and the work times are BUN3's calibration. The interface/body split and the module order are
modelled.

A real-patch replay cannot check this, for two reasons:
- Bun's patches were not cut into interfaces and bodies.
- Replaying each file's commits in that file's own history order always rebuilds the file exactly, in any order
  between modules: hunks depend only on their own file. So "the tree ends equal to history, with 0 cross-module
  conflicts" holds by construction and carries no information.

What owner-per-module could really break is compiling against dependencies at an earlier state. Checking that
needs Bun's toolchain and a `cargo check` per step, out of scope here as it was for BUN3.

**The structure, from the tip's code:**
- 108 crates, 1,160 modules reached from the crates' `lib.rs`, 9,881 `use` edges (a median module uses 5 others,
  p90 20).
- The crate graph is **25 layers deep**.
- The c..e window touched 1,221 files. 852 of its 1,123 `.rs` files are reachable modules at the tip; the rest
  were renamed or deleted before the tip, and keep their crate (by directory) with no `use` edges.
- The re-cut has 4,080 commits in 1,221 one-owner tasks.

Three seeds; times include a final 15-minute full check:

| ordering | 64 agents | 640 | 6,400 | unlimited | critical path | most at work at once | biggest task | vs BUN3's 26.2 h |
|---|---|---|---|---|---|---|---|---|
| interfaces-first, interface = 10% of a module | 3.41 h | 3.40 | 3.40 | 3.40 | 3.40 h | 482 | 2.03 h | **7.7× faster** |
| interfaces-first, 20% | **4.29 h** | 4.29 | 4.29 | 4.29 | 4.29 h | 452 | 1.81 h | **6.1× faster** |
| interfaces-first, 30% | 5.18 h | 5.18 | 5.18 | 5.18 | 5.18 h | 444 | 1.58 h | 5.1× faster |
| strict (wait for used modules to finish) | 89.1 h | 89.1 | 89.1 | 89.1 | 89.1 h | 396 | 87.6 h | 3.4× slower |

Agent-hours are 118 in every cell: the same work, now with no waiting on handoffs.

**Against the prediction:**
1. **Better than predicted.** Interfaces-first takes 3.4–5.2 h at 64 agents, 5–8× faster than BUN3 (predicted
   5–7 h, 4–5×). The critical path is the interface layers through the 25-deep crate graph plus the biggest
   module's remaining work.
2. **Held.** 640 and 6,400 agents gain nothing over 64: the run is exactly its critical path at every size. At
   most 444–482 modules are worked at once, right after the interfaces.
3. **Held, and worse than said.** Strict ordering takes 89 h, 3.4× slower than BUN3: the modules use each other in
   cycles, and **74% of all the work** falls into one cycle that one owner must do in sequence.
4. **Held.** About 118 agent-hours.

No falsifier fired: interfaces-first stayed under 13 h, and 640 agents were not faster than 64.

**Answer.**
- **Bun's chain is mostly how the work was cut, provided the port can be cut interfaces-first.** Give each
  module one owner, so the per-file chains stay inside one agent. Order modules by the crate graph, interfaces
  before bodies. The same work then finishes about 6× sooner, and 64 agents are already enough.
- **Without interfaces-first it is worse than Bun's own way.** The use graph is so cyclic that "finish what you
  depend on first" serialises three quarters of the port.
- **Bun's actual method sat between the two.** Phase a's draft port acted as interfaces, but the work was then
  cut per error, not per module.

**Caveats** (repeated, because they carry the result):
- **One owner per module assumes no handoff cost** and that one agent works through a module's commits as fast as
  many did.
- **"Interface = 10–30% of a module" is an assumption.** The result moves 3.4–5.2 h across that range, never near
  26 h.
- **Order from `use` lines is an approximation** of what must exist first.
- **Not checked with real patches, and a text replay could not check it** (see the label above). Only a
  compile check per step could.

### (k) checked against the real patches: names a module needs from other files (qb5, sim/bun/bun5check-*.json)

qb5 read every real c+d+e commit's added Rust lines. For each one, it listed the names the commit defines
(fn/struct/enum/trait/type/const/static/union/mod/macro_rules) and the names it uses from another file. Each such
use is a **need** on that other file; 4,471 in all. Names that existed before the segment, or are defined in 2+
files, were skipped. Matching is lexical, so needs are an upper bound. The per-file sanity check passed: 19,272
hunks applied, 0 failed, 1,221 of 1,221 files equal to history.

Missed needs (the order would start X's body before the name exists):

| order | all needs | both files in modules.json (3,344) |
|---|---|---|
| strict (whole used modules first) | 27% | **3%** |
| interfaces-first, direct uses only (the (k) model) | 41% | **25%** |

Most of interfaces-first's misses are in the same crate without a direct `use` edge (1,240), likely re-exports
through `lib.rs` and glob uses. Another 576 are in a crate that is not a dependency, mostly files the tip no
longer has. So the tip's `use` graph captures the real needs well (strict misses 3%); "direct uses only" is too
thin.

**Fix, and what it costs** (`scope` in modules.mjs, 3 seeds, 64 agents):

| interfaces-first, a body waits for… | interface 10% | 20% | 30% |
|---|---|---|---|
| the interfaces it uses directly (as in (k)) | 3.41 h | 4.29 h | 5.18 h |
| every interface in its own crate | 3.40 h | 4.29 h | 5.18 h |
| every interface in the codebase (two phases) | 3.41 h | 4.31 h | 5.21 h |

A crate's interfaces are short and written in parallel, so the stricter waits cost almost nothing. In the
two-phase order (all interfaces, then all bodies) no body starts before any name another file defines, as long as
defined names belong to interfaces. The **5–8× speed-up over BUN3 survives the name check.**

The open assumptions are unchanged:
- **Interfaces can be written first**, and they are 10–30% of the work.
- **One owner per file has no handoff cost.**

**Label, updated:** *simulated from Bun's real structure; the module order was checked against the names Bun's
real patches use across files (strict order misses 3%; two-phase interfaces-first meets them by construction at
no time cost); not replayed.*

## (l) Fleet at scale: where does our side break? (qb4, 2026-10-13, before S2-S5 run)

**Question.** Model rate limits are taken out of the way by cached-answer mode (S3): reuse the comments already made for
the same file content, with everything else real. That leaves agents, the Run queue, verify, the Lander's lanes, the
door and Artifacts pushes. At 200 / 1,000 / 5,000 agents over N repo copies, which one saturates first, and at what
rate? Then real-model mode: what is the summed ceiling of the models?

**Path of one file today** (sim/fleet/src/index.js):

1. **Agent DO alarm.** `Run.next()` is one RPC to the copy's Run DO, which does a storage get and put of its state plus
   SQL.
2. **Read.** `ARTIFACTS.get(repo)` then `readBlob`.
3. **Check.** `targets()` is one TypeScript parse, then `insert()`, then `verify()`, which is two parses plus a
   token walk.
4. **Record.** `Run.done()` is another state get/put plus a SQL insert. For a ready file it awaits `Lander.add()`,
   which gets and puts the whole `lanes` object plus the file text.
5. **Next file** after a 50 ms alarm gap.

Every 5 s the copy's Lander DO builds one commit per lane: JS SHA-1, deflate through `CompressionStream`, `readTree`
along each changed folder. It pushes all of them to the copy's main in one push.

**Cloudflare's documented limits that apply** (cloudflare-docs, 2026-10-13):

| limit | value | where it bites |
|---|---|---|
| one Durable Object | ~500-1,000 req/s simple, ~200-500 req/s with storage writes ('rules of Durable Objects'); past it 'overloaded' errors | Run DO (2 writing requests per file), Lander DO (1 per ready file) |
| Artifacts git requests | 2,000 per 10 s **per artifact** (200/s) | readBlob per file, readTree + push per Lander round, on each copy |
| Artifacts control plane | 2,000 per 10 s **per namespace** (200/s) | anything counted as control plane, shared by **all** copies: create, tokens, and possibly `ARTIFACTS.get()`, which the Agent calls once per file |
| isolate memory | 128 MB | the Lander holds each round's file texts plus objects |
| CPU per invocation | 30 s default, up to 5 min | the Lander round; the Agent's verify |
| subrequests | 10,000 per invocation (paid) | Run.start of 5,000 agents is one invocation; a Lander round's readTrees |
| DO stub creation | 'account generating too much load on Durable Objects' (rate not documented) | starting thousands of Agent DOs at once |
| Artifacts operations | $0.15 per 1k past 10k/month, billed from **2026-10-14** ('create, push, pull, clone'; whether readBlob counts is not documented) | if a read counts: ~$0.15 per 1k files |

**Per-agent pace in cached mode** (estimate): about 300 ms per file, so ~3 files/s per agent. That is two cross-object
RPCs at 20-100 ms each, an Artifacts read of 30-100 ms, ~10-30 ms of CPU for the TypeScript work, and the 50 ms gap.
Demand: 200 agents ~600 files/s; 1,000 ~3,000/s; 5,000 ~15,000/s.

**Prediction for cached mode, in the order things saturate:**

1. **The namespace control plane, if `ARTIFACTS.get()` counts (likely first, at ~70 agents).** It caps all copies
   together at ~200 files/s. 200 agents would want 600/s: expect 429s from `get()` and flat throughput near 200/s
   however many copies. Fix (ours): get the repo handle once per agent and keep it, not once per file. If `get()`
   does not count, this line drops out.
2. **The per-copy Run DO and the per-artifact git rate, at ~50-80 agents per copy.** Each copy's Run DO takes 2
   writing requests per file, so ~100-250 files/s. Its reads hit the per-artifact 200 git requests/s. Expect 'Durable
   Object is overloaded' or Artifacts 429s, with per-file ms rising while files/s per copy stay flat.
   - 1,000 agents on 10 copies is 100 per copy: ~150-200 files/s per copy, ~1,500-2,000 files/s in all.
   - Fix: more copies (agents per copy at most ~50). In the Run DO, batch `next()` (hand out 5-10 files per call) and
     keep the counters in SQL instead of rewriting one state object on every request.
3. **The Lander DO per copy** comes later. `add()` rewrites the whole `lanes` object (O(waiting files)) once per
   ready file, so it slows as the backlog grows. At ~200 files/s per copy, a 5 s round is ~1,000 files (~16 MB of
   text): fine for memory and ~1-2 s of CPU. It would break near ~8,000 files per round (memory). Fix: store lanes in
   SQL rows, not one object.
4. **Agent verify CPU** is only a ceiling if the Agent DOs share a few isolates: they are placed near their creator,
   the Run DO, and run on single-threaded isolates. At ~20 ms per file that would be ~50 files/s per isolate. Sign:
   per-file ms grows with the agent count while the Artifacts and DO counters stay calm.
5. **Starting 5,000 agents** from one `Run.start` call: ~5,000 subrequests, under 10,000. Stub creation may answer
   'too much load': stagger the starts (already random over 3 s; make it 30-60 s at 5,000).
6. **The door** (one push per copy every ~5 s, up to 200 files per lane) is not the limit at any of these rates.
   With 10 or more copies there are 10 or more doors.

**What the ladder needs** (tell qb6):
- **Copies.** Agents per copy at most ~50 to measure our own ceilings rather than the per-copy one, so 200 agents
  need 4+ copies, 1,000 need 20+, and 5,000 need 100+. To show the per-copy ceiling on purpose, run one cell with
  100+ agents on one copy.
- **Corpus.** At ~3 files/s per agent, one copy (4,120 files) lasts ~14 s at 100 agents per copy. Each step needs
  ≥3 minutes of steady state, so let the queue cycle over the copies' base blobs. A second pass lands identical text,
  i.e. no-op commits. The commits are not the point; the rate through every stage is. Alternatively, use enough
  copies: rate × 180 s / 4,120.
- **What to read at each step:**
  - files/s per copy and in total;
  - per-file ms, split into next / read / verify / done;
  - Artifacts 429s, split into control plane vs git;
  - 'overloaded' errors per DO class;
  - the Lander's waiting files and round time;
  - CPU per invocation.

**Cells:**

| cell | agents | copies | expected files/s | expected first limit |
|---|---|---|---|---|
| S4a | 200 | 4 | ~200 if `get()` is control plane, else ~600 | namespace control plane, or none |
| S4b | 200 | 1 | ~150-200 | per-copy Run DO / per-artifact git rate (the deliberate ceiling) |
| S4c | 1,000 | 20 | ~200 or ~3,000 | the control plane again; else Agent CPU placement, DO creation at start |
| S4d | 5,000 | 100 | ≤ the S4c rate x copies, if nothing shared breaks | start-up load (DO creation); the namespace control plane at any rate above 200/s |

If the namespace control plane caps the whole fleet at ~200 files/s, that is 12,000 files per minute. Fixing
`get()` per file is ours. Anything else per namespace needs more namespaces (one per ~1,000 agents).

**Cost.** DO requests run about five per file, ~$0.75 per million files. Artifacts operations are free today: billing
starts 2026-10-14. If each read counts from tomorrow, it is ~$0.15 per 1k files, so the $50/day cap would allow
~330k files, about 20 s at 15,000 files/s. Run the cached ladder today.

**Real-model mode (S5): the summed model ceilings.**
- **Limits:** Workers AI has 300 requests/min per model per account. Gemini paid tier 2 has 360/min per model per
  project, and each Gemini model counts separately.
- **Sum:** gemma-4 + glm-4.7 + glm-5.3 + Gemini 3.1 flash-lite = 300 + 300 + 300 + 360 = 1,260 calls/min. Adding
  gemini-3.5-flash-lite gives 1,620.
- **Files per call:** files with nothing to document make no call (26-67% of files in the runs so far), so files/min
  ≈ calls/min / (1 - skip share). At ~30% skipped that is ~1,800 files/min, ~30 files/s.
- **Agents needed:** rate × latency. Gemma ~30 (6 s), glm-4.7 ~65, glm-5.3 ~70 (13-14 s), Gemini ~12 (2 s): ~180
  agents in total. Past ~200 agents, real mode gains nothing.
- **Measured so far:** the pacer kept the models at 191-207 calls/min against 290-350 configured, and a pacing slice
  can idle at a 10 s edge. Expect ~75-85% of the sum: ~1,000 calls/min, ~1,400 files/min.
- **Untested:** Workers AI's 3040 out-of-capacity answers at a sustained 300/min.

Real mode tops out near 30 files/s whatever the agent count; cached mode should reach hundreds to thousands per
second. The S4 ladder therefore finds our ceilings well above anything the models allow today.

### (l) results as they come (qb6's S4 ladder, measured)
**S4a: 200 agents on 4 copies (50 per copy), cached mode.** 227 files/s.

| step | prediction | measured |
|---|---|---|
| namespace control plane (#1: `ARTIFACTS.get()` per file) | ~200 files/s if it counts as control plane, else ~600 | **did not throttle**: 0 errors at 227 get() calls/s. Ruled out at this rate, but its rate sat close to the documented 200/s, so it is not yet shown at 3x that |
| per-copy Run DO round trips (#2) | ~100-250 files/s per copy, flat throughput, per-file ms rising | **the limit.** Per copy ~57 files/s, below my per-copy range: per-file work p50 119 ms (read 88 ms), but each agent idled p50 316 / p90 592 ms between files in next() + done() |
| Lander `add()` object rewrite (#3) | slows as the backlog grows | **visible already**: land wait p50 52 s, p90 87 s (F3 at real-model rates: p90 18 s) |

What it says:
- The first limit was ours, as predicted for #2, but it came earlier than my numbers. At ~57 files/s per copy, the
  Run DO's two state rewrites per file cost ~2-3x more than the docs' 200-500 writing req/s suggested.
- qb6 is fixing #2 and #3 before S4b (200 agents on 1 copy): indexes, an auto-pause check every 50 files instead of
  every file, agents calling the Lander directly, batched `next()`, and lanes as SQL rows.
- #1 stays the thing to watch at S4c (1,000 agents), where `get()` would run at ~1,000/s.

**S4b: 200 agents on ONE copy, cached mode, after qb6's fixes** (batched next/done with 5 files per call, Lander lanes
as SQL rows, indexes). 4,064 files in 22.7 s = **178 files/s on one copy**, ~3x S4a's ~57 per copy.

| | prediction (S1 #2: ~100-250 files/s per copy) | measured |
|---|---|---|
| files/s per copy | 100-250 | 178: inside the range once the per-file state rewrites were gone |
| what queues | the Run DO | still the Run DO: agents idle between batches p50 397 ms / p90 1.1 s, ~80 ms per file (S4a: 316 ms per file) |
| per-copy git rate (200/s per artifact) | near the same point | not hit: 0 Artifacts 429s at ~178 reads/s, just under 200/s |
| Lander (#3) | gone with SQL rows | land wait p50 25 s / p90 35 s; 3 pushes, 444 lane commits, 0 stale |
| errors | 'overloaded' past the limit | 0 overloaded, 0 infra errors |

Per-file work p50 131 ms, with the blob read p50 76 / p90 287 ms. Caveats: one copy lasts 23 s, so this is a burst, not
a steady state; its 178 reads/s also sit just under the per-artifact 200/s, so S4b cannot tell the Run DO apart from
the git rate as the next wall per copy.

For S4c (1,000 agents, 20 copies of 50): at ~3.5 files/s per agent the expected demand is ~3,500 files/s (~175 per
copy, as in S4b). The shared limits get their first real test there: 3,500 `ARTIFACTS.get()` calls/s against the
documented 200/s namespace control plane (#1), and starting 1,000 agents at once (#5). If #1 counts, expect a hard
flat line near 200-230 files/s in total and 429s on get(). If not, ~3,000+ files/s.

**S4c: 1,000 agents on 20 copies (50 each), cached mode, batch 5.** The copies were VS Code src x5, VS Code
extensions x5, next.js x5 and angular x5. 50,140 files in 68 s; all 30,410 changes landed within 128 s of the first
file.
- Outcomes: 19,670 nothing to document, 60 cache misses, 0 verify failures, 0 infra errors, 0 overloaded, 0
  Artifacts 429s.
- Peak 10 s window: 1,230 files/s with 12 copies running at once (the copies started over ~2 min).
- Per copy: 122-215 files/s over its own run, median ~160, but ~100/s per copy in the peak window.
- Blob read p50 135 / p90 356 / p99 615 ms (S4b: 76 / 287 ms). Land wait p50 28 s / p90 52 s.

| | prediction | measured |
|---|---|---|
| #1 namespace control plane (200/s documented) | a hard flat line near 200-230 files/s if `get()` counts | **wrong**: get() + readBlob ran at ~1,230/s in one namespace with no 429s. As a hard limit, the documented 200/s does not apply to these calls |
| per-copy limit (#2 / per-artifact git rate) | ~175/s per copy, as S4b | ~160/s median per copy on its own run, as predicted |
| new: a shared slowdown | not predicted | **as copies overlap, every copy slows**: per-copy rate down ~40% and read latency up ~1.8x at 1,230/s. The Run DOs are per copy, so the shared part is on Artifacts' side (namespace or storage). It slows rather than refuses |

**Prediction for S4d (5,000 agents, 100 copies), from that slowdown.** Treat Artifacts reads as one shared server
whose latency grows as L = L0 / (1 - rate / capacity). The two points, 76 ms at ~178 reads/s (S4b) and 135 ms at
~1,230/s (S4c), give **L0 ≈ 71 ms and a capacity near ~2,600 reads/s** for the namespace. That is two points and an
assumed curve, so treat it as a rough guide.
- At 5,000 agents demand would be ~6,000+ files/s.
- So S4d should flatten near **~2,000-2,500 files/s in total, with read p50 climbing to ~0.5-1 s and no errors**:
  a wall that shows up as latency, not as 429s.
- If S4d instead keeps scaling past ~3,000/s, the slowdown was start-up overlap rather than a capacity.
- A cheap way to tell a namespace capacity from an account or storage one: S4e, the same 5,000 agents with the copies
  split across 2 namespaces. If the ceiling doubles, it is per namespace (fix: shard namespaces). If not, it is
  account- or storage-wide.
- Copies should start together (S4c's starts over ~2 min diluted the overlap). Peak windows should be read with the
  number of copies running at that moment.

**S4d: 4,750 agents on 95 copies (50 each), cached mode, batch 5.** 128,866 files in 110 s.
- 63,441 changes landed, all within 171 s of the first file; 65,227 files had nothing to document.
- 190 cache misses, 0 verify failures, 0 infra errors, 0 429s, 0 overloaded, 0 Lander errors.
- The copies did not all overlap: 95 starts took 98 s and a copy finishes in ~20 s, so at most 42 ran at once.

| 10-s window: copies running | files/s | read p50 | fit L = 71 / (1 - rate/2,600) |
|---|---|---|---|
| 37 | 1,862 | 164 ms | ~250 ms |
| 42 | 1,636 | 190 ms | ~190 ms |
| 40 | 2,139 | 273 ms | ~400 ms |
| 35 | 2,137 | 353 ms | ~390 ms |
| 27 | 1,705 | 329 ms | ~205 ms |
| 13 | 642 | 789 ms | ~95 ms |

Read p50 / p90 / p99: 255 / 843 / 1,659 ms (S4c: 135 / 356 / 615).

| | prediction (from S4c) | measured |
|---|---|---|
| total rate | flattens near ~2,000-2,500 files/s | **flattens at ~2,100 files/s** whether 35 or 42 copies run |
| how it shows | read latency rising to ~0.5-1 s, no errors | read p50 to ~350 ms at the plateau, p90 843 ms, p99 1.7 s; **nothing refused** |
| per copy at the plateau | (S4b alone: 178/s) | ~53/s |

What it says:
- **The wall is on Artifacts' side and shows up as latency.** The shared read path saturates near ~2,100 reads/s in
  one namespace. Our parts did not fail at 4,750 agents: Run DOs, Landers, verify and the door.
- **The fit was right on the plateau and early on latency in the middle.** At 1,862/s it said ~250 ms where 164 ms
  was measured.
- **The fit misses the tail.** The last window (13 copies, 642/s) still read at p50 789 ms, where an unloaded server
  would be near ~95 ms. Either a backlog drains slowly, or the last copies are heavier ones (bigger files or trees). So
  latency does not fall back as soon as load drops: a pure capacity-only model is not the whole story.
- **One bug, found and fixed by qb6:** 8 files landed in git but stayed 'ready' in the records. Agents handed a file
  to the Lander before writing its record, and a fast landing won. The order is now swapped.

S4e will tell a per-namespace capacity from an account- or storage-wide one: the same run split over 2 namespaces, with
the trees pre-listed so all copies start within seconds.
- If the plateau goes to ~4,000+ files/s, it is per namespace, and sharding namespaces is the fix.
- If it stays ~2,100, it is account- or storage-wide.

**S4d tail, explained in part (qb6).** It is not the heavier repos. In the 13:03:10 window (6,422 files), read p50
was angular 946 ms, next.js 958 and vscode-ext 216 (p90 1,072). At the peak every kind read at ~200-250 ms. Inside the
window read p50 went 191 ms (first 2 s) -> 986 -> 742 -> 812 -> 697 while the rate fell: one step change for all kinds
at once.

qb6's reading: by then ~60 copies' Landers were pushing big batches. That points to writes slowing reads, not read load.
It fits the residual the read-only fit left, and it changes the model.
- **Model:** Artifacts' shared capacity serves reads and writes together, roughly
  L_read = L0 / (1 - (reads/s + w x pushed-bytes/s) / capacity), where w is the weight of a written byte.
- **Not provable for S4d:** pushes were not logged.
- **S4e logs it:** each series slice now carries door {pushes, files, ms}.

S4e predictions under that model:
1. Read latency follows push load from one slice to the next, at the same read rate.
2. The read-only plateau (~2,100 reads/s) is lower whenever many Landers push at once.
3. Two namespaces double the plateau only if their storage is separate as well.

Fixes on our side if (1) holds: Landers push smaller batches more often, staggered across copies (no synchronized
bursts); or reads and writes in different namespaces. The door moves fewer bytes per second either way; the gain is in
not lining the pushes up.

**S4e: 4,400 agents, 88 copies split over 2 namespaces** (44 in qbfleet, 44 in qbfleet2; babel and nest, the same
bases). All 88 started within 0.9 s. 56,410 files; 21,736 landed (all, after a fix to the git notes); 33,044 nothing
to document; 176 cache misses; 0 verify failures.

| 10-s window | total files/s (qbfleet / qbfleet2) | read p50 (qbfleet / qbfleet2) |
|---|---|---|
| 13:33:40 | 1,527 (900 / 627) | 591 / 515 ms |
| 13:33:50 | 3,033 (1,504 / 1,528) | 868 / 948 ms |

After that the copies ran out of files.

| | the S4d readout | measured |
|---|---|---|
| ~4,000+ files/s | per-namespace capacity | no |
| ~2,100 flat | account- or storage-wide | no |
| **between** | | **~3,000 files/s: ~1,500 per namespace** at ~44 copies each, where one namespace gave 2,100 at ~40 copies in S4d. Read latency ~3x S4d's |

What it says:
- ~~**Part per namespace, part shared.**~~ **Corrected by R10K-c (2026-10-14): the read limit is account-wide, not per
  namespace.** 3 namespaces held ~1,900 files/s over a whole run. S4e's 3,000 was one 10-s window, a burst; it does
  not show a second namespace adding capacity. (Original reading: a second namespace added ~45%, not 100%.)
- **A cold namespace failed instead of slowing.** qbfleet2 threw 1,454 'An internal error occurred' on blob reads in
  that window; qbfleet threw 0. Forks fresh in a new namespace under a cold burst failed outright, the first refusals
  in the whole ladder. Fix on our side: warm a new namespace's copies (one slow pass) before a burst, and retry a read
  that failed internally with backoff.
- **The push question (do writes slow reads) is still open.** The Landers' pushes were refused for ~15 min by a git
  notes bug (atomic multi-ref with a stale notes tip, fixed), so reads and pushes never overlapped in S4e.
- **Thin evidence.** One ~10 s window at ~3,000 files/s. A longer reading needs more files per copy: the VS Code
  copies are 2-4x bigger than babel and nest.

**Where the S4 ladder leaves our side** (cached answers, so no model limits):

| run | agents | result |
|---|---|---|
| S4a | 200 | 227 files/s; the per-copy Run DO was the wall, fixed |
| S4b | 200 on one copy | 178 files/s |
| S4c | 1,000 | 1,230 files/s, no errors |
| S4d | 4,750 | a ~2,100 files/s plateau in one namespace that shows up as read latency |
| S4e | 4,400 over 2 namespaces | ~3,000 files/s; a cold namespace's reads failed |

Our components (Run DOs after the fix, Landers, verify, the door) never were the limit after S4a. The limit is Artifacts'
shared read path. Every model limit is far lower: at most ~30 files/s for all models together (S5 below), against
~2,000-3,000 files/s of headroom on our side.

**S5 prediction** (real models at their limits; see the real-model paragraph above):
- ~1,000 model calls/min (75-85% of 1,260), ~1,400-1,800 files/min (~25-30 files/s), with ~180-250 agents busy.
- Agents beyond that wait.
- The fleet's own side runs at ~1% of the capacity S4 measured.

**S5 v1: real models at their limits, one model per copy of VS Code src/vs** (4,064 files each, no batching, started
together at 13:58).

| | prediction | measured |
|---|---|---|
| first limit | the models (~1,000 calls/min at 75-85% of 4 x ~300) | **our own AI Gateway**: qodebase-fleet's 1,200/min sliding limit, shared by every model, answered '2003 rate limited' after ~860 calls in ~25 s. All 4 runs auto-paused at 28% 429s. Raised to 3,000/min for S5 (to go back to 1,200 after) |
| glm-4.7-flash | 300/min (docs) | held its 400/min pace for 5 min with 0 errors: **its real limit is above 400**, beyond the documented 300 |
| gemma-4-26b | 300/min | **'3040 capacity temporarily exceeded' from ~210-260/min** (30 of them, 33% of a window; paused twice). Workers AI ran out of gemma capacity, a ceiling below the rate limit. I had flagged 3040 as untested |
| glm-5.3-flash | 300/min | **its own '3021 per-minute limit' at ~35/min**, and slow: p50 14.6 s, 553 output tokens a call. It was thinking, see below |
| gemini-3.1-flash-lite | 360/min (tier 2, as seen by the manager) | **1,500 calls in one minute**, 0 429s: the project's tier is far above 360 |
| combined peak | ~1,000/min, ~25-30 files/s | **~2,170 calls/min, ~36 files/s** (14:03-04) |

What it says:
- **The first wall was ours again**, this time a configuration value (the gateway limit).
- **Documented per-model limits were wrong both ways.** glm-4.7 and Gemini allowed more; gemma hit capacity errors
  below its documented limit; glm-5.3 has a separate low limit.
- **Why glm-5.3 thought at length:** with `chat_template_kwargs: {enable_thinking: false}` glm-5.3-flash still thinks.
  F0 measured that it needs `reasoning_effort: "low"` (6 output tokens vs 42 on a trivial call). The 553 output
  tokens a call and the 14.6 s p50 come from that setting. Fixed per model, its rate and latency should look like F0's
  (p50 ~14 s with the low setting, ~7k output tokens per 20 files).
- **Cost and quality per file landed:** glm-4.7 $0.00019, gemma $0.0003, Gemini 3.1 $0.00086, with ~2,500-2,900
  input and 85-90 output tokens a call. 0 verify failures; 21 rejected answers in 7,257 calls.

**Prediction for batching** (several small files per call up to a token budget, verify per file; Eyal's next step):
- **What it saves:** input dominates (~2,700 in vs ~90 out a call), and the fixed instructions are ~330 tokens of
  that. So batching saves ~10-15% of tokens. Its real gain is calls: rate limits count calls, not tokens.
- **Files per call:** with a budget of ~8k input tokens and a median file ~6 KB (~1.7k tokens), ~4 files a call, more
  for small ones. Files/min under the same call limits rises ~3-4x: from ~36 to ~100-140 files/s at S5's call peak.
- **Latency:** gemma and glm-4.7 grow roughly with output tokens, so ~4x per call; Gemini stays fast.
- **Risks:**
  - a comment keyed to the wrong file. Per-file verify cannot catch it, since the code is unchanged. Keep the answer
    keyed by file, then by name, and refuse any key that is not in that file's targets;
  - one bad JSON loses k files at once: retry the batch split in halves.
- **Bench to read** (50 files, one per call vs batched): files per call, calls/min per model at the limits, latency,
  $ per 1k files, rejected share, comments per file (batching may make the model skip more), and the 3040 rate for
  gemma (bigger calls may hit capacity sooner).

**Batching bench (qb6, 656f490).** The same 51 VS Code src/vs files, all needing comments: one per call vs packs of up
to 8 files or 12k tokens. Packs are keyed by file then name, names outside a file's targets are refused, each file is
verified on its own, and a failed pack is retried in halves.

| | prediction | glm-4.7-flash | gemini-3.1-flash-lite |
|---|---|---|---|
| files per call | ~4 at an ~8k budget | 2.3 (51 -> 22 calls) | 1.9 (51 -> 27) |
| $ per 1k files | -10-15% (the instructions are shared) | $0.207 -> $0.204 (~0) | $0.96 -> $1.29 (+34%: one pack retried in halves) |
| comments per file | maybe fewer | 2.84 -> 2.65 | 2.84 -> 2.88 |
| call latency | ~x files per call | p50 3.5 -> 16 s (4.6x for 2.3x the files) | |
| lost files | one bad JSON costs a pack | 0 | 2 (no answer in a 2-file pack) |
| blind A/B, gpt-oss-120b (one-per-call better / packed better / tie) | | 13 / 17 / 20; 'wrong comment' 13 vs 9 | 9 / 14 / 26; wrong 9 vs 2 |

What it says:
- **Files per call came in below ~4,** limited by size: src/vs files are ~2,700 tokens, and an agent's batch of 10 held
  only ~7 files to document.
- **Token cost did not fall,** not even the predicted 10-15%. The per-file input (the file itself) is almost all of a
  call, and a retry costs more than the shared instructions save.
- **No quality loss within the judge's noise,** and no mis-keyed comment.
- **Per-call latency grew faster than files per call** (4.6x for 2.3x), so a pack costs more agent-seconds per file.
  The gain is only under call limits.

**Prediction for S5 v2.** 3 copies, each running gemma and glm-4.7 with Gemini 3.1 as overflow, paced so the three
together sit at each model's measured limit: gemma 255/min, glm 405, Gemini 1,500. Budget 24k tokens, up to 10 files
a call, batches of 20 per agent.
- **Files per call:** ~6-8 for Workers AI, ~5 for Gemini.
- **Latency:** glm grows past 30 s a call. Keeping 405 calls/min needs ~200+ calls in flight, so ~200+ agents busy on
  glm alone.
- **Gemma:** bigger calls use more capacity per call, so expect its 3040 'capacity exceeded' to start below 255/min.
- **Throughput:** at full call rates, ~(405 x 6 + 255 x 6 + 1,500 x 5) / 60 = **~190 files/s**. With glm short of
  agents or gemma tripping 3040, ~100-150 files/s, with Gemini taking most of the files as overflow.
- **Run length:** 3 copies x ~4,060 files is ~12k files, about 1-2 minutes at that rate. The peak windows are the
  reading.

**S5 v2: batched, 3 copies x 150 agents** (gemma + glm-4.7 with Gemini 3.1 as overflow, 14:28-14:33). 8,984 files in
298 s: ~30 files/s, peak ~37. 8,910 landed, 74 rejected (64 of them Gemini), 0 verify failures, 0 429s, 0 3040s,
$6.84.

| | prediction | measured |
|---|---|---|
| files per call | ~6-8 (Workers AI), ~5 (Gemini) | gemma 5.1, glm-4.7 4.8, Gemini 2.7 |
| call p50 | glm > 30 s | gemma 14.8 s, glm 26 s, Gemini 5 s |
| throughput | ~100-150 files/s, Gemini doing most | **~30 files/s**; Gemini did 78% |
| Workers AI call rate | at each model's measured limit | **far below**: gemma ~30 calls/min of 255, glm ~55 of 405 |
| first limit | the models (gemma's 3040 first) | **our pacer again**: none of the model limits was reached |

**Why.** The pacer charges a pace slot per file when the file is picked. A pack's slots come back only after its
15-26 s call, in a later 10 s slice, so the pace counted files, not calls. Gemma ran at ~150 files/min across the 3
runs, i.e. its 85/min share x 3, counted in files. qb6's fix: one slot per pack (the other files in a pack ride free).

**Prediction for S5 v2b** (the same setup, the pacer fixed):
- **Workers AI at its call limits:** gemma 255 x 5.1 ≈ 1,300 files/min and glm 405 x 4.8 ≈ 1,940 files/min, together
  ~54 files/s.
- **Calls in flight:** 255 x 14.8 s + 405 x 26 s ≈ 240 calls. With 450 agents and one call each, that leaves ~210
  agents for Gemini.
- **Gemini:** at ~5 s a call those agents could make ~2,500 calls/min, capped at its 1,500, so ~67 files/s at 2.7 a
  call.
- **Total:** at most ~120 files/s; **~80-120 expected, 3-4x S5 v2.**
- **The first model wall should now be gemma's 3040 capacity:** 255 calls/min of ~5 files each use more capacity than
  S5 v1's single files did.
- ~12k files at ~100 files/s is ~2 min: read the peak windows.

**S5 v2b: the pacer fixed (one slot per pack); 3 fresh copies x 150 agents, 14:41-14:44.** 9,033 files in 151 s;
8,939 landed, 46 rejected, 0 verify failures, $5.79. Peak minute ~6,840 files = **~114 files/s (predicted 80-120)**.

| model | calls in the peak minute | files per call | files | call p50 | errors |
|---|---|---|---|---|---|
| gemma-4 | 201 | 5.8 | 1,141 | 25 s | **48 '3040 capacity exceeded'** from ~200 calls/min of 5-file calls: the first model wall, as predicted |
| glm-4.7 | 305 | 5.4 | 1,672 | 36 s | 0 |
| Gemini 3.1 (overflow) | 724 | 5.5 | 4,027 | 9.3 s | 0 429s |

- **Calls in flight** (rate x latency): gemma ~84, glm ~183, Gemini ~112: ~380 of 450 agents busy at the peak (predicted
  ~240 for Workers AI plus ~210 for Gemini).
- **$ per 1k files:** gemma $0.31, glm $0.18, Gemini $0.86.
- **With real models the fleet does ~114 files/s, ~5% of what our side carried with cached answers (S4d: 2,100).**
  The first wall is a model's capacity (gemma), then call limits and latency.

**Measured, 10,000 agents with the read cache** (qb6, 2026-10-14; docs/contest/fleet-r10k.md). Cached answers, no
model calls. 10 copies of src/vs, 1,000 agents each.
- **Throughput:** ~1,900 files/s when every file is different (36,555 Artifacts reads, p50 0.6 s / p90 1.2 s, none
  failed), ~2,350 when files repeat (every read cached). That matches the S4d plateau (~2,100) on Artifacts' read path,
  as S1 predicted from S4d. The cache does not lift the realistic case; it only removes repeat reads.
- **The ramp:** at most ~2,300 of the 10,000 were busy in any 10 s.
- **Next wall: landing.** There is one queue per copy, peaking at ~690 files/s landed, and landing took 2.5-3 min after
  the answers. 20,000 agents: not run (budget).
- **Run (c), 3 namespaces**, with a faster start (250 agents per 100 ms) and landing passes of up to 1,500 files/s:
  - **Throughput:** the busiest 10 s held ~1,900 files/s again.
  - **Faster overall:** start to all landed in 86 s (b: ~5 min), with ~1 min of landing after the answers, so landing
    is no longer the wall.
  - **Wall:** Artifacts reads for the whole account, ~1,900-2,000/s. More namespaces only made reads wait longer
    (p50 0.5-0.9 s), and none failed.
  - **This corrects my S4e reading:** "2 namespaces ~1.4x" was one 10-s burst, not a per-namespace ceiling.
- **Runs (d) and (e), best case: every read from the cache.**
  - **(d), 10,000 agents:** clean; ~2,085 files/s at the busiest; start to all landed in 82 s.
  - **(e), 50,000 agents over 50 copies:** ~12,400 files/s at the busiest, and landing peaked at ~7,000 files/s. 139,385
    changes landed in ~70 s and nothing landed wrong.
  - **But (e) lost 5.4% (10,943 files):** the per-copy Run Durable Objects answered "overloaded" at ~250 files/s each
    (a SQL row per file for 1,000 agents), and the fleet dropped the work instead of retrying.
  - **This is the S1 prediction's single-object wall** (a Durable Object handles ~500-1,000 requests/s; each file is
    several requests to its Run object). It hit our bookkeeping, not Artifacts, KV or landing.
  - **Without the cache, reads stop the fleet at ~2,000/s long before this.** So the bookkeeping limit matters only
    when the files repeat.
- **After qb6's fixes** (retries with backoff, batched writes, re-queueing work out too long):
  - **(f), 50,000 agents:** 3 not landed (0.0015%).
  - **(g), 100,000 agents over 100 copies:** ~21,100 files/s at the busiest, 298,857 landed in ~66 s, ~13,800 busy at
    once.
  - **(g)'s 43 not landed (0.01%):** their agents' invocations were cancelled during overload, so the hand-off retry
    never ran. That is the next fix.
  - **Throughput:** roughly linear in copies, since each copy has its own Run object and Lander. The bookkeeping objects
    are still the wall at the peaks.
- **(h), the 100,000 rerun with the re-issue sweep live:** 0 lost. All 298,900 landed in ~89 s; ~22,400 files/s at
  the busiest; ~12,300 busy at once. The sweep had nothing to redo.

## (m) Code collision dial: prediction before qb6's runs (qb4, 2026-10-13)

**Setup** (generator: lab-hidden/kata, private; public seed and tasks: sim/kata/seed-1):
- **Functions:** 400 small specified functions: 18 families (strings, dates, parsers) with variants, 80 distinct
  functions placed in 5 modules, one file each.
- **Tasks:** 1,385: one 'impl' per function plus 2-3 change requests (CRs). Each CR adds one option flag, so all CRs on
  a function compose.
- **Hidden tests:** 6,340 cases, never in a box or this repo. Each CR's cases include at least 2 where its flag changes
  the answer.
- **Checker check:** a reference solution passes 6,340/6,340; the untouched stubs pass 0. With one CR's option dropped,
  the checker flags exactly that 'requirement lost'.
- **The dial** is the share of tasks put in clusters: all of a function's tasks back to back, so different agents take
  them at the same moment (0% / 30% / 60% = 0 / 418 / 834 tasks). The rest are spread a whole layer apart (≥170 tasks
  between a function's tasks at dial 30, ≥91 at dial 60).

**Model** (sim/kata/predict.mjs, 10 runs per cell):
- A agents take tasks in order. A task takes T, lognormal with median T and σ 0.5.
- A finished task lands at the next Lander round (every 5 s) plus a 3 s push.
- A task is stale if another task on the same function landed after it read main. It is then replayed (redone on the
  new main, another T) and can go stale again; up to 3 tries.
- Each replay drops a requirement with probability pLost = 3%: an assumption. The one real number is R5's flagship, 1
  dropped in 28 model replays, ~4%.

| agents, T | dial | stale (replayed) tasks | requirement lost (pLost 3%) | wall |
|---|---|---|---|---|
| 100, 10 s | 0% | 9 | 0 | 198 s |
| 100, 10 s | 30% | 491 | ~15 | 283 s (+43%) |
| 100, 10 s | 60% | 954 | ~29 | 323 s (+63%) |
| 100, 30 s | 0% | 4 | 0 | 563 s |
| 100, 30 s | 30% | 468 | ~14 | 798 s (+42%) |
| 100, 30 s | 60% | 914 | ~25 | 958 s (+70%) |
| 150, 10 s | 0% | 81 | ~2 | 163 s |
| 150, 10 s | 60% | 973 | ~29 | 243 s |
| 50, 30 s | 60% | 909 | ~24 | 1,673 s |

Readings to compare against:
- **Stale tasks exceed the clustered ones** (~1.15 per clustered task). Within a cluster of k tasks, the first lands,
  the other k-1 replay together, the first of those lands, the rest replay again: k(k-1)/2 replays, finishing about k
  task-times after the cluster starts. **If qb6's harness replays stale tasks one at a time** (a merge queue that redoes
  them in order rather than all agents at once), stale counts fall to ~k-1 per cluster (~0.75 per clustered task) at
  the same wall time.
- **Dial 0 is not quite zero at 150 agents** (81 stale): the spread gap (≥91-185 tasks) is shorter than 150 agents x
  a few rounds. At 100 agents it is ~0.
- **Wall grows +40-45% at dial 30 and +60-70% at dial 60** for the same work: a cluster finishes ~k task-times after
  it starts, whatever the agent count.
- **Requirement lost scales with replays x pLost.** pLost is the thing the run measures: 3% gives ~15 / ~29 at dial
  30 / 60, 1% gives ~5 / ~10, 10% gives ~50 / ~95. The checker counts it exactly ('requirement lost'), separated into
  clustered vs spread.

### (m) for qb6's actual harness: the real Landing queue
qb6's runs go through qodebase's own Landing. Each agent pushes one commit from its fork. A stale change is handled by
the merge queue (a model replay on the newest main, or a bounce back to the agent), not by the agent redoing it at
once, as the Monte Carlo above assumed. The setup: one project per dial level, 200 agents, trains of 8, a few seconds a
train. With 200 agents at ~10-30 s a task, supply (~400-1,200 tasks/min) is far above the queue's ~120-160/min, so the
queue sets the time.

- **Replays.** In a cluster of k tasks on one function, the first lands clean and each later one is stale against
  it. In the queue they replay one after another, since they touch the same file and side-by-side replays need
  non-overlapping files. So ~k-1 replays per cluster: **~299 at dial 30, ~593 at dial 60** (1,385 tasks; 119 and 241
  clustered functions), ~0 at dial 0.
- **Time.** Queue-only ≈ 1,385 / 8 trains x ~4 s ≈ **11-12 min at dial 0**. Each replay is a model call: R5 measured
  ~40 s each; Workers AI may be faster. Up to 4 run side by side across different files.

| dial | replays | wall at 20 s / replay | wall at 40 s / replay |
|---|---|---|---|
| 0% | ~0 | ~12 min | ~12 min |
| 30% | ~299 | ~36 min (3x) | ~61 min (5x) |
| 60% | ~593 | ~61 min (5x) | ~110 min (9x) |

  The merge queue's serial replays become the wall as the dial rises: time grows with the replay count / 4, not with
  agents.
- **Bounces instead of replays** (a replay that fails goes back to the agent): each adds an agent task-time plus
  another queue pass. Expect the clustered tasks' last members to land last.
- **Requirement lost** ≈ replays x pLost. At pLost 1-10%: **dial 30 ~3-30, dial 60 ~6-60**, all among
  `resolution: replayed`. The checker splits lost requirements by resolution (clean / replayed / lead). A loss on a
  'clean' landing would be a new kind of bug.

**Measured, dial 30** (qb6, eyal/kata-d30, 2026-10-13; checker with --attribute):
- **Replays: right order of size.** 229 model replays against the predicted ~299, plus 238 redos (bounces back to the
  agent), which the prediction did not count separately.
- **Wall: 145 min, against the predicted 36-61 min** (2.4-4x longer); dial 0 took 40 min. Redos added agent
  task-times and further queue passes, which the table priced at zero.
- **Losses did not rise with clustering:** 74 at dial 30 vs 96 at dial 0.
  - 66 were already wrong in the commit where they landed. 53 of these were clean merges, where the model wrote it
    wrong. 11 came from the 229 replays: ~5%, the same rate as fresh work (53 of 998 clean merges).
  - 6 were dropped by a later agent that read main with the requirement in (4 exact by base_sha).
  - 2 were lost in landing. Both were judged by the time rule, since their breakers predate base_sha, so 2 is an
    upper bound.
- **The prediction's "losses only among replayed" was wrong:** most losses are the models' own mistakes, whatever the
  resolution. The queue lost at most 2 of 1,264 landed changes.

**Measured, dial 60** (qb6, 2026-10-13; same seed, task order, 200 agents and model mix in both runs, with glm
taking 66 tasks in each):

| | baseline (eyal/kata-d60) | fast: module lanes + direct Haiku replays (eyal/kata-d60g) |
|---|---|---|
| wall | 207 min | 53 min (3.9x faster) |
| landed | 1,275 | 1,341 |
| requirements passing on main | 1,242 | 1,274 |
| lost (wrong at landing / dropped by a later agent / lost in landing) | 60 (54 / 6 / 0) | 79 (71 / 8 / 0) |

- **Replays:** 468 / 481 model replays, against the ~593 predicted.
- **Wall:** the baseline's 207 min was again ~2-3x my 61-110 min, because of redos. The fast variant's 53 min is
  under the prediction's 20 s/replay line, since replays took 3.9 s at p50.
- **Wrong at landing, clean merges:** 3.9% → 4.6%.
- **Wrong at landing, replays:** 4.9% → 6.7%. The fast variant is higher, but 23 vs 32 is within chance at these
  counts.
- **Lost in landing across both dial-60 runs: 0.** Every attribution there is exact by base_sha.
- **Clustering is still not the main driver of losses:** 96 / 74 / 60 lost at dial 0 / 30 / 60 on the baseline queue.
  What clustering costs is time: 40 / 145 / 207 min.
- **With lane prefetch** (eyal/kata-d60h):
  - **Time:** 44.5 min.
  - **Results:** 1,330 landed and 1,277 requirements passing. 66 lost: 57 wrong when they landed (clean merges 3.3%,
    replays 5.8%), 9 dropped by a later agent, 0 lost in landing.
  - **Losses vs the fast run:** fewer than d60g's 79, which supports reading d60g's higher replay rate as chance.
  - **Lost in landing: 0 in all three dial-60 runs.**
