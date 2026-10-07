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

export type MergeChange = { id: string; title: string; intent: string; agent: string; fork: string; remote: string; token: string;
  base: string | null; commit: string | null; review: unknown };
export type MergeJob = { trainId: string; slug: string; mainRemote: string; mainToken: string; branch: string | null; check?: string | null; changes: MergeChange[]; tries?: number };
export type MergeResult = {
  trainId: string; ok: boolean; error?: string; ms?: number; log?: string;
  branch?: string; mainBefore?: string; mainAfter?: string; pushed?: boolean; stale?: boolean; notesPushed?: boolean; solo?: boolean;
  checks?: { ok: boolean; ms: number; failures: string[]; skipped?: boolean };
  changes: { id: string; landed: boolean; how: 'merged' | 'replayed-handler' | null; commit: string | null; files: string[]; conflicts: string[];
    unhandled: string[]; handled: { path: string; handler: string }[]; bounced: boolean; checks: { ok: boolean; failures: string[] } | null; why: string;
    diff: { path: string; lines: string[] }[] | null }[];
};

// git, node --test, an occasional npm install. Billed while awake only. Custom sizes need
// at least 3 GiB per vCPU: 1 vCPU / 2 GiB was refused without an error and exec() kept
// saying the container was not running (2026-10-07).
const INSTANCE = { vcpu: 1, memoryMib: 3072, diskMb: 8000 };
const IDLE_STOP_MS = 5 * 60_000;
const MERGER_V = '2026-10-07c';   // shown by landing/state: which code a merger box runs
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
    q.push(job);
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

  async #ensureContainer() {
    if (this.c.running) {
      try { await this.#sh('true'); return; } catch { try { await this.c.destroy(); } catch {} }
    }
    const t0 = Date.now();
    try { this.c.start({ instance: INSTANCE, enableInternet: true, entrypoint: ENTRYPOINT, image: this.c.images.computer }); }
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
    log('merger', 'container_started', { ms: Date.now() - t0 });
  }

  async #run(job: MergeJob): Promise<MergeResult> {
    const t0 = Date.now();
    try {
      await this.#ensureContainer();
      await this.#sh(`mkdir -p /opt/qb && printf '%s' "$JS" > /opt/qb/mergejob.mjs`, { JS: MERGEJOB });
      const spec = { dir: `/m/${job.slug}`, mainRemote: job.mainRemote, mainToken: job.mainToken, branch: job.branch, check: job.check ?? null, changes: job.changes };
      const r = await this.#sh('node /opt/qb/mergejob.mjs 2>&1', { JOB: JSON.stringify(spec), HOME: '/root' });
      const line = r.stdout.split('\n').find((l) => l.startsWith('QB_RESULT '));
      const progress = r.stdout.split('\n').filter((l) => l && !l.startsWith('QB_RESULT ')).slice(-60).join('\n');
      // Tokens never reach the log: the job prints none, but be sure.
      const clean = (s: string) => [job.mainToken, ...job.changes.map((c) => c.token)].reduce((a, t) => a.replaceAll(t.split('?')[0], '***'), s);
      if (!line) { log('merger', 'no_result', { train: job.trainId, exit: r.exitCode, tail: clean(progress).slice(-800) }); return { trainId: job.trainId, ok: false, error: 'the merge job printed no result', log: clean(progress), changes: [] }; }
      const out = JSON.parse(line.slice(10));
      log('merger', 'train_done', { slug: job.slug, train: job.trainId, ok: out.ok, pushed: out.pushed, stale: out.stale, notes: out.notesPushed, solo: out.solo, ms: Date.now() - t0,
        changes: (out.changes || []).map((c: any) => ({ id: c.id, landed: c.landed, how: c.how, conflicts: c.conflicts, bounced: c.bounced, why: c.why })) });
      return { trainId: job.trainId, ...out, changes: out.changes || [], log: clean(progress) };
    } catch (e) {
      log('merger', 'error', { train: job.trainId, err: String((e as Error)?.stack || e).slice(0, 600) });
      return { trainId: job.trainId, ok: false, error: String((e as Error)?.message || e), log: String((e as Error)?.stack || e).slice(0, 2000), changes: [], ms: Date.now() - t0 };
    }
  }

  async state() {
    return { code: MERGER_V, instance: INSTANCE, containerEvents: await this.ctx.storage.get('containerEvents'), running: !!this.ctx.container?.running, queue: ((await this.ctx.storage.get<MergeJob[]>('queue')) || []).map((j) => j.trainId),
      busy: (await this.ctx.storage.get<MergeJob>('running'))?.trainId || null, last: await this.ctx.storage.get('last'), alarm: await this.ctx.storage.getAlarm() };
  }
}
