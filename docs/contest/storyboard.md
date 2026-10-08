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

## Scenes (draft 3, after the manager's review of draft 2)

| # | scene | on screen | narration (short form) |
|---|---|---|---|
| 0 | Cold open (~20 s) | Busy mode on eyal/cafe-busy: 20 scripted agents, the line, the map | N agents are changing one app at once (N read from the page); scripted, but every commit, collision and test is real. |
| 0 | Title | Card: qodebase | A git platform for the age of agents, built on Cloudflare. |
| 1 | Problem (~30 s) | Slides people, agents, collision, ordering | as draft 2 |
| 2 | Measured (~70 s) | qb5 charts: hono-ordering, swarm-migration, realcode-500, cloudflare-500 | Hono: half needed another first, no conflicts. / Migration swarm: any-order wastes 90 agent-hours; knowing the order < half the time; stacking + land by intent wastes nothing, never breaks main. / Real code: 3.5x. / Cloudflare: 7,033 pushes, 280 ms; one queue was the limit. |
| 3 | Idea (~35 s) | idea-fork, idea-record, idea-intent | as draft 2 |
| 4a | Judge's view (~1:45) | corner-cafe, tap Watch a run, x4 time-lapse, then a replayed, a bounced-then-fixed, a lead-redone and a stacked change (picked from the run's records) | Anyone can watch a run, no sign-in. / trains / collisions replayed / one bounce, fixed / all landed in N min (read from the run). |
| 4b | Real agents (~1:30) | cafe-crew: the 12-feature request typed into Talk, Send confirmed (the run Talk really started, 01:18:47 UTC), x24 time-lapse, the AI-replayed change, a reviewer's notes | One request, 12 real Claude Haiku 5.5 agents, 3 reviewers; N of 12 landed in M minutes (read from the run). |
| 4c | Proof | Slide notes: `git log --notes=qodebase` on cafe-real | The record travels with the code. |
| 4d | Not GitHub + agents | Slide different | as draft 2 |
| 5 | Cloudflare | Slide cloudflare | as draft 2 |
| 6 | Close | measured slide; end card with the live-run link (qodebase.app/p/eyal/corner-cafe), the sims (qodebase.app/sim), the repo | |

Phone scenes are a zoomed window (760 px wide, ~40% of the frame) on 2x frames, panning to what is narrated.
Projects: corner-cafe is the JUDGES' project (only Watch-a-run takes there); busy mode on cafe-busy;
real agents on cafe-crew / cafe-real (qb6 runs them; tell qb6 before and after).

## Production notes
- 1920×1080, 30 fps, H.264 + AAC narration (loudnorm -16 LUFS), burned-in captions + `.srt`.
- Phone scenes: phone left, caption right; each filmed step holds for its narration
  (rec-work.mjs reads the clip length from cut.py `--vo-seconds`). Time-lapses never freeze.
- Never in shot: emails, tokens, the owner's version label (the rig hides `#talk-ver`),
  other people's projects.
