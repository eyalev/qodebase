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

### v2: A vs E x3 (pending)
