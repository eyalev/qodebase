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
