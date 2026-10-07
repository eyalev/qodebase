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
