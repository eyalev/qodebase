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

## Status

Built and deployed 2026-10-02. Screenshots: `video/out/design/` (not in git),
made by `video/design-shots.mjs`. Critique and the decision: below, once made.
