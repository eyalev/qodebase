# E6: bigger real-agent tests of the agent board (W3, W7)

Owner qb9. Plan: docs/board/PLAN2.md (W3, W7). Harness: `sim/board-ab/run.mjs` (real `claude -p` agents, one shared
bare repo, hidden tests in the private lab-hidden repo). Data: `sim/board-ab/runs.jsonl`; tables from
`node sim/board-ab/summary.mjs --scenario s3|s4 --md`. Medians [min–max], exact two-sided Mann-Whitney p (3 vs 3:
the smallest possible p is 0.1).

**Prices.** Every API-equivalent $ here and in runs.jsonl is at 1-hour cache-write rates (2× input). Claude Code
writes 1-hour cache, and its own `total_cost_usd` matches these rates exactly (checked on one Haiku and one Sonnet
call, 2026-10-10). E4 had used 1.25×, about 15% low in every condition. `recost.mjs` re-priced all runs from their
stored tokens and kept the old figure as `usd_api_equiv_v1`. The E4 scale-test saving moves from −29.1% to
−28.4%. E4's total spend becomes $14.96 (it was $13.04).

## Scenario s3 (W3a): 20 Haiku agents, 60 tasks

`sim/board-ab/starter3`: todokit, scenario 2's 30 tasks plus 30 new ones.
- **Dependency chains:** T34→T53, T36→T37, T38→T39, T33+T47→T48, T45→T46, and T18→T50 in the same `undo.js`.
- **Hot files:** `commands.js`, `index.js`, `CHANGELOG.md`, `docs/COMMANDS.md`.
- **10 duplicate pairs:** s2's five, plus five new far-worded twins (T51–T55 vs T56–T60). The far wording is like
  "People want to jot down how long a to-do will take…" for `parseDuration`.

Hidden tests: 60, reference 60/60. Wall cap 40 min, 40 turns per call. E = board + one dedupe call + staggered
starts 1 s apart (19 s in all).

### E v1 (board as of f3d36d3): fewer duplicates and less git thrash, but 4 tasks lost per run and a long tail

| measure | A v1 (n=3) | E v1 (n=3) | p E v1 vs A | p AIMD vs E20 / n8 vs E20 |
|---|---|---|---|---|
| wall time (s) | 579 [560–650] | 976 [731–1019] | 0.1 | - / - |
| hidden tests (of 60) | 60 [60–60] | 56 [56–57] | 0.1 | - / - |
| agent-minutes (all calls) | 168.1 [156.2–171.2] | 141.7 [141.3–147.7] | 0.1 | - / - |
| agent-minutes wasted (built then dropped) | 36.5 [31.4–38.9] | 23.4 [22.9–34.3] | 0.2 | - / - |
| red commits on main | 3 [0–3] | 0 [0–5] | 1 | - / - |
| wasted work (calls that built a task then dropped it) | 37 [33–38] | 28 [26–41] | 0.7 | - / - |
| deferrals (skipped before any work) | 0 [0–0] | 26 [11–28] | 0.1 | - / - |
| calls cut at the turn cap | 21 [17–26] | 19 [18–19] | 0.6 | - / - |
| duplicate pairs built twice (of 10) | 7 [4–9] | 0 [0–1] | 0.1 | - / - |
| same task landed twice | 0 [0–0] | 1 [0–2] | 0.4 | - / - |
| merge conflicts resolved | 239 [192–259] | 275 [260–289] | 0.1 | - / - |
| rebases aborted | 203 [161–213] | 9 [7–10] | 0.1 | - / - |
| resets to origin/main | 225 [172–236] | 8 [8–8] | 0.1 | - / - |
| rejected pushes recovered | 264 [245–270] | 52 [51–67] | 0.1 | - / - |
| agent calls | 128 [127–131] | 131 [126–131] | 1 | - / - |
| API-equiv $ (Haiku 5.5) | 3.27 [3.1–3.29] | 2.78 [2.67–2.87] | 0.1 | - / - |

What held up from round 1:
- **Duplicates:** the dedupe call found 10/10 pairs with no false pairs in every run. Pairs built twice fell from
  7 [4–9] to 0 [0–1].
- **Git thrash collapsed:**

  | | A | E |
  |---|---|---|
  | rejected pushes | 264 | 52 |
  | aborted rebases | 203 | 9 |
  | resets to origin/main | 225 | 8 |

- **Cost:** agent-minutes −16%, cost −15%.

What broke at 20 agents:
- **Each E run lost 3–4 tasks; A lost none.** The losses:
  - r1: T19, T33, T46, T55.
  - r2: T3, T11, T30, T37.
  - r3 (57/60):
    - T29: the same pattern, with a live "in progress" claim by agent12, who never pushed; 4 other agents deferred
      to it 6 times.
    - T18 and T50: T18 landed without the add/done undo wiring, because `add` was not on main yet, and T50 builds
      on it. A dependency-order slip, not the board.
- **E's wall time was 1.7× A's** (976 s vs 579 s).

Diagnosis (logs and transcripts of every agent, run directories under `~/.local/share/qb9-board-ab/`):

1. **Lost tasks: the board trusted "done" that never reached main.** None of the 8 lost tasks in r1–r2 was ever
   committed to main. Each had been announced finished by an agent whose push never landed. Two ways this happened:
   - The hook's `committed` post for a local commit.
   - The `done` post the Stop hook makes after every call.

   Example: in r1, agent13 (T2) and agent4 (T33) had every call cut at the 40-turn cap in the middle of a
   `CHANGELOG.md` rebase conflict. They ended on a detached HEAD with `UU CHANGELOG.md`, then left after three calls
   without a push.

   `who --recent` listed those claims as FINISHED. So 3–5 other agents per task read "finished, not on main yet" and
   deferred, as their notes say. Twins of a stranded task waited for it ("T19 will be an alias once T2 lands").
   Deferrals went from 0 to 26 per run. In A nobody knows about anyone else, so someone simply redoes the task:
   60/60.
2. **Long wall: one hung call per run, from an agent that waited for a dependency.**
   - Everyone else had stopped by 460–525 s.
   - r2: agent3 posted that T30 waits for T7, then ran `sleep 600` and `sleep 900` as background commands.
     `claude -p` waits for its background tasks, so the call sat idle for 587 s until the harness killed it at 12
     minutes.
   - r1: the same pattern with two foreground sleeps, a 497 s call.
   - No A run has a single `sleep`.

   The board's "blocked / waits for" vocabulary invites waiting. `sleep` was not in the allowed tools but ran anyway:
   Claude Code treats it as safe.
3. **Turn cap at 20 agents:** 17–26 calls per run hit the 40-turn cap in both conditions. That is what strands
   commits mid-rebase.

**The finding as it stands (manager, 2026-10-10):** a board that trusts unlanded "done" makes agents skip work.
"Finished" has to mean "on main".

### Fixes for v2 (2cdf4e6), approved by the manager

- **Board:** FINISHED only for work on origin/main.
  - The hook posts `landed` when its commit shows up on origin/main, matched by subject and author, so a reset that
    drops the commit does not count.
  - A `done` or `committed` without a landing shows as "SAYS DONE, NOT ON MAIN <age>". After 5 minutes it counts as
    abandoned and drops out, also from the live view.
  - Tested in a scratch repo: commit, push, stale claim, reset.
- **Harness `--no-wait`:** one prompt line ("Never wait for another agent…"), and `Bash(sleep:*)` disallowed
  (verified: a sleep is denied). `prompt_version` is `board-ab-v2-nowait`.
- **`--max-turns 60`** for both A and E.
- E v1 runs used a frozen copy of the board at f3d36d3 (`--board e1`), so the fix could not leak into them.

### v2: A vs E x3, fixed board + no-wait + 60 turns: E wins on time, cost and duplicates at equal quality

| measure | A v1 (n=3) | A v2 (n=3) | E v1 (n=3) | E v2 (n=3) | p E v1 vs A | p E v2 vs A | p AIMD vs E20 / n8 vs E20 |
|---|---|---|---|---|---|---|---|
| wall time (s) | 579 [560–650] | 594 [545–660] | 976 [731–1019] | 451 [400–472] | 0.1 | 0.1 | - / - |
| hidden tests (of 60) | 60 [60–60] | 60 [60–60] | 56 [56–57] | 60 [59–60] | 0.1 | 1 | - / - |
| agent-minutes (all calls) | 168.1 [156.2–171.2] | 169.5 [155.6–172.5] | 141.7 [141.3–147.7] | 130.6 [121.7–137] | 0.1 | 0.1 | - / - |
| agent-minutes wasted (built then dropped) | 36.5 [31.4–38.9] | 53.7 [43.1–57.7] | 23.4 [22.9–34.3] | 20.9 [19.2–22] | 0.2 | 0.1 | - / - |
| red commits on main | 3 [0–3] | 0 [0–1] | 0 [0–5] | 3 [2–7] | 1 | 0.1 | - / - |
| wasted work (calls that built a task then dropped it) | 37 [33–38] | 42 [34–46] | 28 [26–41] | 22 [20–24] | 0.7 | 0.1 | - / - |
| deferrals (skipped before any work) | 0 [0–0] | 0 [0–0] | 26 [11–28] | 34 [18–37] | 0.1 | 0.1 | - / - |
| calls cut at the turn cap | 21 [17–26] | 3 [1–6] | 19 [18–19] | 5 [5–6] | 0.6 | 0.5 | - / - |
| duplicate pairs built twice (of 10) | 7 [4–9] | 9 [8–9] | 0 [0–1] | 0 [0–1] | 0.1 | 0.1 | - / - |
| same task landed twice | 0 [0–0] | 1 [0–1] | 1 [0–2] | 0 [0–1] | 0.4 | 1 | - / - |
| merge conflicts resolved | 239 [192–259] | 260 [245–284] | 275 [260–289] | 279 [258–318] | 0.1 | 0.7 | - / - |
| rebases aborted | 203 [161–213] | 222 [201–236] | 9 [7–10] | 15 [8–15] | 0.1 | 0.1 | - / - |
| resets to origin/main | 225 [172–236] | 236 [215–254] | 8 [8–8] | 14 [10–17] | 0.1 | 0.1 | - / - |
| rejected pushes recovered | 264 [245–270] | 278 [262–280] | 52 [51–67] | 67 [66–72] | 0.1 | 0.1 | - / - |
| agent calls | 128 [127–131] | 123 [112–124] | 131 [126–131] | 122 [116–126] | 1 | 1 | - / - |
| API-equiv $ (Haiku 5.5) | 3.27 [3.1–3.29] | 3.26 [3.17–3.33] | 2.78 [2.67–2.87] | 2.73 [2.59–2.85] | 0.1 | 0.1 | - / - |

E v2 against A v2 (same settings, alternating runs):

| measure | A v2 | E v2 | change | p |
|---|---|---|---|---|
| wall time | 594 s | 451 s | −24% | 0.1 |
| agent-minutes | 169.5 | 130.6 | −23% | |
| API-equiv cost | $3.26 | $2.73 | −16% | |
| hidden tests (of 60) | 60/60 | 60/60 (one run 59) | | 1 |
| duplicate pairs built twice (of 10) | 9 | 0 | | |
| wasted work calls | 42 | 22 | | |
| wasted agent-minutes | 53.7 | 20.9 | −61% | |
| rejected pushes | 278 | 67 | | |
| aborted rebases | 222 | 15 | | |
| resets to origin/main | 236 | 14 | | |

Every p is 0.1, the smallest possible with 3 vs 3, except hidden tests (p = 1).

The turn-cap cuts fell from about 20 to 3–5 per run. Against E v1 the wall time halved (976 → 451 s), and the lost tasks
went from 3–4 per run to 0–1.

Two watch items, both visible in the data:
- **Red commits on main:** E v2 3 [2–7] vs A v2 0 [0–1], p 0.1. Every final main was green.
  - The red commits are bad merges pushed without a test run: a re-export line duplicated by a rebase
    (`Duplicate export of 'tagCompletion'`, `'normalizeTag' has already been declared`), and in r3 conflict markers in
    `src/index.js`. A later commit repaired each.
  - The likely mechanism: A agents give up on a conflict (222 aborts and 236 resets per run: they throw the merge away
    and redo it on fresh main), while E agents resolve conflicts by hand (279 resolved, 15 aborts), and a hand merge
    is sometimes pushed broken.
  - In qodebase the landing queue's checks stop exactly this; the harness has no merge gate.
- **The last task, by polite livelock:** in r3 T20 was the last open task. Agents 1, 3, 6, 13 and 19 all picked it at
  once. Each saw the others' fresh claims and dropped it, and the other agents deferred to those claims (19 skips in
  all). Nobody finished it.
  - The board needs a tie-break: the earliest claim keeps the task, later ones yield.
  - The 5-minute claim expiry did not help here, because the claimants kept posting edits.

## W7: congestion control for agents (AIMD on the board's thrash), s3, E v2 code

qb4's design and prediction: docs/board/sim.md (f).
- **Thrash** = rejected pushes + 3 × dropped work, per minute.
- **AIMD:** starts at 4. A minute with thrash ≤ 0.5 × cap adds 1. A minute with thrash > 1.5 × cap halves the cap
  (never below 2).
- **Who works:** only the `cap` lowest-numbered active agents start calls; the others wait at a call boundary.
  Nobody is killed.

"E fixed 20" is the E v2 runs above: identical code and flags. Board v3's tie-break, committed during W7, is off
unless `BOARD_TIEBREAK=1` and was off here. 3 runs each.

| measure | E fixed 20 | E AIMD (from 20) | E fixed 8 |
|---|---|---|---|
| wall time (s) | 451 [400–472] | 962 [799–1050] | 544 [525–610] |
| agent-minutes | 130.6 [121.7–137] | 56.6 [48.9–64.3] | 69.9 [67.4–79.6] |
| API-equiv $ | 2.73 [2.59–2.85] | 1.26 [1.05–1.42] | 1.53 [1.52–1.76] |
| hidden tests (of 60) | 60 [59–60] | 60 [60–60] | 60 [60–60] |
| wasted agent-minutes | 20.9 | 0.5 | 4.8 |
| red commits on main | 3 [2–7] | 0 [0–1] | 0 [0–0] |
| duplicate pairs built twice | 0 | 0 | 0 |
| rejected pushes | 67 | 49 | 54 |
| AIMD cap, per-run median | – | 3, 4, 4 | – |

p against E fixed 20: wall, agent-minutes, $, wasted minutes and red commits all p = 0.1 (the floor for 3 vs 3) for
both AIMD and fixed 8; hidden tests p = 1.

Cap per minute:
- r1: 4,2,2,3,3,3,3,2,2,2,2,2,2,3,4,4,5
- r2: 4×8, 5×4, 2,3,4,5
- r3: 4×7, 5×5, 6

Against qb4's prediction:
1. **"AIMD trades time for cost, it does not win both": confirmed.** Against fixed 20, wall ×2.1 (the sim said
   ×2.1) and agent-minutes −57% (the sim said −30%). The real controller cut harder because it settled lower: cap
   3–4, against the sim's 7. At these thresholds real thrash per agent runs higher than the sim's.
2. **"No collapse at 20": confirmed.** Fixed 20 is faster than fixed 8 (451 vs 544 s), so more agents still buy
   time. They just pay for it in thrash and waste.
3. **"No better than a fixed team of the size it settles at": not tested directly.** It settled at 3–4 and there was
   no fixed-4 run. Against fixed 8, AIMD is 18% cheaper ($1.26 vs $1.53) and 77% slower (962 vs 544 s).

Quality was the same everywhere (60/60). The red commits that E fixed 20 pushed from hand merges vanished at 8
agents and under AIMD: less contention, fewer hand merges.

**Reading:** with the board, team size is a cost-versus-time dial, not a fix for a collapse. If wall time matters,
use 20. If cost matters, AIMD or a small fixed team cuts cost by more than half. AIMD's extra value over a fixed
small team is that nobody has to pick the size, at the price of a slow ramp.

W7 spend: $9.54 API-equiv (6 runs + the smoke). The weekly meter went 78% → 79%.
