# Contest video: storyboard and script (owner: qb8)

Target **5:30-7:00** (limit 5-10 min). Viewer: a smart non-programmer (a judge watching
twenty of these). One idea per scene, every number on screen with its source. Captions
carry the story, and an Aura-2 voice-over (Cloudflare Workers AI) reads exactly the
caption text. Build: `video/contest/` (see docs/contest/video.md); the scene list in
`video/contest/cut.py` script() is the source of truth for wording and order: change
both together.

Draft 2 order after the manager's review of draft 1 (2026-10-07): **product first**,
measurements cut to ~50 s, the idea in three slides, the demo by ~2:20, "not GitHub with
agents on top" right after the demo.

Judging, and where each part is answered:
- **Originality + prototype quality (50%)**: the product opens the video and fills its
  longest scene (a real scripted run on qodebase.app); "measured, then built"; self-host.
- **Concurrency, coordination, context, review, conflicts (25%)**: fork per agent, the
  line and trains, claims map, the change record kept as git notes, reviewer verdicts,
  replay on collision, the lead for what replay cannot do, a bounce that never breaks main.
- **Ease of use (25%)**: all on a 390 px phone, plain words, tap to drill down, Talk.

## Rules for every line (manager review)
- Legible at 50% size: slide text ≥ 34 px at 1080p, one short subline, few words.
- Neutral about other projects (contest rule): Bun "worked mostly on one shared branch,
  files split between them", never "gave up on branches".
- Claim on film only what exists. Status from qb6 (2026-10-07): BUILT: git notes in the
  merger, bounced train + fix, claims (data + map), stacking (demo). By Oct 10: notes
  readable in the code browser, a busy mode with up to 20 agents and MEASURED numbers.
  By Oct 11, behind a flag, on 1-2 real changes only: tier-2 LLM replay. So the video
  never says an agent replays changes in the scripted run, and never scripts a number:
  run numbers are read from the run itself (rec-work.mjs `live`).
- Hono is final (qb4, 395cbb5): 16/40/48% of PRs needed an earlier one, 0 git conflicts
  and 0 clean-but-broken at every wave.

## Scenes

| # | scene | on screen | narration / caption (short form) |
|---|---|---|---|
| 0 | Cold open (~18 s) | Phone: Agents at work, the line with a train being tested | Ten agents are changing one app at the same time. / Their work waits in one line, is tested, and joins the main code. No one has to step in. |
| 0 | Title | Card: qodebase | qodebase. A git platform for the age of agents, built on Cloudflare. |
| 1 | Problem (~30 s) | Slides people, agents, collision, ordering | Pull requests were built for people. / Now one person runs fifty agents. / Two changes, each fine alone, collide. / Or one needs another that has not landed yet. |
| 2 | Measured (~50 s) | qb5 charts: hono-ordering, bun-swarm, realcode-500, cloudflare-500 | Hono replayed as 100 at once: half needed another first, git conflicts none, the problem is order. / Bun's 64 agents: mostly one shared branch. / Real code, 500 agents: land by intent 3.5x review-then-merge. / Cloudflare: 7,033 pushes, 280 ms; one queue was the limit, split by area. |
| 3 | Idea (~35 s) | Slides idea-fork, idea-record, idea-intent | Own fork per agent. / The record (intent, diff, review, tests) as git notes. / On collision, replay the reviewed intent on the newest code. |
| 4 | On the phone (~2:30) | Live scripted run on eyal/corner-cafe: overview, x8 time-lapse with badge, then taps into a replayed, a bounced, a lead-handled and a stacked change | A café website, four agents, fourteen tasks, scripted (real commits, real queue, no AI bills). / Trains. / Collisions replayed. / A bounce, fixed. / All landed in N minutes, typical ask-to-land S seconds (read from the run). / Each record explained. |
| 4 | Talk (to film) | Mic on the project page, a spoken request, an agent card appears | And you steer it by talking to it, from your phone. |
| 4 | Not GitHub + agents | Slide "different" | The unit is an intent with its record; landing is automatic; a conflict is replayed, not bounced. |
| 5 | Cloudflare (~25 s) | Slide cloudflare | Workers, Durable Objects, Artifacts, Containers, Workers AI (including this narration); install your own copy. |
| 6 | Close | Slide "measured", end card | We measured it, then built it. / qodebase.app, open source. |

## Production notes
- 1920×1080, 30 fps, H.264 + AAC narration (loudnorm -16 LUFS), burned-in captions + `.srt`.
- Phone scenes: phone left, caption right; each filmed step holds for its narration
  (rec-work.mjs reads the clip length from cut.py `--vo-seconds`). Time-lapses never freeze.
- Never in shot: emails, tokens, the owner's version label (the rig hides `#talk-ver`),
  other people's projects.
