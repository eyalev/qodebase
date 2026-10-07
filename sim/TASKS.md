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
- [x] Results (before the fixes below, superseded): W=10 19% of PRs ran into another, W=50 40%, W=100 50%; nearly all "needs an earlier PR of the wave" (ordering), git conflicts only 1-3, clean-but-broken 1-9 (src/client/index.ts: PR #4743 imports ApplyGlobalResponse before the PR that adds it). Logs: sim/real/out/hono-w*.log, trace ~/.local/share/qbsim-bench/hono-replay-trace.jsonl
- [x] Final tree != history for W>=10 (fixed 2026-10-07, qb4): PR #4757 reverts code that only arrived with the earlier direct push "Merge #4735 from next". Authored on a wave-start main without that push, git took "both sides removed it" as done: the authored diff was empty and the revert landed as nothing. Now a PR applies as written only if its diff on S has the same per-file numstat as its real diff (else "needs an earlier change"), and a PR never lands past an earlier direct push that has not landed. All W: final tree = history
- [x] W=100 dropped 13 PRs (fixed): a chain of package.json/lockfile bumps, each needing the previous, lands one per wave; "needs an earlier PR" counted as a retry, so after 20 waves they were dropped while the queue was still moving. Waiting is no longer a retry; only a stall (3 waves with no landing) drops, and none happen. 0 dropped at every W
- [x] Results after the fixes: W=10 16% of PRs ran into another (56/346), W=50 40% (139), W=100 48% (167); ALL of it "needs an earlier PR of the wave"; 0 git conflicts, 0 clean-but-broken (the earlier 1-3 conflicts and 1-9 breaks, incl. #4743, came from the two bugs above: changes landing out of order)
- [ ] Jev + Clef-flash on real PR pairs: done (`sim/bench/hono-pairs.mjs`): 229 pairs, 1 text conflict, 0 clean-but-broken -> no positives; next: use the replay's own positives (the "needs an earlier PR" pairs and the #4743 break) as the bench set
- [ ] Viewer: hono-w*.json bundles exist in public/sim/runs (regenerate after fixes); run.js groups real folders now; screenshot gate + deploy (clean worktree of live sha + public/sim only; check containers; tell qb2)
- [ ] README section for the Hono replay; decide the headline ("for real PRs the problem is ordering, not conflicts")

## 5. Migration swarm (qb4, brief: sim/tasks/migration-swarm.md)
- [x] Goal: move Hono's src/utils/ (27 modules) to src/lib/ with shims: 26 move tasks (jwt/jws + jwt/types import each other: one task), 87 import rewrites (source + tests), 27 shim deletions; needs from the import graph (299 edges, critical path 6). sim/swarm/migration.mjs; whole migration applied in order = the starting tree's 5 type errors, nothing new
- [x] Judge: tsgo -p tsconfig.spec.json (tests included) --incremental: 0.3 s per check
- [x] Engine sim/swarm/run.mjs: ffa / phases (Bun: shared tree + ownership + gates) / stack / intent; agent time 18 min median (Bun 3.3 commits/agent-h)
- [ ] Runs at 10 / 100 / 1,000 agents; numbers
- [ ] Cross-check our measured clean-merge rate against Bun's 0.84-0.85 (calibration.json .merge_replay)
- [ ] Bundles in the viewer (kind move/use/unshim), README section, deploy

## Handoff (2026-10-07 ~22:15): continued in tab qb4 (forq/claude4)
Context for the next agent: sim/README.md (fast sim + real-code run), sim/cloud/README.md
(Cloudflare run, lessons), this file. Live: https://qodebase.app/sim/ and /sim/run.
Key results so far: fast sim (100k agents) land by intent 375k/h vs agent review 117k/h;
real-code 500 agents land by intent 849/h vs 242-290; Cloudflare 500 agent DOs: 7,033 pushes
(7 failed), single merge-queue DO saturates ~11 landings/s (shard next); Jev/Clef-flash
predict synthetic bad merges at AUC ~1.0, real Hono pairs have ~no positives.
Contest: deadline Oct 14; eligibility (US/Canada residents only) still unresolved.
