# forq design v2: three variants (2026-10-02)

Eyal asked to rethink forq's UI from first principles: simple, "don't make me
think", researched, with a few variants on their own preview deployments to
compare.

## Compare them

| variant | URL | idea |
|---|---|---|
| A, App first | https://forq-a.kapps.dev | the running app is the page; one bar at the bottom: what needs you, and "Ask for a change" |
| B, Task list | https://forq-b.kapps.dev | the app in a frame, then a Codex-style list of changes, each with one button |
| C, Chat | https://forq-c.kapps.dev | tabs Changes, App, Code; Changes is a conversation with your requests and the changes they started |

Each has a sample page with every state at once: `/design-fixture`
(`?state=planning`, `?state=empty`). Real projects work too: sign in once on
each host, since the sign-in is per host.

How it works: each URL is a tiny Worker (`variants/`) that forwards everything
to the forq Worker over a service binding, adding `x-forq-ui: a|b|c`. forq
renders `src/v2.ts` for that header and the current pages without it, so
production `forq.kapps.dev` is unchanged, and the variants show your real
projects and agents. Sign-in on a variant host goes through the real
`/login` and comes back with a 2-minute token (`/session`), because the
session cookie is per host.

## What the research said

- **Codex in the ChatGPT app**:
  - Tasks are a list, each with a summary, a diff and one push (Create PR) button.
  - The 2026 updates added a "Needs input" status and "consistent task terminology".
  - Lesson: the unit is the task, statuses are plain words, and each task has one action.
- **Cursor's web and mobile agents**: a list of agents with their status, plus follow-ups. The phone list is a simplified version of the desktop one.
- **Lovable, Replit**: chat next to a running preview. The app being built is always in view.
- **Krug, Don't Make Me Think**:
  - self-evident before self-explanatory;
  - pages are scanned, not read;
  - "get rid of half the words, then half of what's left";
  - use conventions.

## First principles

Someone on forq does three things: **use the app**, **ask for a change**, and
**decide on a change** (try it, merge it, or send it back).

forq's current page is honest about its machinery: router agent, reviewer
agent, agent ids, boxes, preview tabs, "its task, from the router agent". Every
card shows six buttons. That is right for debugging, and it makes the person
think. So every variant:

- **Speaks in changes, not agents.** A change has a title (its task's first
  sentence) and one state word.
- **Gives each state at most one primary button:**

  | state | primary button |
  |---|---|
  | Working | none |
  | Checking (the reviewer is on it) | none |
  | Ready to merge | Merge |
  | Needs a fix | Ask to fix |
  | Needs your answer / Waiting for you | Reply |
  | Paused | none |
  | Merged | none |

- **Puts what needs you first** (A and B). In C, order is time, because it
  is a conversation.
- **Moves the rest one tap deeper:** tap a change for what it did, what the
  check said and what you asked, then Try it, See the code, Talk to its agent,
  and Merge anyway. Router and reviewer agents sit under About or Code.
- **Cuts the words:**
  - "Tell the router agent what to change. It splits the work and starts one agent per task" becomes "Ask for a change".
  - "Router agent: Working on it 12s" becomes "Planning your request 12s".
  - A merge shows as "Merging", never as a message you didn't type.
- **Keeps the tokens.** DESIGN.md's colours, type, radii and freshbar stay.
  This is a structure change, not a reskin.

## Critique and what changed (same day)

A separate design-review agent looked at all three variants at 390 px (light
and dark) and at 1440 px. I fixed its blockers and high-priority items:

- **Trying a change was unclear.**
  - In A, the banner covered the app's own title.
  - In C, there was no sign at all that you were looking at a change.
  - Fix, in all three: a strip above the app that says "Trying <title>", with Merge (only when the change is ready) and Back to live.
- **Too many green buttons.**
  - Only the page's most urgent change gets the accent button; the other rows get chips.
  - Send stays grey until you type.
  - Merge anyway, See the code and Talk to its agent are now quiet links.
- **"Needs a fix" and "Needs your answer" looked like the other states.** They
  get their own colour, `--warn` (`#b42d1f` light, `#f08a7e` dark). The order
  is now: waiting for your answer, needs a fix, ready, then work in progress.
- **A's bottom bar said too much.** It now shows only the most urgent thing,
  with its state's dot.
- **On desktop:**
  - A shows the app on the left with the changes always open on the right.
  - C keeps the conversation in a 720 px column.
  - B already had a column.
- **C:**
  - A pinned "N need you" bar at the top jumps to the card, because time order can push those cards out of sight.
  - The pill shapes are gone, which DESIGN.md forbids.
  - Request bubbles are grey, not accent green.
  - A visitor gets no tabs.
- **B:**
  - The owner's app frame is 38 dvh, so the changes show without scrolling.
  - The ask box is one row.
- **All three:**
  - A one-line explanation for visitors.
  - A freshbar legend under the change lists.

The reviewer's recommendation: for the owner, **A's shape with B's rows** (the
app always visible, one status line pointing at the most urgent change); for a
visitor, **B's header** (name, description, the app in a frame, fork as the
clear next step). C's grouping by request is real context, but in time order
it hides what is waiting for you.

## Status

Built, reviewed and deployed 2026-10-02. Production `forq.kapps.dev` still
serves the old pages. Screenshots: `video/out/design/` (not in git), made by
`video/design-shots.mjs`. Waiting on Eyal's pick. After that: make the chosen
variant the default, fold `--warn` into DESIGN.md, and delete the variant
Workers (`forq-ui-a/b/c`) and `/design-fixture`.

Cost: three tiny forwarding Workers on the existing Workers plan. They only
run when someone opens a variant URL.

## Views (variant C, chosen 2026-10-02)

Eyal picked C, for its tabs: "will give us more flexibility". C was rebuilt as
**views** (`src/v3.ts`) at https://forq-c.kapps.dev. The first chat take stays at
https://forq-d.kapps.dev for comparison.

- **Each view is its own URL:**
  - `/p/<o>/<n>/changes`, `/app`, `/history`, `/more`, `/agents`, `/errors`, `/about`;
  - Code is the code browser at `/p/<o>/<n>/code/`, which keeps the tab bar.
  - The back button works and every view can be linked.
- **Tab bar:** at the bottom on a phone (it hides while you type), a left rail
  on desktop.
  - The owner gets Changes, App, Code, History, More.
  - A visitor gets App, Code, History, About.
  - Changes carries a red badge with the number of changes that need you, on every view.
- **Views are a registry:** each has an id, label, icon, `when` (Agents for the
  owner, Errors for Worker projects) and `render`. Adding a view is one entry.
- **Changes** shows only work in progress, as a conversation that opens at the
  newest message. It uses a `column-reverse` scroller, so it starts at the bottom
  without script; this fixes the bug in Eyal's screenshot. Merged changes are
  one link away, in History.
- **App:** the running app, with a picker for Live or any change you can try,
  and Merge when the change you picked is ready.
- **History:** merged changes, commits, the deploy, forks and the project's
  origin, by day.
- **Agents** (under More): the router, the reviewer and each change's agent,
  with Chat and Terminal.
- **Errors** (Worker projects, under More): Cloudflare Issues reports and the
  fixes they started.
- **The project opens on** Changes for the owner and App for a visitor.
  Remembering the last view used is not built yet.

Later: projects that ship their own views, declared in the repo.
