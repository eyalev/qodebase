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
- [x] W8b real runs, Haiku, x3 (qb9): core done 2026-10-12 (A/E x fixed 40/probe, docs/board/E7-results.md); controls: A8 x1 only, A20 not run (hard stop at meter 25)
- [x] W9a dynamic workload: tasks arrive over the run (Poisson), incl. reworded duplicates of done/in-progress work; per-arrival dedupe vs upfront-only vs none; prediction first (qb4, sim.md (h)): sim.md (h), sim/board/arrivals.mjs
- [x] W9b real runs x3 per condition, 10 agents (qb9): s7 (30 + 30 arrivals, 10 twin pairs), done 2026-10-12, docs/board/E7-results.md; combined controller + arrivals not run (budget)
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

Screenshots + pick an element in the app (Eyal, 2026-10-12 ~16:00 UTC):
- [ ] S1 attach images (gallery/camera) to the composer, several, removable chips; stored in R2; sent with the request; the agent's box gets the files and the prompt names them (qb6 server, qb7 UI)
- [ ] S2 "Pick" on the App view: tap an element in the running app -> chip with what it is (text, tag, CSS selector, short outerHTML), outlined; via a small picker script the app host injects only in pick mode (postMessage) (qb6 inject, qb7 UI)
- [ ] S3 "Screenshot" button: Cloudflare Browser Rendering captures the app at 390 px (with the picked element outlined) and attaches it (qb6); cloudcost line the day it ships
- [ ] S4 mark up a screenshot: circle/arrow/highlight on the attached image before sending (qb7), after S1-S3

Idea generator by project size (Eyal, 2026-10-12 ~17:40 UTC):
- [x] I1 sizes = the predictor's buckets: Small (1-4 pieces), Medium (5-11), Large (12-29), Huge (30+), each with its typical time/cost from predictBuild; curated list of ~8 ideas per size, phone-relevant, varied domains (qb4). Done: predict.js `ideaSizes()` (label, bucket, preset, settings, wallS, apiUsd per size, memoised); the one curated list is qb6's CURATED_IDEAS (src/buildsettings.ts, 60aaa34)
- [ ] I2 POST /api/build/idea {size, seed?} -> {title, prompt, size, job facts} in one small-model call (Workers AI like suggest), validated against the size; caps like suggest; curated fallback on any failure (qb6)
- [ ] I3 UI under the box: 'Need an idea?' + size chips (Small/Medium/Large/Huge, each with ~time/~cost) + 'Another'; picking fills the box and applies the suggested settings (same path as Suggest, no second call), settings row updates (qb7)

Lanes: scaling to hundreds/thousands of agents (Eyal, 2026-10-12 ~18:15 UTC: "go ahead"). Thesis: the limit is one landing door (one main queue); scale by many independent landing lanes (a queue per area) + a throughput controller per lane + hot files designed out; cross-area changes through a coordinated lane. Measure changes landed per hour, collisions, wasted work, broken main, vs agents and lanes.
- [x] L1 prediction first (qb4, fast sim, zero tokens): 1 shared queue vs N lanes (1..256), agents 10..10,000, cross-area share 0-20%, controller per lane; where does each saturate; written to sim.md (i) before L2/L3 Done: sim.md (i), 81a4e55 (832 cells, 16 h steady state, laptop 392 s; no VM needed); L2 and L3 cells in (i).
- [ ] L2 sim/real with lanes (qb5): real code, real git, real tests, scripted agents; 1 queue vs 8/32 lanes at 500 and 2,000 agents; runs AFTER qb9's W8 finishes (laptop CPU), est. ~22:30 UTC
- [ ] L3 Cloudflare (qb6): sim/cloud harness (separate Worker, not prod Landing): a landing DO per area, rerun the 500-agent run with 1 vs N lanes, then 2,000+ agents if it holds; scripted agents, no model; real-money cap $30; cloudcost gap
- [ ] L4 write-up: FINDINGS lanes section, /how card, README + submission (manager, qb8), by Oct 14 12:00 UTC

Run timeline (Eyal, 2026-10-12 ~19:00 UTC): one view of a whole run as a trace/Gantt: rows = parts of the system, x = time; overview + drill-down; what took the most time, the bottleneck, what ran in parallel.
- [ ] T1 data: every span with start/end: router planning, per agent (working, pushed->review wait, review, queued wait, in train, landed/bounced), reviewers, each train (start, end, changes), merger phases (wake/cold start, fetch, apply/replay per change, checks, push, notes); GET .../landing/timeline (qb6)
- [ ] T2 UI 'Timeline' (Agents at work tab or its own): swimlanes (Planner, Agents group collapsible -> one row each, Reviewers, Queue, Merger, Main ticks), colour per phase, concurrency strip on top (agents busy over time) + queue-busy %, auto 'where the time went' summary (share per phase, critical path highlighted, the bottleneck named in plain words), pinch/drag zoom with an overview brush, tap a span -> details sheet; phone first (horizontal scroll + zoom), desktop wide (qb7, with qb3's Mobbin refs for trace/Gantt views)
- [ ] T3 works on corner-cafe demo runs, real builds and lab runs; preview link for Eyal before deploy

Bun migration simulation (Eyal, 2026-10-12 ~19:50 UTC: go): coordination of Bun's real Zig->Rust port (oven-sh/bun#30412, ~64 Claude agents, 6,755 commits) re-run with qodebase's ways of landing; work mocked, structure real (file tree, task stream, phases, rates from sim/bun/calibration.json).
- [x] BUN1 build: Bun's tree + task stream (tasks from commit subjects/phases, files touched, gates between phases), agent work times from Bun's rates; prediction written first (qb4)
- [x] BUN2 runs at 64 / 640 / 6,400 agents: Bun's own method (one shared branch, file/line-range ownership) vs one merge queue vs lanes by area + per-lane controller vs lanes + hottest files split; measure time to finish, agent-hours, collisions, idle, where phase gates cap it (qb4). Done 2026-10-12: sim.md (j) prediction + results; bun's own method fastest (31-36 h), one queue 73-89 h, lanes+split best queue design (55 h at 640); gates cost ~1/3, ownership granularity is the main cap
- [ ] BUN3 optional real-git replay of the winning setup on a VM (qb5, after L2)
- [ ] BUN4 write-up: a /how card + README/submission lines (manager, qb8)
Where it runs: a small trial at nice 19 on the laptop for a time estimate; the full sweep on the laptop after qb9's W8 ends (~23:00 UTC) if it's < 1 h, else on a VM (L2's VMs free up first; the project's 32-vCPU cap is full now).

GitHub-shaped, agent-first (Eyal, 2026-10-12: "yes, build items 2-5" of docs/contest/github-parity.md), target live Oct 13 18:00 UTC:
- [ ] G2 History: each landed commit opens its change record (intent, review, tests, how it landed), one-line 'why' under each commit (qb7 UI, qb6 data)
- [ ] G3 file view: 'Changed by N changes, M collisions' -> that file's changes by intent (blame by intent) (qb3)
- [ ] G4 Asks per project: router requests + board tasks with state, agent, duplicates/aliases (the agent-age issues list) (qb3 UI, qb6 endpoint)
- [ ] G5 'Ask for changes' on a change record: the owner's own note sends the change back to its agent (extends the fix verb) (qb6 server, qb7 UI)
- [x] BUN5 re-cut by module (Eyal, 2026-10-12): merge consecutive commits on the same lines into one task per module (port + compile + test as one owner's task), module order from the real crate/module structure (use/mod/import graph), re-run 64/640/6,400 agents; same calibration; prediction first (qb4 sim), then real-patch check of the critical path on a VM if useful (qb5). Question: did the decomposition, not the agent count, set Bun's speed? Done 2026-10-12 (qb4): sim.md (k); interfaces-first 3.4-5.2 h at 64 agents (5-8x faster than BUN3), flat past 64; strict 89 h (74% of work in one use-cycle)
- [ ] EV1 Artifacts event subscriptions -> a Cloudflare Queue -> the Worker's queue() handler -> Landing/board/timeline: any push (agent or a person's plain git push) is recorded; pushes to a fork of a project with landing on can join the queue; cloudcost line for the Queue (qb6, Eyal 2026-10-12)

Real builds, staircase (Eyal, 2026-10-12 ~22:00 UTC: "go for it"); meter stop for these: 35% (manager's pick, Eyal can change); every run has a Landing budget (halts all boxes) and an owner Stop button:
- [x] R0 board ON by default for team presets (Balanced, Cheapest), off for Fastest; estimate note 'board effect not measured for planned teams' (qb7 + qb4). qb4 part done 2026-10-12: board:true in both team variants, suggestBuild no longer returns board, the note in predictBuild; qb7 checks the sheet
- [ ] R1 Stop/Pause for the owner on Agents at work: Pause = no new tasks/trains; Stop = halt (stop every box); visible while a run goes (qb6 + qb7)
- [ ] R2 small: 'Need an idea? Small' default Build (one Opus agent), budget $3 — checks the default path end to end (estimate bar, auto-land, timeline, Asks)
- [ ] R3 large: a Large idea with Balanced (Opus planner + 12 Haiku + 3 reviewers, board on), budget $8
- [ ] R4 20 real agents (Huge idea), budget $12 — checks container limits at that scale
- [ ] R5 flagship 40-60 real agents, budget $30, only if R4 is clean; made public for judges at the end if good (Eyal decides)

Build experience at every size (Eyal, 2026-10-13: "do all 5"); goal = soonest working app, good quality, sensible cost, clear progress. Target live Oct 14 06:00 UTC:
- [ ] X1 something working early: the planner's first task is a runnable skeleton (app shell, routes, empty views) that lands first; feature tasks build on it; the App tab shows the live app from the first landing (qb6 router prompt + plan order, qb7 App view)
- [ ] X2 clear progress + finish estimate on the project page: 'N of M parts landed, about K min left' from the plan + the estimate bar, updated live (qb7, qb4 for the remaining-time model) . qb4 model done 2026-10-13: remainingS/remainingTime in predict.js, docs/board/build-estimate.md 'Time left'
- [ ] X3 notify when done (and when a decision is needed): push to the owner's phone (web push or the existing alert path) + an Inbox item; opt-out in Settings (qb6 server, qb7 UI)
- [ ] X4 review keeps up in big builds: reviewers scale with agents (e.g. 1 per 5 coders, up to 8), reviews run in parallel, and the merger replays collisions in parallel within a train (qb6)
- [ ] X5 fewer interruptions: agents ask the person only for real decisions (secrets, money, a change that keeps failing); everything else decided and logged (router + agent prompts, qb6); Asks shows decisions taken on the person's behalf (qb3)
