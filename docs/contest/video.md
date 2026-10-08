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
- [x] Manager review of draft 1 applied (2026-10-07): product first (cold open on the phone,
      demo by ~2:20), measurements ~50 s, slide text ~2x (legible at 50%), Bun neutral, the
      "not GitHub with agents on top" line, claims agreed with qb6 (storyboard "Rules").
- [x] qb5's evidence charts in (hono-ordering, bun-swarm, realcode-500, cloudflare-500).
- [x] Voice-over: Aura-2 (`draco`) via Workers AI + AI Gateway qodebase-talk, cached per line
      in build/vo/, ledger build/vo/ledger.jsonl (~$0.12 so far); captions stay.
- [x] Draft 2 (2026-10-08, 5:34, narrated): live corner-cafe take 3 (14/14 in 203 s), drill-downs
      picked from the run's records -> manager.
- [x] Draft 3 review notes (2026-10-08): zoomed phone on 2x frames, cold-open count read from
      the page, swarm chart for Bun, close card links; busy on cafe-busy; judge take via Watch a run;
      crew run (12 real Haiku 5.5 agents) started by Talk.
- [x] Draft 3 review (2026-10-08): cafe-team re-shot from qb7's client replay (?replay=4, agents
      renumbered 1..12, no new run) after the real Talk send; captions end before the page changes and
      the shot holds until the sentence ends (rig.clear(), clear_before_tap); every phone line checked
      against its frames. Picture locked. Audio -16.6 LUFS, true peak -1.3 dBFS.
- [x] Export: video/out/qodebase-contest.mp4 (CRF 18, 23 MB) and the upload copy
      video/out/qodebase-contest-upload.mp4 (CRF 14, H.264 High 1080p30 + AAC, 28 MB, 7:35) + .srt.
- [ ] (superseded) Still to film (placeholders in cut.py `todo`): busy mode for the cold open (20 scripted
      agents, ~46 landed/min, say scripted); the AI replay demo (7.8 s, ~1 cent); real agents on
      eyal/cafe-real (Claude Haiku 5.5, verified, 5.5 min); Talk steering; notes in the code browser.
- [ ] Submission texts: draft 1 in docs/contest/submission.md; [final] lines after Oct 10.
- [ ] README polish (quick start, screenshots, the measurements) on Oct 12.
- [ ] Waiting on: variants lab results (docs/lab/PLAN.md, qb4-qb7) and OpenClaw FINDINGS.md (qb9)
      -> README + submission lines. Video stays locked unless a result is ready and honest.
- [ ] Hand each cut to the manager tab for review (cc_com send s1007-1655 or tell Eyal).
## Build (video/contest/)
- `node video/contest/shoot-slides.mjs` → slides.html (1920x1080, numbers read from the run
  files) → `video/contest/build/slides/*.png`.
- `node video/contest/rec-work.mjs [open|demo|live]` → the product on the phone (`live` resets
  and starts a scripted run on eyal/corner-cafe: tell qb6 first). `rec-sim.mjs` (sim viewer) is unused now.
- `node video/contest/rec-sim.mjs [open|realgit|cloud]` → phone scenes from qodebase.app/sim/run
  (rig.mjs, now on qodebase.app; `QB_SITE` overrides) → `video/frames/contest-*`.
- `python3 video/contest/cut.py` → `video/out/qodebase-contest.mp4` + `.srt` (scene list =
  SCRIPT in cut.py, mirrors storyboard.md; ~1 min to render).
- Captions alone run faster than a voice-over: draft 1 was 4:10 before holds were added on
  charts and demo scenes got their storyboard lengths.

No model calls in recordings beyond what the demo already uses. Videos are mp4, never GIF.
