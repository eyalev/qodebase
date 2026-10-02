#!/usr/bin/env python3
"""Compose a recorded rig session into a 1920x1080 mp4 (spec: ../docs/video-guide.md).

  python3 compose.py frames/<name> out/<name>.mp4

Layout: quiet dark background; the phone recording at full height on the left
in a thin rounded frame; chapter title, caption and (when time is compressed)
a speed badge in the space to the right, never over the UI. Title cards for
chapters, an end card. Sped-up stretches play at their speed with a visible
"xN, real time m:ss" badge, eased in and out over 0.25 s.
"""
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1920, 1080, 30
BG = (21, 23, 26)
FG = (236, 238, 240)
DIM = (150, 157, 166)
ACC = (79, 191, 159)
HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, 'fonts', 'InstrumentSans.ttf')

def font(size, weight=400):
    f = ImageFont.truetype(FONT, size)
    try: f.set_variation_by_axes([100, weight])   # wdth, wght
    except Exception: pass
    return f

F_TITLE, F_SUB, F_CAP, F_CHAP, F_BADGE = font(72, 600), font(34, 400), font(40, 500), font(26, 600), font(26, 600)

def wrap(draw, text, f, width):
    words, lines, cur = text.split(), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if draw.textlength(t, font=f) <= width: cur = t
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def card(title, sub):
    im = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(im)
    tw = d.textlength(title, font=F_TITLE)
    d.text(((W - tw) / 2, H / 2 - 70), title, font=F_TITLE, fill=FG)
    for i, line in enumerate(wrap(d, sub, F_SUB, 1200)):
        lw = d.textlength(line, font=F_SUB)
        d.text(((W - lw) / 2, H / 2 + 30 + i * 46), line, font=F_SUB, fill=DIM)
    return im

def main(src, out):
    tl = json.load(open(os.path.join(src, 'timeline.json')))
    frames, events = tl['frames'], tl['events']
    if not frames: sys.exit('no frames')
    t0, t1 = frames[0]['t'], events[-1]['t'] if events else frames[-1]['t']
    # Phone placement: full height minus margins.
    ph_h = H - 80
    ph_w = round(ph_h * tl['width'] / tl['height'])
    px, py = 150, 40
    mask = Image.new('L', (ph_w, ph_h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, ph_w - 1, ph_h - 1), radius=36, fill=255)

    ff = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                           '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
                           '-r', str(FPS), '-movflags', '+faststart', out], stdin=subprocess.PIPE)
    def emit(im, n=1):
        b = im.tobytes()
        for _ in range(n): ff.stdin.write(b)

    # Walk source time; speed comes from 'speed' events (eased over 0.25 s).
    ev = sorted(events, key=lambda e: e['t'])
    fi, cache, last_img = 0, {}, None
    caption, chapter, speed_target, speed, label, compressed_from = '', '', 1.0, 1.0, '', None
    ei, t = 0, t0
    emitted = 0
    while t <= t1:
        # events up to t
        while ei < len(ev) and ev[ei]['t'] <= t:
            e = ev[ei]; ei += 1
            if e['type'] == 'caption': caption = e['text']
            elif e['type'] == 'chapter':
                chapter = e['title']; caption = ''
                emit(card(e['title'], e.get('sub', '')), int(FPS * 2.6))
            elif e['type'] == 'speed':
                speed_target = float(e['speed']); label = e.get('label', '')
                compressed_from = e['t'] if speed_target > 1 else None
            elif e['type'] == 'end':
                pass
        # ease speed toward target over ~0.25 s of output time
        step = (speed_target - speed) / (0.25 * FPS) if speed_target != speed else 0
        speed = speed_target if abs(speed_target - speed) < abs(step) or step == 0 else speed + step
        # latest frame at or before t
        while fi + 1 < len(frames) and frames[fi + 1]['t'] <= t: fi += 1
        f = frames[fi]['file']
        if f not in cache:
            cache.clear()
            im = Image.open(os.path.join(src, f)).convert('RGB').resize((ph_w, ph_h), Image.LANCZOS)
            cache[f] = im
        shot = cache[f]
        canvas = Image.new('RGB', (W, H), BG)
        d = ImageDraw.Draw(canvas)
        d.rounded_rectangle((px - 3, py - 3, px + ph_w + 2, py + ph_h + 2), radius=39, outline=(70, 76, 84), width=2)
        canvas.paste(shot, (px, py), mask)
        tx, tw = px + ph_w + 110, W - (px + ph_w + 110) - 120
        y = 300
        if chapter:
            d.text((tx, y - 70), chapter, font=F_CHAP, fill=ACC)
        if caption:
            for i, line in enumerate(wrap(d, caption, F_CAP, tw)[:4]):
                d.text((tx, y + i * 56), line, font=F_CAP, fill=FG)
        if speed > 1.05 and compressed_from is not None:
            real = t - compressed_from
            badge = f'x{round(speed_target)} · {label} · real time {int(real // 60)}:{int(real % 60):02d}'
            bw = d.textlength(badge, font=F_BADGE) + 36
            d.rounded_rectangle((tx, H - 190, tx + bw, H - 140), radius=8, fill=(40, 44, 49))
            d.text((tx + 18, H - 182), badge, font=F_BADGE, fill=FG)
        emit(canvas); emitted += 1
        t += speed / FPS
    end = next((e for e in reversed(ev) if e['type'] == 'end'), None)
    emit(card(end['title'] if end else 'forq', end.get('sub', '') if end else ''), int(FPS * 3))
    ff.stdin.close(); ff.wait()
    print(f'{out}: {emitted / FPS:.1f}s of recording + cards')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
