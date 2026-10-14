#!/usr/bin/env bash
# Publish a cut of the qodebase video to qodebase.app/video (src/video.ts). One command:
#   scripts/video-publish.sh <file.mp4> [file.srt]        (the .srt defaults to the mp4's name with .srt)
#   TITLE="…" DESCRIPTION="…" POSTER_AT=12 scripts/video-publish.sh cut.mp4
# Uploads to R2 qodebase-video (forq account) under a versioned name (<UTC time>-<sha8>): the mp4, a poster frame (jpg,
# also the link-preview image) and the captions as WebVTT; then rewrites latest.json, which the page reads (30 s memo
# per isolate, so the new cut shows within a minute). Old cuts stay until deleted by hand. Logs one JSON line per run to
# ~/.local/share/qodebase-video/publish.jsonl.
set -euo pipefail
mp4=${1:?usage: scripts/video-publish.sh <file.mp4> [file.srt]}
srt=${2:-${mp4%.mp4}.srt}
[ -s "$mp4" ] || { echo "no such video: $mp4" >&2; exit 1; }
BUCKET=qodebase-video
export CLOUDFLARE_API_TOKEN=$(cat ~/.config/forq-cf/api-token)
cd "$(dirname "$0")/.."
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
v=$(date -u +%Y%m%d-%H%M%S)-$(sha256sum "$mp4" | cut -c1-8)
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$mp4")
IFS=x read -r w h < <(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "$mp4")
# The poster (also the link preview): one frame, 1280 wide.
at=${POSTER_AT:-2.5}   # the opening title card (qodebase, agents into one shared main) previews best
ffmpeg -loglevel error -y -ss "$at" -i "$mp4" -frames:v 1 -vf scale=1280:-2 -q:v 3 "$work/$v.jpg"
put() { npx wrangler r2 object put "$BUCKET/$1" --file "$2" --content-type "$3" --remote >/dev/null; echo "uploaded $1 ($(stat -c %s "$2") B)"; }
put "$v.mp4" "$mp4" video/mp4
put "$v.jpg" "$work/$v.jpg" image/jpeg
vtt=null
if [ -s "$srt" ]; then
  # SRT -> WebVTT: a header, and the comma before the milliseconds becomes a dot.
  { printf 'WEBVTT\n\n'; tr -d '\r' < "$srt" | sed -E 's/([0-9]{2}:[0-9]{2}:[0-9]{2}),([0-9]{3})/\1.\2/g'; } > "$work/$v.vtt"
  put "$v.vtt" "$work/$v.vtt" "text/vtt"
  vtt="\"$v.vtt\""
else echo "no captions ($srt missing or empty)"; fi
python3 - "$work/latest.json" <<PY
import json, sys, time, os
json.dump({ "v": "$v", "mp4": "$v.mp4", "jpg": "$v.jpg", "vtt": $vtt, "bytes": os.path.getsize("$mp4"), "duration": round(float("$dur"), 2),
  "w": int("$w"), "h": int("$h"), "at": int(time.time() * 1000),
  "title": os.environ.get("TITLE", "qodebase: many AI agents, one codebase"),
  "description": os.environ.get("DESCRIPTION", "A short film about qodebase: a git platform where many AI agents change one codebase at once and their work lands by itself.") }, open(sys.argv[1], "w"))
PY
put latest.json "$work/latest.json" application/json
mkdir -p ~/.local/share/qodebase-video
printf '{"ts":"%s","event":"published","v":"%s","file":"%s","bytes":%s,"duration":%s,"captions":%s}\n' "$(date -u +%FT%TZ)" "$v" "$mp4" "$(stat -c %s "$mp4")" "$dur" "$([ "$vtt" = null ] && echo false || echo true)" >> ~/.local/share/qodebase-video/publish.jsonl
echo "published $v: https://qodebase.app/video (live within ~1 minute)"
