// MergeBox — the merger box: one small container per project (`<slug>--merge`, same
// forq-box image as the builder: git + Node), separate from the agent boxes. It keeps a
// clone of main while awake and runs mergejob.mjs for each train the Landing DO hands it:
// apply each change to the latest main (git apply --3way + tier-1 handlers), run the
// project's checks, write the records as git notes, push once.
//
// Same pattern as BuildBox: jobs queue in storage and run from alarm(), a job interrupted
// by a restart runs again (twice at most), results are kept and reported back to Landing.
// Idle stop after 5 minutes without a train.

import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import { log } from '../box';
import MERGEJOB from './mergejob.mjs';
import { MANAGED_IMAGE } from '../box';

export type MergeChange = { id: string; title: string; intent: string; agent: string; fork: string; remote: string; token: string;
  base: string | null; commit: string | null; review: unknown };
export type MergeJob = { trainId: string; enqueuedAt?: number; slug: string; mainRemote: string; mainToken: string; branch: string | null; check?: string | null; changes: MergeChange[]; tries?: number;
  /** Tier 2: replay conflicting changes with this model (on the owner's Claude subscription). */
  llm?: { model: string; via?: 'gateway' };
  /** Lab policies github/ffa: no tier-1 handlers (plain git); ffa also skips the checks. */
  handlers?: boolean; noChecks?: boolean };
export type LlmUse = { model: string; ms: number; turns: number | null; usd: number | null; in: number | null; out: number | null; cacheRead: number | null; cacheWrite: number | null; cacheWrite1h?: number | null; sameLines?: boolean; error?: string };
export type MergeResult = {
  trainId: string; ok: boolean; error?: string; ms?: number; log?: string;
  branch?: string; mainBefore?: string; mainAfter?: string; pushed?: boolean; stale?: boolean; notesPushed?: boolean; solo?: boolean;
  checks?: { ok: boolean; ms: number; failures: string[]; skipped?: boolean };
  changes: { id: string; landed: boolean; how: 'merged' | 'replayed-handler' | 'replayed-llm' | null; commit: string | null; files: string[]; conflicts: string[];
    unhandled: string[]; handled: { path: string; handler: string }[]; bounced: boolean; empty?: boolean; checks: { ok: boolean; failures: string[] } | null; why: string; llm?: LlmUse | null;
    /** Model replays: the diff that was reviewed (on the older code), next to `diff` (what landed). */
    reviewedDiff?: { path: string; lines: string[] }[] | null;
    diff: { path: string; lines: string[] }[] | null }[];
  /** Timeline (T1): [phase, start ms, end ms, change id?]: the box's own (wait in the box's queue, wake = container
   *  start, cold or warm, upload) then the merge job's (fetch-main, fetch-forks, apply/replay per change, checks, notes, push). */
  phases?: [string, number, number, string?][];
  cold?: boolean;
  /** Each fetch's own ms (main, notes, every fork) and how they ran. */
  fetchMs?: { main: number; notes: number; forks: number[]; prefetched?: number; warm: boolean; shallow: boolean; parallel: boolean };
};

// git, node --test, an occasional npm install. Billed while awake only. Custom sizes need
// at least 3 GiB per vCPU: 1 vCPU / 2 GiB was refused without an error and exec() kept
// saying the container was not running (2026-10-07).
const INSTANCE = { vcpu: 1, memoryMib: 3072, diskMb: 6144 };   // disk <= 2x memory: Cloudflare refuses more (seen 2026-10-08 16:53)
const IDLE_STOP_MS = 5 * 60_000;
const MERGER_V = '2026-10-12t';   // shown by landing/state: which code a merger box runs
const ENTRYPOINT = ['/bin/bash', '-c', 'chown 0:0 / 2>/dev/null; mkdir -p /m /opt/qb && exec sleep infinity'];

export class MergeBox extends DurableObject<Env> {
  private get c() { return this.ctx.container as any; }

  async #sh(cmd: string, env: Record<string, string> = {}) {
    const p = await this.c.exec(['bash', '-c', cmd], { env });
    const o = await p.output();
    const dec = new TextDecoder();
    return { exitCode: o.exitCode as number, stdout: dec.decode(o.stdout), stderr: dec.decode(o.stderr) };
  }

  async enqueue(job: MergeJob) {
    const q = (await this.ctx.storage.get<MergeJob[]>('queue')) || [];
    q.push({ ...job, enqueuedAt: Date.now() });
    await this.ctx.storage.put('queue', q);
    await this.ctx.storage.setAlarm(Date.now() + 100);
    log('merger', 'queued', { slug: job.slug, train: job.trainId, changes: job.changes.length, depth: q.length });
  }

  async alarm() {
    const q = (await this.ctx.storage.get<MergeJob[]>('queue')) || [];
    const stale = await this.ctx.storage.get<MergeJob>('running');
    if (stale) {
      await this.ctx.storage.delete('running');
      if ((stale.tries || 0) < 2) { q.unshift({ ...stale, tries: (stale.tries || 0) + 1 }); log('merger', 'resumed', { train: stale.trainId, tries: (stale.tries || 0) + 1 }); }
      else await this.#report(stale.slug, { trainId: stale.trainId, ok: false, error: 'the merger was interrupted three times', changes: [] });
    }
    const job = q.shift();
    if (!job) {
      const last = (await this.ctx.storage.get<number>('lastJob')) || 0;
      if (this.c.running && Date.now() - last > IDLE_STOP_MS) { await this.c.destroy().catch(() => {}); log('merger', 'idle_stop', {}); }
      else if (this.c.running) await this.ctx.storage.setAlarm(Date.now() + 60_000);
      return;
    }
    await this.ctx.storage.put({ queue: q, running: job });
    const result = await this.#run(job);
    await this.ctx.storage.delete('running');
    await this.ctx.storage.put('lastJob', Date.now());
    if (!result.ok && /Network connection lost|temporarily unavailable/i.test(result.error || '') && (job.tries || 0) < 2) {
      q.unshift({ ...job, tries: (job.tries || 0) + 1 });
      await this.ctx.storage.put('queue', q);
      await this.ctx.storage.setAlarm(Date.now() + 5_000);
      return;
    }
    await this.#report(job.slug, result);
    await this.ctx.storage.setAlarm(Date.now() + (q.length ? 100 : 60_000));
  }

  async #report(slug: string, r: MergeResult) {
    await this.ctx.storage.put('last', { ...r, at: Date.now() });
    try { await this.env.Landing.get(this.env.Landing.idFromName(slug)).trainDone(r); }
    catch (e) { log('merger', 'report_failed', { slug, train: r.trainId, err: String(e) }); }
  }

  /** Returns true when the container had to be started (a cold start). */
  async #ensureContainer(): Promise<boolean> {
    if (this.c.running) {
      try { await this.#sh('true'); return false; } catch { try { await this.c.destroy(); } catch {} }
    }
    const t0 = Date.now();
    // A self-hosted copy (BOX_IMAGE=managed) has no registry image: Cloudflare's managed Debian image, git added below.
    const managed = this.env.BOX_IMAGE === 'managed';
    try { this.c.start({ instance: INSTANCE, enableInternet: true, entrypoint: ENTRYPOINT, image: managed ? MANAGED_IMAGE : this.c.images.computer }); }
    catch (e) { log('merger', 'start_threw', { err: String(e), stack: String((e as Error)?.stack || ''), running: !!this.c.running, image: !!this.c.images?.computer }); throw e; }
    // Why a container stopped or never started shows up only here.
    const note = (event: string, err?: unknown) => { log('merger', event, { err: err === undefined ? undefined : String(err).slice(0, 400) });
      this.ctx.storage.put('containerEvents', [{ at: Date.now(), event, err: err === undefined ? null : String(err).slice(0, 400) }]).catch(() => {}); };
    try { this.c.monitor().then(() => note('container_exited'), (e: unknown) => note('container_failed', e)); } catch (e) { note('monitor_threw', e); }
    // A fresh start can refuse exec for a while ("The container has not been started":
    // every train failed that way for the first minute after MergeBox was first deployed,
    // 2026-10-07). Keep asking for up to 90 s, then give up with the last error.
    for (let i = 0; ; i++) {
      try { await this.#sh('true'); break; }
      catch (e) {
        if (i === 0 || i % 10 === 9) log('merger', 'container_not_ready', { tries: i + 1, ms: Date.now() - t0, err: String(e).slice(0, 200), running: !!this.c.running });
        if (Date.now() - t0 > 90_000) throw e;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    if (managed) {
      // The managed image has Node but not git (mergejob.mjs needs both): installed once per container start.
      const g = await this.#sh('command -v git >/dev/null || { apt-get update -qq && apt-get install -y -qq --no-install-recommends git ca-certificates >/dev/null; }; git --version; node --version');
      log('merger', 'managed_setup', { exit: g.exitCode, out: g.stdout.trim().slice(0, 120), err: g.stderr.slice(-300), ms: Date.now() - t0 });
      if (g.exitCode !== 0) throw new Error(`merger setup failed: ${g.stderr.slice(-200)}`);
    }
    log('merger', 'container_started', { ms: Date.now() - t0, managed });
    return true;
  }

  async #run(job: MergeJob): Promise<MergeResult> {
    const t0 = Date.now();
    const ph: [string, number, number, string?][] = [];
    if (job.enqueuedAt && t0 - job.enqueuedAt > 50) ph.push(['box-queue', job.enqueuedAt, t0]);
    let cold = false;
    try {
      cold = await this.#ensureContainer();
      ph.push([cold ? 'wake-cold' : 'wake', t0, Date.now()]);
      const tU = Date.now();
      await this.#sh(`mkdir -p /opt/qb && printf '%s' "$JS" > /opt/qb/mergejob.mjs`, { JS: MERGEJOB });
      ph.push(['upload', tU, Date.now()]);
      const spec = { trainId: job.trainId, dir: `/m/${job.slug}`, mainRemote: job.mainRemote, mainToken: job.mainToken, branch: job.branch, check: job.check ?? null, changes: job.changes, llm: job.llm || null, handlers: job.handlers !== false, noChecks: !!job.noChecks };
      // The Claude token only reaches the box for a tier-2 replay, as its own variable (never in JOB, never logged).
      // Replays through forq's AI Gateway when the Landing chose it (flag replayVia: 'gateway' + the REPLAY_GATEWAY_TOKEN secret):
      // billed to Cloudflare unified-billing credits, never the plan. Otherwise the owner's plan, as before.
      const gw = job.llm?.via === 'gateway' && this.env.REPLAY_GATEWAY_TOKEN;
      const r = await this.#sh('node /opt/qb/mergejob.mjs 2>&1', { JOB: JSON.stringify(spec), HOME: '/root', ...(job.llm ? (gw ? { QB_GW_URL: `https://gateway.ai.cloudflare.com/v1/${this.env.ACCOUNT_ID}/${this.env.REPLAY_GATEWAY || 'qodebase-replay'}/anthropic`, QB_GW_TOKEN: String(this.env.REPLAY_GATEWAY_TOKEN) } : { QB_CLAUDE_TOKEN: this.env.CLAUDE_CODE_OAUTH_TOKEN }) : {}) });
      const line = r.stdout.split('\n').find((l) => l.startsWith('QB_RESULT '));
      const progress = r.stdout.split('\n').filter((l) => l && !l.startsWith('QB_RESULT ')).slice(-60).join('\n');
      // Tokens never reach the log: the job prints none, but be sure.
      const clean = (s: string) => [job.mainToken, ...job.changes.map((c) => c.token), ...(job.llm ? [this.env.CLAUDE_CODE_OAUTH_TOKEN, this.env.REPLAY_GATEWAY_TOKEN || ''] : [])].filter(Boolean).reduce((a, t) => a.replaceAll(t.split('?')[0], '***'), s);
      if (!line) { log('merger', 'no_result', { train: job.trainId, exit: r.exitCode, tail: clean(progress).slice(-800) }); return { trainId: job.trainId, ok: false, error: 'the merge job printed no result', log: clean(progress), changes: [], cold, phases: ph }; }
      const out = JSON.parse(line.slice(10));
      log('merger', 'train_done', { slug: job.slug, train: job.trainId, ok: out.ok, pushed: out.pushed, stale: out.stale, notes: out.notesPushed, solo: out.solo, ms: Date.now() - t0,
        changes: (out.changes || []).map((c: any) => ({ id: c.id, landed: c.landed, how: c.how, conflicts: c.conflicts, bounced: c.bounced, why: c.why })) });
      return { trainId: job.trainId, ...out, changes: out.changes || [], log: clean(progress), cold, phases: [...ph, ...(out.phases || [])] };
    } catch (e) {
      log('merger', 'error', { train: job.trainId, err: String((e as Error)?.stack || e).slice(0, 600) });
      return { trainId: job.trainId, ok: false, error: String((e as Error)?.message || e), log: String((e as Error)?.stack || e).slice(0, 2000), changes: [], ms: Date.now() - t0, cold, phases: ph };
    }
  }

  /** Fork prefetch (T1 finding, 2026-10-12: fetching each agent's fork at train time was 1.6-4 s, ~60% of a train):
   *  while a change waits in the queue, fetch its approved commit into the warm clone, into a ref of its own
   *  (refs/qb/p/<id>), never into a working tree. Only when the box is awake and already has the project's clone
   *  (waking a box for this would cost more than it saves). Tokens: one read token per fork, passed as env, never logged.
   *  At train time mergejob.mjs finds the commit already there and skips the network for that change. */
  /** B-3: start the container ahead of the first train (a Build warms it); the idle stop applies as after a job. */
  async warm() {
    const t = Date.now();
    const cold = await this.#ensureContainer();
    await this.ctx.storage.put('lastJob', Date.now());
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 60_000);
    log('merger', 'warmed', { cold, ms: Date.now() - t });
    return { cold, ms: Date.now() - t };
  }

  async prefetch(slug: string, items: { id: string; remote: string; token: string; commit: string }[]) {
    if (!this.c.running || !items.length) return { skipped: 'asleep' };
    const dir = `/m/${slug}`, env: Record<string, string> = { D: dir };
    const lines: string[] = [];
    items.slice(0, 8).forEach((it, i) => {
      env[`R${i}`] = it.remote; env[`A${i}`] = btoa(`x:${it.token.split('?')[0]}`); env[`C${i}`] = it.commit; env[`I${i}`] = it.id.replace(/[^\w.-]/g, '_');
      lines.push(`( git -C "$D" cat-file -e "$C${i}^{commit}" 2>/dev/null || git -C "$D" -c gc.auto=0 -c http.extraHeader="Authorization: Basic $A${i}" fetch -q --no-tags --no-write-fetch-head "$R${i}" "+HEAD:refs/qb/p/$I${i}" ) &`);
    });
    const t0 = Date.now();
    try {
      const r = await this.#sh(`[ -d "$D/.git" ] || { echo cold; exit 0; }\n${lines.join('\n')}\nwait\necho done`, env);
      const out = { ok: r.exitCode === 0, cold: r.stdout.includes('cold'), ms: Date.now() - t0, n: items.length };
      log('merger', 'prefetch', { slug, ...out, ids: items.map((x) => x.id) });
      return out;
    } catch (e) { log('merger', 'prefetch_failed', { slug, err: String(e).slice(0, 200) }); return { ok: false }; }
  }

  async restart(): Promise<void> { await this.c.destroy().catch(() => {}); this.ctx.abort('restart on the deployed code'); }

  async state() {
    return { code: MERGER_V, version: this.env.CF_VERSION_METADATA?.id || null, instance: INSTANCE, containerEvents: await this.ctx.storage.get('containerEvents'), running: !!this.ctx.container?.running, queue: ((await this.ctx.storage.get<MergeJob[]>('queue')) || []).map((j) => j.trainId),
      busy: (await this.ctx.storage.get<MergeJob>('running'))?.trainId || null, last: await this.ctx.storage.get('last'), alarm: await this.ctx.storage.getAlarm() };
  }
}
