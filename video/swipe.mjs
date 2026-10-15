// A finger swipe on a phone page, filmed smoothly (qb3, 2026-10-15, Eyal: show mobile-agent's terminal scrolling like a page).
// Frames come from CDP Page.startScreencast (every painted frame, up to 60/s), not from screenshots, and the scroll is a real
// touch gesture (Input.synthesizeScrollGesture, gestureSourceType touch). The finger's path is logged so the cut can draw it.
//   node video/swipe.mjs --out DIR --path '/p/eyal/tracker/work?agent=bp2og&tab=terminal' --x 195 --y 520 --dist 900 --speed 260
// Writes DIR/frames/<ms>.jpg (780 px wide, like rig2) and DIR/events.jsonl (load, swipe_start/swipe_end with the path).
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const HOST = 'qodebase.app';
const OUT = opt('--out', path.join(os.homedir(), '.local/share/qodebase-video', 'swipe-' + Date.now()));
fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });
const T0 = Date.now();
const evf = fs.createWriteStream(path.join(OUT, 'events.jsonl'), { flags: 'a' });
const log = (ev, o = {}) => { const r = { t: Date.now() - T0, ev, ...o }; evf.write(JSON.stringify(r) + '\n'); console.log(JSON.stringify(r)); return r; };

async function session() {
  const tabs = await (await fetch('http://127.0.0.1:9222/json')).json();
  const ws = tabs.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
  const cookies = await new Promise((res, rej) => {
    const s = new WebSocket(ws);
    s.onopen = () => s.send(JSON.stringify({ id: 1, method: 'Network.getAllCookies' }));
    s.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) { s.close(); res(d.result.cookies); } };
    s.onerror = rej;
  });
  return cookies.filter((c) => c.domain.replace(/^\./, '') === HOST)
    .map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, sameSite: 'Lax', expires: c.expires > 0 ? c.expires : -1 }));
}

const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light' });
await ctx.addCookies(await session());
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
let shots = 0;
cdp.on('Page.screencastFrame', async (f) => {
  const t = Math.round(f.metadata.timestamp * 1000) - T0;
  fs.writeFileSync(path.join(OUT, 'frames', String(Math.max(0, t)).padStart(9, '0') + '.jpg'), Buffer.from(f.data, 'base64'));
  shots++; cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 780, maxHeight: 1688, everyNthFrame: 1 });
// a page that is not repainting sends no frames: a 1 px heartbeat keeps the screencast ticking so holds have frames too
await page.addInitScript(() => { addEventListener('DOMContentLoaded', () => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:.01;pointer-events:none;z-index:2147483647'; document.body.appendChild(d); let k = 0; setInterval(() => { d.style.background = (k++ % 2) ? '#000' : '#fff'; }, 33); }); });
await page.goto('https://' + HOST + opt('--path', '/'), { waitUntil: 'domcontentloaded' });
log('load', { url: page.url() });
await page.waitForTimeout(+opt('--settle', '9000'));
const x = +opt('--x', '195'), y = +opt('--y', '520'), dist = +opt('--dist', '900'), speed = +opt('--speed', '260');
log('swipe_start', { x, y, dist, speed, reps: +opt('--reps', '1'), gap: +opt('--gap', '350'), dpr: 2 });
const reps = +opt('--reps', '1'), gap = +opt('--gap', '350');
if (opt('--mode', 'drag') === 'gesture') await cdp.send('Input.synthesizeScrollGesture', { x, y, yDistance: dist, speed, gestureSourceType: 'touch', preventFling: false, repeatCount: reps, repeatDelayMs: gap });
else if (opt('--mode', 'drag') === 'pipe') {   // trusted CDP touches on a 16 ms clock, not awaited one by one (a round trip was ~50 ms: 20 Hz scrolling)
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
  for (let r = 0; r < reps; r++) {
    const ms = dist / speed * 1000, n = Math.max(2, Math.round(ms / 16)), pend = [];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); log('touch', { x, y, k: 'down' });
    const t0 = Date.now();
    for (let i = 1; i <= n; i++) {
      const p = i / n, e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2, yy = y + dist * e;
      const wait = t0 + i * 16 - Date.now(); if (wait > 0) await sleep(wait);
      pend.push(cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: yy, id: 1 }] })); log('touch', { x, y: Math.round(yy), k: 'move' });
    }
    await Promise.all(pend);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); log('touch', { x, y: y + dist, k: 'up' });
    await sleep(gap);
  }
}
else if (opt('--mode', 'drag') === 'raf') {   // one touch move per animation frame, from inside the terminal's frame (60 Hz, no CDP round trips)
  for (let r = 0; r < reps; r++) {
    const fr = page.frames().find((f) => /\/a\/[^/]+\/agent\//.test(f.url())) || page.mainFrame();
    const el = await page.mainFrame().evaluateHandle(() => document.querySelector('iframe[src*="/agent/"]'));
    const box = el ? await el.asElement()?.boundingBox() : null; const ox = box ? box.x : 0, oy = box ? box.y : 0;
    log('touch', { x, y, k: 'down' });
    const pts = await fr.evaluate(async ({ x, y, dist, ms }) => {
      const t0 = performance.now(), out = [];
      const target = document.elementFromPoint(x, y) || document.body;
      const mk = (type, yy) => { const t = new Touch({ identifier: 1, target, clientX: x, clientY: yy, pageX: x, pageY: yy }); return new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t], targetTouches: type === 'touchend' ? [] : [t], changedTouches: [t] }); };
      target.dispatchEvent(mk('touchstart', y));
      await new Promise((done) => { const step = () => { const p = Math.min(1, (performance.now() - t0) / ms), e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2, yy = y + dist * e; target.dispatchEvent(mk('touchmove', yy)); out.push([Math.round(performance.now() - t0), Math.round(yy)]); if (p < 1) requestAnimationFrame(step); else done(); }; requestAnimationFrame(step); });
      target.dispatchEvent(mk('touchend', y + dist));
      return out;
    }, { x: x - ox, y: y - oy, dist, ms: dist / speed * 1000 });
    const base = Date.now() - T0 - pts.at(-1)[0];
    for (const [dt, yy] of pts) evf.write(JSON.stringify({ t: base + dt, ev: 'touch', x, y: yy + oy, k: 'move' }) + '\n');
    log('touch', { x, y: y + dist, k: 'up' });
    await page.waitForTimeout(gap);
  }
}
else {   // raw touch events: down, a move every 16 ms (ease in-out), up; each point logged for the finger overlay
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
  for (let r = 0; r < reps; r++) {
    const ms = dist / speed * 1000, n = Math.max(2, Math.round(ms / 16));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); log('touch', { x, y, k: 'down' });
    for (let i = 1; i <= n; i++) {
      const p = i / n, e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2, yy = y + dist * e;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: yy, id: 1 }] }); log('touch', { x, y: Math.round(yy), k: 'move' });
      await sleep(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); log('touch', { x, y: y + dist, k: 'up' });
    await sleep(gap);
  }
}
log('swipe_end', { x, y, dist, speed });
await page.waitForTimeout(+opt('--after', '2500'));
await cdp.send('Page.stopScreencast');
log('stop', { frames: shots });
await b.close();
