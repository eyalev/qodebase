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

## L3: lanes on Cloudflare (2026-10-12)

Is one landing door (one merge queue) the limit, and do lanes lift it? Same harness, real Artifacts repos and
pushes, scripted agents (no model), 10 minutes of work per cell, work 20-60 s per change, trains every 10 s.
A lane = a landing Durable Object per area of the code (module m % N), with its own queue, replay and the project's
tests; changes that touch more than one lane, or a shared file, go to the coordinated lane X (it freezes the lanes
it touches, lands, thaws them). Two doors onto main: `cas` (every lane pushes main with compare-and-swap) and
`combine` (lanes hand tested trains to one main-door object, which puts every lane's trains into one commit per
round). Runner `run-cells.mjs`, results `results/L3-<cell>.json`, main checked after every cell by `verify.mjs`
(git fsck, the project's tests on the final tree, and the landed count against main's commits).

| agents | lanes | door | cross | changes made | landed | wait p50 / p90 | main pushes | CAS misses | main tests | landed checked against main |
|---|---|---|---|---|---|---|---|---|---|---|
| 500 | 1 | - | 5% | 7,537 | 7,532 | 6 s / 11 s | 61 | - | pass | id by id |
| 500 | 8 | cas | 5% | 7,558 | 7,543 | 6 s / 10 s | 709 | 167 | pass | id by id |
| 500 | 8 | combine | 5% | 7,543 | 7,530 | 7 s / 11 s | 135 | 0 | pass | count (sum of per-lane counts) |
| 2,000 | 1 | - | 5% | 28,969 | **14,336** | **500 s / 554 s** | 72 | - | pass | id by id |
| 2,000 | 8 | combine | 5% | 30,152 | **30,066** | **8 s / 13 s** | 183 | 0 | pass | count |
| 2,000 | 16 | combine | 5% | 30,038 | 29,941 | 8 s / 13 s | 157 | 0 | pass | count |
| 2,000 | 32 | combine | 5% | 30,164 | 30,096 | 8 s / 12 s | 140 | 0 | pass | count |
| 2,000 | 8 | cas | 5% | 30,238 | 30,134 | 7 s / 16 s | 599 | 104 | pass | id by id |
| 2,000 | 16 | combine | 20% | 30,117 | 29,848 (main: 29,860 ids, 63 twice) | 8 s / 15 s | 156 | 0 | pass (rerun) | id by id |

What it says:
- **One door saturates at 2,000 agents.** One lane landed half of what the agents made: trains capped at 200
  changes every ~12.7 s (main push ~2 s), the queue peaked at 18,561 and the median wait went from 6 s to 500 s.
- **Lanes lift it.** With 8 lanes the same load landed in full (30,066 of 30,152) with a 7-8 s median wait; 16 and
  32 lanes landed the same. From 8 lanes up the work, not the door, was the limit, as at 500 agents.
- **One main door beats every lane pushing main.** `cas` worked but 24% (500 agents) of main pushes missed their
  compare-and-swap, and Artifacts also refuses a second push to a repo while one is in flight (`receive_pack_busy`).
  The combining door had no misses: one commit per round carrying every lane's trains.
- **Cross-area work costs the coordinated lane.** At 20% cross changes the run landed the same total, slower to
  drain (~118k/h vs ~157k/h), with X freezing lanes more often.

What broke on the way (all fixed, each found by `verify.mjs` or a lane's own tests):
1. Lanes kept stale read copies of other lanes' code: X sent them only the files it changed, and a train that
   finished during a thaw wrote back its old copy. Every change then failed the tests in every lane (913 landed,
   6,575 dropped); main stayed whole because lanes refused to land. Fixed; a lane now judges a change only by
   the failures it adds (`viewFails` counts the rest, 0 since).
2. At 20% cross, main ended with 2 test failures: a lane (X) reset between handing a train to the door and its
   end-of-alarm save came back with files from before that train, and its next train put an old `routes.ts` on
   main. Lanes now save right after every irreversible step; the rerun's main passes.
3. Still open: in that rerun 63 change ids landed twice (a lane reset after the door accepted its train but before
   the lane saved that it had), so 29,860 commits-worth on main are 29,797 unique changes. Main is unaffected (the
   second landing writes the same files); the fix is for the door to refuse an id it already landed.

Costs: each cell is a few thousand Artifacts forks plus tens of thousands of pushes (~32k Artifacts operations
per 2,000-agent cell), run before Artifacts billing starts (2026-10-14); Durable Object requests a few per change.
