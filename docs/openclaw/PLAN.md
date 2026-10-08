# OpenClaw experiment (owner: qb9) — 2026-10-08

Question: could qodebase (on Cloudflare) run a project like OpenClaw better than GitHub does today,
and can we SHOW it from their real data? Start small; scale only what looks promising.
Background: the research summary in the manager's notes (scale: ~632 PRs/day, ~514 merges/day, ~213
issues/day, 6.1k open issues; ClawSweeper: 50-128 Codex agents triaging/closing ~4,000 issues in a day;
dedupe clusters as one work unit; 20 open PRs per author cap; no merge queue, linear history, "don't
rebase just because main moved"; "readiness is not merge authority"; GitHub API rate limits + CI cost
were real pain). Repo: github.com/openclaw/openclaw (MIT). Read-only: never post, comment, label,
star or open anything on their repo or ClawSweeper.

## Phase 1 — data only, no model calls (target Oct 11)
- [x] Mirror a SAMPLE of metadata with gh (rate-limit aware, cached locally under
      ~/projects/github/openclaw/data/): last 30 days of PRs (author, created/merged, files touched,
      CI duration/result, labels, linked issues) and issues (labels incl. ClawSweeper's, close reason,
      duplicates/cluster labels). Report request counts; stay far below rate limits.
      _Done 2026-10-08: 18,977 PRs, 6,408 issues, 16,273 main commits, 13,970 CI runs + jobs of 353;
      2,165 requests (1,291 GraphQL points, 1,332 REST). Not measured: duplicate rate (lives in
      ClawSweeper comments, not metadata)._
- [x] Describe their real flow as numbers: time to first triage, to close, to merge; CI minutes per
      merge; how many PRs touch the same files within an hour; duplicate rate; how much work is closed
      vs fixed.
- [x] Replay their real PR stream through our landing policies with the fast sim / a light replay
      (no LLM): their actual way (linear, no queue, rebase only on conflict) vs qodebase's queue +
      trains + land-by-intent + claims, at their real rate. Measure CI runs/minutes, conflicts, main
      breakage risk, time to land. Be honest if theirs wins (cost of trains vs their no-queue flow).
- [x] "Operating modes": a short list of knobs a maintainer would set in qodebase for a project like
      this (triage lane, dedupe clusters as work units, per-author caps, evidence gates, train size,
      readiness vs merge authority), each tied to what their data shows.

## Phase 2 — small real tests (ask the manager first; cheap models)
- [x] (added) Triage as an agent on 100 of the 200 (code snapshot + earlier-issue search): 59% (49-68)
      vs text-only Haiku 50% on the same 100, paired p = 0.12; duplicates 68% vs 16%. $0.12 API-equiv.
- [x] (added) v1 on all 200: 61% vs 50%, paired p = 0.004 (duplicates 66% vs 14%); v2 (code check)
      on 100 NEW issues: 56% vs v1 53%, p = 0.51 (no gain). $0.50 total. FINDINGS 2b-3.
- [x] (added, no model) Do PR-scoped tests catch the hourly suite's breaks? Map new persistent
      shard failures to that hour's commits/files. Decides whether scoped-union trains are real.
      _Done 2026-10-08: 31/40 (78%, CI 62-88%) had a same-area change that hour; 254 requests._
- [x] Triage lane: classify N=200 recent issues (close / duplicate of X / needs decision / fix) with
      Jev, Clef-flash and Haiku 5.5; compare with ClawSweeper's labels + actual outcomes as ground truth.
      _Done 2026-10-08: Haiku 50% (43-57), Jev 40%, Clef-flash 36% vs ClawSweeper 94% (not independent);
      text-only classifiers are no triage lane; next = a triage agent with repo + issue index. ~$0.09._
- [x] Fix lane PREP done; RUN dropped for now (manager, decision C): one test's import closure ~11k
      files, Node 24 + pnpm, 2.8 GB install; boxes need per-project toolchains first (post-contest).
      Candidates + verified fixes in docs/openclaw/data/. Original item:
      Fix lane: 10 small closed issues with exactly one linked merged PR that adds a failing test,
      pinned to the fix's parent commit, fixed by Haiku agents in qodebase (lab runner from qb6);
      score fail->pass, diff vs the real fix (blinded judge), time, cost.
## Phase 3 — scale (only if phase 2 is promising; manager + Eyal approve)
Coordinate with the lab (docs/lab/PLAN.md): this can become lab scenario 6.
Deliverables: docs/openclaw/FINDINGS.md (numbers first), charts for qb5, a short README section.
