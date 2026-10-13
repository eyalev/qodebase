# qodebase

- **How it works (demo, lab, measurements):** https://qodebase.app/how
- **Live:** https://qodebase.app
- **Code:** https://github.com/eyalev/qodebase (Apache-2.0)
- **Watch a run, no sign-in:** https://qodebase.app/p/eyal/corner-cafe
- **Real agents:** https://qodebase.app/p/eyal/cafe-team (12 agents) and https://qodebase.app/p/eyal/real-course-builder (up to 40)

## Project vision

**What we found.** For a fresh app, one strong agent is the measured default: on the same prompts one Opus agent was 2-4× faster than a team, with at least as many features working (one build each: [R6 vs R3](https://github.com/eyalev/qodebase/blob/main/docs/board/R3-R6-quality.md), [R7 vs R4](https://github.com/eyalev/qodebase/blob/main/docs/board/R4-R7-quality.md), [R8b](https://github.com/eyalev/qodebase/blob/main/docs/board/R8b-quality.md)). Many agents pay off for wide work (shared task lists, two teams, tasks arriving mid-run: the board), for work that must run in parallel (big ports like Bun's), and at fleet scale (lanes, fleets of cheap models). qodebase is the layer that makes many agents safe: each change an intent with a record, landed by intent on the newest code, with a live board and a timeline.

Merge queues already exist (GitHub's merge queue, Graphite, Mergify, Bors), and so do multi-agent coding setups like Gas Town. They all treat a change as a diff: when it no longer applies, it goes back to its author. qodebase treats a change as an **intent with a record**. When it collides with what landed since, the queue **replays the reviewed intent on the newest main** instead of bouncing it, tests it, and lands it. New with that:
- every agent works on **its own fork in Cloudflare Artifacts**;
- each change's record (intent, diff, review, tests) stays with the code **as git notes**;
- a live **board** shows which agent works on what.

**The proof, with real agents.** One request typed on the phone started **12 Claude Haiku 5.5 agents** in cafe-team, each on its own fork, plus 3 reviewers. **12 of 12 changes landed in 6 min 43 s.** **7 collided** with work that had landed first:
- **6 were replayed by rules** on shared files (routes, the menu data, CSS);
- **1 was a real conflict** (two edits to the same line), re-done by an AI on the newest code **in 19 s**: [the change and its record](https://qodebase.app/p/eyal/cafe-team/work#/change/eyal.cafe-team--xkvo4).

Main: 13 commits, 12 git notes, green tests. Real spend $0.16 of container time; the agents ran on a Claude subscription (about $0.53 at API prices).¹

**Bigger, through the normal Build path:** up to 40 real Claude Haiku agents (an Opus planner, 3-6 reviewers, the board) built a travel planner inside qodebase ([eyal/real-course-builder](https://qodebase.app/p/eyal/real-course-builder): the project is called course-builder; what it built is a travel planner). 40 changes landed (one closed as already on main); **28 collided with earlier work and were re-done by a model on the newest code, none sent back.** At that size review was the bottleneck: agents waited for a reviewer as long as they worked (16,234 vs 15,731 agent-seconds, with 6 reviewers).

**We measured first** (no model calls): replaying Hono's last 346 PRs as if 100 were written at once, 48% needed another PR to land first, with no git conflicts: the problem is order. Simulated (scripted edits, real git and tests, 403 files), landing by intent landed **3.5×** as many changes per hour as review-then-merge.

**Different jobs need different ways to run agents.** What won, by job:
- **Fresh apps** (real agents): one Opus agent beat an Opus planner with a Haiku crew in the [lab](https://qodebase.app/lab) (509 vs 987 s; 728 vs 1,184 s; 2-3 runs each, stalled runs left out) and in builds (457 vs 1,940 s; 863 vs 1,762 s). A team cost less in the lab and two of three builds, more in R8b and at the >100k-token price.
- **Shared task lists** (real Haiku agents, 3 runs each): the **board** plus one duplicate check was the only setup with no duplicate built twice (vs a static split rule or the check alone; time and cost overlap the split rule). Two teams on one repo in qodebase: wall time -40%.
- **Team size** (150 tasks, Haiku, 3 runs each): a controller that adds agents while landings rise used a quarter of the agent-minutes and half the cost of 40 fixed agents, not slower (fixed teams of 8 and 20 untested).
- **Thousands of agents** (simulated, real git and tests, scripted agents): one queue tops out near 830-900 landings an hour. Lanes per code area need dependency-aware tests (without, main was red 20-88% of the time); then 32 lanes held 1.4× one queue (2,000 agents, 6 h). On Cloudflare, 2,000 scripted agents, 10 minutes: 8 lanes landed 30,066 changes vs 14,336 for one, median wait 8 s vs 500 s, main whole; 16 and 32 lanes landed the same. At 20% cross-area changes a lane bug broke main twice; fixed, and the rerun's main is whole, though 63 of ~30,000 changes landed twice (same content; making the door refuse repeats is still open).
- **Bun's Zig→Rust port** (replayed on its real patches): its commits are chains, so 640 agents are no faster than 64; checking right after landing and fixing forward kept 26.2 h and cut broken time 59-73%. Re-cut by module, interfaces first (simulated from Bun's real structure, not replayed): 3.4-5.2 h.

**Next:** an orchestrator that profiles each job, picks from this toolbox, pilots on a simulation or a replay of the repo's history when stakes are high, and adapts when a queue saturates (a direction, not built). A person steers from the phone and is asked only when needed.

¹ An earlier, smaller run: [cafe-real](https://qodebase.app/p/eyal/cafe-real), 2 Haiku agents, no collisions.

## How we used Cloudflare

All our code runs on Cloudflare, with no servers of our own. The agents' model is Claude, served by Anthropic.

| | |
|---|---|
| **Workers** | the site and API; every project's live app on its own address, served from Artifacts at any commit or fork |
| **Durable Objects** | each project; its Landing object (change records, claims, the board, the merge queue as alarm-driven trains); every agent box; the scripted demo agents |
| **Artifacts** | git: a repo per project, a fork per agent with a write token scoped to it, change records as git notes |
| **Containers** | agent boxes running Claude Code; the merger box that replays changes on the newest main, tests and lands trains |
| **Workers AI + AI Gateway** | speaking to the app, and the video's narration |
| **Access, OAuth** | sign-in, and "Sign in with Cloudflare" |

## Instructions to run

**Watch the landing system (no sign-in).** Open https://qodebase.app/p/eyal/corner-cafe on a phone or desktop and tap **Watch a run**. Six scripted agents (no AI) change a small café website with real commits on their own Artifacts forks, through the real merge queue and tests.
- **What's staged:** reviews are approved automatically, and the tasks are ordered so the story happens. You'll see shared-file collisions replayed, one change failing a test and coming back fixed, a conflict redone by a scripted lead, and one change stacked on another.
- **Limits:** a run takes about a minute and ends once every task has landed. Each visitor IP gets 10 runs a day, 2 minutes apart, and 40 a day in all. When none can start, the page replays the last run.
- Tap any agent, change or file to see why it happened.

**Real agents.** https://qodebase.app/p/eyal/cafe-team, Agents at work: the records of the 12-agent run.

**Use it.** Sign in at https://qodebase.app with an emailed code; running agents needs your own Anthropic API key or Claude subscription token. From a terminal: `curl -fsSL https://qodebase.app/cli/install.sh | sh`, then `qb login` and `qb help`.

**Your own copy.** https://qodebase.app/own installs qodebase, merge queue and board included, into your own Cloudflare account in about 85 seconds (needs Workers Paid and Cloudflare Artifacts, in beta). A fresh copy ran the café story with all 14 changes landing through its own queue.

**Reproduce the measurements** (no model calls; details in `sim/README.md`):
```sh
node sim/real/run.mjs --all --agents 500 --hours 2         # simulation: real git, scripted edits
node sim/hono/replay.mjs --prs 500 --waves 1,10,50,100     # needs a clone of honojs/hono
```
