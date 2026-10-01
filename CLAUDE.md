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

- Phone: https://forq.kapps.dev/ (Cloudflare Access app `forq`, id
  `8bfa01d4-…`, owner@example.com → handle `eyal` via the `HANDLES` var).
  Explore → project `/p/<owner>/<name>` → Fork / Send to router / agent cards.
  Agent and router UIs: `/a/<agent-id>/agent/` (router id `<owner>.<name>--router`).
- Live apps: `https://forq-run.kapps.dev/<owner>.<name>/` (and every agent fork
  at `/<owner>.<name>--<id>/`), public, served from Artifacts by `src/run.ts`.
- Seeds: `seeds/` (owner `forq`): calculator, todo, timer, tipsplit. To add
  one: `POST /api/p/forq/<name>/create {description}` → push with the returned
  token → `POST /api/p/forq/<name>/touch`.
- Laptop/admin: `https://forq.<sub>.workers.dev` with header
  `x-forq-secret: $(cat ~/.config/forq/admin-secret)` (acts as `eyal`, or
  `x-forq-as: <handle>`). Verbs: `/api/p/<owner>/<name>` (GET info,
  `create`, `fork`, `agents`, `router`, `merge`, `main-token`, `touch`,
  `agents-html`), `/api/agents/<id>/{state,wake,stop,send,exec,reset}`,
  `/api/admin/delete {repo?, box?, project?}`.
- Boxes call `/api/agent/*` on workers.dev with `x-forq-agent: <id>.<hmac>`
  (HMAC of the id with ADMIN_SECRET), through the `forq` CLI (`src/cli.ts`).
- Secrets: `CLAUDE_CODE_OAUTH_TOKEN` (copied from opendev D1
  `user_connections.claude_token`), `ADMIN_SECRET`.
- **Every deploy kills awake boxes** (same as computer2); they lose work since
  the last snapshot. Agents push to their fork, so pushed work is safe.

## Run host details

- Every HTML page gets a storage shim injected first (`storageShim()` in
  `src/run.ts`): localStorage/sessionStorage keys are prefixed `<repo>::`, so
  projects, forks and agent previews never see each other's data on the shared
  origin. Cookies and IndexedDB are not scoped.
- Files are cached per colo per commit for a day. **Bump `SERVE_V`** whenever
  what is served for the same commit changes (the shim did), or old bytes keep
  being served.

## mobile-agent in the boxes

The image's mobile-agent is a 2026-09-06 copy. Each box unpacks forq's newer
copy over `/opt/mobile-agent` at boot (once per version, `.forq-rev`), keeping
the image's `node_modules`. After changing mobile-agent
(`<mobile-agent repo>`, commit first):
`./scripts/pack-mobile-agent.sh && npx wrangler deploy`. The script refuses a
dependency change, which needs an image rebuild instead. The sheet's Terminal
tab loads `/a/<id>/agent/?ui=minimal` (terminal, six keys, input).

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
- Cloudflare answers Python's default `Python-urllib` user agent with error
  1010 (403) before the Worker runs; the CLI sends `forq-cli/1`.
- Right after `wrangler deploy`, requests can still hit the previous version
  for ~30 s (the first seed was created by old code as repo `forq`). Wait
  before scripting against a fresh deploy.
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
from v1, when the UI is public. v0's UI is behind Cloudflare Access. The run
host is public but serves only demo apps, refuses verified bots, sends
`noindex` everywhere and a `Disallow: /` robots.txt; nothing on it is metered
beyond per-colo, per-commit cached Artifacts reads.
