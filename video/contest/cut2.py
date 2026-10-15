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
F_MSG, F_WHO = font(32, 500), font(22, 600)
F_VH, F_VSUB, F_VBIG, F_VLAB = font(92, 700), font(46, 500), font(150, 700), font(36, 500)

def deck_notes():
    s = open(os.path.join(ROOT, 'public', 'deck', 'index.html')).read()
    out = {}
    for i, (t, b) in enumerate(re.findall(r'<section class="s[^"]*" data-t="([^"]*)"[^>]*>(.*?)</section>', s, re.S), 1):
        m = re.search(r'<aside class="say">(.*?)</aside>', b, re.S)
        out[i] = (t, ' '.join(html.unescape(re.sub('<[^>]+>', '', m.group(1))).split()) if m else '')
    return out

class Cut2(base.Cut):
    PX, PY, PW, PH = 150, 40, 462, H - 80      # the phone: the whole 390x844 screen (the voice bar at the bottom stays in frame)
    SRC_W = 780
    WIN = round(PH * SRC_W / PW)

    def __init__(self, out):
        super().__init__(out)
        self.notes = deck_notes(); self.pace = []; self.marks = [(0.0, 'Why qodebase')]

    def deck(self, n, say=None, after=0.4):
        title, notes = self.notes[n]
        text = say if say is not None else notes
        im = Image.open(os.path.join(DECK, f'{n:02d}.png')).convert('RGB').resize((W, H))
        secs = max(hold(text) if text else 2.5, (self.speak(text) if text else 0) + self.TAIL)
        if text: self.cues.append((self.now(), self.now() + secs, text))
        self.emit(im, round(secs * FPS)); self.block_end()

    LEAD, TAIL = 0.4, 1.0
    def speak(self, text):
        path, secs = base.voice(text)
        if path:
            st = self.now() + self.LEAD
            self.audio.append((st, path)); self.vo_end = st + secs
            self.pace.append([st + secs, None, text[:50]])
        return secs + self.LEAD

    def block_end(self):
        """Close the pacing record of narration started in this block (Eyal: hold >= 0.8 s after it ends)."""
        for p in self.pace:
            if p[1] is None: p[1] = self.now()

    PARTS = ['The idea', 'Watch it work, by voice', 'Does it hold up? 40, 200 and thousands of agents', 'Built on Cloudflare']
    PART_SHORT = ['The idea', 'Watch it work', 'Does it hold up?', 'Built on Cloudflare']
    F_PART = font(28, 500)
    part = None

    def emit(self, im, n=1):
        """Every frame after the agenda carries a small part label, top right (the phone sits top left)."""
        if self.part is not None and n:
            im = im.copy(); d = ImageDraw.Draw(im)
            t = f'Part {self.part + 1} of {len(self.PARTS)}: {self.PART_SHORT[self.part]}'
            w = d.textlength(t, font=self.F_PART); d.text((W - 96 - w, 40), t, font=self.F_PART, fill=DIM)
            fit_check(d, [(t, self.F_PART)], W - 192, 'part label')
        return super().emit(im, n)

    def agenda_im(self, cur=None):
        im = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(im)
        d.text((160, 170), 'In four parts', font=F_VH, fill=FG)
        for i, p in enumerate(self.PARTS):
            y = 360 + i * 120; on = cur is None or i == cur
            d.text((160, y), f'{i + 1}', font=F_VSUB, fill=ACC if on else LINE)
            d.text((260, y), p, font=font(46, 700) if i == cur else F_VSUB, fill=FG if on else DIM)
        fit_check(d, [(p, F_VSUB) for p in self.PARTS], W - 420, 'agenda')
        return im

    def agenda(self, say):
        secs = self.speak(say) + self.TAIL; self.cues.append((self.now(), self.now() + secs, say))
        self.emit(self.agenda_im(), round(max(6.0, secs) * FPS)); self.block_end()

    def start_part(self, i):
        """A short title moment as each part starts: the agenda with this part highlighted, then its label in the corner."""
        self.part = i; self.chapter(self.PARTS[i]); self.marks.append((self.now(), f'Part {i + 1}: {self.PARTS[i]}')); self.emit(self.agenda_im(i), round(2.0 * FPS))

    def chapter(self, title):
        # no 0.5 s blank page between chapters (review of voice-7: white flashes at 0:40, 4:04, 5:26, 8:02)
        self.chapters.append((self.now(), title)); self.chap = title

    def vslide(self, headline, sub='', nums=(), say='', after=0.6, logo=False):
        """A video slide: one big headline (<= 8 words), at most one short line, or up to three big numbers; the
        narration carries the detail (Eyal, 2026-10-14: the deck's paragraphs are unreadable in a video)."""
        im = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(im)
        hl = wrap(d, headline, F_VH, W - 320)
        if logo: self.logo(im, 160, 120, 150)
        y = (H - (len(hl) * 104 + (len(wrap(d, sub, F_VSUB, W - 320)) * 60 + 30 if sub else 0) + (300 if nums else 0))) // 2
        for i, l in enumerate(hl): d.text((160, y + i * 104), l, font=F_VH, fill=FG)
        y += len(hl) * 104 + 30
        for l in wrap(d, sub, F_VSUB, W - 320) if sub else []: d.text((160, y), l, font=F_VSUB, fill=DIM); y += 60
        if sub: y += 30
        fit_check(d, [(l, F_VH) for l in hl] + [(l, F_VSUB) for l in (wrap(d, sub, F_VSUB, W - 320) if sub else [])], W - 320, headline)
        if nums:
            fb = F_VBIG   # shrink the numbers until the row fits the safe area (44.5 min reached the edge)
            for size in (150, 136, 124, 112, 100):
                fb = font(size, 700); widths = [d.textlength(b, font=fb) + 90 for b, _ in nums]
                if sum(max((W - 320) // len(nums), w) for w in widths) <= W - 320: break
            colw = (W - 320) // len(nums); x = 160
            for i, (big, label) in enumerate(nums):
                bw = d.textlength(big, font=fb)
                cw = max(colw, bw + 90)                     # a wide number gets the room it needs
                d.text((x, y + 20), big, font=fb, fill=ACC)
                if x + bw > W - 160: FIT_FAIL.append((headline[:40], big))
                for j, l in enumerate(wrap(d, label, F_VLAB, max(cw - 60, 300))[:3]): d.text((x, y + 200 + j * 46), l, font=F_VLAB, fill=FG)
                x += cw
        secs = max(hold(headline + ' ' + sub), (self.speak(say) + max(after, self.TAIL)) if say else 0)
        if say: self.cues.append((self.now(), self.now() + secs, say))
        self.emit(im, round(secs * FPS)); self.block_end()

    @staticmethod
    def logo(im, x, y, size):
        """qodebase's q mark (public icon: violet rounded square, white ring and stem), drawn at size px."""
        k = size / 256; d = ImageDraw.Draw(im)
        d.rounded_rectangle((x, y, x + size, y + size), radius=round(48 * k), fill=(106, 47, 240))
        d.ellipse((x + (121 - 48) * k, y + (110 - 48) * k, x + (121 + 48) * k, y + (110 + 48) * k), outline=(255, 255, 255), width=round(30 * k))
        d.rectangle((x + 154 * k, y + 58 * k, x + 184 * k, y + 196 * k), fill=(255, 255, 255))

    def end_card(self, say):
        """Try it: one URL per row, logo, held ~4 s after the narration."""
        im = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(im)
        self.logo(im, 160, 170, 150)
        d.text((160, 380), 'Try it: qodebase.app', font=font(110, 700), fill=FG)
        rows = [('Watch a run, no sign-in', 'qodebase.app/how'), ('Code on qodebase', 'qodebase.app/p/eyal/qodebase'), ('Code on GitHub', 'github.com/eyalev/qodebase')]
        for i, (k, v) in enumerate(rows):
            y = 560 + i * 90; d.text((160, y), k + ':', font=F_VSUB, fill=DIM); d.text((760, y), v, font=F_VSUB, fill=ACC)
        fit_check(d, [('Try it: qodebase.app', font(110, 700))] + [(v, F_VSUB) for _, v in rows], W - 320, 'end card')
        secs = self.speak(say) + 4.0; self.cues.append((self.now(), self.now() + secs, say)); self.emit(im, round(secs * FPS)); self.block_end()

    def title_card(self, say, after=0.6):
        im = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(im)
        self.logo(im, 160, 380, 200)
        d.text((410, 395), 'qodebase', font=font(150, 700), fill=FG)
        d.text((414, 575), 'Many AI agents change one codebase; their work lands by itself.', font=F_VSUB, fill=DIM)
        secs = max(4.0, self.speak(say) + self.TAIL); self.cues.append((self.now(), self.now() + secs, say)); self.emit(im, round(secs * FPS)); self.block_end()

    def scale_chart(self, say, after=0.6):
        """Eyal: the old ladder read as 'scaling failed'. Two groups: realistic (every file read from storage) and
        best case (files repeat, read cache, no model calls), files per second over the busiest 10 s."""
        im = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(im)
        d.text((160, 110), 'Files per second, busiest 10 seconds', font=F_VH, fill=FG)
        groups = [('Realistic: every file read from storage (cached answers, no model calls)', ACC, [('1,000 agents', 1230), ('4,750 agents', 2100), ('10,000 agents', 1900)],
                   'Capped by the account\'s storage reads, about 2,000 a second; the 10,000 run still finished in 86 s.'),
                  ('Best case: files repeat (read cache, no model calls)', (148, 96, 15), [('50,000 agents', 12900), ('100,000 agents, 0 lost', 22400)], '')]
        mx, y, x0, x1 = 22400, 270, 560, W - 260
        for title, col, bars, note in groups:
            d.text((160, y), title, font=F_VSUB, fill=col); y += 70
            for label, v in bars:
                d.text((160, y + 4), label, font=F_VLAB, fill=FG)
                w = max(8, int((x1 - x0) * v / mx)); d.rounded_rectangle((x0, y, x0 + w, y + 46), radius=8, fill=col)
                d.text((x0 + w + 20, y + 2), f'{v:,}', font=F_VLAB, fill=FG); y += 66
            for l in (wrap(d, note, F_VLAB, W - 400) if note else []): d.text((160, y + 4), l, font=F_VLAB, fill=DIM); y += 50
            if note: y += 10
            y += 40
        secs = max(6.0, self.speak(say) + self.TAIL)
        self.cues.append((self.now(), self.now() + secs, say)); self.emit(im, round(secs * FPS)); self.block_end()

    def _canvas(self, shot, y0, caption, quote, badge, zoom=1.0):
        canvas = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(canvas)
        px, py, pw, ph = self.PX, self.PY, self.PW, self.PH
        if zoom > 1:   # a closer look: the window is narrower in the source, the frame on screen is wider
            sw = round(self.SRC_W / zoom); sh = round(shot.height / zoom); pw = round(pw * 1.3); px = max(60, px - 70)
            x0 = (self.SRC_W - sw) // 2; y0 = max(0, min(shot.height - sh, round(y0)))
            win = shot.crop((x0, y0, x0 + sw, y0 + sh)).resize((pw, ph), Image.LANCZOS)
        else:
            y0 = max(0, min(shot.height - self.WIN, round(y0)))
            win = shot.crop((0, y0, self.SRC_W, y0 + self.WIN)).resize((pw, ph), Image.LANCZOS)
        d.rounded_rectangle((px - 3, py - 3, px + pw + 2, py + ph + 2), radius=33, outline=(212, 212, 222), width=2)
        mask = Image.new('L', (pw, ph), 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, pw - 1, ph - 1), radius=30, fill=255)
        canvas.paste(win, (px, py), mask)
        tx = px + pw + 110; tw = W - tx - 120; y = 120
        if self.chap: d.text((tx, y), self.chap, font=F_CHAP, fill=ACC); y += 56
        for i, line in enumerate(wrap(d, caption or '', F_CAP, tw)[:5]):
            d.text((tx, y + i * 56), line, font=F_CAP, fill=FG)
        if caption: y += min(5, len(wrap(d, caption, F_CAP, tw))) * 56 + 30
        chat = list(getattr(self, 'chat', [])) or ([('you', quote)] if quote else [])
        top, bottom = y, (H - 260 if badge else H - 80)
        blocks, yb = [], bottom
        for who, text in reversed(chat):
            bw = tw * (.78 if who == 'you' else .86)
            lines = wrap(d, text, F_MSG, bw - 48)
            if len(lines) > 7: lines = lines[:6] + [lines[6].rstrip(' ,.') + ' …']
            hgt = len(lines) * 42 + 30 + (28 if who == 'talk' else 0)
            if yb - hgt < top: break
            yb -= hgt; blocks.append((who, lines, yb, hgt)); yb -= 16
        for who, lines, yy, hgt in blocks:
            w_ = max(d.textlength(l, font=F_MSG) for l in lines) + 48
            if who == 'you':
                x0 = tx + tw - w_; d.rounded_rectangle((x0, yy, tx + tw, yy + hgt), radius=18, fill=(240, 235, 254))
                for i, l in enumerate(lines): d.text((x0 + 24, yy + 15 + i * 42), l, font=F_MSG, fill=FG)
            else:
                d.text((tx, yy), 'Talk', font=F_WHO, fill=ACC)
                d.rounded_rectangle((tx, yy + 28, tx + w_, yy + hgt), radius=18, fill=(255, 255, 255), outline=LINE, width=2)
                for i, l in enumerate(lines): d.text((tx + 24, yy + 43 + i * 42), l, font=F_MSG, fill=FG)
        if badge:
            big, small = badge
            d.rounded_rectangle((tx, H - 230, tx + 330, H - 110), radius=14, fill=(20, 18, 31))
            d.text((tx + 26, H - 222), big, font=F_BIG, fill=(255, 255, 255))
            d.text((tx + 26, H - 148), small, font=F_BADGE, fill=(200, 196, 220))
        return canvas

    def take(self, src, segs):
        tight = os.path.join(src, 'segs.tight.json')
        if os.environ.get('TIGHT', '1') == '1' and os.path.exists(tight): segs = json.load(open(tight))
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
        tl = os.path.join(src, 'talk.json'); talk_lines = json.load(open(tl)) if os.path.exists(tl) else []
        cj = os.path.join(src, 'chat.json'); chat_ev = sorted(json.load(open(cj))) if os.path.exists(cj) else []
        self.chat = []; ci = 0
        tab = next(((e['t'], os.path.join(src, e['file'])) for e in ev if e['ev'] == 'tab-audio-start'), None)
        prev, fi, cache = frames[0][0], 0, {}
        last_b = None
        for s in segs:
            a = at(s['a'], prev); b = at(s['b'], a); prev = b; x = float(s.get('x', 1))
            if x > 1 and s.get('say'):
                need = base.voice(s['say'])[1] + self.LEAD + self.TAIL
                if (b - a) / 1000 / x < need: x = max(1.0, (b - a) / 1000 / need)
            jump = (a - last_b) if (last_b is not None and x == 1 and a - last_b > 15000) else 0
            last_b = b
            if s.get('say'): self.speak(s['say'])
            cap = s.get('cap', s.get('say', ''))
            if cap or s.get('quote'): self.cues.append((self.now(), self.now() + max((b - a) / 1000 / x + s.get('hold', 0), base.voice(s['say'])[1] if s.get('say') else 0), s.get('quote') or cap))
            # The user's words: the clip itself, mixed in at the moment the rig played it into the mic (clean, and
            # independent of the page recording). The page recording below adds Talk's own spoken replies.
            if x == 1:
                for e in ev:
                    if e['ev'] == 'say' and a <= e['t'] < b and os.path.exists(e.get('clip', '')):
                        self.audio.append((self.now() + (e['t'] - a) / 1000, e['clip']))
            if x == 1 and tab:   # the tab's real output (Talk's replies as played)
                wav = os.path.join(src, f'tab-{a}-{b}.wav')
                if not os.path.exists(wav):
                    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{(a - tab[0]) / 1000:.3f}', '-t', f'{(b - a) / 1000:.3f}', '-i', tab[1], '-ar', '48000', '-ac', '1', wav], check=True)
                self.audio.append((self.now(), wav))
            if x == 1 and not tab:
                for t_ms, text in talk_lines:
                    if a <= t_ms < b:
                        f = talk_voice(text)
                        if f: self.audio.append((self.now() + (t_ms - a) / 1000, f))
            part = next(((t0, f) for t0, f in reversed(parts) if t0 <= a), None)
            if x == 1 and s.get('audio', True) and part and not talk_lines and not tab and (s.get('page_audio') or not s.get('quote')):
                wav = os.path.join(src, f'aud-{a}-{b}.wav')
                if not os.path.exists(wav):
                    # a page recording can end early (the page navigated away mid-chunk): a slice past its end is skipped
                    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{(a - part[0]) / 1000:.3f}', '-t', f'{(b - a) / 1000:.3f}',
                                    '-i', part[1], '-ar', '48000', '-ac', '1', wav], check=False)
                if os.path.exists(wav) and os.path.getsize(wav) > 1000: self.audio.append((self.now(), wav))
                else: print(json.dumps({'event': 'page_audio_missing', 'take': os.path.basename(src), 'a': a, 'b': b}), file=sys.stderr)
            t = float(a)
            while t <= b:
                while ci < len(chat_ev) and chat_ev[ci][0] <= t:
                    self.chat.append((chat_ev[ci][1], chat_ev[ci][2]))
                    if chat_ev[ci][0] > 0: self.cues.append((self.now(), self.now() + max(2.0, len(chat_ev[ci][2]) / (11.5 if chat_ev[ci][1] == 'talk' else 15)), ('Talk: ' if chat_ev[ci][1] == 'talk' else '') + chat_ev[ci][2]))   # t=0 lines only carry the transcript over from the previous take
                    ci += 1
                tf = min(t, s['frame_until']) if s.get('frame_until') else t
                while fi + 1 < len(frames) and frames[fi + 1][0] <= tf: fi += 1
                while fi > 0 and frames[fi][0] > tf: fi -= 1
                f = frames[fi][1]
                if f not in cache: cache.clear(); cache[f] = cover_talk_version(Image.open(os.path.join(src, 'frames', f)).convert('RGB'))
                badge = (f'{round(x)}×', f'real time {int((t - a) / 60000)}:{int((t - a) / 1000 % 60):02d}') if x > 1 else (('later', f'+{round(jump / 60000)} min' if jump >= 60000 else f'+{round(jump / 1000)} s') if jump and t - a < 2000 else None)
                self.emit(self._canvas(cache[f], s.get('y', 0) * 2, cap, s.get('quote', ''), badge, s.get('zoom', 1.0)))
                t += 1000 * x / FPS
            hold_s = s.get('hold', 0)
            if s.get('say') and x == 1: hold_s = max(hold_s, base.voice(s['say'])[1] + self.LEAD + self.TAIL - (b - a) / 1000)
            if hold_s: self.emit(self._canvas(cache[f], s.get('y', 0) * 2, cap, s.get('quote', ''), None, s.get('zoom', 1.0)), round(hold_s * FPS))
            self.block_end()

V = os.path.expanduser('~/.local/share/qodebase-video')
def talk_voice(text):
    """Talk's spoken reply, rebuilt: Aura-2 'draco' (Talk's voice) at Talk's 1.25x speed, cached by text."""
    sp = base.VO_SPEAKER
    try:
        base.VO_SPEAKER = 'draco'; path, _ = base.voice(text)
    finally:
        base.VO_SPEAKER = sp
    if not path: return None
    out = path[:-4] + '-x125.wav'
    if not os.path.exists(out): subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', path, '-af', 'atempo=1.25', '-ar', '48000', '-ac', '1', out], check=True)
    return out

def cover_talk_version(im):
    """Paint over Talk's build stamp ('7f8de12 10:29 talk 93b9730') in the sheet header, only when the header is there:
    a purple Conversation pill (short, white on both sides) with the dark word 'Talk' at the far left of the same row."""
    px = im.load(); w, h = im.size
    purple = lambda c: abs(c[0] - 106) < 30 and abs(c[1] - 47) < 30 and abs(c[2] - 240) < 30
    light = lambda c: sum(c) > 690
    rows = [y for y in range(0, h, 2) if sum(1 for x in range(int(w * .44), int(w * .64), 6) if purple(px[x, y])) > 12]
    if not rows: return im
    y0 = rows[0]; y1 = y0
    for y in rows:
        if y - y1 > 20: break   # the white lettering inside the pill leaves short gaps
        y1 = y
    ym = (y0 + y1) // 2
    if not (40 <= y1 - y0 <= 110): return im                                  # a pill, not a big button
    if not (light(px[int(w * .38), ym]) and light(px[int(w * .70), ym])): return im   # white either side of it
    if sum(1 for x in range(int(w * .03), int(w * .13), 2) if sum(px[x, ym]) < 200) < 3: return im   # the word 'Talk'
    bg = px[int(w * .38), ym]
    ImageDraw.Draw(im).rectangle((int(w * .135), y0 - 4, int(w * .40), y1 + 4), fill=bg)
    return im

TAKES2 = [os.path.join(V, t) for t in os.environ.get('TAKES2', 'take-d2,take-d2b,take-d2w,take-d2s').split(',')]

def script(c):
    PROVED = [('10,000', 'agents on Cloudflare, cached answers'), ('200', 'agents on one codebase: 0 lost in landing at 60% overlap'), ('40', 'Claude agents on one app')]
    c.chapter('')
    c.title_card(say="This is qodebase: a git platform where many AI agents change one codebase at the same time, and their work lands by itself.")
    c.vslide('Agents write code faster than people can review it', say="Agents now write code faster than people can review it and merge it. And when many agents work at once, their changes depend on each other and collide.")
    c.vslide('qodebase lands each change by its intent', sub='Phone-first, and on desktop too, on Cloudflare', say="qodebase lands each change by what it was asked to do, on the newest code. You run it from a phone or a desktop, and it is built on Cloudflare.")
    c.vslide('What we proved', nums=PROVED, say="We proved it at three scales: ten thousand agents on Cloudflare with cached answers instead of model calls, two hundred agents on one codebase with at most two changes lost in landing, and up to forty agents running Claude, building one app.")
    c.agenda(say="In four parts: the idea; watching it work, by voice; whether it holds up with forty, two hundred and thousands of agents; and what it is built on.")
    c.start_part(0)
    c.deck(4, say="A hint from real history. Hono is an open-source web framework. Replaying a hundred of its real pull requests as if they were written at the same moment, almost half needed another one to land first. People write pull requests one after another; agents in parallel can't see each other's unlanded work. So dependent work must wait, be stacked, or be redone after it lands.")
    c.deck(5)
    c.deck(6, say="Every change keeps its record inside git, as a note on its commit: what it was asked to do, which agent did it, the review, or that there was none, how it landed, and the tests.")
    c.start_part(1); c.chap = 'A team build, all by voice'
    for t in TAKES2: c.take(t, json.load(open(os.path.join(t, 'segs.json'))))
    c.start_part(2)
    c.deck(11, say="Then a bigger build: forty agents running Claude built one travel planner. Twenty-eight of their changes collided, and a model redid every one on the newest code. We tried the app by hand: eleven of thirteen features work. The two that didn't taught us two fixes: a shared contract, so agents agree on how their pieces connect, and a check that a redone change can't drop work.")
    c.deck(12, say="And an honest finding: for a fresh app, one strong agent beat a team. A single Opus agent finished sooner in all three comparisons, two to six times, with at least as many features working; the team was cheaper in two of three.")
    c.vslide('200 agents on one codebase', nums=(('1,385', 'coding tasks, checked by hidden tests'), ('0', 'lost in landing at 60% overlap'), ('44.5 min', 'with lanes and prefetch, from 207')), say="To test landing itself, with tests the agents never saw: two hundred cheap-model agents took almost fourteen hundred coding tasks on one codebase. As more tasks aimed at the same functions, losses stayed in the same range: at most two changes lost in landing, none at sixty percent overlap. The overlap cost time; lanes, one landing queue per module, cut the worst case from two hundred and seven minutes to forty-four and a half.")
    c.scale_chart(say="Then thousands of agents on one platform. With every file different, storage reads cap it near two thousand files a second; ten thousand agents still put all their changes on main in eighty-six seconds. When files repeat, the cache lets a hundred thousand agents reach twenty-two thousand a second, with nothing lost. All of these used cached answers instead of model calls.")
    c.chapter('A thousand agents, all by voice')
    T3 = os.path.join(V, os.environ.get('TAKE3', 'take-c3'))
    c.take(T3, json.load(open(os.path.join(T3, 'segs.json'))))
    c.start_part(3)
    c.vslide('All of it runs on Cloudflare', sub='Workers, Durable Objects, Artifacts, Containers, Workers AI and AI Gateway', say="Underneath, it is all Cloudflare: Workers serve the app, Durable Objects hold every project and agent, Artifacts hold every repository and fork, Containers run the agents, and the low-cost models and the voice run through Workers AI and Cloudflare's AI Gateway.")
    c.chapter(''); c.part = None; c.marks.append((c.now(), 'Try it'))
    c.vslide('What we proved', nums=PROVED, say="Ten thousand agents on one platform with cached answers, two hundred on one codebase with at most two changes lost in landing, and up to forty agents running Claude building one app, every step recorded and visible.")
    c.end_card(say="Try it yourself at qodebase dot app: watch a run with no sign-in, and read the code.")

_SPEECH = {}
def speech_spans(path, start):
    """Where a clip actually speaks (silencedetect at -40 dB, 0.25 s), shifted to its start in the cut."""
    if path not in _SPEECH:
        o = subprocess.run(['ffmpeg', '-nostdin', '-i', path, '-af', 'silencedetect=noise=-40dB:d=0.25', '-f', 'null', '-'], capture_output=True, text=True).stderr
        import re
        dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], capture_output=True, text=True).stdout or 0)
        st = [float(x) for x in re.findall(r'silence_start: ([0-9.]+)', o)]; en = [float(x) for x in re.findall(r'silence_end: ([0-9.]+)', o)]
        edges = [0.0] + [v for pr in zip(st, en) for v in pr] + [dur]
        _SPEECH[path] = [(a, b) for a, b in zip(edges[0::2], edges[1::2]) if b - a > 0.12]
    return [(start + a, start + b) for a, b in _SPEECH[path]]

FIT_FAIL = []
def fit_check(d, lines, width, where):
    """Eyal: nothing may run past the safe area. Every drawn line must fit its width (fails the render otherwise)."""
    for text, f in lines:
        if d.textlength(text, font=f) > width + 1: FIT_FAIL.append((where[:40], text[:60]))

def voice_kind(path):
    if '/clips/user/' in path: return 'user'
    if os.path.basename(path).startswith(('tab-', 'aud-')) or path.endswith('-x125.wav'): return 'talk'
    return 'narrator'

def overlap_check(audio):
    """Eyal's rule: never two voices at once. Returns the overlaps (kind, kind, t0, t1) between user, Talk and narrator."""
    spans = [(k, a, b) for t, f in audio for k in [voice_kind(f)] for a, b in speech_spans(f, t)]
    spans.sort(key=lambda x: x[1]); bad = []
    for i, (k1, a1, b1) in enumerate(spans):
        for k2, a2, b2 in spans[i + 1:]:
            if a2 >= b1: break
            if k1 != k2 and min(b1, b2) - a2 > 0.05: bad.append((k1, k2, round(a2, 2), round(min(b1, b2), 2)))
    return bad

def _no_overlap(cues):
    cues.sort(key=lambda c: c[0])
    return [(a, min(b, cues[i + 1][0] - 0.01) if i + 1 < len(cues) else b, t) for i, (a, b, t) in enumerate(cues)]

_close = Cut2.close
def _close_fixed(self):
    self.cues = _no_overlap(self.cues)
    if FIT_FAIL:
        print(json.dumps({'event': 'fit_check', 'overflows': FIT_FAIL}))
        if os.environ.get('ALLOW_OVERFLOW') != '1': _close(self); sys.exit(f'fit check FAILED: {len(FIT_FAIL)} lines overflow')
    print(json.dumps({'event': 'fit_check', 'overflows': 0}))
    late = [(round(p[1] - p[0], 2), p[2]) for p in self.pace if p[1] is not None and p[1] - p[0] < 0.8]
    print(json.dumps({'event': 'pace_check', 'late': late}))
    if late and os.environ.get('ALLOW_PACE') != '1': _close(self); sys.exit(f'pace check FAILED: {len(late)} narrations end < 0.8 s before their slide ends')
    with open(os.path.splitext(self.out)[0] + '.chapters.txt', 'w') as f:
        for t, title in self.marks: f.write(f'{int(t // 60)}:{int(t % 60):02d} {title}\n')
    bad = overlap_check(self.audio)
    print(json.dumps({'event': 'overlap_check', 'overlaps': len(bad), 'list': bad[:20]}))
    if bad and os.environ.get('ALLOW_OVERLAP') != '1':
        _close(self); sys.exit(f'overlap check FAILED: {len(bad)} overlaps (see above); fix the timing (ALLOW_OVERLAP=1 to keep the file)')
    return _close(self)
Cut2.close = _close_fixed

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(base.VIDEO, 'out', 'qodebase-contest-v2.mp4')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    c = Cut2(out); script(c); c.close()
