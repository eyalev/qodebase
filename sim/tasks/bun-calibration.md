# Bun agent-history calibration (owner: qb5) — 2026-10-07

## Why
The Bun Zig->Rust port is public as PR oven-sh/bun#30412: 6,755 commits written by ~64 Claude
agents in 11 days (refs/pull/30412/head; the branch itself is deleted). It is the only real
large multi-agent commit history we know of. Our simulations guess at agent behaviour;
this turns guesses into measured numbers that qb4's migration-swarm sim (sim/tasks/
migration-swarm.md) and the fast sim can use.

## Data already here
~/projects/github/oven-sh/bun-pr30412 — a blobless fetch (commits + trees, no file contents,
35 MB). Range: 0d9b296af33f..refs/pr/30412 (6,755 commits, 276 merges). Agents commit as
"Jarred Sumner"; streams can only be inferred (branch merges like claude/unsafe-5k, phase
prefixes like phase-d(unsafe), phase-e(port), timing). Bun is MIT.

## What to produce (sim/bun/)
1. A script (sim/bun/analyze.mjs) that writes sim/bun/calibration.json and prints a summary:
   - commits per hour over time, by phase prefix; phase shape (what ran in parallel);
   - files per commit (median/p90/max), lines per commit if cheap (`--stat` needs blobs:
     fetch blobs only if needed and say what it cost);
   - hot files: concentration (top 1% of files take what share of commits);
   - "collisions": how often two commits within N minutes touch the same file, as a
     function of N; how often the same file is touched by different branches before they merge;
   - the merge graph between claude/* branches: how often, how big, any conflict-fix commits
     right after merges (subjects like "fix merge", "restore ... dropped by").
2. A short findings section in sim/README.md (or sim/bun/README.md) with the numbers, and
   what they imply for our policies (claims on hot files? phase gates? land by intent?).
3. Optional, ask Eyal first: fetch file contents and replay the agent branches' merges to
   count real text conflicts.

## Rules
- Read-only on the Bun data; do not push anything anywhere but our own repo.
- Commit only your files by explicit path (sim/bun/, the README section). qb4 owns sim/swarm/.
- No model calls; keep it to scripts that finish in minutes.
