# Agent board — tasks (manager s1007-1655)
Round 1 (done, FINDINGS.md): E1a-E5 [x].

Round 2 (PLAN2.md, started 2026-10-10 17:00 UTC):
- [x] W1 prior art / novelty -> prior-art.md (manager research agent)
- [ ] W2a board in Landing DO: log, now, recent, who API, platform posts, flag `board` (qb6)
- [ ] W2b box hook + `forq who` in boxes + dedupe pass at planning (qb6)
- [ ] W2c "Agents at work" shows the board live (qb7)
- [ ] W2d deploy + live smoke on eyal/cafe-lab (qb6)
- [ ] W3a 20 agents / 60 tasks Haiku A vs E x3 (qb9): harness + s3 starter + hidden tests done (dc2154b, lab-hidden 8a2943a; smoke dedupe 10/10); runs started 16:59 UTC
- [ ] W3b Sonnet longer tasks A vs E x3 (qb9)
- [x] W4a lab scenario: self-pick backlog + two teams, hidden tests (qb5): scenarios `backlog` (7b915e9) + `two-teams` (0ef85bb), 30 hidden tests + duplicates.builtTwice in score.mjs, validated on qb9 round-1 repos (A 4/4/3 pairs built twice, E 0/0/0); router hooks with qb6
- [x] W4b prediction (qb4): W3a in sim.md (d); W4 board off vs on in sim.md (e) + predict.js lab-0.11 (scenarios backlog, two-teams; variant `board`, `crossDedupe`)
- [ ] W4c Cloudflare runs board off vs on >= 3 each (qb6 runner)
- [x] W7a congestion control (AIMD on board thrash) modelled + prediction before the runs: sim.md (f), sim/board/aimd.mjs (qb4)
- [ ] W7b real runs: E fixed 20 vs E AIMD vs E fixed 8 (+ A fixed 20 vs A AIMD if the meter allows), log cap + thrash per minute (qb9)
- [ ] W7c compare with sim.md (f): collapse or not (qb4)
- [ ] W5 README / submission / lab page (qb8, qb7)
- [ ] W6 FINDINGS2.md + report (manager)
Guard: LLM runs stop at weekly meter 87% (73% at start).
