// Workflow 3: a production error in a deployed Worker becomes a reviewed fix,
// with no human in the loop until the merge.
import { rig, api } from '../rig.mjs';

const SLUG = 'eyal/workers-chat-demo-3';
const APP = 'https://forq-app-eyal-workers-chat-demo-3.<sub>.workers.dev';
const BAD = `${APP}/api/room/${'0'.repeat(64)}/websocket`;
const info = () => api(`/api/p/${SLUG}`);
const open = (j) => (j.agents || []).filter((a) => a.state !== 'merged' && a.state !== 'stopped');

const r = await rig({ name: 'w3-error-to-fix' });
const p = r.page;

await r.chapter('A live app breaks', 'This chat app runs as a Cloudflare Worker, deployed by forq.');
await r.open(`/p/${SLUG}`);
await r.say('A real chat app, built from Cloudflare\'s Durable Objects demo and deployed by forq to workers.dev.');
await r.scroll('.note.deploy', { offset: -12 });
await r.say('It has a real bug. A malformed room link crashes it.');
await r.open(BAD);
await r.say('HTTP 500, with the server\'s stack trace leaking into the page.', { hold: 4000 });
await p.reload(); await r.sleep(1500);

await r.chapter('Cloudflare notices', 'Cloudflare Issues groups the errors and calls forq.');
await r.open(`/p/${SLUG}`);
await r.scroll('.router', { offset: -12 });
await r.waitFor(async () => /Cloudflare Issues/.test((await info()).lastRequest?.text || ''), { speed: 6, label: 'Cloudflare Issues detecting', poll: 2000 });
await p.reload(); await r.sleep(1200); await r.scroll('.router', { offset: -12 });
await r.say('Nobody typed this. Cloudflare Issues sent the error, with the failing requests, to the router agent.', { hold: 5000 });
await r.waitFor(async () => open(await info()).length >= 1, { speed: 8, label: 'router agent reproducing the bug' });
await r.scroll('#agents', { offset: -12 });
await r.say('The router agent reproduced it with the same request, found the cause in the code, and started an agent to fix it.', { hold: 5000 });

await r.chapter('Fixed, previewed, reviewed', 'The fix runs as its own preview Worker before anyone merges it.');
await r.waitFor(async () => { const a = open(await info())[0]; return a && ['approved', 'changes'].includes(a.review?.state); }, { speed: 16, label: 'agent fixing, preview building, reviewer checking' });
let a = open(await info())[0];
if (a.review.state === 'changes') {
  await r.scroll('#agents', { offset: -12 });
  await r.tap(`[data-fix="${a.id}"]`, { after: 1000 });
  await r.waitFor(async () => { const x = open(await info())[0]; return x && x.state === 'pushed' && ['approved', 'changes'].includes(x.review?.state) && x.review.at > a.review.at; }, { speed: 16, label: 'agent fixing, reviewer re-checking' });
  a = open(await info())[0];
}
await p.reload(); await r.sleep(1000);
await r.scroll('#agents', { offset: -12 });
await r.say('Approved. The reviewer sent the same bad request to the preview and got a clean 404.', { hold: 5000 });

await r.chapter('Merged and redeployed', 'One tap. forq deploys the new version.');
await r.tap(`[data-merge="${a.id}"]`, { after: 800 });
const before = (await info()).app?.at || 0;
await r.waitFor(async () => { const j = await info(); return j.agents.find((x) => x.id === a.id)?.state === 'merged' && j.app?.status === 'live' && j.app.at > before; }, { speed: 6, label: 'merging and redeploying' });
// A fresh deploy takes a few seconds to reach every edge: film the fixed
// request only once it really answers 404 (the first take showed the old trace).
await r.waitFor(async () => (await fetch(BAD)).status === 404, { speed: 6, label: 'new version reaching the edge', poll: 2000 });
await p.reload(); await r.sleep(1000);
await r.scroll('.note.deploy', { offset: -12 });
await r.say('Live again, with the fix.');
await r.open(BAD);
await r.say('The same request now gets "Invalid room ID", a clean 404.', { hold: 4500 });
await r.end({ title: 'Errors that fix themselves', sub: 'Cloudflare Issues → forq → agents → review → deploy' });
