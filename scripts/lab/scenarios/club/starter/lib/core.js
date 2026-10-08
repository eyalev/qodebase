// Core routes that exist before any module: members (sign up, log in, me), courts and the
// availability grid (JSON), the sign-in pages, the stylesheet, and fallback pages.
// registerCore(app) runs BEFORE the modules; registerFallbacks(app) AFTER them, so a module
// can take over '/' or '/availability'.
import { readFileSync } from 'node:fs';
import { COURTS } from './club.js';
import { isDate } from './time.js';
import { esc } from './page.js';

export function registerCore(app) {
  app.post('/api/members', (req, res, { body }) => {
    const r = app.members.create(body);
    r.member ? app.json(res, 201, app.members.public(r.member)) : app.json(res, r.status, { error: r.error });
  });
  app.post('/api/login', (req, res, { body }) => {
    const r = app.members.login(body.email, body.password);
    r ? app.json(res, 200, { token: r.token, member: app.members.public(r.member) }) : app.json(res, 401, { error: 'wrong email or password' });
  });
  app.get('/api/me', (req, res, ctx) => { const m = app.needMember(req, res, ctx); if (m) app.json(res, 200, app.members.public(m)); });
  app.get('/api/courts', (req, res) => app.json(res, 200, COURTS));
  app.get('/api/availability', (req, res, { query }) => {
    if (!isDate(query.date)) return app.json(res, 400, { error: 'date=YYYY-MM-DD' });
    app.json(res, 200, app.slots.day(query.date));
  });
  app.get('/style.css', (req, res) => app.text(res, 200, readFileSync(new URL('../public/style.css', import.meta.url), 'utf8'), 'text/css; charset=utf-8'));

  // sign in / sign up / sign out (English and Portuguese)
  const T = {
    en: { login: 'Sign in', signup: 'Create an account', email: 'Email', password: 'Password', name: 'Name', wrong: 'Wrong email or password.', go: 'Continue' },
    pt: { login: 'Entrar', signup: 'Criar conta', email: 'Email', password: 'Palavra-passe', name: 'Nome', wrong: 'Email ou palavra-passe errados.', go: 'Continuar' },
  };
  const form = (lang, kind, error = '') => { const t = T[lang], pre = lang === 'pt' ? '/pt' : '';
    return `${error ? `<p class="error">${esc(error)}</p>` : ''}<form method="post" action="${pre}/${kind}">
${kind === 'signup' ? `<label>${t.name} <input name="name" required autocomplete="name"></label>` : ''}
<label>${t.email} <input name="email" type="email" required autocomplete="email"></label>
<label>${t.password} <input name="password" type="password" required minlength="8" autocomplete="${kind === 'signup' ? 'new-password' : 'current-password'}"></label>
<button>${t.go}</button></form>
<p><a href="${pre}/${kind === 'login' ? 'signup' : 'login'}">${kind === 'login' ? t.signup : t.login}</a></p>`; };
  for (const lang of ['en', 'pt']) {
    const pre = lang === 'pt' ? '/pt' : '', other = (p) => (lang === 'pt' ? p : '/pt' + p);
    app.get(`${pre}/login`, (req, res, ctx) => app.html(res, 200, app.page({ title: T[lang].login, body: form(lang, 'login'), lang, alt: other('/login'), member: ctx.member, staff: ctx.staff })));
    app.get(`${pre}/signup`, (req, res, ctx) => app.html(res, 200, app.page({ title: T[lang].signup, body: form(lang, 'signup'), lang, alt: other('/signup'), member: ctx.member, staff: ctx.staff })));
    app.post(`${pre}/login`, (req, res, { body }) => {
      const r = app.members.login(body.email, body.password);
      if (!r) return app.html(res, 401, app.page({ title: T[lang].login, body: form(lang, 'login', T[lang].wrong), lang, alt: other('/login') }));
      res.setHeader('set-cookie', `session=${r.token}; Path=/; HttpOnly; SameSite=Lax`);
      app.redirect(res, `${pre}/me`);
    });
    app.post(`${pre}/signup`, (req, res, { body }) => {
      const r = app.members.create(body);
      if (!r.member) return app.html(res, r.status, app.page({ title: T[lang].signup, body: form(lang, 'signup', r.error), lang, alt: other('/signup') }));
      const l = app.members.login(body.email, body.password);
      res.setHeader('set-cookie', `session=${l.token}; Path=/; HttpOnly; SameSite=Lax`);
      app.redirect(res, `${pre}/me`);
    });
  }
  app.post('/logout', (req, res) => { res.setHeader('set-cookie', 'session=; Path=/; Max-Age=0'); app.redirect(res, '/'); });
}

export function registerFallbacks(app) {
  for (const [path, lang, alt] of [['/', 'en', '/pt'], ['/pt', 'pt', '/']]) {
    app.get(path, (req, res, ctx) => app.html(res, 200, app.page({ title: 'Clube de Padel da Vila', lang, alt, member: ctx.member, staff: ctx.staff,
      body: `<p>${lang === 'pt' ? 'Em breve.' : 'Coming soon.'}</p>` })));
  }
}
