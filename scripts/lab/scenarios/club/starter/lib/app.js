// The app core every module builds on. A module is a file in modules/ that exports
// `register(app)`; server.js loads them all (alphabetical). What a module gets:
//   app.get/post/put/patch/delete(path, handler)   path params like '/api/bookings/:id'
//     handler(req, res, ctx) with ctx = { params, query, body, member, staff, lang }
//   app.json(res, status, data)  app.html(res, status, html)  app.redirect(res, to)
//   app.text(res, status, text, contentType)
//   app.needMember(req, res, ctx) -> member or null (and answered 401 / redirect to /login)
//   app.needStaff(req, res, ctx)  -> true or false (and answered 401 with a basic-auth challenge)
//   app.store (lib/store.js), app.wallet (lib/wallet.js), app.slots (lib/slots.js)
//   app.notify(memberId, text)   app.nav(link)   app.page(opts) (lib/page.js, nav filled in)
// Routes registered first win; the core's own pages ('/', 404) come after the modules.
import { createServer } from 'node:http';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { createStore } from './store.js';
import { createWallet } from './wallet.js';
import { createSlots } from './slots.js';
import { page } from './page.js';

export function createApp({ dataDir, adminPassword }) {
  const routes = [];
  const store = createStore(dataDir);
  const navLinks = [];
  const app = {
    store, wallet: createWallet(store), slots: createSlots(),
    nav: (link) => navLinks.push({ who: 'all', ...link }),
    page: (o) => page({ nav: navLinks, ...o }),
    notify(memberId, text) {
      store.list('notifications').push({ at: new Date().toISOString(), member: memberId, text });
      store.save('notifications');
    },
    json(res, status, data) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(data === undefined ? '' : JSON.stringify(data)); },
    html(res, status, html) { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); },
    text(res, status, text, type = 'text/plain; charset=utf-8') { res.writeHead(status, { 'content-type': type }); res.end(text); },
    redirect(res, to) { res.writeHead(303, { location: to }); res.end(); },
    needMember(req, res, ctx) {
      if (ctx.member) return ctx.member;
      if (req.url.startsWith('/api/')) app.json(res, 401, { error: 'sign in first' }); else app.redirect(res, ctx.lang === 'pt' ? '/pt/login' : '/login');
      return null;
    },
    needStaff(req, res, ctx) {
      if (ctx.staff) return true;
      res.writeHead(401, { 'www-authenticate': 'Basic realm="staff"', 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'staff only' }));
      return false;
    },
  };
  for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
    app[m] = (path, handler) => {
      const keys = [];
      const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
      routes.push({ method: m.toUpperCase(), re, keys, handler });
    };
  }

  // ---- members, passwords, sessions ----
  const hash = (password, salt = randomBytes(16).toString('hex')) => `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
  const check = (password, stored) => { const [salt, h] = stored.split(':'); const a = Buffer.from(h, 'hex'), b = scryptSync(password, salt, 32); return a.length === b.length && timingSafeEqual(a, b); };
  app.members = {
    all: () => store.list('members'),
    get: (id) => store.list('members').find((m) => m.id === id),
    public: (m) => ({ id: m.id, name: m.name, email: m.email, balance: m.balance }),
    create({ name, email, password }) {
      if (!name || !email || typeof password !== 'string' || password.length < 8) return { status: 400, error: 'name, email and a password of 8 or more' };
      email = String(email).trim().toLowerCase();
      if (store.list('members').some((m) => m.email === email)) return { status: 409, error: 'email already registered' };
      const m = { id: store.id('m'), name: String(name).trim(), email, password: hash(password), balance: 0, createdAt: new Date().toISOString() };
      store.list('members').push(m); store.save('members');
      return { status: 201, member: m };
    },
    login(email, password) {
      const m = store.list('members').find((x) => x.email === String(email || '').trim().toLowerCase());
      if (!m || !check(String(password || ''), m.password)) return null;
      const token = randomBytes(24).toString('hex');
      store.list('sessions').push({ token, member: m.id, at: new Date().toISOString() }); store.save('sessions');
      return { token, member: m };
    },
    byToken(token) { const s = token && store.list('sessions').find((x) => x.token === token); return s ? app.members.get(s.member) : null; },
  };
  const staffHeader = 'Basic ' + Buffer.from(`admin:${adminPassword}`).toString('base64');

  async function readBody(req) {
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > 256 * 1024) throw Object.assign(new Error('too big'), { status: 413 }); chunks.push(c); }
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) return {};
    if ((req.headers['content-type'] || '').includes('application/json')) { try { return JSON.parse(raw); } catch { throw Object.assign(new Error('bad JSON'), { status: 400 }); } }
    return Object.fromEntries(new URLSearchParams(raw));
  }
  const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]));

  app.handle = async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const lang = url.pathname === '/pt' || url.pathname.startsWith('/pt/') ? 'pt' : 'en';
      const bearer = (req.headers.authorization || '').match(/^Bearer (.+)$/)?.[1];
      const ctx = { query: Object.fromEntries(url.searchParams), lang, staff: req.headers.authorization === staffHeader,
        member: app.members.byToken(bearer || cookies(req).session) };
      if (bearer && !ctx.member && url.pathname.startsWith('/api/')) return app.json(res, 401, { error: 'bad token' });
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.re); if (!m) continue;
        ctx.params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        ctx.body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
        return await r.handler(req, res, ctx);
      }
      if (url.pathname.startsWith('/api/')) return app.json(res, 404, { error: 'not found' });
      app.html(res, 404, app.page({ title: lang === 'pt' ? 'Não encontrado' : 'Not found', body: '', lang, member: ctx.member, staff: ctx.staff }));
    } catch (e) {
      if (!res.headersSent) app.json(res, e.status || 500, { error: e.status ? e.message : 'server error' });
      if (!e.status) console.error(e);
    }
  };
  app.listen = (port, cb) => { const server = createServer(app.handle); server.listen(port, cb); return server; };
  return app;
}
