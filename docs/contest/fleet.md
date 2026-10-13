# Fleet section: texts (P2, owner qb8)

Status: filled from `public/results.json` (9f46aa6, 16 runs; generator `node scripts/results/build.mjs`). Model runs
only: the four "cache" runs (S4a, answers replayed from a cache, no model calls) are left out of every number here
until qb6 confirms what they mean.

Wording rules:
- "agents" are Durable Objects calling a cheap model, not Claude. Gemini Flash-Lite (3.5 as overflow, 3.1 as a planned
  model) landed ~2,000 of the 6,616 files, so never say "Workers AI models" alone for the whole fleet.
- "The code is unchanged" is mechanical: the TypeScript syntax, compared with comments ignored, is identical, with no
  new parse errors. It says nothing about whether a comment is right: that is the quality check.
- Our own Artifacts copies of the repos; nothing is pushed upstream.
- Don't say "the limit was the provider, not the agents": only gemma ran near its limit (294 of 300 a minute); Gemini
  3.1 peaked at 75. Say the busiest model ran near the provider's limit.

## Numbers (model runs: 12 runs, 6 repos)

| | |
|---|---|
| files handled | 11,405 (some VS Code `src/vs` files more than once across the ramp runs) |
| landed with new comments | 6,616; the rest had nothing to add (4,757) or were rejected (17) |
| refused for touching code | 0; re-checked on main for all 3,029 changed `src/vs` files: 0 code changes |
| repos | VS Code `src/vs` (3,029 landed) and `extensions/` (1,536); `packages/` of Next.js (868), Angular (689), Babel (319), Nest (175) |
| largest model run | 200 agents, 3,120 `src/vs` files in 261 s (~716 a minute), 2,330 landed, land wait p90 18 s, $1.37 |
| cost | $2.81 in all ($0.42 per 1,000 landed); per 1,000 files handled: glm-4.7-flash $0.10, gemma-4-26b $0.19, Gemini 3.1 Flash-Lite $0.22, Gemini 3.5 Flash-Lite $0.87 |
| request rates | peak per minute: gemma 294 (Workers AI allows 300 per model), Gemini 3.5 235, glm 191, Gemini 3.1 75; 3 of ~6,650 calls refused with 429 |
| quality, hand check | 50 `src/vs` files, 115 comments: 109 right (95%) |
| quality, judge (gpt-oss-120b) | accurate: gemma 147/152, glm 57/59, Gemini 3.5 111/117; invented details 15 of 328. Agreed with the hand check on 104 of 115 but caught only 1 of the 6 the hand check found wrong: quote the hand number |

Sources: public/results.json (fleet.perModel, fleet.runs, headline.fleetQuality), RESULTS.md, scripts/fleet/quality-sample.mjs.

## Submission (after "Different jobs need different ways to run agents")

**A fleet of cheap models.** Up to 200 Durable Object agents calling cheap models (two on Workers AI, and Gemini
Flash-Lite through the same AI Gateway; no Claude) wrote documentation comments in six real codebases, in our own
Artifacts copies (VS Code, Next.js, Angular, Babel, Nest): 6,616 files landed for $2.81. Each change was checked to
leave the code unchanged (same syntax tree, comments ignored) before it landed through lanes by folder; none was
refused, and re-checking all 3,029 changed VS Code files on main found 0 code changes. A hand check of 50 files found
109 of 115 comments right. The busiest model ran near the provider's limit (294 requests a minute against 300).

## README (block under "Scaling to thousands: lanes")

**A fleet of cheap models** ([`public/results.json`](public/results.json) `fleet`, [`sim/fleet/`](sim/fleet/)):
Durable Object agents calling cheap models through AI Gateway, no Claude: glm-4.7-flash and gemma-4-26b on Workers AI,
and Gemini Flash-Lite. The job: documentation comments for real codebases, in our own Artifacts copies (never pushed
upstream).
- **Six repos, 6,616 files landed:** VS Code `src/vs` (3,029) and `extensions/` (1,536), and the `packages/` of
  Next.js (868), Angular (689), Babel (319) and Nest (175). The other files had nothing to add (4,757) or were rejected
  (17).
- **Every change verified:** before a file lands, its code must be unchanged (the TypeScript syntax, compared with
  comments ignored, is identical, with no new parse errors). None was refused, and re-checking all 3,029 changed VS
  Code files on main found 0 code changes.
- **Landing:** lanes by folder. Largest run: 200 agents, 3,120 files in 261 s (~716 a minute), 2,330 landed, land
  wait p90 18 s, $1.37.
- **Pace:** each model was paced at its own request limit. The busiest, gemma, peaked at 294 requests a minute against
  Workers AI's 300 per model; only 3 of ~6,650 calls were refused (429).
- **Cost:** $2.81 in all, $0.42 per 1,000 files landed. Per 1,000 files handled: glm-4.7-flash $0.10, gemma-4-26b
  $0.19, Gemini 3.1 Flash-Lite $0.22, Gemini 3.5 Flash-Lite $0.87.
- **Quality:** a hand check of 50 VS Code files found 109 of 115 comments right (95%). A model judge (gpt-oss-120b)
  rated ~96% accurate, but it caught only 1 of the 6 comments the hand check found wrong, so the hand check is the
  number to trust.

## /how card (for qb3)

Title: **A fleet of cheap models**
Big number: 6,616 files
Text: Up to 200 agents calling cheap models (Workers AI, and Gemini Flash-Lite through the same gateway; no Claude)
wrote documentation comments in six real codebases, including VS Code, Next.js and Angular, for $2.81. Each change
was checked to leave the code itself unchanged before it landed, through lanes by folder: none was refused. A hand
check of 50 files found 109 of 115 comments right. The busiest model ran near the provider's limit (294 requests a
minute against 300).
Label: measured; Durable Object agents, cheap models, no Claude; our own copies of the repos; 12 runs, 2026-10-13.
