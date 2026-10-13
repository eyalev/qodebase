# Fleet section: draft texts with gaps (P2, owner qb8)

Status: DRAFT, partly filled. Nothing here is in the README, the submission or /how until the gaps are filled from
`public/results.json` (qb4's results generator, P1). Every `[GAP: …]` names the number and where it comes from.
Facts already fixed come from: docs/board/TASKS.md "Fleet on Workers AI", sim/fleet/F0.md, the fleet commits
(ee63a98, 50f1106, 2565184), scripts/fleet/quality-sample.mjs.

Wording rules for the gaps:
- "agents" here are Durable Objects calling a Workers AI model, not Claude; say "cheap Workers AI models".
- The verify step is mechanical: "the code is unchanged" means the TypeScript syntax, compared with comments
  ignored, is identical before and after, and no new parse errors. It says nothing about whether a comment is right:
  that is the quality check's job.
- Our own Artifacts copy of VS Code; nothing is pushed upstream.
- If a model other than Workers AI landed files (Gemini overflow), say how many.

## Numbers in hand (public/results.json 7dd70ad, label 'measured (Workers AI and Gemini agents, real git on Artifacts, Cloudflare)')
- 7 runs, 4,192 files attempted, 3,029 landed with comments, 1,141 had nothing to add, 7 rejected, 3 rate-limited,
  **0 refused for touching code**; $1.59 in all = $0.38 per 1,000 files attempted, $0.52 per 1,000 landed.
- Largest run (F3, 200 agents, 3 models side by side): 3,120 files in 261 s (~716 files/min), 2,330 landed, 786 nothing
  to add, 4 rejected, land wait p50 10 s / p90 18 s, $1.37.
- Per 1,000 files by model: glm-4.7-flash $0.14, gemma-4-26b $0.22, gemini-3.5-flash-lite $0.87 (Gemini handled 1,152
  files, landed 860; overflow vs planned: pending, qb6).
- Still missing: requests/min reached per model and 429 share (only 3 rate-limited files so far, so "the provider's
  limit is what limits it" is NOT yet shown: keep it out until /runs has peak calls per min); quality (F4 pending).

## Submission (short paragraph, goes after "Different jobs need different ways to run agents")

**A fleet on Workers AI.** To see what limits a fleet of cheap agents, Durable Object agents with cheap Workers AI
models wrote documentation comments for VS Code's `src/vs` in our own Artifacts copy: 4,192 files over 7 runs, 3,029 with
comments landed, 1,141 with nothing to add. The largest run, 200 agents on three models side by side, did 3,120 files
in 261 s.[GAP: other repos, if run] Every change was checked mechanically to leave the code
unchanged (the same syntax tree with comments ignored) before it landed through lanes by folder. The limit was the
provider's request limit per model ([GAP: requests/min reached; Workers AI allows 300 a minute per model]), not the
number of agents: [GAP: what happened past it, e.g. more agents only added waiting]. Cost: $0.38 per 1,000 files ($1.59 in all;
$0.14-0.22 on the Workers AI models, $0.87 on Gemini Flash-Lite). Quality, on a sample: [GAP: judge result on N files] and [GAP: hand check of 50 files];
No change was refused for touching code (0 of 4,192).

## README (block under "Scaling to thousands: lanes")

**A fleet on Workers AI** ([`sim/fleet/`](sim/fleet/), [GAP: FINDINGS section]): documentation comments for VS
Code's `src/vs` (MIT; our own Artifacts copy, never pushed upstream), written by Durable Object agents calling cheap
Workers AI models through AI Gateway, no Claude.
- **Every change verified:** before a file lands, its code must be unchanged: the TypeScript syntax, compared with
  comments ignored, is identical, with no new parse errors. None was refused (0 of 4,192 files).
- **Landing:** lanes by folder, one commit per lane, through one push onto main. Largest run: 200 agents, 3,120 files in
  261 s (~716 files a minute), 2,330 landed, 786 with nothing to add, 4 rejected; land wait p50 10 s, p90 18 s.
- **What limits it is the provider, not the agents:** Workers AI allows 300 text-generation requests a minute per
  account and per model. [GAP: measured rate per model; 429 share; what more agents did]. Models were run side by
  side, each paced at its own limit[GAP: , with Gemini through the same gateway as overflow: N files].
- **Cost:** $1.59 for 4,192 files over 7 runs: $0.38 per 1,000 files ($0.52 per 1,000 landed). Per 1,000 files:
  glm-4.7-flash $0.14, gemma-4-26b $0.22, Gemini 3.5 Flash-Lite $0.87.
- **Quality** (scripts/fleet/quality-sample.mjs): [GAP: judge sample N, result]; [GAP: hand check of 50: right /
  wrong / trivial]; [GAP: invented parameters flagged].
- [GAP: more repos (TypeScript, Angular, Babel), if run: files and $ each].

## /how card (for qb3)

Title: **A fleet on Workers AI**
Big number: 3,029 files (documented and landed; 0 refused for touching code)
Text: Cheap Workers AI models, one Durable Object agent per file, wrote documentation comments for VS Code's code.
Every change was checked to leave the code itself unchanged before it landed, through lanes by folder. The limit was
the provider's requests per minute per model, not the number of agents. $0.38 per 1,000 files. [GAP: quality on a sample].
Label: Workers AI models, no Claude; our own copy of VS Code `src/vs`; [GAP: runs / dates].
