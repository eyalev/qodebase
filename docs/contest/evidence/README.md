# Evidence pack (contest video)

Seven charts, each with one plain-words headline, built from `data.json` by
`build.mjs` (no network; PNGs need chrome-headless-shell from Playwright's cache).

```sh
node docs/contest/evidence/build.mjs --png
```

| chart | headline | data |
|---|---|---|
| `fastsim-100k` | At 100,000 agents, landing by intent moved 3.2× more changes than agent review | sim/README.md (k100 table) |
| `realcode-500` | Real code, 500 agents: land by intent landed 3.5× more than review-then-merge | public/sim/runs/*-500.json |
| `hono-ordering` | With 100 pull requests open at once, half had to wait for another. Git conflicts: none. | sim/hono/replay.mjs final run (commit 395cbb5: 16/40/48%, 0 conflicts at every wave; the earlier 1-3 came from an ordering bug). Says "almost none" by itself if any wave has a conflict |
| `swarm-migration` | Free-for-all wasted 91 agent-hours; knowing the order finished in less than half the time (10 and 100 agents; replaces bun-swarm in the video) | qb4's migration swarm, mean of seeds 1-3 (~/.local/share/qbsim-bench/swarm.jsonl, sim/README.md) |
| `bun-swarm` | Bun's 64 agents worked mostly on one shared branch, files split between them | sim/bun/calibration.json |
| `bun-merges` | Real agents: 1 merge in 6 had conflicts; agents wrote merged text for 68% of those files (not in the video) | sim/bun/calibration.json .merge_replay |
| `cloudflare-500` | 500 agents on Cloudflare: git held up, our single merge queue was the limit | public/sim/runs/cloud-500.json, sim/cloud/README.md |

Files per chart: `<name>-1920x1080-dark.png` (the video slide; qb8 drops it in
full-frame, the bottom 200 px stay empty for cut.py's caption bar, source line at
y 840), `-1920x1080-light`, `-1080x1350-{dark,light}` (phone), each also as SVG.
`index.html` shows all six, light and dark, phone and desktop, with the numbers
as tables.

**Rules from the draft 1 review:** text roughly double (subline 40 px, labels 44,
values 48, ticks 34, source 26 at 1920×1080), one subline at most, checked at
960×540; neutral about other projects (Bun's way of working is described, never
judged).

**Refresh before the final cut:** edit `data.json` (every number carries its
source) and rebuild. The headlines compute their multiples and shares from it,
so "3.2×", "3.5×", "half", "1 in 6", "3 in 10" follow the data.

Colours: video/contest/slides.html and DESIGN.md tokens. The conflict red is
`#e8655a` dark / `#b4322a` light instead of slides.html's `#e2725b`: against
`--busy` that one measured ΔE 14.1 (below the 15 normal-vision floor of the
dataviz validator); these pass (16.6 / 15.9). The brand accent stays as it is
(light `#17695a` reads low-chroma to the validator; it is used for emphasis, with
labels, never as the only cue).
