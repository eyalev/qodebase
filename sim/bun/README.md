# Bun's Zig→Rust port as calibration data

oven-sh/bun#30412: 6,755 commits by ~64 Claude agents over 11 days (2026-05-04..14),
the only large real multi-agent commit history we know of. `analyze.mjs` mines it into
`calibration.json`; no model calls, no file contents.

```sh
node sim/bun/analyze.mjs     # ~20 s; reads ~/projects/github/oven-sh/bun-pr30412
```

Data: a blobless fetch (commits + trees, 35 MB) of `refs/pull/30412/head`, range
`0d9b296af33f..refs/pr/30412`. Every number comes from commit metadata and tree
diffs (file names and blob ids), so the script never touches the network
(`GIT_NO_LAZY_FETCH=1`). **Not measured:** lines per commit and real text conflicts
(both need file contents; see "Next"). Agents all commit as "Jarred Sumner", so an
agent is never identified directly: branches come from merge subjects, streams from
subject prefixes (`phase-d(bun_runtime)`), and the agent count (~64) from Bun's blog.

## Findings (2026-10-07)

**1. The bulk of the port did not use a branch per agent.** 81% of commits
(5,242 of 6,479) went straight onto one branch, `claude/phase-a-port`, 9 s apart at
the median, 99.5% with author time = commit time (never rebased). Phases a–e are
100% on that branch, phase-d alone is 2,229 commits in ~10 h. Many agents worked in
one tree and split it by **ownership of files and line ranges** (37 subjects say so
outright: `fix Blob.rs [3200,4000)`, `expect.rs [1601,2401)`). Branches appear only
later, for cross-cutting sweeps (`claude/unsafe-5k`, `bench-until-green`,
`code-dedup`, ...): 148 branch names, 276 merges.

**2. Rate.** 236 h span, 204 active hours. Per active hour: p50 6, p90 55, max 695
commits; busiest 10 minutes: 328. Phases d+e (porting, then compile-error fixing):
3,642 commits in 17 h ≈ 214/h ≈ 3.3 commits per agent-hour if all 64 ran (one commit
every ~18 min per agent). The rest of the 11 days was a long tail at single digits/hour.

**3. Phase shape: strictly sequential gates, then a parallel tail.**

| phase | commits | bulk (5–95% of commit times, UTC) | files/commit p50 / p90 |
|---|---|---|---|
| a (draft port, 100-file batches) | 18 | 05-04 14:05 .. 22:37 (8.5 h) | 100 / 112 |
| b (b0/b1/b2) | 352 | 05-05 04:27 .. 05-06 06:33 (26 h) | 7 / 24 |
| c | 63 | 05-06 06:44 .. 19:48 | 3 / 9 |
| d (make it compile, per crate) | 2,229 | 05-06 08:26 .. 18:06 (9.7 h) | 3 / 9 |
| e (port fixes, RAII) | 1,530 | 05-06 23:03 .. 05-07 03:55 (4.9 h) | 3 / 10 |
| f, g, h (sweeps: static-mut, unsafe, Windows) | 124 | 05-07 .. 05-09 | 10 / 66, 1 / 5, 21 / 260 |
| untagged (unsafe, perf, win, UB, fixes) | 2,163 | 05-07 .. 05-13 (143 h) | 2 / 9 |

d and e did not overlap: d's last commit was 19:42, e's first 20:31. d ended with a
slow tail (from ~18:20, one commit every few minutes on plain `phase-d:` after hundreds
an hour), which looks like the last errors being closed before a gate; then e started
at full speed. Earlier phases overlapped at the edges (c ran 03:20..20:16, alongside
the end of b and all of d). Inside a phase, up to 53 streams committed in the same
hour (phase-d split by crate: bun_runtime 1,155, unsafe 269, bundler 248, ...).

**4. Files per commit.** p50 3, p90 11, p99 66, max 1,289, mean 6.5. 30% touch one
file, 28% two or three, 1.2% more than 50 (mass edits: batch drafts, mechanical sweeps).

**5. Hot files are big source files, not manifests.** 3,056 files touched; median 4
commits each, p99 134, max 380 (`src/runtime/bake/DevServer.rs`). The top 1% (31
files) take 15.5% of touches but appear in 48.7% of commits; the top 0.1% (3) in
14%; the top 10% take 58% of touches. All 31 are `.rs` (5 module roots), none is
`Cargo.toml`/`Cargo.lock`: the hot spots are large files (Blob.rs, bundle_v2.rs,
node_fs.rs) that several agents edit in different regions. That is unlike our
Hono run, where the hot files were append-only lists (routes, schema, deps).

**6. Collisions in time** (% of commits for which an earlier commit within N minutes
touched one of the same files):

| window | 1 m | 5 m | 15 m | 30 m | 60 m | 2 h | 4 h | 8 h |
|---|---|---|---|---|---|---|---|---|
| any commit | 54 | 63 | 71 | 76 | 81 | 87 | 90 | 93 |
| a different stream | 11 | 20 | 29 | 35 | 48 | 60 | 69 | 77 |
| a different branch | 0.8 | 2.6 | 5.9 | 9.3 | 15 | 23 | 33 | 38 |
| different branch, both ≤ 10 files | 0.4 | 1.1 | 2.6 | 4.7 | 7.9 | 13 | 19 | 22 |

"Any" is mostly the same agent committing again to its own file. "Different stream"
is the upper bound for two agents on one file (streams are coarse; one stream holds
many agents). "Different branch" is real parallel work in separate trees: 6% at 15
minutes, 15% at an hour, 33% over 4 h.

**7. Merges.** 276 merges, 244 into the integration branch, one every 12 min at the
median (p90 67). A merge brings p50 3 / p90 12 commits and p50 14 / p90 148 files.
- 46% of merges had files changed on both sides since the merge base, 45% with
  different results on each side (a text merge was needed), 43% ended with text that
  matches neither side. Whether git did those by itself is unknown without contents.
- Only 7 merge subjects name conflicts, 96 in total ("sync: 27 conflicts → theirs",
  "resolve 11 conflicts: keep dedup moves + apply ... conversions"): the big ones came
  from syncs between long-lived sweep branches, not from the per-agent work.
- 13 merges are two agents pushing the same branch from different clones.
- 10 follow-up commits restore work a merge lost (3.6 per 100 merges), half within
  7 minutes: "re-apply BackRef migration ... (merge --theirs lost it)", "lost in
  e549d61 race", "restore ... dropped by e99311e584". Resolving whole conflicts by
  `--theirs` was the main way work got lost.

## What it means for our policies

- **Ownership instead of branches for the bulk.** The phase with the most agents
  (d) had no merges at all: one tree, each agent owning files or line ranges, the
  compiler as the work list. Our "Claims" policy is that, and Bun says it scales when
  the claim is fine-grained (a line range of a 5,000-line file, not the file). The
  sim's claim unit should be a region for big files, not the whole file.
- **Phase gates were real.** d and e ran back to back with no overlap (a ~50 min
  gap after a slow serial tail) and
  most of the work happened inside them; qb4's migration swarm should model gates
  as "next phase starts when the check is green" and expect the bulk of commits in
  the two middle phases (here 57% of all commits in 17 h).
- **Hot files ≠ append lists.** For a migration, `pHot` is ~0.5 (top 1.5% of files in
  about half the commits), higher than our 0.3, but the hot files are large and edited
  in disjoint regions, so `pCleanHot` should be higher than Hono's 0.2. Measuring it
  needs step 3.
- **Branches only for sweeps, merged often.** Cross-cutting sweeps lived on branches
  and merged every ~12 min; overlap with another branch within the hour was 8–15%.
  The losses came from resolving conflicts wholesale (`--theirs`) between long-lived
  branches: an argument for land by intent (replay the sweep's codemod on the new
  main) rather than picking a side.

Suggested numbers for `DEFAULTS` / the swarm sim (cite `sim/bun/calibration.json`):
`meanTouches` 3 (median; mean 6.5 with a heavy tail, p90 11), `pHot` ≈ 0.5 with
`hotFiles` ≈ 1% of files, per-agent commit interval ~18 min at full speed (~3.3/h),
cross-branch overlap 6% per 15 min / 15% per hour, lost-work after merges 3.6%.

## Next (needs Eyal's OK: fetches file contents)

Fetch the blobs for the merged branches' changed files only and replay each of the
276 merges with `git merge-tree` to count real text conflicts, per file kind, and get
lines per commit. That gives `pCleanHot` / `pCleanCold` measured on agent work.
