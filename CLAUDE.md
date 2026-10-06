# forq

A Git platform for the age of agents, built entirely on Cloudflare and used from
the phone. Every project runs, and every fork comes with its own agents.

Personal project first; Cloudflare's "next Git platform" contest
(deadline 2026-10-14) is a bonus, not the driver.

## Name: qodebase (since 2026-10-06)

The product is **qodebase** at **https://qodebase.app**; "forq" stays as the
internal name (directory, Worker `forq`, DO classes, Artifacts namespace,
cookies, `x-forq-*` headers, the `forq` CLI inside boxes, the showcase handle
`forq`). Visible text says qodebase. The public GitHub repo is `eyalev/qodebase`.
- **qodebase.app was registered in the PERSONAL account** (zone `9630d9cb…`).
  Cloudflare lets a Registrar domain move between accounts only 10+ days after
  registration, so until then **`front/`** (Worker `qodebase-front`, personal
  account, deploy with the OAuth wrangler login) forwards every request to
  projectsbase.dev with `x-qb-front: <FRONT_SECRET>` + `x-qb-host`; forq's
  `fromFront()` (index.ts) checks the secret and rewrites the URL to
  qodebase.app, so all code sees the real host (`FRONT_HOSTS`, `isUiHost()` in
  env.ts). Visitor IP and cf facts ride along in `x-qb-ip` / `x-qb-cf`.
  Secret: `~/.config/forq-cf/front-secret` (set on both Workers).
- Sign-in on qodebase.app: Access sits only on projectsbase.dev/login, so the
  front sends `/login` to `projectsbase.dev/login?to=qodebase.app` and forq hands
  the session back through `/session` (the variant-host handoff).
- Cloudflare OAuth ("Sign in with Cloudflare"): the callback follows the host
  (`callbackUrl()` in install.ts); `https://qodebase.app/connect/cf/callback`
  is registered on the client.
- **After ~2026-10-16 (needs Eyal's approval in both accounts):** move the
  qodebase.app registration to the forq account (Manage Domain → Configuration;
  DNSSEC off), make it a custom domain of forq, add the Access app for
  qodebase.app/login, set `UI_HOST=qodebase.app` and clear `FRONT_HOSTS`, 301
  projectsbase.dev → qodebase.app, re-verify the OAuth client's domain (TXT) for
  qodebase.app, delete `qodebase-front`.

## qb, the CLI (src/cliauth.ts, cli/qb.mjs)

One Node file, no deps, served at `/cli/qb.mjs`, installed by `/cli/install.sh`
into `~/.local/bin/qb`; `/cli` explains it and `/llms.txt` lists every command
for agents. Works against any instance (`--host`, `QB_HOST`).
- Sign-in is a device flow: `POST /api/cli/start` → code; the person approves at
  `/cli/login?code=…` (signed in; SameSite=Lax cookie, so no cross-site POST);
  the CLI polls `POST /api/cli/token` (428 pending, 410 expired) and gets
  `qb_…`. Requests send `authorization: Bearer qb_…`; `who()` maps it to the user
  (a bad bearer is a 401, never anonymous). The Registry stores SHA-256 hashes
  only (`cd:`, `cu:`, `ct:` keys). Settings → Command line lists and revokes.
- API it uses: `/api/projects`, `/api/build`, `/api/import`, `/api/p/<o>/<n>`
  (+ `fork`, `router`, `agents`, `merge`, `files`, `search`, `git-token`),
  `/api/agents/<id>/{state,conversation,send}`.
- `qb clone` gets a 1-hour Artifacts token (write for the owner, read for
  others) and sets `credential.helper` to `qb git-credential <o/n>`, so later
  fetches/pushes mint a fresh one.
- Verified 2026-10-06: login approved from the phone page, whoami, tokens, info,
  open, files, search, clone + fetch, bad token refused, revoke.

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
| Worker | one Worker, `projectsbase.dev` in forq's own Cloudflare account (Access on `/login`) |
| Project | one Durable Object per project: repo name, agent list, status |
| Agent box | container DO on the `durable_object` scheduling policy + snapshots, **`box/Dockerfile` image pinned by digest** (Claude Code + mobile-agent + `box/box-api.mjs`; was computer2's image until 2026-10-02). Copy the slim parts of opendev `computer-next/src/computer2.ts`: boot over `exec`, snapshot on stop, idle stop at 5 min, secrets in tmpfs |
| Repo | Artifacts namespace `forq`: one main repo per project (new or **imported from GitHub**), one **fork per agent**, a write token scoped to that fork |
| Model | Claude Code in each box with Eyal's **subscription** (`CLAUDE_CODE_OAUTH_TOKEN`). Personal use only; a public version needs bring-your-own API key or a capped platform credit |
| Router | Claude Code too, in its own box, with a small `agents` CLI: `spawn "<task>"`, `list`, `status <state>`, `merge <id>` |
| Status | agents report through the CLI (`agents status pushed`), not Artifacts push events, which are per-repo subscriptions |
| Phone UI | project page: router composer on top, agent cards below (task, state, last line), tap → that box's chat view (from computer2), Terminal button behind it |

Not in v0: per-branch previews, voice, Google login, multiple users, contest video.

## Running it (v0)

- **Account:** forq runs in its own Cloudflare account `forq` (`887d7234…`,
  Workers Paid ) since 2026-10-02, not the personal one.
  Deploy with `CLOUDFLARE_API_TOKEN=$(cat ~/.config/forq-cf/api-token) npx
  wrangler deploy` (account token, write all, forq account only, expires
  2027-10-02); the OAuth login cannot see this account. Zones projectsbase.dev
  and ttyview.dev live there. The old instance (personal account) is frozen;
  `forq.kapps.dev`, `forq-run.kapps.dev` and `forq-{a..d}.kapps.dev` 301 to the
  new hosts (redirect rules in the kapps.dev zone). Repo mirrors of the old
  instance and the migration script: `~/.local/share/forq-backups/old-account-repos/`.
- Phone: https://projectsbase.dev/ (Access team `forqdev`, app `forq sign-in`
  on `/login`, One-time PIN; owner@example.com → handle `eyal` via `HANDLES`).
  Design variants: `a.`…`d.projectsbase.dev` (`variants/`).
  Explore → project `/p/<owner>/<name>` → Fork / Send to router / agent cards.
  Agent and router UIs: `/a/<agent-id>/agent/` (router id `<owner>.<name>--router`).
- Live apps: every static project on its own host
  `https://<name>--<owner>.ttyview.dev/` and every agent fork on
  `https://ag-<id>--<name>--<owner>.ttyview.dev/` (`runHost()` in env.ts),
  public, served from Artifacts by `src/run.ts` through the `*.ttyview.dev/*`
  route. Old `ttyview.dev/<owner>.<name>/…` links 301 there. Project names and
  handles cannot contain `--`.
- Seeds: `seeds/` (owner `forq`): calculator, todo, timer, tipsplit. To add
  one: `POST /api/p/forq/<name>/create {description}` → push with the returned
  token → `POST /api/p/forq/<name>/touch`.
- Laptop/admin: `https://forq.forqdev.workers.dev` with header
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
  BuildBox (`<slug>--build`, same image, no Claude) deploys main as Worker
  `forq-app-<owner>-<name>` on its own host **`<name>--<owner>.ttyview.dev`**
  (custom domain, `APPS_DOMAIN`), and each pushed agent fork as a Preview at
  **`ag-<id>.<name>--<owner>.ttyview.dev`** (`previews_enabled` on that custom
  domain: Cloudflare adds the wildcard record and certificate; own Durable
  Object storage). workers.dev (`*.forqdev.workers.dev`) stays as a fallback.
  Handles cannot contain `--`, so the owner is what follows the last one. A
  proxy Worker on `*.ttyview.dev` is not possible: fetching another Worker's
  workers.dev URL on the same account is error 1042.
- `CF_DEPLOY_TOKEN` (forq-builder): Workers Scripts write on the account plus
  Workers Routes write on the ttyview.dev zone only (custom domains need it).
- Builds run from BuildBox.alarm() (outlive the request), one at a time.
- `CF_DEPLOY_TOKEN` (Workers Scripts write only) goes to one wrangler command
  per build and never into agent boxes. It cannot delete Workers: use the
  account token (`CLOUDFLARE_API_TOKEN=$(cat ~/.config/forq-cf/api-token) npx wrangler delete --name forq-app-…`).
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

## Install into your own Cloudflare (src/install.ts)

`/personal-agents` → "Install in my Cloudflare" puts an agent into the user's
OWN account with no GitHub and no pasted tokens (research and options:
`docs/deploy-without-github.md`).
- **Sign in with Cloudflare** = forq's OAuth client `c7a959b3…` (forq account;
  secret `CF_OAUTH_CLIENT_SECRET`, laptop copy `~/.config/forq-cf/oauth-client.json`).
  Endpoints `dash.cloudflare.com/oauth2/{auth,token,revoke}`; access tokens live
  1 h, refresh tokens rotate on every refresh. **Public** since 2026-10-04
  (projectsbase.dev verified by TXT `cloudflare_oauth_client_publisher=…` on the
  apex; consent screen logo is `/icon.svg`, required to go public).
- **Installs DO** (one per forq email) keeps the encrypted refresh token and runs
  each install as steps from its alarm: workers.dev subdomain → R2 bucket →
  BuildBox `installs` instance runs `wrangler deploy` on the template's prebuilt
  `forq-release/` with the user's access token (never logged) → Access app on
  the Worker (`destinations: [{type: worker}]`, account members + their email,
  Cloudflare IdP when present) → ready. A failed step keeps the build log
  (Details on the progress page) and, where we know it, a fix link.
- **Templates** live in forq's Artifacts: `forq/workers-personal-agent` (import
  of DomWane/workers-personal-agent) with `src/connectors/ai-binding.ts` (Workers
  AI through the `AI` binding, so no `CF_API_TOKEN`) and `forq-release/`
  (`wrangler.base.json`, `no_bundle` index.js, `public/`). Rebuild it with its
  `scripts/forq-release.sh` and push. Add a template in `TEMPLATES`.
- Verified 2026-10-04 at 390 px: consent → Install → ready in ~50 s into the
  personal account, chat + web search + memory working, anonymous → 302.
- **Container agents** (`forq/container-agents`, local `../forq-container-agents`):
  OpenClaw, Hermes, T3 Code. **v2 (2026-10-05):** `durable_object` scheduling
  policy on Cloudflare's managed image `cloudflare/debian-trixie` (no
  Dockerfile, no registry push) with snapshots: first start installs the agent
  (npm / Hermes install.sh) and snapshots once `/opt/forq/installed` exists;
  later starts restore the newest snapshot (install + chats + files + logins
  survive). The DO alarm (1 min) snapshots every 15 min while state dirs
  change and before stopping an idle box (OpenClaw/Hermes 15 min, T3 30 min;
  file changes count as activity because WebSocket traffic never reaches
  fetch()). Measured restarts: T3 Code ~35 s to usable, OpenClaw and Hermes
  ~1.5 min. First installs: T3 ~2 min, OpenClaw ~1.5 min, Hermes ~2.5 min.
  Workers AI via `interceptOutboundHttp('ai.forq', ctx.exports.ForqOutbound)`.
  The Worker refuses anything Access did not sign in, then fills in the agent's
  own login. `/__forq/state`, `/__forq/logs` (install + agent log, processes),
  `/__forq/save`, `/__forq/restart[?fresh=1]`. Container deploys no longer
  restart running boxes (DO policy), so test entrypoint changes with a restart.
  Needs Workers Paid. Snapshot storage price: not documented (cloudcost gap).
  Wakes after the Fable tuning (restore on standard-2, waking page polls
  /__forq/state which also wakes the box, Node compile cache, smaller
  snapshots): T3 Code 18-23 s, OpenClaw 34 s, Hermes ~10 s to its dashboard.
  T3 Code: `/__forq/claude` signs in to Claude Code from a phone (runs
  `claude auth login` in a pty fed from a FIFO; T3's terminal is hidden at phone
  width); linked from the install's ready page.
- **Pi** (`forq/pi-on-cf`, local `../forq-pi-on-cf`): Cloudflare's pi-on-cf
  (harshil1712/pi-on-cf) as a Worker-only install: Workers AI through the AI
  binding (`src/server/ai-binding.ts` patches fetch), no Linux container, no R2,
  no Artifacts, no "Deploy app" (needs a deploy token), no `experimental` compat
  flag (deployed Workers refuse it; tracing observer off). Previews work
  (Dynamic Workers, `/__preview/<session>/`). Needs Workers Paid.
- **Cloudflare Agent** (`forq/agents-starter`, local `../forq-agents-starter`):
  Cloudflare's official cloudflare/agents-starter, the only option that fits the
  free plan. forq changes: model glm-4.7-flash (upstream kimi-k2.7-code needs
  Workers Paid) and real weather from Open-Meteo (upstream returns random demo
  values). No secrets; AI binding + one DO.
- Personal Agent (DomWane/workers-personal-agent, 11 stars, one author) was
  dropped from the page and installer on 2026-10-05: too small and unreviewed to
  vouch for. Its forq copy (forq/workers-personal-agent) is still in Artifacts.

## Run host details

- Since 2026-10-02 each repo has its own origin (see "Running it"), so apps
  never share storage, cookies or IndexedDB. The storage shim (`storageShim()`
  in `src/run.ts`, keys prefixed `<repo>::`) is only injected on the old shared
  path form, which is still served for names too long for one DNS label.
- Worker apps' hosts are taken out of the `*.ttyview.dev/*` route by no-Worker
  routes (`<host>/*`, `*.<host>/*`, added after each live deploy by
  `excludeFromRunRoute`); route Workers run before custom domains.
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

forq is public to read since 2026-10-02 (sign-in by emailed code, BYO API key),
and its repo is public (Apache-2.0). Done, in `src/baseline.ts` unless noted:
- `/about`, `/privacy` (contact hello@kapps.dev; privacy text says what
  kstats and the feedback form keep: change it with the code).
- **Feedback:** `/feedback?from=<path>`, server-rendered, honeypot, posts to
  remote-manage's central inbox (`FEEDBACK_KEY`, project `forq`); not stored →
  the visitor keeps their text and a push carries the message. Links in the
  UI tab's footers / More menu.
- **Analytics:** kstats site `forq` (origin https://projectsbase.dev), tag
  injected into every HTML page by `withBaseline` (HTMLRewriter on the way
  out), same-origin `/e` forwarder (`KSTATS_KEY`). Mark a browser as ours:
  open `/e?self=1` once per host (projectsbase.dev and each `X.projectsbase.dev`
  variant: localStorage is per origin).
- **Share cards:** og-cards theme `forq` (key `OG_KEY`, laptop copy
  `~/.config/forq-cf/og-key`), signed per page by `withBaseline`.
- **`/health.json`** `{sha, version, built, checks:[builds]}` (sha = the deploy
  `--tag`: always deploy with `--tag "$(git rev-parse --short HEAD)"`).
- **Alerts** (`src/alert.ts`, Pushover `PUSHOVER_TOKEN`/`PUSHOVER_USER`): a live
  app deploy that failed, a new sign-up, feedback that could not be stored.
  (notify-hub was the default, but its admin has no Access app yet, so no app
  token could be made.)
- **390 px check:** `node scripts/check-mobile.mjs` (proven to fail with `--break`).
- `/version.json`, robots.txt, crawler gate, admin behind the admin secret on
  workers.dev, observability on (forq and the variants).

Not yet, and why:
- `noindex` stays on every page and verified bots get only the front page:
  pre-launch. At launch, remove `noindex` and revisit the gate (the baseline
  now says welcome verified bots and make them cheap; forq's project/code
  pages read Artifacts per view, so measure first).
- Deploy by push (Workers Builds): forq deploys from the laptop with the
  forq-account token, because a forq deploy kills running agent containers and
  is timed by hand (see "Durable delivery"). Revisit when boxes survive deploys.
- The run host (ttyview.dev) serves only static demo apps, refuses verified
  bots and sends `noindex`; it has no baseline pages of its own.
