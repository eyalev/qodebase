#!/usr/bin/env bash
# One code-dial level (2026-10-13): qb4's kata tasks for dial <N> through qodebase's real merge queue on project
# eyal/<project>, by <agents> fleet agents (Workers AI / Gemini through the fleet gateway). Waits until every task has a
# final record, then saves the records (JSONL, one line per attempt; the checker takes the last line per task) and a
# summary into ~/.local/share/qbfleet/kata/<label>/.
#   sim/fleet/scripts/kata-level.sh <dial 0|30|60> <project, e.g. kata-d30> <label> [agents=200] [budgetUsd=8]
set -uo pipefail
DIAL=$1; PROJ=$2; LABEL=$3; AGENTS=${4:-200}; BUDGET=${5:-8}
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
K=$(cat ~/.config/qbfleet/key); U=https://qbfleet.forqdev.workers.dev; D=~/.local/share/qbfleet/kata/$LABEL; mkdir -p "$D"
REPO="fleet-$PROJ"
# LIMIT (env): only the first N tasks in order (a small check run).
jq -c --argjson n "${LIMIT:-100000}" '[.list | sort_by(.order)[]] | .[0:$n]' "$ROOT/sim/kata/seed-1/kata-tasks-dial$DIAL.json" > "$D/tasks.json"
jq -n --slurpfile ts "$D/tasks.json" --arg repo "$REPO" --arg slug "eyal.$PROJ" --arg label "code dial $DIAL% ($LABEL)" --argjson agents "$AGENTS" --argjson budget "$BUDGET" \
  '{repo: $repo, label: $label, ladder: ("K" + ($label|split(" ")[2]|rtrimstr("%"))), kata: {slug: $slug, tasks: $ts[0], maxRedos: 2}, agents: $agents, batch: 1,
    models: [{model: "gemini-3.1-flash-lite", maxPerMin: 300}], overflow: {model: "@cf/zai-org/glm-4.7-flash", maxPerMin: 200},
    budgetUsd: $budget, planUsdPerMin: 3, maxFiles: 100000, pause: {rateLimitShare: 0.25, modelErrorShare: 0.3}}' > "$D/start-body.json"
curl -4 -s -m 280 -A qbfleet-cli/1 -H "x-fleet-key: $K" -X POST -H 'content-type: application/json' "$U/start" --data @"$D/start-body.json" > "$D/start.json"
cat "$D/start.json"; echo
RID=$(jq -r .runId "$D/start.json"); [ "$RID" = null ] && exit 1
until curl -4 -s -A qbfleet-cli/1 "$U/status?repo=$REPO" | jq -e '.state != "running" and .state != "held"' >/dev/null; do sleep 20; done
echo "ended $(date -u +%T) $(curl -4 -s -A qbfleet-cli/1 "$U/status?repo=$REPO" | jq -c '{state, counts, usd, p: .pauses[-1].why}')"
curl -4 -s -A qbfleet-cli/1 -H "x-fleet-key: $K" "$U/records?repo=$REPO&run=$RID" > "$D/records.jsonl"
jq -s -c 'def p(q): sort | .[(length*q)|floor]; (group_by(.task) | map(max_by(.at))) as $f | {tasks: ($f|length), attempts: length,
  final: ($f | group_by(.status + "|" + (.resolution // "")) | map({(.[0].status + "|" + (.[0].resolution // "")): length}) | add),
  byKind: ($f | group_by(.kind) | map({(.[0].kind): (group_by(.status) | map({(.[0].status): length}) | add)}) | add),
  wallMin: ((((map(.at)|max) - (map(.at)|min))/60000)*10|floor/10), usd: ((map(.usd // 0)|add)*1000|floor/1000),
  redos: ($f | map(.redos // 0) | add), msP50: ($f | map(.ms) | p(0.5)), msP90: ($f | map(.ms) | p(0.9))}' "$D/records.jsonl" | tee "$D/summary.json"
