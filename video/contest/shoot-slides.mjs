// Render every slide of slides.html to build/slides/<id>.png at 1920x1080.
// The numbers are read here from the run files and handed to the page as window.DATA,
// so a rerun after qb4/qb5 refresh their runs picks up the final numbers.
//   node video/contest/shoot-slides.mjs [id …]
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const OUT = join(HERE, 'build/slides');
mkdirSync(OUT, { recursive: true });
const json = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

function data() {
  const waves = [1, 10, 50, 100].filter((w) => existsSync(join(ROOT, `public/sim/runs/hono-w${w}.json`))).map((w) => {
    const r = json(`public/sim/runs/hono-w${w}.json`).stats.replay;
    return { w, pct: Math.round((100 * (r.prsAffected || 0)) / r.prs), conflicts: r.conflict || 0, prs: r.prs };
  });
  const hono = { waves, prs: waves[0]?.prs, changes: json('public/sim/runs/hono-w1.json').stats.replay.landed };
  const c = json('sim/bun/calibration.json');
  const days = Math.round((new Date(c.totals.last.slice(0, 10)) - new Date(c.totals.first.slice(0, 10))) / 86400e3) + 1; // calendar days, as Bun counts them
  const bun = { commits: c.totals.commits.toLocaleString('en-US'), days, oneBranch: `${Math.round(c.topology.pct_commits_straight_on_one_branch)}%`, gap: `${c.topology.seconds_between_mainline_commits.p50} s` };
  const POL = [
    ['agentReview', 'Agent review', 'reviewer agents, then merge one by one'],
    ['hybrid', 'Claims + trains', 'claim files, redo on conflict, test in trains'],
    ['leads', 'Team leads', 'a lead agent merges conflicting changes'],
    ['intents', 'Land by intent', 'the queue replays the reviewed intent'],
  ];
  const policies = POL.map(([k, label, how]) => ({ label, how, perHour: json(`public/sim/runs/${k}-500.json`).stats.landedPerHour, best: k === 'intents' }));
  return { hono, bun, policies };
}

const CHROME = join(homedir(), '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome');
const DATA = data();
console.log(JSON.stringify(DATA));
const b = await chromium.launch({ executablePath: CHROME });
const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })).newPage();
await p.addInitScript((d) => { window.DATA = d; }, DATA);
await p.goto('file://' + join(HERE, 'slides.html'), { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
const ids = process.argv.slice(2).length ? process.argv.slice(2) : await p.$$eval('section', (s) => s.map((x) => x.id));
for (const id of ids) {
  await p.evaluate((i) => { location.hash = i; }, id);
  await p.waitForTimeout(120);
  await p.screenshot({ path: join(OUT, `${id}.png`) });
}
await b.close();
console.log(`${ids.length} slides → ${OUT}`);
