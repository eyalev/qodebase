# Agent board, round 2: findings (2026-10-10, draft while the Cloudflare runs finish)

Question (Eyal, 17:00 UTC Oct 10): build the board into qodebase, prove with real data that it is worth it,
on Cloudflare too, and find out whether it already exists.
Round 1: `FINDINGS.md`. Plan: `PLAN2.md`. Data: `E6-results.md` (local), `public/lab/runs.jsonl` stage 4
(Cloudflare), `sim.md` (d)-(f) (predictions written before the runs), `prior-art.md`.

## Answer so far
- **Yes, it is worth it, and it held at bigger sizes and with a stronger model**, once three bugs found in this round
  were fixed. With the fixed board, at equal hidden-test quality:

  | real agents, 3 runs each (medians) | wall | agent-minutes | cost | duplicate pairs built twice |
  |---|---|---|---|---|
  | 10 Haiku, 30 tasks (round 1, board without dedupe) | -28% | -30% | -28% | 4 -> 4; 0 with the dedupe pass |
  | 20 Haiku, 60 tasks | -24% | -23% | -16% | 9 -> 0 (of 10) |
  | 8 Sonnet, 16 bigger tasks | -31% | -36% | -27% | ~0 either way |

  Every difference above reached p = 0.1, the floor for 3 vs 3 (no overlap between conditions).
- **With Haiku the win is fewer duplicates and less git fighting; with Sonnet it is only less git fighting.** Sonnet
  recognised far-worded twin tasks by itself (0-1 of 4 built twice with no board). Git thrash fell 4-20x in every test
  (Sonnet: rejected pushes 43 -> 9, aborted rebases 21 -> 1).
- **Inside qodebase (Cloudflare, real boxes, the landing queue):** see section 3 (runs in progress).
- **Novelty:** most parts exist (MCP Agent Mail leases, Overstory's LLM "reimagine" merge tier, Beads' AI dedupe,
  Claim Plane / Foremerge intents). The combination does not, and we found no published real-agent A/B of time and
  cost for such a board. `prior-art.md`.

## 1. Three things that make or break a board (all found by real runs, not by design)
1. **"Finished" must mean on main.** The first board listed committed-but-unpushed and "done" work as finished. At 20
   agents, agents that ran out of turns mid-rebase left 3-4 tasks per run that everyone else skipped as "finished, not
   on main yet": hidden tests 56/60 vs 60/60, and wall 1.7x. Fixed: finished = landed; "says done, not on main" drops
   after 5 min. qodebase's built-in board had the same flaw (pushed/queued counted as finished); fixed before its runs.
2. **Never let a board invite waiting.** "T30 waits for T7" led one agent to run `sleep 600` and `sleep 900`, holding
   each run ~8 min after everyone else had finished. Fixed: no waiting, pick another task; `sleep` disallowed.
3. **Earliest claim keeps the task.** Five agents claimed the last task at once and each politely yielded; nobody did
   it. Fixed with a tie-break shown on the board ("claimed T20 90 s ago"); no task was lost after it.

Round 1's lessons still hold: agents must state their task (hooks alone see only files), queries must include recently
finished work, and far-worded duplicates need one dedupe pass before work, not each agent's judgement (for Haiku).

## 2. Congestion control (Eyal's favourite idea from the novelty search)
Set the number of working agents from the board's live thrash, like TCP (AIMD: +1 per calm minute, halve on a spike).
20 Haiku agents with the board, 60 tasks, 3 runs each:

| | wall | agent-minutes | cost |
|---|---|---|---|
| all 20 at once | 451 s | 131 | $2.73 |
| fixed 8 | 544 s (+21%) | 70 | $1.53 (-44%) |
| AIMD (settled at 3-4) | 962 s (x2.1) | 57 | $1.26 (-54%) |

All 60/60. With the board there was no congestion collapse (20 beat 8 on time), so AIMD does not make work faster; it
trades time for cost, and it also removed the red commits (hand-merged pushes) that 20 agents made. Useful as a
"cheap mode" dial, not as a speed-up. The sim predicted the x2.1 exactly; it expected the cap at ~7, it settled at 3-4.

## 3. Inside qodebase, on Cloudflare (W4, in progress)
Board built into the Landing Durable Object: event log, now view (TTL), recently landed, file/area queries; posts from
the platform (spawn/push/review/queue/land/bounce) and from a hook in every box; `forq who/intent/dedupe`;
earliest-claim answer in `forq intent`; the live "Who's doing what" view (phone first).
Pre-registered prediction (qb4, `sim.md` (e)): on land-by-intent the board does not change time or cost (the queue
already absorbs conflicts); its value there is duplicates, and in two-teams only with a cross-list dedupe; under plain
git (`github` policy) about -18% wall.

Round 1 (one run per cell, 6 Haiku coders, 0 reviewers), PRELIMINARY:

| cell | wall | hidden score | pairs built twice (of 5) | API-equiv $ |
|---|---|---|---|---|
| backlog, land by intent, board off | 805 s | 100 | 0 (agents saw each twin on main) | 1.44 |
| backlog, land by intent, board on | 619 s | 100 | 0 | 1.55 |
| two teams, board off | 775 s | 100 | 4 | 1.79 |
| two teams, board on + cross-list dedupe | 465 s | 97.5 | 0 | 1.22 |
| backlog, plain git, board off | 948 s | 87.5 | 0 | 1.46 |
| backlog, plain git, board on | 1012 s | 100 | 1 | 2.94 |

Round 1 reading (n=1 per cell, no claims yet): two-teams is the clear case (twins 4 -> 0 as predicted; also -40% wall,
-32% cost, which the sim did not predict). Backlog under land by intent: no duplicate win to show (board-off agents
aliased all 5 twins themselves; the sim expected ~4 built twice). Plain git: the board cut neither time nor cost in
this pair (+7% wall, 2x cost, 30 vs 17 bounces) but hidden 87.5 -> 100. Both plain-git runs were ~3.5x faster than
predicted. Rounds 2-3 decide; round 3 may wait for the weekly reset (Oct 12 13:00 UTC).

## 4. Recommendation (to be confirmed by section 3)
- Ship the board as a qodebase feature, on by default for projects with more than ~4 agents or more than one
  planner/team. Its unique value inside qodebase is the cross-team duplicate check and the "who is on this file" view;
  its speed/cost value is largest where plain git does the landing.
- Keep the three rules of section 1 as invariants, with tests (they are now in `src/landing/*.test.mjs` and
  `board/`).
- Offer team size as a cost/time dial; AIMD as an optional "cheap mode".

## Spend (round 2, API-equivalent on the subscription)
Local: 20-agent v1+v2 ~$35, congestion control $9.54, Sonnet $38.14. Cloudflare: see section 3. Weekly meter 73% ->
82% by 21:30 UTC (stop 87%). Real money: Cloudflare boxes, a few dollars (cap $30).
