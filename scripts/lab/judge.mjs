// Variants lab: the second-opinion judge (docs/lab/PLAN.md "Quality"). A different model
// than the builders (Sonnet; builders are Haiku/Opus) reads what tests cannot see, with the
// scenario's rubric from the private lab-hidden repo. One `claude -p` call per run, on the
// laptop, on Eyal's subscription; its cost is reported as judgeUsd (API-equivalent).
// Called by score.mjs --judge; returns fields merged into the quality block.
import { spawnSync, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HIDDEN = process.env.LAB_HIDDEN_DIR || join(homedir(), '<lab-hidden dir>');
const MODEL = process.env.LAB_JUDGE_MODEL || 'sonnet';
const RUBRIC = '1';
const MAX_DIFF = 60_000;
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const diff = (a, b) => spawnSync('git', ['diff', '--no-index', '--no-color', '--', a, b], { encoding: 'utf8', maxBuffer: 64 << 20 }).stdout || '';
const clip = (s, n) => (s.length > n ? s.slice(0, n) + `\n… (${s.length - n} more characters cut)` : s);

// phone-size screenshots of every route, served over http (module scripts do not load from file://)
async function screenshots(dir, routes, out) {
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
  const srv = createServer((req, res) => {
    const p = join(dir, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
    if (!p.startsWith(dir) || !existsSync(p)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }).end(readFileSync(p));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const shots = await shoot(routes.map((r) => ({ path: r.path, url: `http://127.0.0.1:${port}/#${r.path}` })), out);
  srv.close();
  return shots;
}
async function shoot(list, out) {
  const chrome = execFileSync('bash', ['-c', 'ls -d ~/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell | sort -V | tail -1'], { encoding: 'utf8' }).trim();
  const shots = [];
  for (const [i, r] of list.entries()) {
    const file = join(out, `page-${i}.png`);
    // async: the server answers on this event loop, so the browser must not block it
    await new Promise((resolve) => {
      const c = spawnSyncAsync(chrome, ['--disable-gpu', '--hide-scrollbars', '--window-size=390,1200', '--force-device-scale-factor=1',
        `--user-data-dir=${join(out, 'profile')}`, `--screenshot=${file}`, '--virtual-time-budget=3000', r.url], resolve);
      void c;
    });
    if (existsSync(file)) shots.push({ path: r.path, file });
  }
  return shots;
}
function spawnSyncAsync(cmd, a, done) {
  import('node:child_process').then(({ spawn }) => { const p = spawn(cmd, a, { stdio: 'ignore' }); p.on('exit', done); p.on('error', done); });
}

export async function judge({ scenario, dir }) {
  const rubric = readFileSync(join(HIDDEN, scenario, 'rubric.md'), 'utf8');
  const starter = join(HERE, 'scenarios', scenario, 'starter');
  const work = join(dir, '__hidden__', 'judge'); mkdirSync(work, { recursive: true });
  let material = '', images = [];
  if (scenario === 'cafe-family') {
    const d = diff(starter, dir).replaceAll(starter, 'a').replaceAll(dir, 'b');
    const { routes } = await import(pathToFileURL(join(dir, 'src/routes.js')).href);
    const { site } = await import(pathToFileURL(join(dir, 'src/site.js')).href);
    const pages = routes.map((r) => `### ${r.path} (${r.title})\n${String(r.page(site)).trim()}`).join('\n\n');
    images = await screenshots(dir, routes, work);
    material = `## The change (diff against the starting site)\n${clip(d, MAX_DIFF)}\n\n## Every page, rendered\n${clip(pages, 30_000)}\n\n## Screenshots at 390 px\n` +
      images.map((s) => `- ${s.path}: ${s.file}`).join('\n');
  } else if (scenario === 'bakery' || scenario === 'club') {
    // run it: fresh data, one order so the pages have something to show
    const { spawn } = await import('node:child_process');
    const net = await import('node:net');
    const port = await new Promise((r) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
    const base = `http://127.0.0.1:${port}`, pw = 'judge-pw', auth = 'Basic ' + Buffer.from('admin:' + pw).toString('base64');
    const data = join(work, 'data'); mkdirSync(data, { recursive: true });
    const proc = spawn('node', ['server.js'], { cwd: dir, env: { ...process.env, PORT: String(port), DATA_DIR: data, ADMIN_PASSWORD: pw }, stdio: 'ignore' });
    let up = false;
    for (let i = 0; i < 100 && !up; i++) { try { await fetch(base + '/'); up = true; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    let pages = '', orderId = null;
    if (up && scenario === 'club') {
      // a member with some balance and a booking, so the pages have something to show
      try {
        const j = (m, p, b, h = {}) => fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...h }, body: b && JSON.stringify(b) }).then((r) => r.json()).catch(() => ({}));
        const mem = await j('POST', '/api/members', { name: 'Inês Costa', email: 'ines@judge.test', password: 'judge-pass-1' });
        const { token } = await j('POST', '/api/login', { email: 'ines@judge.test', password: 'judge-pass-1' });
        await j('POST', `/api/admin/members/${mem.id}/credit`, { amount: 60 }, { authorization: auth });
        const d = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
        await j('POST', '/api/bookings', { court: 'c2', date: d, time: '10:00' }, { authorization: 'Bearer ' + token });
      } catch {}
      const paths = ['/', '/availability', '/tournaments', '/shop', '/coaches', '/pt'];
      for (const p of [...paths, '/admin', '/admin/rota', '/admin/shop', '/admin/reports']) {
        const r = await fetch(base + p, { headers: p.startsWith('/admin') ? { authorization: auth } : {} });
        pages += `### ${p} (${r.status})\n${(await r.text()).trim()}\n\n`;
      }
      images = await shoot(paths.map((p) => ({ path: p, url: base + p })), work);
    } else if (up) {
      try {
        const menu = await (await fetch(base + '/api/menu')).json();
        const hours = await (await fetch(base + '/api/hours')).json();
        const open = hours.find((h) => !h.closed);
        const d = new Date(Date.now() + 86400_000 * (1 + ((DAYS.indexOf(open.day) - ((new Date().getDay() + 6) % 7) + 6) % 7)));
        const o = await (await fetch(base + '/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Inês Costa', phone: '+351 913 456 789', pickupAt: `${d.toISOString().slice(0, 10)}T${open.open.slice(0, 2) === '23' ? open.open : String(+open.open.slice(0, 2) + 1).padStart(2, '0') + open.open.slice(2)}`,
            items: menu.filter((i) => i.available).slice(0, 2).map((i) => ({ id: i.id, qty: 2 })) }) })).json();
        orderId = o?.id ?? null;
      } catch {}
      const paths = ['/', '/menu', '/order', ...(orderId != null ? [`/orders/${orderId}`] : [])];
      for (const p of [...paths, '/admin', '/admin/menu', '/admin/hours']) {
        const r = await fetch(base + p, { headers: p.startsWith('/admin') ? { authorization: auth } : {} });
        pages += `### ${p} (${r.status})\n${(await r.text()).trim()}\n\n`;
      }
      images = await shoot(paths.map((p) => ({ path: p, url: base + p })), work);
    }
    proc.kill();
    const tree = spawnSync('bash', ['-c', "find . -type f -not -path './node_modules/*' -not -path './.git/*' -not -path './__hidden__/*' | sort | xargs wc -l | tail -40"], { cwd: dir, encoding: 'utf8' }).stdout;
    material = `## The product brief (README.md)\n${clip(readFileSync(join(dir, 'README.md'), 'utf8'), 8000)}\n\n## Files (lines)\n${tree}\n` +
      (up ? `## Every page, rendered (admin pages with the password)\n${clip(pages, 40_000)}\n## Screenshots at 390 px\n` + images.map((s) => `- ${s.path}: ${s.file}`).join('\n')
        : '## The server did not start (node server.js), so there are no pages to show.');
  } else if (scenario === 'port-ts') {
    const SAMPLE = ['index', 'lib/util/merge', 'lib/util/toString', 'lib/isEmail', 'lib/isURL', 'lib/isFQDN', 'lib/isIP', 'lib/isIn', 'lib/contains', 'lib/isAlpha', 'lib/toBoolean'];
    material = '## Sample of the port (original .js -> ported .ts)\n' + SAMPLE.map((m) => {
      const a = join(starter, 'src', m + '.js'), b = join(dir, 'src', m + '.ts');
      if (!existsSync(b)) return `### ${m}: NOT PORTED (no src/${m}.ts)`;
      return `### ${m}\n` + clip(diff(a, b).replaceAll(starter, 'a').replaceAll(dir, 'b'), 8000);
    }).join('\n\n');
  } else throw new Error(`no judge for ${scenario}`);

  const prompt = `${rubric}\n\n${images.length ? 'Read each screenshot file listed below before judging.\n\n' : ''}${material}\n`;
  writeFileSync(join(work, 'prompt.md'), prompt);
  const r = spawnSync('claude', ['-p', '--model', MODEL, '--output-format', 'json', '--allowedTools', 'Read', '--max-turns', String(images.length + 4)],
    { input: prompt, cwd: work, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 << 20, env: { ...process.env, CLAUDE_NO_HOOKS: '1' } });
  let out; try { out = JSON.parse(r.stdout); } catch { return { judgeScore: null, judgeModel: MODEL, judgeNotes: 'judge failed: ' + (r.stderr || r.stdout || '').slice(0, 200) }; }
  const m = String(out.result || '').match(/\{[\s\S]*\}/);
  let v = null; try { v = m && JSON.parse(m[0]); } catch {}
  const model = Object.keys(out.modelUsage || {}).sort((a, b) => (out.modelUsage[b].outputTokens || 0) - (out.modelUsage[a].outputTokens || 0))[0] || MODEL;
  if (!v || typeof v.score !== 'number') return { judgeScore: null, judgeModel: model, judgeUsd: out.total_cost_usd ?? null, judgeNotes: 'judge gave no score: ' + String(out.result).slice(0, 200) };
  return { judgeScore: Math.max(0, Math.min(10, v.score)), judgeModel: model, judgeRubric: RUBRIC, judgeCriteria: v.criteria || null,
    judgeNotes: v.notes || '', judgeUsd: out.total_cost_usd ?? null, judgeShots: images.length };
}
