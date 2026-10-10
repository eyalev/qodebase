# E4: real agents with and without the agent board (qb9, 2026-10-10)

**Setup.** 5 Haiku 5.5 agents (`claude -p` on the subscription, one call per task pick, fresh context
each time) work at once on a small JS repo (`sim/board-ab/starter`, textkit: helpers + a command
registry, node:test). Each has its own clone and pushes to one shared bare repo (`git pull --rebase`
on rejection). They pick their own tasks from a 16-task `BACKLOG.md`: 4 duplicate pairs under
different names (T1/T9 slugify/toSlug, T3/T11 titleCase/capitalizeWords, T5/T13, T6/T14), dependency
chains (T2->T4, T2+T7->T10, T1->T8, T5->T12) and hot shared files (`src/commands.js`, `src/index.js`,
`CHANGELOG.md`). Hidden tests per task are private (lab-hidden/board-ab; a reference scores 16/16).
Harness and measures: `sim/board-ab/run.mjs`; every run in `sim/board-ab/runs.jsonl`; this table:
`node sim/board-ab/summary.mjs --md`.

**Conditions** (5 runs each; A/C/B interleaved per round, then D):
- **A** no board.
- **B** board by Claude Code hooks only (qb6's board, local JSONL): automatic posts of edited files and
  commits; the "now" view fed back at each prompt. With `claude -p` the hook's "started" text is the
  harness prompt, so B shares files, not intents.
- **C** B + one instruction: run `board who` before choosing; after choosing, `board post started
  --intent "<task id + title>" --files ...`.
- **D** C, but the query is `board who --recent 30m` (also lists what others FINISHED in the last 30 min)
  + "if a claimed or finished task means the same as yours, make yours a one-line alias of theirs, or pick
  another" (added after the T3/T11 diagnosis below).
B and C ran on a frozen copy of board@2ff8b07 so later board changes could not move them mid-series;
D on board@f3d36d3 (`who --recent`). Each run's row carries `board_version`.

**Results** (median [min–max], exact two-sided Mann–Whitney, 5 vs 5):

| measure | A (n=5) | B (n=5) | C (n=5) | D (n=5) | p B vs A | p C vs A | p D vs A | p D vs C |
|---|---|---|---|---|---|---|---|---|
| wall time (s) | 227 [224–263] | 219 [208–249] | 202 [183–305] | 200 [191–238] | 0.31 | 0.151 | 0.056 | 1 |
| hidden tests (of 16) | 16 [16–16] | 16 [16–16] | 16 [16–16] | 16 [16–16] | 1 | 1 | 1 | 1 |
| red commits on main | 0 [0–1] | 0 [0–2] | 1 [0–2] | 0 [0–1] | 1 | 0.405 | 1 | 0.683 |
| wasted work (calls that built a task then dropped it) | 7 [5–8] | 3 [3–7] | 2 [1–3] | 1 [0–4] | 0.119 | 0.008 | 0.008 | 0.397 |
| deferrals (skipped before any work) | 0 [0–0] | 0 [0–1] | 6 [3–11] | 7 [3–11] | 0.444 | 0.008 | 0.008 | 1 |
| duplicate pairs built twice (of 4) | 1 [0–1] | 1 [0–1] | 1 [0–1] | 0 [0–0] | 1 | 1 | 0.048 | 0.167 |
| same task landed twice | 0 [0–0] | 0 [0–1] | 0 [0–0] | 0 [0–1] | 1 | 1 | 1 | 1 |
| merge conflicts resolved | 26 [24–31] | 37 [34–48] | 36 [29–43] | 34 [28–37] | 0.008 | 0.032 | 0.032 | 0.595 |
| rebases aborted | 22 [21–25] | 6 [4–11] | 3 [2–4] | 3 [2–6] | 0.008 | 0.008 | 0.008 | 0.794 |
| resets to origin/main | 24 [21–28] | 8 [4–12] | 3 [1–4] | 3 [1–6] | 0.008 | 0.008 | 0.008 | 0.802 |
| rejected pushes recovered | 34 [30–36] | 24 [19–27] | 16 [16–17] | 17 [15–22] | 0.008 | 0.008 | 0.008 | 0.444 |
| agent calls | 28 [27–28] | 26 [25–30] | 29 [26–30] | 29 [26–29] | 0.143 | 0.238 | 0.238 | 0.651 |
| API-equiv $ (Haiku 5.5) | 0.32 [0.31–0.34] | 0.3 [0.29–0.31] | 0.28 [0.25–0.29] | 0.28 [0.25–0.29] | 0.008 | 0.008 | 0.008 | 1 |

Measures: *wasted work* = a call that built a task and then dropped it because another agent had
landed it (>= 10 turns; deferrals took 3–5 turns, dropped duplicates 14–58: a clean split);
*deferral* = a call that skipped before any work because the task was taken; git friction from each
clone's reflog (a plain `pull --rebase` with nothing local does not count).

## What it says
1. **Quality is the same.** 16/16 hidden tests in all 20 runs; red commits on main 0–2 with no
   difference. At this size the board is about waste, not correctness.
2. **Any board cuts the git thrash a lot; stating the intent cuts it most.** Rebases aborted 22 -> 6 (B)
   -> 3 (C, D); resets to origin/main 24 -> 8 -> 3; rejected pushes 34 -> 24 -> 16 (all p = 0.008 vs A).
   Without a board an agent that loses a push race throws its work away and redoes it; with one it sees
   who touches what and either defers early or merges in place (conflicts *resolved* go up, 26 -> ~35).
3. **Wasted work drops from 7 calls a run to 2 (C) and 1 (D)** (p = 0.008); hooks alone (B, 3) is not
   significant (p = 0.12). The stated intent is what turns a collision into an early deferral (C/D: 6–7
   "claimed by agentN, left it" per run).
4. **Duplicates under different names need the finished-work query and a same-meaning rule.** A, B and C
   each built T3/T11 twice in 3–4 of 5 runs; D in 0 of 5 (D vs A p = 0.048; D vs C p = 0.17, n too small).
   Diagnosis (C, run 1): agent5 claimed T11 at 5 s and landed it at 15 s; agent2 picked T3 at 30 s, but
   the now-view by then showed agent5's *next* task, so T11 was invisible on the board, and reading main
   did not make it see T3 = T11. Not timing: the board forgot finished intents, and nothing asked for
   semantic matching.
5. **Cost and time:** API-equivalent $0.32 (A) vs $0.28 (C, D) per run (p = 0.008), about 12% less;
   wall time 227 s vs ~200 s (C p = 0.15, D p = 0.056): not significant.

**Recommendation for the board:** post the intent (task id + title + files), not just files; make the
query return finished work too (`who --recent`); give agents a one-line same-meaning rule. Hooks for
files and commits are a useful floor but not enough on their own.

**Caveats.** One small scenario (16 tasks, ~4-minute runs), 5 agents, Haiku only, one model call per
task; duplicates matter more with longer tasks, where a dropped duplicate costs minutes, not seconds.
Scored on the laptop; the 25-minute cap was never reached. Spend: 21 runs (incl. 1 smoke), $5.89
API-equivalent on the subscription (cap $15); weekly meter 71% -> 72%.
