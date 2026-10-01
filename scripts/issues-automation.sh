#!/usr/bin/env bash
# Point Cloudflare Issues for one forq app Worker at forq's webhook, so a
# recurring production error becomes work for that project's router agent.
#
#   scripts/issues-automation.sh forq-app-eyal-workers-chat-demo [occurrences]
#
# Once per account (ids cached in ~/.config/forq/issues.json):
#   webhook destination  → https://forq.<sub>.workers.dev/api/hooks/issues
#                          (secret ~/.config/forq/issues-webhook-secret, sent as cf-webhook-auth)
#   notification policy  → alert type workers_observability_real_time_issue → that webhook
# Per Worker: an Issues automation (occurrence threshold) using that policy.
# Uses the `cf` CLI login; every write is dry-run first.
set -euo pipefail
WORKER=${1:?usage: issues-automation.sh <forq-app-worker> [occurrences]}
N=${2:-3}
STATE=~/.config/forq/issues.json
SECRET=$(cat ~/.config/forq/issues-webhook-secret)
HOOK=https://forq.<sub>.workers.dev/api/hooks/issues
[ -f "$STATE" ] || echo '{}' > "$STATE"
get() { jq -r ".$1 // empty" "$STATE"; }
put() { tmp=$(mktemp); jq ".$1 = \"$2\"" "$STATE" > "$tmp" && mv "$tmp" "$STATE" && chmod 600 "$STATE"; }
run() { cf "$@" --dry-run >/dev/null && cf "$@"; }

if [ -z "$(get webhook_id)" ]; then
  out=$(run alerting destinations webhooks create --body "$(jq -nc --arg u "$HOOK" --arg s "$SECRET" '{name:"forq issues hook",url:$u,secret:$s}')")
  id=$(echo "$out" | jq -r '.id // .result.id // empty'); [ -n "$id" ] || { echo "webhook create failed: $out" >&2; exit 1; }
  put webhook_id "$id"; echo "webhook destination $id"
fi
if [ -z "$(get policy_id)" ]; then
  out=$(run alerting policies create --body "$(jq -nc --arg w "$(get webhook_id)" '{name:"forq: Worker issues to router agents",alert_type:"workers_observability_real_time_issue",enabled:true,mechanisms:{webhooks:[{id:$w}]}}')")
  id=$(echo "$out" | jq -r '.id // .result.id // empty'); [ -n "$id" ] || { echo "policy create failed: $out" >&2; exit 1; }
  put policy_id "$id"; echo "notification policy $id"
fi
out=$(run observability issues automations create --body "$(jq -nc --arg p "$(get policy_id)" --arg w "$WORKER" --argjson n "$N" '{name:("forq: "+$w),policyId:$p,service:$w,afterOccurrences:$n,enabled:true}')")
# The response nests the automation; take the first object that names a service.
echo "automation for $WORKER: $(echo "$out" | jq -c '[.. | objects | select(has("service") and has("id"))][0] | {id, service, threshold, enabled}' 2>/dev/null || echo "$out")"
