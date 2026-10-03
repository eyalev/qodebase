// Home as the entrance to forq's world (design take on forq-d, 2026-10-02):
// a pulse (what is running, how many agents are working), then three sub-tabs:
// Happening (a feed), Projects (busy now, new, most forked) and People.
// The same page signed in or not. Until there is real traffic it shows SAMPLE
// data: made-up handles and projects, labelled as such on the page.

import type { Entry } from './registry';
import { esc, path, STEPS } from './ui';
import { freshTag } from './fresh';
import { catalogBody } from './catalog';

const H = 3600_000, D = 24 * H;

type Tag = 'productivity' | 'money' | 'food' | 'games' | 'creative' | 'learning' | 'social' | 'devtools' | 'worker';
type SProject = { owner: string; name: string; desc: string; tags: Tag[]; stars: number; week: number; forks: number; working: number; createdAgo: number };
type SEvent = { ago: number; kind: 'merged' | 'forked' | 'asked' | 'fixed' | 'created' | 'imported'; who: string; project: string; text: string; extra?: string };

/** Categories, in the order they are offered. 'worker' = has a backend (a Worker), not just a page. */
const TAGS: [Tag, string][] = [['productivity', 'Productivity'], ['money', 'Money'], ['food', 'Food'], ['games', 'Games'], ['creative', 'Creative'],
  ['learning', 'Learning'], ['social', 'Social'], ['devtools', 'Dev tools'], ['worker', 'With a backend']];
const TAG_LABEL = Object.fromEntries(TAGS) as Record<Tag, string>;

// Made-up people and projects (no real people), only for the feel of the page.
const PEOPLE = ['maya', 'noa', 'dan', 'lior', 'amit', 'sara', 'tom'];
const P = (owner: string, name: string, desc: string, tags: Tag[], stars: number, week: number, forks: number, working: number, createdAgo: number): SProject => ({ owner, name, desc, tags, stars, week, forks, working, createdAgo });
const PROJECTS: SProject[] = [
  P('dan', 'kanban', 'A one-page kanban board that works offline', ['productivity'], 1240, 96, 21, 3, 16 * D),
  P('maya', 'focus-timer', 'Pomodoro timer with a soft chime and a daily streak', ['productivity'], 412, 38, 12, 2, 9 * D),
  P('amit', 'habit-streak', 'Track three habits, one tap each, no account', ['productivity'], 655, 41, 14, 1, 11 * D),
  P('lior', 'daily-note', 'One note a day, searchable, nothing else', ['productivity'], 96, 22, 4, 0, 3 * D),
  P('sara', 'trip-split', 'Split a group trip: who paid what, who owes whom', ['money', 'social'], 388, 12, 9, 0, 6 * D),
  P('maya', 'budget-bars', 'Monthly budget as bars that fill as you spend', ['money'], 220, 30, 7, 0, 5 * D),
  P('tom', 'rent-split', 'Split rent by room size and who has the balcony', ['money'], 45, 9, 2, 0, 2 * D),
  P('noa', 'recipe-box', 'Save recipes from any link, scale them for the number of people', ['food'], 530, 64, 8, 1, 4 * D),
  P('noa', 'meal-plan', 'Plan the week\'s dinners, get one shopping list', ['food', 'productivity'], 77, 18, 3, 0, 1 * D),
  P('dan', 'coffee-ratio', 'Grams of coffee and water for any brew method', ['food'], 210, 3, 6, 0, 30 * D),
  P('noa', 'quiz-night', 'Run a pub quiz from your phone; teams join with a code', ['games', 'social', 'worker'], 150, 120, 6, 0, 20 * H),
  P('lior', 'snake-touch', 'Snake for thumbs: swipe to turn, haptics on every apple', ['games'], 860, 15, 31, 0, 40 * D),
  P('amit', 'word-ladder', 'Change one letter at a time from COLD to WARM', ['games', 'learning'], 300, 44, 11, 1, 8 * D),
  P('dan', 'minesweeper', 'Minesweeper with long-press to flag', ['games'], 95, 2, 5, 0, 60 * D),
  P('lior', 'pixel-paint', 'Draw 32×32 pixel art on your phone and share it', ['creative'], 470, 52, 5, 0, 2 * D),
  P('maya', 'color-pick', 'Pick a colour from a photo, get a palette of five', ['creative', 'devtools'], 130, 11, 3, 0, 12 * D),
  P('sara', 'slides-md', 'Write slides in Markdown, present from your phone', ['creative', 'productivity'], 305, 27, 10, 0, 14 * D),
  P('noa', 'flashcards', 'Spaced-repetition flashcards that sync between devices', ['learning', 'worker'], 720, 58, 19, 2, 21 * D),
  P('amit', 'hebrew-letters', 'Learn the Hebrew alphabet by tracing letters', ['learning'], 60, 14, 2, 0, 3 * D),
  P('tom', 'periodic-table', 'A periodic table you can actually read on a phone', ['learning'], 410, 6, 9, 0, 50 * D),
  P('dan', 'potluck', 'Who brings what to the potluck, no sign-up', ['social', 'food', 'worker'], 88, 19, 4, 0, 5 * D),
  P('tom', 'plant-water', 'Reminds you which plant to water today', ['social', 'worker'], 140, 33, 3, 1, 1 * D),
  P('sara', 'event-rsvp', 'An event page with RSVPs and a waitlist', ['social', 'worker'], 199, 24, 8, 0, 9 * D),
  P('amit', 'json-view', 'Paste JSON, get a foldable tree you can search', ['devtools'], 940, 21, 15, 0, 35 * D),
  P('lior', 'regex-tester', 'Test a regex against your text, see every match', ['devtools'], 610, 9, 12, 0, 45 * D),
];
const EVENTS: SEvent[] = [
  { ago: 4 * 60_000, kind: 'merged', who: 'dan', project: 'dan/kanban', text: 'Drag cards between columns', extra: 'reviewed in a preview, merged' },
  { ago: 9 * 60_000, kind: 'asked', who: 'maya', project: 'maya/focus-timer', text: 'Add a weekly chart of focus minutes', extra: '2 agents working' },
  { ago: 22 * 60_000, kind: 'fixed', who: 'tom', project: 'tom/plant-water', text: 'A 500 on the reminders page', extra: 'Cloudflare Issues reported it; fixed, reviewed and merged in 7 min' },
  { ago: 41 * 60_000, kind: 'forked', who: 'lior', project: 'dan/kanban', text: 'lior/kanban' },
  { ago: 1.5 * H, kind: 'merged', who: 'noa', project: 'noa/recipe-box', text: 'Scale ingredients for 2, 4 or 8 people', extra: 'merged' },
  { ago: 3 * H, kind: 'created', who: 'noa', project: 'noa/quiz-night', text: 'Run a pub quiz from your phone' },
  { ago: 5 * H, kind: 'imported', who: 'sara', project: 'sara/reveal-js', text: 'hakimel/reveal.js', extra: '70k stars on GitHub' },
  { ago: 8 * H, kind: 'merged', who: 'amit', project: 'amit/habit-streak', text: 'Haptic tap when a habit is done', extra: 'merged' },
  { ago: 13 * H, kind: 'forked', who: 'maya', project: 'eyal/tipsplit', text: 'maya/tipsplit' },
  { ago: 26 * H, kind: 'merged', who: 'lior', project: 'lior/pixel-paint', text: 'Export as PNG at 8× size', extra: 'merged' },
  { ago: 2 * D, kind: 'fixed', who: 'dan', project: 'dan/kanban', text: 'Cards lost after reload on Safari', extra: 'an agent found the storage bug; merged' },
  { ago: 3 * D, kind: 'created', who: 'tom', project: 'tom/plant-water', text: 'Which plant to water today' },
];

const VERB: Record<SEvent['kind'], string> = { merged: 'merged a change in', forked: 'forked', asked: 'asked for a change in', fixed: 'got an error fixed in', created: 'started', imported: 'imported' };
const MARK: Record<SEvent['kind'], string> = { merged: 'm', forked: 'f', asked: 'a', fixed: 'x', created: 'c', imported: 'i' };

const STAR = `<svg class="ic" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="m8 1.8 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/></svg>`;
const FORK = `<svg class="ic" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="4.5" cy="3.5" r="1.5"/><circle cx="11.5" cy="3.5" r="1.5"/><circle cx="8" cy="12.5" r="1.5"/><path d="M4.5 5v1.5c0 1.2 1 2 2 2h3c1 0 2-.8 2-2V5M8 8.5V11"/></svg>`;
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));
export type Sort = 'trending' | 'top' | 'new';

const mono = (h: string) => `<span class="av" aria-hidden="true">${esc(h[0].toUpperCase())}</span>`;
/** Only real projects are links; sample ones are text (they have no page). */
let REAL = new Set<string>();
const plink = (slug: string) => (REAL.has(slug.replace('/', '.')) ? `<a href="${path(slug.replace('/', '.'))}">${esc(slug)}</a>` : `<b>${esc(slug)}</b>`);

export const WORLD_CSS = `
.sample{display:flex;gap:8px;align-items:center;margin:0 0 8px;padding:6px 10px;border:1px dashed var(--line);border-radius:8px;font-size:13px;color:var(--dim)}
.pulse{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 0 16px}
.pulse div{background:var(--card);border-radius:12px;padding:8px 12px}
.pulse b{display:block;font-size:20px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.2}
.pulse span{font-size:13px;color:var(--dim);white-space:nowrap}
.pulse .live b{display:flex;align-items:center;gap:6px}
.pulse .live b::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--busy);animation:pulse 1.6s ease-in-out infinite}
.lede2{font-size:17px;line-height:1.35;margin:0 0 12px;font-weight:500}
.sub3{position:sticky;top:0;z-index:5;display:flex;gap:4px;margin:0 -16px 12px;padding:6px 16px;background:var(--bg);border-bottom:1px solid var(--line)}
.sub3 a{flex:1;text-align:center;min-height:36px;display:flex;align-items:center;justify-content:center;border-radius:8px;color:var(--dim);font:500 14px 'Instrument Sans',sans-serif}
.sub3 a.on{background:var(--chip);color:var(--fg)}
.feed{display:flex;flex-direction:column}
.ev{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}
.av{flex:none;width:36px;height:36px;border-radius:50%;background:var(--chip);color:var(--fg);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:15px}
.ev .tx{flex:1;min-width:0;font-size:15px;line-height:1.4}
.ev .tx b{font-weight:600}
.ev .what{display:block;margin-top:4px;padding:8px 10px;background:var(--card);border-radius:8px;font-size:14px}
.ev .what.k-x{border-left:3px solid var(--warn)}
.ev .what.k-m{border-left:3px solid var(--acc)}
.ev .what.k-a{border-left:3px solid var(--busy)}
.ev .meta2{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:13px;color:var(--dim)}
.sec2{font-size:13px;font-weight:600;color:var(--dim);margin:20px 0 8px}
.sec2:first-child{margin-top:4px}
.cards2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.pc{position:relative;display:flex;flex-direction:column;gap:6px;background:var(--card);border-radius:12px;padding:12px;color:inherit;min-height:132px}
.pc .tile{width:40px;height:40px;border-radius:8px;background:var(--bg);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-weight:600}
.pc .n{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pc .o{color:var(--dim);font-weight:400}
.pc .d{font-size:13px;color:var(--dim);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pc .s{margin-top:auto;display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dim)}
.pc .s.busy{color:var(--fg)}
.pc .s.busy .dot{background:var(--busy);animation:pulse 1.6s ease-in-out infinite}
.cats{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:0 -16px 8px;padding:0 16px}
.cats::-webkit-scrollbar{display:none}
.cats a{flex:none;display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 12px;border-radius:8px;border:1px solid var(--line);color:var(--fg);font:500 14px 'Instrument Sans',sans-serif}
.cats a span{color:var(--dim);font-variant-numeric:tabular-nums}
.cats a.on{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.cats a.on span{color:color-mix(in srgb,var(--bg) 70%,var(--fg))}
.sorts{display:flex;align-items:center;gap:16px;margin:4px 0 4px;font-size:14px}
.sorts a{color:var(--dim);font-weight:500;padding:8px 0;border-bottom:2px solid transparent}
.sorts a.on{color:var(--fg);border-bottom-color:var(--fg)}
.sorts .why{margin-left:auto;font-size:12px;color:var(--dim)}
.plist{display:flex;flex-direction:column}
.pr{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--line);color:inherit}
.pr .tile{flex:none;width:44px;height:44px;border-radius:8px;background:var(--card);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:17px}
.pr .bd{flex:1;min-width:0}
.pr .n{display:block;font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pr .n .o{color:var(--dim);font-weight:400}
.pr .d{display:block;font-size:14px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px}
.pr .m{display:flex;align-items:center;flex-wrap:wrap;gap:4px 12px;margin-top:6px;font-size:13px;color:var(--dim);font-variant-numeric:tabular-nums}
.pr .m .st{display:inline-flex;align-items:center;gap:4px;color:var(--fg);font-weight:500}
.pr .m .up{color:var(--acc);font-weight:500}
.pr .m .f{display:inline-flex;align-items:center;gap:4px}
.pr .m .w{display:inline-flex;align-items:center;gap:6px;color:var(--fg)}
.pr .m .w .dot{background:var(--busy);animation:pulse 1.6s ease-in-out infinite}
.pr .tg{display:inline-block;font-size:12px;color:var(--dim);background:var(--chip);border-radius:4px;padding:1px 6px}
.ic{flex:none}
.people{display:flex;flex-direction:column}
.pp{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}
.pp .av{width:44px;height:44px;font-size:17px}
.pp .tx{flex:1;min-width:0}
.pp b{display:block;font-weight:600}
.pp .tx span{font-size:13px;color:var(--dim)}
@media (min-width:700px){.cards2{grid-template-columns:repeat(3,1fr)}}
@media (hover:hover){.pc:hover{background:var(--chip)}}
`;

export type WorldTab = 'happening' | 'projects' | 'people';

/** The world: same for everyone. `real` adds the instance's real projects to Projects. */
export function worldBody(tab: WorldTab, real: Entry[], signedIn: boolean, opts: { tag?: string; sort?: string } = {}) {
  const now = Date.now();
  REAL = new Set(real.map((e) => e.slug));
  const working = PROJECTS.reduce((n, p) => n + p.working, 0);
  const merged = EVENTS.filter((e) => e.kind === 'merged' || e.kind === 'fixed').length * 9;
  // Projects is the home page's first view (Eyal, 2026-10-03: "I want to see top projects").
  const sub = (id: WorldTab, labelT: string) => `<a href="/${id === 'projects' ? '' : `?s=${id}`}" class="${tab === id ? 'on' : ''}"${tab === id ? ' aria-current="page"' : ''}>${labelT}</a>`;
  // The intro and the pulse open Happening only; Projects and People start at their content.
  const head = `${tab === 'happening' ? `<p class="lede2">Projects that run, and agents that change them.</p>
<div class="pulse"><div><b>${PROJECTS.length + real.length}</b><span>projects</span></div><div class="live"><b>${working}</b><span>agents working</span></div><div><b>${merged}</b><span>merged this week</span></div></div>
` : ''}${tab === 'projects' ? '' : '<p class="sample">Sample data: these people and most projects are made up.</p>'}
<nav class="sub3" aria-label="Home">${sub('projects', 'Projects')}${sub('happening', 'Happening')}${sub('people', 'People')}</nav>`;
  let body = '';
  if (tab === 'happening') {
    body = `<div class="feed">${EVENTS.map((e) => `<div class="ev">${mono(e.who)}<div class="tx"><b>${esc(e.who)}</b> ${VERB[e.kind]} ${plink(e.project)}
${e.kind === 'forked' ? `<span class="what">as ${esc(e.text)}</span>` : `<span class="what k-${MARK[e.kind]}">${esc(e.text)}</span>`}
<span class="meta2">${freshTag(now - e.ago, now, STEPS)}${e.extra ? `<span>${esc(e.extra)}</span>` : ''}</span></div></div>`).join('')}</div>`;
  } else if (tab === 'projects') {
    body = catalogBody(real, { cat: opts.tag, sort: opts.sort });
  } else {
    const stats = PEOPLE.map((h) => ({ h, projects: PROJECTS.filter((p) => p.owner === h).length, merged: EVENTS.filter((e) => e.who === h && e.kind === 'merged').length * 7 + 3, last: Math.min(...EVENTS.filter((e) => e.who === h).map((e) => e.ago), 9 * D) }));
    body = `<div class="people">${stats.sort((a, b) => a.last - b.last).map((p) => `<div class="pp">${mono(p.h)}<div class="tx"><b>${esc(p.h)}</b><span>${p.projects} project${p.projects === 1 ? '' : 's'}, ${p.merged} changes merged</span></div>${freshTag(now - p.last, now, STEPS)}</div>`).join('')}</div>`;
  }
  return `${head}${body}${signedIn ? '' : '<p class="empty" style="margin-top:20px"><a href="/login">Sign in</a> to fork projects and run agents with your own Anthropic API key.</p>'}`;
}
