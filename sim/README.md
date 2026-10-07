# qodebase sim

What happens when hundreds of thousands of agents change code at once, without
paying for a single model call. Each agent is a small state machine; a virtual
clock jumps from event to event, so 100,000 agents for a simulated hour take a
few seconds on a laptop. Same seed, same run.

Timings are calibrated on qodebase's measured runs (`../MEASUREMENTS.md`):
box boot ~8 s, an agent pushes in 1.5–4 min, a reviewer agent takes ~3 min,
~$1.42 per reviewed change at Sonnet API prices. Everything else (how often
files collide, how often git merges a conflict by itself, how often a change
breaks main) is an assumption in `DEFAULTS` in `engine.js`. **The outputs are
estimates, not measurements.**

## Run it

```sh
node sim/cli.mjs --preset k100 --hours 2        # compare the four policies
node sim/cli.mjs --preset k1 --policy hybrid --out runs.jsonl
node --test sim/engine.test.mjs
cd sim && python3 -m http.server 7873           # the playback UI at http://127.0.0.1:7873/
```

Presets: `today` (1 repo, 20 agents), `k1` (1 repo, 1,000), `k10` (1 repo,
10,000), `k100` (500 repos × 200 = 100,000). Override with `--agents`,
`--repos`, `--files`, `--seed`.

## The four ways changes land

| policy | review | before work | on conflict | merging |
|---|---|---|---|---|
| Classic PRs | a person reads every diff | nothing | agent rebases, review again | one at a time |
| Agent review | reviewer agents; a person only for risky changes | nothing | rebase, review again | one at a time |
| Claims | as above | claim every file you will touch; wait if taken | (none happen) | one at a time |
| Claims + redo + trains | as above | claim ordinary files, leave hot shared files open; if taken, pick another task | rerun the task on the new main | trains of up to 16, tested together |

## What it says so far (seed 1)

One repo, 20 agents, 4 simulated hours:

| policy | landed/h | median ask→landed | slowest 10% | $/change |
|---|---|---|---|---|
| Classic PRs | 8 | 85 min | 2.7 h | $1.93 |
| Agent review | 49 | 16 min | 47 min | $3.00 |
| Claims | 58 | 12 min | 44 min | $2.00 |
| Claims + redo + trains | 77 | 14 min | 23 min | $1.99 |

500 repos × 200 agents = 100,000 agents, 2 simulated hours:

| policy | landed/h | median | slowest 10% | conflicts | agent time redoing | main broken | stuck |
|---|---|---|---|---|---|---|---|
| Classic PRs | 4,555 | 1.6 h | 1.9 h | 1,787 | 1% | 0.4% | 98,702 waiting for a person |
| Agent review | 145,192 | 25 min | 82 min | 446,418 | 42% | 14% | 49,248 waiting for review |
| Claims | 115,858 | 16 min | 2.0 h | 0 | 6% | 12.5% | 90,387 waiting for a claim |
| Claims + redo + trains | 354,786 | 12 min | 24 min | 51,217 | 9% | 3.9% | 14,675 waiting for a claim |

Read as: with people reviewing every change, agents mostly wait for people.
Agent review alone moves the wall to conflicts (42% of agent time is redo) and
a broken main. Claims remove conflicts but park most agents. Claiming only
ordinary files, picking free work, redoing on conflict and landing tested
trains keeps ~2.4× the throughput of agent review at half the cost per change.
One repo still tops out near ~900 landed/h with 60 s train tests (preset
`k1`): the answer past that is many repos, not one bigger one.
