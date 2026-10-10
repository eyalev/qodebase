# Agent board, round 2: build it into qodebase and prove it on Cloudflare (2026-10-10)

Eyal (17:00 UTC Oct 10): "if it's good, incorporate it into qodebase... do everything needed for the
contest... prove with actual data that this feature is worth it... big tests are OK... real stuff on
Cloudflare, not only simulation... and find out whether something like this already exists."
Round 1 answer (FINDINGS.md): yes, with 10 agents -28% time / -29% cost at equal quality, in the shape
"stated intent + finished work in queries + one dedupe pass, advisory, merge gate kept".

## Workstreams
- **W1 Prior art / novelty** (manager's research agent): what exists (Claude Code agent teams, MCP Agent Mail
  file reservations, Cursor/Devin/Copilot background agents, claude-squad, vibe-kanban, Conductor, Sculptor,
  blackboard systems, research papers on multi-agent coding coordination). What is new in ours. docs/board/prior-art.md.
- **W2 Board in qodebase** (qb6 owner; qb7 UI): the board lives in the project's Landing DO (it already
  records intent + claims at spawn and warns on overlap). Add:
  - an event log + "now" view (TTL) + `recent` (finished in the last 30 min), queried by file/area;
  - posts from the platform at spawn / push / review / land / bounce, plus the board hook inside every box
    (edits -> files, commits), so agents need no discipline;
  - `forq who [--recent] [--files a,b]` (and `qb board` for people) and the stated-intent post at spawn;
  - one dedupe pass (Haiku) over a task list when work is planned or a backlog is handed out -> aliases;
  - WebSocket push to the "Agents at work" view (who works on what, live, phone first);
  - landing flag `board: true|false` so the lab can A/B it; default on once proven.
  Tests: real git, no Cloudflare (`src/landing/*.test.mjs`), then a live smoke on eyal/cafe-lab.
- **W3 Bigger real-agent test, local** (qb9, `claude -p`, harness sim/board-ab): 20 agents, ~60 tasks
  (10 far-worded duplicate pairs, dependency chains, hot files) A vs E x3; then 8-10 **Sonnet** agents on
  longer tasks A vs E x3 (where a duplicate costs minutes). Hidden tests in lab-hidden.
- **W4 Real test on Cloudflare** (qb5 scenario + hidden tests, qb6 runner flag, qb4 prediction): a lab
  scenario where a planner cannot dedupe for you: agents self-pick from a shared issue list, and a
  "two teams, one repo" variant (two routers with overlapping backlogs). Real qodebase boxes
  (Cloudflare Containers), the real landing queue, hidden tests on the laptop. board off vs on, >= 3 runs each.
- **W5 Contest** (qb8 docs, qb7 lab page): README + submission section with the measured numbers; the board
  visible in the demo project; lab page entry. Only measured claims.
- **W6 Manager**: meter watch, verify every number before it is published, FINDINGS2.md, report to Eyal.

## Guards
- Weekly meter 73% at 16:50 UTC Oct 10, resets Oct 12 13:00 UTC. **LLM experiment runs stop at 87%.**
  Tabs: be frugal with your own (Opus) turns too; the meter counts them.
- Agents in experiments: Haiku by default; Sonnet only in W3's second half. On the subscription (`claude -p`)
  or qodebase's own boxes; never other projects' keys. Real-money cap for this round: $30 (Cloudflare + any API).
- Methodology as before: hidden tests private; runs with a stall or a human touch are excluded from time;
  medians; Mann-Whitney; report what the data says, including null results.
- forq deploys go through qb6 from a clean worktree after checking running containers; tell qb2's area
  (talk) is untouched. No pkill. No secrets in files or logs. Commit by explicit path.
