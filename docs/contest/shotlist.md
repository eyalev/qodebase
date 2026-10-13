# Contest video: shot list (owner qb3; plan approved by Eyal 2026-10-13)

Mostly real product footage; the deck (qodebase.app/deck) is only short framing. Recording Oct 14 ~09:00 UTC.

**Length: 5:00–5:30.** The contest asks for a 5–10 min video (PLAN.md, video.md). The manager's brief said ~3–5 min,
so this list aims just over the 5-minute minimum: a cut under 5:00 would break the rule. Scene lengths below add up
to ~5:15; if a take runs short, scene 4 grows (more of the deck), never below 5:00 in total.

**Every fast-forward** gets a visible clock (real elapsed time, mm:ss) and an `N×` label in the corner, burned in at
compose time; real-time stretches show no label. Footage is recorded at 390×844 (phone emulation, 2× pixels) and
placed in the 1920×1080 frame as in the old pipeline (video/compose.py: phone left, caption right).

**Claim on film only what exists.** Each scene lists what it depends on; the "status" column is to be confirmed by
the owner tab before 08:30 UTC Oct 14. Anything not ready is cut or replaced as the retake plan says, never faked.

## Scenes

| # | length | on screen | Eyal says (voice-over or into Talk) | what must happen | speed |
|---|---|---|---|---|---|
| 1 | 0:20 | Deck slide 2 (Overview), then slide 1's merge animation | "Agents write code faster than pull requests and review can land it. With many agents, order and collisions break the flow. qodebase lands each change by what it was asked to do." | Deck in `?rec=1&theme=light`, advanced by keyboard | real time |
| 2a | 0:20 | Home on the phone, mic | Into Talk: "Build me a home inventory app with a team, and let people pay for a pro plan with Stripe." | Talk fills the build box, opens Build | real time |
| 2b | 0:20 | Build settings: team preset, the estimate (time + cost range) | "It picks a team and tells me roughly how long and what it costs." | Team preset chosen; estimate visible; Build tapped | real time |
| 2c | 0:30 | Agents at work: pipeline columns filling, the latest line | "Each agent takes one part. Collisions are redone on the newest code, not sent back." | Agents start, first changes reach review/line | 8–12× (clock + label) |
| 2d | 0:15 | An Ask (X5 question card) and the answer by voice | Into Talk: "Use Stripe test mode; here is the test key." (test key only) | A real `ask-person` appears in Asks; answered; the agent continues | real time |
| 2e | 0:25 | **Money moment**: into Talk "Add a dark mode" mid-build; it lands on top | "Mid-build I ask for one more thing. It lands on top of the rest, and nothing breaks." | The dark-mode change goes through review and the line while others are still working; tests pass; it lands | 8× then real time for the landing |
| 2f | 0:20 | App tab: the live app in dark mode; then one change record (what it was asked, review, replay, tests) | "The app is live, and every change keeps its record." | App preview loads; one collided-and-redone change opened | real time |
| 2g | 0:10 | Timeline of the run | "The timeline shows where the time went." | Timeline tab with the critical path | real time |
| 3a | 0:15 | Into Talk: "Document every exported function in VS Code's editor and add each one to the API index." → the confirm card (agents, files, estimate) → Start | "Now a thousand agents." | Confirm card shows the agent count and cost; Start | real time |
| 3b | 0:20 | /runs live: agents at work, files landed, collisions per minute, replays | "Every agent writes its comment and one line in a shared index, so they collide all the time." | Counters climb; collisions and replays non-zero | 4× (clock + label) |
| 3c | 0:15 | Intents tab of the run: job → folders → files; stuck first | "With a thousand agents you browse intents, not agents." | Tree with roll-up counts | real time |
| 3d | 0:15 | One collision → its replay → the diff | "This one collided on the index; it was redone on the newest code." | A real replayed change with its diff | real time |
| 3e | 0:10 | The checker's result: every entry once, nothing lost | "At the end, a checker reads main: every function in the index once, nothing lost." | Checker output on the run page | real time |
| 4 | 0:40 | Deck: wrap-up "What we proved" (three layers), then "Try it" | "Thousands of agents on Cloudflare, hundreds with real code collisions checked by tests, real Claude teams of up to forty building apps. Try it: watch a run with no sign-in." | Deck slides 27 and 29 | real time |
| | **~5:15** | | | | |

Depends on, to confirm by 08:30 UTC Oct 14 (owner in brackets):
- 2a voice build with a team preset from Talk [qb2]; 2b estimate on Build [qb7, qb4]; 2d a real `ask-person`
  during the build [qb6, X5] (the prompt or the task must make an agent need a real decision: a secret or money);
  2e mid-build request landing on top [qb6]; 2f App preview of a team build [qb7].
- 3a the 1,000-agent job from Talk with a confirm card [qb2, qb6]; 3b collisions/min and replays on /runs [qb6];
  3c Intents on a run [qb5, deploy with 5f0bb2d]; 3e the checker's "every entry once, nothing lost" [qb6, qb4];
  the run's cost cap set before Start [qb6].

Status (qb6, Oct 13 evening):
- **2d ready**, but only if the build needs a real decision. Scene 2a's phrase therefore becomes "Build me a home
  inventory app with a team, and let people pay for a pro plan with Stripe": an agent then asks for the Stripe key
  (bell, Inbox and the change). The answer by voice is "use Stripe test mode, here is the test key" (a test key
  only, never a live one on film).
- **2e ready:** requests during a build queue and land through the same merge queue (seen in R5–R8b).
- **3a fleet side ready** (job 'comments+index', qb7's form, /api/runs/start); Talk's confirm card is qb2's, open.
- **3b data ready** (collisions per 10 s, wait p90, door on the run's series; an index test re-inserted 494 index
  collisions by intent); how /runs shows it is qb7's, open.
- **3e ready as an API:** GET /api/runs/<repo>/<run>/indexcheck → {lines, expected, sorted, missing, twice}
  (index test: 1,173 of 1,173, sorted, 0 missing, 0 twice). On screen it needs a line on the run page [qb7], or
  scene 3e shows the numbers as a caption read from that response.
- **Cost cap ready:** budgetUsd on the form plus the fleet's $50/day cap; a 1,000-agent run on src/vs/editor costs
  ~$0.15–0.25.
- **Pre-flight:** gateway limit 3,000/min stays up for the take; copy fleet-n2-vscode-src-1 is reserved
  (src/vs/editor = 659 files at its base); nobody runs on it before the take.

Status (qb7, Oct 13 evening; everything below ships with qb6's first deploy after the code-dial freeze):
- **3b live (forq 6355cc6):** each run's timeline gets a 'Collisions per 10 s' row (red bars, total) and the count in a moment's
  facts; replays appear as a line once qb6's series carries them.
- **3e live (forq 6355cc6), shows on the comments+index job only:** 'API index (docs/API.md): 1,173 of 1,173 lines, sorted, none missing, none twice.' from
  the indexcheck route (that route is qb6's, deploying after the freeze).
- **2b live:** Build settings and the estimate bar on the project.
- **2f live:** X1 in the App tab: a waiting note, then 'More is coming: N of M parts landed…', 'Show the new parts'.
- **3a:** Talk's fleet job fills the New fleet job form with the sentence and picks VS Code src/vs/editor (fix in the
  same deploy). Whether a Talk confirm card shows first is qb2's, open.

## Pre-flight (08:00–08:45 UTC)

- **Accounts:** Eyal signed in on qodebase.app in the recording browser (the debug Chrome profile, not his daily one);
  Claude plan connected for the team build; the fleet gateway's limits raised for the 1,000-agent run [qb6].
- **Projects:** a fresh project for the team build (no history), name decided in advance (e.g. `home-inventory-demo`);
  a fresh fleet target copy of VS Code `src/vs/editor` for scene 3 [qb6]. Never film other people's projects.
- **Nothing private in shot:** no emails, tokens, the Talk version label (`#talk-ver`), browser bookmarks or tabs;
  the address bar hidden (phone emulation shows no chrome).
- **Phone settings (if any part is filmed on the real phone):** Do Not Disturb on, battery > 50%, brightness max,
  dark/light mode fixed to the take's theme, notifications from other apps off, screen timeout ≥ 10 min.
- **Laptop:** Do Not Disturb, other agent tabs told not to deploy between 08:45 and the end of the take (a deploy
  kills running containers) [all tabs via cc-com], uplink not saturated (`uplink-shape status`).
- **Voice:** quiet room, the same microphone for Talk and the voice-over; a 10 s level test.
- **Test take (08:30):** run scene 2a–2c for 2 minutes on a throwaway project; check the clock overlay, the
  estimate, that Talk hears the phrases; then delete or keep private.
- **Budget:** team build ≈ $3–5 (R8 was $3.52), the 1,000-agent fleet run capped (≈ $5–10 at today's fleet rate of
  ~$0.6 per 1,000 file changes; cap set on the run) [qb6].

## Recording and retakes

- Record each scene as its own clip (Playwright or screen capture at 390×844, 2×), then compose; the voice-over is
  recorded separately and laid over, so a scene can be retaken without re-recording the others.
- **Retake rules:** a scene that shows an error, a stall over 2 min, or anything private is retaken. A build that
  fails mid-way is not hidden: if it cannot be redone in time, show the honest result with one caption line.
- **Fallbacks, in order, if a dependency is not ready by 08:30:**
  - 2d no real Ask → cut 2d (the deck's Asks slide covers it in scene 4).
  - 2e mid-build request not reliable → film it on the finished build ("add a dark mode" to the landed app), say
    "after the build" instead of "mid-build".
  - 3a no confirm card → start the run from /runs and say so.
  - 3e no checker output → cut 3e; never claim "nothing lost" without it.
  - The whole of scene 3 not ready → use the recorded S5 v2b run on /runs (real, finished) with "a recorded run"
    on screen.
- Two complete takes of scene 2 if time allows; pick the cleaner one.

## After recording

- Compose (video/compose.py), captions = what Eyal says, `.srt` alongside; loudnorm −16 LUFS.
- Check the cut at 50% size: every number legible, every fast-forward labelled, total ≥ 5:00.
- Export 1080p30 H.264 + AAC; upload copy per video.md.
