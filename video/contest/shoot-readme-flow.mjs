// Render readme-flow.html to docs/img/readme-flow.png (the README's diagram).
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const b = await chromium.launch({ executablePath: join(homedir(), '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome') });
const p = await (await b.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1.5 })).newPage();
await p.goto('file://' + join(HERE, 'readme-flow.html'), { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.locator('body').screenshot({ path: join(HERE, '../../docs/img/readme-flow.png') });
await b.close();
