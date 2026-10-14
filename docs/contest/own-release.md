# /own release log (self-host copies)

## 2026-10-14 10:41-10:43 UTC: release for the submission
- Built from forq 57a3f2e in a clean worktree (`node scripts/selfhost-release.mjs`), committed as 8153a9b
  (`forq-release-selfhost/`), pushed to GitHub and force-pushed to the Artifacts mirror forq/forq (22 s), which the
  installer clones.
- Install test: `qb install qodebase --name qb-selftest` into Eyal's personal Cloudflare account: account, storage,
  deploy, lock and ready all done in 79 s; https://qb-selftest.<sub>.workers.dev answers 302 (Access, as it should).
- Redo (3 min) if forq changes materially before the submission. Log: ~/.local/share/qbfleet/own-dryrun/install-2026-10-14.log
