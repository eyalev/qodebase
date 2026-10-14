#!/usr/bin/env python3
"""The contest video, second version (qb3, 2026-10-14): no Eyal on film, every voice generated, all violet.

  node video/contest/shoot-deck.mjs                 # deck slides -> video/contest/build/deck/NN.png (1920x1080)
  node video/rig2.mjs --out <take dir>              # a product take (TTS clips as the mic), driven over its port
  python3 video/contest/cut2.py [out.mp4]           # -> video/out/qodebase-contest-v2.mp4 + .srt

Built on cut.py's Cut (frame writer, narration through the forq AI Gateway with a ledger, .srt). Changes:
- Violet light tokens from DESIGN.md; the narrator is Aura-2 'thalia' (Talk's own replies are 'draco', the user's
  clips are Aura-2 'arcas'), so the three voices never sound alike.
- deck(n): a slide of qodebase.app/deck, full frame, narrated with its own notes (the deck's <aside class="say">);
  the slide carries its text, so the caption goes only to the .srt.
- take(dir, segs): a rig2 recording. Each segment is a stretch of the take in ms marks or event labels, with a
  speed; real-time stretches keep the take's own sound (the user's clips and Talk's spoken replies), fast ones get
  a visible "N×" badge and the real elapsed time.
The scene list is script() below; docs/contest/shotlist.md is the plan it follows.
"""
import html, json, os, re, subprocess, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cut as base
from cut import W, H, FPS, font, wrap, hold

# DESIGN.md violet, light
base.BG, base.CARD, base.LINE = (247, 247, 250), (255, 255, 255), (228, 228, 236)
base.FG, base.DIM, base.ACC, base.BUSY = (20, 18, 31), (100, 97, 119), (106, 47, 240), (148, 96, 15)
base.VO_SPEAKER = os.environ.get('VO_SPEAKER', 'thalia')
BG, FG, DIM, ACC, LINE = base.BG, base.FG, base.DIM, base.ACC, base.LINE
ROOT = base.ROOT
DECK = os.path.join(HERE, 'build', 'deck')
F_CAP, F_CHAP, F_BADGE, F_BIG, F_QUOTE = font(42, 500), font(30, 600), font(30, 600), font(64, 700), font(42, 500)

def deck_notes():
    s = open(os.path.join(ROOT, 'public', 'deck', 'index.html')).read()
    out = {}
    for i, (t, b) in enumerate(re.findall(r'<section class="s[^"]*" data-t="([^"]*)"[^>]*>(.*?)</section>', s, re.S), 1):
        m = re.search(r'<aside class="say">(.*?)</aside>', b, re.S)
        out[i] = (t, ' '.join(html.unescape(re.sub('<[^>]+>', '', m.group(1))).split()) if m else '')
    return out

class Cut2(base.Cut):
    PX, PY, PW, PH = 150, 40, 600, H - 80      # the phone: full width of the 390 px screen, ~650 of its 844 CSS px
    SRC_W = 780
    WIN = round(PH * SRC_W / PW)

    def __init__(self, out):
        super().__init__(out)
        self.notes = deck_notes()

    def deck(self, n, say=None, after=0.8):
        title, notes = self.notes[n]
        text = say if say is not None else notes
        im = Image.open(os.path.join(DECK, f'{n:02d}.png')).convert('RGB').resize((W, H))
        secs = max(hold(text) if text else 2.5, (self.speak(text) if text else 0) + after)
        if text: self.cues.append((self.now(), self.now() + secs, text))
        self.emit(im, round(secs * FPS))

    def _canvas(self, shot, y0, caption, quote, badge):
        canvas = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(canvas)
        px, py, pw, ph = self.PX, self.PY, self.PW, self.PH
        y0 = max(0, min(shot.height - self.WIN, round(y0)))
        win = shot.crop((0, y0, self.SRC_W, y0 + self.WIN)).resize((pw, ph), Image.LANCZOS)
        d.rounded_rectangle((px - 3, py - 3, px + pw + 2, py + ph + 2), radius=33, outline=(212, 212, 222), width=2)
        mask = Image.new('L', (pw, ph), 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, pw - 1, ph - 1), radius=30, fill=255)
        canvas.paste(win, (px, py), mask)
        tx = px + pw + 110; tw = W - tx - 120; y = 200
        if self.chap: d.text((tx, y), self.chap, font=F_CHAP, fill=ACC); y += 70
        if quote:
            lines = wrap(d, f'“{quote}”', F_QUOTE, tw)[:5]
            d.rounded_rectangle((tx - 24, y - 18, tx + tw + 24, y + len(lines) * 58 + 14), radius=14, fill=(240, 235, 254))
            for i, line in enumerate(lines): d.text((tx, y + i * 58), line, font=F_QUOTE, fill=FG)
            y += len(lines) * 58 + 60
        for i, line in enumerate(wrap(d, caption or '', F_CAP, tw)[:6]):
            d.text((tx, y + i * 60), line, font=F_CAP, fill=FG)
        if badge:
            big, small = badge
            d.rounded_rectangle((tx, H - 230, tx + 330, H - 110), radius=14, fill=(20, 18, 31))
            d.text((tx + 26, H - 222), big, font=F_BIG, fill=(255, 255, 255))
            d.text((tx + 26, H - 148), small, font=F_BADGE, fill=(200, 196, 220))
        return canvas

    def take(self, src, segs):
        """segs: [{a, b, x=1, cap='', quote='', say='', y=0, audio=True}]; a/b are ms or event labels ('mark:2a',
        'say:2a' = when that clip started, '+1500' = ms after the previous b)."""
        frames = sorted((int(f[:-4]), f) for f in os.listdir(os.path.join(src, 'frames')) if f.endswith('.jpg'))
        ev = [json.loads(l) for l in open(os.path.join(src, 'events.jsonl'))]
        # audio.webm holds one recording per page load (each with its own header and its own audio-start event):
        # split it at the headers and pair the parts with the events in order.
        starts = [e['t'] for e in ev if e['ev'] == 'audio-start']
        parts = []
        files = [(e['t'], os.path.join(src, e['file'])) for e in ev if e['ev'] == 'audio-start' and e.get('file')]
        if files: parts = files   # rig2 after 2026-10-14: one file per page load
        elif starts and os.path.exists(os.path.join(src, 'audio.webm')):
            blob = open(os.path.join(src, 'audio.webm'), 'rb').read(); m = b'\x1a\x45\xdf\xa3'; pos = []; i = 0
            while (i := blob.find(m, i)) >= 0: pos.append(i); i += 4
            for k, (p0, t0) in enumerate(zip(pos, starts)):
                f = os.path.join(src, f'audio-part{k}.webm')
                if not os.path.exists(f): open(f, 'wb').write(blob[p0:pos[k + 1] if k + 1 < len(pos) else len(blob)])
                parts.append((t0, f))
        a_start = starts[0] if starts else None
        def at(v, prev):
            if isinstance(v, (int, float)): return int(v)
            if v.startswith('+'): return prev + int(v[1:])
            kind, label = v.split(':', 1)
            for e in ev:
                if kind == 'mark' and e['ev'] == 'mark' and e.get('label') == label: return e['t']
                if kind == 'say' and e['ev'] == 'say' and os.path.basename(e.get('clip', '')).startswith(label): return e['t']
            raise KeyError(v)
        prev, fi, cache = frames[0][0], 0, {}
        for s in segs:
            a = at(s['a'], prev); b = at(s['b'], a); prev = b; x = float(s.get('x', 1))
            if s.get('say'): self.speak(s['say'])
            cap = s.get('cap', s.get('say', ''))
            if cap or s.get('quote'): self.cues.append((self.now(), self.now() + (b - a) / 1000 / x, s.get('quote') or cap))
            part = next(((t0, f) for t0, f in reversed(parts) if t0 <= a), None)
            if x == 1 and s.get('audio', True) and part:
                wav = os.path.join(src, f'aud-{a}-{b}.wav')
                if not os.path.exists(wav):
                    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{(a - part[0]) / 1000:.3f}', '-t', f'{(b - a) / 1000:.3f}',
                                    '-i', part[1], '-ar', '48000', '-ac', '1', wav], check=True)
                if os.path.getsize(wav) > 1000: self.audio.append((self.now(), wav))
            t = float(a)
            while t <= b:
                while fi + 1 < len(frames) and frames[fi + 1][0] <= t: fi += 1
                while fi > 0 and frames[fi][0] > t: fi -= 1
                f = frames[fi][1]
                if f not in cache: cache.clear(); cache[f] = Image.open(os.path.join(src, 'frames', f)).convert('RGB')
                badge = (f'{x:g}×', f'real time {int((t - a) / 60000)}:{int((t - a) / 1000 % 60):02d}') if x > 1 else None
                self.emit(self._canvas(cache[f], s.get('y', 0) * 2, cap, s.get('quote', ''), badge))
                t += 1000 * x / FPS
            hold_s = s.get('hold', 0)
            if hold_s: self.emit(self._canvas(cache[f], s.get('y', 0) * 2, cap, s.get('quote', ''), None), round(hold_s * FPS))

V = os.path.expanduser('~/.local/share/qodebase-video')
TAKES2 = [os.path.join(V, t) for t in os.environ.get('TAKES2', 'take-5,take-5b').split(',')]

def script(c):
    c.chapter('')
    c.deck(1); c.deck(2)
    c.chapter('The idea: land by intent')
    for n in (4, 5, 6): c.deck(n)
    c.chapter('A team build, by voice')
    for t in TAKES2: c.take(t, json.load(open(os.path.join(t, 'segs.json'))))
    c.deck(23)
    c.chapter('It works with real agents')
    for n in (9, 11, 12): c.deck(n)
    c.chapter('Many agents, at scale')
    for n in (14, 15, 16, 17): c.deck(n)
    c.chapter('A thousand agents, by voice')
    T3 = os.path.join(V, os.environ.get('TAKE3', 'take-s3d'))
    c.take(T3, json.load(open(os.path.join(T3, 'segs.json'))))
    c.deck(22)
    c.chapter('Built on Cloudflare')
    c.deck(26)
    c.chapter('')
    c.deck(27); c.deck(29)

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(base.VIDEO, 'out', 'qodebase-contest-v2.mp4')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    c = Cut2(out); script(c); c.close()
