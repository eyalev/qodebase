# forq

A Git platform for the age of agents, built entirely on Cloudflare and used from
the phone. Every project runs, and every fork comes with its own agents.

Personal project first; Cloudflare's "next Git platform" contest
(deadline 2026-10-14) is a bonus, not the driver.

## The idea

- **Project page:** the live app first, code one tap away, the project's agents
  as cards.
- **Router:** you talk to it (text now, voice later); it splits the request into
  tasks and opens one agent per task.
- **Agent = one container box + one Artifacts fork.** Agents never share a
  working tree, so they never collide. Chat in front, terminal behind.
- **Merge from the phone:** an agent pushes to its fork, its card says so, you
  tap merge, the router does the git.

## Architecture (v0)

| piece | how |
|---|---|
| Worker | one Worker, `forq.kapps.dev` (Cloudflare Access only in v0) |
| Project | one Durable Object per project: repo name, agent list, status |
| Agent box | container DO on the `durable_object` scheduling policy + snapshots, **computer2's image pinned by digest** (Claude Code + tmux-web + mobile-agent). Copy the slim parts of opendev `computer-next/src/computer2.ts`: boot over `exec`, snapshot on stop, idle stop at 5 min, secrets in tmpfs |
| Repo | Artifacts namespace `forq`: one main repo per project (new or **imported from GitHub**), one **fork per agent**, a write token scoped to that fork |
| Model | Claude Code in each box with Eyal's **subscription** (`CLAUDE_CODE_OAUTH_TOKEN`). Personal use only; a public version needs bring-your-own API key or a capped platform credit |
| Router | Claude Code too, in its own box, with a small `agents` CLI: `spawn "<task>"`, `list`, `status <state>`, `merge <id>` |
| Status | agents report through the CLI (`agents status pushed`), not Artifacts push events, which are per-repo subscriptions |
| Phone UI | project page: router composer on top, agent cards below (task, state, last line), tap → that box's chat view (from computer2), Terminal button behind it |

Not in v0: per-branch previews, voice, Google login, multiple users, contest video.

## Running it (v0)

- Phone: https://forq.kapps.dev/p/sleepsounds (Cloudflare Access app `forq`,
  id `8bfa01d4-…`, owner@example.com only). Agent UI: `/a/<agent-id>/agent/`.
- Laptop/admin: `https://forq.<sub>.workers.dev` with header
  `x-forq-secret: $(cat ~/.config/forq/admin-secret)`. Verbs:
  `POST /api/projects/<p>/agents {task}`, `GET /api/projects/<p>[/commits]`,
  `POST /api/projects/<p>/main-token` (push from the laptop),
  `GET /api/agents/<id>/state`, `POST /api/agents/<id>/{wake,stop,send,exec,reset}`.
- Secrets: `CLAUDE_CODE_OAUTH_TOKEN` (copied from opendev D1
  `user_connections.claude_token`), `ADMIN_SECRET`.
- **Every deploy kills awake boxes** (same as computer2); they lose work since
  the last snapshot. Agents push to their fork, so pushed work is safe.

## Gotchas found building step 1

- Claude Code's folder-trust prompt: boot.sh only trusts `/workspace/project`;
  the agent works in `/workspace/repo`, so `box.ts` pre-writes the trust before
  boot. Without it the task's Enter picked "No, exit".
- `send()` refuses unless a `claude` process exists (`pgrep -x claude`): once
  Claude had exited, the task text ran in bash. tmux's `pane_current_command`
  reads `bash` even while Claude runs (it is in a subshell).
- Artifacts tokens are now `art_v2_…?expires=…` (docs say v1); git auth uses
  the part before `?expires=` as the Basic password via a credential helper
  reading `/run/forq/git-token` (tmpfs).
- `ps` inside a box shows the Claude token in boot.sh's tmux command line;
  don't print process lists into logs.

## Reference code

- `<opendev computer-next>` — computer2 ("Fast
  computer"): read its `CLAUDE.md` and `FINDINGS.md` first. Boot, snapshots,
  chat page, gotchas (deploys kill running boxes, 2.56 GB first pull per host,
  no `max_instances`, `chown 0:0 /`, WS proxy through the DO's `fetch()`).
- Artifacts docs: https://developers.cloudflare.com/artifacts/ (binding,
  repo-scoped tokens, import, event subscriptions via Queues).

## Cloudflare announcements that matter (Birthday Week, 2026-09-28..10-01)

- **Containers rebuilt** (`/faster-agent-sandboxes/`): 648 ms median start,
  image + size per start, snapshots beta. The legacy `Container` class is
  supported until **2026-12-31**; use `this.ctx.container` directly.
  `cloudflare/debian-trixie` system image is pre-loaded on hosts (no first pull).
- **Artifacts** (`/next-git-platform-on-cloudflare/`): binding, events, Workers
  Builds deploy on main + preview per branch, US/EU jurisdiction.
- **Issues → coding agent** (`/real-time-issue-detection/`): Workers error
  monitoring can POST grouped errors to a webhook → the router opens an agent
  card to fix it. v1.
- **Kitesurf** (agent browser on Workers): a reviewer agent can check each
  fork's preview. v1.
- **Cloudflare OS managed**: nearest Cloudflare-made neighbour (company agent
  workspace, git to GitHub, not phone-first, no fork/social model).

## Cost (read `~/.claude/docs/cost-hygiene.md` before adding anything metered)

- Artifacts (billing from 2026-10-14): 10k ops/month free, then $0.15 per 1k;
  1 GB free, then $0.50/GB-month. Risk: an agent `git fetch`-ing in a loop.
- Containers: a box bills its full memory while running (1 vCPU / 3 GiB custom
  size). Idle stop at 5 min, hard cap on agents per project and in total, in code.
- The subscription's 5-hour window is shared by every agent: parallel agents
  drain it faster. Measure it in v0.
- Every metered thing gets a `cloudcost` line or `gaps` entry the day it is created.

## Roadmap

- **v0** — personal engine: one project, router + N agents on N forks, cards, merge.
- **v1** — the "new GitHub" layer: public project pages, Import from GitHub,
  Fork & run, preview per fork, Issues → router, reviewer agent. ≈ contest entry.
- **v2** — profiles, project feed, discovery, outside contributors (BYO key).

## Baseline

Public-project baseline (`~/.claude/docs/public-project-baseline.md`) applies
from v1, when the first page is public. v0 is behind Cloudflare Access.
