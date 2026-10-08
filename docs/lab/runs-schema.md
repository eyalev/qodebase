# public/lab/runs.jsonl — one JSON line per run (v1, agreed 2026-10-08)

qb6 writes it (scripts/lab/run.mjs), qb7 reads it (qodebase.app/lab), qb4/qb5 analyze it.
Change only by telling all four. Times are ms epoch; durations in the `tasks` and `timings`
blocks are ms epoch too (subtract `timings.askAt` for "seconds from the request"). Money in USD.

```jsonc
{
  "v": 1,
  "id": "lab-cafe-family-r1-3f9a",          // run id = the project name (eyal/<id>)
  "ts": 1791430000000,                         // when the line was written
  "stage": 1,                                  // 0 sim only (qb4), 1, 2, 3
  "scenario": "cafe-family",
  "scenarioCommit": "<sha of the starter repo the run started from>",
  "promptVersion": "cafe-family@1",           // the one-line prompt's version (qb5)
  "seed": 1,                                   // repetition index: LLM runs are not seedable
  "baseline": null,                            // null | "opus-alone" | "github"
  "variant": {
    "planner": "haiku|sonnet|opus|none",       // none = opus-alone (no split)
    "coders": 6, "coderModel": "haiku|sonnet|opus",
    "reviewers": 3, "reviewerModel": "haiku|sonnet|opus", "reviewStyle": "read|adversarial",
    "policy": "intent|ffa|phases|stacking|leads|github",
    "claims": true, "dedupe": false, "trainMax": 8
  },
  "predicted": { "landed": 0, "wallS": 0, "apiUsdStd": 0, "quality": 0, "simVersion": "" },  // qb4's public/lab/predict.js, called BEFORE the run
  "status": "done|stopped-budget|failed|timeout",
  "timings": { "askAt": 0, "planAt": 0, "firstLandAt": 0, "lastLandAt": 0, "wallS": 0, "medianAskToLandS": 0 },
  "counts": { "tasksPlanned": 0, "tasksLanded": 0, "dupIntents": 0, "conflicts": 0, "replaysHandler": 0, "replaysLlm": 0,
              "leads": 0, "bounces": 0, "reviews": 0, "reviewRejects": 0, "breaksOnMain": 0, "humanInterventions": 0 },
  "tasks": [                                   // from the Landing DO records (or public/lab/runs/<id>.tasks.json when large: "tasks": "runs/<id>.tasks.json")
    { "id": "…", "needs": [], "role": "coder", "model": "haiku", "startAt": 0, "pushAt": 0, "landAt": 0,
      "tries": 1, "files": 2, "how": "merged|handler|llm|lead|bounced" }
  ],
  "cost": {
    "usdReal": 0,                              // container time (what is actually billed; Claude runs on the subscription)
    "apiUsdStd": 0, "apiUsdHigh": 0,           // tokens at standard rates / at the >100k-prompt tier
    "quotaPctWeekly": 0,                       // DERIVED from tokens vs the plan, not the account-wide meter
    "byRole": { "planner": { "apiUsdStd": 0, "tokens": { "in": 0, "out": 0, "cacheR": 0, "cacheW": 0 } },
                "coders": {}, "reviewers": {}, "merge": {} }
  },
  "quality": { "hiddenPass": 0, "hiddenTotal": 0, "build": true, "typecheck": true, "ownTests": true,
               "judgeScore": 0, "judgeModel": "", "notes": "" },   // qb5's scorer, run on the laptop; hidden tests never in this repo
  "links": { "replay": "https://qodebase.app/p/eyal/<id>/work?replay=4", "app": "https://<id>--eyal.ttyview.dev/", "repo": "https://qodebase.app/p/eyal/<id>" },
  "notes": ""
}
```

Lab projects are unlisted (reachable by link, not in Explore or home). The stage guard reads the
account-wide cc-usage history; per-run quota is derived from the run's own tokens.
