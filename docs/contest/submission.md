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

**Real logic, too:** in another build, [eyal/real-home-inventory-r8b's 'Lent out' change](https://qodebase.app/p/eyal/real-home-inventory-r8b/work#/change/eyal.real-home-inventory-r8b--isdhz) collided with another agent's in app.js; a model redid the loan logic on the newest code in 2 min for $0.62, and the tests passed.

**Bigger, through the normal Build path:** up to 40 Claude Haiku agents (an Opus planner, 3-6 reviewers, the board) built a travel planner ([eyal/real-course-builder](https://qodebase.app/p/eyal/real-course-builder): named course-builder, it built a travel planner). **28 of its 40 changes collided and were re-done by a model on the newest code; none was sent back.** Two views were never wired in (review missed it); a 41st change fixed that. Tried by hand, [11 of its 13 features work](https://github.com/eyalev/qodebase/blob/main/docs/board/R5-quality.md): the cost splitter is missing (a model replay dropped its reviewed view file; the tests missed it) and a cross-agent interface mismatch broke itinerary editing: as on the café site, the team failed at the seams between agents. Auditing all 35 replays afterwards (this build's 28, R8b's 7) found only that one; replays now apply clean files directly, redo only conflicting files, and refuse to land if a reviewed file is missing. Review was the bottleneck: agents waited for a reviewer as long as they worked (16,234 vs 15,731 agent-seconds, 6 reviewers).

**We measured first** (no model calls): replaying Hono's last 346 PRs as if 100 were written at once, 48% needed another PR to land first, with no git conflicts: the problem is order. Simulated (scripted edits, real git and tests, 403 files), landing by intent landed **3.5×** as many changes per hour as review-then-merge.

**Different jobs need different ways to run agents.** What won, by job:
- **Fresh apps** (real agents): one Opus agent beat an Opus planner with a Haiku crew in the [lab](https://qodebase.app/lab) (509 vs 987 s; 728 vs 1,184 s; 2-3 runs each, stalled runs left out) and in builds (457 vs 1,940 s; 863 vs 1,762 s). A team cost less in the lab and two of three builds, more in R8b and at the >100k-token price.
- **Shared task lists** (real Haiku agents, 3 runs each): the **board** plus one duplicate check was the only setup with no duplicate built twice (vs a static split rule or the check alone; time and cost overlap the split rule). Two teams on one repo in qodebase: wall time -40%.
- **Team size** (150 tasks, Haiku, 3 runs each): a controller that adds agents while landings rise used a quarter of the agent-minutes and half the cost of 40 fixed agents, not slower (fixed teams of 8 and 20 untested).
- **Thousands of agents** (simulated, real git and tests, scripted agents): one queue tops out near 830-900 landings an hour; lanes per code area need dependency-aware tests (without, main was red 20-88% of the time), then 32 lanes held 1.4× one queue (2,000 agents, 6 h). On Cloudflare (2,000 scripted agents, 10 min), 8, 16 or 32 lanes landed ~30,000 changes vs 14,336 for one, median wait 8 s vs 500 s, main whole. At 20% cross-area changes a lane bug broke main twice (fixed; the rerun's main is whole, though 63 changes landed twice with the same content; refusing repeats is still open).
- **A fleet of cheap models** (measured; Workers AI and Gemini Flash-Lite, no Claude): up to 200 agents wrote doc comments in six codebases (VS Code, Next.js, Angular, Babel, Nest): 6,616 files landed for $2.81, each checked to leave the code unchanged (none refused; 0 code changes on main). A hand check found 109 of 115 comments right.
- **Bun's Zig→Rust port** (replayed on its real patches): its commits are chains, so 640 agents are no faster than 64; checking right after landing and fixing forward kept 26.2 h and cut broken time 59-73%. Re-cut by module, interfaces first (simulated from Bun's real structure, not replayed): 3.4-5.2 h.

**Next:** an orchestrator that profiles each job, picks from this toolbox, pilots on a simulation or a replay of the repo's history when stakes are high, and adapts when a queue saturates (a direction, not built). A person steers from the phone and is asked only when needed.

¹ An earlier, smaller run: [cafe-real](https://qodebase.app/p/eyal/cafe-real), 2 Haiku agents, no collisions.

## How we used Cloudflare

All our code runs on Cloudflare, with no servers of our own. The coding agents' model is Claude, served by Anthropic; the fleet uses Workers AI and Gemini.

| | |
|---|---|
| **Workers** | the site and API; every project's live app on its own address, served from Artifacts at any commit or fork |
| **Durable Objects** | each project; its Landing object (change records, claims, the board, the merge queue as alarm-driven trains); every agent box; the scripted demo agents |
| **Artifacts** | git: a repo per project, a fork per agent with a write token scoped to it, change records as git notes |
| **Containers** | agent boxes running Claude Code; the merger box that replays changes on the newest main, tests and lands trains |
| **Workers AI + AI Gateway** | the fleet's models, speaking to the app, and the video's narration |
| **Access, OAuth** | sign-in, and "Sign in with Cloudflare" |

## Instructions to run

**Watch the landing system (no sign-in).** Open https://qodebase.app/p/eyal/corner-cafe on a phone or desktop and tap **Watch a run**. Six scripted agents (no AI) change a small café website with real commits on their own Artifacts forks, through the real merge queue and tests.
- **What's staged:** reviews are approved automatically, and the tasks are ordered so the story happens. You'll see shared-file collisions replayed, one change failing a test and coming back fixed, a conflict redone by a scripted lead, and one change stacked on another.
- **Limits:** a run takes about a minute and ends once every task has landed. Each visitor IP gets 10 runs a day, 2 minutes apart; 150 a day in all until Oct 31. When none can start, the page replays the last run.
- Tap any agent, change or file to see why it happened.

**Real agents.** https://qodebase.app/p/eyal/cafe-team, Agents at work: the records of the 12-agent run.

**Use it.** Sign in at https://qodebase.app with an emailed code; running agents needs your own Anthropic API key or Claude subscription token. From a terminal: `curl -fsSL https://qodebase.app/cli/install.sh | sh`, then `qb login` and `qb help`.

**Your own copy.** https://qodebase.app/own installs qodebase, merge queue and board included, into your own Cloudflare account in about 85 seconds (needs Workers Paid and Cloudflare Artifacts, in beta). A fresh copy ran the café story with all 14 changes landing through its own queue.

**Reproduce the measurements** (no model calls; details in `sim/README.md`):
```sh
node sim/real/run.mjs --all --agents 500 --hours 2         # simulation: real git, scripted edits
node sim/hono/replay.mjs --prs 500 --waves 1,10,50,100     # needs a clone of honojs/hono
```
