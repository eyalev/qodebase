// Render every slide of slides.html to build/slides/<id>.png at 1920x1080.
// (The measurement charts are qb5's PNGs in docs/contest/evidence/, used by cut.py directly.)
//   node video/contest/shoot-slides.mjs [id …]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'build/slides');
mkdirSync(OUT, { recursive: true });

const CHROME = join(homedir(), '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome');
const b = await chromium.launch({ executablePath: CHROME });
const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })).newPage();
await p.goto('file://' + join(HERE, 'slides.html'), { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
const ids = process.argv.slice(2).length ? process.argv.slice(2) : await p.$$eval('section', (s) => s.map((x) => x.id));
for (const id of ids) {
  await p.evaluate((i) => { location.hash = i; }, id);
  await p.waitForTimeout(120);
  await p.screenshot({ path: join(OUT, `${id}.png`) });
}
await b.close();
console.log(`${ids.length} slides → ${OUT}`);
