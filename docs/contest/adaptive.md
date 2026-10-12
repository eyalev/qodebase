# Different jobs need different ways to run agents (draft for /how, README, submission)

Status: owner qb8. Vision, not built. Numbers as of FINDINGS2 §7-10 and qb6's verified L3 counts (2026-10-12); the L3 cells are in;
the fix for L3's 20%-cross break is pending (qb6). The README section and the submission use these rows. Every number below is copied from the source in its row. Labels:
- **measured** = real AI agents;
- **replayed** = a real project's own history, scripted agents;
- **simulated** = real git and real tests, scripted agents, no model calls.

## Toolbox (for the /how table; qb3 owns the page)

| the job | what won | how we know | source |
|---|---|---|---|
| Small-to-mid apps (bakery and club sites, 15-minute jobs with several pieces) | **One strong agent.** One Opus agent finished 1.9× and 1.6× faster than an Opus planner with a Haiku crew; the crew cost about half at standard API prices | measured, 2-3 runs each | [/lab](https://qodebase.app/lab), README "Lab results" |
| A shared task list with hidden duplicates (60 tasks, 20 agents) | **Board + duplicate check up front.** The only setup with no duplicate built twice (0 of 10 pairs, against 3 for the check alone, 7 for a static split, 8 with nothing); lowest median time and cost (443 s, $2.61) | measured, 20 Haiku agents, 3 runs each | docs/board/FINDINGS2.md §6 |
| Tasks that arrive during the run | **A duplicate check on every new task.** 88 of 90 arrivals classified right; pairs built twice fell from 10 to 4 (board) to 1 | measured, 10 Haiku agents, 3 runs each | docs/board/E7-results.md W9b |
| How many agents (150 tasks) | **A controller that grows the team while landings rise** (settled at 10-14). About a quarter of the agent-minutes and half the cost of a fixed team of 40, not slower; controller + board best (1,284 s, $4.73, 150/150 hidden in every run). Fixed teams of 8 and 20 were cut by the weekly usage stop, so 'finds the best fixed size' is untested | measured, Haiku, 3 runs each | docs/board/FINDINGS2.md §8 |
| Two teams on one repo | **The board's cross-list check.** 40% less wall time, 22% cheaper, pairs built twice 4,4,3 → 0,0,1 | measured inside qodebase on Cloudflare, 3 runs each | docs/board/FINDINGS2.md §3 |
| A chain-shaped port (Bun's Zig→Rust: 89% of commits edit lines an earlier commit wrote) | **Ownership of line ranges, land at once, check behind the commit, fix forward.** Kept Bun's 26.2 h and cut broken-crate time 59-73%; a check that blocks each commit cost +23% (30 s) to +92% (120 s); more agents than 64 bought nothing | replayed: Bun's real patches; breaks in the middle phases modelled | sim/bun/README.md BUN3 |
| The same port, cut by module (one owner per file; Bun's line chains stay inside one agent) | **Order modules by the code's own structure, interfaces before bodies.** The same work in 3.4-5.2 h at 64 agents instead of 26.2 h (5-8x); more agents than 64 bought nothing; waiting for whole dependencies instead took 89 h (74% of the work is one cycle of modules using each other) | simulated from Bun's real structure (108 crates, 1,160 modules, 9,881 use edges); module order checked against the names Bun's real patches use across files (strict order misses 3%; two-phase interfaces-first meets them by construction at no time cost); not replayed; one owner per file and the interface share (10-30%) are assumptions | docs/board/sim.md (k), sim/bun/modules.mjs |
| A big codebase, thousands of agents | **Dependency-aware lanes with a controller per lane.** At 2,000 agents after 6 h: 1,271 landed an hour against 896 for one queue, median wait 10 min against 130, main never red. Lanes that test only their own area left main red 20-88% of the time At 10,000 agents over 2 h, 7,433 an hour against 896 (8x; an upper bound, since at 2,000 the 2 h figure overstated the 6 h one by 1.5x). 8 lanes did worse than one queue | simulated: real git and real tests, scripted agents, one run per cell | sim/README.md "Lanes", FINDINGS2.md §9 |
| The same, on Cloudflare (Durable Objects + Artifacts) | **8 lanes + one door onto main.** 2,000 agents for 10 min: 30,066 landed against 14,336 for one lane, median wait 7 s against 500 s, 16 and 32 lanes landed the same (29,941, 30,096): from 8 lanes up the work, not the queue, was the limit, as at 500 agents (~7,530 with 1 or 8 lanes). Main whole and passing its tests in all of these. **At 20% cross-area changes (16 lanes), 2 of ~30,000 landings broke main** (a cross-area rename race); being fixed | run on Cloudflare, scripted agents, one run per cell; landed counts match the commits on main, a change-by-change check is pending | sim/cloud/results/L3-*.json (qb6) |
| When to switch | **Queue saturation.** One queue lands ~830-900 changes an hour in both simulators, at 500, 2,000 and 10,000 agents alike; past that, more agents only lengthen the wait | simulated | sim/README.md "Lanes" |

## The adaptive loop (one paragraph, /how)

None of these won everywhere, so the next step is to choose per job. qodebase would profile a job first (how many
pieces, how much they overlap, which files are hot, how long the chains are, how long a check takes) and pick a
strategy from this toolbox, starting from everything measured so far. When the stakes are high it would run a cheap
pilot first: a simulation, or a replay of the repo's own history. It would run with full traces and adapt live (a
controller per queue; switch tactics when a queue saturates), record its estimate against what actually happened so
the next project starts from a better guess, and follow the person's choice of speed, cost or safety. This is the
direction, not what is built: today qodebase runs one landing queue per project with the board and duplicate check
as options.

## Submission / README paragraph

**Next: choose the way to run agents per job.** What we measured says no one way wins. One strong agent was faster
on small-to-mid sites; a board with a duplicate check was the only setup that stopped duplicate work on shared task lists;
Bun's chain-shaped port, replayed with its real patches, kept its speed only when checks ran behind each commit
instead of blocking it; and in simulation at 2,000 agents one merge queue capped out near 900 changes an hour, where
dependency-aware lanes with a controller each landed 1,271. So the plan is an orchestrator that profiles the job,
picks from this toolbox, pilots on a simulation or a replay of the repo's history when stakes are high, adapts when a
queue saturates, and learns from its estimates across projects. That part is a direction, not built
([how it works](https://qodebase.app/how)).
