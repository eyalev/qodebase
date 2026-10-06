// BuildBox — forq's own builder for Worker projects. One container per
// project (`<slug>--build`), separate from the agent boxes: the deploy token
// (CF_DEPLOY_TOKEN, Workers Scripts write only) is passed to one build command
// at a time and never reaches a box where Claude Code runs.
//
// A job: clone a repo at a commit, write a sanitized Wrangler config
// (forq-app-<slug>, workers.dev only, no routes, refuse bindings that need
// account resources), npm install if needed, then
//   deploy  → `wrangler deploy` (the project's live app, on its custom domain
//             <name>--<owner>.<APPS_DOMAIN> when set, plus workers.dev)
//   preview → `wrangler preview --name <alias>` (an agent fork; Previews get
//             their own Durable Object storage, so a preview never touches
//             the live app's data)
// Jobs queue in DO storage and run from alarm() (15 min wall time), so a build
// outlives the request that queued it. Results go back to the Project DO.

import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';
import { log } from './box';
import { pushAlert } from './alert';

export type BuildJob = {
  id: string;
  slug: string;
  kind: 'deploy' | 'preview' | 'install';
  repo: string;          // Artifacts repo to build
  remote: string;
  token: string;         // read token for that repo
  worker: string;        // forq-app-<slug>
  alias?: string;        // preview name (preview jobs)
  host?: string;         // custom domain (<name>--<owner>.<APPS_DOMAIN>); previews at <alias>.<host>
  agentId?: string;
  queuedAt: number;
  /** kind 'install': deploy a template's prebuilt release into a user's own
   *  account with their OAuth access token (src/install.ts). */
  install?: { owner: string; installId: string; accountId: string; cfToken: string; dir: string; vars: Record<string, string>; bucket?: { binding: string; name: string }; runWorker?: boolean };
};
/** A Worker app's host and its previews' hosts must not run forq's catch-all
 *  route on the apps domain (`*.<APPS_DOMAIN>/*`, the static run host): a
 *  route with no Worker on `<host>/*` and `*.<host>/*` hands them to the app's
 *  own custom domain. Idempotent: an existing route counts as done. */
export async function excludeFromRunRoute(env: Env, host: string) {
  if (!env.APPS_ZONE_ID) return;
  for (const pattern of [`${host}/*`, `*.${host}/*`]) {
    const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${env.APPS_ZONE_ID}/workers/routes`, {
      method: 'POST', headers: { authorization: `Bearer ${env.CF_DEPLOY_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ pattern }),
    }).catch((e) => ({ ok: false, status: 0, json: async () => ({ errors: [{ message: String(e) }] }) }) as any);
    const j = await r.json().catch(() => ({})) as { errors?: { code?: number; message?: string }[] };
    const dup = (j.errors || []).some((e) => e.code === 10020 || /duplicate|already exists/i.test(e.message || ''));
    log('build', r.ok || dup ? 'route_excluded' : 'route_exclude_failed', { pattern, status: r.status, errors: r.ok || dup ? undefined : j.errors });
  }
}

export type BuildResult = { id: string; kind: BuildJob['kind']; agentId?: string; ok: boolean; url?: string; commit?: string; error?: string; log: string; ms: number };

const WRANGLER = 'wrangler@4.146.0';
const INSTANCE = { vcpu: 1, memoryMib: 3072, diskMb: 8000 };
const IDLE_STOP_MS = 5 * 60_000;
const ENTRYPOINT = ['/bin/bash', '-c', 'chown 0:0 / 2>/dev/null; mkdir -p /build && exec sleep infinity'];

/** Writes forq.wrangler.json next to the project's own config. Node, run in the box. */
const SANITIZE = String.raw`
const fs = require('fs'), path = require('path');
const T = '/opt/forq-tools/node_modules/';
const toml = require(T + 'smol-toml'), jsonc = require(T + 'jsonc-parser');
const dir = process.argv[2], worker = process.argv[3], host = process.argv[4] || '';
const names = ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml'];
const found = names.find((n) => fs.existsSync(path.join(dir, n)));
if (!found) { console.error('FORQ_ERROR no wrangler.jsonc, wrangler.json or wrangler.toml at the repo root'); process.exit(3); }
const raw = fs.readFileSync(path.join(dir, found), 'utf8');
const c = found.endsWith('.toml') ? toml.parse(raw) : jsonc.parse(raw);
// Bindings that point at resources in someone else's account cannot be deployed here (yet).
const UNSUPPORTED = ['kv_namespaces', 'd1_databases', 'r2_buckets', 'queues', 'services', 'hyperdrive', 'vectorize',
  'analytics_engine_datasets', 'dispatch_namespaces', 'mtls_certificates', 'secrets_store_secrets', 'workflows', 'containers', 'send_email', 'pipelines'];
const bad = UNSUPPORTED.filter((k) => c[k] && (Array.isArray(c[k]) ? c[k].length : Object.keys(c[k]).length));
if (bad.length) { console.error('FORQ_ERROR needs ' + bad.join(', ') + ', which qodebase cannot create yet'); process.exit(4); }
const out = { ...c, name: worker, workers_dev: true, preview_urls: true };
for (const k of ['route', 'routes', 'env', 'account_id', 'tail_consumers', 'logpush', 'triggers']) delete out[k];
// Logs + Issues (Cloudflare's error grouping; forq's automation turns issues into agent work).
out.observability = { ...(c.observability || {}), enabled: true, issues: { enabled: true } };
// The app's own hostname on the apps domain; previews_enabled gives every preview
// <alias>.<host> (Cloudflare adds the wildcard record and certificate).
if (host) out.routes = [{ pattern: host, custom_domain: true, previews_enabled: true }];
// Previews: per-preview Durable Object namespaces (keep the bindings the code reads from env).
out.previews = { ...(c.previews || {}) };
if (c.durable_objects && c.durable_objects.bindings) out.previews.durable_objects = { bindings: c.durable_objects.bindings };
if (c.ai) out.previews.ai = c.ai;
fs.writeFileSync(path.join(dir, 'forq.wrangler.json'), JSON.stringify(out, null, 2));
console.log('FORQ_CONFIG from ' + found + ' -> forq.wrangler.json (' + worker + ')');
`;

export class BuildBox extends DurableObject<Env> {
  private get c() { return this.ctx.container as any; }

  async #sh(cmd: string, env: Record<string, string> = {}) {
    const p = await this.c.exec(['bash', '-c', cmd], { env });
    const o = await p.output();
    const dec = new TextDecoder();
    return { exitCode: o.exitCode as number, stdout: dec.decode(o.stdout), stderr: dec.decode(o.stderr) };
  }

  /** Queue a job and make sure the alarm will run it. */
  async enqueue(job: BuildJob) {
    const q = (await this.ctx.storage.get<BuildJob[]>('queue')) || [];
    // A newer job for the same target replaces a queued older one.
    const key = (j: BuildJob) => `${j.kind}:${j.agentId || j.install?.installId || ''}`;
    const next = q.filter((j) => key(j) !== key(job)).concat(job);
    await this.ctx.storage.put('queue', next);
    await this.ctx.storage.setAlarm(Date.now() + 100);
    log('build', 'queued', { slug: job.slug, kind: job.kind, agentId: job.agentId, depth: next.length });
  }

  async alarm() {
    const q = (await this.ctx.storage.get<BuildJob[]>('queue')) || [];
    const job = q.shift();
    if (!job) {
      // Nothing to do: stop the container once it has been idle a while.
      const last = (await this.ctx.storage.get<number>('lastBuild')) || 0;
      if (this.c.running && Date.now() - last > IDLE_STOP_MS) { await this.c.destroy().catch(() => {}); log('build', 'idle_stop', {}); }
      else if (this.c.running) await this.ctx.storage.setAlarm(Date.now() + 60_000);
      return;
    }
    await this.ctx.storage.put('queue', q);
    const result = await this.#run(job);
    await this.ctx.storage.put('lastBuild', Date.now());
    // A live app that failed to deploy needs a person; a fork's preview is the agent's to fix.
    if (job.install) {
      try { await this.env.Installs.get(this.env.Installs.idFromName(job.install.owner.toLowerCase())).buildDone(result); }
      catch (e) { log('build', 'report_failed', { install: job.install.installId, err: String(e) }); }
    } else {
      if (!result.ok && !result.agentId) await pushAlert(this.env, `forq: deploy failed, ${job.slug}`, (result.error || 'no error text').slice(0, 500), `https://${this.env.UI_HOST}/p/${job.slug.replace('.', '/')}`, 0);
      try { await this.env.Project.get(this.env.Project.idFromName(job.slug)).buildDone(result); }
      catch (e) { log('build', 'report_failed', { slug: job.slug, err: String(e) }); }
    }
    await this.ctx.storage.setAlarm(Date.now() + (q.length ? 100 : 60_000));
  }

  /** A container that answers. One that claims to run but does not (a Worker
   *  deploy killed it mid-build, seen 2026-10-01: "container connection is
   *  temporarily unavailable") is destroyed and started fresh, once. */
  async #ensureContainer(add: (s: string) => void) {
    if (this.c.running) {
      try { await this.#sh('true'); return; }
      catch (e) { add(`container not answering (${String(e).slice(0, 120)}), restarting it`); try { await this.c.destroy(); } catch {} }
    }
    this.c.start({ instance: INSTANCE, enableInternet: true, entrypoint: ENTRYPOINT, image: this.c.images.computer });
    await this.#sh('true');
    add('container started');
  }

  async #run(job: BuildJob): Promise<BuildResult> {
    const t0 = Date.now();
    const lines: string[] = [];
    const add = (s: string) => { for (const l of s.split('\n')) if (l.trim()) lines.push(l.replace(/\x1b\[[0-9;]*m/g, '')); };
    const done = (ok: boolean, extra: Partial<BuildResult> = {}): BuildResult => {
      const r = { id: job.id, kind: job.kind, agentId: job.agentId, ok, log: lines.slice(-150).join('\n'), ms: Date.now() - t0, ...extra };
      log('build', 'done', { slug: job.slug, kind: job.kind, agentId: job.agentId, ok, ms: r.ms, url: r.url, error: r.error });
      return r;
    };
    // A self-hosted copy has no deploy token and no builder image: Worker projects run
    // only as code there for now (static projects are served by run.ts without a build).
    if (!job.install && (!this.env.CF_DEPLOY_TOKEN || this.env.BOX_IMAGE === 'managed')) {
      add('This instance cannot deploy Worker projects yet (no deploy token).');
      return done(false, { error: 'Worker projects cannot be deployed on this instance yet' });
    }
    try {
      await this.#ensureContainer(add);
      // Tools once per container: TOML/JSONC parsers for the config rewrite.
      const tools = await this.#sh(`[ -d /opt/forq-tools/node_modules/smol-toml ] || (mkdir -p /opt/forq-tools && cd /opt/forq-tools && npm init -y >/dev/null && npm i --no-audit --no-fund smol-toml@1 jsonc-parser@3 2>&1 | tail -2); printf '%s' "$SANITIZE" > /opt/forq-tools/sanitize.js`, { SANITIZE });
      if (tools.exitCode !== 0) { add(tools.stdout + tools.stderr); return done(false, { error: 'could not install build tools' }); }

      const dir = `/build/${job.id}`;
      const clone = await this.#sh(`set -e; rm -rf "$D"; git -c http.extraHeader="Authorization: Bearer $TOK" clone -q --depth 1 "$REMOTE" "$D"; git -C "$D" log -1 --format='commit %H %s'`,
        { D: dir, TOK: job.token, REMOTE: job.remote });
      add(clone.stdout + clone.stderr);
      if (clone.exitCode !== 0) return done(false, { error: 'clone failed' });
      const commit = (clone.stdout.match(/commit ([0-9a-f]{40})/) || [])[1];
      if (job.install) { const [ok, extra] = await this.#install(job, dir, add); return done(ok, { commit, ...extra }); }

      const cfg = await this.#sh(`node /opt/forq-tools/sanitize.js "$D" "$W" "$H"`, { D: dir, W: job.worker, H: job.host || '' });
      add(cfg.stdout + cfg.stderr);
      if (cfg.exitCode !== 0) return done(false, { commit, error: (cfg.stderr.match(/FORQ_ERROR (.*)/) || [])[1] || 'config could not be read' });

      const install = await this.#sh(`cd "$D"; if [ -f package.json ] && node -e "const p=require('./package.json');process.exit(Object.keys({...p.dependencies,...p.devDependencies}).length?0:1)"; then
          (npm ci --no-audit --no-fund 2>&1 || npm install --no-audit --no-fund 2>&1) | tail -5; else echo "no dependencies to install"; fi`, { D: dir });
      add(install.stdout + install.stderr);
      if (install.exitCode !== 0) return done(false, { commit, error: 'npm install failed' });

      const cmd = job.kind === 'deploy'
        ? `npx -y ${WRANGLER} deploy --config forq.wrangler.json`
        : `npx -y ${WRANGLER} preview --config forq.wrangler.json --name "$ALIAS"`;
      const run = await this.#sh(`cd "$D"; ${cmd} 2>&1`, {
        D: dir, ALIAS: job.alias || '',
        CLOUDFLARE_API_TOKEN: this.env.CF_DEPLOY_TOKEN, CLOUDFLARE_ACCOUNT_ID: this.env.ACCOUNT_ID,
        WRANGLER_SEND_METRICS: 'false', CI: 'true', NO_COLOR: '1',
      });
      add(run.stdout + run.stderr);
      await this.#sh(`rm -rf "$D"`, { D: dir });
      if (run.exitCode !== 0) return done(false, { commit, error: job.kind === 'deploy' ? 'wrangler deploy failed' : 'wrangler preview failed' });
      // With a custom domain the app's address is that host (previews: <alias>.<host>);
      // workers.dev stays as a fallback address.
      const url = job.host
        ? (job.kind === 'deploy' ? `https://${job.host}` : `https://${job.alias}.${job.host}`)
        : job.kind === 'deploy'
          ? (run.stdout.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/) || [])[0]
          : (run.stdout.match(/Preview URL:\s*(https:\/\/\S+)/) || [])[1];
      return done(true, { commit, url });
    } catch (e) {
      add(String((e as Error)?.stack || e));
      return done(false, { error: String((e as Error)?.message || e) });
    }
  }

  /** Deploy <dir>/wrangler.base.json (a prebuilt, no_bundle release) as the
   *  user's Worker, with their access token. Never logs the token. */
  async #install(job: BuildJob, dir: string, add: (s: string) => void): Promise<[boolean, Partial<BuildResult>]> {
    const ins = job.install!;
    const cfgJs = `const fs=require('fs');const p=process.env.R+'/wrangler.base.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));
c.name=process.env.W;c.workers_dev=true;c.vars=Object.assign(c.vars||{},JSON.parse(process.env.V));
const b=JSON.parse(process.env.B||'null');if(b){c.r2_buckets=(c.r2_buckets||[]).filter(x=>x.binding!==b.binding).concat({binding:b.binding,bucket_name:b.name});}
fs.writeFileSync(process.env.R+'/wrangler.json',JSON.stringify(c));console.log('FORQ_INSTALL config for '+c.name);`;
    const root = `${dir}/${ins.dir}`;
    const cfg = await this.#sh(`node -e "$JS"`, { JS: cfgJs, R: root, W: job.worker, V: JSON.stringify(ins.vars), B: JSON.stringify(ins.bucket || null) });
    add(cfg.stdout + cfg.stderr);
    if (cfg.exitCode !== 0) return [false, { error: 'could not prepare the release' }];
    const wenv = { CLOUDFLARE_API_TOKEN: ins.cfToken, CLOUDFLARE_ACCOUNT_ID: ins.accountId, WRANGLER_SEND_METRICS: 'false', CI: 'true', NO_COLOR: '1' };
    const run = await this.#sh(`cd "$R"; npx -y ${WRANGLER} deploy --config wrangler.json 2>&1`, { R: root, ...wenv });
    add(run.stdout.replaceAll(ins.cfToken, '***'));
    const fail = (out: string) => {
      const why = (out.match(/✘ \[ERROR\] (.+)/) || out.match(/ERROR\]? (.+)/) || [])[1];
      return [false, { error: why ? why.slice(0, 300) : 'wrangler deploy failed' }] as [boolean, Partial<BuildResult>];
    };
    if (run.exitCode !== 0) { await this.#sh(`rm -rf "$D"`, { D: dir }); return fail(run.stdout); }
    const url = (run.stdout.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/) || [])[0];
    // qodebase's second Worker (<name>-run): its apps and its boxes' API calls, forwarded
    // to the main Worker over a service binding (release dir run/).
    if (ins.runWorker) {
      const runCfg = `const fs=require('fs');const p=process.env.R+'/run/wrangler.base.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));
c.name=process.env.W+'-run';c.workers_dev=true;c.services=[{binding:'MAIN',service:process.env.W}];
fs.writeFileSync(process.env.R+'/run/wrangler.json',JSON.stringify(c));console.log('FORQ_INSTALL config for '+c.name);`;
      const rc = await this.#sh(`node -e "$JS"`, { JS: runCfg, R: root, W: job.worker });
      add(rc.stdout + rc.stderr);
      const r2 = await this.#sh(`cd "$R/run"; npx -y ${WRANGLER} deploy --config wrangler.json 2>&1`, { R: root, ...wenv });
      add(r2.stdout.replaceAll(ins.cfToken, '***'));
      if (rc.exitCode !== 0 || r2.exitCode !== 0) { await this.#sh(`rm -rf "$D"`, { D: dir }); return fail(r2.stdout); }
    }
    await this.#sh(`rm -rf "$D"`, { D: dir });
    return [true, { url }];
  }

  async state() {
    return { running: !!this.ctx.container?.running, queue: ((await this.ctx.storage.get<BuildJob[]>('queue')) || []).map((j) => ({ kind: j.kind, agentId: j.agentId })), alarm: await this.ctx.storage.getAlarm() };
  }
}
