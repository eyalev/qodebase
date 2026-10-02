# forq — tasks

## v0 — personal engine

- [x] Project dir, CLAUDE.md, TASKS.md, private repo, Homepage registration
- [x] Artifacts works on the account; namespace `forq` auto-created; cloudcost `gaps` entry `forq` (2026-10-01)
- [x] Step 1: Worker + Project DO + ONE agent box cloning its own fork, pushing a commit — agent `sleepsounds--j9ly7` pushed `3fade61` (README) in 38 s; boot 6.8-8.4 s from image
- [x] Step 1 check: agent UI through Access works (sheet Terminal tab, verified 2026-10-01; Eyal used it from the phone)
### Round 2 (2026-10-01): social layer + step 2
- [x] Owners: projects are `<owner>/<name>` (repo `<owner>.<name>`), Registry DO lists them; Access email → handle
- [x] Seed 4 open-source demo apps under owner `forq` (calculator, todo, timer, tipsplit), MIT, static (`seeds/`)
- [x] Run host `forq-run.kapps.dev/<repo>/` serves any repo/fork from Artifacts (separate origin, per-commit cache, crawlers refused, noindex)
- [x] Fork button: `forq/todo` → `eyal/todo`, lineage + fork counts
- [x] DESIGN.md + explore page + project page (live app preview, README, files, forks, commits, agents panel); 390 light/dark + 1440 checked
- [x] Removed the sleepsounds test project (both repos + box)
- [x] Step 2: `forq` CLI in every box (status/list/spawn/send/merge), signed per-box token, router box per project
- [x] Step 2 check: one message to eyal/todo's router → 2 agents on 2 forks in parallel → both pushed (2.5 and 4 min) → both merged from the page, the router resolved the conflict itself; merged app verified (Clear done + "added X ago") in the box (`spawn`, `list`, `status`, `merge`) + router box
- [x] Step 2 check: one message → 3 agents on 3 forks at once (eyal/calculator, 2026-10-01): started within 30 s, pushed within 1.5–3 min, 7 reviews, 3 merges (one conflict resolved by the router agent)
- [x] Step 3: phone project page — router composer + agent cards + Chat/Terminal sheet
- [x] Step 3 check: 390 px light/dark screenshots; merges via the card's Merge button
- [x] Measure: MEASUREMENTS.md — 3-change round: 23 Artifacts ops, 1.43 box-hours (≤ $0.05), ~2 pts of the 5-hour window, ≈ $4.26 at Sonnet API prices (≈ $1.42 per reviewed change)
- [x] Fixed during the measured run: durable router delivery (project DO alarm), deferred review hand-off, settled /clear, send() submit check (stalls: 38 min waking; 3 lost review requests)

### Round 3 (2026-10-01): feedback from the phone
- [x] "Router" → "Router agent" everywhere (UI + its prompt)
- [x] Progress after Send: instant "You …" line, background delivery, phase line with ticking seconds (Sending → Waking up → Starting Claude Code → Working on it · N agents started), Retry on failure, 2 s polling while busy
- [x] Agent cards say "starting" until the task is in (was "idle" while booting)
- [x] Cards show input → output: You asked / Its task, from the router agent / Result
- [x] Preview tabs above the app: Live + one per agent fork, Open in new tab; card Preview switches in place
- [x] Agent sheet (slides up): Chat (new web chat on tmux-web's conversation API) | Terminal (mobile-agent); verified chat round-trip waking an asleep agent, and the terminal's websocket through Access
- [x] Sheet handle: drag to any height (remembered per viewer), tap for full/half, drag to bottom closes
- [x] mobile-agent `?ui=minimal` (in mobile-agent itself: kernel uiModes + `minimal` plugin, eyalev/mobile-agent 113d18b): terminal, six keys, input. forq ships it into boxes at boot (box/mobile-agent.tgz, scripts/pack-mobile-agent.sh) instead of an image rebuild; the sheet's Terminal tab uses it

### Next
- [x] Storage isolation: the run host injects a shim first in every HTML page that scopes localStorage/sessionStorage to the repo (verified forq/todo vs eyal/todo). Not covered: cookies, IndexedDB, Cache Storage (per-repo origins would be the full fix; a `*.kapps.dev` wildcard route would swallow other projects)
- [x] "Open your fork" + "Fork again" on a project you forked; Explore marks it "you have a fork"
- [x] Merged t1tmy (done-today counter) into eyal/todo via the router agent
- [ ] Composer: trusted click on "Send to router" missed under phone emulation in ab-bg (form handler fine); check on a real phone
- [x] Terminal "clipping": not a phone bug. A visible phone claims its width and tmux follows (kb518's terminal-diag.jsonl: phone claimed 60, window 60; direct test 60 -> 54 holds). Only my minimized test browser clipped: hidden pages never claim (by design) and rAF is paused there, so headless/ab-bg cannot verify sizing. Residual, inherent to terminals: lines already in history keep the width they were drawn at

### Round 4 (2026-10-01): import from GitHub
- [x] Import screen (/import): one box for search or a pasted URL/owner/repo; GitHub public API, cached per query; refuses private repos and > 200 MB; shallow import (latest commit)
- [x] Imported projects show source, stars and license; Explore rows too
- [x] Web page detection: index.html at the root, else demo/ docs/ public/ dist/ www/ site/ example(s)/ web/ app/; owner can override (`POST /api/p/<o>/<n>/entry`, e.g. reveal.js → demo.html); "No web page" note otherwise
- [x] Default branch is no longer assumed to be main (run host and overview read HEAD; agents push HEAD; forq merge uses origin/HEAD)
- [x] Showcase under owner forq, each verified rendering at 390 px: 2048, reveal.js (demo.html), particles.js (demo/), Sortable, vivus, javascript-tetris

### Round 5 (2026-10-01): code browser
- [x] Browse: /p/<o>/<n>/code/<path> — folders, file view (line numbers, highlight.js with our tokens, #L links, tap number copies link), Markdown rendered, images inline, Raw / Open in preview
- [x] Versions: Live + every agent fork (?v=<agent>) on every code page
- [x] Go to file: whole-tree path list (cached per root tree), filter as you type
- [x] Changes: /p/<o>/<n>/changes/<agent> — fork vs where it started (agent.base, recorded at fork time; older agents: main's newest commit before the fork), per-file unified diff (jsdiff), +/- counts; "Changes" button on agent cards
- [x] Content search: FTS5 trigram index in the Project DO's SQLite, built on the first search of a version (text files only, ≤256 KB each, ≤3000 files / 20 MB), 4 newest versions kept; "Search file contents" at the bottom of Go to file, matches grouped by file with line links. Verified: 2048 (20 files), reveal.js (213 + 6 skipped), an agent fork

### Round 6 (2026-10-01): reviewer agent
- [x] Reviewer agent per project (`<slug>--review`, main read-only): every `forq status pushed` queues a review, one at a time; `forq fetch-agent` + `forq verdict approve|changes`; phone-size Chromium screenshots it reads itself
- [x] Card: Review line (waiting / reviewing / approved / changes + notes), Ask agent to fix, Review it, Merge anyway; Reviewer agent row under the router agent panel; stuck reviews requeue after 20 min
- [x] End to end on an IMPORTED project (branch master): fork forq/2048 → eyal/2048, router → agent 00l0u (7 min, SCSS + rebuilt CSS) → reviewer approved in 3 min after rebuilding Sass and reading 5 screenshots → merged into master, live app has the dark theme

### Round 7 (2026-10-01): Worker projects — forq's own builder + Issues → router agent
- [x] Pick + read the project: cloudflare/workers-chat-demo (BSD-3, 1.2k lines, Durable Objects only, no outbound calls, no secrets)
- [x] Deploy token `forq-builder` (id c90be299…, Workers Scripts Write on this account only, expires 2027-10-01) → `~/.config/forq/deploy-token` + Worker secret CF_DEPLOY_TOKEN; never in agent boxes. It cannot `wrangler delete` (no memberships read): delete with the normal wrangler login
- [x] BuildBox container: clone commit, sanitize wrangler config (forq-app-<slug>, workers.dev only, routes/env stripped, account-resource bindings refused, observability on, `previews` block so each preview gets its own Durable Object storage), npm install, `wrangler deploy` / `wrangler preview --name ag-<id>` (aliased Version URLs do not work for Durable Object Workers; Previews do); logs kept per build; restarts a dead container
- [x] Triggers: first page view of a Worker project and every merge → deploy; agent pushed → preview, then review
- [x] Page: Worker projects show the deployed app, status line (live / deploying with timer / failed + build log), Deploy again; agent tabs + Preview use preview URLs
- [x] Imported cloudflare/workers-chat-demo as forq/workers-chat-demo: deployed by forq's builder in ~30 s; chat verified (joined a room, sent a message, came back over the WebSocket)
- [x] Issues: builder turns on observability.issues; `scripts/issues-automation.sh <worker>` (webhook destination aae815c2…, policy 8b7bcf76…, automation per app Worker); POST /api/hooks/issues (cf-webhook-auth) → occurrences fetched with the forq-issues-reader token (Workers Observability read) → router agent, told to reproduce with the same request first
- [x] End to end on eyal/workers-chat-demo: 4 real 500s (invalid 64-hex room id → idFromString throws, stack trace returned) → Issues alert 20:14:34 → router agent → agent ggbs2 → preview → reviewer approved after checking the 404 in the preview → merged → live app redeployed, same request now 404 "Invalid room ID"
- [x] Also verified on the way: agent itvo6 (participant count) → preview in 21 s → review → merge → redeploy
- [x] cloudcost `forq` entry covers BuildBox, forq-app-* Workers, previews, Issues wiring and both tokens

Bugs found and fixed during the run:
- First deploy request was overwritten by a later save in overview() (kind detection)
- BuildBox kept a container a forq deploy had killed → health check + restart
- Alert text has no stack trace; the router agent guessed from recent commits → forq now fetches occurrences (method, path, status, headers) and asks for a reproduction first; it then reproduced the real bug and redirected the wrong agent itself
- Reviewer was put to sleep mid-review (mobile-agent "not busy" during long commands) → busy also from Claude Code's status; forq CLI calls count as activity
- Reviewer answered a new request from memory of the old one → /clear before each review (typed /clear needs a second Enter: the first only picks the menu entry), request names the commit, and verdicts on an older commit are refused (409)
- "You asked" on alert-born requests → "Reported by Cloudflare Issues"

### Round 9 (2026-10-02): public with your own API key, self-host guide, workflow videos
- [x] Public read: explore, project, code, changes, import pages without sign-in; actions, Settings, agent UIs, GitHub search need a session (anonymous = handle '' that owns nothing)
- [x] Sign-in: Access app now covers only forq.kapps.dev/login, policy "everyone" (emailed one-time code: no IdP configured, Google would need a GCP OAuth client) → forq's own HMAC session cookie, 30 days; new users get a suggested handle, changeable until they own a project
- [x] Settings: Anthropic API key checked with one /v1/models call, AES-GCM encrypted (KEY_ENC_SECRET), last 4 shown; their boxes run ANTHROPIC_API_KEY + ANTHROPIC_MODEL=claude-sonnet-5-5; Eyal (OWNER_HANDLE) keeps the subscription
- [x] Limits for others: 10 projects, 2 awake boxes across their projects (their containers bill this account), no Worker deploys (they run on this account); no-key requests fail at once with "add your key"
- [ ] A real agent run on an API key: needs a forq-specific Anthropic key from Eyal (did not run forq agents on desk's key: one key per project); key save/check verified with it, then removed
- [x] Baseline pass: /about, /privacy, /version.json, /health.json, robots.txt, crawler gate (verified bots: front page only); not yet: feedback form, kstats, og:image, push alerts (noted in CLAUDE.md)
- [x] Self-host guide (SELF_HOST.md) + no account-specific values left in src (UI host, API base from config); repo stays PRIVATE (Eyal, 2026-10-02). Open item: a public Dockerfile for the box image
- [x] Video research → docs/video-guide.md
- [x] Recording rig (video/rig.mjs + compose.py): phone-size browser, visible taps, captions, time-lapse capped at 8 s per wait, readable plain-text pages, mp4
- [x] W2 import, W4 code browser, W5 sign-up + key (re-recorded: captions now lead their taps)
- [x] W1 fork + router + agents + review + merge (both approved on their own tasks; router resolved a real index.html conflict)
- [x] W3 Worker error → automatic fix (workers-chat-demo-3; Issues → router → 1 agent → approved first time → merged, ~8 min real; last scene re-shot after propagation via splice.py)
- [x] Combined contest video video/out/forq-contest.mp4 (6:34) + .srt (combine.py)
- [ ] Eyal reviews the cut; voice-over is optional (captions carry it now)
- [ ] Clean up: eyal/workers-chat-demo-2's app Worker is now redundant with -3 (ask before deleting)
- Fixes the videos and their runs surfaced: reviewer prompt judges the agent's own task; on-screen spinner = busy; send() waits for the ready prompt and confirms Claude Code started (a request to a just-booted router was lost); delete destroys a project's boxes; review watchdog; settings errors show under their form

## v1 (later)

- [x] Worker previews: forq's own builder (`wrangler preview`), not Workers Builds (round 7)
- [x] Issues → router agent (round 7)
- [ ] Public forq: project pages without Access + public-project baseline — needs Eyal's decision on how others pay for Claude (BYO API key / capped credit / self-host)

## Open

- Name: `forq` is a working name.
- Demo repo: sleepsounds (pushed from the laptop's origin/master as `main`; the GitHub repo is private, so Artifacts import — public remotes only — could not be used).
- Subscription agents run on the plan's default model (Sonnet 5 seen); pass `--model` if a task needs more.
