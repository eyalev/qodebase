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
- [x] Runs at 10 / 100 / 1,000 agents, seed 1 (table in sim/README.md); fixed on the way: shared-tree commits lost updates (applied at finish, committed 5 s later), stacks skipped the change being landed (most of stacking's waste), slow checks (import-resolution pre-scan before tsgo)
- [x] Seeds 2 and 3: free-for-all clearly worst; phases / stacking / intent overlap on time within seed spread (differ on waste and red main). Seed-averaged table in sim/README.md, sent to qb5
- [x] Trains of 8 (--train 8) and an instant queue (--landS 0) at 100/1,000, seeds 1-3: no change (trains average 1.1-1.3 changes; instant queue 30-43 s sooner). The floor is the dependency chain, not the queue
- [x] Clean-merge cross-check: jsr.json (the only file changed on both sides) clean 48-76% vs Bun 84%: a list file, not big source files
- [x] Bundles in the viewer (swarm stats, needs links, phase gates, readable folder names), screenshot gate 390/1440 light/dark, README section
- [x] Deploy: public/sim live since qb6 deployed 3e712ba (swarm bundles + viewer); later commits changed no public/sim files

## Handoff (2026-10-07 ~22:15): continued in tab qb4 (forq/claude4)
Context for the next agent: sim/README.md (fast sim + real-code run), sim/cloud/README.md
(Cloudflare run, lessons), this file. Live: https://qodebase.app/sim/ and /sim/run.
Key results so far: fast sim (100k agents) land by intent 375k/h vs agent review 117k/h;
real-code 500 agents land by intent 849/h vs 242-290; Cloudflare 500 agent DOs: 7,033 pushes
(7 failed), single merge-queue DO saturates ~11 landings/s (shard next); Jev/Clef-flash
predict synthetic bad merges at AUC ~1.0, real Hono pairs have ~no positives.
Contest: deadline Oct 14; eligibility (US/Canada residents only) still unresolved.

## 6. Variants lab, qb4's part (docs/lab/PLAN.md; schema docs/lab/runs-schema.md)
- [x] public/lab/predict.js: stage-0 predictor (finite goal: planner -> task graph -> coders -> review -> landing policy; baselines), <1 ms, exports KNOBS / variantKey / qualityScore / BASELINES (d225f46)
- [x] sim/lab/sweep.mjs + funnel.mjs: 47,880 combos x 2 scenarios x 5 seeds in ~65 s -> public/lab/stage0.json (frontier, picks, marginals)
- [x] Manager approved option B (2026-10-08): run list + guards in public/lab/stage1-plan.json, sent to qb6. Was: stage-1 picks + budget (unbudgeted: 6 picks + baselines x2 = 16 runs, ~$217 API-equiv; with --budget 60 --baseline-reps 1: 4 picks x2 + baselines x1 = 10 runs, ~$59). "No reviewers" winning is an assumption (defect cost model), stage 1 must measure review value
- [ ] Swap in qb5's scenario.json profiles when they land (sweep reads them automatically), rerun
- [x] CHECKPOINT after stage-1 run 3: recalibrated (lab-0.4): actual/predicted went from 0.43x wall, 0.13x cost, 0.67x quality to 1.07x / 1.29x / 1.13x on runs 1-3. Manager re-planned stage 1 (orders 11-16: cafe balance + github, port-ts opus-alone / 6 haiku / 12 haiku + 3 reviewers / github), predicted $30.87
- [x] sim/lab/calibrate.mjs -> public/lab/calibration.json (predicted at run time / now / real)
- [ ] Recalibrate after orders 11-16 (first port-ts runs, first reviewed run, first Sonnet coders via github)
- [x] Stage 1 done except 14b: bakery is where parallel first pays (same time, <half the cost, ~6 points lower quality; one run each). Sim lab-0.8: 0.92x time, 0.84x cost, 1.09x quality on the 7 fitted runs
- [x] Stage 2 part 1: bakery 3 runs each: one Opus agent 509 s median, q 96, $4.08; swarm ~1070 s (r3 platform stall dropped), q 91.7, $1.75. Opus ~2x faster, ~4 points better; swarm ~60% cheaper. Sim lab-0.9: 0.99x time / 0.95x cost / 1.09x quality on 12 fitted runs. Asked qb6 for timings.stallS
- [ ] Stage 2 part 2 = club AS IS (Eyal, 2026-10-08; manager session gone): reference 881 s (subagent) -> 565 box-s; predicted opus ~10 min vs swarm ~17 min; GO given to qb6 (c8b2300). After the runs: calibrate, 3-way bakery/club summary, decide the conditional 2nd opus-alone. Finding to report: the swarm is landing-bound (~1 landing / 60-100 s): 4x wider still 0.82x; faster landing needed (1.1x)
