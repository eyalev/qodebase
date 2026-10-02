// Home as the entrance to forq's world (design take on forq-d, 2026-10-02):
// a pulse (what is running, how many agents are working), then three sub-tabs:
// Happening (a feed), Projects (busy now, new, most forked) and People.
// The same page signed in or not. Until there is real traffic it shows SAMPLE
// data: made-up handles and projects, labelled as such on the page.

import type { Entry } from './registry';
import { esc, path, STEPS } from './ui';
import { freshTag } from './fresh';

const H = 3600_000, D = 24 * H;

type SProject = { owner: string; name: string; desc: string; forks: number; working: number; createdAgo: number };
type SEvent = { ago: number; kind: 'merged' | 'forked' | 'asked' | 'fixed' | 'created' | 'imported'; who: string; project: string; text: string; extra?: string };

// Made-up people and projects (no real people), only for the feel of the page.
const PEOPLE = ['maya', 'noa', 'dan', 'lior', 'amit', 'sara', 'tom'];
const PROJECTS: SProject[] = [
  { owner: 'maya', name: 'focus-timer', desc: 'Pomodoro timer with a soft chime and a daily streak', forks: 12, working: 2, createdAgo: 9 * D },
  { owner: 'noa', name: 'recipe-box', desc: 'Save recipes from any link, scale them for the number of people', forks: 8, working: 1, createdAgo: 4 * D },
  { owner: 'dan', name: 'kanban', desc: 'A one-page kanban board that works offline', forks: 21, working: 3, createdAgo: 16 * D },
  { owner: 'lior', name: 'pixel-paint', desc: 'Draw 32×32 pixel art on your phone and share it', forks: 5, working: 0, createdAgo: 2 * D },
  { owner: 'amit', name: 'habit-streak', desc: 'Track three habits, one tap each, no account', forks: 14, working: 1, createdAgo: 11 * D },
  { owner: 'sara', name: 'trip-split', desc: 'Split a group trip: who paid what, who owes whom', forks: 9, working: 0, createdAgo: 6 * D },
  { owner: 'tom', name: 'plant-water', desc: 'Reminds you which plant to water today (a Worker with Durable Objects)', forks: 3, working: 1, createdAgo: 1 * D },
  { owner: 'noa', name: 'quiz-night', desc: 'Run a pub quiz from your phone; teams join with a code', forks: 6, working: 0, createdAgo: 20 * H },
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
export function worldBody(tab: WorldTab, real: Entry[], signedIn: boolean) {
  const now = Date.now();
  REAL = new Set(real.map((e) => e.slug));
  const working = PROJECTS.reduce((n, p) => n + p.working, 0);
  const merged = EVENTS.filter((e) => e.kind === 'merged' || e.kind === 'fixed').length * 9;
  const sub = (id: WorldTab, labelT: string) => `<a href="/${id === 'happening' ? '' : `?s=${id}`}" class="${tab === id ? 'on' : ''}"${tab === id ? ' aria-current="page"' : ''}>${labelT}</a>`;
  const head = `<p class="lede2">Projects that run, and agents that change them.</p>
<div class="pulse"><div><b>${PROJECTS.length + real.length}</b><span>projects</span></div><div class="live"><b>${working}</b><span>agents working</span></div><div><b>${merged}</b><span>merged this week</span></div></div>
<p class="sample">Sample data: these people and most projects are made up.</p>
<nav class="sub3" aria-label="Home">${sub('happening', 'Happening')}${sub('projects', 'Projects')}${sub('people', 'People')}</nav>`;
  let body = '';
  if (tab === 'happening') {
    body = `<div class="feed">${EVENTS.map((e) => `<div class="ev">${mono(e.who)}<div class="tx"><b>${esc(e.who)}</b> ${VERB[e.kind]} ${plink(e.project)}
${e.kind === 'forked' ? `<span class="what">as ${esc(e.text)}</span>` : `<span class="what k-${MARK[e.kind]}">${esc(e.text)}</span>`}
<span class="meta2">${freshTag(now - e.ago, now, STEPS)}${e.extra ? `<span>${esc(e.extra)}</span>` : ''}</span></div></div>`).join('')}</div>`;
  } else if (tab === 'projects') {
    const card = (p: { owner: string; name: string; desc: string; working?: number; forks?: number; slug?: string }) => `<${p.slug ? `a href="${path(p.slug)}"` : 'div title="Sample project"'} class="pc"><span class="tile">${esc(p.name[0].toUpperCase())}</span>
<span class="n"><span class="o">${esc(p.owner)} /</span> ${esc(p.name)}</span><span class="d">${esc(p.desc)}</span>
<span class="s${p.working ? ' busy' : ''}">${p.working ? `<span class="dot"></span>${p.working} agent${p.working > 1 ? 's' : ''} working` : `${p.forks || 0} fork${p.forks === 1 ? '' : 's'}`}</span></${p.slug ? 'a' : 'div'}>`;
    const busy = PROJECTS.filter((p) => p.working).sort((a, b) => b.working - a.working);
    const fresh = [...PROJECTS].sort((a, b) => a.createdAgo - b.createdAgo).slice(0, 4);
    const forked = [...PROJECTS].sort((a, b) => b.forks - a.forks).slice(0, 4);
    const realCards = real.slice(0, 6).map((e) => card({ owner: e.owner, name: e.name, desc: e.description || '', slug: e.slug, forks: real.filter((x) => x.forkedFrom === e.slug).length }));
    body = `<p class="sec2">Busy right now</p><div class="cards2">${busy.map(card).join('')}</div>
<p class="sec2">New this week</p><div class="cards2">${fresh.map(card).join('')}</div>
<p class="sec2">Most forked</p><div class="cards2">${forked.map(card).join('')}</div>
${realCards.length ? `<p class="sec2">On this forq (real)</p><div class="cards2">${realCards.join('')}</div>` : ''}`;
  } else {
    const stats = PEOPLE.map((h) => ({ h, projects: PROJECTS.filter((p) => p.owner === h).length, merged: EVENTS.filter((e) => e.who === h && e.kind === 'merged').length * 7 + 3, last: Math.min(...EVENTS.filter((e) => e.who === h).map((e) => e.ago), 9 * D) }));
    body = `<div class="people">${stats.sort((a, b) => a.last - b.last).map((p) => `<div class="pp">${mono(p.h)}<div class="tx"><b>${esc(p.h)}</b><span>${p.projects} project${p.projects === 1 ? '' : 's'}, ${p.merged} changes merged</span></div>${freshTag(now - p.last, now, STEPS)}</div>`).join('')}</div>`;
  }
  return `${head}${body}${signedIn ? '' : '<p class="empty" style="margin-top:20px"><a href="/login">Sign in</a> to fork projects and run agents with your own Anthropic API key.</p>'}`;
}
