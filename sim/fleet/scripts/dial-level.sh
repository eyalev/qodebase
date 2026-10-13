#!/usr/bin/env bash
# One comment-dial level (2026-10-13): reset N copies of VS Code extensions/ to their base, hold-start a dial run on each
# (cache mode, 50 agents per copy, batch 1), start them together, wait until every copy has landed, then collect the
# records, the per-copy status and the dial checker's verdict into ~/.local/share/qbfleet/dial/<label>/.
#   sim/fleet/scripts/dial-level.sh <level 0..0.6> <label> [claims=false] [copies=20]
set -euo pipefail
LEVEL=$1; LABEL=$2; CLAIMS=${3:-false}; N=${4:-20}
K=$(cat ~/.config/qbfleet/key); U=https://qbfleet.forqdev.workers.dev; BASE=785307db28d9ec8bdca32d5fe74ea60696a46f7e
D=~/.local/share/qbfleet/dial/$LABEL; mkdir -p "$D"
post() { curl -4 -s -m 290 -A qbfleet-cli/1 -H "x-fleet-key: $K" -X POST -H 'content-type: application/json' "$U/$1" -d "$2"; }
for n in $(seq 1 "$N"); do (post reset "{\"repo\":\"fleet-vscode-ext-$n\",\"to\":\"$BASE\"}" >/dev/null; post restart "{\"repo\":\"fleet-vscode-ext-$n\"}" >/dev/null) & done; wait
sleep 10
for n in $(seq 1 "$N"); do (post start "{\"repo\":\"fleet-vscode-ext-$n\",\"root\":\"extensions\",\"hold\":true,\"ladder\":\"D-$LABEL\",\"copy\":$n,\"label\":\"comment dial $LABEL - copy $n\",\"dial\":{\"level\":$LEVEL,\"claims\":$CLAIMS},\"agents\":50,\"batch\":1,\"maxFiles\":10000,\"models\":[{\"model\":\"cache\",\"maxPerMin\":1000000}],\"budgetUsd\":0.1,\"planUsdPerMin\":1}" > "$D/start-$n.json") & done; wait
for n in $(seq 1 "$N"); do (post go "{\"repo\":\"fleet-vscode-ext-$n\"}" > "$D/go-$n.json") & done; wait
echo "started $(date -u +%T)"
done_all() { for n in $(seq 1 "$N"); do curl -4 -s -A qbfleet-cli/1 "$U/status?repo=fleet-vscode-ext-$n" | jq -e '.state != "running" and .lander.waiting == 0' >/dev/null || return 1; done; }
until done_all; do sleep 10; done
echo "landed $(date -u +%T)"
exec "$(dirname "$0")/dial-collect.sh" "$LABEL" "$N"
