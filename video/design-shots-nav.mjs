// A vs B navigation (forq-a / forq-b): home tabs, Inbox, project views, code, account.
//   node design-shots-nav.mjs → out/design/n<a|b>-<name>.png
import { chromium } from 'playwright';
import { createHmac } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
const ADMIN = readFileSync(homedir() + '/.config/forq/admin-secret', 'utf8').trim();
const CHROME = homedir() + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const OUT = new URL('./out/design/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const cookie = (email) => { const body = `${email}|${Date.now() + 86400_000}`; return Buffer.from(`${body}|${createHmac('sha256', ADMIN).update(`session:${body}`).digest('hex')}`).toString('base64').replace(/=+$/, ''); };
const b = await chromium.launch({ executablePath: CHROME });
async function shot(v, name, url, { w = 390, h = 844, signedIn = true, dark = false } = {}) {
  const mobile = w < 800;
  const c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, colorScheme: dark ? 'dark' : 'light' });
  if (signedIn) await c.addCookies([{ name: 'forq_session', value: cookie('owner@example.com'), domain: `forq-${v}.kapps.dev`, path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
  const p = await c.newPage();
  await p.goto(`https://forq-${v}.kapps.dev${url}`, { waitUntil: 'networkidle' }).catch(() => {});
  await p.waitForTimeout(1000);
  await p.screenshot({ path: `${OUT}n${v}-${name}.png` });
  await c.close(); console.log(v, name);
}
for (const v of (process.argv[2] ? process.argv.slice(2) : ['a', 'b'])) {
  await shot(v, 'world', '/');
  await shot(v, 'world-projects', '/?s=projects');
  await shot(v, 'world-people', '/?s=people');
  await shot(v, 'world-out', '/', { signedIn: false });
  await shot(v, 'world-dark', '/', { dark: true });
  await shot(v, 'world-wide', '/?s=projects', { w: 1440, h: 900 });
  await shot(v, 'projects', '/mine');
  await shot(v, 'inbox', '/inbox');
  await shot(v, 'explore', '/explore');
  await shot(v, 'readme', '/p/eyal/tipsplit');
  await shot(v, 'changes', '/design-fixture/changes');
  await shot(v, 'app', '/design-fixture/app?try=r1');
  await shot(v, 'code', '/p/eyal/tipsplit/code/');
  await shot(v, 'account', '/settings');
  await shot(v, 'visitor', '/p/forq/tipsplit', { signedIn: false });
  await shot(v, 'wide', '/design-fixture/changes', { w: 1440, h: 900 });
}
await b.close();
