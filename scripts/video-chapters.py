#!/usr/bin/env python3
# Chapters for qodebase.app/video: read a text file of "M:SS Title" (or "H:MM:SS Title") lines and put them into a
# latest.json as "chapters": [{t: seconds, title}]. Used by scripts/video-publish.sh (CHAPTERS=<file>) and
# scripts/video-chapters.sh (sets chapters on the cut already published). Blank lines and lines starting with # skip.
import json, re, sys
def parse(path):
    out = []
    for n, line in enumerate(open(path, encoding='utf-8'), 1):
        line = line.strip()
        if not line or line.startswith('#'): continue
        m = re.match(r'^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)\s+[-–:]?\s*(.+)$', line)
        if not m: sys.exit(f'{path}:{n}: expected "M:SS Title", got: {line}')
        t = int(m.group(1) or 0) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
        out.append({'t': round(t, 2), 'title': m.group(4).strip()})
    out.sort(key=lambda c: c['t'])
    return out
if __name__ == '__main__':
    latest, chapters = sys.argv[1], sys.argv[2]
    j = json.load(open(latest))
    ch = parse(chapters)
    dur = j.get('duration') or float('inf')
    late = [c for c in ch if c['t'] >= dur]
    if late: sys.exit(f'chapters past the end of the cut ({dur} s): {late}')
    j['chapters'] = ch
    json.dump(j, open(latest, 'w'))
    print(f'{len(ch)} chapters: ' + ', '.join(f"{int(c['t']//60)}:{int(c['t']%60):02d} {c['title']}" for c in ch))
