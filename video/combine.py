#!/usr/bin/env python3
"""Join composed workflow videos into one contest cut, with merged captions.

  python3 combine.py out/forq-contest.mp4 out/w1-fork-and-agents.mp4 out/w3-error-to-fix.mp4 …

Adds an opening and a closing card (same look as compose.py), re-encodes once
with the same settings, and writes <out>.srt with every part's cues shifted.
"""
import os, re, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compose import card, FPS

INTRO = ('forq', 'A git platform for the age of agents. Built on Cloudflare Artifacts, Containers, Durable Objects and Workers.')
OUTRO = ('forq.kapps.dev', 'Every project runs. Every fork comes with its own agents.')

def still(title, sub, seconds, path):
    png = path + '.png'
    card(title, sub).save(png)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-loop', '1', '-i', png, '-t', str(seconds), '-r', str(FPS),
                    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'high', path], check=True)
    return path

def duration(p):
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p],
                                capture_output=True, text=True, check=True).stdout)

def parse_ts(t):
    h, m, rest = t.split(':'); s, ms = rest.split(',')
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000

def fmt_ts(x):
    return f'{int(x // 3600):02d}:{int(x % 3600 // 60):02d}:{int(x % 60):02d},{int(x * 1000 % 1000):03d}'

def main(out, parts):
    tmp = tempfile.mkdtemp(prefix='forq-combine-')
    seq = [(still(*INTRO, 4, os.path.join(tmp, 'intro.mp4')), [(0, 4, f'{INTRO[0]}. {INTRO[1]}')])]
    for p in parts:
        srt = os.path.splitext(p)[0] + '.srt'
        cues = []
        if os.path.exists(srt):
            for block in open(srt).read().strip().split('\n\n'):
                lines = block.split('\n')
                a, b = lines[1].split(' --> ')
                cues.append((parse_ts(a), parse_ts(b), ' '.join(lines[2:])))
        seq.append((p, cues))
    seq.append((still(*OUTRO, 4, os.path.join(tmp, 'outro.mp4')), [(0, 4, f'{OUTRO[0]}. {OUTRO[1]}')]))

    args = []
    for p, _ in seq: args += ['-i', p]
    n = len(seq)
    filt = ''.join(f'[{i}:v]' for i in range(n)) + f'concat=n={n}:v=1:a=0[v]'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *args, '-filter_complex', filt, '-map', '[v]',
                    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-tune', 'stillimage', '-pix_fmt', 'yuv420p',
                    '-profile:v', 'high', '-r', str(FPS), '-movflags', '+faststart', out], check=True)

    off, i = 0.0, 1
    with open(os.path.splitext(out)[0] + '.srt', 'w') as f:
        for p, cues in seq:
            for a, b, text in cues:
                f.write(f'{i}\n{fmt_ts(off + a)} --> {fmt_ts(off + b)}\n{text}\n\n'); i += 1
            off += duration(p)
    print(f'{out}: {duration(out):.0f}s, {i - 1} captions')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2:])
