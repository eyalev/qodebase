#!/usr/bin/env bash
# 10,000-agent cached run (2026-10-14): 1,000 agents on each of the copies in ~/.local/share/qbfleet/r10k-copies.txt,
# hold-started, then all started together; waits until every copy is done and landed; saves status + /runs rows.
#   sim/fleet/scripts/r10k.sh <label e.g. R10K-a> [agents per copy=1000] [batch=4]
set -uo pipefail
LABEL=$1; AG=${2:-1000}; BATCH=${3:-4}
K=$(cat ~/.config/qbfleet/key); U=https://qbfleet.forqdev.workers.dev; D=~/.local/share/qbfleet/r10k/$LABEL; mkdir -p "$D"
post() { curl -4 -s -m 290 -A qbfleet-cli/1 -H "x-fleet-key: $K" -X POST -H 'content-type: application/json' "$U/$1" -d "$2"; }
COPIES=$(cat ~/.local/share/qbfleet/r10k-copies.txt); n=0
for r in $COPIES; do n=$((n+1)); (post start "{\"repo\":\"$r\",\"root\":\"src/vs\",\"hold\":true,\"ladder\":\"$LABEL\",\"copy\":$n,\"label\":\"$LABEL: $AG cached agents, copy $n\",\"agents\":$AG,\"batch\":$BATCH,\"maxFiles\":100000,\"models\":[{\"model\":\"cache\",\"maxPerMin\":1000000}],\"budgetUsd\":0.2,\"planUsdPerMin\":1}" > "$D/start-$n.json") & done; wait
cat "$D"/start-*.json | jq -c '{runId, agents, files, error}' | sort | uniq -c
for r in $COPIES; do (post go "{\"repo\":\"$r\"}" > /dev/null) & done; wait
echo "go $(date -u +%T)"
done_all() { for r in $COPIES; do curl -4 -s -A qbfleet-cli/1 "$U/status?repo=$r" | jq -e '.state == "done" and .lander.waiting == 0' >/dev/null || return 1; done; }
until done_all; do sleep 10; done
echo "all done $(date -u +%T)"
for r in $COPIES; do curl -4 -s -A qbfleet-cli/1 "$U/status?repo=$r" > "$D/status-$r.json"; done
curl -4 -s -A qbfleet-cli/1 -H "x-fleet-key: $K" "$U/runs" > "$D/runs.json"
curl -4 -s -A qbfleet-cli/1 -H "x-fleet-key: $K" "$U/ladder-series?ladder=$LABEL" > "$D/series.json"
