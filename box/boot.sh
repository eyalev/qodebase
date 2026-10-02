#!/bin/bash
# forq agent box boot: Claude Code in tmux session "claude", mobile-agent on
# :7901 (terminal UI), box-api on :7681 (chat + status API). forq's AgentBox
# runs this over exec after cloning the repo (src/box.ts), with its config in
# /tmp/boot.env:
#   SBX_NAME     the box's display name
#   CC_ENV       "CLAUDE_CODE_OAUTH_TOKEN=…" or "ANTHROPIC_API_KEY=… ANTHROPIC_MODEL=…"
#   CC_KEY_TAIL  last 20 chars of that credential (pre-approves it in Claude Code)
#   BILLING      sub | api
#   UI_HOST      forq's UI host (mobile-agent's allowed origin)
# Prints MA_READY and TW_READY when the two servers answer. Idempotent.
set +e
export PATH=/root/.local/bin:/usr/local/bin:$PATH HOME=/root
[ -f /tmp/boot.env ] && . /tmp/boot.env
SBX_NAME=${SBX_NAME:-agent}

mkdir -p /workspace/project /workspace/.claude /root/.config/mobile-agent
[ -L /root/.claude ] || { rm -rf /root/.claude; ln -sfn /workspace/.claude /root/.claude; }

# Claude Code config: onboarding done, this credential approved, folders trusted
# (src/box.ts adds the repo's trust before this runs).
python3 - "$CC_KEY_TAIL" <<'PY'
import json, sys
p = '/workspace/claude-config.json'
try: d = json.load(open(p))
except Exception: d = {}
d.update(hasCompletedOnboarding=True, bypassPermissionsModeAccepted=True)
d.setdefault('theme', 'dark')
t = sys.argv[1] if len(sys.argv) > 1 else ''
r = d.setdefault('customApiKeyResponses', {'approved': [], 'rejected': []})
if t and t not in r.setdefault('approved', []): r['approved'].append(t)
d.setdefault('projects', {}).setdefault('/workspace/project', {})['hasTrustDialogAccepted'] = True
json.dump(d, open(p, 'w'))
PY
ln -sf /workspace/claude-config.json /root/.claude.json

cat > /root/.tmux.conf <<'TMUX'
set -g default-terminal "tmux-256color"
set -ga terminal-overrides ",*:RGB"
TMUX

WORKDIR=$(cat /workspace/.sbx-cwd 2>/dev/null)
[ -n "$WORKDIR" ] && [ -d "$WORKDIR" ] || WORKDIR=/workspace/project

# Resume the newest transcript in that folder (a box restored from a snapshot
# keeps its conversation). Claude Code names the folder after the path.
TDIR=$(printf '%s' "$WORKDIR" | sed 's/[^A-Za-z0-9]/-/g')
SESS=$(ls -t "/workspace/.claude/projects/$TDIR"/*.jsonl 2>/dev/null | head -1 | xargs -r -n1 basename | sed 's/\.jsonl$//')
CC="claude --permission-mode auto"
[ -n "$SESS" ] && CC="$CC --resume $SESS"

# Phone width from the start: 80-column box art can't reflow on a phone.
tmux has-session -t claude 2>/dev/null || tmux new-session -d -s claude -x 60 -y 30 \
  "cd $WORKDIR; export CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1 COLORTERM=truecolor IS_SANDBOX=1 $CC_ENV; ($CC 2>/tmp/cc.err || claude --permission-mode auto); exec bash"
tmux set-environment -g IS_SANDBOX 1
tmux set-environment -g CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN 1
tmux set-environment -g COLORTERM truecolor
for KV in $CC_ENV; do tmux set-environment -g "${KV%%=*}" "${KV#*=}"; done
tmux set-option -g default-command "exec bash"
# The credential has reached tmux; don't leave it in a file.
sed -i '/^CC_ENV=/d' /tmp/boot.env 2>/dev/null

# Dismiss first-run prompts (default choices) until the input is up. Never the
# folder-trust prompt: its default is "No, exit" (forq pre-writes the trust).
( for i in $(seq 1 30); do
    P=$(tmux capture-pane -t claude -p 2>/dev/null)
    echo "$P" | grep -qE "Choose the text style|Detected a custom API key" && tmux send-keys -t claude Enter
    echo "$P" | grep -q "for shortcuts" && break
    sleep 2
  done ) >/dev/null 2>&1 &

# mobile-agent: the Terminal tab. Bound to 0.0.0.0 so the Durable Object's
# port fetch reaches it; only forq's UI host may open its websocket.
if ! curl -sf -o /dev/null --max-time 2 http://localhost:7901/; then
  setsid env MA_DEFAULT_CWD="$WORKDIR" node /opt/mobile-agent/apps/mobile-agent/bin.js \
    --bind 0.0.0.0:7901 --app-name "$SBX_NAME" \
    --home-url "https://${UI_HOST:-localhost}/" \
    --allow-origin "${UI_HOST:-localhost}" < /dev/null >> /tmp/ma.log 2>&1 &
fi
for i in $(seq 1 30); do
  curl -sf -o /dev/null --max-time 2 http://localhost:7901/ && { echo MA_READY; break; }
  sleep 1
done

# box-api: the Chat tab and the status lines.
if ! curl -sf -o /dev/null --max-time 2 http://127.0.0.1:7681/api/build-info; then
  setsid env HOME=/root PORT=7681 node /opt/box-api.mjs < /dev/null >> /tmp/box-api.log 2>&1 &
fi
for i in $(seq 1 20); do
  curl -sf -o /dev/null --max-time 2 http://127.0.0.1:7681/api/build-info && { echo TW_READY; break; }
  sleep 1
done
