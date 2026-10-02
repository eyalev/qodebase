#!/usr/bin/env bash
# Pack mobile-agent (appcore repo, committed HEAD only) into box/mobile-agent.tgz.
# The Worker serves it to agent boxes, which unpack it over the image's
# /opt/mobile-agent at boot (keeping the image's node_modules), so mobile-agent
# changes reach forq without rebuilding the image. Run after changing
# mobile-agent, then deploy. Refuses if the dependency set changed (that needs
# an image rebuild, since the box keeps the image's node_modules).
#   MA_SRC   a mobile-agent checkout (https://github.com/eyalev/mobile-agent)
#   MA_IMAGE_REF  the commit the image was built from (box/Dockerfile's
#                 MOBILE_AGENT_REF); default: the last packed revision
set -euo pipefail
SRC=${MA_SRC:-<mobile-agent repo>}
OUT=$(cd "$(dirname "$0")/.." && pwd)/box
BASE=${MA_IMAGE_REF:-$(cat "$OUT/mobile-agent.rev")}
deps() { jq -S -c '{d:.dependencies,dd:.devDependencies}'; }
for f in package.json packages/core/package.json apps/mobile-agent/package.json; do
  a=$(git -C "$SRC" show "$BASE:$f" | deps); b=$(git -C "$SRC" show "HEAD:$f" | deps)
  [ "$a" = "$b" ] || { echo "dependencies changed in $f since the image's copy: rebuild the image instead" >&2; exit 1; }
done
REV=$(git -C "$SRC" rev-parse --short=12 HEAD)
git -C "$SRC" archive --format=tar.gz HEAD apps packages plugins package.json package-lock.json > "$OUT/mobile-agent.tgz"
printf '%s' "$REV" > "$OUT/mobile-agent.rev"
echo "packed mobile-agent $REV ($(stat -c %s "$OUT/mobile-agent.tgz") bytes) into box/"
