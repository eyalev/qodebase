// Recording rig for forq's workflow videos (spec: ../docs/video-guide.md).
//
// A phone-size headless Chromium (390×844, DPR 2, touch) signed in as a forq
// user. Frames come from CDP Page.startScreencast (crisp PNG/JPEG at 2×, only
// when the screen changes) with timestamps; every narration step is an event
// in events.json. compose.py turns frames + events into the final mp4.
//
//   const r = await rig({ name: 'fork-and-agents', email: 'owner@example.com' });
//   await r.chapter('Fork a project', 'One tap gives you your own copy');
//   await r.say('This is forq/tipsplit, a tip calculator anyone can open.');
//   await r.tap('#fork');                     // marker + pause before/after
//   await r.waitFor(() => …, { speed: 8, label: 'agents working' });
//   await r.end();

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = join(homedir(), '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome');
export const SITE = 'https://forq.kapps.dev';
export const ADMIN = readFileSync(join(homedir(), '.config/forq/admin-secret'), 'utf8').trim();

/** forq's session cookie (same format as src/auth.ts sessionCookie). */
function sessionValue(email) {
  const exp = Date.now() + 86400_000;
  const body = `${email}|${exp}`;
  const sig = createHmac('sha256', ADMIN).update(`session:${body}`).digest('hex');
  return Buffer.from(`${body}|${sig}`).toString('base64').replace(/=+$/, '');
}

// Tap markers (44 px circle, accent outline, ~45% fill, white edge; hold
// 300 ms, then shrink and fade 250 ms). Injected into every frame.
const TAP_MARKER = `(() => {
  if (window.__forqTaps) return; window.__forqTaps = true;
  const add = (x, y) => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:' + (x - 22) + 'px;top:' + (y - 22) + 'px;width:44px;height:44px;border-radius:50%;' +
      'border:3px solid #17695a;background:rgba(23,105,90,.42);box-shadow:0 0 0 2px #fff;pointer-events:none;z-index:2147483647;' +
      'transition:transform .25s ease, opacity .25s ease;transform:scale(1);opacity:1';
    (document.body || document.documentElement).appendChild(d);
    setTimeout(() => { d.style.transform = 'scale(.6)'; d.style.opacity = '0'; }, 300);
    setTimeout(() => d.remove(), 600);
  };
  window.addEventListener('pointerdown', (e) => add(e.clientX, e.clientY), true);
})();`;

export async function rig({ name, email = 'owner@example.com', width = 390, height = 844, dark = false }) {
  const dir = join(HERE, 'frames', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  const context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    colorScheme: dark ? 'dark' : 'light', locale: 'en-US',
    userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0 Mobile Safari/537.36 forq-demo',
  });
  const signIn = (e) => context.addCookies([{ name: 'forq_session', value: sessionValue(e), domain: 'forq.kapps.dev', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
  if (email) await signIn(email);   // email: null = start signed out
  await context.addInitScript(TAP_MARKER);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const frames = [];
  const events = [];
  let n = 0;
  cdp.on('Page.screencastFrame', async (f) => {
    const file = `${String(n++).padStart(6, '0')}.jpg`;
    writeFileSync(join(dir, file), Buffer.from(f.data, 'base64'));
    frames.push({ t: f.metadata.timestamp, file });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: width * 2, maxHeight: height * 2, everyNthFrame: 1 });
  const now = () => Date.now() / 1000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const mark = (type, data = {}) => events.push({ t: now(), type, ...data });
  // Keep a still screen "alive" so the composer has a frame for every moment.
  const keepAlive = setInterval(() => page.evaluate(() => { document.documentElement.dataset.tick = String(Date.now()); }).catch(() => {}), 500);

  const r = {
    page, cdp, sleep,
    /** Switch to a signed-in user mid-recording (after showing the sign-in page). */
    async signInAs(e) { await signIn(e); },
    async open(url) {
      await page.goto(url.startsWith('http') ? url : SITE + url, { waitUntil: 'networkidle' }).catch(() => {});
      // A plain-text response (an error page) renders as 13 px monospace, too
      // small to read in the video: wrap it and set it at a readable size.
      const zoomed = await page.evaluate(() => {
        // Either Chrome's text/plain view (one <pre>) or bare text served as
        // HTML (the chat demo's 500 page: no elements at all).
        const b = document.body; if (!b) return;
        const pre = b.children.length === 1 && b.firstElementChild.tagName === 'PRE' ? b.firstElementChild : b.children.length === 0 && b.textContent.trim() ? b : null;
        // Such pages have no viewport tag, so a phone lays them out 980 px wide
        // and shrinks them: give them one, or 17 px renders as ~7 px.
        if (pre && !document.querySelector('meta[name=viewport]')) {
          const m = document.createElement('meta'); m.name = 'viewport'; m.content = 'width=device-width,initial-scale=1';
          document.head.appendChild(m);
        }
        if (pre) pre.style.cssText = 'white-space:pre-wrap;word-break:break-word;font:17px/1.45 monospace;padding:20px 16px;margin:0';
        return !!pre;
      }).catch(() => false);
      // The screencast can miss this repaint (W3's last scene kept the tiny
      // text), so add the enlarged page as a frame of our own.
      if (zoomed) {
        await sleep(150);
        const file = `${String(n++).padStart(6, '0')}.jpg`;
        writeFileSync(join(dir, file), await page.screenshot({ type: 'jpeg', quality: 92 }));
        frames.push({ t: now(), file });
      }
      await sleep(600);
    },
    /** A title card between sections (rendered by compose.py, ~2.5 s). */
    async chapter(title, sub = '') { mark('chapter', { title, sub }); await sleep(200); },
    /** Caption for what follows; holds long enough to read (≥ 1.2 s, 0.33 s/word). */
    async say(text, { hold } = {}) {
      mark('caption', { text });
      const words = text.split(/\s+/).length;
      await sleep(hold ?? Math.min(7000, Math.max(1600, words * 380, text.length * 70)));
    },
    /** Scroll a target into view, tap it with a visible marker, hold on the result. */
    async tap(target, { frame, after = 1700, before = 500 } = {}) {
      const loc = typeof target === 'string' ? (frame ? page.frameLocator(frame).locator(target) : page.locator(target)).first() : target;
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      await sleep(before);
      await loc.tap();
      mark('tap');
      await sleep(after);
    },
    /** Fill a field at once (typing in real time is an amateur tell); caption says so. */
    async fill(target, text, { after = 900 } = {}) {
      const loc = typeof target === 'string' ? page.locator(target).first() : target;
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      await loc.tap().catch(() => {});
      await loc.fill(text);
      await sleep(after);
    },
    async scroll(selector, { block = 'start', offset = -12, after = 900 } = {}) {
      await page.evaluate(([s, b, o]) => { const el = document.querySelector(s); if (el) { el.scrollIntoView({ block: b }); window.scrollBy(0, o); } }, [selector, block, offset]);
      await sleep(after);
    },
    /** Wait for a condition while marking the stretch as sped up (×speed, with a badge). */
    async waitFor(cond, { speed = 8, label = 'working', timeout = 30 * 60_000, poll = 3000 } = {}) {
      mark('speed', { speed, label });
      const t0 = Date.now();
      let ok = false;
      while (Date.now() - t0 < timeout) {
        try { if (await cond()) { ok = true; break; } } catch {}
        await sleep(poll);
      }
      mark('speed', { speed: 1 });
      if (!ok) throw new Error(`waitFor timed out: ${label}`);
      await sleep(800);
    },
    async end(card = { title: 'forq', sub: 'forq.kapps.dev' }) {
      mark('end', card);
      await sleep(300);
      clearInterval(keepAlive);
      await cdp.send('Page.stopScreencast').catch(() => {});
      frames.sort((a, b) => a.t - b.t);
      writeFileSync(join(dir, 'timeline.json'), JSON.stringify({ name, width, height, frames, events }, null, 1));
      await browser.close();
      console.log(`recorded ${frames.length} frames, ${events.length} events → ${dir}`);
    },
  };
  return r;
}

/** forq's admin API as a given user (setup steps that need not be filmed). */
export async function api(path, { method = 'GET', body, asEmail } = {}) {
  const headers = { 'x-forq-secret': ADMIN, 'content-type': 'application/json' };
  if (asEmail) headers['x-forq-as-email'] = asEmail;
  const r = await fetch(`https://forq.<sub>.workers.dev${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return r.json().catch(() => ({}));
}
