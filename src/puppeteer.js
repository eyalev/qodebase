// Re-export so the bundle gets Cloudflare's puppeteer while TypeScript never loads its types (puppeteer.d.ts):
// they redeclare globals that break the Workers types (Disposable on every RPC result, 2026-10-12).
export { default } from '@cloudflare/puppeteer';
