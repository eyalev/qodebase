// Screenshots of the design variants (docs/design-v2.md) at 390 px light/dark
// and 1440 px, signed in as Eyal and signed out. Output: out/design/<variant>-<shot>.png
//   node design-shots.mjs [a b c]
import { chromium } from 'playwright';
import { createHmac } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
// The forq account's secrets (since the move to its own account, 2026-10-02); older setups keep ~/.config/forq/admin-secret.
const ADMIN = (() => { try { return JSON.parse(readFileSync(homedir() + '/.config/forq-cf/secrets.json', 'utf8')).ADMIN_SECRET; } catch { return readFileSync(homedir() + '/.config/forq/admin-secret', 'utf8').trim(); } })();
const CHROME = homedir() + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const OUT = new URL('./out/design/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const cookie = (email) => { const body = `${email}|${Date.now() + 86400_000}`; return Buffer.from(`${body}|${createHmac('sha256', ADMIN).update(`session:${body}`).digest('hex')}`).toString('base64').replace(/=+$/, ''); };
const variants = process.argv.slice(2).length ? process.argv.slice(2) : ['a', 'b', 'c'];
const b = await chromium.launch({ executablePath: CHROME });
async function ctx(v, { w = 390, h = 844, dark = false, signedIn = true } = {}) {
  const mobile = w < 800;
  const c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, colorScheme: dark ? 'dark' : 'light' });
  if (signedIn) await c.addCookies([{ name: 'forq_session', value: cookie(process.env.QB_EMAIL), domain: `forq-${v}.kapps.dev`, path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
  return c;
}
async function shot(v, name, url, opts = {}, act) {
  const c = await ctx(v, opts); const p = await c.newPage();
  await p.goto(`https://forq-${v}.kapps.dev${url}`, { waitUntil: 'networkidle' }).catch(() => {});
  await p.waitForTimeout(1200);
  if (act) { await act(p); await p.waitForTimeout(900); }
  await p.screenshot({ path: `${OUT}${v}-${name}.png` });
  await c.close(); console.log(`${v}-${name}`);
}
for (const v of variants) {
  await shot(v, 'home', '/');
  await shot(v, 'home-dark', '/', { dark: true });
  await shot(v, 'home-out', '/', { signedIn: false });
  await shot(v, 'fx', '/design-fixture');
  await shot(v, 'fx-dark', '/design-fixture', { dark: true });
  await shot(v, 'fx-wide', '/design-fixture', { w: 1440, h: 900 });
  await shot(v, 'fx-planning', '/design-fixture?state=planning');
  await shot(v, 'fx-empty', '/design-fixture?state=empty');
  const openList = async (p) => { if (v === 'a') await p.tap('#status'); };
  await shot(v, 'fx-list', '/design-fixture', {}, async (p) => { await openList(p); await p.waitForTimeout(400); await p.locator('.chg.s-fix [data-open]').first().tap(); await p.locator('.chg.s-fix').first().scrollIntoViewIfNeeded(); });
  await shot(v, 'fx-try', '/design-fixture', {}, async (p) => { await openList(p); await p.waitForTimeout(400); await p.locator('.chg.s-ready [data-open]').first().tap(); await p.waitForTimeout(300); await p.locator('.chg.s-ready [data-try]').first().tap(); });
  await shot(v, 'real', '/p/eyal/tipsplit');
  await shot(v, 'visitor', '/p/forq/tipsplit', { signedIn: false });
}
await b.close();
