# E7: round 3 of the agent board (W8b, W9b, ablation)

Owner qb9. Plan: docs/board/TASKS.md (W8, W9) and the manager's ablation request. Harness `sim/board-ab/run.mjs`;
data `sim/board-ab/runs.jsonl`; tables from `node sim/board-ab/summary.mjs --scenario s3|s6|s7 --md`. Medians
[min–max], exact Mann-Whitney p (3 vs 3: the floor is 0.1). API-equivalent $ at 1-hour cache-write rates.

Budget (Eyal, 2026-10-11): about 25% of the week that starts on Oct 12 13:00 UTC. The queue stops itself before any
new run once the meter is 25 points above its post-reset value.

**Not run, by choice:** W3c (s5, 8 Sonnet agents on library-sized tasks). It was built and verified (0ea4228,
lab-hidden b15434f) but dropped when round 3 was trimmed.

## Ablation (s3, 20 Haiku agents): does the board beat dedupe + stagger, or a static split?

Arms, interleaved per rep, all with v2 settings (no-wait, 60 turns):
- **A:** no board.
- **A+:** A plus the same dedupe-annotated BACKLOG.md and 1 s stagger as E, and the same prompt minus the board lines.
- **A-split:** A plus a static rule: agent k starts at task k and takes every 20th one, then anything left.
- **E:** board v2 plus dedupe and stagger. The hook no longer posts the prompt text: `started` carries no text.

A v2 and E v2 from round 2 were not reused: the harness and hook changed since, so all four arms are rerun.

Run 2026-10-12 13:03–14:45 UTC, 12 runs, weekly meter 0% → 6%. Table: `summary.mjs --scenario s3 --since 202610121`.

| measure | A v2 (n=3) | E v2 (n=3) | A+ (n=3) | A-split (n=3) | p E v2 vs A | p A+ vs A | p A-split vs A 
|---|---|---|---|---|---|---|---
| wall time (s) | 558 [552–605] | 443 [400–493] | 505 [457–524] | 549 [381–550] | 0.1 | 0.1 | 0.1 
| hidden tests (of 60) | 60 [60–60] | 60 [60–60] | 60 [60–60] | 60 [60–60] | 1 | 1 | 1 
| agent-minutes (all calls) | 169.8 [168.7–189] | 128.2 [115.4–131.8] | 147.8 [133–148.4] | 161.8 [120.7–169.7] | 0.1 | 0.1 | 0.2 
| agent-minutes wasted (built then dropped) | 59.6 [54.5–73] | 20.4 [19.4–26.4] | 47.5 [39.1–59.8] | 30.1 [19.2–33.8] | 0.1 | 0.4 | 0.1 
| red commits on main | 0 [0–0] | 0 [0–0] | 0 [0–0] | 0 [0–0] | 1 | 1 | 1 
| wasted work (calls that built a task then dropped it) | 50 [42–51] | 24 [18–29] | 37 [33–47] | 18 [17–22] | 0.1 | 0.2 | 0.1 
| deferrals (skipped before any work) | 0 [0–0] | 33 [27–35] | 0 [0–0] | 5 [5–6] | 0.1 | 1 | 0.1 
| calls cut at the turn cap | 2 [1–6] | 3 [1–6] | 1 [0–2] | 9 [5–12] | 1 | 0.5 | 0.2 
| duplicate pairs built twice (of 10) | 8 [6–9] | 0 [0–0] | 3 [2–4] | 7 [6–9] | 0.1 | 0.1 | 1 
| same task landed twice | 1 [0–1] | 0 [0–4] | 1 [1–1] | 0 [0–0] | 1 | 1 | 0.4 
| merge conflicts resolved | 270 [259–298] | 273 [266–273] | 267 [256–282] | 418 [344–436] | 1 | 0.7 | 0.1 
| rebases aborted | 244 [235–247] | 11 [8–12] | 63 [55–76] | 33 [33–34] | 0.1 | 0.1 | 0.1 
| resets to origin/main | 266 [252–274] | 12 [8–13] | 80 [77–89] | 37 [34–44] | 0.1 | 0.1 | 0.1 
| rejected pushes recovered | 299 [298–301] | 63 [62–65] | 111 [106–131] | 100 [87–111] | 0.1 | 0.1 | 0.1 
| agent calls | 127 [119–132] | 123 [122–128] | 118 [112–124] | 112 [106–115] | 1 | 0.2 | 0.1 
| API-equiv $ (Haiku 5.5) | 3.52 [3.36–3.54] | 2.61 [2.53–2.8] | 2.85 [2.69–3.02] | 3.27 [2.46–3.32] | 0.1 | 0.1 | 0.1 

The board against the two ablations (exact Mann-Whitney, 3 vs 3):

| measure | E vs A+ | E vs A-split |
|---|---|---|
| wall time | 443 vs 505 s, p 0.2 | 443 vs 549 s, p 0.7 |
| agent-minutes | 128 vs 148, **p 0.1** | 128 vs 162, p 0.4 |
| API-equiv $ | 2.61 vs 2.85, p 0.2 | 2.61 vs 3.27, p 0.7 |
| duplicate pairs built twice | 0 vs 3, **p 0.1** | 0 vs 7, **p 0.1** |
| wasted agent-minutes | 20 vs 48, **p 0.1** | 20 vs 30, p 0.7 |
| rejected pushes | 63 vs 111, **p 0.1** | 63 vs 100, **p 0.1** |

**Answer:**
- **The board beats dedupe + stagger alone.** The dedupe annotation explains about half the gain. Agent-minutes go
  A 170 → A+ 148 → E 128, and pairs built twice go 8 → 3 → 0. Without a board, agents still build the same task
  twice when it isn't on main yet, and some marked twins still get built twice.
- **A static split is the strongest cheap alternative, but not conclusively worse on time or cost at n = 3.**
  - It removes most of the git thrash (aborts 244 → 33) and much of the wasted work.
  - It cannot prevent twins: 7 of 10 pairs were built twice, the same as A.
  - It is noisy: one A-split run was the fastest run of the ablation (381 s, $2.46), the other two matched A.
  - The board beats it clearly only on duplicates and rejected pushes (p 0.1); on wall, agent-minutes and cost the
    medians favour the board but the runs overlap.
- **Quality was 60/60 in every run of every arm.**

## W8b: throughput-probing controller (s6, 150 generated tasks, Haiku)

(pending)

## W9b: tasks arriving during the run (s7, 10 agents)

(pending)
