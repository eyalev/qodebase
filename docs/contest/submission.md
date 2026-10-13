# qodebase

- **How it works (demo, lab, measurements):** https://qodebase.app/how
- **Live:** https://qodebase.app
- **Code:** https://github.com/eyalev/qodebase (Apache-2.0)
- **Watch a run, no sign-in:** https://qodebase.app/p/eyal/corner-cafe
- **Real agents:** https://qodebase.app/p/eyal/cafe-team (12 agents) and https://qodebase.app/p/eyal/real-course-builder (up to 40)

## Project vision

**What we proved, at three scales** (all on Cloudflare):
- **Thousands of agents:** 4,750 agents with cached answers landed 63,441 changes in under 3 minutes, with no errors; with real cheap models, a fleet landed 31,466 file changes in six real codebases, up to ~114 a second, none touching code.
- **Hundreds of agents, on code with hidden tests:** 200 cheap-model agents took 1,385 small coding tasks on one codebase through the real merge queue (one run per setting). With 0%, 30% and 60% of the tasks aimed at the same functions, a model redid up to 468 collided changes, wrong about as often as fresh work (~5%), and losses did not rise (96, 74 and 60 lost checks; at most 2 lost in landing, the rest the models' own mistakes), but the queue took 40, 145 and 207 min. Lanes per module with direct Haiku replays ran the 60% case in 53 min, with 32 more requirements passing on main (its replays were wrong 6.7% of the time against 4.9%, within chance).
- **Real Claude teams up to 40:** 28 of a 40-agent build's changes collided and were all redone by a model on the newest code.

**What we found.** For a fresh app, one strong agent is the measured default: on the same prompts, in 3 of 3 real builds, one strong agent finished sooner than a team (2×, 4× and 6×; the 6× pair, R8b, had a ~10 min queue bug), with at least as many features working; the team was cheaper in 2 of 3 (one build each: [R6 vs R3](https://github.com/eyalev/qodebase/blob/main/docs/board/R3-R6-quality.md), [R7 vs R4](https://github.com/eyalev/qodebase/blob/main/docs/board/R4-R7-quality.md), [R8b](https://github.com/eyalev/qodebase/blob/main/docs/board/R8b-quality.md)). Many agents pay off for wide work (the board), forced-parallel work (big ports like Bun's) and fleet scale. qodebase is the layer that makes many agents safe: each change an intent with a record, landed by intent on the newest code, with a live board and a timeline.

Merge queues already exist (GitHub's merge queue, Graphite, Mergify, Bors), and so do multi-agent coding setups like Gas Town. They all treat a change as a diff: when it no longer applies, it goes back to its author. qodebase treats a change as an **intent with a record**. When it collides with what landed since, the queue **replays the reviewed intent on the newest main** instead of bouncing it, tests it, and lands it. Every agent works on **its own fork in Cloudflare Artifacts**, each change's record stays with the code **as git notes**, and a live **board** shows who works on what. With a thousand agents you browse intents, not agents: each project's [Intents tab](https://qodebase.app/p/eyal/real-course-builder/work#/intents) runs from the request to areas to each agent's intent and change, rolling up status, cost and time with what needs you first; a 4,063-file fleet run opens the same way.

**The proof, with real agents.** One request typed on the phone started **12 Claude Haiku 5.5 agents** in cafe-team, each on its own fork, plus 3 reviewers. **12 of 12 changes landed in 6 min 43 s.** **7 collided** with earlier work:
- **6 were replayed by rules** on shared files (routes, the menu data, CSS);
- **1 was a real conflict** (two edits to the same line), re-done by an AI on the newest code **in 19 s**: [the change and its record](https://qodebase.app/p/eyal/cafe-team/work#/change/eyal.cafe-team--xkvo4).

Main: 13 commits, 12 git notes, green tests. Real spend $0.16 of container time; the agents ran on a Claude subscription (about $0.53 at API prices).¹

**Real logic, too:** [R8b's 'Lent out' change](https://qodebase.app/p/eyal/real-home-inventory-r8b/work#/change/eyal.real-home-inventory-r8b--isdhz) collided with another agent's in app.js; a model redid the loan logic on the newest code in 2 min for $0.62, and the tests passed.

**Bigger, through the normal Build path:** up to 40 Claude Haiku agents built a travel planner ([eyal/real-course-builder](https://qodebase.app/p/eyal/real-course-builder), named course-builder): the 28 collisions above, none sent back, and [11 of 13 features work](https://github.com/eyalev/qodebase/blob/main/docs/board/R5-quality.md) by hand: a replay dropped a reviewed file (replays now refuse to land without one; an audit of all 35 replays found no other) and two agents' interfaces did not match.

**We measured first** (no model calls): of Hono's last 346 PRs replayed as if 100 were written at once, 48% needed another PR to land first, with no git conflicts; and in a simulation (scripted edits, real git and tests), landing by intent landed **3.5×** as many changes per hour as review-then-merge.

**Different jobs need different ways to run agents.** What won, by job:
- **Fresh apps** (real agents): one Opus agent also beat an Opus planner with a Haiku crew in the [lab](https://qodebase.app/lab) (509 vs 987 s; 728 vs 1,184 s; 2-3 runs each, stalled runs left out); a team cost less in the lab, more at the >100k-token price.
- **Shared task lists** (real Haiku agents, 3 runs each): the **board** plus one duplicate check was the only setup with no duplicate built twice (vs a static split rule or the check alone; time and cost overlap the split rule). Two teams on one repo in qodebase: wall time -40%.
- **Thousands of agents** (simulated, real git and tests, scripted agents): one queue tops out near 830-900 landings an hour; lanes per area need dependency-aware tests (without, main was red 20-88% of the time); 32 lanes held 1.4× one queue (2,000 agents, 6 h). On Cloudflare (2,000 scripted agents, 10 min), 8-32 lanes landed ~30,000 changes vs 14,336 for one, median wait 8 s vs 500 s, main whole; at 20% cross-area changes a lane bug (fixed) broke main twice, and the rerun landed 63 changes twice (same content; refusing repeats is still open).
- **A fleet of cheap models** (measured; Workers AI and Gemini Flash-Lite, no Claude): doc comments in VS Code, Next.js, Angular, Babel and Nest, $19.09 for the 31,466 file changes; a hand check found 109 of 115 comments right. Our side alone (cached answers) flattened near ~2,100 files a second on Artifacts' shared reads; with real models (~114 a second) the models are the limit.
- **Bun's Zig→Rust port** (replayed on its real patches): its commits are chains, so 640 agents are no faster than 64; checking right after landing and fixing forward kept 26.2 h and cut broken time 59-73%.

**Next** (a direction, not built): an orchestrator that profiles each job, picks from this toolbox, and adapts when a queue saturates. A person steers from the phone and is asked only when needed.

¹ An earlier, smaller run: [cafe-real](https://qodebase.app/p/eyal/cafe-real), 2 Haiku agents, no collisions.

## How we used Cloudflare

All our code runs on Cloudflare. The coding agents run Claude; the fleet uses Workers AI and Gemini.

| | |
|---|---|
| **Workers** | the site and API; every project's live app on its own address, served from Artifacts at any commit or fork |
| **Durable Objects** | each project and its Landing object (records, claims, board, the merge queue as alarm-driven trains); every agent box; the demo and fleet agents |
| **Artifacts** | git: a repo per project, a fork per agent with a write token scoped to it, change records as git notes |
| **Containers** | agent boxes running Claude Code; the merger box that replays changes on the newest main, tests and lands trains |
| **Workers AI + AI Gateway** | the fleet's models, speaking to the app, and the video's narration |
| **Access, OAuth** | sign-in, and "Sign in with Cloudflare" |

## Instructions to run

**Watch the landing system (no sign-in).** Open https://qodebase.app/p/eyal/corner-cafe on a phone or desktop and tap **Watch a run**. Six scripted agents (no AI) change a small café website with real commits on their own Artifacts forks, through the real merge queue and tests.
- **What's staged:** reviews are approved automatically, and the tasks are ordered so the story happens.
- **Limits:** a run takes about a minute and ends once every task has landed. Each visitor IP gets 10 runs a day, 2 minutes apart; 150 a day in all until Oct 31. When none can start, the page replays the last run.

**Real agents.** The two Real agents links above show every change's record.

**Use it.** Sign in at https://qodebase.app with an emailed code; running agents needs your own Claude API key or Claude subscription token. From a terminal: `curl -fsSL https://qodebase.app/cli/install.sh | sh`, then `qb login` and `qb help`.

**Your own copy.** https://qodebase.app/own installs qodebase, merge queue and board included, into your own Cloudflare account in about 85 seconds (needs Workers Paid and Cloudflare Artifacts, in beta). A fresh copy ran the café story with all 14 changes landing through its own queue.

**Reproduce the measurements** (no model calls; details in `sim/README.md`):
```sh
node sim/real/run.mjs --all --agents 500 --hours 2
node sim/hono/replay.mjs --prs 500 --waves 1,10,50,100   # needs a clone of honojs/hono
```
