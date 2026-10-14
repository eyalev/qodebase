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

## Private projects (2026-10-06)

`private` on ProjectInfo and the Registry Entry (Project.setPrivate; forks of a
private project stay private). Owner (and admin) only, everywhere:
- one gate in index.ts for `/p/<o>/<n>/*` and `/api/p/<o>/<n>/*` (others get 404,
  same as a missing project); every list on a page goes through `listFor()`
  (registry.ts `canSee`); Explore (world.ts) never lists private projects.
- live apps: run.ts refuses a private project's hosts (main and `ag-` forks)
  without a signed 12 h pass (`mintRunPass`, HMAC of slug + expiry). The pass
  arrives once as `?__qb=` and becomes a `SameSite=None; Partitioned` cookie on
  that host (so the project page's preview iframe works too). `withRunPasses()`
  adds passes to every app link in the project's pages and agents-html JSON,
  only for viewers who may see it. Visibility is memoised per isolate for 60 s.
- Not covered: a private **Worker** project's deployed app (its own custom
  domain) is still public.
- Set it: Public/Private on Build, More → Make private/public (also in the phone
  More sheet), `POST /api/p/<o>/<n>/visibility`, `qb visibility`, `--private`
  on `qb new`/`qb import`.
- Verified 2026-10-06 on a private import: anonymous 404 on page, code, app view,
  API, files, the app host; absent from /api/projects and Explore; the owner's
  app view loads in the iframe with the pass; toggled both ways.

## Ask box (2026-10-07, Jarvis mode phase 3)

`POST /api/p/<o>/<n>/ask {question, model}` → AgentBox `<slug>--ask` (role 'ask':
read-only token, no task at boot) runs `claude -p` in plan mode from its alarm
(startAsk → askQueue → #runAsks) on the owner's Claude (credentials from the box's
tmux env), `--model opus|sonnet|haiku`; `GET …/ask-result?id=` polls. Talk (qb2's
src/talk*.ts) routes explain/plan/why questions here. A forq deploy mid-answer kills
it (state stays running/failed): retry. Verified: eyal/todo, haiku, 9.5 s.

## Get your own qodebase (self-hosted copies, 2026-10-06)

`/own` → installer template `qodebase` (src/install.ts) puts this code into the
person's own Cloudflare account. Verified 2026-10-06: `my-qodebase` in Eyal's
personal account built a project end to end (router + 2 agents).
- **Release:** `node scripts/selfhost-release.mjs` builds `forq-release-selfhost/`
  from `selfhost/wrangler.jsonc` (no_bundle; extra modules have hashed names, so the
  release config carries its own text/data rules). Commit it, then push this repo to
  the Artifacts mirror forq/forq (`main-token`, force: it was a shallow import) —
  the installer clones that.
- **Two Workers:** `<name>` (the site, whole Worker behind Access; owner's first
  visit creates the account from HANDLES) and `<name>-run` (selfhost/run-worker.js,
  service binding to the main one): live apps in path form (`<run>/<owner>.<name>/`,
  workers.dev has no deeper subdomains) and the boxes' `/api/…` calls (API_BASE),
  which cannot pass Access. `who()` treats a workers.dev UI host as the site.
- **Installer:** per-install vars (#selfhostVars: hosts, OWNER_HANDLE, HANDLES,
  ADMIN_SECRET/KEY_ENC_SECRET kept per name), second deploy of `run/`, then after
  the lock ACCESS_TEAM_DOMAIN / ACCESS_AUD as Worker secrets. Asks for
  artifacts.read/write only for this template (`extra=artifacts`).
- **Boxes (BOX_IMAGE=managed):** start from cloudflare/debian-trixie; `#setup` in
  box.ts installs apt tools, Claude Code, mobile-agent (pinned), boot.sh and
  box-api.mjs (~50 s), and the first box snapshots the base (Registry `baseSnap`,
  SETUP_V); later boxes boot from it in 6-8 s. No Chromium yet.
- **Build** without the forq/blank starter creates an empty repo and the router
  pushes the first files (buildPayload empty=true). Worker projects cannot deploy
  on a copy (no deploy token): the builder refuses them.
- Claude: Settings takes an API key or a `claude setup-token` subscription token
  (`isClaudeToken`); Eyal's my-qodebase has CLAUDE_CODE_OAUTH_TOKEN as a secret.
- Hosted-only parts are off (`SELF_HOST`): /own, personal agents, try cards,
  analytics, og cards, feedback relay.
- **Builds survive restarts** (2026-10-06): a forq deploy reset the builder mid-
  install twice and the result was lost. BuildBox now keeps `running` (resumed
  twice at most), retries a lost container connection, keeps `result:<id>`
  (last 30); Installs asks `BuildBox.result()` while waiting. Still: deploy forq
  when no install is running.

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
- **Deploys do NOT kill awake boxes** (measured 2026-10-07: AgentBox/BuildBox use the
  `durable_object` scheduling policy, so a deploy restarts only the Durable Object; the
  container and every process in it kept running). What a deploy breaks is a command
  the DO is running in the box at that moment (an `exec` stream): its result is lost.
  BuildBox jobs resume and ask-box questions retry for that reason.

## Claude sign-in: whose Claude runs what (audit 2026-10-12)

Rules: `~/.claude/docs/claude-subscription-policy.md` (Anthropic, Oct 2026). Allowed: a platform runs the real,
unmodified `claude` binary and the person signs in with their OWN plan. Not allowed: our own agent loop calling the API
with a plan token; anyone's work on someone else's subscription. Audited (file:line evidence in the qb6 session,
2026-10-12):
- **One decision point:** `bootSpec()` (index.ts) picks every box's credential from the project slug's owner, never
  the requester. Instance owner (`onSubscription` = OWNER_HANDLE or the reserved `forq` handle, auth.ts) -> the env
  `CLAUDE_CODE_OAUTH_TOKEN`; anyone else -> their own stored key (setup-token -> `CLAUDE_CODE_OAUTH_TOKEN`, API key ->
  `ANTHROPIC_API_KEY`). No key -> refused. Agents, routers, reviewers (all pool reviewers), the ask box and `forq
  dedupe` (reads the box's own tmux env) all get it from there.
- **Nobody else's work on the owner's subscription:** the merger's model replay (tier 2, `QB_CLAUDE_TOKEN`) runs only
  for OWNER_HANDLE / `forq` projects and never for a public Watch run; Watch-a-run agents are scripted (no model, no
  container); Talk uses Workers AI only; installs get their own OWNER_HANDLE and no Claude secrets; ask/landing/flags
  routes are owner-only.
- **Plan tokens only through the binary:** every use is `claude` (interactive in tmux) or `claude -p` (ask box, merger
  replay, dedupe, the paste check). The binary is installed unmodified (box/Dockerfile: claude.ai/install.sh; managed
  image: `npm i -g @anthropic-ai/claude-code`); nothing patches it. The only direct Messages API call is
  buildsuggest.ts with qodebase's own API KEY (Workers AI when unset), never a plan token.
- **No auth method removed:** nothing unsets `ANTHROPIC_API_KEY` or other auth vars, no flag disables a method. Fixed
  2026-10-12: the merger replay set `ANTHROPIC_API_KEY=''` when none was given; it now passes only what it has.
- **Subscription only (2026-10-12):** no fallback anywhere (a person's work never moves to another key or anyone's
  plan). A box that sees Claude Code's auth error (`OAuth token has expired`, `Invalid API key`, `/login`, …) reports
  once (box.ts `#authCheck`): the person's key is marked `keyFailed`, all their boxes stop (`stopUserBoxes`), none
  start until they connect again (bootSpec refuses), Build answers `{need:'key'}`, pages carry `data-needs-key`.
  The owner's own subscription only logs (`auth_failed`).
- **The paste:** `POST /api/me/key {key}` -> `{ok, tail, kind: plan|api}`. API keys: one `/v1/models` call. Plan tokens:
  one tiny `claude -p` in BuildBox `keycheck` (throwaway HOME, the token only in that process's env, never logged).
  Stored AES-GCM (`KEY_ENC_SECRET`); `DELETE /api/me/key` removes it. Saving or deleting stops the person's awake
  boxes, so none keeps running on the old key.
- **Grey, as for Amp:** we store a pasted setup-token (encrypted). `forq dedupe` reads the credential from the box's
  tmux env because Claude Code keeps it out of its Bash tool's env (same person's credential, same box).
- **Closed 2026-10-12:** the ask box keeps its boot spec (credential + tokens) AES-GCM-encrypted at rest
  (`askSpecEnc`, same key store as pasted keys; an older clear spec is sealed on first read). `boot.env` lives on
  tmpfs (verified on a live box: /run, /run/opendev, /run/forq are tmpfs; `/tmp/boot.env` is a link into it) and
  holds no CC_ENV after start (boot.sh deletes the line; checked: 0 lines).

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
- **A forq deploy interrupts a build in flight** (the DO restarts and loses its exec
  stream; the container itself keeps running, measured 2026-10-07). BuildBox resumes an
  interrupted job (twice at most) and keeps its result for Installs to fetch.
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
  **Idle rule (2026-10-06, after three boxes ran 24/7 for a day, ~€1.17/day each):**
  use = requests through fetch(), POST chat completions through ai.forq
  (ForqOutbound → `touch('ai')`), and a kind's `workDirs` (T3: Claude Code
  transcripts). `stateDirs` changes only trigger snapshots and never count as
  use; 4 h with no use stops a box whatever else. `/__forq/state` wakes only
  with `?wake=1` (the waking page); `/__forq/stop` saves and stops. Verified on
  my-hermes: idle_stop 15 min after its last use. An open tab whose UI polls
  over HTTP still counts as use.
  Wakes after the Fable tuning (restore on standard-2, waking page polls
  /__forq/state which also wakes the box, Node compile cache, smaller
  snapshots): T3 Code 18-23 s, OpenClaw 34 s, Hermes ~10 s to its dashboard.
  T3 Code skips its "Connect your computers" wizard: the kind's `headScript` (injected
  into every HTML page) sets `onboardingCompletedAt` in localStorage `t3code:client-settings:v1`.
  T3 Code runs Claude as root with T3's "Full access" (bypassPermissions), which
  Claude Code refuses unless `IS_SANDBOX=1` (set in kinds.ts T3 env since
  2026-10-06; before that every Claude turn failed with "turn/setPermissionMode
  failed" + "Claude runtime stream failed"). A thread whose first Claude turn
  failed stays broken ("No conversation found with session ID"): start a new
  thread. `/__forq/claude-check` runs one tiny `claude -p` with and without the
  flag and prints both (spends a few subscription tokens).
  T3 Code: `/__forq/claude` signs in to Claude Code from a phone (runs
  `claude auth login` in a pty fed from a FIFO; T3's terminal is hidden at phone
  width); linked from the install's ready page.
- **Mobile Agent** (template + kind `mobile-agent` in `forq/container-agents`,
  since 2026-10-06; first named Claude Code / `claudecode`, still an alias in
  KINDS and mapped by `#renamed()` in the Installs DO): the real Claude Code TUI in tmux session `claude` (/workspace,
  `IS_SANDBOX=1`, `--continue`), mobile-agent (public eyalev/mobile-agent,
  pinned `MOBILE_AGENT_REF`) as the phone UI on :8080. The person signs in with
  their OWN Claude subscription at `/__forq/claude`; until then the pane waits.
  mobile-agent only accepts a same-origin browser Origin, so the Worker sends
  `origin: http://container` (Access is the lock). Same container rules as T3.
  `/` opens mobile-agent's `?ui=minimal` (terminal, six keys, input; `?ui=full`
  for everything). Status line from opendev's boot.sh, in Node:
  `[model] ~dir branch* $cost | subscription|API key`. `chown 0:0 /` +
  `XDG_RUNTIME_DIR=/run/user/0` (else Claude warns its messaging socket is off),
  tmux `focus-events on`. Claude starts only after the phone attaches (tmux
  list-clients) + 2 s: with the alternate screen off, lines drawn at the first
  60 columns stay cut off after the phone's resize.
  Codex (`@openai/codex`, pinned in `AGENTS_REF`) in its own tmux tab, started
  when the tab is first opened; from a phone pick "Sign in with Device Code"
  (ChatGPT sign-in waits for a localhost callback). The tab switcher is only in
  `?ui=full`. Grok skipped for now (Eyal, 2026-10-06): no official xAI CLI, and
  Superagent's `grok-dev` 1.1.7 pulls `@coinbase/agentkit` (wallet SDKs, 199 MB).
  After `qb install` updates a box, its Durable Object can run the old code for
  ~1 min: a `/__forq/restart` right away restarts with the OLD entrypoint.
- **Pi** (`forq/pi-durable`, local `../forq-pi-durable`, since 2026-10-06):
  Cloudflare's official example `cloudflare/agents` `examples/next/harnesses/pi`
  (5.8k ★ repo; Earendil's `@earendil-works/pi-durable` 1.0, 113k ★ pi repo):
  pi-durable on a Durable Object via `agents/harness/pi`, Workers AI
  (`@cf/moonshotai/kimi-k2.7-code`) over the AI binding, Workspace on the DO's
  SQLite, `exec` in Dynamic Workers (`LOADER`). Beta upstream. Release worker
  sits in `forq-release/worker/` so `no_bundle` rules skip the UI's JS
  (1.2 MB gzip instead of 3.2). Needs Workers Paid. Replaced the 23-star
  `harshil1712/pi-on-cf` port (`forq/pi-on-cf`, kept in Artifacts, unused) after
  Eyal's social-proof rule (~/.claude/CLAUDE.md).
- **Cloudflare Agent** (`forq/agents-starter`, local `../forq-agents-starter`):
  Push with `git push forq HEAD:main` (`origin` is Cloudflare's GitHub repo). Its
  release keeps the Worker in `forq-release/worker/` (no_bundle would upload `client/` too).
  Cloudflare's official cloudflare/agents-starter, the only option that fits the
  free plan. forq changes: model glm-4.7-flash (upstream kimi-k2.7-code needs
  Workers Paid) and real weather from Open-Meteo (upstream returns random demo
  values). No secrets; AI binding + one DO.
- **qb install / installs / uninstall** (`/api/installs` GET|POST|DELETE, bearer
  or session): install = update in place for the same name + agent (a name used
  by another agent is refused); the list is one row per name + account, without
  build logs, and marks `removed` when the Worker is gone (one scripts list per
  account per call); uninstall deletes the Worker (`force`, data included), its
  Access app and the records.
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

## Landing system (src/landing/, contest work, 2026-10-07)

How changes get onto main when many agents work at once (docs/contest/PLAN.md, brief
docs/contest/landing.md; owner tab qb6). UI: src/landingui/ (qb7), view "Agents at work".
- **Landing DO** per project (idFromName(slug)), separate from Project on purpose (the 2 s
  poll and the queue alarm never touch the Project DO): change records (intent, agent,
  fork, base, claims, events in plain words), claims + `overlap` warnings, the merge
  queue (alarm-driven trains of up to 8, stacked changes only after their base), tier-3
  escalation, `view()` = the qb6/qb7 contract. Infra failures back off 5 s doubling to 5 min.
- **MergeBox** container (`<slug>--merge`, forq-box image by digest, 1 vCPU / 3 GiB,
  idle stop 5 min) runs src/landing/mergejob.mjs (Text module): each change's reviewed
  diff (base..commit) applied to the LATEST main with `git apply --3way`; conflicts in
  shared files go to tier-1 handlers (package.json key merge, list files = routes/index/
  CHANGELOG/`.qodebase/landing.json` "list", lockfile regenerate); checks once per train
  (`.qodebase/landing.json` "check"), on failure one by one so a bad change bounces alone;
  records as git notes `refs/notes/qodebase`; one plain (non-force) push.
  **Custom container sizes need ≥ 3 GiB per vCPU**: 1 vCPU / 2 GiB was refused with no
  error, and exec() said "container not running" for 90 s (2026-10-07).
- **Demo mode**: DemoAgent DOs (`<slug>#<n>`) are SCRIPTED agents (no model, no container):
  they take tasks from src/landing/demoproject.ts (the Corner Café site, 14 tasks ordered
  so the story happens: handler replays, a bounce + fix, a lead redo, a stack), fork in
  Artifacts and push real commits with sim/cloud/src/gitpush.js. Caps in code: 12 agents,
  20 minutes. Demo project: eyal/corner-cafe (`info.landing = true` → the view is its tab).
- API: `GET /api/p/<o>/<n>/landing`, `POST …/landing/{approve,demo,flags}` (owner),
  `GET …/landing/state` (admin: merger box + each scripted agent's state and last error).
  Demo: `{"action":"seed"}` once on an empty project, then `reset` / `start {agents, speed}` / `stop`.
- Tests (real git, no Cloudflare): `node --experimental-strip-types --test src/landing/*.test.mjs`.
- **After a deploy, a Durable Object that never goes idle keeps running the OLD code**
  (scripted agents ticking every 1.5 s ran pre-deploy code for 3+ minutes, 2026-10-07;
  idle ones switch within a minute). Deploying a demo change: `stop`, wait until
  `landing/state` shows no agent alarms, then `start`.
- **Real agents** (projects with `info.landing`): src/landing/hooks.ts records at spawn
  (`forq spawn --files a,b` = claims, `--on <agent>` = stacked), push/verdict hooks, the merge tap
  and `forq merge` queue the change; landed agents are marked merged; bounced agents and the
  router are told through Landing's outbox (delivered from its alarm). `forq sync-main` rebases
  an agent on main. Flags (`POST …/landing/flags`): `agentModel` (the boxes' model on the
  subscription, e.g. claude-haiku-5-5), `llmReplay` + `replayModel` (tier 2 in the merger box,
  default claude-haiku-5-5; `landing.reviewedDiff` vs `landing.diff` = diff-of-diffs),
  `publicWatch` (Watch a run: anonymous `POST …/landing/watch`, caps in Landing.watchClaim).
- After a deploy: `GET …/landing/restart` (admin) puts a project's Landing and MergeBox on the
  deployed code; the view's `code` and the merger's `version` say which code answers. Don't poll
  an object you want to go idle.
- Restart arms the alarm before aborting (an alarm cut by the abort is never retried: a run's
  queue stood still). Reviewer pool: a reviewer whose dispatch fails, or whose review is resent
  after 4 min, rests 2 min so the next try goes to another box (one box that could not start,
  'container connection temporarily unavailable', held a run for 17 min, 2026-10-08).
- Stacked changes: base = the parent's pushed commit until the parent lands, then where the fork
  meets main (hooks.onPushed).
- Projects: eyal/corner-cafe (public demo + Watch a run), eyal/cafe-real (real Haiku agents),
  eyal/cafe-lab (private test bench).
- Cost: cloudcost gap `qodebase-landing` (local cloudcost settings).
- **Run timeline** (T1, src/landing/timeline.ts): `GET …/landing/timeline` (owner, or anyone on a publicWatch project) =
  lanes + spans + marks + critical path + totals, built from change events and trains; the merge job and MergeBox time
  their phases (box queue, cold/warm wake, fetch, apply/replay, checks, notes, push) and keep them on each train, with each
  fetch's own ms. What it showed first (2026-10-12): fetching was most of a train. Fixes: a warm box remembers main's branch
  and fetches main + notes + forks at once (forks after main only on a shallow clone); each fork is **prefetched** into
  `refs/qb/p/<id>` at the agent's push and again at approve (only when the box is awake with a clone; read token per fork;
  never into a working tree), and the train skips forks it already has. Watch run: median train 5.5 s -> 2.9 s, fetch per
  train 3.8 s -> 1.6 s, merger busy 54 s -> 33 s; warm trains fetch in ~0.6 s.

## Intent tree (src/intents.ts + src/landingui/intents.js, qb5, since 2026-10-14)

Read-only answer to "what does the developer see when a thousand agents work on one codebase": browse intents, not agents.
- Real builds: request (Project.requests) -> areas (the known area path holding most of a change's claims) -> each agent's
  intent (Landing change; agents numbered like the work page) -> its record, commits, diff. Fleet runs: the job -> folders
  nested by path (one-child chains collapsed) -> each file (last record wins; the diff from /runs' change endpoint).
- Status rolls up (needs you > blocked > working > waiting > done) with counts, $, time; children sorted by it and paged
  (50, max 200). `?why=<id>` = path to the request, `?find=<words>` = nodes by words (Talk's `intent` page action).
- API: `GET /api/p/<o>/<n>/intents` (same readers as /landing, behind the private gate) and
  `GET /api/runs/<repo>/<run>/intents` (fleet /records NDJSON, ~3 MB per 4k files, memoised per isolate: 15 s live, 1 h ended).
- UI: tab "Intents" + `#/intents`, `#/intents/why/<id>` on the work page; `#/intents/run/<repo>/<run>[/why/<id>]` and
  `#/intents/step/<label>` on /runs. The host calls `window.qbIntentsMount(root)` after every innerHTML; state lives in
  intents.js, so host re-renders keep what is open. build.mjs prepends intents.js to WORK_JS and RUNS_JS.
- Tests: `node --experimental-strip-types --test src/intents.test.mjs`; screenshots on real fixtures:
  `node --experimental-strip-types claude5/intents/harness.mjs --src .` then `node claude5/intents/shots.mjs`.

## Agent board (src/landing/board.ts, docs/board/PLAN2.md, since 2026-10-10)

Who works on what, live, inside each project's Landing DO (SQLite table `board`, 24 h). Landing flag
`board` (off by default; the lab A/Bs it), `crossDedupe`, `nextTask` (self-picked backlogs).
- Posts: the platform at spawn/push/review/queue/land/bounce; the box hook (`forq hook`, installed in
  /workspace/.claude/settings.json at boot only while the flag is on) on edits (file, debounced 30 s),
  commits (subject + files), and it puts the board into the agent's context on each prompt.
- Agents: `forq who [--recent [30m]] [--files a,b] [--area X]`, `forq intent "…" --files a,b` (reply
  carries live work on those files + finished work), `forq dedupe <file>|"task"…` (one Haiku `claude -p`
  in the box; credentials come from tmux because Claude Code keeps them out of its Bash tool's env).
- People: `GET /api/p/<o>/<n>/landing/board?recent=30&files=&area=&tail=N`; `view()` has `board {rows, aliases}`.
- A second router per project: `<slug>--router2` (two-teams scenario).
- After the adversarial review (W10, 2026-10-12): task ids count only when a registered list has them
  (`forq tasks <file>` or `forq dedupe <file>`, router only; ES2022/SHA256 are not claims); only the router
  registers lists and alias pairs (agents get 403); the hook posts an `alive` heartbeat on any tool use (at
  most every 2 min), so a slow agent keeps its claim; flag `claimNext` = atomic `forq next` (pickNext in
  board.ts: first task not done, not held by a live agent, not an alias's second name; asking twice returns
  the same task; a landed change marks its claim done). Two-teams: forq next hands out the union of lists.
- Tests: `src/landing/board.test.mjs`, `src/landing/boxhook.test.mjs` (the forq CLI against a stub API).

## Variants lab (qodebase.app/lab, docs/lab/PLAN.md, since 2026-10-08)

Which way of running many agents wins, on real work. Schema: docs/lab/runs-schema.md
(public/lab/runs.jsonl, one line per run; stages.jsonl `event:'summary'` per stage).
Owners: qb6 runner + flags + baselines, qb4 sim/predict.js/plan, qb5 scenarios + scorer, qb7 page.
- Runner (laptop): `node --experimental-strip-types scripts/lab/run.mjs --plan public/lab/stage1-plan.json --order N`
  (or `--scenario <id> --variant '<json>' | --baseline opus-alone|github`). Fresh UNLISTED project
  per run (eyal/lab-…), starter from qb5's scripts/lab/scenario.mjs (stable sha), the variant as
  landing flags (verified before the request), router prompt with the policy's instructions
  (opus-alone: one agent, no router), waits until settled, stops every box, scores on the laptop
  with scripts/lab/score.mjs --judge (hidden tests live in a PRIVATE repo
  $LAB_HIDDEN_DIR, never in this public repo or a box), appends the line.
  Log: ~/.local/share/qodebase-lab/runner.jsonl. `--out public/lab/runs.smoke.jsonl` for tests.
- Variant flags (`POST …/landing/flags`): plannerModel/coderModel/reviewerModel (haiku|sonnet|opus,
  mapped to the 5.5 ids at box boot), reviewers 0-6 (0 = no review, approved automatically),
  reviewStyle read|adversarial, policy intent|ffa|phases|stacking|leads|github (github/ffa: no
  handlers, no replay, a conflict goes back to the agent to rebase; ffa also skips checks),
  trainMax, claims, dedupe, unlisted, landing.
- Guards: the plan's (API-equivalent total, weekly-meter rise; checked before every run, also
  against the run's prediction; `stopAtWeeklyMeterPct` = absolute meter stop, also polled during a
  run); per run the Landing budget guard (lab ledger rows are per model, `project:model`).
- After each run the runner commits runs.jsonl by explicit path: never `git checkout` it (a run line
  was lost that way). `--collect` rebuilds a line from a finished project; `scripts/lab/recost.mjs`
  re-prices per model when the box cost lines cover >= 90% of the ledger's output tokens.
- Prices (checked 2026-10-08, platform.claude.com pricing): Haiku 5.5 $0.10/$0.50 (x5 above 100k-token
  prompts), Sonnet 5.5 $2/$10 (cache hit $0.10), Opus 5.5 $4/$20 (cache hit $0.20); no long-context tier
  for Sonnet/Opus 5.5. Claude Code's own cost estimate lags new models: don't use it.

## Talk: speak or type to the app (src/talk*.ts, since 2026-10-06)

A talk button on every signed-in UI page (`/talk.js`, injected by
`withBaseline`) opens a sheet: speak or type a sentence and the app acts,
answers, or both.
- **Fast lane** `POST /api/talk/decide`: clef-flash, one call, picks from the
  page's own links/buttons/fields/headings (`talkScan`, src/talkscan.ts, ids in
  `data-talk`) and ~24 of the person's projects (word match + theirs + the one
  the page shows). Mode act | ask | both | none, action, target, risky. Acts at
  p ≥ 0.45, offers "Maybe … ? Go" between 0.2 and 0.45, never acts when
  risky ≥ 0.5 (offers to take you to the page). Hedged at 1.2/2.5 s.
  "Go home" is a word rule (vocabulary in code).
- **Chat lane** `POST /api/talk/chat`: glm-4.7-flash, thinking OFF (7 s → ~1 s),
  tools go/press/type_into/show (show = point at elements in turn); a tool call
  comes back without words, so a second round asks for them. Fact sheet about
  qodebase in the system prompt (it invented plans without it). After a "both"
  sentence the action is done first and the new page answers, tool-free.
- **Dictation** (Talk settings, per device): phone's own (Web Speech, live
  words + a dashed preview of the target while you talk) or Whisper on
  Cloudflare (`/api/talk/transcribe`, whisper-large-v3-turbo, WebM/Opus,
  stops on 1.3 s of silence). Language en/he/auto; spoken replies
  when-I-talked/always/never.
- **Change requests** (2026-10-07): action `change` (+ a `wants_change` yes/no
  that overrides "open the app" at ≥ 0.75, or ≥ 0.55 with change ≥ 0.15) →
  the named project (word match, todo/to-do, one-letter slips) or the page's
  → one-line confirm → `POST /api/p/<o>/<n>/router {text}` from the page (the
  API checks ownership) → its `/changes`. Not theirs: Fork offer, then send to
  the copy. Never sent without the tap.
- **"What's going on"**: action `status` → `POST /api/talk/status`, no model:
  `listFor` + `Project.info()` for their 20 newest own projects (no boxes):
  working, ready to merge (with review state), blocked, undelivered requests,
  changed today/this week, link chips to each project's Changes. Cap 200/day.
- **Spoken replies** (phase 1, 2026-10-07): `GET /api/talk/tts` = Aura-1
  (default, $0.015/1k chars) or Aura-2 ($0.03), MP3 streamed
  (`returnRawResponse`), cached per colo by voice+text, TalkLog `tts_chars`
  cap. Off by default; speaker toggle in the sheet header, voice/speaker/when
  in settings. Every tap unlocks audio; blocked play() falls back to the phone
  voice. Measured: ~$0.017 per minute of speech (Aura-1), $0.027 (Aura-2),
  first sound ~1.4 s.
- **Code questions** (phase 3 hook): action `code` + depth → qb1's ask box
  (`POST /api/p/<o>/<n>/ask {question, model}`, poll `ask-result?id=`):
  fact→haiku, explain→sonnet, plan/why→opus ("plan…/why…/how would we…" is a
  word rule). Owner only; others get the chat lane over the page. A deploy
  kills a running ask: one retry.
- **Conversation** (phase 2): Cloudflare's voice kit (`agents/voice`,
  `withVoice(Agent)`), DO `TalkVoice` per handle (migration v7), route
  `/agents/talk-voice/<handle>` (only your own), client bundle `/talk-voice.js`
  (`scripts/build-talk-voice.mjs` → `src/talkvoicejs.gen.ts`; rerun after
  upgrading `agents`). Flux (@cf/deepgram/flux, end of turn built in) + Aura;
  `onTurn` runs the shared cores (`decideCore`/`chatCore`/`statusCore` in
  src/talk.ts); page actions go to the page as custom messages (`talk-cmd`,
  `talk-chat`, `talk-status`, `talk-confirm`), a spoken yes/no answers the
  pending offer, code answers come back as `say`. Navigation waits for the
  reply, the call resumes on the next page (one tap if the browser blocks
  sound); opening the page you are on does not reload. Hangs up after 30 s of
  quiet. Caps: TalkLog `voice_sec` 60 min/day each. Costs per turn/minute go to
  the Ledger (`recordCost`, kind voice).
  **Flux does not go through the AI Gateway** (its websocket call ignores the
  gateway option; Aura and the brain do), and did not show in
  aiInferenceAdaptiveGroups the same hour: its guard is the minute cap + quiet
  hang-up. Measured turn: end of speech → reply done 3.6 s; connect 0.6-1.2 s.
- **Push-to-talk dictation = tmux-web's recipe** (default "live", 2026-10-07): live
  words from Nova-3 over the voice kit (TalkVoice `createTranscriber`: dictate
  connections get `WorkersAINova3STT` with keyterms = the person's project names;
  conversations keep Flux), plus the whole clip recorded on the phone from the tap
  (MediaRecorder, independent of the call, which starts ~0.8 s later), re-read by
  Whisper (`/api/talk/transcribe?names=1`, project names as `initial_prompt`, an
  echoed prompt is dropped); Whisper's text replaces the live words (6 s timeout →
  live words). Trace: `rec_start`, `srv_stt`, `dc_whisper {live, final}`. Verified:
  live "List projects." → final "List some of my projects.".
  Nova-3 goes to the AI binding directly: through the gateway the first live words
  came ~7 s late. The client re-sends `mode` before every call (the agent forgets it
  when it sleeps). Settings: **How the mic works** (`mic`: send = tap, speak, tap
  Send, default, like tmux-web | pause | hold | conv), Whisper check on/off,
  **Microphone** ready while Talk is open (`keepmic`: the stream opens with the
  sheet when the mic is already allowed, so the recording starts at 0 ms) or only
  while speaking. Live words grow in the input (textarea, up to 35dvh, then scrolls).
- **Dictation path (since 2026-10-13 evening, tmux-web's way):** ONE MediaRecorder from the tap (WebM/Opus, 250 ms)
  feeds both the Whisper clip and our own WebSocket `/api/talk/stt-live` (Talk Worker → Workers AI nova-3 over the
  binding with `{websocket:true}`, no gateway, keyterms ≤ 40, binary frames normalised to bytes); chunks recorded before
  the socket opens are queued and flushed in order; no server turns. At the stop Whisper always reads the whole clip
  (a turn without it is traced `whisper_missing`). The agents voice kit (TalkVoice) is now only for conversation mode.
  Answering model (settings, per device): Claude Haiku 5.5 default for everyone (unified billing through the account's
  authenticated `default` gateway; $1/person/day, $5/day for all non-owner use, then Gemini, then GLM), Sonnet 5.5,
  Gemini 3.1 Flash-Lite (`GEMINI_API_KEY` secret, through qodebase-talk), DeepSeek V4 Flash, GLM-4.7-flash. Prompt,
  tools, model list: src/talkchat.ts; bench: `node scripts/talk-chat-bench.mjs --models haiku,gemini,…`.
- **Dictation from the bar (2026-10-13, Eyal):** tap the mic → 'Starting the mic…' until the recording is really on,
  then red 'listening' + a buzz; live words grow in the bar; tap again → the words stay (Whisper-checked; up to 15 s,
  replaced only if not edited) → Send. Never sent by silence unless 'sends when I stop talking' is chosen. The mic stays
  warm after use like tmux-web (5 min idle; released when the page is hidden): cold, it opened 0.8 s after the tap and
  the first words were lost. Keyterms ≤ 40 (65 made Workers AI refuse the nova-3 socket). Workers AI nova-3 has no
  Hebrew: Hebrew live words come from the phone's recogniser. Bench: `node scripts/talk-stt-bench.mjs` (Eyal's tmux-web
  dictations; EN whisper 7% / nova-3 10% WER vs tmux-web's final). Examples in the bar are hints, never sent.
- **Keep my recordings** (owner only; on by default for the owner since 2026-10-13, 14 days): Talk setting →
  each dictation clip goes to R2 `qodebase-talk-clips` (talk Worker binding
  `CLIPS`, lifecycle rule deletes after 7 days) with the live and final words;
  `/api/talk/clip` (POST save, `?key=` play, `?day=` list) answers 403 to anyone
  but the owner. `node scripts/talk-trace.mjs --clips` / `--clip <key> -o f.webm`.
- **Talk is its own Worker, `qodebase-talk`** (since 2026-10-07, Eyal's call):
  src/talkworker.ts + talk/wrangler.jsonc (no route; own TalkLog/TalkVoice;
  forq's Registry/Project/Ledger by script_name). forq hands /talk.js,
  /talk-voice.js, /api/talk/*, /agents/talk-voice/* to it over the `TALK`
  service binding with `x-talk-who` (signed-in person; stripped from incoming
  requests) and `x-talk-site` (forq's version). Self-host has no binding and
  runs Talk in-process (talkRoute). **Deploy Talk changes with**
  `CLOUDFLARE_API_TOKEN=$(cat ~/.config/forq-cf/api-token) npx wrangler deploy -c talk/wrangler.jsonc --tag $(git rev-parse --short HEAD)`
  (from a clean worktree): it never touches forq or its boxes, so no batching.
  Changes to the hand-off in index.ts still need a forq deploy. The owner's
  label reads `<forq sha> HH:MM talk <talk sha>`.
- Owner experience trace: `node scripts/talk-trace.mjs --min 30` (page views,
  taps, Talk steps, spoken replies, conversation events, errors; Eyal only).
- Eval: `node --experimental-strip-types scripts/talk-eval.mjs` (real page
  snapshots in scripts/talk-fixtures, real model through the gateway): 48/48,
  median ~0.6–1 s. Refresh fixtures when pages change.
- Cost: AI Gateway `qodebase-talk` (forq account, 120/min) + TalkLog DO daily
  caps (per person decide 600 / chat 150 / stt 300; total 5000/1500/3000);
  signed-in only. NOT under remote-manage's AI breaker (personal account only);
  cloudcost gap `qodebase-talk`. Self-host copies have the binding but no gateway.
- **Voice bar** (2026-10-13, manager's brief "everything by voice"): replaces the floating button on every
  signed-in page. A mini-player above the page's own bottom bars (placeBar probes under it): mic | what you are
  saying (3 lines) or the last answer | open the conversation; the sheet folds back into it; offers (Send? Stop
  this run?) show in it with chips. `slim` (no mic) above a project's composer (its mic stays, WhatsApp-style;
  composer dictation that sounds like a site command is offered in the bar); `data-talk-bar="mic"` on <body> =
  mic only (the deck), `"off"`, `?clean`, `?rec=1` = none. Signed out on `/`: a sign-in bar. Its height is kept
  free (a spacer on scrolling pages, padding on an app-like page's scroller).
- **Voice coverage:** the scan reads `#/` routes, summary, role=tab/switch/button, aria-labelledby, sliders and
  selects (label + value + choices), hidden panels a visible button controls, card names on duplicate labels
  (`data-talk-ctx`). Pages add actions an element cannot express with
  `window.__talkActions = [{id, text, run(sentence)}]` (runs.js moments, the deck's slides). Re-renders: elements
  are re-found by their words. **Gate** (`gate()` in talkdecide.ts, mirrored in the client): delete / sign out /
  revoke never by voice; stop / pause / resume / merge / build / start / watch after a yes (said or tapped; the
  page's own second "Stop this run" is pressed after a yes). Eval fixtures for runs, run_detail, home_build,
  settings, work, asks, deck.
- **What's going on** also names builds running/finished (Landing binding on the talk Worker), questions agents
  asked you (X5 ask-person), live fleet runs (needs `FLEET_KEY` as a secret on qodebase-talk).
- **Quick replies (latency, 2026-10-13, setting `fast`, on by default; off = the old path):** stop -> first sound was
  ~18 s on Eyal's 'What's going on?' (pause 1.5, Whisper 5.9, decide 1.5, status 2.9, summary 1.7, TTS 4.2). Now: a
  conversation turn ends on nova-3's endpointing (`end` = speech_final, forwarded by stt-live) + 0.2 s, 1.5 s quiet is
  the maximum; the turn acts on the live words at once and Whisper double-checks in the background (`whisperCheck`:
  word diff after normalising case, plurals, doubled words; any difference is traced `dc_whisper_check` and offered
  as "Did you say …?"); fixed phrases need no model (`quickCmd`/STATUS_RX, mirrored in the page); a decide is guessed
  on the live words while they talk (`guess`, at most 3 per turn, used only when its words are the final words);
  "what's going on" is kept warm (POST /api/talk/status {warm:1}, cap `status_warm`, every 30 s while Talk is in use
  and the page shows) and speaks its own short line (`spoken`), no summary model; replies are spoken sentence by
  sentence (first TTS at once, next prefetched as a blob); "One moment." when a slow lane starts (chat, code);
  the next turn's live socket opens while the answer plays. Aura goes straight to Workers AI, NOT through the gateway
  (the gateway buffered the whole clip: first byte 2-3 s; direct 0.3 s), and the first sentence streams into a
  MediaSource from our own fetch (the audio element's own request got an intermittent 500 on 'Hi.'). A turn ends
  early only when the words sound finished (`soundsDone`: '…update for' is a breath); a turn the live words did not
  make sense of waits ≤ 4 s for Whisper's words. Live-word sockets count against the day (`stt`, 1000/person) on
  their first audio, so unused prewarmed ones cost nothing. Result (2026-10-13, 31 recordings): speech end -> first
  sound p50 16.8 -> 3.8 s, p90 20.2 -> 5.2 s; in-page last word -> first sound p50 2.0 s.
  Every spoken turn writes a `latency` trace row (end,
  final, decide, data, ack, audio, total in ms from the stop); /admin/talk -> "Latency of spoken turns" = p50/p90.
  Bench: `~/.local/share/forq-deploy/qb2-tests/lat/bench.mjs <label>` (fixtures.json: Eyal's kept clips + Aura
  voices at 0.9/1.0/1.15 speed, fed as the mic in conversation mode on / at 390 px, real Chrome for MP3, every write
  intercepted; results.jsonl).
- **Conversations** (qb5, 2026-10-14, hidden: per device, `?conv=1` turns it on, `?conv=0` off; settings row only when
  on): several Talk threads, each with its log + chat memory, project chips (context), an automatic title and a status
  dot. Page side src/talkconv.ts (concatenated into TALK_JS; every hook in talkclient.ts is a no-op when off, and the
  harness proves the off DOM is HEAD's with no extra request), server src/talkthreads.ts: `GET|POST /api/talk/conv`,
  `/conv/delete`, `/conv/wipe`, `/conv/title` (glm-4.7-flash, budget 'chat'). Stored in the TalkLog instance
  `conv:<handle>` (never traces or counts; 30 days after the last write, swept on writes, 200 max) only for the owner
  and people with "Help improve Talk" on; everyone else's stay in localStorage. Chips: names said in a sentence
  (own + clearly a name -> on; short/near/public -> faded), and change/code commands' project; chat lane gets
  `context` (slugs, re-checked: own or public) -> chatSystem's context block + tool `send_change`, which only ever
  reaches changeRequest()'s confirm. Tests `src/talkthreads.test.mjs`; harness + shots `claude5/conv/`.
- **Page tools for Jarvis hands** (contract:
  `<jarvis webmcp contract>`): signed-in pages
  publish `window.__webmcp` {version 1, app qodebase, tools, call} and register
  the same tools with WebMCP (`document.modelContext`, else
  `navigator.modelContext`). Tools: `talk({sentence})` (submits to the sheet,
  resolves with Talk's answer / what it did, before any navigation),
  `open_project({name, part})` (fuzzy over `/api/projects`, spoken names),
  `go({page})`. Nothing destructive. One row per call: console + `/api/talk/log`
  (Workers Logs, `event: webmcp`). `/talk.js` revalidates on every load (ETag,
  `no-cache`), but a tab opened before a deploy keeps the old tools until it reloads.

## Mirrors (qodebase's own code on qodebase, 2026-10-14)

https://qodebase.app/p/eyal/qodebase is a read-only mirror of github.com/eyalev/qodebase with its whole history.
- Admin `POST /api/p/<o>/<n>/mirror {github, branch}` marks a project a mirror (kind static, app off: never deployed,
  though the repo has a wrangler config) and syncs it; the answer carries the webhook URL and secret.
- Sync: BuildBox `mirror` fetches the GitHub branch (full history) and force-pushes it to the project's repo (~30 s).
- On each GitHub push: webhook `POST /api/hooks/mirror/<o>/<n>` (GitHub hook id 698091321 on eyalev/qodebase, push
  events), checked with X-Hub-Signature-256 against a secret derived per project from ADMIN_SECRET (nothing stored).
  Workers Logs: module `mirror`, events synced / sync_error / hook_refused. Info shows `mirror.{syncedAt, head, ms}`.
