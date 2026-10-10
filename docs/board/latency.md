# Board latency: Durable Object vs Workers KV (E2, 2026-10-10)

Measured by `node board/bench.mjs` (sections 1-4) and `node board/bench.mjs --far` (section 5)
against the `qb-board` Worker (forq account, workers.dev). Every sample is in
`board/bench-results.jsonl`. The client was a laptop in Europe (one Cloudflare colo). The board's
Durable Object was created from here, so it also lives near LIS. Times in ms unless marked s.

## Durable Object board (what `board` uses)

| test | N | p50 | p95 | max |
|---|---|---|---|---|
| POST an event (round trip) | 100 | 71 | 103 | 181 |
| write → visible to a second request (POST + first GET) | 100 | 104 | 145 | 415 |
| write → WebSocket push on an open socket | 100 | 68 | 81 | 145 |
| round trip to a board DO on another continent (SEA / NRT) | 20 | 209 / 274 | 520 / 288 | |

- **Read-after-write is exact**: in 100/100 cases the very first read after the POST returned the
  event (one DO = one writer, strongly consistent). No polling or retry is ever needed.
- **The push usually arrives before the HTTP reply**: in 79% of cases the socket had the event before
  the POST's own response.
- The only cost of distance is the round trip to wherever the DO lives. An agent on another
  continent pays ~200-280 ms per call, and sees the same order and content.

## Workers KV, for comparison

Same colo as the writer (LIS):

| test | N | result |
|---|---|---|
| put then get in the same request | 100 | 100% fresh; put p50 115 ms (p95 168), get p50 3 ms |
| put, then get from a new request, key never read before | 10 | 100% fresh on the first read |
| put, key read 2 s before the write (cached here), default cacheTtl | 10 | 100% fresh on the first read |
| same, cacheTtl 30 s | 10 | 100% fresh on the first read |

Since KV's 2025 rework, a reader in the writer's own location sees the write at once.

Reader in **another location** (a Durable Object placed by `locationHint`: SEA for wnam, NRT for
apac), writer in LIS:

| test | where | first read fresh | new value visible after (p50 / p95 / max) |
|---|---|---|---|
| key never read there before | SEA | 9/10 | 0.3 s / 53.5 s / 53.5 s |
| key never read there before | NRT | 7/10 | 0.5 s / 53.5 s / 53.5 s |
| key read there 2 s before the write, default cacheTtl (60 s) | SEA | 0/10 | 52.4 s / 53.2 s |
| same | NRT | 0/10 | 52.5 s / 53.2 s |
| key read there before the write, cacheTtl 30 s (the minimum) | SEA | 0/10 | 23.1 s / 23.3 s |
| same | NRT | 0/10 | 22.3 s / 22.7 s |

- A location that has read a key keeps serving the old value until its cache entry expires: up to
  60 s by default, up to 30 s at the minimum cacheTtl. (The samples are 2 s shorter because the key
  was read 2 s before the write.)
- A board is read constantly (every prompt and every edit asks "who is here"). So for any agent away
  from the writer, the KV view is always up to 30-60 s old. Two agents who start the same task within
  that window cannot see each other. Concurrent writers to one key also overwrite each other (last
  write wins); KV has no append.

## Conclusion

A Durable Object board shows a write to every reader on the next request (~0.1 s here, ~0.2-0.3 s
across continents), and to open sockets in ~70 ms. A KV board is exact only in the writer's own
location; elsewhere it is 23-53 s stale in these runs, bounded by cacheTtl (min 30 s, default 60 s).
For "who is touching this file right now", only the DO meets the need.

Cost of the runs: a few hundred DO requests and ~1,500 KV operations, inside Workers Paid's included
amounts (cloudcost gap `qb-board`). Bench KV keys expire after 1 h.
