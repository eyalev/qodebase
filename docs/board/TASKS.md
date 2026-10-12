# Agent board — tasks (manager s1007-1655)
Round 1 (done, FINDINGS.md): E1a-E5 [x].

Round 2 (PLAN2.md, started 2026-10-10 17:00 UTC):
- [x] W1 prior art / novelty -> prior-art.md (manager research agent)
- [x] W2a board in Landing DO: log, now, recent, who API, platform posts, flag `board` (qb6, 244a3cf)
- [x] W2b box hook + `forq who`/`intent`/`dedupe` in boxes; dedupe reads every team's list with crossDedupe (qb6, 244a3cf..668aba4)
- [x] W2c "Agents at work" shows the board live (qb7, e407afa + e27cac2, live in forq 64f0f5e8): who's doing what now, shared files noted, same task asked twice, finished folded; verified live on eyal/cafe-lab at 390 px; to re-check on a running W4 board-on project
- [x] W2d deploy + live smoke on eyal/cafe-lab (qb6): spawn→intent→editing→committed→pushed→approved→queued→landed on the board; dedupe found the pair from the agent's shell
- [x] W3a 20 agents / 60 tasks Haiku A vs E x3 (qb9): v1 (3-4 tasks lost: board trusted unlanded done) -> fixed v2: wall -24%, cost -16%, dup 9->0, 60/60 (E6-results.md)
- [x] W3b Sonnet longer tasks A vs E x3 (qb9): board v3, wall -31%, cost -27%, 16/16 both; Sonnet tasks <1 min each (s5 pending manager)
- [x] W3c (dropped by Eyal, 2026-10-11: budget) s5 (12 library-sized tasks, ~2.2x s4) 8 Sonnet A vs E x3 (qb9): built + verified (0ea4228, lab-hidden b15434f); queued after W9b in chain3
- [x] W4a lab scenario: self-pick backlog + two teams, hidden tests (qb5): scenarios `backlog` (7b915e9) + `two-teams` (0ef85bb), 30 hidden tests + duplicates.builtTwice in score.mjs, validated on qb9 round-1 repos (A 4/4/3 pairs built twice, E 0/0/0); router hooks with qb6
- [x] W4b prediction (qb4): W3a in sim.md (d); W4 board off vs on in sim.md (e) + predict.js lab-0.11 (scenarios backlog, two-teams; variant `board`, `crossDedupe`)
- [x] W4c Cloudflare runs board off vs on, 3 each x 6 cells (qb6): docs/board/w4c-results.md
- [x] W7a congestion control (AIMD on board thrash) modelled + prediction before the runs: sim.md (f), sim/board/aimd.mjs (qb4)
- [x] W7b real runs (qb9): AIMD wall x2.1, cost -54%, cap 3-4; fixed 8 wall +21%, cost -44%; no collapse at 20 (E6-results.md W7)
- [x] W7c compare with sim.md (f): collapse or not (qb4)
- [x] W5 README / submission / lab page (qb8, qb7): qb8 drafted the 'Agent board' section in README + submission from FINDINGS2 sections 1-2 / E6 (committed, not deployed); Cloudflare medians = placeholder until the manager confirms round 3
- [x] W6 FINDINGS2.md + report (manager)
Guard: LLM runs stop at weekly meter 87% (73% at start).

Round 3 (Eyal, 2026-10-11 ~04:00 UTC: "start the prediction and setup now, and do the runs as well"):
- [x] W8a throughput-probing controller (add agents while landings/min rise, step back when flat/falling, halve only on dropped work) modelled + prediction before runs (qb4, sim.md (g)): sim.md (g), sim/board/probe.mjs
- [ ] W8b real runs, Haiku, x3: fixed 8 / 20 / 40, controller with board, controller without board; long backlog; reuse identical earlier runs only if code+flags identical (qb9): harness + s6 (150 generated tasks) built 5db5093; runs queued (chain3), most after the Oct 12 reset
- [x] W9a dynamic workload: tasks arrive over the run (Poisson), incl. reworded duplicates of done/in-progress work; per-arrival dedupe vs upfront-only vs none; prediction first (qb4, sim.md (h)): sim.md (h), sim/board/arrivals.mjs
- [ ] W9b real runs x3 per condition, ~10 agents; then controller + arrivals combined if the meter allows (qb9): s7 (30 + 30 arrivals, 10 twin pairs) built 5db5093; queued after W8b
- [ ] W9c per-new-task dedupe in qodebase's board (qb6, after W9b shows it pays)
Guard: stop at weekly meter 87% (83% at start); what doesn't fit continues after the Oct 12 13:00 UTC reset. s5 Sonnet stays armed for after the reset.
- [x] W10 review fixes in qodebase (qb6): task ids only from registered lists, aliases/lists router-only, heartbeat keeps claims live, atomic `forq next` behind flag claimNext (+ runner knob claimNext); 27 tests

Contest fixes from the judge-style review (2026-10-12; findings outside the repo: ~/.local/share/qodebase-review/FINDINGS.md), due Oct 13 18:00 UTC:
- [ ] C1 /own installs an Oct 7 release without Landing/MergeBox/board: rebuild + one fresh install test, or reword (qb6)
- [ ] C2 home page: card to corner-cafe Watch a run + Lab/Sim; unlist forq.* and stale projects (qb7)
- [ ] C3 demo honesty: 'auto-approved (scripted)', real run length, end run when queue empty, 'landed today' window (qb7, qb6)
- [ ] C4 submission rewrite ~900 words: originality first vs existing merge queues; cafe-team as real-agent proof; lab/sim wording (qb8)
- [ ] C5 per-IP watch cap, /health.json, install script 'pi', llms.txt (qb6)
- [ ] C6 manager re-checks everything live at 390 px before Eyal submits

Build settings + estimate (Eyal, 2026-10-12 ~14:00 UTC: "Yes"). Default "Build it" unchanged; "Adjust" opens presets + knobs with a live estimate; optional assistant suggests settings from the prompt. Behind a flag; on for everyone only if it passes 390/1440 checks by Oct 14 12:00 UTC.
- [x] B1 predictor for builds: predict.js takes (task count, overlap, difficulty) + variant -> time/cost ranges, "based on N runs"; quality only as a direction (qb4): predictBuild/BUILD_PRESETS/suggestBuild in public/lab/predict.js, docs/board/build-estimate.md
- [x] B2 UI: "Adjust" sheet under Build it: 3 presets (Fastest / Balanced / Cheapest) + agents, agent model, reviewers, board; live estimate; phone first (qb7) — done 7148956 + ac80c90 (critique fixed); waits for B3 + the flag
- [ ] B3 wiring: Build applies the chosen variant (landing on, flags like the lab runner), behind flag buildSettings (qb6)
- [ ] B4 assistant: "Suggest settings for my prompt": one Haiku call -> task estimate + preset + one-line why (qb4 + qb6), v1.5
- [ ] B5 manager live check, then flag on (or stays off)
