# Agent board, round 2: findings (2026-10-10/11)

Question (Eyal, 17:00 UTC Oct 10): build the board into qodebase, prove with real data that it is worth it,
on Cloudflare too, and find out whether it already exists.
Round 1: `FINDINGS.md`. Plan: `PLAN2.md`. Data: `E6-results.md` (local), `public/lab/runs.jsonl` stage 4
(Cloudflare), `sim.md` (d)-(f) (predictions written before the runs), `prior-art.md`.

## Answer
- **Yes, it is worth it, and it held at bigger sizes and with a stronger model**, once three bugs found in this round
  were fixed. With the fixed board, at equal hidden-test quality:

  | real agents, 3 runs each (medians) | wall | agent-minutes | cost | duplicate pairs built twice |
  |---|---|---|---|---|
  | 10 Haiku, 30 tasks (round 1, board without dedupe) | -28% | -30% | -28% | 4 -> 4; 0 with the dedupe pass |
  | 20 Haiku, 60 tasks | -24% | -23% | -16% | 9 -> 0 (of 10) |
  | 8 Sonnet, 16 bigger tasks | -31% | -36% | -27% | ~0 either way |

  Each row: no overlap between conditions (p = 0.1, the floor for 3 vs 3; not significant on its own). The same
  direction with no overlap in four separate setups (10 Haiku, 20 Haiku, 8 Sonnet, Cloudflare two-teams) gives a
  combined p ~ 0.02 (Fisher). Hidden tests are at ceiling, so "equal quality" means no difference detected.
- **With Haiku the win is fewer duplicates and less git fighting; with Sonnet it is only less git fighting.** Sonnet
  recognised far-worded twin tasks by itself (0-1 of 4 built twice with no board). Git thrash fell 4-20x in every test
  (Sonnet: rejected pushes 43 -> 9, aborted rebases 21 -> 1).
- **Inside qodebase (Cloudflare, real boxes, the landing queue, 18 runs):** with two teams on one repo the board's
  cross-list duplicate check stopped duplicate work (pairs built twice 4,4,3 -> 0,0,1) and runs finished 40% sooner and
  22% cheaper (p = 0.1 each). With one shared issue list, runs finished 46% sooner (p = 0.2) and no change bounced.
  Under plain git (no landing queue) it made no difference. Section 3.
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

## 3. Inside qodebase, on Cloudflare (W4, done: 18 runs, `w4c-results.md`)
Board built into the Landing Durable Object: event log, now view (TTL), recently landed, file/area queries; posts from
the platform (spawn/push/review/queue/land/bounce) and from a hook in every box; `forq who/intent/dedupe`;
earliest-claim answer in `forq intent`; the live "Who's doing what" view (phone first).
Pre-registered prediction (qb4, `sim.md` (e)): on land-by-intent the board does not change time or cost (the queue
already absorbs conflicts); its value there is duplicates, and in two-teams only with a cross-list dedupe; under plain
git (`github` policy) about -18% wall.

**Result, 6 Haiku coders, 0 reviewers, 3 runs per cell (medians; exact Mann-Whitney, 0.1 is the floor at 3 vs 3):**

| cell | wall off -> on | API-equiv $ off -> on | pairs built twice (of 5) | bounces | hidden score |
|---|---|---|---|---|---|
| two teams, one repo (on = cross-list dedupe) | 775 -> 465 s (-40%, p 0.1) | 1.80 -> 1.41 (-22%, p 0.1) | 4,4,3 -> 0,0,1 (p 0.1) | 3,5,0 -> 1,0,0 | 100 / 100 |
| shared issue list, land by intent | 805 -> 435 s (-46%, p 0.2) | 1.44 -> 1.34 (n.s.) | 0 -> 0 | 3,5,0 -> 0,0,0 | 100 / 100 |
| shared issue list, plain git | 948 -> 1012 s (n.s.) | 3.06 -> 2.94 (n.s.) | 1 -> 1 | 23 -> 27 | 97.5 / 97.5 |

Against the pre-registered prediction: duplicates right (two teams 4 -> 0 only with the cross-list pass; one slip when
the pass found 4 of 5). Time wrong in the board's favour: no gain predicted under land by intent, measured -40 to -46%.
Under plain git the predicted -18% did not appear (the bounces there are rebase conflicts the board does not touch).
Board-off agents on one shared list recognised all 5 twins already on main themselves (the sim expected ~4 built twice).
Caveats (w4c-results.md): 5 runs ended "timeout" from tail cleanup after all work had landed (wall = last landing,
unaffected); 5 earlier tries were excluded for bugs found while running (budget guard tier, a stalled push, a stray
unwatched run, settle while busy); two plain-git runs were collected after a laptop network outage.
Spend: real money $1.78 (Cloudflare boxes), API-equivalent $42.6 on the subscription.

Per-round detail. Round 1 (one run per cell, 6 Haiku coders, 0 reviewers), PRELIMINARY:

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

Round 2 (same cells; fixes between rounds applied to both conditions: merge job closes a redone duplicate as "already
on main", settle uses "busy" only, refused claims post "gave-up"):

| cell | wall off -> on | hidden off / on | pairs twice off -> on | API-equiv $ off -> on | bounces off -> on |
|---|---|---|---|---|---|
| backlog, land by intent | 980 -> 435 s | 100 / 100 | 0 -> 0 | 1.08 -> 1.32 | 5 -> 0 |
| two teams | 852 -> 472 s | 100 / 100 | 4 -> 0 | 1.80 -> 1.60 | 5 -> 0 |
| backlog, plain git | 1256 -> 1141 s | 100 / 97.5 | 1 -> 0 | 5.11 -> 4.74 | 29 -> 27 |

Two rounds (n=2, no p-values yet): two teams: duplicates 4,4 -> 0,0 and wall -42%; backlog under land by intent:
wall -41%, bounces 3,5 -> 0,0, no duplicate win (agents without the board aliased the twins themselves); plain git:
about even on time, cost noisy. Round 3 running.

## 4. Recommendation
- Ship the board as a qodebase feature, on for projects with more than one
  planner/team (where it measurably helped); elsewhere opt-in until the ablation (section 5) says more. Inside qodebase it pays most with more than one team or planner on a repo (duplicates gone, -40% wall,
  -22% cost) and speeds up a shared self-picked list (-46% wall). Open question: locally, with agents pushing to
  main with plain git, it cut time 24-31%; qodebase's plain-git policy showed no difference with 6 agents (its bounces
  are rebase conflicts the board does not touch). Team size and agent count likely matter; not yet tested there.
- Keep the three rules of section 1 as invariants, with tests (they are now in `src/landing/*.test.mjs` and
  `board/`).
- Offer team size as a cost/time dial; AIMD as an optional "cheap mode".

## Spend (round 2, API-equivalent on the subscription)
Local: 20-agent v1+v2 ~$35, congestion control $9.54, Sonnet $38.14. Cloudflare: see section 3. Weekly meter 73% ->
82% by 21:30 UTC (stop 87%). Real money: Cloudflare boxes, a few dollars (cap $30).

## 5. Adversarial review (2026-10-11) and what it changes
A separate reviewer agent attacked this work; the manager verified the key points against code and raw runs.
- **The tested thing is a bundle.** The board arm also got an upfront dedupe call that annotates the task list
  (`sim/board-ab/run.mjs` ~l.130), a 1 s stagger and extra prompt lines (same-meaning rule, no-wait, tie-break).
  The duplicate win comes from the dedupe pass (round 1: D without it still built 4 of 5 twice). Name it
  "board + upfront duplicate check" until the ablation separates them.
- **Mechanism.** In s3 v2, 32.8 of the 38.9 agent-minutes saved (~85%) were built-then-dropped work: agents stopped
  building tasks someone else was already building. Merge conflicts resolved rose slightly (260 -> 279; s4 28 -> 39);
  what fell were aborts and resets. "Less git fighting" was the wrong name for it.
- **Baseline.** The no-board prompt has no task-split rule. A static split (agent k takes every Nth task) or an atomic
  claim-next was not tested. Ablation queued first after the Oct 12 reset: s3 x3, arms A, A + dedupe-annotated list +
  stagger + same prompt minus board, A + static split, E.
- **Forking paths.** v2/v3 were tuned on s3 after v1 lost; s4 (Sonnet) is the only partly out-of-sample check.
  E v1 r3 (202610101804-s3-E-n20-r3) already ran on board 2cdf4e6 (finished = landed) and still lost 3 tasks at
  731 s, so the board fix alone did not cure v1: the no-wait line and the 60-turn cap mattered too. W7's fixed-20
  arm (2cdf4e6) and its AIMD/fixed-8 arms (0180d50) were not interleaved; "identical code" was too strong.
- **Cloudflare.** Excluded tries: 3 board-off, 1 board-on, each for a bug found while running. Under plain git, no
  difference. Hence "on for multi-team projects", not "on by default".
- **Prior art missed:** CooperBench (arXiv 2601.13295, ICLR 2026), real coding agents ~30% less successful when
  cooperating. Added to prior-art.md.
- **Implementation (qb6, after the reset):** task-id regex also matches ES2022/UTF8/SHA256; any agent can post alias
  pairs; slow agents lose claims after 10 min silent; consider an atomic `forq next` in the Landing DO. The local
  experiment hook posted the first 120 chars of the prompt as "started" (fix queued).
- **Costs:** relative comparisons hold; absolute API-equivalent $ are understated ~10-30% where single requests
  exceed 100k prompt tokens (similar share in both arms).

## 6. Ablation: does the board beat simpler options? (2026-10-12, E7-results.md)
s3, 20 Haiku agents, 60 tasks, 3 runs each, interleaved, all four arms rerun on the same code (medians, verified by the
manager from runs.jsonl):

| arm | wall | agent-minutes | API-equiv $ | duplicate pairs built twice (of 10) |
|---|---|---|---|---|
| A: no coordination | 558 s | 170 | 3.52 | 8 |
| A+: upfront dedupe annotation + stagger + same prompt, no board | 505 s | 148 | 2.85 | 3 |
| split: static rule, agent k takes every 20th task | 549 s [381-550] | 162 | 3.27 | 7 |
| E: board + upfront dedupe | 443 s | 128 | 2.61 | 0 |

- **The board beats dedupe + stagger alone** on agent-minutes, duplicates, wasted work and rejected pushes (p = 0.1 each);
  wall and cost favour the board (p = 0.2). The annotated task list gets about half the gain; agents read "likely the
  same as T3" and still build both unless the board also shows the twin taken or landed.
- **Against a static split**, only duplicates (7 vs 0) and rejected pushes separate (p = 0.1). On time, agent-minutes
  and cost the medians favour the board but the runs overlap (p 0.4-0.7); one split run was the fastest of all (381 s,
  $2.46). The split removes git thrash (aborted rebases 244 -> 33) but cannot stop twins.
- Reading: a split rule is a strong, free baseline for fighting over the same work; the board's unique value is that
  duplicates stop (and it does not need tasks known and numbered up front, which W9 tests with tasks arriving mid-run).

## 7. Tasks arriving during the run (W9b, E7-results.md)
10 Haiku agents, 30 tasks at start + 30 arriving over the run (8 reworded twins), 3 runs each (medians):
none / board + upfront check / board + a check on every new task: pairs built twice 10 / 4 / 1; agent-minutes
86.5 / 84.6 / 71.6; wall flat (~665 s: the last arrival sets the finish). The per-arrival check was right on 88 of
90 arrivals, 0 false. Its runs scored 54/60 hidden: every failure is a twin the harness CLOSED as 'nothing to do'
while the test expected the twin's own name. Lesson, now in qodebase (W9c): a twin is handed out as 'add a
one-line alias of the original under this name', never closed.

## 8. Growing the team (W8, E7-results.md; 150 tasks, Haiku, 40-agent pool, 3 runs each, medians)
Throughput-probing controller (start 8, add 2 while landings/min rise, step back otherwise, halve only on dropped work):

| | wall | API-equiv $ | agent-minutes | hidden (3 runs) |
|---|---|---|---|---|
| 40 agents, no board | 1,964 s | 10.31 | 927 | 150, 150, 150 |
| 40 agents, board | 1,388 s | 9.39 | 817 | 150, 148, 149 |
| controller, no board (settled ~10) | 1,711 s (p = 0.1 vs fixed 40) | 5.41 | 270 | 150, 150, 150 |
| controller + board (settled 10-14) | 1,284 s (p = 0.4 vs board + 40) | 4.73 | 229 | 150, 150, 150 |

The controller used about a quarter of the agent-minutes and about half the cost of 40 agents, and was not slower
(faster without the board; overlapping with it). Controller + board was the best arm overall. The fast sim predicted the
caps (~10 / ~12) but was optimistic on wall (1,310 / 1,180 s predicted). Of the fixed comparison teams only one run fit before the
weekly-meter stop: fixed 8, no board, 1,862 s, $4.63, 150/150 (about as fast as fixed 40, slower than the controller's
1,711 s, similar cost). Fixed 20 was not run, so 'the controller finds the best fixed size' stays untested.

## 9. Scaling to thousands: lanes (L1 fast sim, L2 real git, L3 Cloudflare pending)
- **One queue has a ceiling** (~830-900 landed/h in both sims, at 500, 2,000 and 10,000 agents); past ~300 agents
  more agents only add wait (median 61 min at 2,000, 130 after 6 h) and cost ($13.25/change at 10,000, real git).
- **Lanes (a landing queue per area) scale only with three conditions:** dependency-aware testing (lanes that test
  only their own area left main red 20-88% of the time; counting calls into other areas + testing reverse
  dependencies: 0 breaks in 26 cells), hot shared files split, and a controller per lane (the coordinated lane for
  cross-area changes otherwise becomes the next door).
- **Real git (L2, scripted agents, real tests, one run per cell):** 2,000 agents, 6 h steady state, 32 lanes +
  controllers: 1,271/h vs 896 (1.4x; the fast sim predicted 1,379), median wait 10 vs 130 min, $2.02 vs $2.66 per
  change, ~380 agents awake. 10,000 agents, 2 h (upper bound): 7,433/h vs 896 (8x), $2.09 vs $13.25, 9 vs 61 min.
  8 lanes was worse than one queue (coordinated lane overloaded). Cross-area share caps everything: at 20% cross,
  lanes give 1.5-2.7x at any lane count (fast sim).
- **Cloudflare (L3, scripted agents, 10 min, 5% cross):** 500 agents: 1 lane and 8 lanes both ~7,530 landed
  (demand-bound; per-lane compare-and-swap pushes miss 24%, as predicted). 2,000 agents: one lane landed 14,336 of
  28,969 (median wait 500 s, the one-door ceiling ~57k/h); 8 lanes + one main-door object 30,066 of 30,152 (median
  wait 8 s), 16 and 32 lanes the same (29,941 / 30,096: demand-bound from 8 lanes up); counts match the commits on main,
  main whole (fsck + tests) in every cell. 16 lanes at 20% cross: the first run broke main twice (a lane reset lost its
  saved state; fixed); the rerun landed ~29,800 with main whole, though 63 changes landed twice (same content; the door
  that refuses repeats is still open). Source: sim/cloud/README.md.

## 10. Bun's Zig->Rust port (BUN2-BUN5; sim/bun, sim.md (j)-(k))
- **Replayed on Bun's real patches** (one agent in history order ends on history's exact files): the port's
  commits are chains (89% edit lines an earlier commit wrote, longest 322), so 640 agents = 64 (26.3 vs 26.2 h;
  real 25.3 h). A blocking per-crate check costs +23% to +92% time; the same check run right after landing (fix
  forward) keeps 26.2 h and cuts broken-crate time 59-73% (middle-phase breaks modelled, labelled). On the real
  green-phase regressions, a compile check caught 1 of 4.
- **Re-cut by module, interfaces first (simulated from Bun's real structure, module order checked against the
  names the real patches use across files; not replayed):** 3.4-5.2 h at 64 agents, 5-8x faster than the replay;
  no gain from more agents (~450 modules at most in parallel). Strict order (wait for finished modules) 89 h: the use
  graph is cyclic. The chain was mostly how the work was cut.
- One merge queue with a 5-min full check is the wrong tool for a chain-shaped port (73-89 h in the fast sim).

## 11. Real builds inside qodebase on Cloudflare (R2-R5, 2026-10-12/13; real Claude agents on Eyal's plan)
Through the product's own Build path (the settings a user picks), private projects eyal/real-*; every change through the
landing queue with checks; timelines at /p/eyal/<project>/work#/timeline.

| build | setup | landed | via model replay of a collision | bounced | wall | real cost (normal rates) | estimate shown |
|---|---|---|---|---|---|---|---|
| R2 tip splitter (small) | 1 Opus agent | 1 | 0 | 0 | 149 s | $0.81 | 50-120 s, $0.21-0.28 |
| R3 home inventory (large) | Opus planner + 12 Haiku + 3 reviewers, board | 9 | 0 | 0 | 1,940 s* | ~$2.40 + $0.37 boxes | 420-1,080 s, $1.00-1.40 |
| R4 café website (huge) | planner + up to 20 Haiku (used 10) + 3 reviewers, board | 10 | 0 | 0 | ~1,770 s | $3.28 + $0.21 | 540-1,440 s, $1.70-2.30 |
| R5 travel planner (huge) | planner + up to 40 Haiku + 3-6 reviewers, board | 40 (one closed as already on main) | 28 | 0 | 2,257 s* | ~$17.1 + $0.88 | 540-1,440 s, $1.70-2.30 |

\* includes a false budget halt (2-6 min; pricing bugs, fixed) and, in R3, ~25 min of one finished-but-unpushed change.

What it shows:
- **Land by intent with real AI at scale:** in R5, 28 of 40 changes collided with work that landed first and every one
  was re-done by a model on the newest code, tested and landed; none was sent back.
- **At 40 agents the bottleneck is review:** agents spent 16,234 agent-s waiting for a reviewer vs 15,731 working, even
  with 6 reviewers; second, the merge train runs model replays one after another (1,266 of 1,360 s of train time).
- **Estimates are too low on real builds:** ~25% on time for one agent, ~3x cost for one Opus agent (session fixed cost),
  ~8x cost at 40 agents, where long-context Haiku calls (prompts over 100k tokens) were nearly half the bill.
- **Bugs found only by real runs, all fixed:** the budget guard priced Haiku and replay rows as Opus (3 false halts);
  Resume didn't wake mid-task agents; agents ended turns 'waiting' for others and nothing woke them (prompt + stacked-base
  notice + 4-min watchdog with a busy check); reviewers asked agents to rebase; the router under-split (now told how many
  agents it has); 'Need an idea?' fell back silently when its daily cap was used.
- **Open:** parallel model replays in a train; more reviewers by default at 20+ agents; why agents' contexts grow past
  100k; refit the cost estimate on these four builds.

**R6 vs R3, same 'Home inventory' prompt (R3-R6-quality.md):** one Opus agent 457 s / $3.87 vs a 12-agent team 1,940 s
(~1,100-1,300 s without the halt and the stall) / $2.77. Both apps do all 11 requested features at 390 px (each tried by
hand); the team wrote ~3x the code (22 files vs 7) with more polish bugs (overflowing tab bar, '0 boxs'); the solo app added
bulk move, quantity, currency. One build each: one strong agent was ~3-4x faster at similar quality; the team ~30% cheaper.
Decision (on the data: the user gets the same app ~4x sooner): Suggest picks one agent for Large too; Balanced stays one tap
away as the cheaper option. Huge is untested with one agent.
