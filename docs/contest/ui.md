# Landing UI (owner: qb7)

Read ../../CLAUDE.md, DESIGN.md (tokens are law; mobile first at 390 px), docs/design-v2.md,
docs/contest/PLAN.md (story + the JSON contract), and look at qodebase.app/sim/run (the sim
viewer: its overview -> folder -> file -> change drill-down is the starting point).

## Goal
A regular person watching the video, or opening the page on a phone, understands within
seconds: many agents are working on this project at once; here is where; here is what is
waiting, being tested, landing; this one hit a conflict and the system replayed it; tap
anything to see why. Overview first, details on tap.

## Checklist
- [ ] Mock data (public/landing-mock.json) in the PLAN.md contract shape, rich enough to show
      every state (working, queued, testing train, landed, bounced, replayed, with lead, stacked).
- [ ] Overview (project page, new "Agents at work" view): live numbers in plain words, the
      merge queue as a visible train, a map of the codebase showing who works where (claims,
      activity, recent conflicts/landings), a feed of plain-language events ("Agent 7's change
      collided with Agent 3's on routes.ts; replayed on the latest code; tests passed; landed").
- [ ] Drill-down: area -> file -> change record (intent in words, the diff, review verdict,
      tests, how it landed incl. "replayed", the stack it belongs to). Back always works.
- [ ] A short explainer layer for non-programmers (one-line captions, a legend; no jargon
      without a gloss: "merge queue = the line changes wait in to be tested together").
- [ ] Live updates (poll or WebSocket), smooth enough for video; demo-mode banner ("scripted agents").
- [ ] Screenshot gate: 390 px + 1440 px, light + dark, every state; `/interfaces:break` on new
      components; a critique by a different agent before shipping.
- [ ] Switch from mock to the real API when qb6 serves it.
Ask qb6 (cc_com) for deploys. Commit by explicit path; you own src/landingui/* and the mock.
