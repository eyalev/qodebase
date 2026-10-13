# The fleet and qodebase: which pieces it uses

The fleet (`sim/fleet`, Worker `qbfleet`, forq's Cloudflare account) is the scale experiment: up to 4,750 agents at
once on copies of real open-source repos. It is a separate Worker on purpose: it must be able to run thousands of
cheap agents without touching the product's objects, and be switched off on its own (off after 2026-10-14 unless
re-enabled; $50 per UTC day cap). This is exactly which qodebase pieces each fleet job uses, as of 2026-10-13.

## Comment jobs and the comment collision dial (`job: comments`, `job: comments+index`, `dial`)

Uses (the same ideas, the fleet's own copies of them):

| piece | in the fleet | notes |
|---|---|---|
| Artifacts repos and forks | yes | every copy is an Artifacts repo (namespaces `qbfleet`, `qbfleet2`); extra copies by server-side `fork` |
| Lanes + the door (one lander per repo) | yes, the fleet's own `Lander` | one commit per folder lane, all lanes in one push; the door = that push, logged per 10 s on /runs |
| Land by intent | yes, mechanical | a comment that conflicts is re-inserted above its declaration on the newest main; a declaration already documented = "duplicate, kept the first"; the API index line is re-inserted at its sorted place. No model in the replay (the intent is known exactly) |
| The code check | yes | every change is verified to leave the code unchanged: same syntax-tree tokens (comments and whitespace skipped), no new parse errors |
| Git notes as change records | yes | each lane commit carries a note on `refs/notes/qodebase` (intent, agent, model or cache, the check and its token count, picked/finished/committed times) |
| Claims (caught early) | yes, optional per run | an agent claims its declarations before reading; a held one = caught early, no work done |
| Records, /runs, drill-down | yes | per-file records in the run's object; series per 10 s; per agent, per slice, per commit, per file with its diff; checkers (`/dialcheck`, `/indexcheck`) |

Does not use:

| piece | why not |
|---|---|
| the Landing DO and the MergeBox merge queue | a comment change is pure insertions and its check is the token comparison, so a container-run train adds nothing but latency; the fleet's Lander does the same job in a Durable Object at ~1,100-1,300 tasks/s |
| review agents | the code check replaces review for comment-only changes |
| model replays (tier 2) | the intent is a known comment for a known declaration: a mechanical replay is exact |
| the agent board | tasks are handed out by the run's queue (one task per agent at a time), so nobody needs to look for work |
| the throughput controller / auto-scaling | the run's pacer (calls per model per 10 s) and the day budget do the bounding |
| Claude Code boxes | agents are Durable Objects calling a model (Workers AI or Gemini) or the answer cache; no container per agent |

## The code collision dial (`kata`)

Goes through qodebase's REAL landing:

| piece | used |
|---|---|
| Artifacts fork per change, in the project's namespace (`forq`) | yes |
| Landing DO: change records, overlap warnings, the merge queue (trains of up to 8) | yes |
| MergeBox: apply each reviewed diff to the latest main (`git apply --3way`), tier-1 handlers, the project's check (`.qodebase/landing.json`), git notes | yes |
| Land by intent: model replay in the merger (tier 2, Claude Haiku) | yes while the weekly Claude meter is under 50%; then off and the change goes back to its agent, which redoes the task on the newest main |
| Review | auto-approved (`reviewed('auto')`): the hidden tests judge afterwards |
| The agents | fleet `KataAgent`s (Gemini 3.1 flash-lite, glm-4.7 overflow), not Claude Code boxes |
| Hidden tests | never in a box or the repo (`lab-hidden/kata`), run by qb4's checker on main after each level |
