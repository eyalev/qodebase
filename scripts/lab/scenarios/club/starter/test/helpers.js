// Start the whole app in this process on a free port with an empty data directory.
//   const t = await testServer();  ... t.call('POST', '/api/bookings', body, token) ...  await t.stop();
// t.member(credit) signs up a new member, logs in and (optionally) tops up the balance.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start } from '../server.js';

export const ADMIN_PASSWORD = 'test-admin';
export const STAFF = 'Basic ' + Buffer.from(`admin:${ADMIN_PASSWORD}`).toString('base64');

export async function testServer() {
  const dataDir = mkdtempSync(join(tmpdir(), 'club-test-'));
  const { server, port } = await start({ port: 0, dataDir, adminPassword: ADMIN_PASSWORD });
  const base = `http://127.0.0.1:${port}`;
  let n = 0;
  const t = {
    base,
    async call(method, path, body, auth) {
      const headers = { 'content-type': 'application/json' };
      if (auth === 'staff') headers.authorization = STAFF; else if (auth) headers.authorization = `Bearer ${auth}`;
      const r = await fetch(base + path, { method, headers, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body) });
      const raw = await r.text(); let data = null; try { data = JSON.parse(raw); } catch {}
      return { status: r.status, data, raw, headers: r.headers };
    },
    async member(credit = 0) {
      const email = `p${++n}@test.club`, password = 'password-1';
      const s = await t.call('POST', '/api/members', { name: `Player ${n}`, email, password });
      const { token } = (await t.call('POST', '/api/login', { email, password })).data;
      if (credit) await t.call('POST', `/api/admin/members/${s.data.id}/credit`, { amount: credit }, 'staff');
      return { ...s.data, email, password, token };
    },
    stop: () => new Promise((r) => server.close(() => { rmSync(dataDir, { recursive: true, force: true }); r(); })),
  };
  return t;
}
