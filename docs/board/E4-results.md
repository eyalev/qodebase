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

**Results, scenario 1** (textkit, 16 small tasks, 5 agents; median [min–max], exact two-sided Mann–Whitney, 5 vs 5):

| measure | A (n=5) | B (n=5) | C (n=5) | D (n=5) | p B vs A | p C vs A | p D vs A | p D vs C |
|---|---|---|---|---|---|---|---|---|
| wall time (s) | 227 [224–263] | 219 [208–249] | 202 [183–305] | 200 [191–238] | 0.31 | 0.151 | 0.056 | 1 |
| hidden tests (of 16) | 16 [16–16] | 16 [16–16] | 16 [16–16] | 16 [16–16] | 1 | 1 | 1 | 1 |
| agent-minutes (all calls) | 18.2 [18.1–19.9] | 17.8 [17–19.4] | 16 [14.5–18.8] | 16.2 [15.1–17.9] | 0.087 | 0.048 | 0.008 | 0.881 |
| agent-minutes wasted (built then dropped) | 4.1 [3–5.9] | 3.5 [2.3–4.2] | 1.2 [0.7–2.1] | 0.9 [0–2.4] | 0.135 | 0.008 | 0.008 | 0.444 |
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

## Scale test: scenario 2, 30 bigger tasks, 10 agents (A vs D, 3 runs each, 2026-10-10)

`sim/board-ab/starter2` (todokit: store + command registry, 30 multi-file tasks: a module + re-exports +
tests + CHANGELOG, commands also in the registry and `docs/COMMANDS.md`); 5 duplicate pairs under other
names and modules (T1/T23 dates/calendar, T2/T19 text/strings, T3/T21 tags/hashtags, T4/T20
priority/urgency, T6/T22 stats/progress; T19 and T22 worded very differently), chains T1->T5->T13,
T3->T8->T11, T7->T9, T6->T12, T1->T16, hot files as before. Hidden tests: lab-hidden/board-ab/tasks2.test.mjs
(reference 30/30, starter 0/30). A pair counts as built twice when both tasks pass and neither module
imports the other. `node sim/board-ab/summary.mjs --scenario s2 --md`:

| measure | A (n=3) | D (n=3) | E (n=3) | p D vs A | p E vs A | p E vs D |
|---|---|---|---|---|---|---|
| wall time (s) | 354 [350–355] | 254 [231–257] | 268 [253–321] | 0.1 | 0.1 | 0.4 |
| hidden tests (of 30) | 30 [30–30] | 30 [30–30] | 30 [30–30] | 1 | 1 | 1 |
| agent-minutes (all calls) | 55.2 [54.4–56.6] | 38.4 [36.5–40.1] | 38.5 [36–44] | 0.1 | 0.1 | 1 |
| agent-minutes wasted (built then dropped) | 8.7 [8.2–10.6] | 5.2 [2.4–5.2] | 4.1 [2.4–7.1] | 0.1 | 0.1 | 1 |
| red commits on main | 0 [0–1] | 0 [0–0] | 3 [0–4] | 1 | 0.4 | 0.4 |
| wasted work (calls that built a task then dropped it) | 11 [10–14] | 5 [3–5] | 6 [4–9] | 0.1 | 0.1 | 0.4 |
| deferrals (skipped before any work) | 0 [0–0] | 7 [4–13] | 5 [3–18] | 0.1 | 0.1 | 1 |
| duplicate pairs built twice (of 5) | 4 [3–4] | 4 [3–4] | 0 [0–0] | 1 | 0.1 | 0.1 |
| same task landed twice | 0 [0–1] | 0 [0–1] | 0 [0–1] | 1 | 1 | 1 |
| merge conflicts resolved | 76 [73–82] | 94 [81–95] | 93 [91–97] | 0.2 | 0.1 | 1 |
| rebases aborted | 73 [71–81] | 2 [1–6] | 5 [3–7] | 0.1 | 0.1 | 0.4 |
| resets to origin/main | 84 [75–91] | 4 [1–6] | 5 [4–5] | 0.1 | 0.1 | 0.9 |
| rejected pushes recovered | 103 [98–105] | 28 [26–29] | 33 [32–37] | 0.1 | 0.1 | 0.1 |
| agent calls | 54 [53–59] | 51 [49–57] | 53 [50–58] | 0.4 | 0.5 | 0.7 |
| API-equiv $ (Haiku 5.5) | 0.95 [0.93–0.99] | 0.67 [0.65–0.73] | 0.71 [0.65–0.78] | 0.1 | 0.1 | 0.7 |

With 3 vs 3, p = 0.1 is the smallest an exact two-sided Mann–Whitney can give: every measure below with
p = 0.1 separated completely (all 3 D runs better than all 3 A runs).

**The value grows with scale.** From 5 agents / 16 tasks to 10 agents / 30 tasks (A -> D):
| | scenario 1 (5 agents) | scenario 2 (10 agents) |
|---|---|---|
| wall time | 227 -> 200 s (-12%) | 354 -> 254 s (**-28%**) |
| agent-minutes | 18.2 -> 16.2 (-11%) | 55.2 -> 38.4 (**-30%**) |
| agent-minutes wasted (built then dropped) | 4.1 -> 0.9 | 8.7 -> 5.2 |
| API-equiv $ per run | 0.32 -> 0.28 (-12%) | 0.95 -> 0.67 (**-29%**) |
| rebases aborted / resets / rejected pushes | 22/24/34 -> 3/3/17 | 73/84/103 -> 2/4/28 |
Without a board, git thrash grows faster than the team (aborts x3.3, rejected pushes x3 for 2x agents and
~2x tasks); with it, it stays flat.

**Duplicates under very different names are not solved by the board + rule.** In scenario 2 both A and D
built 4 of 5 pairs twice (median). From the board log and commit times of the 3 D runs (15 pair cases):
some pairs started within ~10 s of each other (10 agents choose at once at t = 0, before any claim is
visible: T2/T19 started in the same second twice), but more were *seen and not recognised*: the second
agent started 30–160 s after the first had claimed or even landed its twin (e.g. T21 50 s after T3 landed,
T22 160 s after T6 landed) and still wrote its own copy. Only the dates/calendar pair (T23) was aliased
reliably. Haiku agents applying a one-line "same meaning" rule catch close wording, not "hashtags" vs
"tags" or "progress" vs "completion rate". In scenario 1 (closer wording) D did stop them (0/5).
That points to dedupe *before* work: cluster the backlog into work units once (ClawSweeper's "cluster as
work unit", docs/openclaw/FINDINGS.md) instead of asking each agent to judge, and staggered starts so the
first claims are visible.

## E: dedupe pass before work + staggered starts (scenario 2, 3 runs, 2026-10-10)

**E = D + (1)** one Haiku call (lean harness, no tools) reads `BACKLOG.md` once per run and returns the
"same work" pairs; the harness marks each paired task in the backlog the agents get:
`**T21** _(likely the same as T3: make one a thin alias of the other)_`; **(2)** staggered starts, agent k at
(k−1)×5 s. Everything else as D (hooks, `who --recent 30m`, the same-meaning rule).

- **The dedupe call got the 5 pairs right in all 3 runs (5/5 correct, 0 wrong, 0 missed)**, plus the smoke
  run: ~$0.002 and a few seconds per run.
- **Duplicate pairs built twice: 0 of 5 in all 3 E runs vs 4 [3–4] in D** (p = 0.1, complete separation).
  The twins land as thin aliases ("T21: add hashtag helpers as aliases of the T3 tag helpers").
- Wall time 268 s [253–321], agent-minutes 38.5, API-equiv $0.71: same as D (p 0.4–1). The dedupe saves
  duplicated code, not much time, because a duplicate here costs ~30 s of a Haiku call.
- **Watch: red commits 3 [0–4] in E vs 0 in D** (p = 0.4, not significant): all 7 are pushes with
  unresolved conflict markers in `src/index.js` (E r1: 4, r2: 3, r3: 0; A: 1 in its 3 runs, D: 0), fixed by
  a later commit. A plausible cause, not verified: an alias task now lands right after its twin and edits the
  next export line in the same hot file. A merge gate that runs the tests (qodebase's landing queue) would
  stop these; plain `git push` does not.
- Metric fix during E: "same task landed twice" counted every T-id in a commit subject, so an alias
  commit ("T19 … aliases of T2") counted as a second T2. It now counts only the id the subject starts with;
  all scenario-2 runs were rescored (A, D, E are all 0 [0–1]).

**So the full recipe at scale is:** intent on the board + finished work in the query (D) for thrash, and a
backlog dedupe pass before work (E) for duplicates under different names. Neither changes quality here;
both pay off as the team grows.

**Spend (all of E4):** 32 runs incl. 3 smoke runs, $13.04 API-equivalent on the subscription (cap $15);
weekly meter 71% -> 73%.
