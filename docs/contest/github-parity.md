# GitHub parity: what qodebase has, what a judge will look for, what to add

Checked 2026-10-12 against the code at `aa6e228` and the live site (`curl -4`, signed out).
Judging: originality + prototype 50%, multi-agent coordination/review/conflicts 25%, UX 25%.

## 0. Broken things a judge will hit (fix first)

1. **Header project link is broken on every project page.** `src/header.ts:24` emits
   `href=""${esc(c.href)}"` (stray quote, landed 2 h ago in `67e8f09`/`9b4542f`). Live HTML on
   `/p/eyal/cafe-team/history`: `<a class="hctx" href=""/p/eyal/cafe-team" …>`, so tapping
   "eyal / cafe-team" in the header reloads the current page. One character, S.
2. **Unknown or owner-only tabs render a Readme that says "This project has no README yet."**
   `/p/eyal/corner-cafe/changes` and `/more` (signed out) fall through to the readme view, but
   `docs` is only loaded when the view is readme/about/none (`src/index.ts` ~line 705), so a
   project that has a README.md says it has none. Redirect to the project root instead. S.
3. **History links go to the fork diff, not the change record.** cafe-team's History "See the
   code" opens `/p/…/changes/<agent>` (intent + plain diff). The rich record (review verdict,
   collision, replay, "what was reviewed vs what landed") lives only at `/work#/change/<id>`.
   corner-cafe's History (scripted demo agents) has no link at all on its commits. See item 2 below.
4. Not verified (needs a real browser, not curl): the `/work` view's JS on a cold phone, and
   `/explore?s=people` (the server 301s `/?s=people`; the panel is client-side).

## 1. GitHub's core functions vs qodebase

Legend, judge column: **E** = a judge will look for it, **N** = nice, **–** = not expected.

| GitHub | qodebase today (verified where) | agent-age equivalent | gap | judge |
|---|---|---|---|---|
| Repo browsing | Code tab, folders + README render: `src/codeui.ts dirPage`, live `/p/eyal/corner-cafe/code/` | same | none | E |
| File view + syntax highlight | hljs tokens, line numbers, `#L` anchors, Raw, size/lines: `filePage`, live `/code/src/routes.js` | — | no "who changed this" from the file | E |
| Blame | none in the code browser. Per-file "Changes to this file" + "Collisions here" exists in Agents at work (`work.js viewFile`, `#/file/<path>`) | blame by intent: each line/file → the change record that wrote it | not linked from the code view | E |
| History / log | History tab: commits, merges, deploys, forks by day (`v3.ts historyView`) | log of landed intents | commits are not tappable; no git notes shown | E |
| Commit view / diff | per-agent fork diff `/p/o/n/changes/<agent>` (`index.ts changesRoute`, `diffTrees`); change record diff with "What landed / What was reviewed" tabs (`work.js viewChange`) | diff of a change record, before/after replay | no `/commit/<sha>` for plain commits (imported repos have none) | E |
| Branches / tags | no branches; each agent fork is a "version" tab in Code (`codeui.ts versionTabs`, `?v=<agent>`) | fork per agent = branch | no tags | N |
| Pull requests | agent change → reviewer agent → merge queue (`src/landing/`); `qb merge` | change record (intent, diff, review, tests) | — (this is the product) | E |
| PR review comments | reviewer agent verdict + notes shown on the record; owner can Approve (`/landing/approve`); `fix` verb re-sends *reviewer* notes (`index.ts` `verb === 'fix'`) | a person's comment = instruction to the agent | **a person can't send a change back with their own note from the record** | E |
| Merge conflicts | land by intent: rule replay, AI replay, owner/lead; collisions shown per file/area | replay the intent on newest main | none; it's the headline | E |
| Merge queue / protected branch | the line: tested trains, failing change bounces alone; main only moves through the queue on landing projects | same, intent-aware | per-area queues are "designed, not built" (README) | E |
| Issues | **Requests** (live 2026-10-13, forq b65edbb; `src/requests.ts`, `src/requestsui.ts`): anyone signed in sends a public project's owner one request (≤1,000 chars, optional screenshot and fork link); the owner's Requests tab (count badge, Inbox notice) sends it to the router as the owner's own request, replies, or closes it (done / not doing it); requesters see status and reply under Your requests. Limits 3 per project / 10 a day per person; private projects never take requests; owner can turn them off. Also: router requests, board task lists + dedupe, Errors tab = Cloudflare Issues → auto fix | issue = an *ask* the owner forwards to agents; triage = router split + duplicate check | no categories, threads, votes or labels (by design) | E |
| Projects / boards | Agent board (`src/landing/board.ts`), Agents at work areas + feed + timeline | live board of who works where | none | N |
| Discussions | none | Talk / router chat | – | – |
| Notifications | "Needs you" section + inbox badge in header (`v3.ts` Global.inbox, `header.ts`) | asked only when something needs a person | no push/email when a change needs you | N |
| Stars / watch / follow | none for qodebase projects; Explore shows GitHub stars of catalogue repos | — | no stars | N |
| Forks | Fork button, fork counts, "Open your fork" (`api … /fork`, `qb fork`) | fork per agent *and* per person | none | E |
| Releases | none; History shows deploys | landed trains as release notes | none | – |
| Actions / CI | merger box runs `.qodebase/landing.json` checks per train (`src/landing/merger.ts`, `mergejob.mjs`) | queue checks on the newest main | no generic workflows (fine) | N |
| Pages / hosting | every project and every fork live on the run host (`src/run.ts`), App tab + per-fork previews; Worker projects deploy (`src/build.ts`) | live app per fork | none; stronger than GitHub | E |
| Wiki | README + docs rendered (`docsOf`, `?doc=LICENSE`) | — | – | – |
| Search: code | per project: go-to-file + FTS5 trigram content search (`codeui.ts gotoBox`, `Project.searchCode`, `qb search`) | — | not reachable outside the Code tab | E |
| Search: repos | Explore has categories/sort only (`src/world.ts`); `?s=` is the Projects/People switch, not a query | — | **no search box over projects** | E |
| README render | yes (`src/md.ts`), Readme tab + under the file list | — | none | E |
| Profiles / orgs / teams | People tab lists owners, links out to github.com (`catalog.ts`); `/eyal`, `/u/eyal` 404 | owner + their agents | no profile page | N |
| Permissions / collaborators | owner-only writes, private projects (`canSee`, `visibility`), agent write tokens scoped to their fork | per-agent scoped tokens | no collaborators | N |
| Settings | `/settings` (key, handle), project visibility/entry/build settings | — | none | N |
| API / webhooks / apps | HTTP API + bearer `qb_` tokens (`/llms.txt`), qb CLI (`cli/qb.mjs`, 20+ verbs), inbound Cloudflare Issues webhook | llms.txt for agents | no outbound webhooks | N |
| Gists | none | — | – | – |
| Clone / push over HTTPS | `qb clone` with short-lived Artifacts token (write on own projects), `git-token` API | — | no plain `git clone <url>` without qb | N |
| SSH keys | none | tokens | – | – |
| License / CoC | LICENSE shown as a doc tab; catalogue shows license | — | none | – |
| Insights / graphs | Agents at work timeline ("How the run went"), landing stats, `/lab`, `/sim`, `/costs` | run timeline, cost per change | none; richer than GitHub's | N |
| Security / Dependabot | Errors tab: production errors → router reproduces and fixes | agents that fix what production reports | no dependency alerts | – |
| Code owners | claims (`qb-agent spawn --files`), areas in Agents at work | dynamic claims instead of static owners | none | N |
| Mobile app | phone-first web, Talk (voice), Build from a prompt, Prism app wrapper elsewhere | phone is the main client | none | E |
| Import | Import from GitHub (`/import`, `qb import`), Explore mirrors 219 repos (`/gh/o/r`) | — | none | N |
| Self-host | `/own` installs a copy into your Cloudflare account | — | none; unique | N |

## 2. Shortlist before the deadline (ranked)

1. **Fix the two live bugs in section 0** (header link, readme fallback).
   Why: every judge taps the project name; a broken header reads as "prototype quality" lost.
   Effort S: `src/header.ts:24`, `src/index.ts` (views route). Risk: none. Phone: unchanged.

2. **History → change records, and git notes visible.** Each landed commit in History (and the
   "See the code" link) opens the change record (`/work#/change/<id>`): intent, review, collision,
   replay, both diffs. Add a one-line "Why: <intent> · reviewed by … · replayed" under each
   landed commit, read from the Landing DO (already has `landing.mainCommit` per change), not
   from git notes. Fixes the README's own "designed, not built: git notes in the code browser".
   Why: makes the core idea (a change is an intent with a record) visible from the most
   GitHub-like screen a judge opens; 25% review/coordination + originality.
   Effort S–M: `src/v3.ts historyView`, `src/index.ts` (pass landing changes keyed by commit).
   Risk: low (read-only). Phone: each row = title, one grey "why" line, tap opens the record.

3. **"Why is this here?" from the file view (blame by intent, file level).** On
   `codeui.ts filePage`, a row under the header: "Changed by 3 changes · 1 collision" linking to
   `/work#/file/<path>` (data exists in `viewFile`). Optional per-line: only for files touched
   by landed records, using the record's diff hunks; skip true git blame (cost, time).
   Why: judges look for blame; this is the agent-age version and costs no new data.
   Effort S (file level) / M (line level): `src/codeui.ts`, `src/index.ts` code route.
   Risk: low. Phone: one tappable line under the filename, not a gutter.

4. **Asks = issues: a list per project.** One screen (section at the top of Agents at work, or
   an "Asks" view in `v3.ts VIEWS`) listing every request the router got and every task on the
   board: text, who asked (person, Talk, Cloudflare Issues), split into N changes, state
   (planning / working / in line / landed / bounced), duplicates marked by the dedupe pass.
   Why: the obvious "where are the issues?" question gets an agent-first answer; shows triage +
   duplicate check (measured in README) in the product. 25% coordination + UX.
   Effort M: `src/v3.ts` (new view), `src/landingui/work.js`, data from Project DO
   `lastRequest`/plan + Landing board tasks (`src/landing/board.ts`). Risk: medium — data for old
   runs may be partial; show only what is recorded, label the rest.
   Phone: a list like the feed — one line per ask, a state dot, count of changes, tap = its changes.

5. **Send back with a person's note, on the change record.** A text box under "The change" on
   `viewChange`: "Ask for changes" → sends the person's note to the agent (extend the `fix` verb
   to accept `notes` from the owner) and logs an event in the record's story.
   Why: human review in the loop is the one PR feature that is missing, and judges score
   "review". 25%. Effort S–M: `src/index.ts` `fix` verb, `src/landingui/work.js viewChange`,
   Landing `reviewed()`. Risk: medium (touches the queue state; test on a scratch project, not
   cafe-team). Phone: a single-line field that grows, one button, sits above the diff.

6. **Search box on Explore** (filter the 219 catalogue entries + qodebase projects by name,
   owner, description; client-side, the page already ships the data) and a link from a project
   page into code search. Why: "search" is a basic expectation; UX 25%. Effort S: `src/world.ts`.
   Risk: low. Phone: a 16 px input pinned above the category chips, no zoom.

7. **Commit view for any commit** `/p/o/n/commit/<sha>`: diff of the commit's tree vs its
   parent with the existing `diffTrees` + `changesPage`; History commit hashes link to it; if the
   commit has a record, a banner links to it. Why: imported repos (tetris, 2048) otherwise have
   no diff anywhere. Effort M: `src/index.ts`, `src/code.ts` (parent tree via `log`),
   `src/codeui.ts`. Risk: low; cap files like `changesRoute` (60).

8. **Owner page `/<handle>` or `/u/<handle>`**: their projects, forks and agents' recent landings.
   Only if time remains. Effort S: registry list by owner already backs `qb ls --owner`.

## 3. Don't build

- **Actions/YAML workflows**: the queue's checks are the CI story; a workflow runner dilutes it.
- **Threaded line-by-line PR comments**: a desktop GitHub idiom, bad on a phone; item 5 is the agent-age form.
- **Discussions, wiki, gists, projects (kanban)**: Talk, README and the agent board cover these.
- **Stars/watch/follow**: no signal with ~15 native projects; would show zeros. (Notifications for "needs you" are worth more, but not in 34 h.)
- **Releases with assets, tags UI**: no projects need them; History already shows deploys.
- **Orgs/teams/collaborators/permissions UI**: real work (auth, Access) and risky now; per-agent scoped tokens are the story.
- **SSH keys / plain git-over-HTTPS without qb**: plumbing judges won't test from a phone.
- **Dependabot/security alerts**: the Errors tab (Cloudflare Issues → agent fix) is the agent-age version; say so in the submission instead.
- **True per-line git blame computed in the Worker**: costly over Artifacts logs and slow; file-level record links (item 3) carry the idea.
