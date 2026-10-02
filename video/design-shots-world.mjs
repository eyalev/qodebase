// The world home's Projects tab on d.projectsbase.dev: categories, sorts, dark, desktop.
//   node design-shots-world.mjs → out/design/w-<name>.png
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
const CHROME = homedir() + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const OUT = new URL('./out/design/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: CHROME });
async function shot(name, url, { w = 390, h = 844, dark = false, scroll = 0 } = {}) {
  const mobile = w < 800;
  const c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, colorScheme: dark ? 'dark' : 'light' });
  const p = await c.newPage();
  await p.goto(`https://d.projectsbase.dev${url}`, { waitUntil: 'networkidle' }).catch(() => {});
  if (scroll) await p.evaluate((y) => document.getElementById('view').scrollTo(0, y), scroll);
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${OUT}w-${name}.png` });
  await c.close(); console.log(name);
}
await shot('trending', '/?s=projects');
await shot('trending-2', '/?s=projects', { scroll: 700 });
await shot('games', '/?s=projects&tag=games');
await shot('top', '/?s=projects&sort=top');
await shot('new', '/?s=projects&sort=new');
await shot('worker-dark', '/?s=projects&tag=worker', { dark: true });
await shot('wide', '/?s=projects', { w: 1440, h: 900 });
await b.close();
