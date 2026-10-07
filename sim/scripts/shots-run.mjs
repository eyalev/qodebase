// Screenshot gate for the run viewer: codebase, folder, file and change views at 390 px
// and 1440 px, light and dark.   node sim/scripts/shots-run.mjs [base-url] [run]
import { chromium } from '../../video/node_modules/playwright/index.mjs';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
const BASE = process.argv[2] || 'http://127.0.0.1:7873/';
const RUN = process.argv[3] || 'leads-50';
const OUT = new URL('../out/run/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: homedir() + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome' });
const errors = [];
for (const [name, w, h, dark] of [['390-light', 390, 844, false], ['390-dark', 390, 844, true], ['1440-light', 1440, 900, false], ['1440-dark', 1440, 900, true]]) {
  const mobile = w < 800;
  const c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, colorScheme: dark ? 'dark' : 'light' });
  const p = await c.newPage();
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await p.goto(`${BASE}run.html?run=${RUN}`);
  await p.waitForSelector('.folder');
  await p.screenshot({ path: `${OUT}/${name}-1-top.png` });
  await p.evaluate(() => document.querySelector('#view').scrollIntoView());
  await p.screenshot({ path: `${OUT}/${name}-2-codebase.png` });
  await p.click('.folder:nth-child(2)'); await p.waitForTimeout(200);
  await p.evaluate(() => document.querySelector('#view').scrollIntoView());
  await p.screenshot({ path: `${OUT}/${name}-3-folder.png` });
  await p.click('.list a'); await p.waitForTimeout(200);
  await p.screenshot({ path: `${OUT}/${name}-4-file.png` });
  const landed = await p.evaluate(() => [...document.querySelectorAll('.list a')].find((a) => a.querySelector('.tag.ok'))?.getAttribute('href'));
  if (landed) await p.goto(`${BASE}run.html?run=${RUN}${landed}`); else await p.click('.list a');
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('#view').scrollIntoView());
  await p.screenshot({ path: `${OUT}/${name}-5-change.png` });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (overflow > 0) errors.push(`${name}: horizontal overflow ${overflow}px`);
  await c.close();
}
await b.close();
console.log(JSON.stringify({ out: OUT, errors }));
