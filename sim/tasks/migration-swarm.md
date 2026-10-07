# Migration swarm (owner: qb4) — 2026-10-07

## Why
The Bun Zig->Rust port (bun.com/blog/bun-in-rust; 64 Claude agents, 11 days, 6,755 commits)
shows what "thousands of agents" work really looks like: ONE big goal split into thousands
of small tasks, the work list coming from a machine signal (files to port, compiler errors,
failing tests), phases gated by a check, each file owned by one agent, adversarial review.
Our Hono replay showed that with real code the problem is ORDERING (a change needs another
that has not landed), not text conflicts. A migration swarm tests exactly that, on real code,
fast, with no model calls.

## What to build (sim/swarm/)
1. A real repo (Hono, already cloned at ~/projects/github/honojs/hono with node_modules) and a
   big mechanical goal done by scripted codemods per file, e.g. (pick 1-2, explain why):
   - move a widely used type/helper to a new module and update every import;
   - rename a core exported API everywhere (definition, re-exports in src/index.ts, users);
   - add a parameter through a call chain (definition first, then every caller).
   Each task = one file (or one small group). Real dependencies: the definition must exist
   before users compile; shared files (src/index.ts, src/types.ts, package.json exports)
   are touched by many tasks.
2. Judge: tsgo type check (0.6 s) + optionally a test subset. Same rule as the replay:
   only count errors the starting tree did not have.
3. Policies to compare (same seed, same task list), at 10 / 100 / 1,000 agents:
   - free-for-all: every task starts on the current main, lands when done (redo on conflict/break);
   - phases with gates (Bun's way): definitions, then users, then shared files; next phase
     only when the check is green;
   - dependency map + stacking: tasks declare needs/provides (derived from the codemod),
     a task may build on an UNLANDED change it needs and land right after it;
   - land by intent for the shared files (the codemod is the intent: re-run it on the
     latest main instead of merging text).
   Measure: time to finish the whole migration, agent time wasted (redo, waiting), how
   many landings broke the check, how long main stayed red.
4. Calibrate with Bun's real numbers when qb5 has them (sim/bun/calibration.json:
   files per commit, commit rate, hot-file concentration, phase shape). Use them, cite them.
5. Output: bundles for the run viewer (public/sim/runs/swarm-*.json, same schema as hono-w*),
   a README section, numbers in commit messages. Logs as JSONL.

## Rules
- Commit only your files by explicit path. sim/bun/ belongs to qb5.
- Deploy forq only from a clean worktree of the live sha + public/sim, after `wrangler
  containers list` shows no live agent boxes and after telling qb2 (cc_com.py send qb2 ...).
- No model calls. Keep each run under ~15 minutes; cap retries (a run must end).
