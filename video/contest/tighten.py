#!/usr/bin/env python3
"""Tighten a take's real-time segments (Eyal, voice-8: no dead air between voice turns): keep only the stretches
where the user's clip or Talk's voice plays (say events + clip length; Talk speak_start..speak_done), with at most
`gap` ms of silence kept around and between them. Fast-forward segments are left as they are.
  python3 tighten.py <take dir> [gap_ms]   (reads segs.json, writes segs.tight.json)"""
import json, os, subprocess, sys
d = sys.argv[1]; gap = int(sys.argv[2]) if len(sys.argv) > 2 else 1000
ev = [json.loads(l) for l in open(os.path.join(d, 'events.jsonl'))]
dur = lambda f: float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], capture_output=True, text=True).stdout or 0)
spans = []
for e in ev:
    if e['ev'] == 'say' and os.path.exists(e.get('clip', '')): spans.append((e['t'] + 400, e['t'] + int(dur(e['clip']) * 1000) - 1100))   # the clip's own lead-in and tail pad are silence
tab = next(((e['t'], os.path.join(d, e['file'])) for e in ev if e['ev'] == 'tab-audio-start'), None)
if tab and os.path.exists(tab[1]):   # Talk's real voice: the sounding stretches of the tab recording (speak events lie about timing)
    import re
    o = subprocess.run(['ffmpeg', '-nostdin', '-i', tab[1], '-af', 'silencedetect=noise=-40dB:d=0.35', '-f', 'null', '-'], capture_output=True, text=True).stderr
    st = [float(x) for x in re.findall(r'silence_start: ([0-9.]+)', o)]; en = [float(x) for x in re.findall(r'silence_end: ([0-9.]+)', o)]
    edges = [0.0] + [v for pair in zip(st, en) for v in pair] + [1e9]
    for a, b in zip(edges[0::2], edges[1::2]):
        if b - a > 0.15: spans.append((tab[0] + int(a * 1000), tab[0] + int(min(b, 1e7) * 1000)))
talk = [] if tab else [e for e in ev if e['ev'] == 'talk' and e['row'].get('event') in ('speak_start', 'speak_done')]
for i, e in enumerate(talk):
    if e['row']['event'] == 'speak_start':
        end = next((x['t'] for x in talk[i + 1:] if x['row']['event'] == 'speak_done'), e['t'] + 4000)
        spans.append((e['t'], end))
out = []
for s in json.load(open(os.path.join(d, 'segs.json'))):
    if float(s.get('x', 1)) != 1 or s.get('keep'): out.append(s); continue
    inside = sorted((max(a, s['a']), min(b, s['b'])) for a, b in spans if b > s['a'] and a < s['b'])
    if not inside: out.append(s); continue
    merged = []
    for a, b in inside:
        if merged and a - merged[-1][1] <= 2 * gap: merged[-1][1] = max(merged[-1][1], b)
        else: merged.append([a, b])
    for k, (a, b) in enumerate(merged):
        piece = dict(s); piece['a'] = max(s['a'], a - gap // 2); piece['b'] = min(s['b'], b + gap // 2)
        if k == len(merged) - 1: piece['b'] = min(s['b'], b + (2500 if s.get('hold') else 1500))   # a short look at the result, no dead air
        if k and 'say' in piece: piece.pop('say')
        if k < len(merged) - 1: piece.pop('hold', None)
        out.append(piece)
json.dump(out, open(os.path.join(d, 'segs.tight.json'), 'w'), indent=1)
print(len(out), 'segments')
