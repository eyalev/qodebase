# Contest video: storyboard and script (owner: qb8)

Target **7:30** (limit 5-10 min). Viewer: a smart non-programmer (a judge watching
twenty of these). One idea per scene, every claim on screen as a number with its
source. Captions carry the whole story (voice-over optional, reads the same words).
Spec for frames, captions, pacing: `docs/video-guide.md`. Build: `video/contest/`.

Judging, and where each part is answered:
- **Originality + prototype quality (50%)**: "measured, then built" (scenes 2-3), the
  working product on a phone (scene 4), self-hosting on your own Cloudflare (scene 5).
- **Concurrency, coordination, context preservation, review, conflicts (25%)**: forks per
  agent (concurrency), claims + queue (coordination), the change record kept as git notes
  (context), reviewer agent verdicts (review), land by intent (conflicts). Each is named
  in scene 3 and shown in scene 4.
- **Ease of use (25%)**: everything filmed on a 390 px phone; plain words; tap to drill down.

Numbers marked **[final Oct 12]** come from qb4/qb5 runs still in progress and are
refreshed from `public/sim/runs/index.json` and `sim/bun/calibration.json` before the
final cut.

---

## 0. Cold open: the end result (0:00-0:20)

| on screen | caption |
|---|---|
| Phone: the project's "Agents at work" overview, busy: agents working, a train in the queue, changes landing. Label "scripted agents" visible. (Draft: cloud-500 run in the sim viewer.) | 50 agents are changing one app at the same time. |
| Same, a change lands (accent flash on the map). | None of them waits for a person. None of them breaks the app. |
| Title card: **qodebase** / a git platform for the age of agents | — |

## 1. The problem (0:20-1:20)

| on screen | caption |
|---|---|
| Slide: one person, one pull request, a reviewer. Small and calm. | Git and pull requests were built for people: a few changes a day, each one read by someone. |
| Slide: the same picture with 50 agents, arrows piling into one line. | AI agents write code now. One person can run fifty of them. |
| Slide **collision**: two agents each add one line to the end of the same list (`routes.ts`). Both fine alone; together git says CONFLICT. | Two changes, each fine on its own, collide when they meet. |
| Slide **ordering**: change B uses something change A adds; A has not landed. | Or one change needs another that has not landed yet. |
| Slide: the question. | So we asked: what actually goes wrong when many agents work on one codebase? And we measured it before building anything. |

## 2. What we measured (1:20-3:10)

Four experiments, one screen each, then one takeaway. No model calls in any of them.

| on screen | caption |
|---|---|
| Slide **Hono** (chart A): bars for 1 / 10 / 50 / 100 PRs opened at once: "needed another PR first" vs "real git conflict". [final Oct 12] | We took the last 500 real pull requests of Hono, a popular web framework, and replayed them as if 100 had been opened at once. |
| (chart A, highlight) | Git conflicts almost never happened. Half the changes needed another change to land first. The problem is order, not conflicts. |
| Slide **Bun** (stat tiles): 64 Claude agents, 6,755 commits, 11 days, 81% on one shared branch, 9 s apart. | Bun's real port to Rust: 64 AI agents, 6,755 commits in 11 days. They gave up on branches: 81% of commits went to one shared branch, agents splitting files by hand. |
| Phone: sim viewer, real-git run, 500 agents, "Agent review": map lights up with conflicts on `routes.ts`, `schema.ts`, `package.json`. | Then we built a real codebase and let 500 scripted agents change it, with real git and real tests on every merge. |
| Phone: tap the hot shared file; its lane is full of conflict ticks. | The conflicts pile onto a few shared files, the lists everyone appends to. |
| Slide chart B: landed per hour, 500 agents, real git, by policy: agent review 242, claims + trains 224, team leads 290, land by intent 849. | We tried four ways of landing those changes. Landing by intent got 3.5× as many in per hour as review-then-merge. |
| Phone: sim viewer, "On Cloudflare, land by intent, 500 agents": numbers ticking. | Then we ran it for real on Cloudflare: 500 agents, each its own Durable Object and its own git fork in Artifacts. |
| Slide chart C (stat tiles): 500 forks, 7,033 pushes, 280 ms median, 0.1% failed; the ceiling: one queue at ~11 landings/s. | 7,033 pushes from 500 forks at once, 280 ms each. Git on Cloudflare held up. Our single merge queue was the ceiling, so it gets split by area. |

## 3. The idea (3:10-4:20)

One slide per idea, the same small diagram growing (a fork, a record, a line, a replay, a map).

| on screen | caption |
|---|---|
| Fork per agent. | Every agent gets its own copy of the code, a fork. Agents never share a working folder, so they never trip over each other. |
| The change record: intent + diff + review + tests, pinned to the commit (git notes). | Every change carries a record: what it was meant to do, the diff, the review and the tests. It stays with the code as git notes, so the "why" is never lost. |
| Reviewer agent verdict on the record. | A reviewer agent reads every change and writes its verdict into the record. |
| Merge queue as a train. | Approved changes wait in one line, the merge queue, and are tested together in trains before they reach the main code. |
| Land by intent: the collision from scene 1 again; the queue re-applies "add the /tips route" on the latest code; tests pass; lands. | When two changes collide, the queue doesn't send the work back. It re-applies the reviewed intent on the latest code, tests it, and lands it. |
| Claims map + stacking arrow. | Agents see who is working where before they start, and a change can build on one that hasn't landed yet. |

## 4. Live demo on the phone (4:20-6:30)

Recorded from the real demo mode (qb6 scripted agents, qb7 UI) on qodebase.app. Every
shot carries the "scripted agents" label; sped-up parts carry the ×N badge.

| on screen | caption |
|---|---|
| Project page, tap "Agents at work". Overview: numbers in plain words, the queue train, the codebase map. | This is a real project on qodebase. Twenty agents are working on it right now. |
| Start the demo (agents: 20, speed). Time-lapse ×8. | They're scripted for this video: real commits on real forks, through the real queue, no AI bills. |
| Map: tap an area. Area: files, who claims what. | Tap any part of the code to see who's working there. |
| Tap a file, then a change: its record (intent in words, diff, review verdict, tests). | Every change explains itself: what it was for, what it changed, what the reviewer said. |
| Feed: "Agent 7's change collided with Agent 3's on routes.ts; replayed on the latest code; tests passed; landed." Tap it. | Here two agents collided on the same file. |
| The change record: "landed: replayed", the diff-of-diffs if different. | The queue replayed the reviewed change on the latest code. Tests passed. It landed with no one involved. |
| A bounced train: failed test, back to the agent. | When tests fail, the train bounces and the change goes back. Main never breaks. |
| Router: type "add a dark mode and a share button" on the phone; two agent cards appear (existing footage w1, or fresh). | And you steer it all by talking to it, from your phone. |
| Overview at the end: N landed, median time ask-to-land. | 120 changes landed in 10 minutes. [real numbers from the run] |

## 5. How it runs on Cloudflare (6:30-7:10)

| on screen | caption |
|---|---|
| Diagram: Worker (site, API, live app hosts) / Durable Objects (each project, its queue, each agent) / Artifacts (main repo + one fork per agent, git notes) / Containers (Claude Code boxes, the merger box) / Workers AI (Talk: speech in and out, the fast picker). | All of it runs on Cloudflare: Workers serve it, Durable Objects keep every project and agent, Artifacts holds every repo and fork, Containers run the agents, Workers AI does voice. |
| Phone: "Get your own qodebase": installs into your Cloudflare account. | And anyone can install their own copy into their own Cloudflare account in a few minutes. |

## 6. Close (7:10-7:30)

| on screen | caption |
|---|---|
| Card: "We measured it, then built it." | We measured it, then built it. |
| End card: qodebase.app / github.com/eyalev/qodebase / Apache-2.0 | qodebase.app. Open source. |

---

## Production notes

- **Format:** 1920×1080, 30 fps, H.264 (spec in docs/video-guide.md), burned-in captions +
  `.srt`. Phone scenes: phone left, caption right (compose.py). Slides: full frame, caption
  in a bar at the bottom.
- **Slides** (`video/contest/slides.html`): Geist + JetBrains Mono, DESIGN.md dark tokens
  (`--bg #0c0d0e`, `--acc #4fbf9f`, `--busy #e0a948`), charts as inline SVG, numbers
  from the data block at the top of the file (each with its source path).
- **Draft cut (pacing):** scenes 0-3 and 5-6 complete; scene 4 as placeholder cards with
  the planned captions, timed as they will run.
- **Voice-over:** optional; if added, it reads the captions and the timing follows the
  captions (no new words).
- **Never in shot:** emails, tokens, the owner label with shas, other people's projects.
