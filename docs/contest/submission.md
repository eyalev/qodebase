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

**Bigger, through the product's own Build path:** up to 40 real Claude Haiku agents (an Opus planner, 3-6 reviewers, the board) built a travel planner inside qodebase. 40 changes landed (one closed as already on main); **28 collided with earlier work and were re-done by a model on the newest code, none sent back.** At that size review became the bottleneck: agents spent as long waiting for a reviewer as working (16,234 vs 15,731 agent-seconds, with 6 reviewers).

**Why we built it this way: we measured first.**
- **Hono, real PRs, no model calls:** Hono's last 346 PRs replayed as if 100 were written at once: 48% needed another PR to land first; git reported no conflicts. The problem is order.
- **Simulation, scripted edits:** on a generated 403-file project with real git and tests, landing by intent got **3.5×** as many changes in per hour as review-then-merge.
- **Simulated migration of Hono's code:** agents grabbing tasks in any order wasted 90 agent-hours. Knowing the order finished in less than half the time **at 10 agents**.
- **500 agents on Cloudflare** (a Durable Object and an Artifacts fork each): 7,033 git pushes, 280 ms median; our single merge queue was the limit (it reset three times; a bug of ours caused 88 stale-ref rejections, since fixed).

**Different jobs need different ways to run agents.** What won, by the shape of the job:
- **Small-to-mid apps** (bakery and club sites, [lab](https://qodebase.app/lab), real agents, 2-3 runs each): one Opus agent was faster than an Opus planner with a Haiku crew (509 vs 987 s; 728 vs 1,184 s), with hidden tests within one of each other. The crew cost about half at standard API prices, more at the >100k-token price. Stalled runs left out (with one, Opus was 2.3× faster).
- **Shared task lists** (real Haiku agents, 3 runs each): a live **board** plus one duplicate check was the only setup with no duplicate built twice (vs a static split rule or the check alone; on time and cost it overlaps the split rule). With two teams on one repo inside qodebase, wall time fell 40%.
- **Team size** (150 tasks, Haiku, 3 runs each): a controller that adds agents while landings rise used a quarter of the agent-minutes and half the cost of 40 fixed agents, not slower (fixed teams of 8 and 20 untested).
- **Thousands of agents** (simulated, real git and tests, scripted agents): one queue tops out near 830-900 landings an hour. Lanes per code area need dependency-aware tests (without, main was red 20-88% of the time); then 32 lanes held 1.4× one queue at 2,000 agents over 6 h. On Cloudflare, 2,000 scripted agents for 10 minutes: 8 lanes landed 30,066 changes vs 14,336 for one, median wait 8 s vs 500 s, main whole; 16 and 32 lanes landed the same. At 20% cross-area changes a lane bug broke main twice; fixed, and the rerun's main is whole, though 63 of ~30,000 changes landed twice (same content; making the door refuse repeats is still open).
- **Bun's Zig→Rust port** (replayed on its real patches): its commits are chains, so 640 agents are no faster than 64; checking right after landing and fixing forward kept 26.2 h and cut broken time 59-73%. Re-cut by module, interfaces first (simulated from Bun's real structure, not replayed): 3.4-5.2 h.

**Next:** an orchestrator that profiles each job, picks from this toolbox, pilots on a simulation or a replay of the repo's history when stakes are high, and adapts when a queue saturates. A direction, not built.

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
