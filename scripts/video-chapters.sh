#!/usr/bin/env bash
# Set the chapters of the cut already on qodebase.app/video, without re-uploading it:
#   scripts/video-chapters.sh chapters.txt      (lines "M:SS Title"; see scripts/video-chapters.py)
# Downloads latest.json from R2 qodebase-video (forq account), adds "chapters", uploads it back. Live within ~1 minute.
set -euo pipefail
file=${1:?usage: scripts/video-chapters.sh <chapters.txt>}
[ -s "$file" ] || { echo "no such file: $file" >&2; exit 1; }
export CLOUDFLARE_API_TOKEN=$(cat ~/.config/forq-cf/api-token)
cd "$(dirname "$0")/.."
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
npx wrangler r2 object get qodebase-video/latest.json --file "$work/latest.json" --remote >/dev/null
python3 scripts/video-chapters.py "$work/latest.json" "$file"
npx wrangler r2 object put qodebase-video/latest.json --file "$work/latest.json" --content-type application/json --remote >/dev/null
mkdir -p ~/.local/share/qodebase-video
printf '{"ts":"%s","event":"chapters","v":"%s","count":%s}\n' "$(date -u +%FT%TZ)" "$(python3 -c "import json;print(json.load(open('$work/latest.json'))['v'])")" "$(python3 -c "import json;print(len(json.load(open('$work/latest.json'))['chapters']))")" >> ~/.local/share/qodebase-video/publish.jsonl
echo "chapters set: https://qodebase.app/video (live within ~1 minute)"
