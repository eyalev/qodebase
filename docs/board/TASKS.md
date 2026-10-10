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
- [x] W4a lab scenario: self-pick backlog + two teams, hidden tests (qb5): scenarios `backlog` (7b915e9) + `two-teams` (0ef85bb), 30 hidden tests + duplicates.builtTwice in score.mjs, validated on qb9 round-1 repos (A 4/4/3 pairs built twice, E 0/0/0); router hooks with qb6
- [x] W4b prediction (qb4): W3a in sim.md (d); W4 board off vs on in sim.md (e) + predict.js lab-0.11 (scenarios backlog, two-teams; variant `board`, `crossDedupe`)
- [ ] W4c Cloudflare runs board off vs on >= 3 each (qb6 runner): runner ready, plan public/lab/board-w4-plan.json (18 runs, ~$42 API-equiv predicted), waiting for the manager's GO
- [x] W7a congestion control (AIMD on board thrash) modelled + prediction before the runs: sim.md (f), sim/board/aimd.mjs (qb4)
- [x] W7b real runs (qb9): AIMD wall x2.1, cost -54%, cap 3-4; fixed 8 wall +21%, cost -44%; no collapse at 20 (E6-results.md W7)
- [ ] W7c compare with sim.md (f): collapse or not (qb4)
- [ ] W5 README / submission / lab page (qb8, qb7)
- [ ] W6 FINDINGS2.md + report (manager)
Guard: LLM runs stop at weekly meter 87% (73% at start).
