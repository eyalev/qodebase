# Lab quality scoring (owner qb5)

How good is what a run built? `scripts/lab/score.mjs` answers with one JSON line, the
`quality` block of runs.jsonl (docs/lab/runs-schema.md). It runs on the laptop only.

```sh
node --experimental-strip-types scripts/lab/make-starters.mjs   # rebuild starters (+ hidden behaviour tests)
node scripts/lab/scenario.mjs <id> --out <dir>                  # starter as a git repo; prints scenarioCommit
node scripts/lab/scenario.mjs --index                           # public/lab/scenarios.json
node scripts/lab/score.mjs --scenario <id> --repo <clone of final main> [--judge]
```

**Hidden tests are private**: `$LAB_HIDDEN_DIR` (GitHub
<private hidden-tests repo>, PRIVATE). This repo is public and agents in boxes can read it,
so hidden tests, judge rubrics and reference solutions never come here or into a box.

**The number** (`public/lab/score.js`, shared with predict.js and the page):
60 × hidden passed / total + 20 × floor (build, typecheck, own tests: a third each) +
20 × judge / 10; without a judge the first 80 are scaled to 100.

| scenario | hidden | floor | judge |
|---|---|---|---|
| cafe-family | 7 family tests on the rendered pages (kids' menu, facilities, allergens, reachable, bookings, home, children's books), scaled by the share of 7 "nothing broken" checks still passing | build = the 7 "nothing broken" checks; typecheck = every file parses; own tests | Sonnet, rubric with 4 criteria, 390 px screenshots of every page |
| port-ts | 125 upstream behaviour tests (against src/index.ts only) + 29 type cases (19 must compile, 10 must be errors, i.e. not `any`) + 4 structure checks | build = src/index.ts loads; typecheck = strict tsc on src; own tests | Sonnet, rubric with 4 criteria, diff of 11 sample modules |

**port-ts reports two numbers** (manager, 2026-10-08): `score` (all 158 hidden) and
`scoreTrulyHidden` (only the 29 type cases + 4 structure checks, `trulyHiddenPass` /
`trulyHiddenTotal`), because the 125 behaviour tests are validator.js's own, public
upstream. Show them side by side; the runner notes whether a box fetched validator.js.

Validated 2026-10-08 before any real run:

| | cafe-family | port-ts |
|---|---|---|
| untouched starter | 25 | 8.3 |
| reference with one original page removed | 81 | |
| reference solution | 94 (judge 7) | 92 (158/158, judge 6) |

Judge cost: ~$0.25 API-equivalent per call (Sonnet, subscription), ~11 s; counted in the
lab budget as cost.byRole.judge, not in the variant's cost.

Scenarios (`scripts/lab/scenarios/<id>/scenario.json`): cafe-family = PLAN scenario 2 on the
Corner Café (the demo seed with its 14 tasks); port-ts = PLAN scenario 3 on 48 functions of
validator.js 13.12.0 (MIT, 23.7k stars, plain JS, typings only on DefinitelyTyped, so no
official TypeScript version to copy; uuid was dropped for that reason). `profile` in each
scenario.json is qb4's input for the sim (first guesses until stage 1 measures them).
