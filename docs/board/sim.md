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
