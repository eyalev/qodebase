# qodebase

- **How it works (demo, lab, measurements):** https://qodebase.app/how
- **Live:** https://qodebase.app
- **Code:** https://github.com/eyalev/qodebase (Apache-2.0)
- **Watch a run, no sign-in:** https://qodebase.app/p/eyal/corner-cafe
- **Real agents:** https://qodebase.app/p/eyal/cafe-team

## Project vision

Merge queues already exist (GitHub's merge queue, Graphite, Mergify, Bors), and so do multi-agent coding setups like Gas Town. They all treat a change as a diff: when it no longer applies, it goes back to its author. qodebase treats a change as an **intent with a record**. When it collides with what landed since, the queue **replays the reviewed intent on the newest main** instead of bouncing it, tests it, and lands it. New with that:
- every agent works on **its own fork in Cloudflare Artifacts**;
- each change's record (intent, diff, review, tests) stays with the code **as git notes**;
- a live **board** shows which agent works on what;
- we **measured** which team shapes work, with real agents.

**The proof, with real agents.** One request, typed on the phone into the cafe-team project, started **12 Claude Haiku 5.5 agents**, each on its own fork, with 3 reviewer agents. **12 of 12 changes landed in 6 min 43 s.** **7 collided** with work that had landed first:
- **6 were replayed by rules** on shared files (routes, the menu data, CSS);
- **1 was a real conflict** (two edits to the same line), re-done by an AI on the newest code **in 19 s**: [the change and its record](https://qodebase.app/p/eyal/cafe-team/work#/change/eyal.cafe-team--xkvo4).

Main ended with 13 commits, 12 git notes and green tests. Real spend was $0.16 of container time; the agents ran on a Claude subscription, about $0.53 at API prices.¹

**Why we built it this way: we measured first.**
- **Hono, real PRs, no model calls:** we replayed Hono's last 346 PRs as if 100 had been written at once. 48% needed another PR to land first, and git reported no conflicts at all. The problem is order, not conflicts.
- **Simulation, scripted edits:** on a generated 403-file project with real git and tests, landing by intent got **3.5×** as many changes in per hour as review-then-merge.
- **Simulated migration of Hono's code:** agents grabbing tasks in any order wasted 90 agent-hours. Knowing the order finished in less than half the time **at 10 agents**.
- **500 agents on Cloudflare:** each was a Durable Object with its own Artifacts fork. They made 7,033 git pushes, 280 ms median. Git held up; our single merge queue was the limit. It reset three times, and a bug of ours caused 88 stale-ref rejections, since fixed.

**Which team shape works?** We gave the same job to one Opus agent and to an Opus planner with a crew of Haiku agents, through qodebase's queue (https://qodebase.app/lab). On the two jobs where the runs are comparable, one Opus agent was faster:
- **bakery site:** 509 s vs 987 s; Opus passed 1 more of 26 hidden tests;
- **club site:** 728 s vs 1,184 s; both passed all 42 hidden tests.

The crew cost 57% and 48% less at standard API prices. At the >100k-token-prompt price the crew costs more than Opus. Times leave out runs stalled by the platform; with the stalled bakery run, Opus was 2.3× faster. A crew is limited by how fast changes land, not by how many agents work. Haiku planners under-planned.

**Agent board.** Agents state their task, edits are posted by a hook, and one duplicate check runs before work starts. With 20 Haiku agents it cut wall time 24% and cost 16% on synthetic task lists with duplicates we planted; with two teams on one repo inside qodebase, wall time fell 40% and duplicates built twice fell from 3-4 to 0-1. Against a static split rule or the duplicate annotation alone, it was the only setup with no duplicate built twice; on time and cost it overlaps the split rule ([docs/board](https://github.com/eyalev/qodebase/tree/main/docs/board)).

**OpenClaw.** In 30 days of OpenClaw's public data, their no-queue flow was the cheapest at their pace. A queue running each train's own scoped tests would cost ~1.6× their landing CI ([findings](https://github.com/eyalev/qodebase/blob/main/docs/openclaw/FINDINGS.md)).

So this is not GitHub with agents on top: the unit is an intent with its record, and landing is automatic. A person steers from the phone and is asked only when something needs them.

¹ An earlier, smaller run: [cafe-real](https://qodebase.app/p/eyal/cafe-real), 2 Haiku agents, no collisions.

## How we used Cloudflare

All our code runs on Cloudflare, with no servers of our own. The agents' model is Claude, served by Anthropic.

| | |
|---|---|
| **Workers** | the site and API; every project's live app on its own address, served from Artifacts at any commit or fork |
| **Durable Objects** | each project; its Landing object (change records, claims, the board, the merge queue as alarm-driven trains); every agent box; the scripted demo agents |
| **Artifacts** | git: a repo per project, a fork per agent with a write token scoped to it, change records as git notes |
| **Containers** | agent boxes running Claude Code; the merger box that replays changes on the newest main, runs the tests and pushes trains |
| **Workers AI + AI Gateway** | speaking to the app, and the video's narration |
| **Access, OAuth** | sign-in, and "Sign in with Cloudflare" |

## Instructions to run

**Watch the landing system (no sign-in).** Open https://qodebase.app/p/eyal/corner-cafe on a phone or desktop and tap **Watch a run**. Six scripted agents (no AI) work on a small café website, with real commits on their own Artifacts forks. The changes go through the real merge queue and real tests.
- **What's staged:** reviews are approved automatically, and the tasks are ordered so the story happens. You'll see shared-file collisions replayed, one change failing a test and coming back fixed, a conflict redone by a scripted lead, and one change stacked on another.
- **Limits:** a run takes a few minutes and ends once every task has landed. Each visitor IP gets 10 runs a day, 2 minutes apart, and 40 a day in all. When none can start, the page replays the last run.
- **Reading it:** tap any agent, change or file to see why it happened.

**Real agents.** Open https://qodebase.app/p/eyal/cafe-team, Agents at work. These are the records of the 12-agent run.

**Use it.** Open https://qodebase.app and sign in with an emailed code. Running agents needs your own Anthropic API key or Claude subscription token. From a terminal: `curl -fsSL https://qodebase.app/cli/install.sh | sh`, then `qb login` and `qb help`.

**Your own copy.** https://qodebase.app/own installs qodebase, merge queue and board included, into your own Cloudflare account in about 85 seconds (needs Workers Paid and Cloudflare Artifacts, in beta). A fresh copy ran the café story with all 14 changes landing through its own queue.

**Reproduce the measurements** (no model calls; details in `sim/README.md`):
```sh
node sim/real/run.mjs --all --agents 500 --hours 2         # simulation: real git, scripted edits
node sim/hono/replay.mjs --prs 500 --waves 1,10,50,100     # needs a clone of honojs/hono
```
