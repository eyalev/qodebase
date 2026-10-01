# forq — tasks

## v0 — personal engine

- [x] Project dir, CLAUDE.md, TASKS.md, private repo, Homepage registration
- [x] Artifacts works on the account; namespace `forq` auto-created; cloudcost `gaps` entry `forq` (2026-10-01)
- [x] Step 1: Worker + Project DO + ONE agent box cloning its own fork, pushing a commit — agent `sleepsounds--j9ly7` pushed `3fade61` (README) in 38 s; boot 6.8-8.4 s from image
- [ ] Step 1 check: from the phone, open https://forq.kapps.dev/p/sleepsounds → agent → mobile-agent (WS through Access not yet verified in a browser)
### Round 2 (2026-10-01): social layer + step 2
- [x] Owners: projects are `<owner>/<name>` (repo `<owner>.<name>`), Registry DO lists them; Access email → handle
- [x] Seed 4 open-source demo apps under owner `forq` (calculator, todo, timer, tipsplit), MIT, static (`seeds/`)
- [x] Run host `forq-run.kapps.dev/<repo>/` serves any repo/fork from Artifacts (separate origin, per-commit cache, crawlers refused, noindex)
- [x] Fork button: `forq/todo` → `eyal/todo`, lineage + fork counts
- [x] DESIGN.md + explore page + project page (live app preview, README, files, forks, commits, agents panel); 390 light/dark + 1440 checked
- [x] Removed the sleepsounds test project (both repos + box)
- [x] Step 2: `forq` CLI in every box (status/list/spawn/send/merge), signed per-box token, router box per project
- [x] Step 2 check: one message to eyal/todo's router → 2 agents on 2 forks in parallel → both pushed (2.5 and 4 min) → both merged from the page, the router resolved the conflict itself; merged app verified (Clear done + "added X ago") in the box (`spawn`, `list`, `status`, `merge`) + router box
- [ ] Step 2 check: tell the router 3 tasks → 3 boxes on 3 forks working at once
- [ ] Step 3: phone project page — router composer + agent cards + tap-through to chat/terminal
- [ ] Step 3 check: 390 px screenshots light/dark; merge one fork into main from the phone
- [ ] Measure: subscription usage with 3 parallel agents, container box-hours, Artifacts ops

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

## v1 (later)

- [ ] Import from GitHub, preview per fork (Workers Builds), Issues → router webhook, reviewer agent, public project pages + baseline

## Open

- Name: `forq` is a working name.
- Demo repo: sleepsounds (pushed from the laptop's origin/master as `main`; the GitHub repo is private, so Artifacts import — public remotes only — could not be used).
- Subscription agents run on the plan's default model (Sonnet 5 seen); pass `--model` if a task needs more.
