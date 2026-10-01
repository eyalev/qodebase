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

## Import from GitHub

- `/import` page; `/api/github/search?q=` (search or exact `owner/repo`/URL);
  `POST /api/import {repo, as?}` (`as` = admin importing for another handle,
  e.g. `forq` for the showcase). Unauthenticated GitHub API, cached per colo
  (repo 10 min, search 1 h): fine for one person, needs a token when public.
- Imports are shallow (`depth: 1`) and keep GitHub's default branch name, so
  never assume `main`: the run host and overview read `HEAD`, agents push
  `HEAD`, `forq merge` reads `origin/HEAD`.
- The previewed page (`entry`) is detected once from main's tree and can be
  overridden: `POST /api/p/<o>/<n>/entry {"entry":"demo.html"}`.

## Code browser (src/code.ts, src/codeui.ts)

- Reads go through Artifacts `readTree`/`readBlob` and are memoised per colo
  by git object hash (immutable, 1 day), so main and its forks share every
  unchanged folder and file; only "HEAD of repo X" is short-lived (15 s).
- `diffTrees` skips equal subtree hashes, so a diff costs what changed.
- An agent's Changes compare its fork with `agent.base` (main at fork time,
  recorded by `addAgent`), never main's current HEAD — after merges that would
  show other agents' work as removals.
- Content search: `Project.searchCode()` keeps an FTS5 `trigram` table
  (`code_fts`, substring = grep-like, needs ≥ 3 characters) per version (root
  tree hash), built on first search, four newest kept (`code_idx`). Writes
  count as DO rows written; a version is indexed once.
- Reading code is open to anyone who can see the project; the ownership
  check in the project API comes after the read verbs.

## Durable delivery (never type into a box from waitUntil)

waitUntil work is cut ~30 s after the response. Waking a box can take longer
(a request sat at "waking" for 38 min with nothing delivered). So:
- Router requests: `askRouter` stores the request and `Project.scheduleDelivery()`
  arms the project DO's alarm, which calls `POST /api/p/<o>/<n>/deliver`
  (admin) and waits; 3 tries with backoff, then "failed" with the reason.
- Review dispatch (`startReview`) is awaited by its callers (the review verb,
  agent pushes, verdicts), not left to waitUntil.
- Agent boots are safe: the box DO sends its own first task inside #boot.
- `AgentBox.send()` confirms the text was submitted: the input box must be
  empty within a few seconds (INPUT_EMPTY_SH: the last non-blank line above
  the pane's last horizontal rule is a bare "❯"), else it presses Enter, at
  most twice, and reports "unsent". A tall input scrolls its top rule off
  screen, so never look for two rules.
- `clearContext()`: one Ctrl-C if the input holds leftover text (never on an
  empty input: that starts "press again to exit"), Escape, type /clear, Enter
  (the first Enter only picks the menu entry; repeat while "❯ /clear" shows),
  then wait for the empty prompt before anyone types.
- Next review after a verdict: deferred through the project DO alarm
  (`scheduleReviewDispatch` → `/review-dispatch`, 409 while the reviewer is
  still busy, retried every 20 s): the verdict arrives from inside the
  reviewer's own turn.

## Roles (one box each, `src/box.ts` taskPrompt)

- agent `<slug>--<id>`: its fork, writable; reports with `forq status`.
- router agent `<slug>--router`: main, writable; `forq spawn|send|list|merge`.
- reviewer agent `<slug>--review`: main, read-only token; on every push forq
  queues a review (Project.queueReview → startReview in index.ts), it runs
  `forq fetch-agent` + `forq verdict`. One review at a time; reviews stuck in
  "reviewing" for 20 min requeue on the next page poll.

## Worker projects (src/build.ts)

- A project with a wrangler config at its root is `kind: 'worker'`. forq's
  BuildBox (`<slug>--build`, same image, no Claude) deploys main as
  `forq-app-<owner>-<name>.<sub>.workers.dev` and each pushed agent fork as a
  Preview (`ag-<id>-forq-app-….workers.dev`, own Durable Object storage).
- Builds run from BuildBox.alarm() (outlive the request), one at a time.
- `CF_DEPLOY_TOKEN` (Workers Scripts write only) goes to one wrangler command
  per build and never into agent boxes. It cannot delete Workers: use the
  normal wrangler login (`npx wrangler delete --name forq-app-…`).
- The sanitized config drops routes/env/account_id, refuses bindings that
  need account resources (KV, D1, R2, queues, services…), turns on
  observability + Issues, and adds a `previews` block.
- Agent push on a Worker project: preview build → buildDone → the Project DO
  calls `/api/p/<o>/<n>/review` on workers.dev to start the reviewer.
- **A forq deploy kills running containers**, the builder's too: a build in
  flight fails ("container connection is temporarily unavailable"); BuildBox
  restarts a dead container on the next job. Deploy forq when no agent works.
- Issues: `scripts/issues-automation.sh <forq-app-worker>` (cf CLI) wires one
  app Worker to `POST /api/hooks/issues` (secret header `cf-webhook-auth`),
  which hands the error to that project's router agent.

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

forq is public to read since 2026-10-02 (sign-in by emailed code, BYO API key).
Done: `/about` and `/privacy` with a contact address (hello@kapps.dev),
`/version.json`, `/health.json`, robots.txt, a crawler gate on WHO (verified
bots get only the front page), admin behind the admin secret on workers.dev,
`noindex` on every page (pre-launch). Not yet, and why: feedback form,
same-origin kstats analytics, og:image, push alerts, the 390 px check script
(pre-launch, private repo; add before announcing). The run host is public but
serves only static demo apps, refuses verified bots and sends `noindex`.
