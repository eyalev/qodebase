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
at a median **1.4 h** (p90 16 h). Everyone else: **55%** of their decided PRs merge, median **18.6 h** (p90 8 days).
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
into the next run**; 84 hours saw a *new* persistent break (~13/day ≈ **2.5% of landed changes**, an upper bound if
one change causes each). 9% of merged PRs merged with a red last check (1,368) — "readiness is not merge
authority" in practice.

**Collisions.** 22.5% of main commits touch a file another commit touched in the hour before (6% within 10 min,
51% within 6 h). 35% of merged PRs had another PR merge into one of their files while they were open (p90: 10
such merges). 19% of PRs landed after one of their files changed on main since their own last CI. Where the
same-hour collisions land: **i18n catalogs 30%, list/baseline files 11%** (`config/assertion-safety-baseline.txt`
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
| **theirs** (no queue; hourly full suite, measured) | **~340** | **0 / 0** | all (~13/day) | **~17.5 measured** (73% of hours) |
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
  caught break. Whether scoped tests catch the breaks the hourly suite finds is **unknown** (those breaks escaped
  PR-scoped CI once already) — the key phase-2 question.
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

## What phase 2 should test (needs the manager's go)
- Do PR-scoped tests catch the hourly suite's breaks? Map each new persistent shard failure to the commits of that
  hour and their files (needs job logs or shard→path map; still no model).
- Duplicate rate from ClawSweeper's comments (text, read-only), then the triage lane vs ClawSweeper labels.
- The fix lane as in PLAN.md.
