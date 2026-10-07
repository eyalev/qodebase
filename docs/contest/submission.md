# Submission texts (owner: qb8) — DRAFT 1, 2026-10-07

For Cloudflare's "Build the next GitHub" challenge (deadline 2026-10-14). Eyal submits.
Lines marked **[final]** wait for numbers measured by Oct 10-12 (qb6 busy mode, final
video length). Keep every claim to what is built (see docs/contest/storyboard.md,
"Rules for every line").

- **Project:** qodebase
- **Live:** https://qodebase.app
- **Code:** https://github.com/eyalev/qodebase (Apache-2.0)
- **Video:** [final: link], 5-7 min
- **Demo project:** https://qodebase.app/p/eyal/corner-cafe (Agents at work)

## Project vision

AI agents now write code faster than people can review it, and one person can run
dozens of them. Git and pull requests were built for the opposite: a few changes a day,
each one read and merged by a person. Before building anything we measured what goes
wrong when many agents share one codebase, with no model calls:

- Replaying the last 346 pull requests of Hono as if 100 had been written at once, 48%
  needed another pull request to land first, and git reported no conflicts at all. The
  problem is ordering, not merge conflicts.
- On a generated 403-file TypeScript project with 500 scripted agents, real git and real
  tests on every merge, the conflicts piled onto a few shared list files (routes,
  schema, package.json), and landing by intent got 3.5x as many changes in per hour as
  review-then-merge.
- Run for real on Cloudflare, 500 agents (each a Durable Object with its own Artifacts
  fork) made 7,033 git pushes at 280 ms median; git held up, and our single merge queue
  was the limit.

qodebase is the platform built on those findings, used from a phone:

- **Every agent gets its own fork**, so agents never share a working tree.
- **Every change carries a record**: its intent, the diff, the reviewer agent's verdict
  and the tests. The record is kept with the code as git notes, so the why survives.
- **A merge queue lands changes in trains**, tested together; a failing change bounces
  alone and main never breaks.
- **Land by intent**: when a change collides with what landed since, the queue re-applies
  the reviewed intent on the newest code (deterministic handlers for shared files today;
  an agent replay behind a per-project switch), tests it, and lands it, instead of
  sending the work back. What replay cannot do goes to the area's lead agent, then to you.
- **Claims and stacking**: agents declare the files they will touch, so everyone sees who
  works where, and a change can build on one that has not landed yet.

So this is not GitHub with agents on top: the unit is an intent with its record, and
landing is automatic. A person steers (by typing or talking to the project, from the
phone) and is asked only when something needs them.

## How we used Cloudflare

Everything runs on Cloudflare; there is no other server.

| Cloudflare product | What it does in qodebase |
|---|---|
| **Workers** | The whole site and API in one Worker; every project's live app on its own host, served straight from Artifacts at any commit or fork; Worker projects deployed with a preview per agent fork; a front Worker for the domain. |
| **Durable Objects** (SQLite) | One per project (repo, agents, reviews, code search with FTS5), one Landing object per project (change records, claims, the merge queue as alarm-driven trains), one per agent box, scripted demo agents, Talk's voice sessions. |
| **Artifacts** | Git for every project and one fork per agent, with a write token scoped to that fork; change records as git notes; import from GitHub. Our 500-agent run pushed to 500 forks at once. |
| **Containers** | Agent boxes running Claude Code (snapshots, `durable_object` scheduling, idle stop) and the merger box that applies changes to the newest main, runs the tests and pushes trains. |
| **Workers AI** + **AI Gateway** | Talk: speech to text (Whisper, Nova-3, Flux), spoken replies (Aura), a fast model that acts on the page; the video's narration (Aura-2). |
| **Access**, **OAuth** | Sign-in; "Sign in with Cloudflare" to install your own copy of qodebase (or an agent) into your own account in a few minutes. |
| **R2**, **Workers Logs**, **Issues** | Kept voice clips (7 days); observability; production errors of a project's app are sent to its router agent, which opens an agent to fix them. |

## Instructions to run

**Use it:** open https://qodebase.app on a phone. Explore projects, open one, read code,
fork. Signing in uses an emailed code; running agents needs your own Anthropic API key
or Claude subscription token (Settings).

**Watch the landing system:** https://qodebase.app/p/eyal/corner-cafe, tab Agents at work.
[final: how a judge starts a scripted run, or a recorded run that replays]

**Command line:** `curl -fsSL https://qodebase.app/cli/install.sh | sh`, then `qb login`
and `qb help`. Agents can read https://qodebase.app/llms.txt.

**Your own copy:** https://qodebase.app/own installs qodebase into your Cloudflare account
(Workers Paid, Artifacts beta). Manual setup: `SELF_HOST.md` in the repo.

**Reproduce the measurements (no model calls):**
```sh
node sim/cli.mjs --preset k100 --hours 2            # fast sim, 100,000 agents
node sim/real/run.mjs --all --agents 500 --hours 2  # real code, real git, 500 agents
node sim/hono/replay.mjs --prs 500 --waves 1,10,50,100   # needs a clone of honojs/hono
node sim/bun/analyze.mjs                            # needs a fetch of oven-sh/bun#30412
node --test sim/engine.test.mjs
```
The Cloudflare run: `sim/cloud/README.md`. Charts: `docs/contest/evidence/`.
