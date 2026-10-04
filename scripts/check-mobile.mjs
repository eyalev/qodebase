#!/usr/bin/env node
// The 390 px check (public baseline section 11): phone viewport, touch, the
// pages a stranger opens, as a signed-out visitor.
//   - no page scrolls sideways (scrollWidth <= innerWidth)
//   - the feedback form's Send button is on screen and is what a tap there hits
// Our own traffic: k:self is set before any page script runs, so kstats does
// not count this run.
//   node scripts/check-mobile.mjs [--base https://projectsbase.dev] [--break]
// --break injects a 600 px element on every page; the run must then FAIL
// (proves the check can fail). Exit 1 on any failure; one JSON line per check.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(join(ROOT, 'video/package.json'))('playwright');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'https://projectsbase.dev');
const BREAK = process.argv.includes('--break');
const host = new URL(BASE).hostname;

const PAGES = ['/', '/explore', '/p/forq/todo', '/p/eyal/calculator', '/p/forq/reveal-js/code', '/about', '/privacy', '/personal-agents', '/personal-agents/install/personal-agent', '/feedback?from=/p/forq/todo'];
const PHONE = 390;   // fixed: a too-wide page widens the mobile layout viewport, so innerWidth grows with it
const VARIANTS = ['a', 'b', 'c', 'd'].map((v) => `https://${v}.${host}/`);

const chrome = [join(homedir(), '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome')].find(existsSync);
const browser = await chromium.launch(chrome ? { executablePath: chrome } : {});
const ctx = await browser.newContext({ viewport: { width: PHONE, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 forq-check/1' });
await ctx.addInitScript(() => { try { localStorage.setItem('k:self', '1'); } catch {} });
if (BREAK) await ctx.addInitScript(() => addEventListener('DOMContentLoaded', () => { const d = document.createElement('div'); d.style.cssText = 'width:600px;height:4px'; document.body.append(d); }));

let failed = 0;
const report = (o) => { if (!o.ok) failed++; console.log(JSON.stringify({ ts: new Date().toISOString(), module: 'check-mobile', ...o })); };

for (const url of [...PAGES.map((p) => BASE + p), ...VARIANTS]) {
  const page = await ctx.newPage();
  try {
    const res = await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForTimeout(400);
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    report({ check: 'no_side_scroll', url, status: res?.status(), ok: res?.ok() && m.sw <= PHONE && m.iw <= PHONE, ...m });
    // A page that clips sideways overflow (overflow-x: hidden) never scrolls, so
    // also look for content that sticks out past the right edge and is not
    // inside a horizontal scroller of its own (code views, tab strips).
    const wide = await page.evaluate((PHONE) => {
      const scrolls = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
      const out = [];
      for (const el of document.body.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width && r.height && r.right > PHONE + 1 && getComputedStyle(el).visibility !== 'hidden' && !scrolls(el)) out.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} ${Math.round(r.right)}px`);
        if (out.length >= 3) break;
      }
      return out;
    }, PHONE);
    report({ check: 'nothing_past_edge', url, ok: wide.length === 0, wide });
    if (url.includes('/feedback')) {
      const send = page.getByRole('button', { name: 'Send' });
      await send.scrollIntoViewIfNeeded();
      const hit = await send.evaluate((b) => {
        const r = b.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        return { inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= 390, isTarget: document.elementFromPoint(x, y)?.closest('button') === b, h: Math.round(r.height) };
      });
      report({ check: 'feedback_send_reachable', url, ok: hit.inView && hit.isTarget && hit.h >= 44, ...hit });
    }
  } catch (err) {
    report({ check: 'load', url, ok: false, err: String(err).slice(0, 200) });
  } finally { await page.close(); }
}
await browser.close();
console.log(JSON.stringify({ module: 'check-mobile', done: true, failed, break: BREAK }));
process.exit(failed ? 1 : 0);
