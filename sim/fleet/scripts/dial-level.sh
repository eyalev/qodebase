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
for n in $(seq 1 "$N"); do
  rid=$(jq -r .runId "$D/start-$n.json")
  curl -4 -s -A qbfleet-cli/1 "$U/status?repo=fleet-vscode-ext-$n" > "$D/status-$n.json"
  curl -4 -s -A qbfleet-cli/1 -H "x-fleet-key: $K" "$U/records?repo=fleet-vscode-ext-$n&run=$rid" > "$D/rec-$n.jsonl"
  off=0; : > "$D/check-$n.jsonl"
  while :; do c=$(curl -4 -s -m 280 -A qbfleet-cli/1 -H "x-fleet-key: $K" "$U/dialcheck?repo=fleet-vscode-ext-$n&run=$rid&offset=$off&limit=60"); echo "$c" >> "$D/check-$n.jsonl"; t=$(echo "$c" | jq -r '.total // 0'); off=$((off+60)); [ $off -ge "$t" ] && break; done
done
cat "$D"/rec-*.jsonl | jq -s -c 'def p(q): sort | .[(length*q)|floor]; {tasks: length, wallS: (((map(.at)|max) - (map(.at)|min))/1000|floor), tasksPerS: (length / (((map(.at)|max) - (map(.at)|min))/1000) | floor), lastLandS: (((map(.landed_at // 0)|max) - (map(.at)|min))/1000|floor), byKind: (group_by(.kind) | map({(.[0].kind // "?"): (group_by(.resolution // .status) | map({(.[0].resolution // .[0].status): length}) | add)}) | add), landWaitP50: ([.[]|select(.landed_at)|.landed_at - .at]|p(0.5)), landWaitP90: ([.[]|select(.landed_at)|.landed_at - .at]|p(0.9))}' > "$D/summary.json"
cat "$D"/check-*.jsonl | jq -s -c '{files: (map(.n)|add), tasksLanded: (map(.tasks)|add), codeChanged: (map(.codeChanged|length)|add), doubled: (map(.doubled|length)|add), lost: (map(.lost|length)|add), lostEx: ([.[].lost[]][0:5]), byResolution: (reduce (.[].byResolution | to_entries[]) as $e ({}; .[$e.key] += $e.value))}' > "$D/check.json"
jq -s -c '{dial: (map(.dial) | {pairShare: (map(.pairShare)|add/length*1000|round/1000), pairs: (reduce (.[].pairs | to_entries[]) as $e ({}; .[$e.key] += $e.value))})}' "$D"/start-*.json > "$D/dial.json"
cat "$D/dial.json" "$D/summary.json" "$D/check.json"
