# What forq costs to run

Measured with `scripts/measure.mjs` (Artifacts and container GraphQL, the
subscription usage meter, and every box's own Claude
Code transcript). "API price" = what the same tokens would cost on the Claude
API at Sonnet 5 / 5.5 rates (input $2/M, 5-min cache write $2.50/M, cache read
$0.20/M, output $10/M; claude-api skill, cached 2026-09-25). On the
subscription there is no per-token charge; the API price is what a public forq
would pay if users do not bring their own subscription.

## Run 1 — three changes in one message, eyal/calculator (static app)

2026-10-01 21:22:45 → 22:31:19 UTC (69 min wall clock, which includes ~35 min
of stalls caused by forq bugs that were fixed during the run).

- One message to the router agent → 3 agents started within 30 s; each pushed
  within 1.5–3 min of starting.
- Reviews: the vibration change approved first time; the % key needed 3 rounds
  (float noise, then exponent notation, then a 5-column row that broke the
  4-column grid); the history list needed 3 rounds (overlap with the keys,
  then the = row pushed off screen on short phones). Every finding was real.
- Merges: 3 through the router agent; the last one conflicted (all three edited
  index.html) and the router agent resolved it.

| Meter | Run 1 |
|---|---|
| Artifacts billable ops | 23 (3 forks, 8 pushes, 12 pulls); 10k/month free, then $0.15/1k |
| Agent containers | 1.43 box-hours (15,469 GiB·s), 415 CPU s: ≤ $0.05 before the monthly free allowance |
| Subscription quota (account-wide, other use included) | 5-hour window +2 points; weekly +1 point |
| Tokens, 5 boxes | 92k output, 411k cache writes, 11.6M cache reads, 0.4k plain input |
| Same tokens at API price | ≈ $4.26 (router $0.25, reviewer $0.96, agents $1.41 / $1.42 / $0.23) |

Per feature: ≈ $1.42 at API price, including its reviews. The reviewer is
≈ 23% of the total; 63% of the API price is cache reads (agents re-reading
their growing context every turn), 22% output.

## Run 2 — a Worker project, eyal/workers-chat-demo

2026-10-01 19:00 → 20:20 UTC (80 min): a feature (participant count) plus
the Issues → fix loop, with deploys and previews.

| Meter | Run 2 |
|---|---|
| Artifacts billable ops | 26 |
| Agent containers | 2.12 box-hours, 527 CPU s: ≤ $0.07 |
| Builder container | 0.08 box-hours: ≤ $0.005 |
| Tokens, 4 boxes | 113k output, 449k cache writes, 19.4M cache reads |
| Same tokens at API price | ≈ $6.13 |

## What it means

- **Cloudflare is not the cost.** A feature round costs cents in containers
  and a few dozen Artifacts operations (the free 10k/month covers hundreds of
  rounds).
- **The model is the cost.** On the subscription, a 3-change round used about
  2 points of the 5-hour window and 1 point of the weekly allowance (upper
  bounds: account-wide). At API prices it is ≈ $1.40 per reviewed change.
- **For a public forq** (bring-your-own key or forq credit): budget ≈ $1–2 per
  reviewed change on Sonnet. Levers, in order: cache reads dominate, so keep
  agent contexts short (fresh agents per task already help; /clear between
  reviews did); the reviewer at lower effort or on a cheaper model; fewer
  review rounds via clearer tasks from the router agent.
- Containers: a box bills its full 3 GiB while awake; idle stop at 5 minutes
  keeps that small.
