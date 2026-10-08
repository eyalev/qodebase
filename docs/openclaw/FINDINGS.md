# OpenClaw, phase 1: their real flow, and our landing policies replayed on it (qb9, 2026-10-08)

Data only: read-only `gh` (2,165 requests: 1,291 GraphQL points + 1,332 REST, over ~1.5 h,
never above 30% of an hourly limit) and a blobless clone of main. No model calls. Window:
**2026-09-08 .. 10-08** (CI: the last 7 days). Scripts: `sim/openclaw/{fetch,analyze,replay}.mjs`;
outputs `docs/openclaw/data/flow.json`, `replay*.json` (mirror: `~/projects/github/openclaw/data/`).

## Numbers first

| | 30 days | per day |
|---|---|---|
| commits on main (first parent) | 16,273 (92% via PR, 1,225 direct pushes) | 535; per hour p50 22, max 60 |
| PRs created | 18,977 | ~630 |
| PRs merged / closed unmerged / open | 14,976 / 1,792 / 2,209 | 89% of decided PRs merge |
| issues created / closed | 6,408 / 3,380 | 210 |
| ci.yml runs (7 days) | 13,970 | 2,000 (83/h) |

**Who lands the work.** 35 people (and bots) merge PRs; PRs authored by them are **94% of merges**, merged
at a median **1.4 h** (p90 15 h). Everyone else: **55%** of their decided PRs merge, median **20.1 h** (p90 8.5 days).
The 20-open-PR cap is for outsiders: two maintainers peaked at **252 and 224 open PRs at once**, a bot at 146
(`r: too-many-prs` hit 34 PRs in the window). steipete alone authored 45% of PRs and merged 53%.

**Triage is already automated (by them, not GitHub).** First label on a new issue: median **6.9 min**
(p90 14.5) — ClawSweeper/Barnacle. First human touch (where visible): median 4.8 h. Bots closed **36%** of
closed issues; NOT_PLANNED closes take a median **9 minutes**. Of closed issues, **53%** were fixed (closed by a
PR/commit or a merged PR referenced them). 1,381 of the window's open issues wait on a maintainer/product
decision. 20% of new issues are labelled P0 (1,314), so priority labels carry little signal.
GitHub's own duplicate signals are near zero (0.1%): their dedupe lives in ClawSweeper's clusters and comments,
which the metadata does not show. **Duplicate rate is therefore not measured here** (phase 2 needs comment text).

**CI is where the cost is.** Estimated runner time (job durations x run counts, 7 days):

| run kind | runs/day | runner-min per run | runner-hours/day |
|---|---|---|---|
| pull_request (64 jobs p50) | 1,498 | 123 mean (p50 101) | **~3,080** |
| hourly full suite on main (162 jobs, `schedule`) | 22 | ~910 | ~330 |
| push to main (38 jobs, almost all skipped) | 439 | ~1 | ~10 |
| workflow_dispatch (release gates) | 36 | only 2 sampled | ~1,250, unreliable |

≈ **3,400 runner-hours/day without dispatch** (~640 runner-min per landed commit). PR runs fail **40%**; only
**2.8%** of PR runs belong to PRs that ended closed unmerged, so CI spent on abandoned work is *not* the lever.

**Main is not tested on push, and the full suite is almost never green.** The push run costs ~1 runner-min
and passes 98%. The hourly full suite on main passed **1 of 153** runs; a failing run fails 6 shards (p50)
of 162. 29% of failing shards fail again the next hour; **111 of 152 hours (73%) have a failure that persists
into the next run**; 84 of 151 hours saw a *new* persistent break (13.4 such hours/day ≈ **2.5% of landed changes**, an upper bound if
one change causes each; counted in shards: 202, 32.1/day, since one break can fail several shards; flow.json
`ci.full_suite_on_main`). 9% of merged PRs merged with a red last check (1,368) — "readiness is not merge
authority" in practice.

**Collisions.** 22.5% of main commits touch a file another commit touched in the hour before (6% within 10 min,
51% within 6 h). 35% of merged PRs had another PR merge into one of their files while they were open (p90: 10
such merges). 19% of PRs landed after one of their files changed on main since their own last CI. Where the
same-hour collisions land (flow.json `main.same_hour_collisions_by_kind`, classed by path, rules listed there): **i18n catalogs 30%, list/baseline files 11%** (`config/assertion-safety-baseline.txt`
alone: 929 commits, 674 same-hour collisions), docs 12%, tests/scripts 22%, code 22%. Only 12% of PRs were
force-pushed (they do not rebase because main moved).

## Replay: their way vs a merge queue vs land-then-verify (no LLM)

`replay.mjs` replays the real main stream (16,273 changes at their real times) with CI times, costs, shard
counts and flake rates from their own jobs. "bad" = a change that breaks the full suite on main (sweep;
measured upper bound ~2.5%). Flake per shard: 3.2% (hourly non-repeating failures, upper bound) and 0.8% (what
PR runs' 40% red rate allows). Bisect re-runs only the failing shards. Numbers below: bad 2.5%, flake 0.8%
(the 3.2% run is in `replay-flake0.032.json`; same ranking, more false bounces).

| policy | landing CI runner-h/day | wait to land p50 / p90 | breaks reaching main | red-main h/day |
|---|---|---|---|---|
| **theirs** (no queue; hourly full suite, measured) | **~340** | **0 / 0** | all (~13/day) | **17.5 measured** (111/152 hours, `persistent_red_h_per_day`) |
| queue, full suite, N32 K4 | ~1,330 (3.9x) | 82 / 163 min | 0 | 0 |
| queue, full suite, N8 K2 | ~1,150 | falls behind (days) | 0 | 0 |
| queue, PR-sized scope, N16 K4 | ~550 (1.6x) | 18 / 52 min | 0 *if the scope catches it* | 0 |
| land then verify hourly + shard bisect + auto-revert | ~400 (1.2x) | 0 / 0 | all, reverted | ~14 |
| land then verify every 20 min | ~1,115 (3.3x) | 0 / 0 | all, reverted | ~12 |

Read as:
- **Their no-queue flow is the cheapest and fastest, and that is a fair choice at 22 changes/h with a 31-min,
  162-shard suite.** A classic queue on the full suite either falls behind (small trains) or costs ~4x the landing
  CI and adds 1.5–3 h per change. It would add ~1,000 runner-hours/day (+30% of all their CI). Theirs wins on
  cost and latency; it pays with a full suite that is red most hours.
- **A merge queue only competes if a train runs the union of its changes' scoped tests**, not the full suite:
  then ~1.6x landing CI (still ~5% of their total CI) and ~20 min median wait buy a main that never takes a
  caught break. Phase 2a (below): for ~78% (CI 62–88%) of the hourly suite's breaks a change in the failing test's area
  landed that hour, so scoped trains would plausibly catch most of them; the rest need land-then-verify.
- **Land-then-verify** (their way + flaky-shard retry + bisect only failing shards + automatic revert) costs about
  what they pay today and keeps zero latency, but only cuts red hours ~20%: detection waits for the next run.
- Not modeled: interaction breaks a train causes that no single PR would (handled the same as "bad"), runner
  capacity limits, re-queueing of false bounces, humans fixing faster than the revert.

## Operating modes a maintainer would set (each tied to a number above)

1. **Triage lane on by default, close-first.** 210 issues/day; bots already label in ~7 min and close 36%;
   NOT_PLANNED in 9 min. qodebase must match that (it is table stakes here), not beat GitHub on it.
2. **Per-author caps by role, not one number.** Outsiders cap 20 open (their rule); mergers run 200+ open PRs
   each. Cap per author *and* per merger's review queue.
3. **Claims + list-file handlers before trains.** 22.5% same-hour file collisions; 41% of them are i18n catalogs
   and baseline lists that a key/list merge or regenerate step resolves without a rebase (our tier-1 handlers).
4. **Train mode: scoped union, K≥4, N 16–32; never the full suite per train.** Full-suite trains cost ~4x and
   fall behind at N8 K2.
5. **Main verification: hourly full suite with flaky-shard retry, failing-shard bisect, auto-revert.** ~1.2x their
   landing CI; turns "red 73% of hours" into an owned, bounded state.
6. **Readiness vs merge authority as separate flags.** 9% of merges go in red today on purpose; the queue needs an
   explicit "land despite red shard X" with who and why, not a silent bypass.
7. **Evidence gate per change** (their `proof:` labels): attach to the change record, not a comment.

## Phase 2a: would a train's scoped tests catch their breaks? (no model, 2026-10-08)

`sim/openclaw/breaks.mjs`: 40 of the 202 new persistent shard failures (spread over the week, one per hour
first), read the failing job's log for the failing test file (254 read-only REST requests), then looked at the
commits that landed on main in that hour. Data: `data/breaks.jsonl`, `data/breaks-summary.json`.

| verdict | breaks | |
|---|---|---|
| a change in the failing test's area landed that hour | **31 / 40 (78%, 95% CI 62–88%)** | 27 of 33 test breaks had a change in the test's own directory |
| lane PR runs don't have (Windows, QA smoke, release driver) | 3 | a train would need these lanes too |
| no failing test file (infra, build, timeout) | 4 | not a code break; flake handling, not a queue |
| no change in the test's area that hour | 2 | indirect break; a scoped train misses it |

Read as: **about three in four of the breaks their hourly suite finds sit next to a change from that same hour**,
so a train that runs the union of its changes' changed-scope tests on the combined main would plausibly have
caught them before landing (the PR itself passed the same tests on an older base: these are interaction /
stale-base breaks, which is what a train tests). Upper bound: "area" is a directory match, not their real
test-selection graph, and the commit in the area is a suspect, not a proven culprit. The scoped-queue row in
the replay table stands with that caveat; ~22% (CI 12–38%) would still reach main and need land-then-verify.

## Phase 2b: a text-only triage lane on 200 issues vs ClawSweeper (2026-10-08)

`sim/openclaw/triage.mjs`: 200 issues created 09-08..09-28 with a clean outcome, 50 each: closed not planned,
closed as duplicate (GitHub reason or a "duplicate of #N" comment), fixed by a PR/commit, open with
`clawsweeper:needs-product-decision`. Classifiers see title + body only; one Choice question, wording
`triage-v1` (in the script). Haiku 5.5 via `claude -p` on the subscription with a minimal harness
(~1.3k tokens/call; Claude Code's default context was ~59k). Every call in `data/triage-calls.jsonl`.

| classifier | accuracy vs outcome (95% CI) | agrees with ClawSweeper | recall close / dup / fix / decision | acts at p ≥ 0.8: n, accuracy | Brier | ms p50 | cost, 200 issues |
|---|---|---|---|---|---|---|---|
| Haiku 5.5 | **50%** (43–57) | 54% | 24 / 14 / 84 / 78% | 71, 62% (50–72) | 0.71 | 3,075 | $0.073 API-equiv (subscription) |
| Jev | 40% (33–46) | 39% | 22 / 0 / 84 / 52% | 158, 44% (37–52) | 1.04 | 253 | $0.011 |
| Clef-flash | 36% (29–42) | 31% | 12 / 0 / 94 / 36% | 93, 47% (38–57) | 0.95 | 421 | not priced (Workers AI, desk-bench gateway) |
| ClawSweeper (its labels/closings) | 94% (90–97) of 170 it labelled | | | | | | 50–128 Codex workers |

Chance is 25%. Read as: **a one-shot, text-only classifier is no triage lane for this project.** All three call
most "close" issues a fix (support questions and already-fixed reports read like bugs) and miss duplicates almost
entirely (they cannot see the other 6,000 issues). Jev's probabilities are poorly calibrated here (158 answers at
p ≥ 0.8, 44% right). ClawSweeper's 94% is not independent (its own closings are part of the outcome), but its
labels show why it works: `source-repro`, `not-repro-on-main`, `linked-pr-open` — it reads the code, checks main,
and searches existing issues and PRs. **qodebase's triage lane has to be an agent with the repo and the issue
index, not a classifier.** A cheap classifier can still sort decision vs fix as a first pass (Haiku: 78% / 84%
recall) for routing to that agent. Spend for 2b: ~$0.09 (cap $2).

## Phase 2b-2: triage as an agent, 100 of the 200 issues (2026-10-08)

Same question (`triage-v1`), same scoring. Haiku 5.5 via `claude -p` on the subscription (harness
`triage-agent-v1` in `sim/openclaw/triage.mjs`): working directory = a sparse snapshot of main taken on or before
the issue's date (09-08 / 09-15 / 09-22; src, extensions, ui/src, packages, docs, skills, config), Read/Grep/Glob
inside it only, and one shell command: `issue-search.mjs`, BM25 over the titles of all 58,238 issues (+ the
window's PR titles) filed before the issue, titles and dates only (no state or labels, so no later outcome leaks).
Sandbox checked: reads outside the snapshot and any other command are refused (3 refusals in the run).
100 issues = the first 25 of each outcome class.

| on the same 100 | accuracy (95% CI) | recall close / dup / fix / decision |
|---|---|---|
| **Haiku agent** | **59%** (49–68) | 28 / **68** / 72 / 68% |
| Haiku, text only | 50% (40–60) | 20 / 16 / 88 / 76% |
| Jev | 39% (30–49) | 20 / 0 / 88 / 48% |
| Clef-flash | 35% (26–45) | 12 / 0 / 96 / 32% |

- **Paired against text-only Haiku: the agent alone right on 18, text-only alone right on 9 (exact McNemar
  p = 0.12).** Better, not yet clearly better at n = 100.
- **Duplicates are the clear gain: 17 of 25 found (68%) vs 16%, and 17 of its 24 duplicate calls were right**
  (71%). It names the issue (`duplicate_of`); spot checks: the repeated auto-filed update-failure reports point at
  the first of the series. Which issue it named is not scored against ClawSweeper's choice.
- "Close" stays weak (28%): 13 of 25 go to "decision". Part of that is the ground truth: a feature request the
  maintainers declined is closed *not planned* here, which a triager could fairly call "needs a decision". The
  agent also barely read code (median 3 turns: mostly searches), so "already fixed / works as intended" went
  unchecked.
- Agrees with ClawSweeper 65% (55–74). Cost: **$0.12 API-equivalent for 100** (subscription; 1.35M cache-read +
  0.52M cache-write + 85k output tokens), median 7.8 s per issue.

Read as: giving a cheap model the issue index turns duplicate detection from 16% to ~70%, at about a tenth of a
cent per issue. Overall triage accuracy is still far from ClawSweeper's, and the remaining gap is the "is this
already fixed / intended" check, which needs the agent to actually read code (a prompt and turn-budget change,
not a bigger model, is the next thing to try).

## Phase 2b-3: the triage agent on all 200, then a v2 prompt on 100 new issues (2026-10-08)

Order fixed by the manager so nothing is tuned on the test set: (1) v1 unchanged on the other 100 of the 200;
(2) v2 (one required code check before "fix" or "close", written after seeing v1 on set A) on **100 issues never
used before** (`triage-sample2.jsonl`, same 25/class balance and snapshot rule), with v1 on the same 100.
Data: `data/triage-score.json` → `agent_rounds` and `on_agent_subset.paired_vs_haiku`.

| | n | accuracy (95% CI) | paired (exact McNemar) |
|---|---|---|---|
| **v1 agent vs text-only Haiku, all 200** | 200 | **61% (54–68) vs 50% (43–57)** | agent alone right 38, text alone 16, **p = 0.004** |
| duplicates found, same 200 | 50 | **66% (52–78) vs 14% (7–26)** | |
| v1 agent on the new 100 (set C) | 100 | 53% (43–63) | |
| v2 vs v1 on the new 100 | 100 | 56% (46–65) vs 53% (43–63) | v2 alone 6, v1 alone 3, p = 0.51 |

- **The result holds: on 200 issues the agent beats text-only triage (p = 0.004), and the whole gain is
  finding duplicates.** Fix/decision recall are about the same; "close" stays the weak class (20–28% for every
  variant).
- On fresh issues v1 scored 53%, at the low end of its 200-issue interval: across all 300 issues it was given,
  v1 is 175/300 = 58%.
- **v2's code check did not help.** It did check code (cited a `path:line` in 24 of its 36 fix/close answers vs 8
  of 39 for v1; median turns 4 vs 3), but accuracy moved 3 points (p = 0.51) and "close" recall 20% -> 24%. Reading
  the code is not what separates "close" from "fix" here; what ClawSweeper knows and the agent does not is the
  project's policy (what is supported, what is out of scope) and current main.
- Cost: v1 on 200 $0.24, v1 + v2 on the new 100 $0.25; all rounds $0.50 API-equivalent at Haiku 5.5 rates, on the
  subscription (cap $1).

## Phase 2b-4: the triage agent with vs without the project's own policy (Eyal's design, 2026-10-08)

Same v1 harness (Haiku 5.5, dated code snapshot + earlier-issue search) on all 300 issues (the 200 + the new 100),
paired: v1 vs v1 + policy. **Policy = the project's documents as they were at each snapshot date**, verbatim from
git (no later rules): openclaw `VISION.md`, `CONTRIBUTING.md`, root `AGENTS.md`,
`.agents/skills/tag-duplicate-prs-issues` and `security-triage` `SKILL.md`, and ClawSweeper's 6–7
`docs/*close-polic*.md` at its last commit before the date (bundles: ~100 KB, `data/policy-<date>.md` in the
local mirror). **Put in the system prompt**, not as files to read (v2 showed the agent rarely reads what it is not
handed; a system prompt is also cached across the issues of one snapshot), plus one line in the task: "the project's
own policy documents as of <date> are in your system prompt: apply them". 299 of 300 answered (one answer's JSON
was cut off). Data: `data/triage-score.json` → `agent_rounds.round3_policy_vs_v1_on_300`.

| on the same 299 issues | accuracy (95% CI) | close | duplicate | fix | decision |
|---|---|---|---|---|---|
| v1 (no policy) | **58.5%** (53–64) | 25% (17–36) | 63% (51–73) | 69% (58–79) | 76% (65–84) |
| v1 + policy | 55.2% (50–61) | 27% (18–38) | 64% (52–74) | 61% (50–72) | 69% (58–79) |

- **Paired (exact McNemar): policy alone right on 13, no-policy alone right on 23, p = 0.13.** The project's own
  rules did not help this agent; if anything it got slightly worse (both the original 200 and the new 100 point
  the same way: 58% vs 61%, 50% vs 54%).
- **"Close" did not move** (27% vs 25%), the class the policy was meant to fix; fix and decision lost a few points.
- Cost: ~72k more input tokens per call (cached: 90k vs 18k per call incl. cache), **$0.62 vs $0.36
  API-equivalent** for the 299 (subscription; this round's cap $2).
- **Caveat:** the ground truth (outcomes, ClawSweeper's closings) was itself produced by applying this policy, so
  "with policy" measures *following the project's rules*, not independent judgement; even so, a small model handed
  the rules does not reproduce the calls. What ClawSweeper has that the agent does not is more than the documents:
  live repro on current main, linked-PR state, maintainers' product decisions, and a much larger model per item.

## Phase 2c: why there is no OpenClaw fix lane (yet) (2026-10-08, manager's decision C)

Prepared without model calls (`sim/openclaw/fixlane.mjs`, `closure.mjs`): **199 candidate fixes** from the mirrored
data (closed issue, exactly one linked merged PR, < 200 lines, one area, adds or changes a test, no dependency or CI
change), a full OpenClaw worktree and install on the laptop, and a fail-before / pass-after check per fix (the
fix's test files alone on the base must fail; the whole fix diff on the base must pass). Kept for later:
`data/fixlane-candidates.json`, `data/fixlane-verify*.jsonl` (verified fixes, per-parent and on one common base,
main 2026-10-01 `c9a7893`): on that one base, **19 of the 28 fixes merged Oct 2-4 verified** (fail before, pass
after), 8 did not apply cleanly to a 1-3 day old base, 1 failed after the fix too; per-parent, 7 of 19 verified
before the lockfile problem below was understood).

**The finding: a real monorepo does not fit a generic agent box.**
- **One test pulls ~11,000 files.** The import closure of even a small extension's test is 11,020 files (57 npm
  packages, 89 generated or subpath imports): every extension goes through the root `openclaw/plugin-sdk` barrel
  into `src/agents`, `gateway`, `infra`, `config`, `plugins`. A core test (`src/agents`): 10,531. No standalone
  cut-out under a few thousand files exists.
- **Toolchain: Node ≥ 24.16 and a pnpm 12 workspace** (189 workspace projects). Our boxes and merger have Node 22
  + npm.
- **Install: 2.8 GB of node_modules, 10 min cold** (`pnpm install --frozen-lockfile --ignore-scripts` on the laptop),
  2.5 min warm; and node_modules must match each base's lockfile (an install for a newer base made 10 of 19 older
  fixes fail before any test ran).
- **A single test file takes 3–60 s** through their vitest wrapper (sqlite lifecycle, compiled subprocesses).

So to work on projects like this, **agent boxes need per-project toolchains and cached installs**: an install step
per scenario (corepack pnpm), a Node 24 image, a shared package store or a snapshot with node_modules per base, and
starters of ~10k+ files. That is option A, **post-contest work**. Until then OpenClaw stays a triage and landing study.

## What phase 2 should test next
- Triage: the policy documents did not help Haiku (2b-4). Next candidates: a stronger model on the same 300
  (Sonnet 5.5), and giving the agent current main + linked-PR state as ClawSweeper has.
- Duplicate rate over all closed issues from comment text (85 of a 900-issue pool were duplicates by comment,
  so the rate is far above GitHub's 0.1%; measure it properly).
- Post-contest (option A): fix lane on OpenClaw once boxes have per-project toolchains (Node 24, pnpm install step,
  cached installs per base); the 199 candidates and the verified fixes are in data/.
