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
// Bring an element on screen (scroll the page, the screenshot only covers the viewport), then point the zoom at it.
async function show(r, sel) {
  await r.page.locator(sel).first().evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'smooth' })).catch(() => {});
  await r.sleep(700);
  await r.focus(sel);
}
const tapAny = (r, sel) => r.tap(r.page.locator(sel).first(), { after: 1500 });

const CAFE = '/api/p/eyal/corner-cafe/landing';
const BUSY_PROJECT = process.env.BUSY_PROJECT || 'eyal/cafe-busy';
// Tap a change by its title on the "All changes" list (ids change with every run).
async function openChange(r, title) {
  r.clear();                         // the last sentence must not play over the list we pass through
  await go(r, '#/changes', 600); await top(r);
  await r.tap(r.page.locator('a', { hasText: title }).first(), { after: 1200 });
  await top(r); await r.sleep(500);
  await r.focus({ y: 0 });   // title, progress, the "how it landed" box and the ask all fit the window
}

// The real-agent crew project (qb6). cafe-crew's router refused a second identical order ('already done'),
// so takes after the first go to a fresh copy.
const CREW_PROJECT = process.env.CREW_PROJECT || 'eyal/cafe-team';
const CREW = `/api/p/${CREW_PROJECT}/landing`;
const CREW_ASK = `Build these 12 café features at once, one agent each (start exactly 12 agents, spawn each with --files listing the files it changes): 1) Opening hours page (src/pages/hours.js, src/routes.js); 2) Contact page with the address (src/pages/contact.js, src/routes.js); 3) Events page (src/pages/events.js, src/routes.js); 4) add three cakes to the menu (src/data/menu.js); 5) add two teas to the menu (src/data/menu.js); 6) a 'vegan' badge on menu items (src/pages/menu.js, style.css); 7) a dark theme that follows the phone (style.css); 8) a footer with the address (index.html, style.css); 9) today's specials on the home page (src/pages/home.js); 10) show whole prices without cents, update the test (src/lib/format.js, test/site.test.js); 11) rename the café to Corner Café & Books (src/site.js); 12) a new tagline mentioning books (src/site.js). Tests: node --test. Don't merge: approved changes go to the merge queue by themselves.`;

const SCENES = {
  // 4b'. The crew run again, from qb7's client replay of its own events (?replay=4, renumbered
  // agents 1..12; no new run). The Talk send itself stays from the real take (contest-crew).
  async crewreplay() {
    const r = narrated(await rig({ name: 'contest-crewreplay' }));
    await r.open(`/p/${CREW_PROJECT}/work?replay=4`);
    await r.focus({ y: 0 });
    const t0 = Date.now();
    await r.say('Here is that run again, replayed four times faster from its own record.');
    await show(r, 'text=Where they work');
    await r.say('Twelve agents write code at the same time. Three reviewer agents read every change.');
    // Wait for the replay to reach its end (every change landed), narrating on the way.
    const done = () => r.page.evaluate(() => /12 landed/.test(document.body.innerText)).catch(() => false);
    let k = 0;
    const lines = ['Approved changes join the line by themselves and land in tested trains.',
      'Two agents changed the same line of the same file. An AI replayed the second one on the newest code, in nineteen seconds.'];
    for (const l of lines) voSeconds(l);
    while (!(await done()) && Date.now() - t0 < 6 * 60_000) {
      if (k < lines.length && Date.now() - t0 > 25_000 + k * 25_000) { await show(r, k === 0 ? 'text=The line' : 'text=Where they work'); await r.say(lines[k++]); }
      else await r.sleep(1000);
    }
    while (k < lines.length) { await show(r, 'text=The line'); await r.say(lines[k++]); }
    await top(r); await r.sleep(600); await r.focus({ y: 0 });
    await r.say('All twelve landed six minutes and forty-three seconds after the request, every one reviewed and tested.');
    r.clear();
    await go(r, '#/change/eyal.cafe-team--xkvo4', 1200); await top(r); await r.focus({ y: 0 });
    await r.say('This is the one that collided. An AI model redid what it was meant to do on the newest code, in nineteen seconds, for about nine cents of model use.');
    await may('reviewed', async () => {
      const t = r.page.getByText(/What was reviewed/).first();
      await t.evaluate((el) => el.scrollIntoView({ block: 'center' })); await r.sleep(500);
      await r.focus(t); await r.tap(t, { after: 1200 });
      await r.say('Its record shows the lines that landed next to the ones the reviewer approved.');
    });
    await may('notes', async () => {
      r.clear();
      const d = r.page.getByText(/^Details$/).first();
      await d.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'smooth' })); await r.sleep(800);
      await r.focus(d);
      await r.say("And the reviewer agent's notes stay in the record, next to the code.");
    });
    await r.end(null);
  },
  // 4. Talk on a project page, up to the confirm. Taps No: the crew run itself was delivered via the
  // router API (qb6) because this take's Talk read the order as 'open a page' (fixed by qb2, 6a4c6f2).
  async talk() {
    const r = narrated(await rig({ name: 'contest-talk' }));
    await r.open('/p/eyal/cafe-crew');
    await r.focus({ y: 0 });
    await r.say('Now real AI agents. You tell a project what you want, typed or spoken, from the phone.');
    await r.tap('#talk-fab', { after: 900 });
    await r.page.locator('#talk-in').fill(CREW_ASK);
    await r.focus('#talk-in');
    await r.sleep(1500);
    await r.tap('#talk-send', { after: 1500 });
    const pri = r.page.locator('#talk-offer .talk-chip.pri').first();
    await pri.waitFor({ timeout: 20000 });
    const label = (await pri.innerText()).trim();
    console.log(JSON.stringify({ event: 'talk_offer', label }));
    if (label !== 'Send') throw new Error(`Talk offered "${label}", not Send`);
    await r.focus('#talk-offer');
    await r.say('It asks once before it sends anything to the agents.');
    await r.end(null);   // the scene ends on the confirm: nothing is sent (the browser closes with the sheet open)
  },
  // 4. The crew: ONE request in Talk -> 12 real Claude Haiku 5.5 agents + 3 reviewers on eyal/cafe-crew
  // (qb6, $5 budget stop). Real agents, real reviews, real collisions; time-lapse to landed.
  async crew() {
    const r = narrated(await rig({ name: 'contest-crew' }));
    await r.open(`/p/${CREW_PROJECT}`);
    await r.focus({ y: 0 });
    await r.say('Now real AI agents. One request, typed into Talk on the phone: twelve features for the café at once.');
    await r.tap('#talk-fab', { after: 900 });
    await r.page.locator('#talk-in').fill(CREW_ASK);
    await r.focus('#talk-in');
    await r.sleep(1200);
    await r.tap('#talk-send', { after: 2500 });
    // Honest take only: Talk itself must send it (manager, 2026-10-08). No API fallback.
    const pri = r.page.locator('#talk-offer .talk-chip.pri').first();
    await pri.waitFor({ timeout: 20000 });
    const label = (await pri.innerText()).trim();
    console.log(JSON.stringify({ event: 'talk_offer', label }));
    if (label !== 'Send') { await r.end(null); throw new Error(`Talk offered "${label}", not Send: nothing sent`); }
    await r.focus('#talk-offer');
    await r.say('It asks once before it sends anything to the agents.');
    await r.tap(pri, { after: 3000 });
    // Close the sheet: in take 1 it stayed open over the bottom of Agents at work for the whole run.
    const closeTalk = () => r.page.locator('#talk-root button.talk-ib[aria-label="Close"]').first().click({ timeout: 3000 }).catch(() => {});
    const t0 = Date.now();
    console.log(JSON.stringify({ event: 'crew_sent', at: new Date().toISOString() }));
    await r.focus({ y: 0 });
    await r.say('The router agent splits it into twelve tasks and starts twelve Claude Haiku 5.5 agents, each on its own fork, each declaring the files it will touch.');
    await closeTalk();
    await r.open(`/p/${CREW_PROJECT}/work`);
    await closeTalk(); await r.sleep(400);
    await r.focus({ y: 0 });
    const SPEED = 24;
    const timed = [
      [0, 'Twelve agents write code at the same time. Three reviewer agents read every change.'],
      [420, 'Approved changes join the line by themselves and land in tested trains.'],
      [840, 'Two agents changed the same line of the same file. An AI replays the second one on the newest code.'],
    ];
    for (const [, text] of timed) voSeconds(text);
    const where = ['text=Where they work', 'text=The line', 'text=The line'];
    let stop = false;
    const captions = (async () => { for (const [k, [at, text]] of timed.entries()) { while (!stop && Date.now() < t0 + at * 1000) await r.sleep(1000); if (stop) return; await show(r, where[k]); r.say(text); } })();
    let finished = true;
    try {
      await r.waitFor(async () => { const d = await api(CREW); const ch = d.changes || []; return ch.length >= 12 && ch.every((c) => ['landed', 'bounced'].includes(c.state)) && ch.filter((c) => c.state === 'landed').length >= 10; },
        { speed: SPEED, label: 'real agents', poll: 10000, timeout: 45 * 60_000 });
    } catch (e) { finished = false; console.log(JSON.stringify({ event: 'crew_timeout', error: e.message })); }
    stop = true; await captions;
    const d = await api(CREW); const ch = d.changes || [];
    const landed = ch.filter((c) => c.state === 'landed').length;
    const mins = Math.round((Date.now() - t0) / 60000);
    console.log(JSON.stringify({ event: 'crew_done', finished, landed, total: ch.length, mins, stats: d.stats }));
    await top(r); await r.sleep(500); await r.focus({ y: 0 });
    await r.say(`${landed} of ${ch.length} changes landed in ${mins} minutes, every one reviewed and tested.`);
    const llm = ch.find((c) => c.landing?.how === 'replayed-llm');
    if (llm) await may('llm', async () => { await openChange(r, llm.title.slice(0, 40)); await r.say('This one collided. The AI replayed what it was meant to do on the newest code, and the record shows exactly what changed and what it cost.'); });
    const rev = ch.find((c) => c.review?.notes && c.state === 'landed');
    if (rev) await may('review', async () => { await openChange(r, rev.title.slice(0, 40)); await r.say('And every record keeps the reviewer agent\'s notes, next to the code.'); });
    await r.end(null);
  },
  // 0. Cold open on busy mode (qb6): 20 scripted agents, ~46 landings a minute. Never on
  // corner-cafe: that is the judges' project (manager, 2026-10-08), busy mode is refused there.
  async busy() {
    const BUSY = `/api/p/${BUSY_PROJECT}/landing`;
    await api(`${BUSY}/demo`, { method: 'POST', body: { action: 'reset' } });
    await new Promise((res) => setTimeout(res, 4000));
    await api(`${BUSY}/demo`, { method: 'POST', body: { action: 'start', mode: 'busy', agents: 20, speed: 2 } });
    await new Promise((res) => setTimeout(res, 45_000));          // let it get busy before the camera rolls
    const r = narrated(await rig({ name: 'contest-open' }));
    await r.open(`/p/${BUSY_PROJECT}/work`);
    await r.focus({ y: 0 });
    const n = await r.page.evaluate(() => (/(\d+) agents? (?:are|is) changing/.exec(document.body.innerText) || [])[1]).catch(() => null);
    await r.say(`${n || 'Twenty'} agents are changing one app at the same time. They're scripted, but every commit, collision and test is real.`);
    await r.focus('text=Where they work');
    await r.say('Their work waits in one line, is tested in trains, and joins the main code. No one has to step in.');
    await r.end(null);
    await api(`${BUSY}/demo`, { method: 'POST', body: { action: 'stop' } });
  },
  // 4. Real AI agents on eyal/cafe-real (qb6, Claude Haiku 5.5 verified): their two change records.
  async real() {
    const r = narrated(await rig({ name: 'contest-real' }));
    await r.open('/p/eyal/cafe-real/work');
    await r.focus({ y: 0 });
    await r.say('The same line works with real AI agents. One request, two Claude Haiku 5.5 agents, each on its own fork.');
    await may('oat', async () => { await openChange(r, 'Oat milk latte'); await r.say('Each change was reviewed, tested together with the other in one train, and landed, both right the first time.'); });
    await may('gift', async () => { await openChange(r, 'Gift cards page'); await r.say('Its record, what it was asked, the review and the tests, is kept with the code as a git note.'); });
    await r.end(null);
  },
  // 4. The live scripted run on eyal/corner-cafe (qb6 demo mode): reset, start, time-lapse, then drill-downs.
  async live() {
    const r = narrated(await rig({ name: 'contest-live' }));
    await r.open('/p/eyal/corner-cafe/work');
    await r.focus({ y: 0 });
    await r.say('This is a real project on qodebase: a small café website. Anyone can watch a run, no sign-in needed.');
    // The judges' path: tap "Watch a run" (qb6, 5a32b6d). Fallback: start it through the admin API.
    const watch = r.page.getByRole('button', { name: /watch a run/i }).first();
    if (await watch.isVisible().catch(() => false)) { await r.focus(watch); await r.tap(watch, { after: 2500 }); }
    else { console.log(JSON.stringify({ event: 'no_watch_button' })); await api(`${CAFE}/demo`, { method: 'POST', body: { action: 'start', agents: 6, speed: 2 } }); await r.sleep(2500); }
    const st = await api(CAFE);
    const agents = st.demo?.agents || st.run?.agents;
    await r.focus({ y: 0 });
    await r.say(`${agents ? `${agents} scripted agents` : 'Scripted agents'} get fourteen tasks: real commits on real forks, through the real queue and tests, with no AI bills.`);
    // Captions during the time-lapse, at source offsets that play ~10 s apart at x8.
    // A Watch-a-run run takes ~90 s real (qb6, 2x): x4, captions 32 s apart, so all three play while it runs.
    const SPEED = 4, t0 = Date.now();
    const timed = [
      [0, 'Finished changes join the line and are tested together, in trains.'],
      [32, 'Some collide on the same file. The queue replays them on the newest code instead of sending them back.'],
      [64, 'One change breaks a test. Only that change bounces, and its agent fixes it.'],
    ];
    for (const [, text] of timed) voSeconds(text);   // warm the narration cache now, not mid-run
    // Where the zoomed window looks during each caption: the line, then the map, then the line.
    const where = ['text=The line', 'text=Where they work', 'text=The line'];   // the map sits below the line
    const captions = (async () => { for (const [k, [at, text]] of timed.entries()) { const wait = t0 + at * 1000 - Date.now(); if (wait > 0) await r.sleep(wait); await show(r, where[k]); r.say(text); } })();
    await r.waitFor(async () => { const d = await api(CAFE); const ch = d.changes || []; return Date.now() - t0 > 75_000 && ch.length >= 14 && ch.every((c) => c.state === 'landed'); }, { speed: SPEED, label: 'scripted run', poll: 4000, timeout: 12 * 60_000 });
    await captions;
    const s = (await api(CAFE)).stats || {};
    console.log(JSON.stringify({ event: 'run_done', realS: Math.round((Date.now() - t0) / 1000), ...s }));
    await top(r); await r.sleep(500); await r.focus({ y: 0 });
    const took = Math.round((Date.now() - t0) / 1000);
    await r.say(`All fourteen landed in ${took < 120 ? `${took} seconds` : `${Math.round(took / 60)} minutes`}. Typical time from ask to landed: ${s.medianAskToLandS} seconds.`);
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
    await r.focus({ y: 0 });
    // Say the number the screen shows (draft 2 said "ten" over "6 agents are changing todo").
    const n = await r.page.evaluate(() => (/(\d+) agents? (?:are|is) changing/.exec(document.body.innerText) || [])[1]).catch(() => null);
    await r.say(n ? `${n} agents are changing one app at the same time.` : 'Many agents are changing one app at the same time.');
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
