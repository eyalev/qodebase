#!/usr/bin/env python3
"""Assemble the contest video from slides, phone recordings and cards.

  node video/contest/shoot-slides.mjs      # slides -> video/contest/build/slides/*.png
  node video/contest/rec-sim.mjs           # phone scenes -> video/frames/contest-*
  python3 video/contest/cut.py [out.mp4]   # -> video/out/qodebase-contest.mp4 + .srt

The scene list (SCRIPT below) follows docs/contest/storyboard.md; change both together.
Look and pacing: docs/video-guide.md. Slides are full frame with the caption in the
bottom 200 px (slides.html leaves it empty); phone scenes put the phone on the left and
the caption on the right; `demo` scenes are placeholders for footage not filmed yet
(qb6 demo mode + qb7 UI), shown as an empty phone with the planned captions, timed as
they will run, so the draft's length is honest.
"""
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEO = os.path.dirname(HERE)
W, H, FPS = 1920, 1080, 30
# DESIGN.md dark tokens
BG, CARD, LINE = (12, 13, 14), (20, 21, 23), (34, 36, 40)
FG, DIM, ACC, BUSY = (236, 236, 238), (154, 159, 166), (79, 191, 159), (224, 169, 72)
GEIST = os.path.join(VIDEO, 'fonts', 'Geist.ttf')

def font(size, weight=400):
    f = ImageFont.truetype(GEIST, size)
    f.set_variation_by_axes([weight])
    return f

F_TITLE, F_SUB, F_CAP, F_CHAP, F_BADGE, F_SMALL = font(84, 600), font(36), font(40, 500), font(26, 600), font(26, 600), font(24)

def wrap(d, text, f, width):
    lines, cur = [], ''
    for w in text.split():
        t = (cur + ' ' + w).strip()
        if d.textlength(t, font=f) <= width: cur = t
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def hold(text):
    """Seconds a caption stays: max(1.6 s, 0.36 s/word, 15 chars/s), at most 7 s, plus a beat."""
    return min(7.0, max(1.6, len(text.split()) * 0.36, len(text) / 15)) + 0.4

class Cut:
    def __init__(self, out):
        self.out, self.n, self.cues = out, 0, []
        self.ff = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                                    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
                                    '-r', str(FPS), '-movflags', '+faststart', out], stdin=subprocess.PIPE)
        self.chapters = []

    def emit(self, im, n=1):
        b = im.tobytes()
        for _ in range(n): self.ff.stdin.write(b)
        self.n += n

    def now(self): return self.n / FPS

    def cue(self, text, secs):
        self.cues.append((self.now(), self.now() + secs, text))

    # ---- scene kinds ----
    def card(self, title, sub='', secs=3.0):
        im = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(im)
        d.text((160, 400), title, font=F_TITLE, fill=FG)
        for i, line in enumerate(wrap(d, sub, F_SUB, 1500)):
            d.text((160, 520 + i * 50), line, font=F_SUB, fill=DIM)
        self.cue(f'{title}. {sub}'.strip(' .') + '.', secs)
        self.emit(im, round(secs * FPS))

    def chapter(self, title):
        """A chapter starts: 0.5 s of quiet page, and its name rides above the captions."""
        self.chapters.append((self.now(), title))
        self.emit(Image.new('RGB', (W, H), BG), FPS // 2)
        self.chap = title

    def slide(self, sid, captions, after=1.5):
        """after: extra seconds on the last caption (hold on the result; charts get more)."""
        # sid = a slides.html id, or a path to a full-frame 1920x1080 PNG (qb5's docs/contest/evidence/*).
        path = os.path.join(VIDEO, '..', sid) if sid.endswith('.png') else os.path.join(HERE, 'build', 'slides', f'{sid}.png')
        base = Image.open(path).convert('RGB').resize((W, H))
        for k, text in enumerate(captions):
            im = base.copy(); d = ImageDraw.Draw(im)
            d.line((160, 905, W - 160, 905), fill=LINE, width=2)
            for i, line in enumerate(wrap(d, text, F_CAP, W - 320)[:2]):
                d.text((160, 935 + i * 54), line, font=F_CAP, fill=FG)
            secs = hold(text) + (after if k == len(captions) - 1 else 0)
            self.cue(text, secs)
            self.emit(im, round(secs * FPS))

    def _phone_canvas(self, shot, caption, badge=None):
        ph_h = H - 80; ph_w = round(ph_h * 390 / 844); px, py = 150, 40
        canvas = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(canvas)
        d.rounded_rectangle((px - 3, py - 3, px + ph_w + 2, py + ph_h + 2), radius=39, outline=(70, 76, 84), width=2)
        if shot is not None:
            mask = Image.new('L', (ph_w, ph_h), 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, ph_w - 1, ph_h - 1), radius=36, fill=255)
            canvas.paste(shot.resize((ph_w, ph_h), Image.LANCZOS), (px, py), mask)
        tx = px + ph_w + 110; tw = W - tx - 140
        if getattr(self, 'chap', None): d.text((tx, 230), self.chap, font=F_CHAP, fill=ACC)
        for i, line in enumerate(wrap(d, caption or '', F_CAP, tw)[:4]):
            d.text((tx, 300 + i * 56), line, font=F_CAP, fill=FG)
        if badge:
            bw = d.textlength(badge, font=F_BADGE) + 36
            d.rounded_rectangle((tx, H - 190, tx + bw, H - 140), radius=8, fill=(40, 44, 49))
            d.text((tx + 18, H - 182), badge, font=F_BADGE, fill=FG)
        return canvas, (px, py, ph_w, ph_h)

    def phone(self, scene, max_wait=8.0):
        """A rig recording (video/frames/contest-<scene>), captions from its say() events."""
        src = os.path.join(VIDEO, 'frames', f'contest-{scene}')
        tl = json.load(open(os.path.join(src, 'timeline.json')))
        frames, ev = tl['frames'], sorted(tl['events'], key=lambda e: e['t'])
        # Start at the first caption (skip page load), end at the last event + the last caption's hold.
        caps = [e for e in ev if e['type'] == 'caption']
        t = caps[0]['t'] - 0.3 if caps else frames[0]['t']
        t1 = max(ev[-1]['t'], caps[-1]['t'] + hold(caps[-1]['text'])) if caps else frames[-1]['t']
        for i, e in enumerate(ev):
            if e['type'] == 'speed' and float(e['speed']) > 1:
                stop = next((x['t'] for x in ev[i + 1:] if x['type'] == 'speed'), t1)
                e['speed'] = max(float(e['speed']), (stop - e['t']) / max_wait)
        fi, ei, caption, speed, label, since, cache = 0, 0, '', 1.0, '', None, {}
        open_cue = None
        while t <= t1:
            while ei < len(ev) and ev[ei]['t'] <= t:
                e = ev[ei]; ei += 1
                if e['type'] == 'caption':
                    if open_cue: self.cues.append((open_cue[0], self.now(), open_cue[1]))
                    caption, open_cue = e['text'], (self.now(), e['text'])
                elif e['type'] == 'speed':
                    speed, label = float(e['speed']), e.get('label', ''); since = e['t'] if speed > 1 else None
            while fi + 1 < len(frames) and frames[fi + 1]['t'] <= t: fi += 1
            f = frames[fi]['file']
            if f not in cache: cache.clear(); cache[f] = Image.open(os.path.join(src, f)).convert('RGB')
            badge = f'x{round(speed)}, {label}, real time {int((t - since) // 60)}:{int((t - since) % 60):02d}' if since else None
            self.emit(self._phone_canvas(cache[f], caption, badge)[0])
            t += speed / FPS
        if open_cue: self.cues.append((open_cue[0], self.now(), open_cue[1]))

    def demo(self, what, captions, secs=None):
        """Placeholder for demo-mode footage: an empty phone saying what goes there.
        secs: the scene's planned length (real footage has taps, holds and time-lapses),
        spread over its captions in proportion to their reading time."""
        reading = sum(hold(t) for t in captions)
        for text in captions:
            im, (px, py, pw, ph) = self._phone_canvas(None, text)
            d = ImageDraw.Draw(im)
            d.rounded_rectangle((px + 20, py + 20, px + pw - 20, py + ph - 20), radius=24, fill=CARD)
            d.text((px + 50, py + 70), 'Demo footage, to film', font=F_CHAP, fill=BUSY)
            for i, line in enumerate(wrap(d, what, F_SMALL, pw - 100)):
                d.text((px + 50, py + 120 + i * 34), line, font=F_SMALL, fill=DIM)
            n = hold(text) * (max(secs, reading) / reading if secs else 1)
            self.cue(text, n)
            self.emit(im, round(n * FPS))

    def close(self):
        self.ff.stdin.close(); self.ff.wait()
        ts = lambda x: f'{int(x // 3600):02d}:{int(x % 3600 // 60):02d}:{int(x % 60):02d},{int(x * 1000 % 1000):03d}'
        with open(os.path.splitext(self.out)[0] + '.srt', 'w') as f:
            for i, (a, b, text) in enumerate(self.cues, 1):
                f.write(f'{i}\n{ts(a)} --> {ts(b)}\n{text}\n\n')
        print(f'{self.out}: {self.now():.0f} s ({int(self.now() // 60)}:{int(self.now() % 60):02d}), {len(self.cues)} captions')
        for t, title in self.chapters: print(f'  {int(t // 60)}:{int(t % 60):02d}  {title}')

# ---- the script (docs/contest/storyboard.md) ----
def script(c):
    c.chapter('')
    c.phone('open')
    c.card('qodebase', 'A git platform for the age of agents. Built on Cloudflare.')

    c.chapter('The problem')
    c.slide('people', ['Git and pull requests were built for people: a few changes a day, each one read by someone.'])
    c.slide('agents', ['AI agents write code now. One person can run fifty of them.'])
    c.slide('collision', after=3, captions=['Two changes, each fine on its own, collide when they meet.'])
    c.slide('ordering', after=2.5, captions=['Or one change needs another that has not landed yet.'])
    c.slide('question', ['So we asked what actually goes wrong when many agents work on one codebase,', 'and measured it before building anything.'])

    c.chapter('What we measured')
    c.slide('hono', after=3.5, captions=["We took the last 500 real changes of Hono, a popular web framework, and replayed them as if 100 had been written at once.",
                     'Git conflicts: none. But half the pull requests needed another one to land first.',
                     'The problem is order, not conflicts.'])
    c.slide('bun', after=3, captions=["Bun's port to Rust was written by 64 AI agents: 6,755 commits in 11 days.",
                    'They gave up on branches. 81% of commits went to one shared branch, with agents splitting files by hand.'])
    c.phone('realgit')
    c.slide('policies', after=3.5, captions=['We tried four ways of landing those changes.',
                         'Landing by intent got 3.5 times as many changes in per hour as review-then-merge.'])
    c.phone('cloud')
    c.slide('cloud', after=3, captions=['7,033 pushes from 500 forks at once, 280 ms each. Git on Cloudflare held up.',
                      'Our single merge queue was the ceiling, so it gets split by area.'])

    c.chapter('The idea')
    c.slide('idea-fork', after=2, captions=['Every agent gets its own copy of the code, a fork. Agents never share a working folder, so they never trip over each other.'])
    c.slide('idea-record', after=3, captions=['Every change carries a record: what it was meant to do, the diff, the review and the tests.',
                            'A reviewer agent reads every change. The record stays with the code as git notes, so the why is never lost.'])
    c.slide('idea-queue', after=2.5, captions=['Approved changes wait in one line, the merge queue, and are tested together in trains before they reach the main code.'])
    c.slide('idea-intent', after=3, captions=["When two changes collide, the queue doesn't send the work back.",
                            'It re-applies the reviewed intent on the latest code, tests it, and lands it.'])
    c.slide('idea-claims', after=2.5, captions=["Agents see who is working where before they start, and a change can build on one that hasn't landed yet."])

    c.chapter('On the phone')
    # Planned lengths (secs) add up to ~2:30: real footage has taps, 1.5-2 s holds and time-lapses.
    c.demo('Project page, tap Agents at work: the overview with plain-words numbers, the queue as a train, the codebase map.',
           ['This is a real project on qodebase. Twenty agents are working on it right now.'], secs=14)
    c.demo('Start demo mode (agents 20, speed). Time-lapse with the x8 badge. "Scripted agents" label visible.',
           ["They're scripted for this video: real commits on real forks, through the real queue, no AI bills."], secs=16)
    c.demo('Tap an area of the map: its files and who claims what.', ["Tap any part of the code to see who's working there."], secs=14)
    c.demo('Tap a file, then a change: its record (intent, diff, review verdict, tests).',
           ['Every change explains itself: what it was for, what it changed, what the reviewer said.'], secs=16)
    c.demo('Feed row: "Agent 7 collided with Agent 3 on routes.ts; replayed; tests passed; landed". Tap it.',
           ['Here two agents collided on the same file.', 'The queue replayed the reviewed change on the latest code. Tests passed. It landed with no one involved.'], secs=22)
    c.demo('A bounced train: failed test, back to its agent.', ['When tests fail, the train bounces and the change goes back. Main never breaks.'], secs=14)
    c.demo('Code browser on main: a landed commit with its record as a git note (intent, review, tests).',
           ['Months later, anyone (or any agent) can still read why each line is there.'], secs=12)
    c.demo('Router: type a request on the phone; agent cards appear.', ['And you steer it all by talking to it, from your phone.'], secs=14)
    c.demo('Overview at the end of the run: landed count, median ask-to-land time.', ['120 changes landed in 10 minutes.'], secs=10)

    c.chapter('On Cloudflare')
    c.slide('cloudflare', after=2.5, captions=['All of it runs on Cloudflare: Workers serve it, Durable Objects keep every project and agent,',
                           'Artifacts holds every repo and fork, Containers run the agents, Workers AI does the voice.',
                           'And anyone can install their own copy into their own Cloudflare account in a few minutes.'])

    c.chapter('')
    c.slide('measured', ['We measured it, then built it.'])
    c.card('qodebase.app', 'Open source: github.com/eyalev/qodebase (Apache-2.0)', 4.0)

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(VIDEO, 'out', 'qodebase-contest.mp4')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    c = Cut(out); script(c); c.close()
