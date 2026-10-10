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
