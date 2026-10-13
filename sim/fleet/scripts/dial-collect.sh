#!/usr/bin/env bash
# Collect one comment-dial level (records, status, the checker's verdict per page), every copy in parallel, and summarise.
#   sim/fleet/scripts/dial-collect.sh <label> [copies=20]
set -uo pipefail
LABEL=$1; N=${2:-20}
K=$(cat ~/.config/qbfleet/key); U=https://qbfleet.forqdev.workers.dev; D=~/.local/share/qbfleet/dial/$LABEL
one() {
  local n=$1 rid; rid=$(jq -r .runId "$D/start-$n.json")
  curl -4 -s -A qbfleet-cli/1 "$U/status?repo=fleet-vscode-ext-$n" > "$D/status-$n.json"
  curl -4 -s -A qbfleet-cli/1 -H "x-fleet-key: $K" "$U/records?repo=fleet-vscode-ext-$n&run=$rid" > "$D/rec-$n.jsonl"
  local off=0 t c; : > "$D/check-$n.jsonl"
  while :; do c=$(curl -4 -s -m 280 -A qbfleet-cli/1 -H "x-fleet-key: $K" "$U/dialcheck?repo=fleet-vscode-ext-$n&run=$rid&offset=$off&limit=100"); echo "$c" | jq -e .total >/dev/null 2>&1 || { sleep 3; continue; }; echo "$c" >> "$D/check-$n.jsonl"; t=$(echo "$c" | jq -r '.total'); off=$((off+100)); [ $off -ge "$t" ] && break; done
}
for n in $(seq 1 "$N"); do one "$n" & done; wait
cat "$D"/rec-*.jsonl | jq -s -c 'def p(q): sort | .[(length*q)|floor]; {tasks: length, wallS: (((map(.at)|max) - (map(.at)|min))/1000|floor), tasksPerS: (length / (((map(.at)|max) - (map(.at)|min))/1000) | floor), lastLandS: (((map(.landed_at // 0)|max) - (map(.at)|min))/1000|floor), byKind: (group_by(.kind) | map({(.[0].kind // "?"): (group_by(.resolution // .status) | map({(.[0].resolution // .[0].status): length}) | add)}) | add), landWaitP50: ([.[]|select(.landed_at)|.landed_at - .at]|p(0.5)), landWaitP90: ([.[]|select(.landed_at)|.landed_at - .at]|p(0.9))}' > "$D/summary.json"
cat "$D"/check-*.jsonl | jq -s -c '{files: (map(.n)|add), tasksLanded: (map(.tasks)|add), codeChanged: (map(.codeChanged|length)|add), doubled: (map(.doubled|length)|add), doubledEx: ([.[].doubled[]][0:5]), lost: (map(.lost|length)|add), lostEx: ([.[].lost[]][0:5]), byResolution: (reduce (.[].byResolution | to_entries[]) as $e ({}; .[$e.key] += $e.value))}' > "$D/check.json"
jq -s -c '{dial: (map(.dial) | {pairShare: (map(.pairShare)|add/length*1000|round/1000), pairs: (reduce (.[].pairs | to_entries[]) as $e ({}; .[$e.key] += $e.value))})}' "$D"/start-*.json > "$D/dial.json"
cat "$D/dial.json" "$D/summary.json" "$D/check.json"
