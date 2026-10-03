// The GitHub catalogue on d.projectsbase.dev: home, a category, a project page with its README.
//   node design-shots-catalog.mjs → out/design/c-<name>.png
import { chromium } from 'playwright';
import { createHmac } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
const ADMIN = readFileSync(homedir() + '/.config/forq/admin-secret', 'utf8').trim();
const CHROME = homedir() + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const OUT = new URL('./out/design/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const cookie = (email) => { const body = `${email}|${Date.now() + 86400_000}`; return Buffer.from(`${body}|${createHmac('sha256', ADMIN).update(`session:${body}`).digest('hex')}`).toString('base64').replace(/=+$/, ''); };
const b = await chromium.launch({ executablePath: CHROME });
async function shot(name, url, { w = 390, h = 844, dark = false, signedIn = false, wait = 900 } = {}) {
  const mobile = w < 800;
  const c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, colorScheme: dark ? 'dark' : 'light' });
  if (signedIn) await c.addCookies([{ name: 'forq_session', value: cookie('owner@example.com'), domain: 'd.projectsbase.dev', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
  const p = await c.newPage();
  await p.goto(`https://d.projectsbase.dev${url}`, { waitUntil: 'networkidle' }).catch(() => {});
  await p.waitForTimeout(wait);
  await p.screenshot({ path: `${OUT}c-${name}.png` });
  await c.close(); console.log(name);
}
await shot('home', '/');
await shot('games', '/?cat=games');
await shot('updated', '/?sort=updated');
await shot('page', '/gh/gabrielecirulli/2048', { wait: 2500 });
await shot('page-in', '/gh/sharkdp/cube-composer', { signedIn: true, wait: 2500 });
await shot('page-dark', '/gh/catdad/canvas-confetti', { dark: true, wait: 2500 });
await shot('wide', '/', { w: 1440, h: 900 });
await shot('page-wide', '/gh/hakimel/reveal.js', { w: 1440, h: 900, wait: 2500 });
await b.close();
