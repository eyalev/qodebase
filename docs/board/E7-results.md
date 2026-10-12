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

Arms, interleaved per rep, Haiku, v3 settings (no-wait, 60 turns, tiebreak), s6 = 150 generated tasks with no twins.
- **A n40 / E n40:** a fixed team of 40, without and with the board (+ dedupe + stagger).
- **A probe / E probe:** the throughput-probing controller from qb4's sim.md (g), allowed up to 40: start at 8; every
  30 s look at landings/min over the last 4 min; add 2 and keep them only if they earn at least 20% of an average
  agent, else go back and hold 3 min; -1 on a 25% fall while holding; halve only when dropped work exceeds 1 per
  agent per minute; never below 2.

A n40 r1 ran on 2026-10-11 with the same code and flags; the other 11 ran 2026-10-12 15:23–21:17 UTC, weekly meter
12% → 24%. Table: `summary.mjs --scenario s6` (last column: probe vs n40 for A and for E).

| measure | A n40 (n=3) | A probe (n=3) | E n40 (n=3) | E probe (n=3) | p E n40 vs A | p E probe vs A | p probe vs n40 (A / E) |
|---|---|---|---|---|---|---|---|
| wall time (s) | 1964 [1875–2141] | 1711 [1689–1783] | 1388 [1325–1544] | 1284 [1271–1470] | 0.1 | 0.1 | 0.1 / 0.4 |
| hidden tests (of 150) | 150 [150–150] | 150 [150–150] | 149 [148–150] | 150 [150–150] | 0.4 | 1 | 1 / 0.4 |
| agents allowed (median over the run) | 40 [40–40] | 10 [10–10] | 40 [40–40] | 10 [10–12] | 1 | 1 | 0.1 / 0.1 |
| agents allowed (max) | 40 [40–40] | 10 [10–12] | 40 [40–40] | 14 [12–14] | 1 | 0.2 | 0.1 / 0.1 |
| agent-minutes (all calls) | 927 [923.7–1026.7] | 270.3 [252.7–288.6] | 816.6 [735–909.2] | 229.2 [222.2–232.3] | 0.1 | 0.1 | 0.1 / 0.1 |
| agent-minutes wasted (built then dropped) | 300.2 [293.7–303.4] | 48.7 [47.3–49.3] | 134.1 [128.5–163.3] | 20.8 [11.6–24] | 0.1 | 0.1 | 0.1 / 0.1 |
| red commits on main | 0 [0–0] | 0 [0–0] | 0 [0–0] | 0 [0–0] | 1 | 1 | 1 / 1 |
| wasted work (calls that built a task then dropped it) | 113 [113–126] | 44 [43–44] | 90 [89–103] | 26 [14–29] | 0.1 | 0.1 | 0.1 / 0.1 |
| deferrals (skipped before any work) | 0 [0–1] | 0 [0–0] | 33 [19–37] | 7 [6–11] | 0.1 | 0.1 | 1 / 0.1 |
| calls cut at the turn cap | 35 [27–36] | 1 [1–2] | 44 [40–47] | 1 [0–4] | 0.1 | 1 | 0.1 / 0.1 |
| duplicate pairs built twice (of undefined) | 0 [0–0] | 0 [0–0] | 0 [0–0] | 0 [0–0] | 1 | 1 | 1 / 1 |
| same task landed twice | 11 [9–12] | 12 [10–14] | 1 [0–1] | 0 [0–1] | 0.1 | 0.1 | 0.5 / 1 |
| merge conflicts resolved | 1136 [1099–1213] | 342 [284–389] | 1333 [1186–1385] | 452 [413–453] | 0.2 | 0.1 | 0.1 / 0.1 |
| rebases aborted | 437 [402–504] | 224 [191–284] | 32 [25–35] | 13 [6–19] | 0.1 | 0.1 | 0.1 / 0.1 |
| resets to origin/main | 480 [449–529] | 253 [216–319] | 33 [22–41] | 12 [6–20] | 0.1 | 0.1 | 0.1 / 0.1 |
| rejected pushes recovered | 703 [685–713] | 429 [372–461] | 180 [180–182] | 143 [138–145] | 0.1 | 0.1 | 0.1 / 0.1 |
| agent calls | 356 [338–367] | 261 [259–265] | 313 [305–316] | 224 [210–227] | 0.1 | 0.1 | 0.1 / 0.1 |
| API-equiv $ (Haiku 5.5) | 10.31 [9.82–10.64] | 5.41 [5.09–5.51] | 9.39 [9.03–9.43] | 4.73 [4.47–4.98] | 0.1 | 0.1 | 0.1 / 0.1 |

What it says:
- **The controller wins on everything that costs.** Against a fixed 40 it used a quarter of the agent-minutes
  (A 270 vs 927, E 229 vs 817), about half the money (A $5.41 vs $10.31, E $4.73 vs $9.39) and a sixth of the
  wasted work, with all 150 hidden tests passing (p 0.1 on each, both with and without the board).
- **It was not slower.** Without the board it was faster (1711 vs 1964 s, p 0.1): 40 agents without coordination
  spend their time rebasing (437 aborted rebases, 35 calls cut at the turn cap). With the board the two are level
  (1284 vs 1388 s, p 0.4), so the board makes 40 agents survivable; the controller makes them unnecessary.
- **Board + controller is the best arm** on wall time, agent-minutes, cost and thrash. The board's own effect at
  the controller's team size: 1284 vs 1711 s, $4.73 vs $5.41 (p 0.1), and 0 vs 12 tasks landed twice.
- **Where the controller settled:** without the board it held 8–10 (in one run it kept 12 for 4 minutes, then gave
  them back); with the board it kept 12 and twice 14. Its tries are in `cap_log` per run.
- **One halving, in E probe r2:** at 19 min dropped work passed 1 per agent per minute and the cap went 12 → 6 → 3 → 2
  in 60 s, then probed back to 4. That run is the slowest of its arm (1470 s against 1271 and 1284), so the
  halving rule cost about 3 minutes there.
- **Log bug, decisions unaffected:** a "kept" line prints "+0.00 >= x" because the message is built after the
  baseline is reset. The comparison itself uses the right numbers. Fixed after the queue ended (code frozen during
  the runs).

Against qb4's predictions (probe with board ~1180 s at cap ~12; without board ~1310 s at cap ~10): observed
1284 s settling at 12–14, and 1711 s settling at 8–10. The caps match; both wall times are slower than predicted, the
board-less arm by 30%, because qb4's model underweights how much a team of 8–10 without the board loses to rebases
(224 aborted rebases per run). "Fixed 40 no faster than fixed 20" is tested by the controls below.

## W9b: tasks arriving during the run (s7, 10 agents)

Arms, interleaved per rep, 10 Haiku agents, v3 settings (no-wait, 60 turns, tiebreak). 30 tasks at the start, then 30
more appended to BACKLOG.md one at a time by a harness clone (exponential gaps, mean 20 s, seed rep*1000+7); each
arrival wakes one waiting agent. 10 twin pairs in all: 2 inside the first 30, 8 where an arrival twins earlier work.
- **A:** no board.
- **E:** board + dedupe pass over the first 30 tasks + stagger. Arrivals come in unannotated.
- **E pa:** E plus a dedupe call per arrival (one Haiku call against every task so far): a twin of work already on
  main is marked "closed: duplicate of Tx, nothing to do"; a twin of open work is marked "alias of Tx".

Run 2026-10-12 14:44–16:23 UTC, 9 runs, weekly meter 6% → 12%. Table: `summary.mjs --scenario s7 --since 202610121444`.

| measure | A (n=3) | E (n=3) | E pa (n=3) | p E vs A | p E pa vs A | p E pa vs E |
|---|---|---|---|---|---|---|
| wall time (s) | 670 [537–716] | 668 [587–749] | 664 [542–758] | 1 | 1 | 1 |
| hidden tests (of 60) | 60 [60–60] | 60 [58–60] | 54 [54–55] | 1 | 0.1 | 0.1 |
| arrivals closed as duplicates | 0 [0–0] | 0 [0–0] | 6 [5–6] | 1 | 0.1 | 0.1 |
| hidden tests failed among tasks not closed | 0 [0–0] | 0 [0–2] | 0 [0–0] | 1 | 1 | 1 |
| agent-minutes (all calls) | 86.5 [76.6–96.7] | 84.6 [74–88.6] | 71.6 [69.3–74.5] | 0.7 | 0.1 | 0.2 |
| agent-minutes wasted (built then dropped) | 20.3 [14.3–25.3] | 14.7 [12.6–18.4] | 9.9 [6.6–11.1] | 0.4 | 0.1 | 0.1 |
| red commits on main | 0 [0–0] | 0 [0–0] | 0 [0–0] | 1 | 1 | 1 |
| wasted work (calls that built a task then dropped it) | 27 [19–31] | 24 [22–27] | 17 [12–20] | 0.8 | 0.2 | 0.1 |
| deferrals (skipped before any work) | 0 [0–0] | 42 [37–44] | 34 [32–44] | 0.1 | 0.1 | 0.5 |
| calls cut at the turn cap | 0 [0–1] | 1 [0–2] | 0 [0–0] | 0.7 | 1 | 0.4 |
| duplicate pairs built twice (of 10) | 10 [10–10] | 4 [2–4] | 1 [0–2] | 0.1 | 0.1 | 0.2 |
| same task landed twice | 1 [0–2] | 0 [0–2] | 1 [0–3] | 1 | 1 | 0.7 |
| merge conflicts resolved | 157 [128–183] | 146 [127–172] | 122 [105–136] | 0.7 | 0.2 | 0.2 |
| rebases aborted | 86 [74–148] | 8 [4–9] | 10 [7–10] | 0.1 | 0.1 | 0.3 |
| resets to origin/main | 90 [80–169] | 8 [5–11] | 10 [9–11] | 0.1 | 0.1 | 0.5 |
| rejected pushes recovered | 179 [154–220] | 62 [57–63] | 56 [52–60] | 0.1 | 0.1 | 0.2 |
| agent calls | 116 [109–126] | 135 [127–150] | 127 [122–135] | 0.1 | 0.2 | 0.5 |
| API-equiv $ (Haiku 5.5) | 1.73 [1.55–1.92] | 1.85 [1.67–1.98] | 1.6 [1.56–1.68] | 0.7 | 0.7 | 0.2 |

What it says:
- **The per-arrival check was nearly always right:** 88 of 90 arrivals classified correctly, 0 false matches, 2 twins
  missed (one each in r2 and r3). Each call cost ~$0.0001 and ~2.8 s.
- **Duplicates:** pairs built twice fell from 10 (all of them, every A run) to 4 with the board and 1 with the
  per-arrival check (p 0.1 against A for both; E pa vs E p 0.2).
- **Work:** E pa used the fewest agent-minutes (71.6 against 86.5 for A and 84.6 for E; p 0.1 vs A, 0.2 vs E) and
  wasted the least (9.9 against 20.3 and 14.7; p 0.1 vs both). The board alone barely moved agent-minutes here.
- **Wall time did not move** (664–670 s medians, p 1): with tasks arriving over ~10 minutes the arrival schedule, not
  the agents, sets the finish. Cost is flat too ($1.60–1.85, p 0.7).
- **Git thrash:** both board arms cut aborted rebases (86 → 8–10), resets (90 → 8–10) and rejected pushes
  (179 → 56–62), p 0.1, as in s3.
- **Hidden tests, read with care:** E pa scores 54 of 60, but every failure is a task the harness closed as
  "duplicate, nothing to do" (5–6 per run): the hidden test wants the twin's name exported, and the agents did as
  told. Among tasks not closed E pa failed none. Closing a twin of landed work should say "make it a one-line alias
  of Tx", or the hidden tests should accept a closed twin; the result is a harness wording choice, not agent error.
  E's one shortfall (r3, T54 and T57) is a real miss.

Against qb4's predictions (pairs built twice none 13 / upfront 6 / per-arrival 0; agent-minutes 113 / 87 / 79):
observed 10 / 4 / 1 and 86.5 / 84.6 / 71.6. The order matches. The absolute numbers sit lower because s7 differs from
qb4's model: 2 initial twin pairs instead of 5 (10 pairs in all, not 13), and 27% of arrivals are twins instead of
30%. The predicted gap between no board and upfront dedupe (26 agent-minutes) did not appear (2); per-arrival dedupe
gave most of the saving.
