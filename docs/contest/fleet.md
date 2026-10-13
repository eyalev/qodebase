# Fleet section: draft texts with gaps (P2, owner qb8)

Status: DRAFT. Nothing here is in the README, the submission or /how until the gaps are filled from
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

## Submission (short paragraph, goes after "Different jobs need different ways to run agents")

**A fleet on Workers AI.** To see what limits a fleet of cheap agents, Durable Object agents with cheap Workers AI
models wrote documentation comments for VS Code's `src/vs` ([GAP: files landed] of [GAP: files attempted] files;
[GAP: other repos, if run]) in our own Artifacts copy. Every change was checked mechanically to leave the code
unchanged (the same syntax tree with comments ignored) before it landed through lanes by folder. The limit was the
provider's request limit per model ([GAP: requests/min reached; Workers AI allows 300 a minute per model]), not the
number of agents: [GAP: what happened past it, e.g. more agents only added waiting]. Cost: [GAP: $ per 1,000 files]
([GAP: total $] in all). Quality, on a sample: [GAP: judge result on N files] and [GAP: hand check of 50 files];
[GAP: verify-fail share] of changes were refused for touching code.

## README (block under "Scaling to thousands: lanes")

**A fleet on Workers AI** ([`sim/fleet/`](sim/fleet/), [GAP: FINDINGS section]): documentation comments for VS
Code's `src/vs` (MIT; our own Artifacts copy, never pushed upstream), written by Durable Object agents calling cheap
Workers AI models through AI Gateway, no Claude.
- **Every change verified:** before a file lands, its code must be unchanged: the TypeScript syntax, compared with
  comments ignored, is identical, with no new parse errors. [GAP: refused for touching code: N of M].
- **Landing:** lanes by folder, one commit per lane, through one push onto main. [GAP: files landed, wall time, land
  wait p90].
- **What limits it is the provider, not the agents:** Workers AI allows 300 text-generation requests a minute per
  account and per model. [GAP: measured rate per model; 429 share; what more agents did]. Models were run side by
  side, each paced at its own limit[GAP: , with Gemini through the same gateway as overflow: N files].
- **Cost:** [GAP: $ per 1,000 files, by model], [GAP: total $], on the $50-a-day cap.
- **Quality** (scripts/fleet/quality-sample.mjs): [GAP: judge sample N, result]; [GAP: hand check of 50: right /
  wrong / trivial]; [GAP: invented parameters flagged].
- [GAP: more repos (TypeScript, Angular, Babel), if run: files and $ each].

## /how card (for qb3)

Title: **A fleet on Workers AI**
Big number: [GAP: files documented, e.g. "N files"]
Text: Cheap Workers AI models, one Durable Object agent per file, wrote documentation comments for VS Code's code.
Every change was checked to leave the code itself unchanged before it landed, through lanes by folder. The limit was
the provider's requests per minute per model, not the number of agents. [GAP: $ per 1,000 files]; [GAP: quality on
a sample].
Label: Workers AI models, no Claude; our own copy of VS Code `src/vs`; [GAP: runs / dates].
