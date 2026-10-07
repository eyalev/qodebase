# sim — tasks (2026-10-07, "do all")

## 1. Leads policy in the fast sim
- [x] Disputes for every policy (author vs reviewer ping-pong rounds)
- [x] Leads: area leads (span N agents), decide disputes after 2 rounds, merge conflicts knowing both intents; leads queue like any server
- [x] Span-of-control sweep in the CLI (`--sweep span`)
- [x] UI: fifth policy chip, leads in "where the agents are"
- [x] Tests, README numbers (deploy batched with step 2)

## 2. Real-code sim on the laptop (no LLM)
- [ ] Generator: a small real project (folders, routes.ts, schema.ts, package.json, check script)
- [ ] Scripted operations (add handler + route, edit, rename across files, add field, bump dep, add cross-module call)
- [ ] Real git: commits via plumbing, merges via `git merge-tree`, tests on the merged tree
- [ ] Policies: agent review (git merge, redo), claims + redo + trains, leads (replay the operation on new main)
- [ ] Run bundle (change records + diffs + timeline) for the UI
- [ ] 50 then 500 agents
- [ ] Drill-down UI: repo map at time t, folder, file history, change record with diff, scrubber

## 3. Same run on Cloudflare
- [ ] Artifacts pricing + limits read; budget cap; cloudcost line
- [ ] Agents as Durable Objects pushing to Artifacts forks
- [ ] 500-agent run, measured latency and cost
