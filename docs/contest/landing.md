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
Status 2026-10-07 night: record, queue, merger box, notes, tier-1 handlers, stacking and demo
mode are BUILT (src/landing/*, local tests: `node --experimental-strip-types --test src/landing/*.test.mjs`),
not deployed yet. [x] = verified on Cloudflare.
- [ ] Change RECORD in the Project DO: created at spawn (intent = task text, agent, fork, base,
      expected files), updated on push/review/landing; events log. Served in the PLAN.md contract.
- [ ] MERGE QUEUE in the Project DO (alarm-driven trains). Git + checks run in a MERGER box
      (BuildBox-style container: clone/fetch, `git merge-tree`, the project's check command,
      push main). Merge tap = approve -> queued. Bounce on failed checks.
- [ ] Records as git notes on landed commits (Artifacts supports notes) so "why" travels with the code.
- [ ] LAND BY INTENT tier 1: deterministic handlers for shared-file edits (lockfile regenerate,
      package.json deps, append to a list file such as routes/exports) -> reapply on latest main.
- [ ] Tier 2: LLM replay (the change's agent or a merger agent reapplies the intent on today's code),
      per-project flag, OFF by default; diff-of-diffs shown when it differs from what was reviewed.
- [ ] Tier 3: escalate to the area lead / the owner.
- [ ] CLAIMS: router declares expected files at spawn; DO warns on overlap; `forq list` shows the map.
- [ ] STACKING: `forq spawn --on <agent>` forks from another agent's fork; queue lands stacks in order.
- [ ] DEMO MODE: scripted agents (Durable Objects, no LLM, no containers) on a demo project:
      a scripted task list producing real commits on real forks (reuse sim/cloud/src/gitpush.js and
      sim/real/project.mjs-style operations, or Hono-shaped edits), going through the REAL record,
      queue, merger box and replay. Controls: start/stop, number of agents, speed. This is what
      the video records, so it must look busy and be honest (labelled "scripted agents").
- [ ] Docs: CLAUDE.md section, README section, cloudcost entry for the merger box.
Keep existing behaviour working for projects without the flag. Coordinate src/project.ts edits
with qb2 (cc_com) since qb1-3 work in src/ too.
