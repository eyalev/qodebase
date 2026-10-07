// Screenshot gate for the sim page: 390 px (phone emulation) and 1440 px, light and dark.
//   node sim/scripts/shots.mjs [url] [outdir]   (needs the page served, e.g. devserve start 7873 -- python3 -m http.server 7873)
import { chromium } from '../../video/node_modules/playwright/index.mjs';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
const URL_ = process.argv[2] || 'http://127.0.0.1:7873/';
const OUT = process.argv[3] || new URL('../out/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: homedir() + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome' });
const errors = [];
for (const [name, w, h, dark] of [['390-light', 390, 844, false], ['390-dark', 390, 844, true], ['1440-light', 1440, 900, false], ['1440-dark', 1440, 900, true]]) {
  const mobile = w < 800;
  const c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, colorScheme: dark ? 'dark' : 'light' });
  const p = await c.newPage();
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  await p.goto(URL_);
  await p.evaluate(() => localStorage.setItem('qbsim.preset', 'k1'));
  await p.reload();
  await p.click('#speed button:nth-child(4)');
  await p.click('#play');
  await p.waitForTimeout(4000);
  await p.click('#follow');
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/${name}-top.png` });
  await p.evaluate(() => document.querySelector('#map').scrollIntoView({ block: 'start' }));
  await p.screenshot({ path: `${OUT}/${name}-map.png` });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (overflow > 0) errors.push(`${name}: horizontal overflow ${overflow}px`);
  await c.close();
}
await b.close();
console.log(JSON.stringify({ out: OUT, errors }));
