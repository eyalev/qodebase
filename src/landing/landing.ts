// Landing — one per project (idFromName(slug)): how changes get onto main.
//
//   change RECORD  intent + agent + fork + base + claims, then push, review, landing;
//                  an events log in plain words. Kept as git notes on landed commits.
//   MERGE QUEUE    approved changes wait; the alarm forms a train (stacks in order) and
//                  hands it to the MergeBox (`<slug>--merge`), which applies each change
//                  to the latest main, runs the checks and pushes once (mergejob.mjs).
//   LAND BY INTENT tier 1 in the box (deterministic handlers for shared files); tier 2
//                  (LLM replay, per-project flag, off) and tier 3 (the lead) from here.
//   CLAIMS         expected files declared at spawn; overlaps are warned on both changes.
//   STACKING       a change can start from another's fork; it lands after it.
//
// Separate from the Project DO on purpose: the 2 s poll of the landing view and the
// queue's alarm never contend with the Project DO's review and delivery alarm.
// GET /api/p/<o>/<n>/landing serves `view()`, the qb6/qb7 contract (docs/contest/PLAN.md).

import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import { log } from '../box';
import type { MergeJob, MergeResult } from './merger';
import { TASKS } from './demoproject';

export type What = 'asked' | 'claimed' | 'working' | 'pushed' | 'reviewing' | 'approved' | 'changes-suggested' | 'queued' | 'testing'
  | 'landed' | 'bounced' | 'conflict' | 'replaying' | 'replayed' | 'with-lead' | 'stacked' | 'overlap';
export type Ev = { t: number; what: What; detail?: string };
export type ChangeState = 'working' | 'pushed' | 'reviewing' | 'queued' | 'testing' | 'landed' | 'bounced' | 'replaying' | 'with-lead';
export type Landing_ = { how: 'merged' | 'replayed-handler' | 'replayed-llm' | 'lead' | null; conflicts: string[]; diff: { path: string; lines: string[] }[]; commit: string | null; mainCommit: string | null };
export type Change = {
  id: string; title: string; intent: string; agent: string; kind: 'agent' | 'demo';
  fork: string; remote: string; base: string | null; commit: string | null;
  state: ChangeState; files: string[]; claims: string[]; needs: string[]; provides: string[]; stackedOn: string | null;
  events: Ev[]; review: { verdict: 'approved' | 'changes' | 'auto'; notes: string } | null;
  landing: Landing_ | null; lead: string | null;
  createdAt: number; landedAt: number | null; queuedAt?: number; tries: number;
  /** tier 3 / redo: the next landing of this change is a lead's (or LLM's) replay. */
  redo?: 'lead' | 'llm';
  task?: string;       // demo: the script's task key (demoproject.ts)
  choreTaken?: string; // demo: the fix/redo for this state was handed out ('bounced@<tries>' / 'with-lead@<tries>')
};
export type Train = { id: string; state: 'testing' | 'landed' | 'bounced'; changes: string[]; startedAt: number; endedAt: number | null;
  checks: { ok: boolean; ms: number; failures: string[] } | null; mainBefore: string | null; mainAfter: string | null; note?: string;
  /** What happened to each change in this train (set when the merger reports). */
  outcomes?: Record<string, 'landed' | 'bounced' | 'conflict' | 'retry'> };
type Demo = { running: boolean; agents: number; speed: number; startedAt: number; endsAt: number; stoppedAt?: number;
  /** story = the café's 14 tasks; busy = an endless stream of small colliding changes. */
  mode?: 'story' | 'busy' };
type Meta = {
  slug: string; waiting: string[]; running: string | null; runningSince?: number;
  flags: { llmReplay: boolean }; demo: Demo | null;
  tree?: { commit: string; files: string[]; at: number };
  order: string[];   // change ids, oldest first (capped)
  trains: string[];
  demoTaken?: Record<string, string>;   // demo task key -> change id ('pending:<ms>' while forking)
  demoForks?: string[];                 // every fork a scripted agent made (deleted on reset)
  failStreak?: number;
  demoBusyNext?: number;                // busy mode: the next generated task's index
  landings?: [number, number][];        // [landedAt, ask-to-land s] of the last 2000 landings: stats outlive pruned records                  // trains in a row the merger could not run: back off
};

const TRAIN_MAX = 8;
const KEEP_CHANGES = 150, KEEP_TRAINS = 40, EVENTS_PER_CHANGE = 40;
const TRAIN_STUCK_MS = 12 * 60_000;
export const DEMO_MAX_AGENTS = 24, DEMO_MAX_MS = 20 * 60_000, DEMO_MAX_STORY_AGENTS = 12, BUSY_MAX_TASKS = 400;
const OPEN = (c: Change) => c.state !== 'landed';

export class Landing extends DurableObject<Env> {
  #meta: Meta | null = null;

  async #m(slug?: string): Promise<Meta> {
    if (!this.#meta) this.#meta = (await this.ctx.storage.get<Meta>('meta')) || null;
    if (!this.#meta) {
      if (!slug) throw new Error('landing: no project yet');
      this.#meta = { slug, waiting: [], running: null, flags: { llmReplay: false }, demo: null, order: [], trains: [] };
      await this.ctx.storage.put('meta', this.#meta);
    }
    return this.#meta;
  }
  async #saveMeta() { await this.ctx.storage.put('meta', this.#meta!); }
  async #get(id: string) { return (await this.ctx.storage.get<Change>(`c:${id}`)) || null; }
  async #put(c: Change) {
    if (c.events.length > EVENTS_PER_CHANGE) c.events = c.events.slice(-EVENTS_PER_CHANGE);
    await this.ctx.storage.put(`c:${c.id}`, c);
  }
  #ev(c: Change, what: What, detail?: string) { c.events.push({ t: Date.now(), what, ...(detail ? { detail: detail.slice(0, 300) } : {}) }); }
  async #all(): Promise<Change[]> {
    const m = await this.#m();
    const got = await this.ctx.storage.get<Change>(m.order.map((id) => `c:${id}`));
    return m.order.map((id) => got.get(`c:${id}`)).filter(Boolean) as Change[];
  }

  // ---- the record --------------------------------------------------------------
  /** A new change: at spawn (real agents) or when a scripted agent picks a task. */
  async record(slug: string, c: Pick<Change, 'id' | 'title' | 'intent' | 'agent' | 'kind' | 'fork' | 'remote' | 'base'> & Partial<Pick<Change, 'claims' | 'needs' | 'provides' | 'stackedOn' | 'task'>>) {
    const m = await this.#m(slug);
    const ch: Change = { ...c, title: (c.title || c.intent.split('\n')[0]).slice(0, 60), intent: c.intent.slice(0, 4000), commit: null, state: 'working',
      files: [], claims: c.claims || [], needs: c.needs || [], provides: c.provides || [], stackedOn: c.stackedOn || null,
      events: [], review: null, landing: null, lead: null, createdAt: Date.now(), landedAt: null, tries: 0 };
    this.#ev(ch, 'asked', ch.title);
    if (ch.stackedOn) this.#ev(ch, 'stacked', `on ${ch.stackedOn}`);
    if (ch.claims.length) this.#ev(ch, 'claimed', ch.claims.join(', '));
    this.#ev(ch, 'working');
    m.order.push(ch.id);
    if (ch.task) m.demoTaken = { ...(m.demoTaken || {}), [ch.task]: ch.id };
    if (ch.kind === 'demo') m.demoForks = [...(m.demoForks || []), ch.fork];
    await this.#overlaps(ch, ch.claims);
    await this.#put(ch);
    await this.#prune();
    await this.#saveMeta();
    log('landing', 'recorded', { slug, id: ch.id, kind: ch.kind, claims: ch.claims.length, stackedOn: ch.stackedOn });
    return ch;
  }

  /** Warn both changes when this one's files or claims overlap another open change's. */
  async #overlaps(ch: Change, paths: string[]) {
    if (!paths.length) return;
    for (const o of await this.#all()) {
      if (o.id === ch.id || !OPEN(o) || o.id === ch.stackedOn || o.stackedOn === ch.id) continue;
      const theirs = new Set([...o.claims, ...o.files]);
      const shared = paths.filter((p) => theirs.has(p));
      if (!shared.length) continue;
      const already = ch.events.some((e) => e.what === 'overlap' && e.detail?.includes(o.id));
      if (already) continue;
      this.#ev(ch, 'overlap', `${shared.slice(0, 3).join(', ')} with ${o.id}`);
      this.#ev(o, 'overlap', `${shared.slice(0, 3).join(', ')} with ${ch.id}`);
      await this.#put(o);
    }
  }

  /** The agent pushed (its fork's head). Files = what it changed since its base. */
  async pushed(id: string, commit: string, files: string[], note?: string) {
    const c = await this.#get(id);
    if (!c) throw new Error('unknown change');
    c.commit = commit; c.files = files.slice(0, 200);
    if (c.state === 'bounced' || c.state === 'with-lead' || c.state === 'working' || c.state === 'replaying') c.state = 'pushed';
    this.#ev(c, 'pushed', note || `${files.length} file${files.length === 1 ? '' : 's'}`);
    await this.#overlaps(c, c.files);
    await this.#put(c);
    return c;
  }

  async reviewing(id: string) {
    const c = await this.#get(id); if (!c) return;
    c.state = 'reviewing'; this.#ev(c, 'reviewing'); await this.#put(c);
  }

  /** A verdict. 'auto' = the scripted demo review; approved demo changes queue at once. */
  async reviewed(id: string, verdict: 'approved' | 'changes' | 'auto', notes = '', thenQueue = false) {
    const c = await this.#get(id); if (!c) return;
    c.review = { verdict, notes: notes.slice(0, 2000) };
    if (verdict === 'changes') { c.state = 'pushed'; this.#ev(c, 'changes-suggested', notes.split('\n')[0]); }
    else { this.#ev(c, 'approved', verdict === 'auto' ? 'scripted review' : notes.split('\n')[0]); if (c.state === 'reviewing') c.state = 'pushed'; }
    await this.#put(c);
    if (thenQueue && verdict !== 'changes') await this.approve(id);
  }

  // ---- the queue ---------------------------------------------------------------
  /** The merge tap: approved → waits for the next train. */
  async approve(id: string) {
    const m = await this.#m();
    const c = await this.#get(id);
    if (!c) throw new Error('unknown change');
    if (!c.commit) throw new Error('nothing pushed yet');
    if (c.state === 'landed') return c;
    if (!m.waiting.includes(id)) m.waiting.push(id);
    c.state = 'queued'; c.queuedAt = Date.now();
    this.#ev(c, 'queued', m.waiting.length > 1 ? `${m.waiting.length - 1} ahead` : 'next train');
    await this.#put(c);
    await this.#saveMeta();
    await this.#arm(m.failStreak ? Math.min(300_000, 5000 * 2 ** (m.failStreak - 1)) : 300);
    return c;
  }

  async #arm(ms: number) {
    const now = await this.ctx.storage.getAlarm();
    if (!now || now > Date.now() + ms) await this.ctx.storage.setAlarm(Date.now() + ms);
  }

  async alarm() {
    const m = await this.#m();
    log('landing', 'alarm', { slug: m.slug, running: m.running, waiting: m.waiting.length, failStreak: m.failStreak || 0 });
    try {
      if (m.running) {
        // A train lost to a restart (the box reports back; if it never does, run it again).
        if (Date.now() - (m.runningSince || 0) > TRAIN_STUCK_MS) await this.#trainLost('no result from the merger box in 12 min');
        else { await this.#arm(30_000); return; }
      }
      await this.#startTrain();
    } finally {
      await this.#demoTick();
    }
  }

  /** Which waiting changes can go now: stacked ones only after their base. */
  async #pick(): Promise<Change[]> {
    const m = await this.#m();
    const out: Change[] = [];
    for (const id of m.waiting) {
      if (out.length >= TRAIN_MAX) break;
      const c = await this.#get(id);
      if (!c || c.state !== 'queued') continue;
      if (c.stackedOn) {
        const base = await this.#get(c.stackedOn);
        if (base && base.state !== 'landed' && !out.some((x) => x.id === base.id)) continue;
      }
      out.push(c);
    }
    return out;
  }

  async #startTrain() {
    const m = await this.#m();
    m.waiting = (await Promise.all(m.waiting.map((id) => this.#get(id)))).filter((c) => c && c.state === 'queued').map((c) => c!.id);
    const picked = await this.#pick();
    if (!picked.length) { await this.#saveMeta(); return; }
    const project = await this.env.Project.get(this.env.Project.idFromName(m.slug)).info();
    if (!project) throw new Error('no such project');
    using main = await this.env.ARTIFACTS.get(project.repo);
    const mainToken = (await main.createToken('write', 1800)).plaintext;
    const train: Train = { id: `t${Date.now().toString(36)}`, state: 'testing', changes: picked.map((c) => c.id), startedAt: Date.now(), endedAt: null, checks: null, mainBefore: null, mainAfter: null };
    const job: MergeJob = { trainId: train.id, slug: m.slug, mainRemote: project.remote, mainToken, branch: project.importedFrom?.branch || null, changes: [] };
    for (const c of picked) {
      using fork = await this.env.ARTIFACTS.get(c.fork);
      // A stacked change's base is its parent's pushed commit; once the parent landed as a
      // new commit on main, the diff parent..child still applies on top of it.
      job.changes.push({ id: c.id, title: c.title, intent: c.intent, agent: c.agent, fork: c.fork, remote: c.remote,
        token: (await fork.createToken('read', 1800)).plaintext, base: c.base, commit: c.commit, review: c.review });
      c.state = 'testing'; c.tries++;
      this.#ev(c, 'testing', picked.length > 1 ? `in a train of ${picked.length}` : 'alone');
      await this.#put(c);
    }
    m.waiting = m.waiting.filter((id) => !train.changes.includes(id));
    m.running = train.id; m.runningSince = Date.now();
    m.trains.push(train.id);
    await this.ctx.storage.put(`t:${train.id}`, train);
    await this.#saveMeta();
    await this.env.MergeBox.get(this.env.MergeBox.idFromName(`${m.slug}--merge`)).enqueue(job);
    log('landing', 'train_started', { slug: m.slug, train: train.id, changes: train.changes });
    await this.#arm(30_000);
  }

  async #trainLost(why: string) {
    const m = await this.#m();
    const t = await this.ctx.storage.get<Train>(`t:${m.running}`);
    log('landing', 'train_lost', { slug: m.slug, train: m.running, why });
    if (t) {
      t.state = 'bounced'; t.endedAt = Date.now(); t.note = why; await this.ctx.storage.put(`t:${t.id}`, t);
      for (const id of t.changes.slice().reverse()) {
        const c = await this.#get(id);
        if (c && c.state === 'testing') { c.state = 'queued'; this.#ev(c, 'queued', 'train interrupted, trying again'); await this.#put(c); m.waiting.unshift(id); }
      }
    }
    m.running = null;
    await this.#saveMeta();
  }

  /** The MergeBox's report on a train. */
  async trainDone(r: MergeResult) {
    const m = await this.#m();
    const t = await this.ctx.storage.get<Train>(`t:${r.trainId}`);
    if (!t || m.running !== r.trainId) { log('landing', 'train_result_ignored', { slug: m.slug, train: r.trainId, running: m.running }); return; }
    t.endedAt = Date.now(); t.mainBefore = r.mainBefore || null; t.mainAfter = r.mainAfter || null;
    t.checks = r.checks ? { ok: !!r.checks.ok, ms: r.checks.ms || 0, failures: r.checks.failures || [] } : null;
    m.running = null;
    m.failStreak = !r.ok ? (m.failStreak || 0) + 1 : 0;
    if (!r.ok || r.stale) {
      // The box failed or main moved under it: everyone goes back to the front of the line.
      t.state = 'bounced'; t.note = r.error || (r.stale ? 'main moved during the train; running it again' : 'merger failed');
      for (const id of t.changes.slice().reverse()) {
        const c = await this.#get(id);
        if (c && c.state === 'testing') { c.state = 'queued'; this.#ev(c, 'queued', t.note); await this.#put(c); m.waiting.unshift(id); }
      }
    } else {
      let landed = 0;
      t.outcomes = {};
      for (const rc of r.changes) {
        const c = await this.#get(rc.id);
        if (!c) continue;
        t.outcomes[rc.id] = rc.landed ? 'landed' : rc.bounced ? 'bounced' : (rc.unhandled?.length || rc.conflicts.length) ? 'conflict' : 'retry';
        c.files = rc.files?.length ? rc.files : c.files;
        if (rc.landed) {
          const how = c.redo === 'lead' ? 'lead' : c.redo === 'llm' ? 'replayed-llm' : rc.how;
          if (rc.conflicts.length) this.#ev(c, 'conflict', await this.#withWhom(c, rc.conflicts, r));
          if (how === 'replayed-handler') this.#ev(c, 'replayed', (rc.handled || []).map((h) => `${h.path} (${h.handler})`).join(', ') || 'on the latest code');
          if (how === 'replayed-llm' || how === 'lead') this.#ev(c, 'replayed', how === 'lead' ? `by ${c.lead || 'the lead'} on the latest code` : 'by a model on the latest code');
          c.state = 'landed'; c.landedAt = Date.now(); delete c.redo;
          (m.landings ||= []).push([c.landedAt, Math.round((c.landedAt - c.createdAt) / 1000)]);
          if (m.landings.length > 2000) m.landings.splice(0, m.landings.length - 2000);
          c.landing = { how, conflicts: rc.conflicts, diff: rc.diff || [], commit: rc.commit, mainCommit: r.mainAfter || null };
          this.#ev(c, 'landed', `${(rc.commit || '').slice(0, 7)} on main`);
          landed++;
        } else if (rc.bounced) {
          c.state = 'bounced';
          c.landing = { how: null, conflicts: [], diff: [], commit: null, mainCommit: null };
          this.#ev(c, 'bounced', (rc.checks?.failures || []).slice(0, 2).join('; ') || rc.why || 'checks failed');
        } else if (rc.unhandled?.length || rc.conflicts.length) {
          this.#ev(c, 'conflict', await this.#withWhom(c, rc.unhandled?.length ? rc.unhandled : rc.conflicts, r));
          c.landing = { how: null, conflicts: rc.unhandled?.length ? rc.unhandled : rc.conflicts, diff: [], commit: null, mainCommit: null };
          await this.#escalate(c, m);
        } else {
          // Not applied for another reason (fetch failed, empty): back in line once, then bounce.
          if (c.tries < 3) { c.state = 'queued'; m.waiting.push(c.id); this.#ev(c, 'queued', rc.why || 'trying again'); }
          else { c.state = 'bounced'; this.#ev(c, 'bounced', rc.why || 'could not be applied'); }
        }
        await this.#put(c);
      }
      t.state = landed ? 'landed' : 'bounced';
      if (r.mainAfter) m.tree = undefined;   // re-read the file map on the next view
    }
    await this.ctx.storage.put(`t:${t.id}`, t);
    await this.#saveMeta();
    log('landing', 'train_done', { slug: m.slug, train: t.id, state: t.state, ms: Date.now() - t.startedAt, checks: t.checks?.ok, main: r.mainAfter, ok: r.ok, error: r.error, failStreak: m.failStreak, waiting: m.waiting.length });
    // After a merger failure, wait longer each time (5 s, 10 s, 20 s … 5 min): a tight retry
    // loop ran a train every 5 s against a container that could not start (2026-10-07).
    if (m.waiting.length) await this.#arm(m.failStreak ? Math.min(300_000, 5000 * 2 ** (m.failStreak - 1)) : 500);
    log('landing', 'next_alarm', { slug: m.slug, inMs: ((await this.ctx.storage.getAlarm()) || 0) - Date.now(), failStreak: m.failStreak });
    await this.#notifyDemo(t);
  }

  /** 'src/x.js with <id>': the change that last landed on that file since this one's base
   *  (earlier in this train, else the newest landed change that touched it). */
  async #withWhom(c: Change, paths: string[], r: MergeResult) {
    const earlier = r.changes.slice(0, r.changes.findIndex((x) => x.id === c.id)).filter((x) => x.landed).reverse();
    const landed = (await this.#all()).filter((o) => o.id !== c.id && o.state === 'landed' && (o.landedAt || 0) >= c.createdAt).sort((a, b) => (b.landedAt || 0) - (a.landedAt || 0));
    return paths.map((p) => {
      const other = earlier.find((x) => x.files.includes(p))?.id || landed.find((o) => o.files.includes(p))?.id;
      return other ? `${p} with ${other}` : p;
    }).join(', ');
  }

  /** Tier 2 (LLM replay, flag) or tier 3 (the lead) for a real conflict. */
  async #escalate(c: Change, m: Meta) {
    if (c.kind === 'demo') {
      // The scripted lead redoes the change's intent on the latest main (demo.ts).
      c.state = 'with-lead'; c.lead = 'scripted lead'; c.redo = 'lead';
      this.#ev(c, 'with-lead', 'the scripted lead will redo it on the latest code');
      return;
    }
    if (m.flags.llmReplay) {
      c.state = 'replaying'; c.redo = 'llm';
      this.#ev(c, 'replaying', 'its agent is asked to redo the change on the latest main');
      return;
    }
    c.state = 'with-lead'; c.lead = (await this.env.Project.get(this.env.Project.idFromName(m.slug)).info())?.owner || null;
    this.#ev(c, 'with-lead', `${c.lead || 'the owner'} decides: conflict in ${c.landing?.conflicts.join(', ')}`);
  }

  async setFlags(flags: Partial<Meta['flags']>) {
    const m = await this.#m();
    m.flags = { ...m.flags, ...flags };
    await this.#saveMeta();
    return m.flags;
  }

  async #prune() {
    const m = await this.#m();
    while (m.order.length > KEEP_CHANGES) {
      const id = m.order[0];
      const c = await this.#get(id);
      if (c && OPEN(c)) break;   // never drop an open change
      m.order.shift(); await this.ctx.storage.delete(`c:${id}`);
    }
    while (m.trains.length > KEEP_TRAINS) { const t = m.trains.shift()!; if (t !== m.running) await this.ctx.storage.delete(`t:${t}`); }
  }

  // ---- the view (contract) -------------------------------------------------------
  async #files(): Promise<string[]> {
    const m = await this.#m();
    if (m.tree && Date.now() - m.tree.at < 10 * 60_000) return m.tree.files;
    const project = await this.env.Project.get(this.env.Project.idFromName(m.slug)).info();
    if (!project) return [];
    try {
      using repo = await this.env.ARTIFACTS.get(project.repo);
      const head = (await repo.log({ limit: 1 }))[0];
      if (!head) return [];
      const files: string[] = [];
      const walk = async (hash: string, prefix: string, depth: number): Promise<void> => {
        const entries = (await repo.readTree(hash)) || [];
        const dirs: Promise<void>[] = [];
        for (const e of entries) {
          if (files.length >= 2000) return;
          if (e.type === 'tree') { if (depth < 6 && !/^(node_modules|\.git|vendor)$/.test(e.name)) dirs.push(walk(e.hash, `${prefix}${e.name}/`, depth + 1)); }
          else files.push(prefix + e.name);
        }
        await Promise.all(dirs);
      };
      await walk(head.treeHash, '', 0);
      m.tree = { commit: head.hash, files, at: Date.now() };
      await this.#saveMeta();
      return files;
    } catch (e) { log('landing', 'tree_failed', { slug: m.slug, err: String(e).slice(0, 200) }); return m.tree?.files || []; }
  }

  async view(slug: string) {
    const m = await this.#m(slug);
    const changes = await this.#all();
    const trains = (await Promise.all(m.trains.slice(-12).map((id) => this.ctx.storage.get<Train>(`t:${id}`)))).filter(Boolean) as Train[];
    const byId = new Map(changes.map((c) => [c.id, c]));
    const files = await this.#files();
    const areaOf = (p: string) => { const d = p.split('/').slice(0, -1); return d.length ? d.slice(0, 2).join('/') : '/'; };
    const areas = new Map<string, { path: string; files: number; working: number; claimed: number; recentConflicts: number; recentLandings: number }>();
    const area = (p: string) => { const k = areaOf(p); let a = areas.get(k); if (!a) areas.set(k, a = { path: k, files: 0, working: 0, claimed: 0, recentConflicts: 0, recentLandings: 0 }); return a; };
    for (const f of files) area(f).files++;
    const DAY = 86400_000, now = Date.now();
    for (const c of changes) {
      const open = OPEN(c);
      for (const k of new Set(c.files.map(areaOf))) { const a = area(k === '/' ? 'x' : `${k}/x`); if (open) a.working++; if (c.landedAt && now - c.landedAt < DAY) a.recentLandings++; }
      for (const k of new Set(c.claims.map(areaOf))) if (open) area(k === '/' ? 'x' : `${k}/x`).claimed++;
      for (const e of c.events) if (e.what === 'conflict' && now - e.t < DAY) for (const p of (e.detail || '').split(', ')) if (p) area(p).recentConflicts++;
    }
    const today = (m.landings || []).filter(([t]) => now - t < DAY);
    const lat = today.map(([, s]) => s).sort((a, b) => a - b);
    const recentEv = (w: What) => changes.filter((c) => c.events.some((e) => e.what === w && now - e.t < DAY)).length;
    return {
      now, mode: m.demo ? 'demo' : 'live',
      demo: m.demo, flags: m.flags,
      queue: { trains: trains.map((t) => ({ id: t.id, state: t.state, changes: t.changes, startedAt: t.startedAt, endedAt: t.endedAt, checks: t.checks || { ok: false, ms: 0, failures: [] }, mainBefore: t.mainBefore, mainAfter: t.mainAfter, ...(t.note ? { note: t.note } : {}),
        // What was in the train, by name ("Landed: Add teas to the menu (scripted agent 4)").
        items: t.changes.map((id) => ({ id, title: byId.get(id)?.title || id, agent: byId.get(id)?.agent || '', outcome: t.outcomes?.[id] || (t.state === 'testing' ? 'testing' : null) })) })), waiting: m.waiting },
      changes: changes.slice().reverse().map(({ remote, queuedAt, tries, redo, task, choreTaken, ...c }) => c),
      areas: [...areas.values()].sort((a, b) => (b.working + b.claimed) - (a.working + a.claimed) || a.path.localeCompare(b.path)),
      stats: { landedToday: today.length, inQueue: m.waiting.length + (m.running ? (trains.find((t) => t.id === m.running)?.changes.length || 0) : 0),
        bounced: recentEv('bounced'), replayed: recentEv('replayed'), medianAskToLandS: lat.length ? Math.round(lat[Math.floor(lat.length / 2)]) : null },
    };
  }

  // ---- demo mode (scripted agents, src/landing/demo.ts) ------------------------------
  async demoStart(slug: string, agents: number, speed: number, mode: 'story' | 'busy' = 'story') {
    const m = await this.#m(slug);
    agents = Math.max(1, Math.min(mode === 'busy' ? DEMO_MAX_AGENTS : DEMO_MAX_STORY_AGENTS, Math.round(agents || 4)));
    speed = Math.max(0.5, Math.min(4, speed || 1));
    // Agents of a bigger earlier run that are still ticking would keep taking tasks.
    if (m.demo && m.demo.agents > agents) for (let i = agents + 1; i <= m.demo.agents; i++) await this.env.DemoAgent.get(this.env.DemoAgent.idFromName(`${slug}#${i}`)).stop().catch(() => {});
    m.demo = { running: true, agents, speed, mode, startedAt: Date.now(), endsAt: Date.now() + DEMO_MAX_MS };
    await this.#saveMeta();
    for (let i = 1; i <= agents; i++) await this.env.DemoAgent.get(this.env.DemoAgent.idFromName(`${slug}#${i}`)).start(slug, i, speed, m.demo.startedAt);
    await this.#arm(60_000);
    log('landing', 'demo_start', { slug, agents, speed, mode });
    return m.demo;
  }

  async demoStop(why = 'stopped') {
    const m = await this.#m();
    if (!m.demo) return null;
    for (let i = 1; i <= m.demo.agents; i++) await this.env.DemoAgent.get(this.env.DemoAgent.idFromName(`${m.slug}#${i}`)).stop().catch(() => {});
    m.demo = { ...m.demo, running: false, stoppedAt: Date.now() };
    await this.#saveMeta();
    log('landing', 'demo_stop', { slug: m.slug, why });
    return m.demo;
  }

  async demoForks() { return (await this.#m()).demoForks || []; }

  /** Forget every record (demo reset). Main is reset separately by the demo. */
  async clear() {
    const m = await this.#m();
    if (m.running) throw new Error('a train is running');
    for (const id of m.order) await this.ctx.storage.delete(`c:${id}`);
    for (const id of m.trains) await this.ctx.storage.delete(`t:${id}`);
    this.#meta = { ...m, waiting: [], order: [], trains: [], tree: undefined, demoTaken: {}, demoForks: [], demoBusyNext: 0, landings: [], demo: m.demo && !m.demo.running ? null : m.demo };
    await this.#saveMeta();
  }

  /** The demo's hard cap (20 min) and keep-alive: checked on every alarm. */
  async #demoTick() {
    const m = await this.#m();
    if (!m.demo?.running) return;
    if (Date.now() > m.demo.endsAt) { await this.demoStop('time cap (20 min)'); return; }
    await this.#arm(60_000);
  }

  /** Tell the scripted agents what happened to their changes (bounced → fix, lead → redo). */
  async #notifyDemo(t: Train) {
    const m = await this.#m();
    if (!m.demo?.running) return;
    for (const id of t.changes) {
      const c = await this.#get(id);
      if (!c || c.kind !== 'demo' || (c.state !== 'bounced' && c.state !== 'with-lead')) continue;
      const n = Number(c.agent.match(/(\d+)$/)?.[1] || 0);
      if (n) await this.env.DemoAgent.get(this.env.DemoAgent.idFromName(`${m.slug}#${n}`)).nudge(c.id, c.state).catch((e) => log('landing', 'demo_nudge_failed', { id, err: String(e) }));
    }
  }

  /** For scripted agents: the change, and whether the demo still runs. */
  async demoState() { const m = await this.#m(); return { running: !!m.demo?.running, speed: m.demo?.speed || 1, startedAt: m.demo?.startedAt || 0, mode: m.demo?.mode || 'story' }; }
  async change(id: string) { return this.#get(id); }
  /** The next task of the script for scripted agent n (one task per change, in order; a
   *  stacked task only once the change it builds on has pushed). Null when none is ready. */
  async demoNext(n: number): Promise<{ key: string; stackOn?: { id: string; fork: string; commit: string }; chore?: 'fix' | 'redo'; id?: string } | null> {
    const m = await this.#m();
    // First the agent's own chores: a bounced change to fix, a conflict the lead redoes.
    // Handed out here, once per state, so nothing depends on a nudge arriving (a nudge
    // written into the agent's storage was lost to its own alarm's save, 2026-10-07).
    for (const c of await this.#all()) {
      if (c.kind !== 'demo' || c.agent !== `scripted agent ${n}` || (c.state !== 'bounced' && c.state !== 'with-lead')) continue;
      const mark = `${c.state}@${c.tries}`;
      if (c.choreTaken === mark) continue;
      c.choreTaken = mark; await this.#put(c);
      log('landing', 'demo_chore', { slug: m.slug, n, id: c.id, chore: c.state === 'bounced' ? 'fix' : 'redo' });
      return { key: c.task || '', chore: c.state === 'bounced' ? 'fix' : 'redo', id: c.id };
    }
    if (m.demo?.mode === 'busy') {
      const i = m.demoBusyNext || 0;
      if (i >= BUSY_MAX_TASKS) return null;
      m.demoBusyNext = i + 1;
      await this.#saveMeta();
      return { key: `busy:${i}` };
    }
    const taken = m.demoTaken || (m.demoTaken = {});
    for (const t of TASKS) {
      const v = taken[t.key];
      if (v && !(v.startsWith('pending:') && Date.now() - Number(v.slice(8)) > 120_000)) continue;
      let stackOn: { id: string; fork: string; commit: string } | undefined;
      if (t.stackOn) {
        const pid = taken[t.stackOn];
        const parent = pid && !pid.startsWith('pending:') ? await this.#get(pid) : null;
        if (!parent?.commit) continue;
        stackOn = { id: parent.id, fork: parent.fork, commit: parent.commit };
      }
      taken[t.key] = `pending:${Date.now()}`;
      await this.#saveMeta();
      log('landing', 'demo_task', { slug: m.slug, n, task: t.key });
      return { key: t.key, ...(stackOn ? { stackOn } : {}) };
    }
    return null;
  }

  /** A plain-words event on a change (scripted agents say what they are doing). */
  async note(id: string, what: What, detail?: string) {
    const c = await this.#get(id); if (!c) return;
    if (what === 'working' && c.state !== 'landed') c.state = 'working';
    this.#ev(c, what, detail); await this.#put(c);
  }

  /** The change now lives on another fork (the lead redid it on a fresh fork of main). */
  async rebase(id: string, fork: string, remote: string, base: string) {
    const c = await this.#get(id); if (!c) throw new Error('unknown change');
    c.fork = fork; c.remote = remote; c.base = base; c.commit = null; c.stackedOn = null;
    await this.#put(c);
    if (c.kind === 'demo') { const m = await this.#m(); m.demoForks = [...(m.demoForks || []), fork]; await this.#saveMeta(); }
  }
}
