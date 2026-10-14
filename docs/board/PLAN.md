# Agent board — does a shared "who is doing what" log have real value? (2026-10-10)

Eyal's idea (2026-10-10): a central, fast place where agents say what they are working on
(append log, maybe no locks), so they have context on each other. Eyal is away a few hours;
the manager (s1007-1655) runs experiments to find out whether it has real value.

## The design under test
- **Append-only log** of one-line events: {ts, agent, kind, intent, files/area, status}.
  kinds: started, editing, committed, blocked, landed, done, gave-up.
- **"Now" view** derived from the log: one entry per agent, expires unless renewed (heartbeat/TTL),
  so dead agents disappear.
- **Advisory, never a lock.** Ask by file/area ("who touches src/routes.ts?"), at start and before landing.
- **Posted automatically by hooks**, not by agent discipline: Claude Code UserPromptSubmit (task),
  PreToolUse Edit/Write (file, debounced), PostToolUse git commit/push, Stop (done). The same hooks
  feed back a few relevant lines as context (others on my files).
- **Backend:** one Durable Object per repo/team (SQLite log + WebSocket push + alarm for TTL).
  Not Workers KV (writes take up to 60 s, min 30 s with cacheTtl, to reach other locations; last write wins).

## Experiments
- **E1 Board service** (qb6): `board/` Worker `qb-board` — DO with SQLite log, now-view with TTL,
  WebSocket push, HTTP post/query, bearer token. CLI `board post|who|tail` with two backends
  (local JSONL file, HTTP). Claude Code hook script. cloudcost gap entry the day it is deployed.
- **E2 Latency** (qb6): measured write->visible and push latency for the DO board vs KV
  (same-location and cross-location reads), N=100+. Numbers, not docs.
- **E3 Zero-token value estimates** (qb4): (a) Hono replay: if each PR's intent+files were announced
  when work started, how many of the "needs an earlier PR" cases could be seen in advance (ordered or
  stacked instead of bounced)? (b) a scripted decentralized-backlog sim (agents pick their own tasks from
  a backlog with duplicates and dependencies) with and without a board: duplicates, conflicts, waits.
- **E4 Real agents A/B** (qb9): small real repo + a backlog (~16 tasks: duplicate pairs worded
  differently, dependency chains, shared hot files) + hidden tests. 4-6 Haiku agents via `claude -p`
  in their own clones, pushing to one shared bare repo, picking their own tasks.
  Conditions: A no board; B board via hooks (automatic posts + context fed back); (C, if budget allows)
  board as a CLI the agent is told to use, no hooks. Measure: tasks done, duplicate implementations,
  push rejections/rebases, red main, hidden tests, wall time, tokens. 2-3 reps each.
- **E5 Write-up** (manager): FINDINGS.md with numbers + recommendation (build / don't / how).

## Guards (weekly meter is the binding constraint)
- The weekly quota meter is the binding constraint.
  **All LLM experiment runs stop at 77%.** Tabs: be token-frugal (no long explorations, short replies).
- E4 uses Haiku 5.5 only, on the subscription (`claude -p`), never other projects' keys.
- Real spend cap $5 (DO + KV for the bench). Never print secrets. No pkill/killall by pattern.
- Commit by explicit path; this repo is public: no tokens in files.
