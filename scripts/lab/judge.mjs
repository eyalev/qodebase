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
  const chrome = execFileSync('bash', ['-c', 'ls -d ~/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell | sort -V | tail -1'], { encoding: 'utf8' }).trim();
  const shots = [];
  for (const [i, r] of routes.entries()) {
    const file = join(out, `page-${i}.png`);
    // async: the server answers on this event loop, so the browser must not block it
    await new Promise((resolve) => {
      const c = spawnSyncAsync(chrome, ['--disable-gpu', '--hide-scrollbars', '--window-size=390,1200', '--force-device-scale-factor=1',
        `--user-data-dir=${join(out, 'profile')}`, `--screenshot=${file}`, '--virtual-time-budget=3000', `http://127.0.0.1:${port}/#${r.path}`], resolve);
      void c;
    });
    if (existsSync(file)) shots.push({ path: r.path, file });
  }
  srv.close();
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
