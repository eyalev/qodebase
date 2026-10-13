# Talk workflow harness

Voice-agent workflows across qodebase, tested without speaking. Each scenario opens a start page on the **live** site in
real Chrome at 390 px, signed in as Eyal, says a sequence of turns to Talk and checks what happened.

```
npm run talk:e2e                    # every scenario (~50, ~15 min)
npm run talk:e2e -- nav-mine        # one scenario by id (or a group name / substring: runs, deck, idea-)
node scripts/talk-e2e/run.mjs --list
```

Flags: `--headed` (watch it), `--out <dir>`, `--base <url>`, `--allow-writes --project owner/name` (sandbox only).

**Session:** the `forq_session` cookie is copied from the debug Chrome on :9222, so sign in there once. Each scenario
runs in its own headless Chrome with a fresh profile, so it never opens tabs in a window someone is using, and
localStorage never carries over from one scenario to the next.

**Writes never reach the server.** Every non-GET request to the site is answered by the harness and recorded as a
`write` (so "yes" on Watch a run shows `POST …/landing/watch`, and no build, fleet job, request or change is started).
These requests do go through, because they only answer:
- Talk's decide, chat, status, summary and transcribe, and the conversation title;
- the idea and settings suggesters;
- the fleet estimate and count.

Talk's trace, logs and recordings are answered here too, so Eyal's own trace stays clean. The trace rows are kept in the
results, and the `latency` row of a spoken turn gives the time per stage. `--allow-writes --project eyal/x` lets writes
under `/api/p/eyal/x/` through, for a sandbox project only.

## Scenarios (`scenarios/*.json`, one file per group)

```json
{ "id": "watch-run", "title": "…", "start": "/p/eyal/corner-cafe", "ls": { "qb-talk-…": "…" }, "audio": "~tts01-thalia-x1.0",
  "turns": [ { "say": "watch a run", "via": "webmcp|live|tap|audio", "expect": { … } } ] }
```

**How a turn is said:**
- `webmcp` (the default): `__webmcp.call('talk')`, the same `submit()` that typed text goes through.
- `live`: qb2's test hook into the live-words pipeline (`__talkTest.live`). It falls back to `webmcp` until the hook
  ships.
- `tap`: taps a selector.
- `audio`: a WAV file plays as the microphone in conversation mode. `~name` points to qb2's synthetic Aura clips
  (`TALK_E2E_AUDIO_DIR`); they are never kept in this public repo.

**Expectations:**

| key | what it checks |
|---|---|
| `lane` | `mode/op` from the decide, or a bare `op` or mode; a list means any of them |
| `nav` | a URL regex; HTTP 200 for the navigation and the page finished loading (`{url, hash:true}` for in-page routes) |
| `stay` | the page did not change |
| `fields` | `{label or css:sel: regex}`, read from the value, checked, aria-checked/pressed/selected or the text |
| `answer_has`, `answer_not` | regexes over the answer and the Talk log |
| `spoken` | `once` (something was spoken) or `none` |
| `confirm` | an offer is shown and nothing was written in that turn |
| `offer`, `no_offer` | what the offer says, or that there is none |
| `writes`, `no_writes` | the requests that would have been sent |
| `max_ms` | how long the answer may take |

Checked on every turn, whatever the scenario says:
- no "Did you say";
- no audio overlap (one element starts while another is still playing);
- the same sentence is not spoken twice;
- no page errors.

Spoken replies are on for typed turns too (`qb-talk-when=always`), so "spoken once" can be tested.

## Output

`~/.local/share/qodebase-talk-e2e/<UTC stamp>/` holds:
- `results.jsonl`: one line per turn, with the decide row, writes, audio, fields, URL and ms per stage;
- `table.md`: one row per scenario;
- `fail-<id>-<turn>.png` for each failing turn.
