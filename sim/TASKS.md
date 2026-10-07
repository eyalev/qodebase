# sim — tasks (2026-10-07, "do all")

## 1. Leads policy in the fast sim
- [x] Disputes for every policy (author vs reviewer ping-pong rounds)
- [x] Leads: area leads (span N agents), decide disputes after 2 rounds, merge conflicts knowing both intents; leads queue like any server
- [x] Span-of-control sweep in the CLI (`--sweep span`)
- [x] UI: fifth policy chip, leads in "where the agents are"
- [x] Tests, README numbers (deploy batched with step 2)

## 2. Real-code sim on the laptop (no LLM)
- [x] Generator: a small real project (folders, routes.ts, schema.ts, package.json, check script)
- [x] Scripted operations (add handler + route, edit, rename across files, add field, bump dep, add cross-module call)
- [x] Real git: commits via plumbing, merges via `git merge-tree`, tests on the merged tree
- [x] Policies: agent review (git merge, redo), claims + redo + trains, leads (replay the operation on new main)
- [x] Run bundle (change records + diffs + timeline) for the UI
- [x] 50 then 500 agents
- [x] Drill-down UI: repo map at time t, folder, file history, change record with diff, scrubber

## 3. Same run on Cloudflare
- [x] Artifacts pricing + limits read ($0.15/1k ops past 10k/month, billing from 10-14); caps in code (600 agents, 20 min); cloudcost gap `qbsim-cloud`
- [x] Agents as Durable Objects pushing to Artifacts forks (in-Worker git push, no deps)
- [x] 10 / 20 / 50 agents: all pushes ok; concurrent forks of a fresh repo fail (retry + backoff now)
- [x] Run state survives DO resets (two runs lost before this; verified with a mid-run deploy)
- [x] 500 agents x 10 min: 5,810 landed, 7,033 agent pushes (7 failed), coordinator overloaded at ~11 landings/s; main resync on stale push added and verified; bundle + git fsck + README
- [x] Deployed (clean worktree: live code + public/sim), qodebase.app/sim/run?run=cloud-500
- [ ] Artifacts ops actually billed: check the dashboard/GraphQL after 10-14 (counted by the sim so far ~17k this month)
