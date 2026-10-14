// Workflow 5: sign up and add your Anthropic API key (a new user, maya).
import { rig, api } from '../rig.mjs';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
const EMAIL = 'maya@forq-demo.kapps.dev';
// A fresh demo user (no projects, no key).
for (const s of ['maya.timer']) await api('/api/admin/delete', { method: 'POST', body: { repo: s, project: s } });
await api('/api/p/forq/timer', { asEmail: EMAIL, headers: {} });
await fetch(`${process.env.FORQ_API || 'https://forq.forqdev.workers.dev'}/api/p/forq/timer`, { headers: { 'x-forq-secret': readFileSync(homedir() + '/.config/forq/admin-secret', 'utf8').trim(), 'x-forq-as-email': EMAIL, 'x-forq-create-handle': 'maya' } });
await api('/api/me/key', { method: 'DELETE', asEmail: EMAIL });

const r = await rig({ name: 'w5-signup', email: null });
const p = r.page;
await r.chapter('Sign up', 'Read anything without an account. Sign in to fork and run agents.');
await r.open('/');
await r.say('Anyone can browse forq. To fork and run agents, sign in.');
await r.tap('a[href="/login"]', { after: 2500 });
await r.say('Sign-in is Cloudflare Access: enter your email, get a one-time code. No password.', { hold: 4500 });
await r.signInAs(EMAIL);
await r.open('/settings?welcome=1');
await r.say('Signed in. Pick the name your projects live under.');
await r.chapter('Bring your own API key', 'Agents run Claude Code with your key. You pay Anthropic directly.');
await r.scroll('#keyf', { offset: -160 });
await r.say('Paste your Anthropic API key. forq checks every key with Anthropic before saving it. First, a wrong one.');
await r.fill('#keyf input', 'sk-ant-api03-this-is-not-a-real-key-000000000000000000');
await r.tap('#keyf .btn', { after: 1200 });
await r.say('Refused, with Anthropic\'s own answer. Now a real key.');
await r.fill('#keyf input', readFileSync(process.env.QB_DEMO_ANTHROPIC_KEY_FILE, 'utf8').trim());
await r.tap('#keyf .btn', { after: 3500 });
await r.scroll('h2:nth-of-type(2)', { offset: -12 });
await r.say('Saved, encrypted. Only its last four characters are ever shown. Agents use Sonnet by default: about $1–2 per reviewed change.', { hold: 6000 });
await r.chapter('Fork and go', 'Your key is in. Every fork you make can run agents.');
await r.say('Pick any project and fork it.', { hold: 1800 });
await r.open('/p/forq/timer');
await r.sleep(1200);
await r.tap('#fork', { after: 600 });
await p.waitForURL(/\/p\/maya\/timer/, { timeout: 60000 });
await r.sleep(1500);
await r.scroll('#ask', { offset: -80 });
await r.say('Your own fork, ready for agents.', { hold: 3500 });
await r.end({ title: 'Your key, your agents', sub: 'forq.kapps.dev' });
// The real key was only for the check: remove it.
await api('/api/me/key', { method: 'DELETE', asEmail: EMAIL });
