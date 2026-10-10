# Agent board: prior art (checked 2026-10-10)

Question: does something like our agent board already exist, and what is new about ours?
Our design and numbers: `FINDINGS.md`. All links were checked on 2026-10-10 unless marked otherwise.

How claims are marked:
- **[doc]**: stated in the product's docs, README or source code, or in a paper's text.
- **[mkt]**: claimed in marketing or a third-party write-up, not verified.
- **[inf]**: our inference from what the docs do and do not say.

## 1. Verdict

The idea is not new as a whole, and most of its parts already exist:
- A shared coordination log for coding agents exists (MCP Agent Mail, Overstory, Gas Town/Beads, grite).
- Advisory file leases with a TTL exist (Agent Mail; it even has a pre-commit guard).
- Declaring intent before editing exists, both advisory (Foremerge) and enforced (Claim Plane).
- LLM duplicate detection over a backlog exists (`bd find-duplicates --method ai` in Beads).
- A merge queue that re-implements a branch onto main with an LLM when git conflicts exists
  (Overstory tier 4 "reimagine"). Copilot also fixes conflicts and checks build and tests.

What we found no match for is **this exact combination**:
- edits and commits posted automatically by hooks, plus a stated task;
- one low-latency edge store with push (DO + WebSocket, ~70 ms);
- finished work kept queryable for 30 min;
- a dedupe pass at planning time;
- an intent-replay landing queue.

Most tools pick one of these. Agent Mail, the closest one, is mail plus leases. It has no automatic
edit feed, no memory of finished work and no push [doc/inf].

**The measured evidence is the most novel part.** We found four studies that measure coordination
for coding agents:
- **Claim Plane** (real LLM agents, 360 runs). It measures pass and integration rates. It found no
  speedup, because its enforced admission mostly serialised the work.
- **grite** (simulated agents). Duplicate work fell from 78% to 0%.
- **AgentRoom** (real agents). It measures abandonment and LLM-judge scores.
- **CoAgent** (1.4x speedup on contended workloads, but generic tools, not a repo backlog).

None publishes an A/B with real coding agents that self-pick from a shared backlog and reports
wall time, cost, git thrash and hidden-test quality together. None ablates "hooks only" vs
"stated intent" vs "remembers finished work" vs "upfront dedupe". The dedupe finding is also new as
a measurement: agents reading the board missed duplicates worded far apart; one upfront pass caught them.

Be honest about our weaknesses:
- small n (3 runs at 10 agents);
- one model (Haiku);
- short tasks and one repo;
- not peer-reviewed.

Claim Plane's study is larger and more rigorous.

## 2. Landscape

Columns: **Mode** = advisory or locking. **Unit** = intent (task meaning) or files.
**Posting** = automatic (hooks/platform) or agent-posted. **Dedupe** = duplicate tasks caught.
**Evidence** = published measurement of coordination value.

| Product / work | What it does for coordination | Mode | Unit | Posting | Dedupe | Evidence | Link |
|---|---|---|---|---|---|---|---|
| **Ours (qb-board)** | Per-repo DO event log + "now" view (TTL) + 30-min finished memory, WS push; dedupe pass; land-by-intent queue | advisory | intent + files | hooks auto (files, commits) + agent states task | yes, upfront LLM pass | real-agent A/B: -28% time, -29% cost, 73->2 aborted rebases, equal hidden tests | `FINDINGS.md` |
| MCP Agent Mail (Python, superseded by Rust) | Identities, inboxes, threads, glob file leases with TTL, exclusive/shared, optional pre-commit guard; git + SQLite | advisory (guard blocks commits on exclusive leases, overridable) [doc] | files (globs) + `reason` text [doc] | agent-posted MCP calls; hooks can run reservation checks [doc] | no [inf] | stress tests of the server only; "10-20 human hours" claim [mkt] | [repo](https://github.com/Dicklesworthstone/mcp_agent_mail) (2.2k stars), [rust](https://github.com/Dicklesworthstone/mcp_agent_mail_rust) (185 stars) |
| Claude Code agent teams (experimental) | Shared task list (pending/in progress/done, dependencies); file locking on *task claims*; mailbox; TaskCreated/TaskCompleted/TeammateIdle hooks | claim lock on tasks; no file claims, docs say "break the work so each teammate owns a different set of files" [doc] | tasks | agent/lead-posted | no [inf] | none | [docs](https://code.claude.com/docs/en/agent-teams) |
| Beads (`bd`) | Git-backed issue graph; `bd ready`, atomic `--claim`; `duplicates` links; `bd find-duplicates --method ai` | atomic claim on issues [doc] | tasks | agent-posted | **yes**: mechanical similarity, then LLM judge [doc] | none found | [repo](https://github.com/steveyegge/beads) (27.8k stars) |
| Gas Town | Orchestrator for 20-30 agents on Beads; mailboxes; "Refinery" per-rig merge queue, Bors-style bisecting, verification gates | n/a (orchestrated assignment) | tasks | orchestrator-posted | via Beads | none; "needs a 2nd/3rd Max subscription" [mkt] | [repo](https://github.com/steveyegge/gastown) (18.3k stars), [heise](https://www.heise.de/en/background/Full-Control-Gas-Town-Orchestrates-Ten-or-More-Coding-Agents-11178824.html) |
| Overstory | Worktree per agent, SQLite mail bus, FIFO merge queue with 4 tiers: clean, auto, AI-resolve, **reimagine** (LLM re-implements branch onto canonical); conflict prediction dry-run; hook guards | n/a (orchestrated) | tasks + `filesModified` | orchestrator + hooks | no [inf] | none; README warns merge conflicts "are the normal case" [doc] | [repo](https://github.com/jayminwest/overstory) (1.3k stars), [resolver.ts](https://github.com/jayminwest/overstory/blob/main/src/merge/resolver.ts) |
| Foremerge | Agents declare intended semantic changes (symbol, API, schema + operation) before editing; checked against others; advisory findings; MCP + SQLite | advisory [doc/mkt] | **semantic intent** | agent-posted | no [inf] | "benchmark harness exists but no published results yet" [mkt] | [repo](https://github.com/naw103/foremerge) (538 stars), [forum](https://users.rust-lang.org/t/foremerge-a-git-like-coordination-protocol-for-parallel-coding-agents-one-binary-sqlite-deterministic-conflict-rules/142084) |
| Claim Plane (paper) | Versioned ChangeIntent (base commit, typed resources, ops); deterministic admission; serialises overlaps; leases, fencing tokens | **enforced**, fails closed [doc] | intent + regions | agent/planner declares (frozen by a planner model) | no | 30 pairs x 3 seeds x 4 arms = 360 runs, real LLMs: pair pass 23%->50%, integration 66%->97%; 97% serialised, no speedup, no cost [doc] | [2607.21909](https://arxiv.org/abs/2607.21909), [2608.00947](https://arxiv.org/abs/2608.00947) |
| grite (paper + tool) | Append-only signed event log in git; advisory leases; shared task state | advisory | tasks | agents emit events | no | **simulated** agents, N up to 32: duplicate work 78%->0%, goodput x3.4; no time/cost, runs not stated [doc] | [2606.19616](https://arxiv.org/html/2606.19616), [repo](https://github.com/neul-labs/grite) (21 stars) |
| AgentRoom (paper) | CRDT shared workspace; file-level claim/status/broadcast as MCP tools | advisory "at the prompt layer" [doc via search snippet] | files | agent-posted | no | real agents, 4 tasks: fewer abandoned tasks, LLM-judge wins; "coordination, not parallelism, bears the load" [doc] | [2608.23740](https://arxiv.org/abs/2608.23740) |
| CoAgent (paper) | Concurrency control for agents on shared state: speculative writes, notify affected agent to re-plan, saga undo | optimistic + notification | tool footprints | middleware (automatic) | no | 10 contended workloads: within 5% of serial correctness, 1.4x speedup [doc] | [2606.15376](https://arxiv.org/abs/2606.15376) |
| claude-code-hooks-multi-agent-observability | Hooks post every Claude Code event to a server; live WebSocket dashboard | n/a (for humans; agents do not query it) [inf] | events | **hooks, automatic** | no | none | [repo](https://github.com/disler/claude-code-hooks-multi-agent-observability) (1.5k stars) |
| merge_train | Spawn-time file-domain lock registry for agent PR pipelines | lock | files | tooling | no | none | [repo](https://github.com/jleechanorg/merge_train) (1 star) |
| Cursor worktrees / parallel agents | Each agent gets its own worktree; results applied or PR'd by the human | isolation | n/a | n/a | no | none | [docs](https://cursor.com/docs/configuration/worktrees) |
| Codex, Devin, Copilot agent, Jules (cloud agents) | Isolation per task; no cross-agent awareness documented [inf]; third-party summaries agree [mkt] | isolation | n/a | n/a | no | none | [amux comparison](https://amux.io/guides/background-agents-compared/) |
| claude-squad, vibe-kanban, Crystal, Conductor, Sculptor, Uzi, container-use, ccswarm | Run many agents in worktrees or containers; human-facing kanban/dashboard | isolation | n/a | n/a | no | none | e.g. [vibe-kanban](https://github.com/BloopAI/vibe-kanban) (28k), [claude-squad](https://github.com/smtg-ai/claude-squad) (8.6k), [container-use](https://github.com/dagger/container-use) (4k) |
| claude-flow / ruflo | "Swarms" with shared memory [mkt]; not inspected in depth | ? | ? | ? | ? | none found | [repo](https://github.com/ruvnet/claude-flow) (74k stars) |
| Copilot "fix merge conflicts" | `@copilot` / button resolves PR conflicts, checks build and tests, pushes | n/a | the PR | on request | no | none | [changelog 2026-03-26](https://github.blog/changelog/2026-03-26-ask-copilot-to-resolve-merge-conflicts-on-pull-requests/), [2026-04-13](https://github.blog/changelog/2026-04-13-fix-merge-conflicts-in-three-clicks-with-copilot-cloud-agent/) |
| Merge queues (GitHub, Mergify, Graphite, Aviator, Trunk, Bors) | Test PRs against latest main in order or batches | gate | PR | platform | no | n/a | Graphite: conflicts go back to the author, queue rebase is not AI [doc]: [docs](https://graphite.com/docs/graphite-merge-queue); Mergify "updates each PR against latest main and re-runs CI" [doc]: [docs](https://docs.mergify.com/merge-queue/) |
| Blackboard LLM MAS (papers) | Agents post to a shared board; the next actors are chosen from it | n/a | messages | agent-posted | no | QA/math/data discovery tasks, not code [doc] | [2507.01701](https://arxiv.org/abs/2507.01701), [2510.01285](https://arxiv.org/abs/2510.01285v2) |
| Duplicate PR research (humans) | Duplicate PRs waste review; a bot can warn early in forks | n/a | PRs | n/a | **yes (detection)** | 23% of rejected PRs were redundant (Gousios, cited) [doc] | [NSF paper](https://par.nsf.gov/servlets/purl/10109925), [MSR'18 DupPR data](https://github.com/whystar/MSR2018-DupPR) |

Two empirical studies of agent conflicts show the problem is real. Neither tests a fix.
- **Agent PRs on GitHub** (33,596 PRs): uncoordinated agents often create the same new file
  independently [doc]. A blog reports cross-agent pairs conflict about 2x more often [mkt].
  [2607.04697](https://arxiv.org/html/2607.04697v2)
- **Lineage study**: 47% of textual conflicts happened even though the two agents wrote disjoint
  sets of files [doc, search snippet]. File claims alone cannot catch these.
  [2610.04779](https://arxiv.org/html/2610.04779)

Human analogues (general knowledge, not re-checked today):
- GitHub assignees and draft PRs;
- Gerrit topics;
- OWNERS files;
- presence in Live Share and Tuple.

Assignees and draft PRs are the "now" view done by hand, with no TTL and no file feed.

## 3. The closest three, in detail

### 3.1 MCP Agent Mail (closest overall)

**What it is.** A local MCP server. Each agent gets:
- a name and an inbox;
- threaded mail;
- **advisory leases** on file globs, with a TTL and an exclusive/shared flag.

When leases overlap, "reservations are still granted; conflicts are returned alongside grants" [doc].

Other features:
- An optional pre-commit guard blocks commits that touch another agent's exclusive lease. Agents can override it [doc].
- Git keeps an audit archive and SQLite keeps live state.
- The Rust version adds a TUI, "build slots" and a product bus that spans repos [doc].
- It deliberately avoids worktrees: "keep agents in one shared space, surface conflicts quickly" [doc].

**Where ours differs:**
- **Posting.** Theirs is agent-called: an agent must reserve before editing. Ours posts files and
  commits automatically from hooks. Our FINDINGS show hooks alone are a floor, and the stated
  intent adds the most. So both designs still need the agent to say what it is doing; ours makes the
  file part free.
- **Unit.** Theirs is file globs plus a free-text reason. Ours is task intent, plus files observed
  from real edits. Leases are predictive (what I will touch). Our hook feed is factual (what I did touch).
- **Memory of finished work.** We keep a 30-min window, which was needed to stop close-worded
  duplicates (FINDINGS §3.4). In theirs, a lease is released or expires; mail history exists,
  but no "recently finished" query is documented [inf].
- **Delivery.** Theirs is polling (`fetch_inbox`). Ours is WebSocket push from an edge DO (~70 ms,
  shared across machines). Theirs is a local server, Docker or loopback [doc].
- **Dedupe and landing.** Theirs has neither. It pairs with Beads for tasks.

**Where theirs is better:**
- It is mature and used (2.2k stars, since 2025-10).
- Real messaging between agents (negotiate, hand off), which we lack.
- Exclusive/shared lease semantics with a commit-time guard.
- A human-auditable git archive.
- Cross-repo coordination.
- Hard-won fixes for scaling under load.

### 3.2 Overstory (and Gas Town, same family)

**What it is.** An orchestrator:
- a lead spawns workers in worktrees;
- a SQLite mail bus with typed messages (`worker_done`, `merge_ready`);
- a FIFO merge queue with four tiers: clean merge -> keep-incoming auto-resolve ->
  Claude resolves the conflicts -> **"reimagine"** [doc, source].

Reimagine aborts the merge. Then, per file, it asks an LLM to "reimplement the changes from the
branch version onto the canonical version" [doc, `resolver.ts`]. It also has a dry-run that
predicts conflicts. Gas Town's Refinery is a Bors-style bisecting queue with verification gates [doc].

**Where ours differs:**
- **Reimagine is our "land by intent" in spirit, but narrower.** It works file by file, from the
  branch's file contents, not from a reviewed statement of intent. In the code we read, no test gate
  runs inside that function [inf; the queue may test elsewhere]. Ours replays the change's stated
  intent on latest main, and tests are the gate.
- **Board.** Overstory has no shared "who is touching what" view that agents query before
  choosing. Coordination is top-down (the lead assigns), so self-picking duplicates are less likely
  by construction [inf].

**Where theirs is better:**
- A complete, used product (1.3k / 18k stars).
- Cheap tiers before the expensive replay.
- Conflict prediction before merging.
- Watchdog tiers.
- Runtime adapters for 11 agents.

### 3.3 Foremerge (closest on intent), with Claim Plane as the research version

**What it is.** Before editing, agents declare what they will change in **semantic** terms: a
symbol, API or schema, plus the operation. Each new declaration is checked against open ones;
conflicts come back as advisory findings with a suggested resolution. It catches cases git cannot,
e.g. one agent replaces `PaymentService` while another extends it [mkt, maintainer's post].

Claim Plane is a stricter version of the same idea. It enforces admission and serialises overlaps,
and it has a real 360-run study.

**Where ours differs:**
- **Matching.** Our intent is free text, matched by the agent's judgement plus an upfront LLM dedupe.
  Foremerge's is structured and checked by deterministic rules. Ours catches "same task, different
  words". Theirs catches "different tasks, same symbol". These are complementary.
- **Automatic posting.** Foremerge has none [inf]. We have the hook feed.

**Where theirs is better:**
- Semantic conflicts across files, which file claims miss: 47% of conflicts in one study happened
  on disjoint file sets.
- Suggested resolutions.
- Claim Plane's study design (paired, seeded, bootstrap CIs). It is a better template for our next
  experiment.

**Where ours is better:**
- **We measured speed and cost.** Claim Plane's enforced admission serialised 97% of runs and
  showed no speedup. Our advisory board kept parallelism and cut time by 28%.
- This is evidence for "advisory, never a lock". It is our strongest differentiator.

## 4. What to borrow

1. **Agent Mail: "conflicts returned alongside grants".** When an agent posts its intent, the
   reply should list overlapping intents and files right away. Do not make it ask `who` separately.
   This removes a step agents skip (FINDINGS: value falls at 40% posting).
2. **Agent Mail: an optional, overridable guard at push or land time.** It would warn: "agent4
   claimed `src/auth/**` 2 min ago". It stays advisory, and it catches agents that never read the
   board. In qodebase this belongs in the landing queue, not in a pre-commit hook.
3. **Agent Mail: glob claims + TTL + exclusive/shared, and build slots.** Our board is per-file
   from hooks. Letting the stated intent carry a glob would make the "now" view predictive, not
   only factual. Build slots (serialise expensive builds or tests) fit our CI cost concerns.
4. **Beads: two-stage dedupe.** Run cheap mechanical similarity first, then send only the
   candidate pairs to the LLM. Also run dedupe as a **TaskCreated-style hook**, so new tasks are
   checked when they are created, not only in one batch. Claude Code agent teams already expose
   this hook.
5. **Foremerge / Claim Plane: an optional structured part in the intent** (symbols or APIs touched,
   base commit). Matching it on the board would cover the cross-file semantic conflicts that our
   file feed misses. This is our planned "semantic matching on the board" experiment.
6. **Overstory: tiered landing.** Use clean merge -> AI resolve of the hunks -> full intent replay,
   so the expensive replay runs only when needed. Also borrow its conflict-prediction dry-run.
   Show "this will conflict with X" on the board before anyone pushes.
7. **Gas Town Refinery: Bors-style bisecting batches** in the landing queue. When many agents
   land at once, one batch test run can replace N serial runs.
8. **grite / Claim Plane: method.** Keep the event log minable for waste metrics (dup rate, aborted
   rebases), as grite does. Use Claim Plane's paired, seeded, bootstrap-CI design to make our A/B
   publishable. Measure partial compliance on purpose; grite lists it as unmeasured.
9. **Agent Mail: an agent-to-agent message channel** ("I'll take auth, you take API"). We only
   broadcast state. A directed note would let two agents settle an overlap instead of one silently
   backing off.

Note on social proof: these are references to borrow ideas from, not dependencies.
- Before building on code, check each one against the house bar.
- Agent Mail Rust (185 stars), Foremerge (538), grite (21) and merge_train (1) are below it.
- Beads, Gas Town, vibe-kanban and claude-flow are well above it.

## 6. Added from a second search (s1010-1750, 2026-10-10)
- **STORM** ([2605.20563](https://arxiv.org/abs/2605.20563), "Multi-agent Collaboration with State Management"): shared workspace that rejects stale-read writes at write time, plus intent comments; +18.7 on Commit0-Lite vs worktrees [doc, abstract].
- **Crystal / Palantir** (Brun et al., ~2010): human-era workspace awareness and speculative merging of in-flight branches. The ancestor of "warn before the collision" [doc].
- **Concurrency limits:** published advice is static (2-4 agents). [2603.21489](https://arxiv.org/abs/2603.21489) ("Effective Strategies for Asynchronous Software Engineering Agents") reports a score that peaks at 4 agents and falls at 8 [doc, per s1010-1750]. We found no adaptive controller that sets the number of agents from live thrash; that idea (AIMD on the board's thrash signal) is being tested in round 2.
