# Contest plan: "Build the next GitHub" (Cloudflare) — submission Oct 14, 23:59 PDT

Manager: the planning tab (cc-com session s1007-1655). Eyal decides product questions.
Judging: originality + prototype quality 50%; multi-agent concurrency, coordination, context
preservation, review, conflict handling 25%; ease of use / UX 25%. Submission: 5-10 min video,
open-source repo (eyalev/qodebase, Apache-2.0), run instructions, "project vision", "how you
used Cloudflare".

## The story (what every workstream serves)
"We measured it, then built it." Simulations (fast sim to 100k agents, real code + real git,
500 Durable Object agents on Artifacts, a replay of Hono's real PRs, Bun's real 64-agent port)
show: shared-file collisions and ORDERING are the problem, not raw conflicts. qodebase answers
with: one fork per agent; a change RECORD (intent + diff + review + tests, kept as git notes);
a MERGE QUEUE that lands tested trains; LAND BY INTENT (replay the reviewed change on the
latest main instead of bouncing it); CLAIMS so agents see who works where; STACKING so a
change can build on an unlanded one. All on the phone, understandable to a non-programmer.

## Workstreams
| tab | owns | brief |
|---|---|---|
| qb4 | sim/ (except sim/bun/), public/sim/ | sim/tasks/migration-swarm.md |
| qb5 | sim/bun/ | sim/tasks/bun-calibration.md |
| qb6 | landing system: src/landing/*, the merger box, demo agents, forq CLI additions | docs/contest/landing.md |
| qb7 | UI: src/landingui/* (+ minimal hooks in the project page) | docs/contest/ui.md |
| qb8 | video + submission texts + README polish: video/contest/*, docs/contest/submission.md | docs/contest/video.md |
| qb1-3 | the rest of the product (Talk etc.), unchanged | — |

## Contract between qb6 and qb7 (agree here; change only by telling both)
GET /api/p/<o>/<n>/landing ->
{ queue: { trains: [{ id, state: "testing"|"landed"|"bounced", changes:[id], startedAt, endedAt, checks:{ok, ms, failures:[str]} }], waiting:[id] },
  changes: [{ id, title, intent, agent, kind:"agent"|"demo", fork, base, state:"working"|"pushed"|"reviewing"|"queued"|"testing"|"landed"|"bounced"|"replaying"|"with-lead",
              files:[path], claims:[path], needs:[id], provides:[str], stackedOn:id|null,
              events:[{t, what, detail?}], review:{verdict, notes}|null,
              landing:{ how:"merged"|"replayed-handler"|"replayed-llm"|"lead"|null, conflicts:[path], diff:[{path, lines:[str]}], commit, mainCommit }|null }],
  areas: [{ path, files:int, working:int, claimed:int, recentConflicts:int, recentLandings:int }],
  stats: { landedToday, inQueue, bounced, replayed, medianAskToLandS } }
qb7 builds against a mock of exactly this first (public/landing-mock.json), then switches to the API.

## Cost rules
Demo/video runs use SCRIPTED agents (no model calls, no agent containers): Durable Objects that
push real commits to real Artifacts forks (reuse sim/cloud/src/gitpush.js). The merger box is
one small container, idle-stopped. LLM replay is behind a per-project flag, off by default.
Any new metered thing gets a cloudcost line the day it is created.

## Deploys
A forq deploy kills running agent boxes. Commit by explicit path; deploy from a clean worktree
of HEAD (or live sha + your files) after `wrangler containers list` shows no live boxes and after
telling qb2 (cc_com.py send qb2 "<tab>: deploying <what>"). qb6 is the deploy owner for contest
work; qb7/qb8 ask qb6.

## Timeline
- Oct 8: contract fixed; qb6 record + queue + merger box skeleton; qb7 UI on the mock; qb8 storyboard + script + rig.
- Oct 9-10: queue live on a demo project with scripted agents; land-by-intent tiers (handlers first,
  LLM replay behind flag); claims; UI on real data.
- Oct 11: first full video cut (demo mode); manager reviews UX + clarity.
- Oct 12: fixes; final sim numbers (qb4/qb5) into video and README; submission texts.
- Oct 13: final video, deploy, repo polish. Oct 14: buffer, Eyal submits.

## Status
Each tab keeps a checklist at the top of its brief ([ ]/[x]) and updates it as steps finish.
