// Clube de Padel da Vila. `node server.js`: PORT (3000), DATA_DIR (./data), ADMIN_PASSWORD (admin).
// The core is in lib/ (read lib/app.js first); every feature is a file in modules/ that
// exports register(app). Modules are loaded in alphabetical order.
import { readdirSync } from 'node:fs';
import { createApp } from './lib/app.js';
import { registerCore, registerFallbacks } from './lib/core.js';

export async function start({ port = Number(process.env.PORT) || 3000, dataDir = process.env.DATA_DIR || './data',
  adminPassword = process.env.ADMIN_PASSWORD || 'admin' } = {}) {
  const app = createApp({ dataDir, adminPassword });
  registerCore(app);
  for (const f of readdirSync(new URL('./modules/', import.meta.url)).filter((f) => f.endsWith('.js')).sort()) {
    (await import(new URL(`./modules/${f}`, import.meta.url))).register(app);
  }
  registerFallbacks(app);
  let server;
  await new Promise((r) => { server = app.listen(port, r); });
  return { app, server, port: server.address().port };
}

if (import.meta.url === `file://${process.argv[1]}`) start().then(() => console.log(`listening on ${process.env.PORT || 3000}`));
