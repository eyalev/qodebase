#!/usr/bin/env python3
"""Assemble the contest video from slides, phone recordings, cards and a voice-over.

  node video/contest/shoot-slides.mjs      # slides -> video/contest/build/slides/*.png
  node video/contest/rec-work.mjs open live # product scenes -> video/frames/contest-{open,live}
  python3 video/contest/cut.py [out.mp4]   # -> video/out/qodebase-contest.mp4 + .srt
  VO=0 python3 video/contest/cut.py        # captions only, no narration

The scene list (script() below) follows docs/contest/storyboard.md; change both together.
Look and pacing: docs/video-guide.md. Slides are full frame with the caption in the
bottom 200 px (slides.html and qb5's evidence charts leave it empty); phone scenes put
the phone on the left and the caption on the right.

Voice-over: every caption is spoken by Deepgram Aura-2 on Cloudflare Workers AI, through
the forq account's AI Gateway `qodebase-talk` (the voice qodebase's Talk uses). Clips are
cached by text in build/vo/, so a re-cut only pays for changed lines ($0.03 per 1,000
characters; the whole script is ~5,000). Every paid call goes to build/vo/ledger.jsonl.
A caption stays up as long as its reading time or its narration, whichever is longer; in
phone scenes the picture holds still while the narration finishes.
"""
import hashlib, json, os, re, subprocess, sys, time, urllib.request
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEO = os.path.dirname(HERE)
ROOT = os.path.dirname(VIDEO)
W, H, FPS = 1920, 1080, 30
# DESIGN.md dark tokens
BG, CARD, LINE = (12, 13, 14), (20, 21, 23), (34, 36, 40)
FG, DIM, ACC, BUSY = (236, 236, 238), (154, 159, 166), (79, 191, 159), (224, 169, 72)
GEIST = os.path.join(VIDEO, 'fonts', 'Geist.ttf')
EVID = 'docs/contest/evidence/{}-1920x1080-dark.png'

def font(size, weight=400):
    f = ImageFont.truetype(GEIST, size)
    f.set_variation_by_axes([weight])
    return f

F_TITLE, F_SUB, F_CAP, F_CHAP, F_BADGE = font(96, 600), font(44), font(44, 500), font(32, 600), font(30, 600)

def wrap(d, text, f, width):
    lines, cur = [], ''
    for w in text.split():
        t = (cur + ' ' + w).strip()
        if d.textlength(t, font=f) <= width: cur = t
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def hold(text):
    """Reading time: max(1.6 s, 0.36 s/word, 15 chars/s), at most 7 s, plus a beat."""
    return min(7.0, max(1.6, len(text.split()) * 0.36, len(text) / 15)) + 0.4

# ---- voice-over (Aura-2 via Workers AI) ----
VO_ON = os.environ.get('VO', '1') != '0'
VO_DIR = os.path.join(HERE, 'build', 'vo')
VO_MODEL, VO_SPEAKER = '@cf/deepgram/aura-2-en', os.environ.get('VO_SPEAKER', 'draco')
ACCOUNT, GATEWAY = '887d7234a6b8d65ad355a4f6684cab67', 'qodebase-talk'
# Spoken forms: what the captions write vs how it should sound.
SAY = [(r'\bqodebase\b', 'codebase'), (r'package\.json', 'package dot json'), (r'\bgit\b', 'git'), (r'(\d)\.(\d)x\b', r'\1.\2 times'), (r'\bDurable Objects\b', 'Durable Objects')]

def spoken(text):
    for a, b in SAY: text = re.sub(a, b, text)
    return text

def duration(path):
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], capture_output=True, text=True, check=True).stdout)

def voice(text):
    """(mp3 path, seconds) for a caption, cached by speaker + spoken text."""
    if not VO_ON: return None, 0.0
    os.makedirs(VO_DIR, exist_ok=True)
    words = spoken(text)
    key = hashlib.sha1(f'{VO_MODEL}|{VO_SPEAKER}|{words}'.encode()).hexdigest()[:16]
    path = os.path.join(VO_DIR, f'{key}.mp3')
    if not os.path.exists(path):
        token = open(os.path.expanduser('~/.config/forq-cf/api-token')).read().strip()
        req = urllib.request.Request(f'https://gateway.ai.cloudflare.com/v1/{ACCOUNT}/{GATEWAY}/workers-ai/{VO_MODEL}',
                                     data=json.dumps({'text': words, 'speaker': VO_SPEAKER}).encode(), method='POST',
                                     headers={'authorization': f'Bearer {token}', 'content-type': 'application/json', 'user-agent': 'qodebase-video/1'})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=60) as r: data = r.read()
                break
            except Exception as e:
                print(json.dumps({'event': 'vo_error', 'attempt': attempt, 'text': words[:60], 'error': str(e)}), file=sys.stderr)
                if attempt == 2: raise
                time.sleep(2 * (attempt + 1))
        open(path, 'wb').write(data)
        with open(os.path.join(VO_DIR, 'ledger.jsonl'), 'a') as f:
            f.write(json.dumps({'ts': time.strftime('%Y-%m-%dT%H:%M:%S'), 'model': VO_MODEL, 'speaker': VO_SPEAKER, 'chars': len(words), 'usd': round(len(words) * 0.03 / 1000, 5), 'file': os.path.basename(path)}) + '\n')
    return path, duration(path)

class Cut:
    def __init__(self, out):
        self.out, self.n, self.cues, self.audio, self.chapters, self.chap = out, 0, [], [], [], ''
        self.vo_end = 0.0
        self.silent = os.path.splitext(out)[0] + '.video.mp4'
        self.ff = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                                    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
                                    '-r', str(FPS), '-movflags', '+faststart', self.silent], stdin=subprocess.PIPE)

    def emit(self, im, n=1):
        b = im.tobytes()
        for _ in range(n): self.ff.stdin.write(b)
        self.n += n

    def now(self): return self.n / FPS

    def speak(self, text):
        """Start the caption's narration now; returns its length in seconds."""
        path, secs = voice(text)
        if path:
            self.audio.append((self.now() + 0.15, path))
            self.vo_end = self.now() + 0.15 + secs
        return secs

    # ---- scene kinds ----
    def card(self, title, sub='', secs=3.0, say=None):
        im = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(im)
        d.text((160, 380), title, font=F_TITLE, fill=FG)
        for i, line in enumerate(wrap(d, sub, F_SUB, 1550)):
            d.text((160, 520 + i * 58), line, font=F_SUB, fill=DIM)
        text = f'{title}. {sub}'.strip(' .') + '.'
        if say: secs = max(secs, self.speak(say) + 0.6)
        self.cues.append((self.now(), self.now() + secs, say or text))
        self.emit(im, round(secs * FPS))

    def chapter(self, title):
        """A chapter starts: 0.5 s of quiet page; its name rides above phone captions."""
        self.chapters.append((self.now(), title))
        self.emit(Image.new('RGB', (W, H), BG), FPS // 2)
        self.chap = title

    def slide(self, sid, captions, after=1.5):
        """sid: a slides.html id, or a repo path to a full-frame 1920x1080 PNG (qb5's charts).
        after: extra seconds on the last caption (hold on the result; charts get more)."""
        path = os.path.join(ROOT, sid) if sid.endswith('.png') else os.path.join(HERE, 'build', 'slides', f'{sid}.png')
        base = Image.open(path).convert('RGB').resize((W, H))
        for k, text in enumerate(captions):
            im = base.copy(); d = ImageDraw.Draw(im)
            d.line((140, 900, W - 140, 900), fill=LINE, width=2)
            for i, line in enumerate(wrap(d, text, F_CAP, W - 280)[:2]):
                d.text((140, 926 + i * 58), line, font=F_CAP, fill=FG)
            secs = max(hold(text), self.speak(text) + 0.5) + (after if k == len(captions) - 1 else 0)
            self.cues.append((self.now(), self.now() + secs, text))
            self.emit(im, round(secs * FPS))

    def _phone_canvas(self, shot, caption, badge=None):
        ph_h = H - 80; ph_w = round(ph_h * 390 / 844); px, py = 150, 40
        canvas = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(canvas)
        d.rounded_rectangle((px - 3, py - 3, px + ph_w + 2, py + ph_h + 2), radius=39, outline=(70, 76, 84), width=2)
        if shot is not None:
            mask = Image.new('L', (ph_w, ph_h), 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, ph_w - 1, ph_h - 1), radius=36, fill=255)
            canvas.paste(shot.resize((ph_w, ph_h), Image.LANCZOS), (px, py), mask)
        tx = px + ph_w + 110; tw = W - tx - 120
        if self.chap: d.text((tx, 220), self.chap, font=F_CHAP, fill=ACC)
        for i, line in enumerate(wrap(d, caption or '', F_CAP, tw)[:5]):
            d.text((tx, 290 + i * 62), line, font=F_CAP, fill=FG)
        if badge:
            bw = d.textlength(badge, font=F_BADGE) + 36
            d.rounded_rectangle((tx, H - 190, tx + bw, H - 136), radius=8, fill=(40, 44, 49))
            d.text((tx + 18, H - 180), badge, font=F_BADGE, fill=FG)
        return canvas, (px, py, ph_w, ph_h)

    def phone(self, scene, max_wait=8.0):
        """A rig recording (video/frames/contest-<scene>), captions from its say() events.
        A caption waits for the previous narration to finish (the picture holds still)."""
        src = os.path.join(VIDEO, 'frames', f'contest-{scene}')
        tl = json.load(open(os.path.join(src, 'timeline.json')))
        frames, ev = tl['frames'], sorted(tl['events'], key=lambda e: e['t'])
        caps = [e for e in ev if e['type'] == 'caption']
        t = caps[0]['t'] - 0.3 if caps else frames[0]['t']
        t1 = max(ev[-1]['t'], caps[-1]['t'] + hold(caps[-1]['text'])) if caps else frames[-1]['t']
        for i, e in enumerate(ev):
            if e['type'] == 'speed' and float(e['speed']) > 1:
                stop = next((x['t'] for x in ev[i + 1:] if x['type'] == 'speed'), t1)
                e['speed'] = max(float(e['speed']), (stop - e['t']) / max_wait)
        fi, ei, caption, speed, label, since, cache, open_cue, canvas = 0, 0, '', 1.0, '', None, {}, None, None
        def close_cue():
            if open_cue: self.cues.append((open_cue[0], self.now(), open_cue[1]))
        while t <= t1:
            while ei < len(ev) and ev[ei]['t'] <= t:
                e = ev[ei]; ei += 1
                if e['type'] == 'caption':
                    if canvas is not None and speed <= 1 and self.now() < self.vo_end + 0.25:   # never freeze a time-lapse
                        self.emit(canvas, round((self.vo_end + 0.25 - self.now()) * FPS))
                    close_cue()
                    caption, open_cue = e['text'], (self.now(), e['text'])
                    self.speak(caption)
                elif e['type'] == 'speed':
                    speed, label = float(e['speed']), e.get('label', ''); since = e['t'] if speed > 1 else None
            while fi + 1 < len(frames) and frames[fi + 1]['t'] <= t: fi += 1
            f = frames[fi]['file']
            if f not in cache: cache.clear(); cache[f] = Image.open(os.path.join(src, f)).convert('RGB')
            badge = f'x{round(speed)}, {label}, real time {int((t - since) // 60)}:{int((t - since) % 60):02d}' if since else None
            canvas = self._phone_canvas(cache[f], caption, badge)[0]
            self.emit(canvas)
            t += speed / FPS
        if canvas is not None and self.now() < self.vo_end + 0.5:
            self.emit(canvas, round((self.vo_end + 0.5 - self.now()) * FPS))
        close_cue()

    def todo(self, what, captions, secs=None):
        """Placeholder for footage not filmed yet: an empty phone saying what goes there,
        narrated and timed as planned (secs = the shot's planned length)."""
        for text in captions:
            im, (px, py, pw, ph) = self._phone_canvas(None, text)
            d = ImageDraw.Draw(im)
            d.rounded_rectangle((px + 20, py + 20, px + pw - 20, py + ph - 20), radius=24, fill=CARD)
            d.text((px + 50, py + 70), 'To film', font=F_CHAP, fill=BUSY)
            for i, line in enumerate(wrap(d, what, F_BADGE, pw - 100)):
                d.text((px + 50, py + 130 + i * 40), line, font=F_BADGE, fill=DIM)
            n = max(hold(text), self.speak(text) + 0.5, (secs or 0) / len(captions))
            self.cues.append((self.now(), self.now() + n, text))
            self.emit(im, round(n * FPS))

    def close(self):
        self.ff.stdin.close(); self.ff.wait()
        if self.audio:
            # One narration track: every clip delayed to its start, mixed without normalising.
            args, filt = [], []
            for i, (start, path) in enumerate(self.audio):
                args += ['-i', path]
                ms = int(start * 1000)
                filt.append(f'[{i + 1}:a]adelay={ms}|{ms},aresample=48000[a{i}]')
            mix = ''.join(f'[a{i}]' for i in range(len(self.audio))) + f'amix=inputs={len(self.audio)}:normalize=0:dropout_transition=0,loudnorm=I=-16:TP=-1.5[vo]'
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', self.silent, *args, '-filter_complex', ';'.join(filt + [mix]),
                            '-map', '0:v', '-map', '[vo]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-shortest', '-movflags', '+faststart', self.out], check=True)
            os.remove(self.silent)
        else:
            os.replace(self.silent, self.out)
        ts = lambda x: f'{int(x // 3600):02d}:{int(x % 3600 // 60):02d}:{int(x % 60):02d},{int(x * 1000 % 1000):03d}'
        with open(os.path.splitext(self.out)[0] + '.srt', 'w') as f:
            for i, (a, b, text) in enumerate(self.cues, 1):
                f.write(f'{i}\n{ts(a)} --> {ts(b)}\n{text}\n\n')
        spent = 0.0
        led = os.path.join(VO_DIR, 'ledger.jsonl')
        if os.path.exists(led): spent = sum(json.loads(l)['usd'] for l in open(led))
        print(f'{self.out}: {self.now():.0f} s ({int(self.now() // 60)}:{int(self.now() % 60):02d}), {len(self.cues)} captions, '
              f'{len(self.audio)} narration clips (voice-over spend so far ${spent:.3f})')
        for t, title in self.chapters: print(f'  {int(t // 60)}:{int(t % 60):02d}  {title or "-"}')

# ---- the script (docs/contest/storyboard.md) ----
def script(c):
    # 0. Cold open on the product (~15 s), then the title.
    c.chapter('')
    c.phone('open')
    c.card('qodebase', 'A git platform for the age of agents, built on Cloudflare.', say='qodebase. A git platform for the age of agents, built on Cloudflare.')

    # 1. The problem (~40 s)
    c.chapter('The problem')
    c.slide('people', ['Git and pull requests were built for people: a few changes a day, each one read by someone.'])
    c.slide('agents', ['Now one person can run fifty AI agents, all writing code at the same time.'])
    c.slide('collision', ['Two changes, each fine on its own, collide when they meet.'], after=2)
    c.slide('ordering', ['Or one change needs another that has not landed yet.'], after=1.5)

    # 2. What we measured (~50 s)
    c.chapter('What we measured')
    c.slide(EVID.format('hono-ordering'), ['Before building anything, we measured. We replayed the last 346 pull requests of Hono, a popular web framework, as if 100 were written at once.',
                                           'Half the pull requests needed another one to land first. Git conflicts: none. The problem is order.'], after=1.5)
    c.slide(EVID.format('bun-swarm'), ["Bun's 64 AI agents worked mostly on one shared branch, with files split between them."], after=1)
    c.slide(EVID.format('realcode-500'), ['On a real codebase with 500 scripted agents, landing by intent got 3.5x as many changes in per hour as review-then-merge.'], after=1.5)
    c.slide(EVID.format('cloudflare-500'), ['On Cloudflare, 500 agents made 7,033 git pushes to Artifacts, 280 milliseconds each. Our one merge queue was the limit, so it gets split by area.'], after=1.5)

    # 3. The idea (~35 s; the queue, claims and stacking are shown in the demo itself)
    c.chapter('The idea')
    c.slide('idea-fork', ['So in qodebase, every agent gets its own copy of the code, a fork, so agents never trip over each other.'])
    c.slide('idea-record', ["Every change carries a record: its intent, the diff, the reviewer agent's verdict and the tests, kept with the code as git notes."], after=1.5)
    c.slide('idea-intent', ['And when two changes collide, the queue re-applies the reviewed intent on the newest code, tests it, and lands it.'], after=1.5)

    # 4. The product on the phone (~2:30 when filmed in full)
    c.chapter('On the phone')
    c.phone('live', max_wait=60)   # eyal/corner-cafe, qb6's scripted run, x8 time-lapse
    c.todo('Talk: tap the mic on the project page, say "add a gift card page", the router opens an agent card.',
           ['And you steer it by talking to it, from your phone.'], secs=12)
    c.slide('different', ['So this is not GitHub with agents on top. The unit is an intent with its record, and landing is automatic: a conflict is replayed, not bounced.'], after=2)

    # 5. Cloudflare (~25 s)
    c.chapter('On Cloudflare')
    c.slide('cloudflare', ['All of it runs on Cloudflare: Workers, Durable Objects for every project and agent, Artifacts for every repo and fork,',
                           'Containers for the agents, and Workers AI for the voice, including this narration.',
                           'And anyone can install their own copy into their own Cloudflare account.'], after=1.5)

    # 6. Close
    c.chapter('')
    c.slide('measured', ['We measured it, then built it.'], after=1)
    c.card('qodebase.app', 'Open source: github.com/eyalev/qodebase', 4.0, say='qodebase dot app. Open source.')

if __name__ == '__main__':
    if sys.argv[1:2] == ['--vo-seconds']:   # used by rec-*.mjs: hold each filmed step as long as its narration
        print(f'{voice(sys.argv[2])[1]:.2f}'); sys.exit(0)
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(VIDEO, 'out', 'qodebase-contest.mp4')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    c = Cut(out); script(c); c.close()
