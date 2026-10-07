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

## 4. Replay a real repo: honojs/hono (2026-10-07)
- [x] Clone (~/projects/github/honojs/hono) + `pnpm install --ignore-scripts`; type check = `tsgo -p tsconfig.build.json --noEmit` (0.6 s)
- [x] Last 500 first-parent changes (346 PRs + 154 direct pushes); `sim/hono/replay.mjs`
- [x] W=1 reproduces history exactly (final tree identical): the method check
- [x] Fixed on the way: direct pushes skipped (PRs could not apply); breaks that history also had counted (endless bounce); uncapped retries; deferred changes re-queued in reverse order; direct pushes (some are CODE, not release bumps) dropped when an earlier PR was deferred -> they now wait for history order
- [x] Results (latest): W=10 19% of PRs ran into another, W=50 40%, W=100 50%; nearly all "needs an earlier PR of the wave" (ordering), git conflicts only 1-3, clean-but-broken 1-9 (src/client/index.ts: PR #4743 imports ApplyGlobalResponse before the PR that adds it). Logs: sim/real/out/hono-w*.log, trace ~/.local/share/qbsim-bench/hono-replay-trace.jsonl
- [ ] OPEN: final tree != history for W>=10 even with 0 drops -> diff the replay's final main vs origin/main (git diff <finalMain> <history tip>) and find which landing resolved differently
- [ ] OPEN: W=100 drops 13 PRs (#5459, #5462, ...: "never applied") -> trace why
- [ ] Jev + Clef-flash on real PR pairs: done (`sim/bench/hono-pairs.mjs`): 229 pairs, 1 text conflict, 0 clean-but-broken -> no positives; next: use the replay's own positives (the "needs an earlier PR" pairs and the #4743 break) as the bench set
- [ ] Viewer: hono-w*.json bundles exist in public/sim/runs (regenerate after fixes); run.js groups real folders now; screenshot gate + deploy (clean worktree of live sha + public/sim only; check containers; tell qb2)
- [ ] README section for the Hono replay; decide the headline ("for real PRs the problem is ordering, not conflicts")

## Handoff (2026-10-07 ~22:15): continued in tab qb4 (forq/claude4)
Context for the next agent: sim/README.md (fast sim + real-code run), sim/cloud/README.md
(Cloudflare run, lessons), this file. Live: https://qodebase.app/sim/ and /sim/run.
Key results so far: fast sim (100k agents) land by intent 375k/h vs agent review 117k/h;
real-code 500 agents land by intent 849/h vs 242-290; Cloudflare 500 agent DOs: 7,033 pushes
(7 failed), single merge-queue DO saturates ~11 landings/s (shard next); Jev/Clef-flash
predict synthetic bad merges at AUC ~1.0, real Hono pairs have ~no positives.
Contest: deadline Oct 14; eligibility (US/Canada residents only) still unresolved.
