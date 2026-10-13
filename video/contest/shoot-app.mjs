// The deck's app screenshots (public/deck/<name>-<theme>.webp), signed out, 390x780 at 2x, light and dark (qb3).
//   node video/contest/shoot-app.mjs <out dir> [name...]   -> <out>/<name>-<theme>.png, then cwebp into public/deck
import { chromium } from 'playwright';
const [OUT, ...only] = process.argv.slice(2);
const B = 'https://qodebase.app';
const tab = (label) => async (p) => { await p.locator(`button:has-text("${label}"):visible`).first().tap(); await p.waitForTimeout(2500); };
const SHOTS = {
  home: { url: '/' },
  r8b: { url: '/p/eyal/real-home-inventory-r8b/work#/change/eyal.real-home-inventory-r8b--isdhz' },
  timeline: { url: '/p/eyal/corner-cafe/work', then: async (p) => { await tab('Timeline')(p); await p.evaluate(() => { const t = [...document.querySelectorAll('h2,h3')].find((e) => /how the run went/i.test(e.textContent)); if (t) t.scrollIntoView({ block: 'start' }); }); } },
  intentsrun: { url: '/runs', then: async (p) => { await p.waitForFunction(() => document.querySelector('a[href^="#/intents/step/"]'), null, { timeout: 25000 }).catch(() => {}); const h = await p.evaluate(() => [...document.querySelectorAll('a[href^="#/intents/step/"]')].map((a) => a.getAttribute('href')).find((x) => /S5b/i.test(decodeURIComponent(x))) || [...document.querySelectorAll('a[href^="#/intents/"]')].map((a) => a.getAttribute('href'))[0]); if (h) { await p.evaluate((h) => { location.hash = h; }, h); await p.waitForTimeout(3500); }
    await p.locator('text=VS Code, copy 3 of 3').first().tap().catch(() => {}); await p.waitForTimeout(2500); } },
  asks: { url: '/p/eyal/cafe-team/asks' },
  realbuild: { url: '/p/eyal/real-course-builder/work' },
  runs: { url: '/runs', then: async (p) => { await p.waitForFunction(() => /\bB1\b/.test(document.body.innerText), null, { timeout: 20000 }).catch(() => {}); await p.evaluate(() => { const h = [...document.querySelectorAll('h2,h3,h4,b,strong,div')].find((e) => e.children.length === 0 && e.textContent.trim() === 'B1'); const c = h && h.closest('article, li, .card, section > div') || h; if (c) { c.scrollIntoView({ block: 'start' }); window.scrollBy(0, -16); } }); await p.waitForTimeout(800); } },
};
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
for (const theme of (process.env.THEMES || 'light,dark').split(',')) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme });
  for (const [name, s] of Object.entries(SHOTS)) {
    if (only.length && !only.includes(name)) continue;
    const p = await ctx.newPage();
    await p.goto(B + s.url, { waitUntil: 'load' }); await p.waitForTimeout(3500);
    if (s.then) await s.then(p);
    await p.screenshot({ path: `${OUT}/${name}-${theme}.png` });
    console.log(name, theme, p.url());
    await p.close();
  }
  await ctx.close();
}
await b.close();
