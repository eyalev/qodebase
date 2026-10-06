#!/usr/bin/env node
// qb — the qodebase command line, for people and for agents.
// One file, no dependencies, Node 18+. Served at <host>/cli/qb.mjs; install with
//   curl -fsSL https://qodebase.app/cli/install.sh | sh
// Works against the hosted qodebase or your own copy (--host / QB_HOST).
// Output is JSON when stdout is not a terminal, or with --json.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';

const VERSION = '0.4.2';
const DEFAULT_HOST = 'https://qodebase.app';
const CONFIG = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'qodebase', 'config.json');

const HELP = `qb ${VERSION} — qodebase from the command line

  qb login                         sign in (approve a code on your phone; any
                                   command does this by itself when needed)
  qb logout | whoami | tokens | revoke <id>

  qb ls [--mine] [--owner <h>]     projects
  qb info <owner/name>             a project and its agents
  qb open <owner/name>             its page and live app URLs
  qb new "<what to build>" [--name n]   start a project; agents build it
  qb import <github url|owner/repo>     copy a public GitHub repo in
  qb fork <owner/name>             your own copy
  qb clone <owner/name> [dir]      git clone (stays signed in through qb)

  qb ask <owner/name> "<request>"  the router splits it into tasks, one agent each
  qb spawn <owner/name> "<task>"   one agent on its own fork
  qb agents <owner/name>           agents and their states
  qb send <agent-id> "<text>"      message an agent
  qb chat <agent-id>               an agent's conversation
  qb merge <owner/name> <agent-id> merge an agent's fork into main
  qb install <agent> [--name n] [--account id]
                                   your own AI assistant in YOUR Cloudflare account
                                   (agents-starter, openclaw, pi, t3code, claudecode, hermes)
  qb installs                      what you installed, and the agents you can install
  qb uninstall <name> [--yes]      delete an assistant: its Worker, its data, its lock
  qb files <owner/name>            file list of main
  qb search <owner/name> "<text>"  search main's code

Options: --host <url> (or QB_HOST), --json, --token <qb_…> (or QB_TOKEN).
More for agents: <host>/llms.txt`;

// ---- args, config ----------------------------------------------------------
const argv = process.argv.slice(2);
const flags = {};
const args = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--json' || a === '--mine' || a === '--yes' || a === '-h' || a === '--help') flags[a.replace(/^-+/, '')] = true;
  else if (a.startsWith('--')) flags[a.slice(2)] = argv[++i];
  else args.push(a);
}
const loadConfig = () => { try { return JSON.parse(readFileSync(CONFIG, 'utf8')); } catch { return { hosts: {} }; } };
const saveConfig = (c) => { mkdirSync(join(CONFIG, '..'), { recursive: true, mode: 0o700 }); writeFileSync(CONFIG, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 }); };
const config = loadConfig();
const HOST = (flags.host || process.env.QB_HOST || config.default || DEFAULT_HOST).replace(/\/+$/, '');
let TOKEN = flags.token || process.env.QB_TOKEN || config.hosts?.[HOST]?.token || null;
const JSON_OUT = flags.json || !process.stdout.isTTY;

const die = (msg, code = 1) => {
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: msg }));
  else console.error(`qb: ${msg}`);
  process.exit(code);
};
const out = (data, human) => {
  if (JSON_OUT || !human) console.log(JSON.stringify(data, null, JSON_OUT && !process.stdout.isTTY ? 0 : 2));
  else console.log(human(data));
};

async function api(method, path, body, { auth = true, okStatus = [] } = {}) {
  // No token yet: sign in first (one approval on the phone), then carry on with the command.
  if (auth && !TOKEN) await deviceLogin();
  let r;
  try {
    r = await fetch(HOST + path, {
      method, redirect: 'manual',
      headers: { 'content-type': 'application/json', 'user-agent': `qb/${VERSION}`, accept: 'application/json', ...(auth && TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) { die(`cannot reach ${HOST}: ${e.cause?.code || e.message}`); }
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 300) }; }
  if (r.status === 401 && auth) die(`${HOST} refused the token (revoked or expired?). Run: qb login`);
  if (!r.ok && !okStatus.includes(r.status)) die(data.error || `${method} ${path} failed (${r.status})`);
  return { status: r.status, data };
}

/** Device sign-in: print a link + code, wait for the approval, save and use the token. */
async function deviceLogin() {
  const { data: s } = await api('POST', '/api/cli/start', { label: `qb on ${hostname()}` }, { auth: false });
  if (JSON_OUT) console.error(JSON.stringify({ needs: 'qb_login', user_code: s.user_code, verification_uri_complete: s.verification_uri_complete }));
  else console.log(`Sign in to ${HOST}: open ${s.verification_uri_complete}\nand check the code: ${s.user_code}\n\nWaiting for approval…`);
  const until = Date.now() + s.expires_in * 1000;
  while (Date.now() < until) {
    await sleep(s.interval * 1000);
    const { status, data } = await api('POST', '/api/cli/token', { device_code: s.device_code }, { auth: false, okStatus: [428, 410] });
    if (status === 428) continue;
    if (status === 410) die(data.error || 'the code expired; run qb login again');
    const c = loadConfig();
    c.hosts = c.hosts || {};
    c.hosts[HOST] = { token: data.token, handle: data.handle, at: new Date().toISOString() };
    if (!c.default || flags.host) c.default = HOST;
    saveConfig(c);
    TOKEN = data.token;
    if (!JSON_OUT) console.log(`Signed in as ${data.handle}.\n`);
    return data;
  }
  die('the code expired; run qb login again');
}

const project = (s) => {
  const m = String(s || '').match(/^(?:https?:\/\/[^/]+\/p\/)?([a-z0-9-]+)\/([a-z0-9-]+)\/?$/);
  if (!m) die(`expected owner/name, got "${s ?? ''}"`);
  return { owner: m[1], name: m[2], path: `/api/p/${m[1]}/${m[2]}` };
};
const need = (v, usage) => { if (!v) die(`usage: qb ${usage}`); return v; };
const ago = (t) => { if (!t) return ''; const s = (Date.now() - t) / 1000; return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- commands ----------------------------------------------------------------
const cmds = {
  async login() {
    const d = await deviceLogin();
    out({ ok: true, host: HOST, handle: d.handle }, (x) => `Signed in to ${x.host} as ${x.handle}.`);
  },
  async logout() {
    const c = loadConfig();
    const had = !!c.hosts?.[HOST];
    if (had) { delete c.hosts[HOST]; if (c.default === HOST) delete c.default; saveConfig(c); }
    out({ ok: true, host: HOST, removed: had }, () => had ? `Signed out of ${HOST} on this computer. The token still works until you revoke it (qb tokens, before logging out, or Settings).` : `Not signed in to ${HOST}.`);
  },
  async whoami() {
    const { data } = await api('GET', '/api/cli/me');
    out({ host: HOST, ...data }, (d) => `${d.handle} (${d.email}) on ${d.host}`);
  },
  async tokens() {
    const { data } = await api('GET', '/api/cli/tokens');
    out(data, (d) => d.tokens.map((t) => `${t.id}  ${t.label.padEnd(24)} created ${ago(t.createdAt)}, used ${ago(t.usedAt)}`).join('\n') || 'No tokens.');
  },
  async revoke(id) {
    const { data } = await api('POST', '/api/cli/revoke', { id: need(id, 'revoke <id>') });
    out(data, (d) => d.ok ? `Revoked ${id}.` : `No token ${id}.`);
  },

  async ls() {
    const q = flags.owner ? `?owner=${encodeURIComponent(flags.owner)}` : flags.mine ? '?mine=1' : '';
    const { data } = await api('GET', `/api/projects${q}`, undefined, { auth: !!TOKEN || !!flags.mine });
    out(data.projects, (ps) => ps.map((p) => `${(p.owner + '/' + p.name).padEnd(32)} ${ago(p.updatedAt).padEnd(12)} ${p.description || ''}`).join('\n') || 'No projects.');
  },
  async info(ref) {
    const p = project(need(ref, 'info <owner/name>'));
    const { data } = await api('GET', p.path, undefined, { auth: !!TOKEN });
    out(data, (d) => [`${d.owner}/${d.name}${d.forkedFrom ? `  (fork of ${d.forkedFrom.replace('.', '/')})` : ''}`, d.description || '', `${HOST}/p/${d.owner}/${d.name}`,
      ...(d.agents || []).filter((a) => a.state !== 'stopped').map((a) => `  ${a.id.padEnd(28)} ${String(a.state).padEnd(8)} ${(a.task || '').split('\n')[0].slice(0, 70)}`)].filter(Boolean).join('\n'));
  },
  async open(ref) {
    const p = project(need(ref, 'open <owner/name>'));
    const { data } = await api('GET', `/api/projects?owner=${p.owner}`, undefined, { auth: !!TOKEN });
    const e = data.projects.find((x) => x.name === p.name) || die(`no project ${p.owner}/${p.name}`);
    out({ page: `${HOST}${e.path}`, live: e.live, code: `${HOST}${e.path}/code` }, (d) => `page  ${d.page}\nlive  ${d.live}\ncode  ${d.code}`);
  },
  async new(prompt) {
    const { data } = await api('POST', '/api/build', { prompt: need(prompt, 'new "<what to build>" [--name n]'), name: flags.name });
    out({ ...data, url: `${HOST}${data.path}` }, (d) => `Started ${d.slug.replace('.', '/')}. Agents are building it: ${d.url}`);
  },
  async import(repo) {
    const { data } = await api('POST', '/api/import', { repo: need(repo, 'import <github url|owner/repo>') });
    out({ ...data, url: `${HOST}${data.path}` }, (d) => `Imported as ${d.owner}/${d.name}: ${d.url}`);
  },
  async fork(ref) {
    const p = project(need(ref, 'fork <owner/name>'));
    const { data } = await api('POST', `${p.path}/fork`);
    out({ ...data, url: `${HOST}${data.path}` }, (d) => `Forked to ${d.owner}/${d.name}: ${d.url}`);
  },
  async clone(ref, dir) {
    const p = project(need(ref, 'clone <owner/name> [dir]'));
    const { data } = await api('POST', `${p.path}/git-token`);
    const target = dir || p.name;
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
    const auth = `Authorization: Basic ${Buffer.from(`x:${data.token.split('?expires=')[0]}`).toString('base64')}`;
    const r = spawnSync('git', ['-c', `http.extraHeader=${auth}`, 'clone', data.remote, target], { stdio: JSON_OUT ? ['ignore', 'ignore', 'inherit'] : 'inherit', env });
    if (r.status !== 0) die('git clone failed');
    // Later fetches and pushes ask qb for a fresh token (they live an hour).
    const self = process.argv[1];
    execFileSync('git', ['-C', target, 'config', 'credential.helper', `!${JSON.stringify(process.execPath)} ${JSON.stringify(self)} git-credential ${p.owner}/${p.name} --host ${HOST}`]);
    out({ ok: true, dir: target, remote: data.remote, write: data.write }, (d) => `Cloned into ${d.dir} (${d.write ? 'you can push: it is yours' : 'read-only: fork it to push'}).`);
  },
  // git's credential helper protocol (set up by qb clone).
  async 'git-credential'(ref, op) {
    if (op !== 'get') return;
    const p = project(ref);
    const { data } = await api('POST', `${p.path}/git-token`);
    process.stdout.write(`username=x\npassword=${data.token.split('?expires=')[0]}\n`);
  },

  async ask(ref, text) {
    const p = project(need(ref, 'ask <owner/name> "<request>"'));
    const { data } = await api('POST', `${p.path}/router`, { text: need(text, 'ask <owner/name> "<request>"') });
    out(data, () => `Sent to the router of ${p.owner}/${p.name}. Follow it: qb agents ${p.owner}/${p.name}`);
  },
  async spawn(ref, task) {
    const p = project(need(ref, 'spawn <owner/name> "<task>"'));
    const { data } = await api('POST', `${p.path}/agents`, { task: need(task, 'spawn <owner/name> "<task>"') });
    out(data, (d) => d.error ? `Could not start: ${d.error}` : `Started ${d.id}. Follow it: qb chat ${d.id}`);
  },
  async agents(ref) {
    const p = project(need(ref, 'agents <owner/name>'));
    const { data } = await api('GET', p.path, undefined, { auth: !!TOKEN });
    const list = (data.agents || []).map(({ id, state, task, review, createdAt }) => ({ id, state, task, review: review?.state || null, createdAt }));
    out(list, (l) => l.map((a) => `${a.id.padEnd(28)} ${String(a.state).padEnd(8)} ${a.review ? `[${a.review}] ` : ''}${(a.task || '').split('\n')[0].slice(0, 70)}`).join('\n') || 'No agents yet.');
  },
  async send(id, text) {
    const { data } = await api('POST', `/api/agents/${need(id, 'send <agent-id> "<text>"')}/send`, { text: need(text, 'send <agent-id> "<text>"') });
    out(data, (d) => d.ok === false ? `Not sent: ${d.error}` : 'Sent.');
  },
  async chat(id) {
    const { data } = await api('GET', `/api/agents/${need(id, 'chat <agent-id>')}/conversation`);
    out(data, (d) => d.asleep ? 'The agent is asleep (nothing loaded). qb send wakes it.' : (d.messages || []).filter((m) => (m.type === 'user' || m.type === 'assistant_text' || m.type === 'recap' || m.type === 'question_prompt') && String(m.text || '').trim()).map((m) => `${m.type === 'user' ? '›' : '•'} ${String(m.text).trim()}`).join('\n\n') || 'No messages yet.');
  },
  async merge(ref, id) {
    const p = project(need(ref, 'merge <owner/name> <agent-id>'));
    const { data } = await api('POST', `${p.path}/merge`, { agent: need(id, 'merge <owner/name> <agent-id>') });
    out(data, () => `Asked the router to merge ${id}. qb agents ${p.owner}/${p.name} shows when it is merged.`);
  },
  async files(ref) {
    const p = project(need(ref, 'files <owner/name>'));
    const { data } = await api('GET', `${p.path}/files`, undefined, { auth: !!TOKEN });
    out(data, (d) => d.files.join('\n') + (d.truncated ? '\n…(truncated)' : ''));
  },
  async search(ref, q) {
    const p = project(need(ref, 'search <owner/name> "<text>"'));
    const { data } = await api('GET', `${p.path}/search?q=${encodeURIComponent(need(q, 'search <owner/name> "<text>"'))}`, undefined, { auth: !!TOKEN });
    out(data, (d) => (d.results || []).flatMap((r) => r.lines.map((l) => `${r.path}:${l.n}  ${l.text.trim().slice(0, 120)}`)).join('\n') || 'No matches.');
  },
  async installs() {
    const { data } = await api('GET', '/api/installs');
    out(data, (d) => [
      d.connected ? `Cloudflare: connected (${d.accounts.map((a) => a.name).join(', ')})` : 'Cloudflare: not connected yet (qb install asks once)',
      '', 'Installed:', ...(d.installs.length ? d.installs.map((i) => `  ${i.name.padEnd(18)} ${i.title.padEnd(18)} ${i.removed ? 'removed (its Worker is gone; qb uninstall forgets it)' : i.url ? i.url + (i.runningOlder ? '  (last update failed; the previous version runs)' : '') : i.error ? `stopped: ${i.error}` : 'installing'}`) : ['  nothing yet']),
      '', 'qb install with an existing name updates that assistant in place (its data stays).',
      '', 'Can install:', ...d.templates.map((t) => `  ${t.id.padEnd(16)} ${t.title}${t.needsPaidPlan ? '  (Cloudflare $5/mo Workers Paid plan)' : '  (Cloudflare free plan)'}`),
    ].join('\n'));
  },
  async uninstall(name) {
    need(name, 'uninstall <name> [--account id] [--yes]');
    if (!flags.yes) {
      if (!process.stdin.isTTY || JSON_OUT) die('this deletes the assistant and its data; add --yes to confirm');
      const { createInterface } = await import('node:readline/promises');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const typed = (await rl.question(`This deletes ${name}, everything it stored, and its Cloudflare Access lock.\nType the name to confirm: `)).trim();
      rl.close();
      if (typed !== name) die('not deleted');
    }
    const { data } = await api('DELETE', '/api/installs', { name, account: flags.account });
    out(data, (d) => `Deleted ${name}${d.worker ? '' : ' (its Worker was already gone)'}${d.accessApps ? ', its lock' : ''}${d.buckets?.length ? `, its storage (${d.buckets.join(', ')})` : ''}.`);
  },
  async install(template) {
    need(template, 'install <agent> [--name n] [--account id]   (qb installs lists them)');
    const body = { template, name: flags.name, account: flags.account };
    let r = await api('POST', '/api/installs', body, { okStatus: [409] });
    if (r.status === 409) {
      // One browser step: let qodebase into the person's Cloudflare account.
      if (JSON_OUT) console.error(JSON.stringify({ needs: 'cloudflare', approve_url: r.data.approve_url }));
      else console.log(`First, let qodebase install into your Cloudflare account (once):\n${r.data.approve_url}\n\nWaiting…`);
      const until = Date.now() + 15 * 60_000;
      while (r.status === 409 && Date.now() < until) { await sleep(4000); r = await api('POST', '/api/installs', body, { okStatus: [409] }); }
      if (r.status === 409) die('Cloudflare was not connected within 15 minutes; run qb install again');
    }
    const { id, page, status } = r.data;
    if (!JSON_OUT) console.log(`Installing (${page})`);
    let last = '';
    for (;;) {
      await sleep(2500);
      const { data: v } = await api('GET', new URL(status).pathname);
      const doing = v.steps.find((s) => s.state === 'doing');
      const line = doing ? `${doing.label}${doing.note ? ` (${doing.note})` : ''}` : '';
      if (!JSON_OUT && line && line !== last) { console.log(`  ${line}`); last = line; }
      if (v.url) return out({ ok: true, id, name: v.name, url: v.url, page }, (d) => `Ready: ${d.url}\nIt is locked to you: the first visit asks you to sign in. Choose Cloudflare (quick if this browser is signed in to the Cloudflare dashboard) or get a code by email.`);
      if (v.error) die(`${v.error}${v.fix ? ` (${v.fix.text}: ${v.fix.href})` : ''}`);
    }
  },
  help() { console.log(HELP); },
  version() { out({ version: VERSION }, (d) => d.version); },
};

const [cmd, ...rest] = args;
if (!cmd || flags.h || flags.help || cmd === 'help') cmds.help();
else if (!cmds[cmd]) die(`unknown command "${cmd}". Try: qb help`);
else await cmds[cmd](...rest);
