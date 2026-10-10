# Agent board: findings (2026-10-10)

Question (Eyal): would a central, fast "who is working on what" log help agents that work at once?
**Answer: yes.** With 10 agents it made the same job 28% faster and 29% cheaper at equal quality.
Most of the gain comes from agents no longer fighting git. It helps only in a specific shape:
- agents state their task;
- the board remembers finished work;
- duplicates are found once, before work starts.

Automatic hooks alone are a floor, not the answer.

Details: `PLAN.md`, `latency.md` (E2), `sim.md` (E3), `E4-results.md` (E4 + scale + E).
Code: `board/` (CLI, Claude Code hook, Worker `qb-board`), `sim/board/`, `sim/board-ab/`.

## 1. Where the board lives: a Durable Object, not KV (measured)

| | Durable Object board | Workers KV |
|---|---|---|
| write -> visible to the next read | p50 104 ms, p95 145 ms, exact 100/100 | exact in the writer's location; elsewhere a reader that had read the key serves the old value ~52 s (default) / ~22 s (cacheTtl 30) |
| push to connected agents | WebSocket, p50 68 ms (79% arrive before the poster's own reply) | none |
| far away (SEA / NRT) | ~210-270 ms round trip, same order and content | 20-60 s stale |

For choosing a task, 30-60 s of staleness barely matters (E3: ~10-minute tasks). For "someone just
started editing this file", only the DO is fast enough. The DO costs cents.

## 2. Real agents (Haiku 5.5, `claude -p`, own clones, one shared repo, self-picked backlog)

Conditions:
- **A:** no board.
- **B:** hooks only (posts files and commits automatically).
- **C:** B + the agent states its task and files, and asks `who` before choosing.
- **D:** C + the query also returns work finished in the last 30 min, + a rule: "if a claimed or finished task means the same as yours, alias it or pick another".
- **E:** D + one dedupe call over the backlog before work (~$0.002), + starts staggered 5 s apart.

**5 agents, 16 tasks, 5 runs each** (medians; Mann-Whitney vs A):

| | A | B | C | D |
|---|---|---|---|---|
| hidden tests | 16/16 | 16/16 | 16/16 | 16/16 |
| rebases aborted | 22 | 6 | 3 | 3 |
| resets to origin | 24 | 8 | 3 | 3 |
| rejected pushes | 34 | 24 | 16 | 17 |
| work built, then dropped | 7 | 3 | 2 | 1 |
| runs with a duplicate pair built twice | 4/5 | 4/5 | 3/5 | 0/5 |
| API-equiv $ / run | 0.32 | 0.30 | 0.28 | 0.28 |
| wall time | 227 s | 219 s | 202 s | 200 s (n.s.) |

**10 agents, 30 multi-file tasks, 3 runs each:**

| | A | D | E |
|---|---|---|---|
| hidden tests | 30/30 | 30/30 | 30/30 |
| wall time | 354 s | **254 s (-28%)** | 268 s |
| agent-minutes | 55.2 | 38.4 (-30%) | 38.5 |
| API-equiv $ / run | 0.95 | 0.67 (-29%) | 0.71 |
| rebases aborted / resets / rejected pushes | 73 / 84 / 103 | 2 / 4 / 28 | similar to D |
| duplicate pairs built twice (of 5) | 4 | 4 | **0** |
| red commits on main | 0-1 | 0 | 3 [0-4] (n.s.; see 4) |

With 3 runs each, p = 0.1 is the floor for this test, and the A-vs-D differences in time, cost and git thrash reached it (no overlap).

## 3. What we learned

1. **The value is less git fighting, and it grows with the number of agents.** Without a board, git thrash
   roughly tripled when agents doubled. With one, it stayed flat. At 5 agents that saved 12% of cost;
   at 10 it saved ~30% of time and cost. Agents back off early ("claimed by agent4, left it") or merge in
   place, instead of building, colliding at push, and redoing the work.
2. **Quality did not change** at these sizes (every run passed every hidden test). The board is about
   waste and speed, not correctness.
3. **Stating the intent matters more than automatic posting.** Hooks alone see files, not meaning;
   C/D beat B on every waste measure. In our runs, hooks + one instruction ("post your task, ask `who`")
   was the working recipe. The E3 sim adds that most of the value survives at 70% posting but is lost at
   40%, so posting has to be part of the workflow.
4. **The board must remember finished work.** The duplicate that slipped through at 5 agents
   (T3 titleCase / T11 capitalizeWords) was not a timing miss. T11 had landed 15 s earlier, but the
   "now" view had already dropped it. `who --recent` fixed close-worded duplicates (0/5).
5. **Duplicates worded far apart need a dedupe step before work, not each agent's judgment.** At
   10 agents, agents saw their twin on the board 30-160 s after it was claimed or landed and still did not
   recognise it (4/5 pairs built twice even with D). One cheap Haiku pass over the backlog found 5/5 pairs
   with no false matches, and then no pair was built twice. At Haiku's ~30 s per task this saved code,
   not time; with longer tasks it saves time too.
6. **The merge gate is still needed.** E had 7 pushes with leftover conflict markers in a hot file (fixed
   by later commits; cause plausible, not verified). Agents pushed straight to main here. qodebase's
   landing queue (tests before landing) would have stopped them. The board reduces collisions; it does not
   replace the gate.
7. **From the Hono replay (zero-token):** about two-thirds of real "needs an earlier PR" cases were visible in
   advance (the needed PR had started, often a day or more earlier, on the same files). About a quarter
   needed a direct push (lockfile, release), which a board sees only if pushes post too. ~5% were not
   visible.
8. **The sim predicted the relative gains** (-25% time / -31% cost predicted vs -28% / -29% measured).
   It overestimated how often agents recognise far-worded duplicates. It is now recalibrated, and
   it agrees: dedupe upstream.

## 4. Recommendation

Build it, in this shape:
- **Event log + "now" view in one Durable Object per repo/team**, with entries that expire, WebSocket
  push, and queries by file/area. Advisory, never a lock. Any waiting it causes is capped (an uncapped
  wait-chain looped in one sim seed).
- **Posted automatically** by hooks (files, commits, done) **plus the stated intent** (task + files) at
  start. In qodebase the platform posts at spawn/push/review/land, so agents need no discipline.
- **Queries return finished work too**, and agents get one same-meaning rule.
- **One dedupe pass when work is planned** (backlog, issue list), so twins become aliases before anyone
  starts. This is the same move as the OpenClaw triage result, where duplicate detection was the big win.
- **Keep the merge queue/tests as the gate.**

For qodebase this is a natural next feature: the landing queue already knows every change's intent.
Announcing it at spawn instead of at landing gives agents the board for free.

**Next experiments, if wanted:**
- longer tasks (Sonnet/Opus agents, where a dropped duplicate costs minutes);
- dogfood the hook on our own tmux-web tabs for a day (needs a per-tab settings change, not global);
- semantic matching on the board itself (Jev/Clef on new intents vs open ones), instead of a per-agent rule.

## Spend and guards
- Real-agent runs: 32 runs (incl. 1 smoke), $13.04 API-equivalent on the subscription (cap $15).
- Cloudflare (DO + KV bench): cents; cloudcost gap `qb-board` added.
- Weekly meter: 71% -> 73% (stop was 77%). The sims used no model calls.
