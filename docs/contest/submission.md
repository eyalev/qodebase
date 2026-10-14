# qodebase

- **How it works (demo, lab, measurements):** https://qodebase.app/how
- **Live:** https://qodebase.app
- **Code:** https://github.com/eyalev/qodebase (Apache-2.0)
- **Watch a run, no sign-in:** https://qodebase.app/p/eyal/corner-cafe
- **Real agents:** https://qodebase.app/p/eyal/cafe-team (12 agents) and https://qodebase.app/p/eyal/real-course-builder (up to 40)

## Project vision

**The idea.** qodebase is a git platform, used from the phone, where many AI agents change one codebase at once and their work lands by itself. Every agent works on its own fork, and every change carries its intent and its record. When changes collide, the merge queue redoes the reviewed intent on the newest main and tests it, instead of sending it back.

**What we showed** (all on Cloudflare):
1. **12 Claude Haiku agents:** 12 of 12 changes landed in 6 min 43 s; 7 collided and all landed ([a collided change and its record](https://qodebase.app/p/eyal/cafe-team/work#/change/eyal.cafe-team--xkvo4)).
2. **Up to 40:** 28 of a 40-agent build's changes collided, a model redid each on the newest code, and no collision was sent back ([the build](https://qodebase.app/p/eyal/real-course-builder)).
3. **Hundreds, on code with hidden tests:** with 60% of 200 agents' tasks aimed at the same functions, 0 changes were lost in landing in three runs, and lanes cut the time from 207 to 44.5 min ([results](https://github.com/eyalev/qodebase/blob/main/docs/board/RESULTS.md#collision-dials), [the 44.5-min run](https://qodebase.app/runs#/run/fleet-kata-d60h/fmv78n0e9)).
4. **Thousands:** a fleet of cheap models landed 31,466 file changes in six real codebases, none touching code ([a 4,063-file run](https://qodebase.app/runs#/intents/run/fleet-vscode-src-11/fmv6rzp4n)).
5. **And when not to:** for a fresh app, one strong agent finished sooner than each of three team builds ([quality checks](https://github.com/eyalev/qodebase/blob/main/docs/board/R3-R6-quality.md)).

**What is new.** Merge queues (GitHub's, Graphite, Mergify, Bors) send a change that no longer applies back to its author. Some tools go further: Overstory's merge queue can have a model re-implement a conflicting branch, and Copilot fixes a pull request's conflicts on request. qodebase combines what we found nowhere together: the reviewed intent is recorded with each change as a git note; redoing that intent on the newest main and testing it is the normal landing path, not a last resort; a live board shows who works on what; and with a thousand agents you browse intents, not agents: the [Intents tab](https://qodebase.app/p/eyal/real-course-builder/work#/intents) goes from the request to areas to each agent's change, needs-you first.

**The details.**
- **12 agents** (cafe-team, Claude Haiku 5.5, plus 3 reviewers): 6 collisions were redone by rules on shared files, 1 real conflict (two edits to one line) by a model in 19 s. Main: 13 commits, 12 git notes, green tests; $0.16 of container time, the agents on a Claude subscription (about $0.53 at API prices). In [R8b](https://qodebase.app/p/eyal/real-home-inventory-r8b/work#/change/eyal.real-home-inventory-r8b--isdhz), a model redid real loan logic after a collision in 2 min, and the tests passed.
- **40 agents** (Haiku, an Opus planner, 3-6 reviewers, the board) built a travel planner (the project is named course-builder): 39 of 40 changes in 37:37; the 40th, sent back once by review, landed at 80 min. By hand, [11 of 13 features work](https://github.com/eyalev/qodebase/blob/main/docs/board/R5-quality.md): a replay dropped a reviewed file (replays now refuse to land without one; an audit of all 35 replays found no other) and two agents' interfaces did not match.
- **200 agents** (cheap models, 1,385 small tasks, one run per setting): at 0%, 30% and 60% overlap, losses stayed in the same range (96, 74, 60 lost checks, nearly all the models' own mistakes; at most 2 lost in landing) but one queue slowed (40, 145, 207 min). Lanes per module with direct replays took [53 min](https://qodebase.app/p/eyal/kata-d60g/work), with prefetch [44.5](https://qodebase.app/p/eyal/kata-d60h/work), and 1,277 requirements passed on main against 1,242. Those lane runs had some change records missing on main; fixed since (199 of 199 in a check run).
- **The fleet** (Workers AI and Gemini Flash-Lite, no Claude): doc comments in VS Code, Next.js, Angular, Babel and Nest, $19.09; each change checked to leave the code unchanged; a hand check found 109 of 115 comments right. With cached answers, 4,750 agents landed 63,441 changes in under 3 min; our side flattened near ~2,100 files a second, so with real models (~114 a second in the busiest minute) the models are the limit.
- **Fresh apps:** on the same two prompts, one Opus agent (2 runs: [R6](https://qodebase.app/p/eyal/real-home-inventory-solo/work), [R7](https://qodebase.app/p/eyal/real-cafe-site-solo/work)) finished sooner than each of 3 team builds, 4× and 6× on one ([R3](https://qodebase.app/p/eyal/real-home-inventory/work); [R8b](https://qodebase.app/p/eyal/real-home-inventory-r8b/work), the 6× team, had a ~10 min queue bug) and 2× on the other ([R4](https://qodebase.app/p/eyal/real-cafe-site/work)), with at least as many features working; the team was cheaper in 2 of the 3 pairs. The [lab](https://qodebase.app/lab) agrees (2-3 runs each).

**Next** (a direction, not built): pick the way to run agents per job (one agent, a board, lanes), from these measurements.

## How we used Cloudflare

All our code runs on Cloudflare. The coding agents run Claude; the fleet uses Workers AI and Gemini.

| | |
|---|---|
| **Workers** | the site and API; every project's live app on its own address, served from Artifacts at any commit or fork |
| **Durable Objects** | each project and its Landing object (records, claims, board, the merge queue as alarm-driven trains); every agent box; the demo and fleet agents |
| **Artifacts** | git: a repo per project, a fork per agent with a write token scoped to it, change records as git notes |
| **Containers** | agent boxes running Claude Code; the merger box that replays changes on the newest main, tests and lands trains |
| **Workers AI + AI Gateway** | the fleet's models, and speaking to the app |
| **Access, OAuth** | sign-in, and "Sign in with Cloudflare" |

## Instructions to run

**Watch (no sign-in):** open https://qodebase.app/p/eyal/corner-cafe and tap **Watch a run**. Six scripted agents (no AI) change a small café website with real commits on their own forks, through the real merge queue and tests. It is staged: reviews are approved automatically and the tasks are ordered so the story happens. A run takes about a minute; each IP gets 10 a day, 2 minutes apart, 150 a day in all until Oct 31; when none can start, the page replays the last run.

**Use it:** sign in at https://qodebase.app with an emailed code; running agents needs your own Claude API key or Claude subscription token. CLI: `curl -fsSL https://qodebase.app/cli/install.sh | sh`, then `qb login`.

**Reproduce the simulations** (no model calls): `node sim/real/run.mjs --all --agents 500 --hours 2` (see `sim/README.md`).
