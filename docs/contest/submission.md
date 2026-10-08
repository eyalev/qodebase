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
- Simulating a real migration of Hono's code (moving `src/utils/` to `src/lib/`: 140 tasks
  with a dependency chain, real git, type check and tests on every change), agents that
  grab tasks in any order wasted 90 agent-hours; knowing the order finished in less than
  half the time, and stacking with land by intent wasted nothing and never broke main
  (10 agents, 3 seeds).
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

It works with real AI agents too: on eyal/cafe-real one request to the router started two
Claude Haiku 5.5 agents with declared files; both changes were reviewed, tested together in
one train and landed in 5.5 minutes, right the first time, their records attached as git
notes (`git log --notes=qodebase`).

We also measured which team shape works best (qodebase.app/lab, every run in
`public/lab/runs.jsonl`): on these jobs one Opus agent was faster and at least as good (café
58 s; TypeScript port 228 s, all 158 hidden tests; bakery median 509 s, 26/26). On the bakery
it was 1.9x faster than an Opus planner with a crew of Haiku agents (987 s, clean runs only)
and passed 1 more hidden test, while the crew cost 57% less at API-equivalent prices (58% less
on the port, where its code failed the strict type check). Haiku planners under-plan (1 and 3
of 7 hidden tests), and a GitHub-style flow (pull requests merged one at a time) timed out. Next: a club website,
a 15-minute job on ready foundations, where the simulator (fitted within ~5% on these runs)
predicts one Opus agent ~10 min vs the crew ~17 min: a crew is limited by how fast changes
land (one per ~60-100 s on the bakery), not by how many agents work.

And we studied a very busy open-source repo, OpenClaw (30 days of public data,
`docs/openclaw/FINDINGS.md`): with no merge queue, their flow is the cheapest and fastest at
their pace; a queue running each train's scoped tests would cost ~1.6x their landing CI, and
for ~78% of full-suite breaks a change in the failing test's area landed that hour. A Haiku
triage agent that reads the repo and the issue index was right on 61% of 200 issues vs 50% for
text-only (p = 0.004), finding 66% of duplicates vs 14%; adding the project's own policy files
to the prompt did not help.

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

**Watch the landing system (no sign-in):** open https://qodebase.app/p/eyal/corner-cafe on a
phone or desktop. On Agents at work, tap **Watch a run**: 6 scripted agents (no AI, labelled
as such) work on a small café website, with real git commits on their own Artifacts forks.
Their changes go through the real merge queue: shared-file collisions are replayed on the
latest code, one change fails a test and is sent back, fixed and lands, two conflicting
edits are redone by a scripted lead, and one change is stacked on another. A run takes
about 4 minutes. If one is already running you watch it; limits: 10 runs a day, 3 per
visitor; when none can start, the page replays the last run. Tap any agent, change or file
to see why; underlined words open a one-line explanation. `?mock=1` plays sample data.

**Real agents:** https://qodebase.app/p/eyal/cafe-real, Agents at work: the records of the
two Claude Haiku 5.5 agents (starting runs there is owner-only).

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
