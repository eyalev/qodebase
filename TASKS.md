# forq — tasks

## v0 — personal engine

- [x] Project dir, CLAUDE.md, TASKS.md, private repo, Homepage registration
- [x] Artifacts works on the account; namespace `forq` auto-created; cloudcost `gaps` entry `forq` (2026-10-01)
- [x] Step 1: Worker + Project DO + ONE agent box cloning its own fork, pushing a commit — agent `sleepsounds--j9ly7` pushed `3fade61` (README) in 38 s; boot 6.8-8.4 s from image
- [ ] Step 1 check: from the phone, open https://forq.kapps.dev/p/sleepsounds → agent → mobile-agent (WS through Access not yet verified in a browser)
- [ ] Step 2: `agents` CLI in the box (`spawn`, `list`, `status`, `merge`) + router box
- [ ] Step 2 check: tell the router 3 tasks → 3 boxes on 3 forks working at once
- [ ] Step 3: phone project page — router composer + agent cards + tap-through to chat/terminal
- [ ] Step 3 check: 390 px screenshots light/dark; merge one fork into main from the phone
- [ ] Measure: subscription usage with 3 parallel agents, container box-hours, Artifacts ops

## v1 (later)

- [ ] Import from GitHub, preview per fork (Workers Builds), Issues → router webhook, reviewer agent, public project pages + baseline

## Open

- Name: `forq` is a working name.
- Demo repo: sleepsounds (pushed from the laptop's origin/master as `main`; the GitHub repo is private, so Artifacts import — public remotes only — could not be used).
- Subscription agents run on the plan's default model (Sonnet 5 seen); pass `--model` if a task needs more.
