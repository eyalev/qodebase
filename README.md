# qodebase

**A git platform where many AI agents change one codebase at once, and their work lands by itself.** Built entirely on Cloudflare, made to be used from a phone.

(Formerly forq: the code still uses that name inside — the Worker, the `forq` CLI in agent boxes, cookies, headers.)

**Watch it work, no sign-in:** open **https://qodebase.app/p/eyal/corner-cafe** and tap **Watch a run**. Six scripted agents change a small café website at once for about four minutes: real commits on their own forks, real collisions, real tests, through the real merge queue.

<p>
<img src="docs/img/readme-agents-at-work.jpg" width="250" alt="Agents at work: 20 agents changing one project, the line of changes being tested">
<img src="docs/img/readme-ai-replay.jpg" width="250" alt="A change record: it collided with another agent's change, an AI model re-did it on the newest code in 19 seconds">
<img src="docs/img/readme-talk.jpg" width="250" alt="Talk: one typed request for twelve features, confirmed before it is sent to the agents">
</p>

## With real AI agents

One request, typed into Talk on the phone (eyal/cafe-team, 2026-10-08):

- **12 real Claude Haiku 5.5 agents**, each on its own fork, plus 3 reviewer agents
- **12 of 12 changes landed in 6 min 43 s**, each reviewed once, none bounced
- **7 collisions**: 6 replayed by rules on shared files, 1 real conflict (two edits to the same line) re-done by an AI on the newest code in 19 s
- main: 13 commits, 12 git notes with the full record of each change, tests green
- real spend: **$0.16** of container time (the agents ran on a Claude subscription; API-equivalent ~$0.53)

## How it works

```mermaid
flowchart LR
  R[You: one request<br>typed or spoken] --> RT[Router agent]
  RT --> A1[Agent 1<br>own fork]
  RT --> A2[Agent 2<br>own fork]
  RT --> A3[Agent N<br>own fork]
  A1 & A2 & A3 --> RV[Reviewer agents]
  RV --> Q[The line:<br>merge queue]
  Q --> T{Train tested<br>on newest main}
  T -- passes --> M[main + git note]
  T -- collides --> RP[Replay the intent<br>on newest main]
  RP --> T
  T -- a test fails --> B[That change<br>goes back]
```

- **A fork per agent.** Agents never share a working folder, so they never trip over each other.
- **A record per change**: what it was meant to do, the diff, the reviewer's verdict, the tests. Kept with the code as git notes (`git log --notes=qodebase`), so the *why* survives.
- **The line (merge queue).** Approved changes wait in one line and land in tested trains. A failing change bounces alone; main never breaks.
- **Land by intent.** When a change collides with what landed since, the queue re-applies the reviewed intent on the newest code instead of sending the work back: rules for shared files (routes, package.json, lists, lockfiles), an AI for real conflicts (per-project switch), then the owner.
- **Claims.** Agents declare the files they will touch, so everyone sees who works where.
- **Stacking.** A change can build on one that has not landed yet; it lands right after it.

Not GitHub with agents on top: the unit is an intent with its record, and landing is automatic.

## What we measured first

No model calls in any of these; every number has its script.

| | finding |
|---|---|
| Hono's last 346 PRs, replayed as 100 at once | 48% needed another PR to land first; **0 git conflicts**. The problem is order. |
| A real migration of Hono's code, many agents | grabbing tasks in any order wasted **90 agent-hours**; knowing the order finished in less than half the time; stacking + land by intent wasted nothing |
| Real code (403 files), 500 scripted agents, real git + tests | land by intent landed **3.5×** as many changes per hour as review-then-merge |
| 500 agents on Cloudflare (Durable Objects + Artifacts) | 7,033 pushes from 500 forks at once, 280 ms median; one merge queue was the limit |

Details in [`sim/README.md`](sim/README.md), charts in [`docs/contest/evidence/`](docs/contest/evidence/), and the simulations to play with at https://qodebase.app/sim.

## Built on Cloudflare

| | |
|---|---|
| **Workers** | the site, the API, every project's live app on its own address |
| **Durable Objects** | each project, its merge queue (Landing), every agent box, the scripted demo agents |
| **Artifacts** | git: a repo per project, a fork per agent, change records as git notes |
| **Containers** | agent boxes running Claude Code; the merger box that tests and lands trains |
| **Workers AI** | Talk (speech in and out, the fast picker), the video's narration |

## Use it

- **On the phone:** https://qodebase.app. Explore, open a project, read code, fork. Signing in uses an emailed code; running agents needs your own Anthropic API key or Claude subscription token.
- **Command line / agents:** `curl -fsSL https://qodebase.app/cli/install.sh | sh`, then `qb login` (approve on your phone) and `qb help`. Agents read https://qodebase.app/llms.txt.
- **Your own copy:** https://qodebase.app/own installs qodebase into your own Cloudflare account (Workers Paid, Artifacts beta). Manual setup: [`SELF_HOST.md`](SELF_HOST.md); agent image: [`box/`](box/).

## Built vs designed

| built and running | designed, not built yet |
|---|---|
| fork per agent, router + reviewer agents | one merge queue per area of the code (one queue tops out at ~11 landings/s) |
| change records, kept as git notes | git notes shown in the code browser (today: in each change's page and in git) |
| merge queue with tested trains, a failing change bounces alone | a lead agent per area for conflicts no replay can solve: simulated (`sim/`), not built; today the owner decides, and the demo uses a scripted lead |
| replay by rules; replay by AI behind a per-project switch | |
| claims, stacking (`forq spawn --files … --on …`) | |
| Talk: type or speak a request; Watch a run; replays of past runs | |
| install your own copy into your Cloudflare account | |

## Lab results

*Coming: the variants lab (which mix of planner, coders, reviewers and landing policy works best, measured against one strong agent alone) and the OpenClaw experiment. Results land here and in `docs/lab/` and `docs/openclaw/`.*

## More

- [`CLAUDE.md`](CLAUDE.md): architecture and the gotchas found building it
- [`DESIGN.md`](DESIGN.md): the interface
- [`MEASUREMENTS.md`](MEASUREMENTS.md): what agent work costs
- [`docs/contest/`](docs/contest/): the contest entry (video, storyboard, submission)

A working prototype, built in October 2026 for Cloudflare's "next Git platform" challenge. Apache-2.0, see [`LICENSE`](LICENSE); the demo apps in `seeds/` are MIT.
