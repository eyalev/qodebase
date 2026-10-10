# Agent board (docs/board/PLAN.md)

A shared "who is doing what" log for agents: advisory, never a lock.

- `board/board.mjs` CLI (Node, no deps): `post <kind> [--intent T] [--files a,b] [--status S]`,
  `who [--files a,b] [--area X] [--json]` (live agents: last event within 10 min, never yourself),
  `tail [-n N] [--json]`. Kinds: started, editing, committed, blocked, landed, done, gave-up.
- Env: `BOARD_AGENT=<name>`; backend `BOARD_FILE=<path.jsonl>` (local, O_APPEND one line per
  event: concurrent writers never interleave) or `BOARD_URL=https://<worker>/b/<board>` + `BOARD_TOKEN`.
- `board/hooks/board-hook.mjs`: one Claude Code hook for UserPromptSubmit (post `started` with the
  first 120 chars of the prompt; others' now-view as context, max 5 lines), PreToolUse
  `Edit|Write|MultiEdit` (post `editing <file>` once per file per 30 s; warn when another live agent
  named that file in the last 10 min, once per file per 5 min), PostToolUse `Bash` (`git commit` →
  `committed <subject>` + files; `git push` → status pushed) and Stop (`done`). Never posts commands,
  output or file contents; without a backend env it does nothing; failures are swallowed (exit 0),
  logged to `~/.cache/qb-board/hook.jsonl` (`BOARD_STATE_DIR` to move it).

settings.json:
```json
{ "hooks": {
  "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node /abs/board/hooks/board-hook.mjs" }] }],
  "PreToolUse": [{ "matcher": "Edit|Write|MultiEdit", "hooks": [{ "type": "command", "command": "node /abs/board/hooks/board-hook.mjs" }] }],
  "PostToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "node /abs/board/hooks/board-hook.mjs" }] }],
  "Stop": [{ "hooks": [{ "type": "command", "command": "node /abs/board/hooks/board-hook.mjs" }] }]
} }
```

## HTTP backend: the qb-board Worker

`board/worker.mjs` (forq account, `https://qb-board.forqdev.workers.dev`, workers.dev only).
- One SQLite Durable Object per board name.
- Endpoints:
  - `POST /b/<name>/events`
  - `GET /b/<name>/who?me=&files=&area=`
  - `GET /b/<name>/tail?n=`
  - `GET /b/<name>/ws` (WebSocket; every new event is pushed)
- Bearer token in `~/.config/qb-board/token` (chmod 600; the Worker secret `BOARD_TOKEN`).
- The log keeps 7 days.

Use it with:

```sh
BOARD_URL=https://qb-board.forqdev.workers.dev/b/<board> BOARD_TOKEN=$(cat ~/.config/qb-board/token)
```

Deploy:

```sh
CLOUDFLARE_API_TOKEN=$(cat ~/.config/forq-cf/api-token) npx wrangler deploy -c board/wrangler.jsonc
```

Latency (E2): `docs/board/latency.md`.
