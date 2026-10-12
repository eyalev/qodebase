// "Screenshot" on the App view (docs/board/TASKS.md S3): Cloudflare Browser Rendering opens the project's running
// app at phone size (390 x 844 at 2x), outlines the picked element, and the picture becomes an attachment (S1),
// sent with the next message like any other.
//   POST /api/p/<o>/<n>/screenshot {url?, selector?, width?} -> {id, name, type, size, url} (as attach)
// Only this project's own app or one of its agent forks (the run host); a private project's pass is added here.
// Caps: 30 a day per person, 300 in all. Each shot is a Ledger row (kind 'browser', its seconds).
// Cost: Workers Paid includes 10 browser-hours a month, then $0.09 an hour (checked 2026-10-12): cloudcost gap.

import puppeteer from './puppeteer.js';
import type { Env } from './env';
import { runHost } from './env';
import { mintRunPass } from './run';
import { newAttachId, attachKey, shotTarget } from './attach';
import { registry } from './registry';
import { recordCost } from './costs';
import { log } from './box';

export const SHOT_CAPS = { perPerson: 30, total: 300 };

export async function screenshotRoute(request: Request, env: Env, ctx: ExecutionContext, info: { slug: string; repo: string; private?: boolean }, handle: string): Promise<Response> {
  if (!env.BROWSER || !env.ATTACH) return Response.json({ error: 'screenshots are not set up on this copy' }, { status: 501 });
  const b = await request.json().catch(() => ({})) as { url?: string; selector?: string; width?: number };
  const target = shotTarget(b.url, runHost(info.repo, env.RUN_HOST));
  if (!target) return Response.json({ error: "only this project's own app (or one of its agents' previews)" }, { status: 400 });
  if (info.private) target.searchParams.set('__qb', await mintRunPass(env, info.slug));
  const reg = registry(env);
  const mine = await reg.dayCount(`shot:${handle}`, SHOT_CAPS.perPerson);
  const all = mine.ok ? await reg.dayCount('shot:*', SHOT_CAPS.total) : mine;
  if (!mine.ok || !all.ok) return Response.json({ error: 'Screenshots are used up for today' }, { status: 429 });
  const width = Math.max(320, Math.min(1440, Math.round(Number(b.width) || 390)));
  const selector = typeof b.selector === 'string' ? b.selector.slice(0, 300) : '';
  const t0 = Date.now();
  let png: Uint8Array;
  const browser = await puppeteer.launch(env.BROWSER as any);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height: Math.round(width * 844 / 390), deviceScaleFactor: 2 });
    await page.goto(target.toString(), { waitUntil: 'networkidle0', timeout: 20_000 });
    if (selector) await page.evaluate((sel: string) => {
      const el = (globalThis as any).document.querySelector(sel);
      if (el) { el.style.outline = '3px solid #e8590c'; el.style.outlineOffset = '2px'; el.scrollIntoView({ block: 'center' }); }
    }, selector);
    png = await page.screenshot({ type: 'png' }) as Uint8Array;
  } catch (e) {
    log('shot', 'failed', { slug: info.slug, err: String((e as Error)?.message || e).slice(0, 300), ms: Date.now() - t0 });
    return Response.json({ error: `the app did not load for the screenshot: ${String((e as Error)?.message || e).slice(0, 120)}` }, { status: 502 });
  } finally { await browser.close().catch(() => {}); }
  const sec = (Date.now() - t0) / 1000;
  const id = newAttachId('image/png')!;
  await env.ATTACH.put(attachKey(info.slug, id), png, { httpMetadata: { contentType: 'image/png' }, customMetadata: { name: 'screenshot.png', by: handle, url: target.origin + target.pathname, selector } });
  ctx.waitUntil(recordCost(env, handle, 'browser', info.slug.replace('.', '/'), { usd: Math.round(sec / 3600 * 0.09 * 1e6) / 1e6, covered: true, seconds: sec }));
  log('shot', 'stored', { slug: info.slug, id, size: png.byteLength, sec: Math.round(sec * 10) / 10, selector: !!selector });
  const [o, n] = info.slug.split('.');
  return Response.json({ id, name: 'screenshot.png', type: 'image/png', size: png.byteLength, url: `/api/p/${o}/${n}/attach/${id}` });
}
