// Screenshots of design v3 "views" (forq-c.kapps.dev): every view, 390 light/dark, 1440.
//   node design-shots-views.mjs   → out/design/v-<name>.png
import { chromium } from 'playwright';
import { createHmac } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
// The forq account's secrets (since the move to its own account, 2026-10-02); older setups keep ~/.config/forq/admin-secret.
const ADMIN = (() => { try { return JSON.parse(readFileSync(homedir() + '/.config/forq-cf/secrets.json', 'utf8')).ADMIN_SECRET; } catch { return readFileSync(homedir() + '/.config/forq/admin-secret', 'utf8').trim(); } })();
const CHROME = homedir() + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const OUT = new URL('./out/design/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const cookie = (email) => { const body = `${email}|${Date.now() + 86400_000}`; return Buffer.from(`${body}|${createHmac('sha256', ADMIN).update(`session:${body}`).digest('hex')}`).toString('base64').replace(/=+$/, ''); };
const b = await chromium.launch({ executablePath: CHROME });
async function shot(name, url, { w = 390, h = 844, dark = false, signedIn = true, act } = {}) {
  const mobile = w < 800;
  const c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, colorScheme: dark ? 'dark' : 'light' });
  if (signedIn) await c.addCookies([{ name: 'forq_session', value: cookie('owner@example.com'), domain: 'forq-c.kapps.dev', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
  const p = await c.newPage();
  await p.goto(`https://forq-c.kapps.dev${url}`, { waitUntil: 'networkidle' }).catch(() => {});
  await p.waitForTimeout(1200);
  if (act) { await act(p); await p.waitForTimeout(800); }
  await p.screenshot({ path: `${OUT}v-${name}.png` });
  await c.close(); console.log(name);
}
await shot('readme', '/design-fixture');
await shot('readme-real', '/p/eyal/tipsplit');
await shot('readme-import', '/p/eyal/particles-js');
await shot('readme-doc', '/p/eyal/particles-js/readme?doc=LICENSE.md');
await shot('readme-visitor', '/p/forq/tipsplit', { signedIn: false });
await shot('more-open', '/design-fixture', { act: async (p) => { await p.locator('[data-more]').tap(); } });
await shot('more-toggled', '/design-fixture', { act: async (p) => { await p.locator('[data-more]').tap(); await p.waitForTimeout(500); await p.locator('[data-more]').tap(); } });
await shot('readme-wide', '/p/eyal/particles-js', { w: 1440, h: 900 });
await shot('more-wide', '/design-fixture', { w: 1440, h: 900, act: async (p) => { await p.locator('[data-more]').click(); } });
await shot('changes', '/design-fixture/changes');
await shot('changes-dark', '/design-fixture/changes', { dark: true });
await shot('changes-open', '/design-fixture/changes', { act: async (p) => { await p.locator('.chg.s-fix [data-open]').first().tap(); } });
await shot('changes-planning', '/design-fixture/changes?state=planning');
await shot('changes-empty', '/design-fixture/changes?state=empty');
await shot('typing', '/design-fixture/changes', { act: async (p) => { await p.locator('.ask textarea').tap(); await p.keyboard.type('Add a history of past bills'); } });
await shot('app', '/design-fixture/app');
await shot('app-try', '/design-fixture/app?try=r1');
await shot('history', '/design-fixture/history');
await shot('more', '/design-fixture/more');
await shot('agents', '/design-fixture/agents');
await shot('about', '/design-fixture/about');
await shot('code', '/p/eyal/tipsplit/code/');
await shot('real', '/p/eyal/tipsplit');
await shot('real-history', '/p/eyal/tipsplit/history');
await shot('visitor', '/p/forq/tipsplit', { signedIn: false });
await shot('wide-changes', '/design-fixture/changes', { w: 1440, h: 900 });
await shot('wide-app', '/design-fixture/app?try=r1', { w: 1440, h: 900 });
await b.close();
