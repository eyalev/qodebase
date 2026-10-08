# Landing system (owner: qb6)

Read ../../CLAUDE.md (architecture: Project DO, agent boxes on Artifacts forks, router/reviewer
agents, forq CLI, BuildBox container), docs/contest/PLAN.md (story, contract, rules), and
sim/README.md + sim/cloud/README.md (why: the measurements).

## Plan (qb6, 2026-10-07)
Files (all new unless noted): src/landing/landing.ts (Landing DO, one per project: records,
queue, claims, stats, the contract JSON), src/landing/merger.ts (MergeBox container DO,
`<slug>--merge`, same forq-box image by digest, 1 vCPU / 2 GiB, idle stop 5 min),
src/landing/mergejob.mjs (node script run in the box: git apply --3way per change on main,
tier-1 handlers, checks, git notes, push), src/landing/demo.ts (DemoAgent DO per scripted
agent: forks main in Artifacts, pushes real commits with sim/cloud/src/gitpush.js),
src/landing/demoproject.ts (seed + scripted task list, Hono-shaped: routes list,
package.json deps, modules, node --test tests), src/landing/routes.ts (API).
Edits: wrangler.jsonc (MergeBox container, 3 DO bindings, migration v8), index.ts (one line
routing `landing*` verbs + hooks at spawn/push/verdict/merge, coordinated with qb2),
cli.ts (`forq spawn --files`, `--on`, `forq list` claims).
Why a separate Landing DO, not Project: project.ts stays as qb1-3 left it; the hot 2 s poll
and the queue alarm never contend with the Project DO's review/delivery alarm.
Order: (1) Landing DO + contract endpoint, (2) MergeBox + mergejob (plain merges, checks,
bounce, notes), (3) demo project + DemoAgents, live on a demo project by Oct 9, (4) tier-1
handlers, claims, stacking, (5) real-agent hooks, (6) tier 2/3, docs, cloudcost.
Reuse: BuildBox's queue/alarm/resume pattern, gitpush.js, sim/real ideas for scripted edits.
Contract additions agreed with qb7: now, mode, demo, flags, change.lead/createdAt/landedAt/
title, train.mainBefore/mainAfter, review.verdict 'auto', event word 'overlap'.

## Checklist
[x] = verified on Cloudflare (eyal/corner-cafe, 2026-10-07 23:52: a full scripted run landed
all 14 changes: 4 replayed by handlers, 1 bounced on a failed test then fixed, 1 redone by the
scripted lead after a real conflict, 1 stacked; main linear, tests green, notes in Artifacts).
Local tests: `node --experimental-strip-types --test src/landing/*.test.mjs`.
- [x] Change RECORD (Landing DO, not Project: see Plan): created at spawn (intent = task text, agent, fork, base,
      expected files), updated on push/review/landing; events log. Served in the PLAN.md contract.
- [x] MERGE QUEUE (Landing DO) (alarm-driven trains). Git + checks run in a MERGER box
      (BuildBox-style container: clone/fetch, `git merge-tree`, the project's check command,
      push main). Merge tap = approve -> queued. Bounce on failed checks.
- [x] Records as git notes (refs/notes/qodebase; showing them in the code browser: todo) on landed commits (Artifacts supports notes) so "why" travels with the code.
- [x] LAND BY INTENT tier 1 (package.json + list files verified live; lockfile regenerate tested only in code path): deterministic handlers for shared-file edits (lockfile regenerate,
      package.json deps, append to a list file such as routes/exports) -> reapply on latest main.
- [x] Tier 2: LLM replay in the merger box (claude -p, default claude-haiku-5-5, flag llmReplay, OFF by default, owner's subscription only, never in public runs). Verified live 2026-10-08 on eyal/cafe-lab: site.js conflict redone in 9.7 s, ~90k tokens across turns. landing.reviewedDiff next to landing.diff = diff-of-diffs (UI: qb7).
- [x] Tier 3: demo = scripted lead redo (verified); real = with-lead + the router is told through Landing's outbox (built, not yet seen live).
- [x] CLAIMS: `forq spawn --files` verified live with real agents (eyal/cafe-real); overlap warnings capped at 3 per change; `forq list` shows claims.
- [x] STACKING: demo verified; `forq spawn --on <agent>` built for real agents (not yet seen live).
- [x] DEMO MODE: story (14 tasks), busy (generated, up to 24 agents, backpressure at 40 waiting, ~46 landings/min measured), WATCH A RUN (public, no sign-in, eyal/corner-cafe: 1 at a time, 10/day, 3/day + 5 min per IP).
- [~] Docs: CLAUDE.md section [x], cloudcost gap qodebase-landing [x], README section [ ].
- [x] REAL AGENTS through the queue (info.landing projects): verified 2026-10-08 on eyal/cafe-real,
      Haiku 5.5: 1 router request -> 2 agents -> reviewer -> merge taps -> one train -> landed with
      records + git notes; ~$0.17 total (boxes $0.059 + Haiku tokens).
- [x] REAL CREW RUN (2026-10-08, filmed by qb8): eyal/cafe-crew, 12 Haiku 5.5 agents + router + 3
      parallel reviewers from one request: 12/12 landed in 7 min 17 s, 0 bounced, 6 collisions (5
      handlers, 1 Haiku replay), main green with 12 notes; real spend $0.20 container time, API-equiv.
      $0.51 standard / $2.55 at the >100k tier; quota < 1%.
Next: notes in the code browser (qb7 panel); README section.
Keep existing behaviour working for projects without the flag. Coordinate src/project.ts edits
with qb2 (cc_com) since qb1-3 work in src/ too.
