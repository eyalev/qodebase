# Fleet section: texts (P2, owner qb8)

Status: updated 2026-10-13 from `public/results.json` (fleet.totals.byJob.docs: 27 runs, 31,466 landed, $19.09; fleetCached) and `docs/board/sim.md` (l)
(S4a-S4e cached ladder, S5 real-model runs). The README block and the submission bullet are the published texts; this
file keeps the rules and the /how card.

Wording rules:
- Quote `fleet.totals.byJob.docs` for the fleet number; `fleet.totals` also counts the index job and the code-dial (kata) runs.
- "agents" are Durable Objects calling a cheap model, not Claude. Gemini 3.1 Flash-Lite landed 16,852 of the 31,466,
  so never say "Workers AI models" alone for the whole fleet.
- 31,466 is file CHANGES landed over 27 runs, not distinct files: VS Code src/vs was re-documented on fresh copies
  (24,850 of them). Distinct repos: VS Code src/vs + extensions, Next.js, Angular, Babel, Nest packages.
- Cached-answer runs (comments reused by content hash, no model call) are never added to the model totals; quote them
  as "our side alone".
- "The code is unchanged" is mechanical; it says nothing about comment quality (hand check: 109 of 115 right).
- The limit claim is now measured: with real models ~114 files/s (S5 v2b), ~5% of the ~2,100 files/s our side carried
  with cached answers (S4d). The first model wall was gemma's 3040; documented per-model limits were wrong both ways.

## /how card (for qb3)

Title: **A fleet of cheap models**
Big number: 31,466 file changes
Text: Agents calling cheap models (Workers AI, and Gemini Flash-Lite through the same gateway; no Claude) wrote
documentation comments in six real codebases, including VS Code, Next.js and Angular: 31,466 file changes landed for
$19.09, up to ~114 files a second. Each change was checked to leave the code itself unchanged before it landed: none
was refused. A hand check of 50 files found 109 of 115 comments right. With answers reused from a cache, 4,750 agents
landed 63,441 changes in under 3 minutes, flattening near ~2,100 files a second on Artifacts' shared reads: with real
models, the models are the limit.
Label: measured on Cloudflare; Durable Object agents, cheap models, no Claude; our own copies of the repos; VS Code
src/vs documented again on fresh copies for the scale runs; 2026-10-13.
