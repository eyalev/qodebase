// DemoAgent — a SCRIPTED agent for demo mode (no model, no container): one Durable Object
// per agent (`<slug>#<n>`). It takes the next task of the demo script (demoproject.ts) from
// the Landing DO, forks main in Artifacts (or the fork it is stacked on), "works" for a
// while, makes the task's edits on its fork's real files and pushes a real commit over
// git's smart-HTTP protocol (sim/cloud/src/gitpush.js). From there the change goes through
// the real record, review (scripted), merge queue and merger box like any other.
// When its change bounces it pushes the task's fix; when it needs the lead, the scripted
// lead redoes the task's intent on a fresh fork of the latest main.
// Labelled "scripted agents" everywhere it shows. Hard caps live in landing.ts.

import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import { log } from '../box';
import { applyEdits, taskByKey, type Edit, type Task } from './demoproject';
import { Objects, push } from '../../sim/cloud/src/gitpush.js';

type Job = { kind: 'task' | 'fix' | 'redo'; changeId: string; key: string; fork: string; remote: string; base: string | null; until: number; stage: 'work' | 'review' };
type St = { slug: string; n: number; speed: number; runId: number; stopped: boolean; job: Job | null };

const TASK = { get: (key: string) => taskByKey(key) };   // the story's tasks and busy mode's generated ones
const enc = new TextEncoder();

export class DemoAgent extends DurableObject<Env> {
  async #st() { return (await this.ctx.storage.get<St>('st')) || null; }
  /** A stop lives in its own key: an alarm step that was running when stop() came would
   *  otherwise save its copy of the state over it (stray agents, 2026-10-08). */
  async #save(s: St) { if (await this.ctx.storage.get<boolean>('stopped')) s.stopped = true; await this.ctx.storage.put('st', s); }
  #landing(slug: string) { return this.env.Landing.get(this.env.Landing.idFromName(slug)); }
  #name(s: St) { return `scripted agent ${s.n}`; }

  async start(slug: string, n: number, speed: number, runId: number) {
    await this.ctx.storage.delete('stopped');
    await this.#save({ slug, n, speed, runId, stopped: false, job: null });
    // Staggered: agents start a couple of seconds apart, like people picking up work.
    await this.ctx.storage.setAlarm(Date.now() + 800 + n * 1800 / speed);
  }
  /** For landing/state: what this agent is doing, its next alarm, its last error. */
  async peek() { return { st: await this.#st(), alarm: await this.ctx.storage.getAlarm() }; }

  async stop() {
    await this.ctx.storage.put('stopped', true);
    const s = await this.#st(); if (!s) return;
    s.stopped = true; await this.#save(s); await this.ctx.storage.deleteAlarm();
  }
  /** Landing: a change of mine bounced or needs the lead. Only wakes the agent sooner:
   *  the chore itself comes from Landing.demoNext (never written here, see there). */
  async nudge(_changeId: string, _state: 'bounced' | 'with-lead') {
    const s = await this.#st(); if (!s || s.stopped || s.job) return;
    await this.ctx.storage.setAlarm(Date.now() + 1500 / s.speed);
  }

  async alarm() {
    const s = await this.#st();
    if (!s || s.stopped || (await this.ctx.storage.get<boolean>('stopped'))) return;
    (s as any).lastAlarm = Date.now();
    const L = this.#landing(s.slug);
    const d = await L.demoState();
    if (!d.running || d.startedAt !== s.runId) { s.stopped = true; await this.#save(s); return; }
    try {
      if (s.job) await this.#advance(s);
      else await this.#next(s);
    } catch (e) {
      log('demo', 'agent_error', { slug: s.slug, n: s.n, job: s.job?.changeId, err: String((e as Error)?.stack || e).slice(0, 500) });
      (s as any).lastError = { at: Date.now(), err: String((e as Error)?.stack || e).slice(0, 800) };
      // Try again shortly; a job that keeps failing is dropped after the record says so.
      if (s.job) { (s.job as any).fails = ((s.job as any).fails || 0) + 1; if ((s.job as any).fails > 3) s.job = null; }
      await this.#save(s);
      await this.ctx.storage.setAlarm(Date.now() + 5000);
      return;
    }
    await this.#save(s);
    if (s.stopped) return;
    // Always come back: for the job's next step, a fix or redo, or the next task (a stacked
    // task becomes ready only once its base pushed). Bounded by the demo's 20-minute cap:
    // the first alarm after the demo stops ends the agent. (Without this, every agent went
    // idle after its first change, 2026-10-07.)
    if (s.job) await this.ctx.storage.setAlarm(Math.max(Date.now() + 500, s.job.until));
    else await this.ctx.storage.setAlarm(Date.now() + 3000 / s.speed);
  }

  /** Pick up a fix or redo first, else the next task of the script. */
  async #next(s: St) {
    const L = this.#landing(s.slug);
    const pick = await L.demoNext(s.n, s.runId);
    if (!pick) return;
    if (pick.stop) { s.stopped = true; log('demo', 'agent_stale_stopped', { slug: s.slug, n: s.n, runId: s.runId }); return; }
    const p = pick.chore ? { changeId: pick.id!, kind: pick.chore } : null;
    if (p) {
      const c = await L.change(p.changeId);
      if (!c || !c.task) return;
      const task = TASK.get(c.task)!;
      if (p.kind === 'fix') {
        if (!task.fix) return;   // nothing scripted: the change stays bounced
        s.job = { kind: 'fix', changeId: c.id, key: task.key, fork: c.fork, remote: c.remote, base: c.base, until: Date.now() + this.#dur(s, 0.5, task), stage: 'work' };
        await L.note(c.id, 'working', task.fixNote || 'fixing it');
      } else {
        // The scripted lead: a fresh fork of today's main, the same intent redone on it.
        const project = await this.env.Project.get(this.env.Project.idFromName(s.slug)).info();
        using main = await this.env.ARTIFACTS.get(project!.repo);
        const head = (await main.log({ limit: 1 }))[0];
        const name = `${c.id}l${Math.random().toString(36).slice(2, 4)}`;
        const f = await this.#fork(main, name, `lead redo: ${task.title}`);
        await L.rebase(c.id, f.name, f.remote, head.hash);
        s.job = { kind: 'redo', changeId: c.id, key: task.key, fork: f.name, remote: f.remote, base: head.hash, until: Date.now() + this.#dur(s, 0.5, task), stage: 'work' };
        await L.note(c.id, 'working', 'the scripted lead is redoing it on the latest code');
      }
      return;
    }
    const task = TASK.get(pick.key)!;
    const id = `${s.slug}--d${s.n}${Math.random().toString(36).slice(2, 6)}`;
    let fork: { name: string; remote: string }, base: string | null;
    if (pick.stackOn) {
      // Stacked: start from the other change's fork, at the commit it pushed.
      using parent = await this.env.ARTIFACTS.get(pick.stackOn.fork);
      fork = await this.#fork(parent, id, task.title);
      base = pick.stackOn.commit;
    } else {
      const project = await this.env.Project.get(this.env.Project.idFromName(s.slug)).info();
      using main = await this.env.ARTIFACTS.get(project!.repo);
      base = (await main.log({ limit: 1 }))[0]?.hash || null;
      fork = await this.#fork(main, id, task.title);
    }
    await L.record(s.slug, { id, title: task.title, intent: task.intent, agent: this.#name(s), kind: 'demo', fork: fork.name, remote: fork.remote, base,
      claims: task.claims, stackedOn: pick.stackOn?.id || null, task: task.key }, s.runId);
    s.job = { kind: 'task', changeId: id, key: task.key, fork: fork.name, remote: fork.remote, base, until: Date.now() + this.#dur(s, 1, task), stage: 'work' };
    log('demo', 'task_started', { slug: s.slug, n: s.n, id, task: task.key, stackedOn: pick.stackOn?.id });
  }

  #dur(s: St, k: number, t: Task) { return ((t.workS ? t.workS * (0.6 + Math.random() * 0.8) : 18 + Math.random() * 22) * k * 1000) / s.speed; }

  async #fork(repo: ArtifactsRepo, name: string, description: string) {
    for (let i = 0; ; i++) {
      try { const f = await repo.fork(name, { description: description.slice(0, 200), defaultBranchOnly: true }); return { name: f.name, remote: f.remote }; }
      catch (e) { if (i >= 3) throw e; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
    }
  }

  async #advance(s: St) {
    const j = s.job!;
    if (Date.now() < j.until) return;
    const L = this.#landing(s.slug);
    if (j.stage === 'work') {
      const task = TASK.get(j.key)!;
      const edits = j.kind === 'fix' ? task.fix! : task.edits;
      const r = await this.#commit(j.fork, j.remote, edits, s, j.kind === 'fix' ? `Fix: ${task.fixNote || task.title}` : task.title, task.intent);
      await L.pushed(j.changeId, r.commit, r.files, j.kind === 'fix' ? `fixed: ${task.fixNote}` : j.kind === 'redo' ? 'redone on the latest code' : undefined);
      await L.reviewing(j.changeId);
      j.stage = 'review'; j.until = Date.now() + 5000 / s.speed;
      return;
    }
    // Scripted review: approve and send to the queue (the lead's redo is approved by the lead).
    await L.reviewed(j.changeId, j.kind === 'redo' ? 'approved' : 'auto', j.kind === 'redo' ? 'redone by the scripted lead on the latest code' : '', true);
    s.job = null;
  }

  /** Make `edits` on the fork's files and push one commit. Returns the commit and changed paths. */
  async #commit(forkName: string, remote: string, edits: Edit[], s: St, title: string, intent: string) {
    using repo = await this.env.ARTIFACTS.get(forkName);
    const head = (await repo.log({ limit: 1 }))[0];
    if (!head) throw new Error('empty fork');
    // Every path -> blob hash of the fork's head (the demo project is small).
    const snap = new Map<string, string>();
    const walk = async (hash: string, prefix: string): Promise<void> => {
      const entries = (await repo.readTree(hash)) || [];
      await Promise.all(entries.map((e) => (e.type === 'tree' ? walk(e.hash, `${prefix}${e.name}/`) : (snap.set(prefix + e.name, e.hash), Promise.resolve()))));
    };
    await walk(head.treeHash, '');
    const files = new Map<string, string>();
    for (const p of new Set(edits.map((e) => e.path))) {
      const h = snap.get(p);
      if (h) { const b = await repo.readBlob(h); if (b) files.set(p, await b.text()); }
    }
    const changed = applyEdits(files, edits);
    const objs = new Objects();
    for (const p of changed) snap.set(p, objs.blob(files.get(p)!));
    const tree = objs.tree(snap);
    const when = Math.floor(Date.now() / 1000);
    const who = `${this.#name(s)} <agent-${s.n}@demo.qodebase.app> ${when} +0000`;
    const commit = objs.put('commit', enc.encode([`tree ${tree}`, `parent ${head.hash}`, `author ${who}`, `committer ${who}`, '',
      `${title}\n\n${intent}\n\n(scripted agent: qodebase demo mode, no model)`, ''].join('\n')));
    const token = (await repo.createToken('write', 600)).plaintext;
    const r = await push({ remote, token, branch: 'main', oldSha: head.hash, newSha: commit, objs: [...objs.map.values()] });
    if (!r.ok) throw new Error(`push to ${forkName} failed: ${r.status} ${r.detail}`);
    log('demo', 'pushed', { fork: forkName, commit: commit.slice(0, 8), files: changed, bytes: r.bytes });
    return { commit, files: changed };
  }
}

/** A brand-new demo project's first commit, or a reset: a commit whose tree is SEED. */
export async function pushSeed(remote: string, token: string, files: Record<string, string>, parent: string | null, message: string) {
  const objs = new Objects();
  const snap = new Map<string, string>();
  for (const [p, t] of Object.entries(files)) snap.set(p, objs.blob(t));
  const tree = objs.tree(snap);
  const when = Math.floor(Date.now() / 1000);
  const who = `qodebase demo <demo@qodebase.app> ${when} +0000`;
  const commit = objs.put('commit', enc.encode([`tree ${tree}`, ...(parent ? [`parent ${parent}`] : []), `author ${who}`, `committer ${who}`, '', message, ''].join('\n')));
  const r = await push({ remote, token, branch: 'main', oldSha: parent || '0'.repeat(40), newSha: commit, objs: [...objs.map.values()] });
  if (!r.ok) throw new Error(`seed push failed: ${r.status} ${r.detail}`);
  return commit;
}
