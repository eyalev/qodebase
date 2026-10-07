# qodebase sim

What happens when hundreds of thousands of agents change code at once, without
paying for a single model call. Each agent is a small state machine; a virtual
clock jumps from event to event, so 100,000 agents for a simulated hour take a
few seconds on a laptop. Same seed, same run.

Timings are calibrated on qodebase's measured runs (`../MEASUREMENTS.md`):
box boot ~8 s, an agent pushes in 1.5–4 min, a reviewer agent takes ~3 min,
~$1.42 per reviewed change at Sonnet API prices. Everything else (how often
files collide, how often git merges a conflict by itself, how often a change
breaks main) is an assumption in `DEFAULTS` in `public/sim/engine.js`. **The outputs are
estimates, not measurements.**

## Run it

```sh
node sim/cli.mjs --preset k100 --hours 2        # compare the policies
node sim/cli.mjs --preset k100 --hours 1 --sweep span   # team leads: agents per lead
node sim/cli.mjs --preset k1 --policy hybrid --out runs.jsonl
node --test sim/engine.test.mjs
cd public/sim && python3 -m http.server 7873    # the playback UI at http://127.0.0.1:7873/ (live: https://qodebase.app/sim/)
```

Presets: `today` (1 repo, 20 agents), `k1` (1 repo, 1,000), `k10` (1 repo,
10,000), `k100` (500 repos × 200 = 100,000). Override with `--agents`,
`--repos`, `--files`, `--seed`.

## The six ways changes land

| policy | review | before work | on conflict | merging |
|---|---|---|---|---|
| Classic PRs | a person reads every diff | nothing | agent rebases, review again | one at a time |
| Agent review | reviewer agents; a person only for risky changes | nothing | rebase, review again | one at a time |
| Claims | as above | claim every file you will touch; wait if taken | (none happen) | one at a time |
| Claims + redo + trains | as above | claim ordinary files, leave hot shared files open; if taken, pick another task | rerun the task on the new main | trains of up to 16, tested together |
| Team leads | as above; an author who disputes a review gets one round, then the area lead decides | as above | the area lead merges both intents; only a failed merge is redone | as above |
| Land by intent | as team leads | as above | the merge queue replays the reviewed change on main and the train tests it; a failed replay goes to the lead | as above |

In every policy a review that asks for changes is disputed 30% of the time; without a lead
the two agents argue ~2.5 rounds and one side gives in.

## What it says so far (seed 1)

Hot shared files (routes, schema, package.json) merge cleanly 20% of the time when two
changes touch them: that is what the real-code run below showed (two appends to one
list conflict in git nearly every time). It was 80% before that run; every number here
is after the correction.

One repo, 20 agents, 4 simulated hours:

| policy | landed/h | median | slowest 10% | redoing | $/change |
|---|---|---|---|---|---|
| Classic PRs | 8 | 78 min | 1.7 h | 14% | $2.10 |
| Agent review | 48 | 15 min | 44 min | 37% | $3.30 |
| Claims | 57 | 11 min | 42 min | 7% | $2.02 |
| Claims + redo + trains | 57 | 14 min | 35 min | 36% | $2.83 |
| Team leads | 76 | 14 min | 23 min | 8% | $2.17 |
| Land by intent | 77 | 14 min | 24 min | 7% | $2.07 |

500 repos × 200 agents = 100,000 agents, 2 simulated hours:

| policy | landed/h | median | slowest 10% | conflicts | redoing | main broken | stuck at the end |
|---|---|---|---|---|---|---|---|
| Classic PRs | 4,165 | 1.6 h | 1.9 h | 2,562 | 1% | 0.6% | 98,730 waiting for a person |
| Agent review | 116,997 | 27 min | 1.8 h | 524,278 | 52% | 12.6% | 49,103 waiting for review |
| Claims | 114,350 | 15 min | 2.0 h | 0 | 11% | 12.9% | 90,285 waiting for a claim |
| Claims + redo + trains | 220,962 | 14 min | 62 min | 372,148 | 38% | 2.8% | 34,072 in merge queues |
| Team leads | 241,015 | 11 min | 60 min | 266,947 | 13% | 2.4% | 16,115 waiting for a claim |
| Land by intent | 375,228 | 12 min | 22 min | 181,979 | 7% | 4.1% | 16,771 waiting for review |

Read as: with people reviewing every change, agents mostly wait for people. Agent
review alone moves the wall to conflicts (half of agent time is redo) and a broken
main. Claims remove conflicts but park most agents. Trains and claims on ordinary
files help, but the shared hot files keep conflicting; leads absorb that by merging
intents by hand, and then become the queue themselves. Landing by intent (the queue
replays the reviewed change on main, the train tests it) takes that load off the
leads: 3.2× agent review's throughput at a third of its cost per change.

## Team leads: how many agents per lead

100,000 agents, 1 simulated hour:

| agents per lead | leads | lead busy | waiting for a lead | slowest 10% |
|---|---|---|---|---|
| 5 | 20,000 | 22% | 10,752 | 41 min |
| 10 | 10,000 | 41% | 14,760 | 39 min |
| 25 | 4,000 | 78% | 35,903 | 38 min |
| 50 | 2,000 | 89% | 49,708 | 40 min |
| 100 | 1,000 | 92% | 59,370 | 48 min |

With realistic conflicts a lead can serve about 10 agents before it becomes the queue;
past 25 most of the waiting is for leads. That is why the next step was to make the
merge queue do the leads' most common job (replaying an intent) by itself.

## A real run: real code, real git (`sim/real/`)

The fast sim rolls dice for conflicts. `sim/real/run.mjs` doesn't: it generates a small
real project (50 folders × 8 TypeScript files, `src/routes.ts`, `src/schema.ts`,
`package.json`, 403 files), and scripted agents change it with operations an agent
would do: edit a function, add a function and its route, rename a function across
every file that imports it, call another module's function, add a schema field, bump
a dependency. Commits are real git objects; merges are `git merge-tree` (real
conflicts); every merged tree runs the project's tests (real semantic breaks, like a
clean merge that calls a function another change just renamed). The clock is virtual
(same timing model as above); no model calls.

```sh
node sim/real/run.mjs --all --agents 500 --hours 2   # every policy; repos in sim/real/out/*.git
```

Each run writes `public/sim/runs/<policy>-<agents>.json`, which
[`run.html`](https://qodebase.app/sim/run.html) plays back: scrub time, then tap a
folder, a file, a change (its story, its conflicts, the tests it failed, the diff that
landed) or main's history.

Four policies here; the fourth is new: **land by intent**. A change is reviewed as an
intent ("rename b of src/m5/f5.ts", "add the email field") plus the diff it made. When
git reports a text conflict or the train's tests fail, the merge queue replays the
intent on the current main and tests it again, instead of sending it back to an agent.

500 agents, 2 simulated hours, seed 1:

| policy | landed/h | median | git conflicts | caught by train tests | broke main |
|---|---|---|---|---|---|
| Agent review | 242 | 22 min | 977 | (no train tests) | 7 |
| Claims + redo + trains | 224 | 31 min | 1,264 | 1 | 0 |
| Team leads | 290 | 21 min | 1,132 | 0 | 0 |
| Land by intent | 849 | 30 min | 976 (972 replayed on landing) | 10 | 0 |

What it shows: in a real codebase the conflicts are not spread out, they pile onto
the shared list files (routes, schema, package.json): two agents appending to the same
list conflict in git every time, although their changes are independent. Redoing or
escalating those costs a round trip each; replaying the intent costs nothing, so the
queue keeps moving. The train tests are what make replay safe (10 replays/merges were
caught breaking the build and bounced).

## Calibration from a real agent swarm (`sim/bun/`)

Bun's Zig→Rust port (oven-sh/bun#30412, 6,755 commits by ~64 Claude agents in 11 days),
mined from commit metadata alone by `node sim/bun/analyze.mjs` → `sim/bun/calibration.json`.
Headlines: 81% of commits went straight onto one shared branch, 9 s apart, with agents
owning files and line ranges instead of branches; phases ran gated and back to back
(the two middle phases = 57% of commits in 17 h, ~3.3 commits per agent-hour); files per
commit p50 3 / p90 11; the top 1% of files appear in 49% of commits but are big source
files edited in different regions, not append lists; branch-vs-branch overlap on a file
is 6% per 15 min, 15% per hour; 3.6 lost-work fixes per 100 merges, mostly from
`merge --theirs`. Replaying all 276 merges with real contents (`sim/bun/replay.mjs`):
17% conflict, and a file changed on both sides merges cleanly 84% of the time, hot or
cold (0.95 for small merges, 0.79 for sweeps over 50 shared files), against the sim's
0.2 / 0.35, which hold for append lists, not for big source files.
Details and what it means for the policies: `sim/bun/README.md`.

## Real pull requests: replaying honojs/hono (`sim/hono/`)

The real-code run above uses scripted changes. `sim/hono/replay.mjs` uses real ones: the
last 500 changes on honojs/hono's main (346 pull requests and 154 direct pushes such as
release bumps and "Merge next", June 2025 to October 2026), replayed as if they had been
opened in waves of W at once. Every PR in a wave is written against the same main (its real
patch, three-way merged onto that main), then they land in their original order onto a main
that keeps moving. Each landing is type-checked (tsgo); only errors the real history did not
have count. No model calls.

```sh
node sim/hono/replay.mjs --waves 1,10,50,100   # ~5 min per W; needs ~/projects/github/honojs/hono + pnpm install
```

W=1 is history itself (every PR written on the latest main) and must end on history's exact
tree: that checks the method. It does, at every W.

| PRs opened at once | PRs that ran into another | needed an earlier PR of their wave | git conflicts | merged clean, broke the type check |
|---|---|---|---|---|
| 1 (history) | 0 | 0 | 0 | 0 |
| 10 | 56 of 346 (16%) | 110 attempts | 0 | 0 |
| 50 | 139 (40%) | 668 attempts | 0 | 0 |
| 100 | 167 (48%) | 1,496 attempts | 0 | 0 |

What it shows: **for real PRs the problem is ordering, not conflicts.** Half the PRs of a
100-wide wave could not be written on the wave's starting main because they built on another
PR of the same wave (a lockfile bump after a lockfile bump, a fix to code another PR adds).
Once they waited for it, git merged everything cleanly and nothing broke the type check.

Two replay bugs made earlier numbers look like conflicts (19/40/50% with 1-3 git conflicts and
1-9 breaks): a PR could merge "cleanly" onto a main that lacked a change it builds on, with
part of its patch silently absorbed (a revert of code that only arrived with an earlier
"Merge next" became an empty diff), and changes could land past an earlier direct push.
Both were changes landing out of order; with them fixed the conflicts and breaks went away
and the final tree equals history.

## A migration swarm on real code (`sim/swarm/`)

Bun's Zig-to-Rust port (64 Claude agents, 11 days, 6,755 commits) is what "thousands of
agents" work looks like: one big goal split into small tasks, a machine signal as the work
list, phases gated by a check. The swarm sim runs that shape on Hono's real code, with no
model calls: **move every module of `src/utils/` (27) to `src/lib/`**, as 140 tasks:

- 26 moves (create `src/lib/X.ts`, leave a one-line re-export shim, point `jsr.json` at the new
  file; `jwt/jws` and `jwt/types` import each other, so they move together),
- 87 import rewrites (every source and test file that imports a utils module),
- 27 shim deletions.

Each task is a codemod (`migration.mjs`), i.e. an intent that can be applied to any version
of the tree. What each task needs comes from the import graph, not from guessing (299 edges;
the longest chain is 6 tasks): a move needs the moves of what it imports, a rewrite needs the
moves it points at, a deletion needs every importer rewritten. Applying all 140 in order ends
with exactly the starting tree's type errors. The judge is tsgo with the tests included
(`tsconfig.spec.json`, incremental); only errors the starting tree did not have count. Agents
take ~18 min per task (Bun: ~3.3 commits per agent-hour, `sim/bun/calibration.json`), the merge
queue lands one change per 30 s.

```sh
node sim/swarm/run.mjs --agents 10,100,1000 --policies ffa,phases,stack,intent   # ~6 min per run
```

Four ways to run the swarm, same tasks, same seed:

- **Free-for-all**: any agent takes any open task on a branch from main, checks its own
  change, lands it; a task whose prerequisites have not landed fails its own check and is
  given back (retried 5 min later); a git conflict means redo.
- **Phases with gates (Bun's way)**: one shared tree, each file owned by one agent (no
  branches, no merges; Bun's bulk phases worked like this, qb5's calibration); moves, then
  rewrites, then deletions; main may be red inside a phase, the next opens when the check is green.
- **Dependency map + stacking**: an agent only takes a task whose needs are done, landed or
  not; it builds on the unlanded ones and the queue lands it right after them.
- **Stacking + land by intent**: as stacking, but stacks are built by replaying the needed
  codemods, and a git conflict at landing is resolved by re-running the codemod on the latest
  main (and checking it) instead of an agent redoing it.

Seed 1 (hours to land all 140 tasks; wasted = agent time on attempts that did not land):

| agents | Free-for-all | Phases (Bun) | Stacking | Stacking + intent |
|---|---|---|---|---|
| 10 | 13.3 h, 80 h wasted | 6.7 h, 0 wasted, main red 8% | 5.6 h, 2.0 h wasted | 5.7 h, 0 wasted |
| 100 | 4.7 h, 151 h wasted | 3.9 h, 0, red 13% | 2.6 h, 9.9 h | 3.0 h, 0 |
| 1,000 | 4.1 h, 130 h wasted | 2.6 h, 0, red 25% | 3.2 h, 10.1 h | 2.4 h, 0 |

Useful agent time is ~45 h in every run (the migration itself). In no run did a landing break
the check on main except in phases, where breaking it inside a phase is the design.

What it shows:
- **Free-for-all burns 2-3× the work it does**: agents keep picking tasks whose prerequisites
  have not landed, find out only at their own type check, and give them back. More agents make
  it worse in absolute terms (151 h wasted at 100).
- **Knowing the order is what matters, not how you merge.** Phases, stacking and intent all
  waste little or nothing; they differ by how they pay for order: phases with idle agents at
  the gates and a red main inside a phase, stacking with a short redo when a stack does not
  merge, intent with nothing.
- **Past ~100 agents, more agents do not help**: 140 tasks, a chain of 6, a serial merge
  queue. 10 → 100 agents halves the time; 100 → 1,000 barely moves it (98% of 1,000 agents are
  idle). The floor is the dependency chain (6 tasks × ~18 min) plus the queue (140 × 30 s).
- **The one shared file** (`jsr.json`, one line per module) merged cleanly in 48-76% of the
  cases where both sides changed it, against Bun's measured 84% (its hot files are big source
  files edited in different regions; ours is a list, like Hono's append lists at 20%).
