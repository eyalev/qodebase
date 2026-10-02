// Workflow 1: fork a project and ship two changes with agents (as the owner).
import { rig, api } from '../rig.mjs';

const SLUG = 'eyal/tipsplit';
const info = () => api(`/api/p/${SLUG}`);
const others = (j) => (j.agents || []).filter((a) => a.state !== 'merged' && a.state !== 'stopped');

// Start clean: no earlier fork of tipsplit.
await api('/api/admin/delete', { method: 'POST', body: { repo: 'eyal.tipsplit', project: 'eyal.tipsplit' } });

const r = await rig({ name: 'w1-fork-and-agents' });
const p = r.page;

await r.chapter('Fork a project', 'Every project on forq runs. A fork is your own live copy.');
await r.open('/');
await r.say('forq: a git platform where every project runs, and every fork comes with its own agents.');
await r.tap('a.stretch[href="/p/forq/tipsplit"]');
await r.say('forq/tipsplit splits a restaurant bill. The app is running right on its page.');
await r.tap('#plus', { frame: '.preview iframe', after: 1200 });
await r.say('Fork it, and you get your own copy: its own page, live app and agents.');
await r.tap('#fork', { after: 400 });
await p.waitForURL(/\/p\/eyal\/tipsplit/, { timeout: 60_000 });
await r.sleep(1800);

await r.chapter('Ask for changes', 'Tell the router agent what you want, in plain words.');
await r.scroll('#ask', { offset: -80 });
await r.fill('#ask textarea', 'Two changes: a switch that rounds each person\'s share up to the next whole number, and a Copy button next to the per-person amount.');
await r.say('Two changes in one message. The router agent splits them into tasks.');
await r.tap('#ask .btn', { after: 1500 });
await r.say('Your message shows at once, with what the router agent is doing and for how long.');
await r.waitFor(async () => others(await info()).length >= 2, { speed: 8, label: 'router agent planning' });
await r.scroll('#agents', { offset: -12 });
await r.say('It started two agents, one per task, each on its own fork. The cards show your words and the task each agent got.');

await r.chapter('Agents work, a reviewer checks', 'Each push gets reviewed in a live preview before you merge.');
await r.scroll('#agents', { offset: -12, after: 300 });
for (let round = 0; round < 3; round++) {
  await r.waitFor(async () => { const a = others(await info()); return a.length >= 2 && a.every((x) => x.state === 'pushed' && ['approved', 'changes'].includes(x.review?.state)); },
    { speed: 16, label: round ? 'agents fixing, reviewer re-checking' : 'agents working, reviewer checking' });
  const a = others(await info());
  const needFix = a.filter((x) => x.review?.state === 'changes');
  if (!needFix.length) break;
  await r.scroll('#agents', { offset: -12, after: 400 });
  await r.say('The reviewer found a problem and wrote what to fix. One tap sends that to the agent.');
  for (const x of needFix) await r.tap(`[data-fix="${x.id}"]`, { after: 1200 });
}
await r.scroll('#agents', { offset: -12 });
await r.say('Both approved. The reviewer opened each preview at phone size before saying so.');
const first = others(await info())[0];
const short = first.id.split('--')[1];
await r.tap(`a[href$="/changes/${short}"]`, { after: 800 });
await p.waitForURL(/\/changes\//);
await r.sleep(1200);
await r.say('Changes: exactly what this agent wrote, line by line, against where it started.');
await r.scroll('.chg', { offset: -60, after: 2500 });
await p.goBack(); await p.waitForLoadState('networkidle').catch(() => {}); await r.sleep(800);
await r.scroll('.pbar', { offset: -12, after: 500 });
await r.tap(`.ptab[data-src*="${short}"]`, { after: 2500 });
await r.say('And its preview: the change running live, before anything is merged.');

await r.chapter('Merge', 'One tap per agent. The router agent does the git, conflicts included.');
const toMerge = others(await info());
for (const [i, x] of toMerge.entries()) {
  await r.scroll('#agents', { offset: -12, after: 400 });
  await r.tap(`[data-merge="${x.id}"]`, { after: 300 });
  await r.say(i === 0 ? 'Tap Merge. The router agent merges it into the main line, and the live app updates.'
    : 'If both agents edited the same file, the router agent resolves the conflict and keeps both changes.', { hold: 300 });
  await r.waitFor(async () => (await info()).agents.find((y) => y.id === x.id)?.state === 'merged', { speed: 6, label: 'router agent merging' });
}
await p.reload(); await p.waitForLoadState('networkidle').catch(() => {}); await r.sleep(1200);
await r.scroll('.pbar', { offset: -12, after: 600 });
await r.tap('.ptab[data-src$="eyal.tipsplit/"]', { after: 1500 });
await r.say('Merged. The live app now has both changes: the round-up switch and the Copy button.', { hold: 4500 });
await r.end({ title: 'forq', sub: 'A git platform for the age of agents · forq.kapps.dev' });
