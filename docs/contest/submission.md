# qodebase

## Project vision

qodebase is a git platform where many AI agents change one codebase at once, and their work lands by itself. Each agent works on its own fork; each change carries its intent (what it was asked, the review, the tests) as a git note. When changes collide, merge queues today send the work back to its author. qodebase's queue redoes the reviewed intent on the newest main, tests it and lands it, and a live agent board shows who works on what. On Cloudflare: 12 Claude agents landed 12 of 12 changes in 6 min 43 s through 7 collisions; in a 40-agent build all 28 collisions were redone and landed.

*Words we use:* **land** = merge to main after the tests pass; **replay** (or redo) = redo a collided change's intent on the newest main; **train** = a batch of changes tested together; **lane** = a merge queue for one area of the code; **skeleton** and **contract** = the shared files and the functions modules call in each other, planned before agents start.

**What is new.** Merge queues (GitHub's, Graphite, Mergify, Bors) send a change that no longer applies back to its author. Some tools go further: Overstory's merge queue can have a model re-implement a conflicting branch, and Copilot fixes a pull request's conflicts on request. qodebase combines what we found nowhere together: the reviewed intent is recorded with each change as a git note (`git log --notes=qodebase`); redoing that intent on the newest main and testing it is the normal landing path, not a last resort; a live agent board shows who works on what; and with a thousand agents you browse intents, not agents: the [Intents tab](https://qodebase.app/p/eyal/real-course-builder/work#/intents) goes from the request to areas to each agent's change, needs-you first.

- **Video (6:35):** https://qodebase.app/video
- **How it works (demo, lab, measurements):** https://qodebase.app/how
- **Code:** https://github.com/eyalev/qodebase (Apache-2.0); qodebase's own code also lives on qodebase: https://qodebase.app/p/eyal/qodebase (a mirror, updated on every push)
- **Watch a run, no sign-in:** https://qodebase.app/p/eyal/corner-cafe
- **Real agents:** https://qodebase.app/p/eyal/cafe-team (12 agents) and https://qodebase.app/p/eyal/real-course-builder (up to 40)

**What we showed** (all on Cloudflare):
1. **12 Claude Haiku agents** ([cafe-team](https://qodebase.app/p/eyal/cafe-team), plus 3 reviewers): 12 of 12 changes landed in 6 min 43 s. 7 collided: 6 were redone by rules on shared files, 1 real conflict (two edits to one line) by a model in 19 s ([the change and its record](https://qodebase.app/p/eyal/cafe-team/work#/change/eyal.cafe-team--xkvo4)). Main: 13 commits, 12 git notes, green tests; $0.16 of container time, the agents on a Claude subscription (about $0.53 at API prices). In [another build](https://qodebase.app/p/eyal/real-home-inventory-r8b/work#/change/eyal.real-home-inventory-r8b--isdhz), a model redid real loan logic after a collision in 2 min, and the tests passed.
2. **Up to 40 Claude Haiku agents** (an Opus planner, 3-6 reviewers, the agent board) built a [travel planner](https://qodebase.app/p/eyal/real-course-builder) (the project is named course-builder): 28 of its 40 changes collided, a model redid each on the newest code, and no collision was sent back. 39 of 40 landed in 37:37; the 40th, sent back once by review, landed at 80 min. By hand, [11 of 13 features work](https://github.com/eyalev/qodebase/blob/main/docs/board/R5-quality.md): a replay dropped a reviewed file (replays now refuse to land without one; an audit of all 35 replays found no other) and two agents' interfaces did not match.
3. **Coordination and review.** Agents claim the files they will touch before they start (others get a heads-up when two plan the same file); a change built on another waits for that declared base (stacking); a shared contract fixes the functions modules call in each other; the agent board shows live work, with one duplicate check on the task list. Board on vs off, 3 runs each: 20 Claude Haiku agents on one task list 594 → 451 s and twin tasks built twice 9 → 0 (plain git on a laptop); two teams on one repo inside qodebase on Cloudflare 775 → 465 s. At 40 agents review was the bottleneck: 16,234 agent-seconds waiting for a reviewer against 15,731 working.
4. **Hundreds, on code with hidden tests:** 200 cheap-model agents (Gemini Flash-Lite, GLM) took 1,385 small coding tasks on one codebase through the real merge queue, one run per setting. With 0%, 30% and 60% of the tasks aimed at the same functions, a model redid up to 468 collided changes and losses stayed in the same range (96, 74, 60 lost checks, nearly all the models' own mistakes), but one queue slowed (40, 145, 207 min). Lanes cut the 60% case to [53 min](https://qodebase.app/p/eyal/kata-d60g/work), and with prefetch to [44.5](https://qodebase.app/runs#/run/fleet-kata-d60h/fmv78n0e9), with 1,277 requirements passing on main against 1,242. **Lost in landing** (a change that passed its tests and was broken by the merge): at most 2 per run at 0% and 30%, and 0 in all three 60% runs; changes that failed their own tests were sent back, as designed. Those lane runs had some change records missing on main; fixed since (199 of 199 in a check run). [Results](https://github.com/eyalev/qodebase/blob/main/docs/board/RESULTS.md#collision-dials).
5. **Thousands, with real models:** 1,000 agents documented VS Code's `src/vs` (4,064 files) with cheap models (Gemini Flash-Lite, GLM, Gemma), each also adding its lines to one shared API index file. 2,794 files landed; 2,791 of them collided on that index, and a fixed rule re-inserted each line on the newest main (no model needed), so the index came out complete: 5,787 of 5,787 lines, none missing, none twice. $2.50 in all, the run started by voice in the video ([the run](https://qodebase.app/runs#/run/fleet-n2-vscode-src-1/fmv8dekehi2g), [write-up](https://github.com/eyalev/qodebase/blob/main/docs/contest/fleet-r10k.md)); 201 files got no usable answer from the model and were left unchanged. Across six real codebases the cheap-model fleet landed 31,466 file changes for $19.09, ~114 a second in the busiest minute, each checked to leave the code unchanged; a hand check found 109 of 115 comments right.
6. **Throughput tests** (cached answers, no model calls; agents start in ramps): 10,000 workers, every file different, 0 errors, all 29,890 changes on main 86 s after the start (of 40,640 files; the rest had nothing to document or no cached answer), at most ~2,800 busy at once, ~1,900 files a second at the busiest. Artifacts reads slow down but never fail; that read rate, ~2,000 a second for the account, is the wall. Best case, files repeating (a read cache): 100,000 workers landed all 298,900 changes ~89 s after the start, 0 lost ([runs](https://github.com/eyalev/qodebase/blob/main/docs/contest/fleet-r10k.md)).
7. **And when not to:** for a fresh app, one Opus agent ([R6](https://qodebase.app/p/eyal/real-home-inventory-solo/work), [R7](https://qodebase.app/p/eyal/real-cafe-site-solo/work)) finished sooner than each of 3 team builds of Claude Haiku coders with an Opus planner (so model strength differs too): 4× and 6× on one prompt ([R3](https://qodebase.app/p/eyal/real-home-inventory/work); [R8b](https://qodebase.app/p/eyal/real-home-inventory-r8b/work), the 6× team, had a ~10 min queue bug), 2× on the other ([R4](https://qodebase.app/p/eyal/real-cafe-site/work)), with at least as many features working; the team was cheaper in 2 of the 3 pairs. The [lab](https://qodebase.app/lab) agrees (2-3 runs each).

**Limits.** Lanes are built and measured, but not yet a setting in the product UI. A replay once dropped a reviewed file (1 of 35; such replays are now refused). The lead agent for conflicts no replay can solve is scripted in the demo; today the owner decides. Scale runs above 1,000 agents used cached answers. Architecture: [How it works](https://github.com/eyalev/qodebase#how-it-works) (diagram) and https://qodebase.app/how.

**Next** (a direction, not built): pick the way to run agents per job (one agent, the agent board, lanes), from these measurements.

## How we used Cloudflare

All our code runs on Cloudflare. The coding agents run Claude; the fleet uses Workers AI and Gemini.

| | |
|---|---|
| **Workers** | the site and API; every project's live app on its own address, served from Artifacts at any commit or fork |
| **Durable Objects** | each project and its Landing object (records, claims, the agent board, the merge queue as alarm-driven trains); every agent box; the demo and fleet agents |
| **Artifacts** | git: a repo per project, a fork per agent with a write token scoped to it, change records as git notes |
| **Containers** | agent boxes running Claude Code; the merger box that replays changes on the newest main, tests and lands trains |
| **Workers AI + AI Gateway** | the fleet's models, and speaking to the app |
| **Access, OAuth** | sign-in, and "Sign in with Cloudflare" |

What we learned about the limits: Artifacts reads level off near ~2,000 a second per account (slower, never failing); at the 100,000-worker peak our own bookkeeping Durable Objects reported "overloaded" until work they dropped was re-queued.

## Instructions to run

**Start at** https://qodebase.app/how (the demo, the lab and the measurements).

**Watch (no sign-in):** open https://qodebase.app/p/eyal/corner-cafe and tap **Watch a run**. Six scripted agents (no AI) change a small café website with real commits on their own forks, through the real merge queue and tests. It is staged: reviews are approved automatically and the tasks are ordered so the story happens. A run takes about a minute; each IP gets 10 a day, 2 minutes apart, 150 a day in all until Oct 31; when none can start, the page replays the last run.

**Your own copy:** https://qodebase.app/own installs qodebase, merge queue and agent board included, into your own Cloudflare account; the release built for this submission installed in 79 s ([dated log](https://github.com/eyalev/qodebase/blob/main/docs/contest/own-release.md); needs Workers Paid and Cloudflare Artifacts, in beta). A fresh copy ran the café demo (scripted agents, no AI): 14 of 14 changes landed through its own merge queue in 140 s.

**Use it:** sign in at https://qodebase.app with an emailed code; running agents needs your own Claude API key or Claude subscription token. CLI: `curl -fsSL https://qodebase.app/cli/install.sh | sh`, then `qb login`.

**Reproduce the simulations** (no model calls; takes several minutes and writes into `sim/real/out` and `public/sim/runs`): `node sim/real/run.mjs --all --agents 500 --hours 2` (see `sim/README.md`).
