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

## Run (c): every file different, 3 namespaces, fast start, bigger landing passes (2026-10-14 09:15 UTC)

Same 10,000 agents and 40,640 files as (b), with: copies spread over 3 Artifacts namespaces (qbfleet 4, qbfleet3 3,
qbfleet4 3; qbfleet2 kept free for the scene-3 take), agents started 250 per 100 ms per copy with a 0-0.5 s first-file
delay (was 50 per 200 ms, 0-3 s), landing passes up to 1,500 files every second (was 400 every 5 s). Copies were
made under new names, so no file matched a cached blob: 40,630 of 40,640 reads went to Artifacts.

| | (b) | (c) |
|---|---|---|
| files (of 40,640) | 29,883 landed, 10,685 nothing to document | **29,890 landed, 10,690 nothing to document, 60 no cached answer** |
| errors | 0 | 0 |
| busiest 10 s | 19,058 files (~1,900/s) | 18,946 files (~1,900/s) |
| agents busy at once (max per 10 s) | 2,321 | 2,796 |
| answers done in | ~50 s | ~33 s |
| landing after the answers | ~3 min | ~1 min (peak 980 files/s landed) |
| start to everything landed | ~5 min | 86 s |
| read p50 / p90 by namespace (median copy) | 615 ms / 1.16 s (qbfleet + qbfleet2) | qbfleet 536 ms / 1.29 s, qbfleet3 877 ms / 1.82 s, qbfleet4 811 ms / 1.46 s |

The 60 in (c) are 6 files per copy that the answer cache never had an answer for (cache mode answers only from the cache): not errors, nothing was read wrong or lost. Every one of the 29,890 changes was on main 86 s after the start.

**What (c) shows.** Faster start and bigger landing passes cut the whole run from ~5 min to 86 s, and landing stopped
being the wall. Reads did not get faster with more namespaces: ~1,900 files/s with every file read from Artifacts, in
2 namespaces or 3, and each read slower when more run at once. **The next wall is Artifacts read throughput for the
account (~1,900-2,000 reads/s), not per namespace**; past it reads wait longer (p90 1.3-1.8 s) but none failed. Behind
it: one Run object per copy hands out the work to 1,000 agents, which is why at most ~2,800 agents were reading at once.

## Runs (d) and (e): best case: files repeat (cache), fast settings (2026-10-14 09:36 and 09:40 UTC)

Every read served from the read cache (identical copies of VS Code `src/vs`), run (c)'s fast start (250 agents per
100 ms per copy, 0-0.5 s first-file delay) and landing (passes up to 1,500 files every second), cache-mode answers (no
model). Goal: find the wall when reads are not the limit. 1,000 agents per copy; copies spread over 4 namespaces.

| | (d) 10,000 agents, 10 copies | (e) 50,000 agents, 50 copies |
|---|---|---|
| files | 40,640: 29,890 landed, 10,690 nothing to document, 60 no cached answer | 203,200: 139,385 landed, 52,577 nothing to document; **10,943 (5.4%) lost** (below) |
| errors | 0 | 10,943 files lost to 'Durable Object is overloaded. Requests queued for too long.' on the Run objects; 0 read, landing or Artifacts errors |
| busiest 10 s | 20,846 files (~2,085/s) | 123,843 files (~12,400/s) |
| agents busy at once (max per 10 s) | 1,570 | 6,793 |
| reads | 100% cache (KV 40,530, memory 110), p50 51 ms, p90 102 ms | 100% cache (KV 194,362, memory 5,517), p50 28 ms, p90 113 ms |
| Run object hand-out (time to give an agent its batch) p50 / p90 / worst p99 | 74 / 235 / 1,321 ms | 74 / 209 / 1,011 ms |
| landing peak | 8,334 files in 10 s (~830/s), 45 pushes | 69,776 files in 10 s (~7,000/s), 223 pushes |
| start to everything landed | 82 s | ~70 s for what landed; 40 of 50 copies never finished (lost results) |

**What (e) lost, and why.** Each copy's Run object (one Durable Object) hands out work to its 1,000 agents and records
every result (an SQL row per file plus the run's counters). At 50 copies at once, Run objects answered agents with
'Durable Object is overloaded. Requests queued for too long.': 3,321 files were handed out and their results never
recorded, and 7,622 were recorded as ready but the hand-off to the landing queue failed the same way, so they never
landed. The fleet code dropped those results instead of retrying, and nothing re-queues work that is out for too long,
so 40 runs never reached 'done' (stopped by hand). Nothing landed was wrong, and every landed change is on main.

**The next wall (cache case): the fleet's own bookkeeping objects, not Artifacts or KV.** 10 copies at 1,000 agents each
were clean; 50 copies at the same per-copy load overloaded the Run objects (likely sharing hosts). Fixes, not built:
retry the report with backoff instead of dropping it, re-queue files out for more than N seconds, split each copy's Run
object into several (e.g. one per 250 agents), and batch the per-file SQL writes. Reads and landing kept up: 12,400
files/s answered and 7,000 files/s landed at the peak.

Cost: (d) ~$1, (e) ~$2-3 (estimates: forks, ~270 pushes, ~240k KV reads, a few million Durable Object requests; no
model calls). All copies deleted after (deleted.log, 55 repos incl. two seeds and three unused forks).

## Runs (f) 50,000 again and (g) 100,000, after the fixes (2026-10-14 10:02 and 10:18 UTC), best case: files repeat (cache)

Fixes (4a4769f, 5aa4910): agents keep a report until it is delivered and retry with backoff (records to the Run
object, then the files to the Lander), with the retry booked before each try; the Run object writes a batch with one
state save and skips results already recorded; work out for more than 90 s is re-queued. Same fast settings. (g) used a
fifth namespace (qbfleet5): 25 copies each in qbfleet, qbfleet3, qbfleet4, qbfleet5.

| | (e) 50,000, before | (f) 50,000, after | (g) 100,000, after |
|---|---|---|---|
| files | 203,200 | 203,200 | 406,400 |
| landed / nothing to document / no cached answer | 139,385 / 52,577 / - | 149,447 / 53,450 / 300 | 298,857 / 106,900 / 600 |
| **not landed** | **10,943 (5.4%)** | **3 (0.0015%)** | **43 (0.01%)** |
| runs that finished | 10 of 50 | 50 of 50 | 89 of 100 (11 hold their last 2-6 files) |
| busiest 10 s | 123,843 (~12,400/s) | 128,876 (~12,900/s) | 211,032 (~21,100/s) |
| agents busy at once | 6,793 | 6,949 | 13,839 |
| reads (100% cache) p50 / p90 | 28 / 113 ms | 20 / 119 ms | 40 / 214 ms |
| Run-object hand-out p50 / p90 / worst p99 | 74 / 209 / 1,011 ms | 70 / 203 / 930 ms | 80 / 252 / 1,505 ms |
| landing peak | ~7,000 files/s | ~6,800 files/s | ~10,300 files/s (534 pushes) |
| start to (nearly) everything landed | ~70 s | ~75 s | ~66 s |

**What is still lost, and why.** In (g) 43 files on 11 copies were recorded as answered but never reached their
landing queue. Their agents' first report met 'Durable Object is overloaded' although the write went through, and the
retry that also hands the files to landing never ran: hundreds of agent invocations ended 'canceled' at 10:19:25-30,
under the load of 100,000 agents. The fix (not built): the Run object notices answered files that no landing queue
took within a minute and gives them to a fresh agent to redo (cache answers are the same every time).

**The walls at this scale (cache case):** Durable Objects of our own design. Each copy's Run object and Lander work for
1,000 agents; at 50-100 copies at once they answer 'overloaded' at peaks, and agent invocations get cancelled. Reads
(KV) and landing (Artifacts pushes, ~10,000 files/s at the peak) kept up.

**Update 10:35 UTC: the fix, built and applied to (g).** The Run object now sweeps every 30 s once its agents have
started: a file recorded 'ready' for over a minute that its landing queue does not hold is put back in the queue and a
fresh agent redoes it. Deployed at 10:34 and applied to (g)'s 11 unfinished copies: all 43 files were redone and landed,
so every one of (g)'s 100 runs finished (298,900 landed). The 43 in the (g) row above are what the run lost without the
sweep; with it, applied ~15 min after the run, 0 were left. A rerun with the sweep live during the run follows.
