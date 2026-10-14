// Deck slides as 1920x1080 frames for cut2.py (qb3, 2026-10-14): qodebase.app/deck in ?rec=1&theme=light, the local
// public/deck files served in place of the live ones, each slide held until its entrance animation is done.
//   node video/contest/shoot-deck.mjs [first] [last]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const D = path.resolve(HERE, '../../public/deck') + '/';
const OUT = path.join(HERE, 'build', 'deck'); fs.mkdirSync(OUT, { recursive: true });
const [first = 1, last = 99] = process.argv.slice(2).map(Number);
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: 'light' })).newPage();
const type = (f) => ({ png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml' }[f.split('.').pop()] || 'text/html');
await p.route('**/deck/**', (r) => { const f = new URL(r.request().url()).pathname.replace(/^\/deck\/?/, '') || 'index.html'; r.fulfill({ body: fs.readFileSync(D + f), contentType: type(f) }); });
await p.goto('https://qodebase.app/deck/?rec=1&theme=light#1'); await p.waitForTimeout(1500);
const n = await p.evaluate(() => window.deckSlides().length);
for (let k = first; k <= Math.min(n, last); k++) {
  await p.evaluate((k) => window.deckGo(k), k); await p.waitForTimeout(k === 7 ? 7000 : (k === 10 || k === 11) ? 4800 : 2600);
  await p.screenshot({ path: path.join(OUT, String(k).padStart(2, '0') + '.png') });
}
console.log(JSON.stringify({ slides: n, out: OUT }));
await b.close();
