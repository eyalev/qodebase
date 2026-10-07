# Landing system (owner: qb6)

Read ../../CLAUDE.md (architecture: Project DO, agent boxes on Artifacts forks, router/reviewer
agents, forq CLI, BuildBox container), docs/contest/PLAN.md (story, contract, rules), and
sim/README.md + sim/cloud/README.md (why: the measurements).

## Checklist
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
