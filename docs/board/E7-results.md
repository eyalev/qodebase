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

(pending)

## W8b: throughput-probing controller (s6, 150 generated tasks, Haiku)

(pending)

## W9b: tasks arriving during the run (s7, 10 agents)

(pending)
