#!/usr/bin/env node
// Screenshot gate for "Agents at work": each view at 390 px (phone emulation) and 1440 px,
// light and dark; fails on sideways scroll. Viewport shots, not full page.
//   node src/landingui/shots.mjs [--url http://localhost:8790/src/landingui/dev.html] [--out DIR] [--only 390-light] [--wait ms]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { chromium } = createRequire(join(ROOT, 'video/package.json'))('playwright');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const URL_ = arg('--url', 'http://localhost:8790/src/landingui/dev.html');
const OUT = arg('--out', '/tmp/landingui-shots');
const ONLY = arg('--only', '');
const WAIT = +arg('--wait', '1500');
const ROUTES = (arg('--routes', '') || 'overview=#/,line=#/line,area=#/area/src%2Fmiddleware,file=#/file/package.json,landed-replayed=#/change/101,with-lead=#/change/110,bounced=#/change/107,stacked=#/change/114,ready=#/change/112,changes=#/changes,feed=#/feed').split(',').map((s) => s.split('='));
mkdirSync(OUT, { recursive: true });
// Use whatever Chromium this machine has when Playwright's own build is missing.
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {}).catch(() => chromium.launch({ executablePath: '/usr/bin/google-chrome' }));
let bad = 0;
for (const [w, mobile] of [[390, true], [1440, false]]) for (const theme of ['light', 'dark']) {
  if (ONLY && ONLY !== `${w}-${theme}`) continue;
  const ctx = await browser.newContext({ viewport: { width: w, height: mobile ? 844 : 900 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, colorScheme: theme });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { bad++; console.log(JSON.stringify({ event: 'pageerror', w, theme, error: String(e) })); });
  for (const [name, hash] of ROUTES) {
    const u = new URL(URL_); if (theme === 'dark') u.searchParams.set('theme', 'dark'); u.hash = hash;
    await page.goto(u.toString()); await page.waitForTimeout(WAIT);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (over > 0) bad++;
    const f = join(OUT, `${name}-${w}-${theme}.png`);
    await page.screenshot({ path: f });
    console.log(JSON.stringify({ shot: f, sideways: over > 0 ? over : 0 }));
  }
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
