// Phone scenes of the product itself: the project's "Agents at work" view.
// Until qb6's live demo (eyal/corner-cafe) is filmable, this films qb7's sample-data loop
// (?mock=1, labelled "Sample data" on screen); WORK_URL switches to the live project.
//   node video/contest/rec-work.mjs [open|demo …]
import { rig, api } from '../rig.mjs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Each caption is narrated in the cut (cut.py, Aura-2): hold the shot at least as long as its
// narration, so the next step never starts under the previous sentence.
const CUT = join(dirname(fileURLToPath(import.meta.url)), 'cut.py');
const voSeconds = (text) => { try { return Number(execFileSync('python3', [CUT, '--vo-seconds', text], { encoding: 'utf8' })); } catch { return 0; } };
function narrated(r) {
  const say = r.say;
  r.say = (text, opts = {}) => say(text, { ...opts, hold: Math.max(opts.hold || 0, Math.min(7000, Math.max(1600, text.split(/\s+/).length * 380, text.length * 70)), voSeconds(text) * 1000 + 700) });
  return r;
}

const WORK = process.env.WORK_URL || '/p/eyal/todo/work?mock=1&mockspeed=4';
const go = async (r, hash, after = 1200) => { await r.page.evaluate((h) => { location.hash = h; }, hash); await r.sleep(after); };
const top = (r) => r.page.evaluate(() => scrollTo({ top: 0 }));
// The UI and its sample loop change while we film: a missing element is a logged skip, not a crash.
async function may(label, fn) {
  try { await fn(); } catch (e) { console.log(JSON.stringify({ event: 'shot_skipped', label, error: String(e.message).split('\n')[0] })); }
}
const tapAny = (r, sel) => r.tap(r.page.locator(sel).first(), { after: 1500 });

const CAFE = '/api/p/eyal/corner-cafe/landing';
// Tap a change by its title on the "All changes" list (ids change with every run).
async function openChange(r, title) {
  await go(r, '#/changes', 600); await top(r);
  await r.tap(r.page.locator('a', { hasText: title }).first(), { after: 1200 });
  await top(r); await r.sleep(500);
}

const SCENES = {
  // 4. The live scripted run on eyal/corner-cafe (qb6 demo mode): reset, start, time-lapse, then drill-downs.
  async live() {
    await api(`${CAFE}/demo`, { method: 'POST', body: { action: 'reset' } });
    await new Promise((res) => setTimeout(res, 4000));
    const r = narrated(await rig({ name: 'contest-live' }));
    await r.open('/p/eyal/corner-cafe/work');
    await r.say('This is a real project on qodebase: a small café website. Four agents get fourteen tasks.');
    await r.say("They're scripted for this video: real commits on real forks, through the real queue and tests, with no AI bills.");
    await api(`${CAFE}/demo`, { method: 'POST', body: { action: 'start', agents: 4, speed: 2 } });
    // Captions during the time-lapse, at source offsets that play ~10 s apart at x8.
    const SPEED = 8, t0 = Date.now();
    const timed = [
      [0, 'Finished changes join the line and are tested together, in trains.'],
      [85, 'Some collide on the same file. The queue replays them on the newest code instead of sending them back.'],
      [170, 'One change breaks a test. Only that change bounces, and its agent fixes it.'],
    ];
    for (const [, text] of timed) voSeconds(text);   // warm the narration cache now, not mid-run
    const captions = (async () => { for (const [at, text] of timed) { const wait = t0 + at * 1000 - Date.now(); if (wait > 0) await r.sleep(wait); r.say(text); } })();
    await r.waitFor(async () => ((await api(CAFE)).stats?.landedToday || 0) >= 14 && Date.now() - t0 > 200_000, { speed: SPEED, label: 'scripted run', poll: 4000, timeout: 12 * 60_000 });
    await captions;
    const s = (await api(CAFE)).stats || {};
    console.log(JSON.stringify({ event: 'run_done', realS: Math.round((Date.now() - t0) / 1000), ...s }));
    await top(r); await r.sleep(500);
    await r.say(`All fourteen landed in ${Math.round((Date.now() - t0) / 60000)} minutes. Typical time from ask to landed: ${s.medianAskToLandS} seconds.`);
    // Drill into one change of each kind, picked from this run's records (outcomes vary per run).
    const ch = (await api(CAFE)).changes || [];
    const has = (c, re) => (c.events || []).some((e) => re.test(e.what));
    const pick = {
      replayed: ch.find((c) => c.landing?.how === 'replayed-handler'),
      bounced: ch.find((c) => has(c, /bounced/)),
      lead: ch.find((c) => c.landing?.how === 'lead' || has(c, /with-lead/)),
      stacked: ch.find((c) => c.stackedOn),
    };
    console.log(JSON.stringify({ event: 'picks', ...Object.fromEntries(Object.entries(pick).map(([k, c]) => [k, c?.title || null])) }));
    const SAYS = {
      replayed: 'Every change explains itself. This one collided with another on a shared file, and was replayed on the newest code.',
      bounced: 'This one broke a test, so it bounced alone. Its agent pushed a fix, and it landed on the next train.',
      lead: 'When a replay is not enough, the lead agent for that area redoes it. You only hear about it if it needs you.',
      stacked: 'And this one was built on a page that had not landed yet. It landed right after it.',
    };
    for (const k of Object.keys(SAYS)) if (pick[k]) await may(k, async () => { await openChange(r, pick[k].title); await r.say(SAYS[k]); });
    await r.end(null);
  },

  // 0. Cold open, ~15 s: many agents moving, a train landing.
  async open() {
    const r = narrated(await rig({ name: 'contest-open' }));
    await r.open(WORK);
    await r.say('Ten agents are changing one app at the same time.');
    await r.scroll('a[href="#/line"]', { offset: -140, after: 300 });
    await r.say('Their work waits in one line, is tested, and joins the main code. No one has to step in.');
    await r.end(null);
  },
  // 4. The demo: overview, the line, an area, a change's record, a replay, a lead, a stack.
  async demo() {
    const r = narrated(await rig({ name: 'contest-demo' }));
    await r.open(WORK);
    await r.say('This is a project on qodebase, on the phone. Each agent works on its own copy of the code.');
    await r.say('The numbers say it in plain words: what landed today, what is waiting, what was replayed.');
    await r.scroll('a[href="#/line"]', { offset: -140, after: 600 });
    await r.say('Finished changes wait in the line. A group of them is tested together, then lands on main.', { hold: 6500 });
    await may('area', async () => {
      await r.page.locator('a[href^="#/area/"]').first().waitFor({ timeout: 8000 });
      await r.scroll('a[href^="#/area/"]', { offset: -160, after: 400 });
      await r.say('This map shows who works where. Tap an area of the code.');
      await tapAny(r, 'a[href^="#/area/"]');
      await r.say('Its files, the agents working here, and what landed today.');
    });
    await go(r, '#/change/101', 300); await top(r); await r.sleep(800);
    await r.say('Every change explains itself. This one collided with another agent on package.json.');
    await r.say('Instead of sending it back, qodebase re-applied what it was meant to do on the newest code, tested it again, and landed it.', { hold: 6500 });
    await r.page.evaluate(() => scrollBy({ top: 420, behavior: 'smooth' })); await r.sleep(900);
    await r.say('The whole story is kept: what it was asked to do, what happened, and when.');
    await go(r, '#/change/110', 300); await top(r); await r.sleep(800);
    await r.say('When a replay is not enough, the area lead, another agent, takes it. You only hear about it if it needs you.', { hold: 6000 });
    await go(r, '#/change/114', 300); await top(r); await r.sleep(800);
    await r.say('A change can build on one that has not landed yet. It lands right after it.');
    await go(r, '', 300); await top(r); await r.sleep(600);
    await may('ask', () => r.fill('textarea, input[placeholder^="Ask"]', 'Add a dark mode and a share button'));
    await r.say('And you steer it by asking, typed or spoken, from your phone.');
    await r.end(null);
  },
};

for (const s of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENES)) await SCENES[s]();
