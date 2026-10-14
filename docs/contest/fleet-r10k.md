# 10,000 agents with a read cache (2026-10-14)

Two runs, the same settings: 10 copies of VS Code `src/vs` (4,064 files each, 40,640 files in all), 1,000 agents per
copy (10,000), batch 4, cache mode (answers from the answer cache, no model), started together. Read path: the fleet's
content-addressed read cache (a git blob or tree hash names exact bytes): isolate memory, then `caches.default` (no hits:
it does nothing on workers.dev), then KV `blob:<hash>`, then Artifacts.

| | (a) identical copies (best case) | (b) every file different per copy (realistic) |
|---|---|---|
| runs (ladder) | R10K-a | R10K-b |
| agents | 10,000 | 10,000 |
| files | 40,640: 29,890 landed, 10,690 nothing to document | 40,640: 29,883 landed, 10,685 nothing to document |
| errors (read, model, verify, landing) | 0 | 0 |
| busiest 10 s | 23,504 files (~2,350 files/s) | 19,058 files (~1,900 files/s) |
| answers done in | ~20 s | ~50 s |
| reads from | 40,554 KV + 86 memory (100% cache) | 36,555 Artifacts, 4,062 KV (one copy's blobs, cached by a test of the same rewrite), 11 memory |
| read time p50 / p90 (median copy) | 44 ms / 73 ms (worst copy p90 91 ms) | 615 ms / 1,163 ms (worst copy p90 2.9 s, p99 3.1 s) |
| landing (pushes) | ~2.5 min after the answers (75 pushes) | ~3 min after the answers (56 pushes) |

(b) makes every file unique: `/uniquify` writes a first line naming the copy into every file, so no two copies share a
blob and the cache only helps repeat reads within a copy, as in a real repo. Agents find a file's cached answer by the
hash of the file without that line.

**Caveat:** (a) is the best case: the copies share every file, so after the first read the cache serves them all. A real
fleet on different repositories looks like (b).

**The next wall is landing, not reading.** Answers were done in 20-50 s; landing took 2.5-3 min more. Each copy has one
landing queue (one Lander Durable Object) that pushes to its repo one commit batch at a time (peak ~690 files/s landed
across the 10 copies, 3-10 pushes per 10 s). Reads: with every file different, Artifacts reads take 0.6-1.2 s at
~1,900 files/s (44 ms when cached), the same slowing seen past ~2,000 reads/s before, with no errors. Also: agents start
in ramps of 50 per copy, so at most ~2,300 of the 10,000 were busy in any 10 s: at 4 files each, the job ends before
every agent is busy.

Not run: 20,000 agents. On the unique setup it needs 10 more copies and ~40k more Artifacts reads (~$6 at $0.15 per
1,000 operations), which would pass the $13 stop. Copies made for these runs were deleted after (deleted.log).
