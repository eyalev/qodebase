# qodebase sim on Cloudflare

The laptop's real-code sim (`../real/`), run for real on Cloudflare, in real time:

- **One Durable Object per agent.** It forks the main repo in Artifacts (its own
  fork, its own write token), asks the merge queue for a task, "works" for a while
  (no model calls: the edit is one of `../real/project.mjs`'s scripted operations),
  then commits and **pushes to its fork over git's smart-HTTP protocol** from inside
  the Worker (`src/gitpush.js`: SHA-1, trees, commits, packfile, receive-pack; no
  dependencies, checked against `git index-pack` and `git fsck`).
- **One Run Durable Object is the merge queue.** Every few seconds it takes the
  queued changes, replays each one's intent on main (land by intent), runs the
  project's tests, chains the commits and pushes the train to main in one push.

What it measures: how long Artifacts takes to fork and accept pushes when hundreds of
agents use it at once, what fails, and how many Artifacts operations a run costs.

```sh
# deploy (forq's account; Artifacts namespace qbsim, separate from real projects)
CLOUDFLARE_API_TOKEN=$(cat ~/.config/forq-cf/api-token) npx wrangler deploy -c sim/cloud/wrangler.jsonc
# run (key in ~/.config/qbsim/key); capped in code at 600 agents, 20 minutes
curl -X POST https://qbsim-cloud.forqdev.workers.dev/start -H "x-sim-key: $(cat ~/.config/qbsim/key)" \
  -H 'content-type: application/json' -A qbsim-cli/1 \
  -d '{"agents":500,"minutes":10,"workMinS":20,"workMaxS":60,"trainEveryS":10}'
curl -A qbsim-cli/1 https://qbsim-cloud.forqdev.workers.dev/status
curl -A qbsim-cli/1 https://qbsim-cloud.forqdev.workers.dev/bundle > public/sim/runs/cloud-500.json
```

Cost: Artifacts is $0.15 per 1,000 operations past 10,000 a month (billing from
2026-10-14) and $0.50/GB-month past 1 GB. A 500-agent run is about 500 forks plus a
push per change: a few thousand operations, well under a dollar. Durable Object
requests are a few per change. Listed in `cloudcost gaps` as `qbsim-cloud`. Each run
leaves its repos in the `qbsim` namespace (`<runId>-main`, `<runId>-a<N>`).

## Results (2026-10-07)

| run | agents | real time | landed | forks | agent pushes | main pushes |
|---|---|---|---|---|---|---|
| trial | 10 | 2 min | 27 / 27 | 4 of 10 (6 failed: forked seconds after the repo was created) | 27, 0 failed | 15, 0 failed |
| cloud-50 | 50 | 3 min | 352 / 352 | 50 / 50, 2.9 s median | 352, 0 failed, 279 ms median | 25, 0 failed, 400 ms median |
| cloud-500 | 500 | 10 min + drain | 5,810 (1,216 still queued when stopped) | 500 / 500, 2.8 s median (2 retries) | 7,033, 7 failed (Artifacts 503/500), 280 ms median, 588 ms p90 | 147, 88 rejected as stale (our bug, below) |

What the 500-agent runs taught, in order:

1. **Forking a repo seconds after creating it fails** ("ArtifactsError: An internal error
   occurred", 6 of 10). Later forks of the same repo all worked; forks now go 8 at a
   time with backoff retries.
2. **A Durable Object that keeps the run in memory loses it.** The merge queue was
   evicted twice (once after an uncaught alarm error, once with no error). It now writes
   its state after every step and restores on any call (verified with a mid-run deploy).
3. **One merge-queue object is the ceiling.** With 500 agents asking it for work and
   handing in changes, plus replaying and testing trains, it hit "Durable Object is
   overloaded. Requests queued for too long" at about 11 landings a second (~40,000 an
   hour), and was reset three times in that run. The next design step is the one the
   simulations point to anyway: shard the queue (one per area, like the leads), not
   one per repo.
4. **A reset between a push and saving it leaves a stale tip.** After the overload
   resets, main's saved tip was one train behind Artifacts, so every train push was
   rejected ("stale ref", 88 times) until the run was stopped. The queue now re-reads
   main's tip and tree from Artifacts on a stale push (verified: 1 stale push, 1
   resync, 137 of 137 landed); agents do the same for their forks.
5. **Artifacts itself held up**: 7,033 pushes from 500 forks at once, 0.1% failed
   with a 503/500, 280 ms median. Main on Artifacts is a real repo: a bare `git clone`
   of cloud-500's main passes `git fsck` with 5,952 commits.

Artifacts operations counted by the sim on 2026-10-07: ~17k (cloud-500 alone 7,684),
before Artifacts billing starts (2026-10-14); at list price that would be ~$1.
