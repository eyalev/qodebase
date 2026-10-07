// Phone scenes for the draft cut, filmed from the live sim viewer (qodebase.app/sim/run).
// Each scene is its own rig recording in video/frames/contest-<scene>; cut.py places them.
//   node video/contest/rec-sim.mjs [open|realgit|cloud …]
import { rig } from '../rig.mjs';

const RUN = (name) => `/sim/run?run=${name}`;
// Seek the viewer to simulated second s (the range input drives render()).
const seek = (r, s) => r.page.evaluate((v) => { const t = document.getElementById('t'); t.value = v; t.dispatchEvent(new Event('input')); }, s);
const speed = (r, k) => r.page.evaluate((k) => document.querySelectorAll('[data-speed]')[k].click(), k);
const play = (r) => r.page.evaluate(() => document.getElementById('play').click());
// Scroll so the "where the agents are" bar and the codebase map share the screen.
const toMap = (r) => r.scroll('#view', { block: 'start', offset: -40, after: 600 });

const SCENES = {
  // 0. Cold open: a busy run, numbers moving, the map lighting up. (Replaced by demo mode later.)
  async open() {
    const r = await rig({ name: 'contest-open', email: null });
    await r.open(RUN('cloud-500'));
    await speed(r, 0); await seek(r, 120); await toMap(r);
    await play(r);
    await r.say('500 agents are changing one codebase at the same time.');
    await r.say('None of them waits for a person. None of them breaks it.');
    await r.end(null);
  },
  // 2. Real code, real git, 500 agents with plain agent review: conflicts pile on the shared files.
  async realgit() {
    const r = await rig({ name: 'contest-realgit', email: null });
    await r.open(RUN('agentReview-500'));
    await seek(r, 3600);
    await r.say('Then we built a real codebase and let 500 scripted agents change it, with real git and real tests on every merge.');
    await toMap(r);
    await speed(r, 0); await play(r);
    await r.say('Each square is a file. Green: being changed. Orange: a git conflict. Black: just landed.');
    await play(r);
    await r.tap('button.folder[aria-label="shared"]', { after: 900 });
    await r.say('The conflicts pile onto a few shared files: the lists everyone appends to.');
    await r.tap(r.page.locator('#view a', { hasText: 'src/routes.ts' }), { after: 900 });
    await r.say('Every tick on this line is a collision on one file.', { hold: 3200 });
    await r.end(null);
  },
  // 2. The Cloudflare run, real time: 500 Durable Object agents pushing to Artifacts forks.
  async cloud() {
    const r = await rig({ name: 'contest-cloud', email: null });
    await r.open(RUN('cloud-500'));
    await seek(r, 300);
    await r.say('Then we ran it for real on Cloudflare: 500 agents, each its own Durable Object with its own git fork in Artifacts.');
    await r.scroll('#stats', { block: 'start', offset: -20, after: 400 });
    await r.say('Real pushes, a real merge queue, landing trains on main.', { hold: 3500 });
    await r.end(null);
  },
};

for (const s of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENES)) await SCENES[s]();
