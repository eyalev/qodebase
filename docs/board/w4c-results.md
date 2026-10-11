# Board W4c: board off vs on, on real qodebase boxes (2026-10-10/11)

Plan: `public/lab/board-w4-plan.json` (qb4's predictions, lab-0.11). Lines: `public/lab/runs.jsonl`, stage 4.
Every run: Haiku 5.5 coders, 6 coders (two-teams: 3 per team, two routers on one project), 0 reviewers,
scenarios by qb5 (todokit, 30 tasks, 5 far-worded duplicate pairs, self-picked backlog). 3 runs per cell,
interleaved off/on.

**Board off** = no board and no dedupe at all. The `dedupe` flag in the variant is inert in self-pick
cells, because the router is told never to assign, split or dedupe. **Board on** = the board in the Landing DO
(hook, `forq who`/`intent`, earliest claim keeps a task) plus one `forq dedupe` pass run by the router.
In two-teams the pass reads both teams' lists (`crossDedupe`).

## Results (per run, in run order; median in bold)

| cell | wall s | API-equiv $ | hidden % | pairs built twice | aliased | bounces |
|---|---|---|---|---|---|---|
| backlog, land by intent, OFF | 805, 980, 599 (**805**) | 1.44, 1.08, 1.71 (**1.44**) | 100, 100, 100 | 0, 0, 0 | 5, 5, 5 | 3, 5, 0 |
| backlog, land by intent, ON | 619, 435, 403 (**435**) | 1.55, 1.32, 1.34 (**1.34**) | 100, 100, 100 | 0, 0, 0 | 5, 5, 5 | 0, 0, 0 |
| two-teams, OFF | 775, 852, 648 (**775**) | 1.79, 1.80, 1.95 (**1.80**) | 100, 100, 100 | 4, 4, 3 | 1, 1, 2 | 3, 5, 0 |
| two-teams, ON + crossDedupe | 465, 472, 440 (**465**) | 1.22, 1.60, 1.41 (**1.41**) | 97.5, 100, 100 | 0, 0, 1 | 5, 5, 4 | 1, 0, 0 |
| backlog, GitHub-style, OFF | 948, 1256, 848 (**948**) | 1.46, 5.11, 3.06 (**3.06**) | 87.5, 100, 97.5 | 0, 1, 1 | 1, 4, 4 | 17, 29, 23 |
| backlog, GitHub-style, ON | 1012, 1141, 777 (**1012**) | 2.94, 4.74, 2.12 (**2.94**) | 100, 97.5, 92.5 | 1, 0, 1 | 4, 5, 4 | 30, 27, 22 |

Mann-Whitney, on vs off, exact two-sided. With 3 vs 3 runs the smallest p possible is 0.10.
- **two-teams:** wall, cost and pairs built twice are all completely separated (U=0, p=0.10 each). Median
  wall -40%, cost -22%, pairs built twice 4 -> 0.
- **backlog, land by intent:** wall -46% median (U=1, p=0.20). Cost is even (p=1.0). No duplicate effect can
  show, because board-off agents aliased all 5 pairs on their own in every run. Bounces were 0 in all
  board-on runs vs 0-5 off.
- **GitHub-style:** no difference in wall, cost, duplicates or bounces (p 0.7-1.0). Here bounces come from
  rebase conflicts that the board does not touch.

vs qb4's prediction:
- **Duplicates:** right, in both two-teams (4 -> 0) and GitHub-style.
- **Backlog board-off duplicates:** wrong. The prediction was ~4 built twice; the real number was 0.
- **Time on land by intent:** wrong. The prediction was no gain (+-3%); the real result was -40% to -46%.
- **GitHub-style wall:** about 3x faster than predicted in both conditions.

The one pair built twice with the board on (order 16, T4/T20 priority/urgency) was the one the dedupe pass
missed that run: it found 4 of 5 pairs, against 5 of 5 in orders 4 and 10. When the pass misses a pair, the
board alone does not catch it.

## Caveats

- **"timeout" runs (1, 9, 10, 13, 15):** every task had landed. The status comes from tail cleanup:
  an agent asked to redo a duplicate stopped at `git rebase --skip`, or an agent that never pushed kept
  the run from settling. Wall = time of the last landing, so it is not affected.
  - Fixed during the runs, in this order: "nothing new" closes a change as already on main (2255731); the
    runner settles on the boxes' busy state (9a04b0e). After the runs: `forq skip` (db6be78).
- **Excluded:** five tries, by bugs found while running (plan file `excludedProjects`).
  - The $2 per-run budget halted the first try of order 1, and a 6x budget halted the third (r1c);
  - the runner settled early (r1b);
  - the earliest-claim and finished = landed fixes were not deployed yet (the first lab-backlog-44862-r1);
  - an agent stalled on a refused plain push (r1d), which led to `forq push`.
- **Orders 5 and 6:** a laptop network outage cut their runners off. Order 5 had already settled and was
  collected with `--collect`. Order 6 was watched over curl with the same settle rule and then collected.
- **Two fixes landed between round 1 and rounds 2-3:**
  - the merge job's "nothing new" report (from order 10);
  - "gave-up" for a refused claim (from round 3).

  Neither changes what the board shows an agent before it picks.
- **Cost:** stage 4, all lines together: $1.78 real (box time) and $42.6 API-equivalent (subscription).
