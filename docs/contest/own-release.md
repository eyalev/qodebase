# /own release log (self-host copies)

## 2026-10-14 10:41-10:43 UTC: release for the submission
- Built from forq 57a3f2e in a clean worktree (`node scripts/selfhost-release.mjs`), committed as 8153a9b
  (`forq-release-selfhost/`), pushed to GitHub and force-pushed to the Artifacts mirror forq/forq (22 s), which the
  installer clones.
- Install test: `qb install qodebase --name qb-selftest` into Eyal's personal Cloudflare account: account, storage,
  deploy, lock and ready all done in 79 s; https://qb-selftest.<sub>.workers.dev answers 302 (Access, as it should).
- Redo (3 min) if forq changes materially before the submission. Log: ~/.local/share/qbfleet/own-dryrun/install-2026-10-14.log

## 2026-10-14 10:52-10:55 UTC: the café story on the fresh copy
- On qb-selftest (installed above from release 8153a9b): project eyalev/gitignore (made by importing github/gitignore,
  then the demo's reset replaced its files with the Corner Café seed; a normal user on a copy cannot create an empty
  project without a Claude key), landing on, the scripted story with 6 agents at normal speed, as in Watch a run.
- **14 of 14 changes landed** on main, the last 140 s after the start (10:52:37 -> 10:54:57 UTC), in 11 trains:
  6 collisions, all 6 replayed onto the newest code, 1 sent back by its checks and fixed. Merge queue, merger box and
  git all ran in Eyal's own Cloudflare account.
- Not covered: real Claude agents on the copy (it has no Claude key); a first try on an imported repo whose branch is
  master failed the reset ('stale ref': the seed pushes main) and was stopped after 12 s (project eyalev/test-repo1).

## 2026-10-14 12:58-13:00 UTC: release rebuilt from the current forq
- Built from forq c696edf (adds the day's landing fixes: the wake check at every spawn, 'woken: its box is starting',
  the 'ended' state, and the other tabs' UI work since 57a3f2e), committed as 7f0d372, pushed to GitHub and the
  Artifacts mirror forq/forq.
- Install test `qb install qodebase --name qb-selftest`: account, storage, deploy, lock and ready all done in 79 s;
  the copy answers 302 (Access). This is the release a person gets from /own now.

## 2026-10-14 15:24-15:26 UTC: release rebuilt after the qb-agent rename
- Built from forq 72ced72 (the in-box CLI is qb-agent, forq kept as a symlink), committed as 814d3e8, pushed to GitHub
  and the Artifacts mirror. Install test into qb-selftest: all 5 steps done in 95 s; the copy answers 302 (Access).

## 2026-10-14 18:27 UTC: release rebuilt after the merger patch fix
- Built from forq 47a1369 (patches applied byte-exact), committed as f8852f9, mirror pushed; install test into qb-selftest done (see log).
