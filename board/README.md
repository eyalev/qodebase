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
