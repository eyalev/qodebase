# Variants lab (qodebase.app/lab) — plan, 2026-10-08

Manager: cc-com session s1007-1655. Eyal approved: existing tabs, include the "one Opus agent
alone" baseline, budget below. Goal: show which way of running many agents wins, at what scale,
for what time, cost and QUALITY, on real work, without wasting tokens on losing variants.

## Run = scenario x variant
Scenarios (one-line prompts; the planner has to plan):
1. Greenfield: "Build a website for a small bakery: menu, opening hours, online orders."
2. Vague feature burst on an existing app: "Make the cafe site family-friendly." (cafe starter)
3. Port: "Port <small JS library> to TypeScript" (pick a small MIT lib with a test suite).
4. Bug-fix swarm: 10 failing tests/issues in a small real repo.
5. Refactor with ordering: "Rename X across the codebase" + a dependent change.
6. Backlog triage (from OpenClaw research): N mixed issues -> close / dedupe / fix; see docs/openclaw/PLAN.md.
v0 (by Oct 11): scenarios 2 and 3 (or 5). Others after.

Variant knobs: planner model (haiku/sonnet/opus); coding agents 1/3/6/12/24; reviewers 0/1/3/6;
review style (read | adversarial: must try to write a failing test); landing policy
(free-for-all / phases / stacking / land-by-intent / leads); claims on/off; duplicate-intent check
on/off; train size. Baselines (always run): (a) ONE Opus agent alone does the whole scenario;
(b) "GitHub-style": one PR per agent, bounced to rebase on every conflict.

## Quality (the hard part)
- Hidden acceptance tests per scenario, written BEFORE any run, never visible to agents (objective score).
- Build + type check + the project's own tests (floor).
- Apps: phone-size screenshots + a rubric judged by a different model than the builders (second opinion).
- Process signals: conflicts, replays, bounces, human interventions.
- Every run links to its Agents-at-work replay and the live app it built.

## Funnel (do not waste tokens)
Stage 0: fast sim, every combo, calibrated with measured numbers (free). Keep the top ~6.
Stage 1: real, Haiku coders, small scenario, 2 seeds. Keep top 3.
Stage 2: more agents, 3 seeds, 2-3 scenarios. Stage 3 (after Oct 14 unless cheap): winner + baselines at scale.
Real results feed back into the sim; the page shows predicted vs actual. No decision on one run.
BUDGET (whole lab, until Eyal says otherwise): <= 15% of the weekly Claude quota and <= $10 real spend.
Each stage has its own cap and stops itself; ask the manager before starting stage 2 and 3.

## Owners
| tab | owns |
|---|---|
| qb6 | variant flags in the landing system; the real-run runner (scenario repo setup, run, collect); budget guards; the Opus-alone and GitHub-style baselines |
| qb4 | stage-0 sim of every combo + calibration from real runs + the funnel logic (which variants advance) |
| qb5 | scenarios: starter repos, prompts, HIDDEN acceptance tests, quality scoring + judge rubric; result charts |
| qb7 | qodebase.app/lab UI (phone first): pick scenario + knobs -> instant sim prediction; "Run for real" (owner only, shows estimate); results: time/cost/quality frontier, tap -> run replay + built app; plain-words comparisons |
| qb8 | when results exist: README + submission lines (and a video shot only if ready and honest) |
Results format: one JSON line per run in public/lab/runs.jsonl (scenario, variant, seed, stage, timings, cost real + API-equiv, quality scores, links). qb6 writes it, qb7 reads it, qb4/qb5 analyze it. Agree fields between you; change only by telling all four.
Rules: commit by explicit path; deploys via qb6 (clean worktree, tell qb2); cloudcost line for anything new; corner-cafe stays the judges' project.
