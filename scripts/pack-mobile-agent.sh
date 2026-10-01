#!/usr/bin/env bash
# Pack mobile-agent (appcore repo, committed HEAD only) into box/mobile-agent.tgz.
# The Worker serves it to agent boxes, which unpack it over the image's
# /opt/mobile-agent at boot (keeping the image's node_modules), so mobile-agent
# changes reach forq without rebuilding the 2.56 GB image. Run after changing
# mobile-agent, then deploy. Refuses if the dependency set changed (that needs
# an image rebuild, since the box keeps the image's node_modules).
set -euo pipefail
SRC=${MA_SRC:-<mobile-agent repo>}
OUT=$(cd "$(dirname "$0")/.." && pwd)/box
IMG_TGZ=$HOME/projects/personal/2026-02/opendev/computer-worker/mobile-agent-src.tar.gz
deps() { jq -S -c '{d:.dependencies,dd:.devDependencies}'; }
for f in package.json packages/core/package.json apps/mobile-agent/package.json; do
  a=$(tar xzf "$IMG_TGZ" -O "$f" | deps); b=$(git -C "$SRC" show "HEAD:$f" | deps)
  [ "$a" = "$b" ] || { echo "dependencies changed in $f since the image's copy: rebuild the image instead" >&2; exit 1; }
done
REV=$(git -C "$SRC" rev-parse --short=12 HEAD)
git -C "$SRC" archive --format=tar.gz HEAD apps packages plugins package.json package-lock.json > "$OUT/mobile-agent.tgz"
printf '%s' "$REV" > "$OUT/mobile-agent.rev"
echo "packed mobile-agent $REV ($(stat -c %s "$OUT/mobile-agent.tgz") bytes) into box/"
