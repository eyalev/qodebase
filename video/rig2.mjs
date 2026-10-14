#!/usr/bin/env node
// Recording rig for the contest video (qb3, 2026-10-14). Eyal is not in the video: his spoken requests are TTS clips
// played as the microphone into a real Chrome at 390 px, so Talk really hears them, and the page is recorded with a
// CDP screencast the whole time. The rig stays up and is driven step by step over a local HTTP port, so a take can
// wait on whatever the build does.
//
//   node video/rig2.mjs --out ~/.local/share/qodebase-video/take-2 [--port 7931] [--start /] [--headed]
//   curl -s localhost:7931/say?clip=/path/2a.wav    play a clip into the mic (the next getUserMedia, or the open one)
//   curl -s localhost:7931/tap?sel=<css>            trusted tap   /tapxy?x=&y= (CSS px)   /ftap?frame=iframe&sel=<css> (in a frame)        /type?sel=<css>&text=..   /press?key=Enter
//   curl -s localhost:7931/goto?path=/p/eyal/x      /eval  (POST body = JS, result as JSON)        /shot?name=x
//   curl -s localhost:7931/mark?label=2b            a cue in events.jsonl for the cut           /stop
// Output: <out>/audio.webm (the user's clips + Talk's replies, from the first audio use: event audio-start),
// <out>/frames/<ms>.jpg (2x CDP screenshots, timestamps in ms since start), <out>/events.jsonl (says, taps, marks, nav,
// talk console rows, page errors), <out>/shots/*.png. Session: the forq_session cookie copied from the debug Chrome.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const BASE = opt('--base', 'https://qodebase.app');
const HOST = new URL(BASE).host;
const OUT = opt('--out', path.join(os.homedir(), '.local/share/qodebase-video', 'take-' + Date.now()));
const PORT = +opt('--port', '7931');
fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const T0 = Date.now();
const evf = fs.createWriteStream(path.join(OUT, 'events.jsonl'), { flags: 'a' });
const log = (ev, o = {}) => { const r = { t: Date.now() - T0, ev, ...o }; evf.write(JSON.stringify(r) + '\n'); return r; };

async function session() {
  const tabs = await (await fetch('http://127.0.0.1:9222/json')).json();
  const ws = tabs.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
  if (!ws) throw new Error('no debug Chrome page on :9222');
  const cookies = await new Promise((res, rej) => {
    const s = new WebSocket(ws);
    s.onopen = () => s.send(JSON.stringify({ id: 1, method: 'Network.getAllCookies' }));
    s.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) { s.close(); res(d.result.cookies); } };
    s.onerror = rej;
  });
  const mine = cookies.filter((c) => c.domain.replace(/^\./, '') === HOST);
  if (!mine.some((c) => c.name === 'forq_session')) throw new Error(`no forq_session cookie for ${HOST} in the debug Chrome`);
  return mine.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, sameSite: 'Lax', expires: c.expires > 0 ? c.expires : -1 }));
}

// The microphone: every getUserMedia gets a clone of one WebAudio destination's track; /say plays a clip into it.
// Silence between clips is real silence, so Talk's end-of-speech detection behaves as with a person who stopped.
const MIC = () => {
  let ctx = null, dest = null, out = null;
  const ensure = () => {
    if (!ctx) {
      ctx = new AudioContext({ sampleRate: 48000 }); dest = ctx.createMediaStreamDestination(); out = ctx.createMediaStreamDestination();
      // qb2: a real mic is never digitally silent; near-empty Opus frames make the recogniser miss the next words.
      const nb = ctx.createBuffer(1, 48000 * 2, 48000), ch = nb.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0; for (let i = 0; i < ch.length; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; ch[i] = b0 + b1 + b2 + w * 0.1848; }   // qb2's pink noise; x0.004 = about -48 dBFS
      const ns = ctx.createBufferSource(), g = ctx.createGain(); ns.buffer = nb; ns.loop = true; g.gain.value = window.__rigNoise ?? 0.004; ns.connect(g).connect(dest); ns.start();
      // Everything the viewer should hear (the user's clips and Talk's replies) is recorded into one track.
      const rec = new MediaRecorder(out.stream, { mimeType: 'audio/webm;codecs=opus' });
      rec.ondataavailable = async (e) => { if (e.data.size) { const b = new Uint8Array(await e.data.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); window.__rigAudio(btoa(s)); } };
      rec.start(1000); window.__rigAudioStart && window.__rigAudioStart();
    }
    if (ctx.state !== 'running') ctx.resume();
    return dest;
  };
  window.__rigEnsure = ensure;
  const play0 = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    try { ensure(); if (!this.__rig) { this.__rig = 1; const n = ctx.createMediaElementSource(this); n.connect(out); n.connect(ctx.destination); } } catch (e) {}
    window.__rigPlay && window.__rigPlay(String(this.src || '').slice(0, 80));
    return play0.apply(this, arguments);
  };
  const md = navigator.mediaDevices;
  md.getUserMedia = async (c) => {
    if (!c || !c.audio) throw new DOMException('rig: audio only', 'NotSupportedError');
    const d = ensure(); await ctx.resume(); window.__rigMicOpens = (window.__rigMicOpens || 0) + 1;
    const ms = new MediaStream(d.stream.getAudioTracks().map((t) => t.clone())); (window.__rigStreams = window.__rigStreams || []).push(ms); return ms;
  };
  md.enumerateDevices = async () => [{ kind: 'audioinput', deviceId: 'rig', groupId: 'rig', label: 'rig mic', toJSON() { return this; } }];
  window.__rigSay = async (b64) => {
    const d = ensure();
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const buf = await ctx.decodeAudioData(bytes.buffer);
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(d); src.start();   // the cut mixes the clip from its file; out carries Talk's replies
    return new Promise((ok) => { src.onended = () => ok(buf.duration); });
  };
};

// --pulse: the tab's REAL audio output (Talk's spoken replies as played), via a private PulseAudio null sink that Chrome
// plays into and parec records for the whole take, across page loads (the per-page recorder lost audio on navigation).
import { spawn, execFileSync } from 'node:child_process';
let pulse = null;
if (argv.includes('--pulse')) {
  const sink = `qbrig${PORT}`;
  const mod = execFileSync('pactl', ['load-module', 'module-null-sink', `sink_name=${sink}`, `sink_properties=device.description=${sink}`]).toString().trim();
  const rec = spawn('parec', ['-d', `${sink}.monitor`, '--file-format=wav', '--rate=48000', '--channels=1', path.join(OUT, 'tab-audio.wav')], { stdio: 'ignore' });
  pulse = { sink, mod, rec };
  log('tab-audio-start', { file: 'tab-audio.wav', sink });
}
const cookies = await session();
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: !argv.includes('--headed'), args: ['--autoplay-policy=no-user-gesture-required'], ignoreDefaultArgs: pulse ? ['--mute-audio'] : [], env: pulse ? { ...process.env, PULSE_SINK: pulse.sink } : process.env });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['microphone'], colorScheme: opt('--theme', 'light') });
await ctx.addCookies(cookies);
// One file per page load: each load starts a new MediaRecorder with its own header (appending them to one file left
// everything after the first load unreadable, 2026-10-14). audio-start events carry the file name.
let audioF = null, audioN = 0;
await ctx.exposeBinding('__rigAudio', (_s, b64) => { if (audioF) audioF.write(Buffer.from(b64, 'base64')); });
await ctx.exposeBinding('__rigAudioStart', () => { if (audioF) audioF.end(); const f = `audio-${audioN++}.webm`; audioF = fs.createWriteStream(path.join(OUT, f)); log('audio-start', { file: f }); });
await ctx.exposeBinding('__rigPlay', (_s, src) => { log('page-audio', { src }); });
await ctx.addInitScript(`window.__rigNoise = ${+opt('--noise', '0.004')};`);
await ctx.addInitScript(MIC);
const page = await ctx.newPage();
page.on('console', (m) => { const t = m.text(); if (t.includes('"module":"talk"')) { try { log('talk', { row: JSON.parse(t) }); } catch {} } });
page.on('pageerror', (e) => log('pageerror', { msg: String(e.message || e).slice(0, 300) }));
page.on('framenavigated', (f) => { if (f === page.mainFrame()) log('nav', { url: f.url() }); });

const cdp = await ctx.newCDPSession(page);
let frames = 0, running = true;
const FPS = +opt('--fps', '12');
(async () => {   // 2x frames (the screencast only gives 1x), as fast as Chrome answers up to FPS
  while (running) {
    const t = Date.now();
    // Playwright's screenshot, not CDP captureScreenshot with clip.scale: that one left the page laid out 780 CSS px wide
    // (innerWidth 780, every frame the left half of a desktop layout) in the first take of 2026-10-14.
    try { const buf = await page.screenshot({ type: 'jpeg', quality: 85 }); fs.writeFile(path.join(OUT, 'frames', String(t - T0).padStart(9, '0') + '.jpg'), buf, () => {}); frames++; } catch {}
    const w = 1000 / FPS - (Date.now() - t); if (w > 0) await new Promise((ok) => setTimeout(ok, w));
  }
})();
await page.goto(BASE + opt('--start', '/'), { waitUntil: 'load' });
log('start', { url: page.url(), out: OUT });

const q = (u) => Object.fromEntries(new URL(u, 'http://x').searchParams);
const body = (req) => new Promise((ok) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => ok(s)); });
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), a = q(req.url);
  const send = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  try {
    switch (u.pathname) {
      case '/say': {
        // qb2: play only once the recorder is on ('live' and not 'arming'), then 400 ms more; with wait=1, first wait for
        // the previous turn to end (live goes off) so a clip never lands in a listening window that is closing.
        if (a.wait) await page.waitForFunction(() => !document.getElementById('talk-root')?.classList.contains('live'), null, { timeout: 60000 }).catch(() => log('wait-off-timeout'));
        if (a.gate) { await page.waitForFunction(() => { const r = document.getElementById('talk-root'); return r && r.classList.contains('live') && !r.classList.contains('arming'); }, null, { timeout: +(a.gate) || 15000 }).catch(() => log('gate-timeout')); await new Promise((ok) => setTimeout(ok, +(a.delay || 1000))); }
        const b64 = fs.readFileSync(a.clip).toString('base64');
        const r = log('say', { clip: a.clip });
        const dur = await page.evaluate((x) => window.__rigSay(x), b64);
        return send({ ...r, dur, end: Date.now() - T0 });
      }
      case '/tap': await page.locator(a.sel).first().tap({ timeout: +(a.timeout || 8000) }); return send(log('tap', { sel: a.sel }));
      case '/tapxy': await page.touchscreen.tap(+a.x, +a.y); return send(log('tap', { x: +a.x, y: +a.y }));
      case '/ftap': await page.frameLocator(a.frame || 'iframe').locator(a.sel).first().tap({ timeout: +(a.timeout || 8000) }); return send(log('tap', { frame: a.frame || 'iframe', sel: a.sel }));
      case '/fselect': await page.frameLocator(a.frame || 'iframe').locator(a.sel).first().selectOption(a.value); return send(log('select', { frame: a.frame || 'iframe', sel: a.sel, value: a.value }));
      case '/hold': {   // a touch long-press (qb2: 0.55 s on a mic turns conversation mode on)
        const bb = await page.locator(a.sel).first().boundingBox(); if (!bb) return send({ err: 'not visible' }, 404);
        const x = bb.x + bb.width / 2, y = bb.y + bb.height / 2, c = await page.context().newCDPSession(page);
        await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await new Promise((ok) => setTimeout(ok, +(a.ms || 800)));
        await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        return send(log('hold', { sel: a.sel, ms: +(a.ms || 800) }));
      }
      case '/type': await page.locator(a.sel).first().fill(a.text); return send(log('type', { sel: a.sel, text: a.text }));
      case '/press': await page.keyboard.press(a.key); return send(log('press', { key: a.key }));
      case '/goto': await page.goto(BASE + a.path, { waitUntil: 'load' }); return send(log('goto', { path: a.path }));
      case '/eval': { const js = await body(req); const v = await page.evaluate(js); return send({ v }); }
      case '/text': { const v = await page.locator(a.sel || 'body').first().innerText({ timeout: 5000 }); return send({ v }); }
      case '/shot': { const f = path.join(OUT, 'shots', (a.name || String(Date.now() - T0)) + '.png'); await page.screenshot({ path: f }); return send({ f }); }
      case '/mark': return send(log('mark', { label: a.label }));
      case '/status': return send({ t: Date.now() - T0, frames, url: page.url(), micOpens: await page.evaluate(() => window.__rigMicOpens || 0) });
      case '/stop': send(log('stop', { frames })); running = false; await page.evaluate(() => new Promise((ok) => setTimeout(ok, 1500))).catch(() => {}); await b.close(); if (audioF) audioF.end(); if (pulse) { pulse.rec.kill('SIGINT'); try { execFileSync('pactl', ['unload-module', pulse.mod]); } catch {} } evf.end(); setTimeout(() => process.exit(0), 500); return;
      default: send({ err: 'unknown ' + u.pathname }, 404);
    }
  } catch (e) { send({ err: String(e.message || e).slice(0, 400) }, 500); }
}).listen(PORT, '127.0.0.1', () => console.log(JSON.stringify({ rig: `http://127.0.0.1:${PORT}`, out: OUT })));
