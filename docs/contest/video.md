# Video + submission (owner: qb8)

Read docs/contest/PLAN.md (story, timeline), docs/video-guide.md and video/ (the existing
recording rig: rig.mjs, compose.py, combine.py; an earlier 6:34 cut is video/out/forq-contest.mp4),
sim/README.md, sim/cloud/README.md, and the challenge page https://www.cloudflare.com/git-competition/
(5-10 min demo; judges: originality 50%, concurrency/coordination/review/conflicts 25%, UX 25%).

## Checklist
- [x] Storyboard + script (docs/contest/storyboard.md), 6-8 min, for a non-expert viewer:
      problem (agents at scale collide) -> what we measured (sims, Hono, Bun, Cloudflare run;
      2-3 clear charts) -> the idea (records, queue, land by intent, claims, stacking) -> live demo
      on the phone (overview -> drill-down -> a collision replayed -> landed) -> how it runs on
      Cloudflare (Workers, Durable Objects, Artifacts, Containers, Workers AI/Clef) -> close.
- [x] Rig ready for the new screens (phone frame, captions, time-lapse); a draft cut from the sim
      pages (qodebase.app/sim) to test pacing before the demo mode exists.
- [ ] Record the demo-mode run once qb6/qb7 have it; voice-over optional (captions must carry it).
- [ ] Submission texts (docs/contest/submission.md): project vision, how we used Cloudflare,
      instructions to run; README polish (clear quick start, screenshots, the measurements).
- [x] Draft 1 (2026-10-07, 6:15, video/out/qodebase-contest.mp4 + .srt): scenes 0-3, 5, 6 from
      slides + sim viewer recordings; scene 4 = timed placeholders. Sent to the manager.
- [ ] Swap in qb5's evidence charts (docs/contest/evidence/*-1920x1080-dark.png) for the
      #hono/#policies/#bun/#cloud slides when they land (cut.py slide() takes a PNG path).
- [ ] Hand each cut to the manager tab for review (cc_com send s1007-1655 or tell Eyal).
## Build (video/contest/)
- `node video/contest/shoot-slides.mjs` → slides.html (1920x1080, numbers read from the run
  files) → `video/contest/build/slides/*.png`.
- `node video/contest/rec-sim.mjs [open|realgit|cloud]` → phone scenes from qodebase.app/sim/run
  (rig.mjs, now on qodebase.app; `QB_SITE` overrides) → `video/frames/contest-*`.
- `python3 video/contest/cut.py` → `video/out/qodebase-contest.mp4` + `.srt` (scene list =
  SCRIPT in cut.py, mirrors storyboard.md; ~1 min to render).
- Captions alone run faster than a voice-over: draft 1 was 4:10 before holds were added on
  charts and demo scenes got their storyboard lengths.

No model calls in recordings beyond what the demo already uses. Videos are mp4, never GIF.
