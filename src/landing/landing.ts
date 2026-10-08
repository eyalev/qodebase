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
import { recordCost, claudeUsd } from '../costs';
import { pushSeed } from './demo';
import { SEED } from './demoproject';
import { pushAlert } from '../alert';

export type What = 'asked' | 'claimed' | 'working' | 'pushed' | 'reviewing' | 'approved' | 'changes-suggested' | 'queued' | 'testing'
  | 'landed' | 'bounced' | 'conflict' | 'replaying' | 'replayed' | 'with-lead' | 'stacked' | 'overlap';
export type Ev = { t: number; what: What; detail?: string };
export type ChangeState = 'working' | 'pushed' | 'reviewing' | 'queued' | 'testing' | 'landed' | 'bounced' | 'replaying' | 'with-lead';
export type Landing_ = { how: 'merged' | 'replayed-handler' | 'replayed-llm' | 'lead' | null; conflicts: string[]; diff: { path: string; lines: string[] }[]; commit: string | null; mainCommit: string | null;
  /** Tier 2: the model that redid it, its usage, and whether it changed the same lines as the reviewed change. */
  replay?: { model: string; ms: number; usd: number | null; tokensIn: number; tokensOut: number; sameLinesAsReviewed: boolean | null };
  /** Diff-of-diffs: for a model replay, the diff that was reviewed (written on older code); `diff` is what landed. */
  reviewedDiff?: { path: string; lines: string[] }[] };
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
  mode?: 'story' | 'busy';
  /** Started by an anonymous visitor (Watch a run): never uses model replay. */
  publicRun?: boolean };
type Meta = {
  slug: string; waiting: string[]; running: string | null; runningSince?: number;
  flags: { llmReplay: boolean; agentModel?: string; replayModel?: string; publicWatch?: boolean;
    /** This project's own caps (a crew run): open agents, awake change agents. */
    caps?: { agents?: number; awake?: number };
    /** Reviewer pool size (1 = the Project's single reviewer flow; 2+ = Landing's pool). */
    reviewers?: number;
    /** Hard budget for this project's boxes + Claude tokens (conservative pricing); halted = boxes stopped. */
    budgetUsd?: number; halted?: boolean;
    /** A real agent's change the reviewer approves goes straight into the queue (no merge tap). */
    autoMerge?: boolean;
    // Variants lab (docs/lab/PLAN.md): models per role, review style, landing policy, train size.
    plannerModel?: string; coderModel?: string; reviewerModel?: string;
    reviewStyle?: 'read' | 'adversarial';
    /** intent = handlers + AI replay (default); github/ffa = no handlers, no replay: a conflict goes back
     *  to the agent to rebase (ffa also skips the checks); phases/stacking/leads = planner strategies (runner). */
    policy?: 'intent' | 'ffa' | 'phases' | 'stacking' | 'leads' | 'github';
    trainMax?: number; claims?: boolean; dedupe?: boolean };
  demo: Demo | null;
  reviews?: { queue: string[]; busy: Record<string, { change: string; at: number; sends: number; nudged?: number }>; coolUntil?: Record<string, number> };
  spent?: { usd: number; at: number; boxes: number; claude: number };
  spentBase?: number;   // spend already in the ledger when the budget was set: the budget counts from there
  watchLog?: { at: number; ip: string }[];   // Watch a run: starts in the last day (caps)
  watchStarting?: number;                    // a visitor's run is being set up (blocks a second one)
  watchPrep?: { prevAgents: number };        // the alarm resets the café and starts the visitor's run
  tree?: { commit: string; files: string[]; at: number };
  order: string[];   // change ids, oldest first (capped)
  trains: string[];
  demoTaken?: Record<string, string>;   // demo task key -> change id ('pending:<ms>' while forking)
  demoForks?: string[];                 // every fork a scripted agent made (deleted on reset)
  failStreak?: number;
  demoBusyNext?: number;                // busy mode: the next generated task's index
  landings?: [number, number, number?][];   // [landedAt, ask-to-land s, replayed 0/1], last 2000: stats outlive pruned records
  bounces?: number[];                       // times of the last 2000 bounces (same reason)
  outbox?: { to: string; text: string; tries: number; at: number }[];   // messages to real agents, sent from the alarm        // [landedAt, ask-to-land s] of the last 2000 landings: stats outlive pruned records                  // trains in a row the merger could not run: back off
};

const TRAIN_MAX = 8;
const KEEP_CHANGES = 150, KEEP_TRAINS = 40, EVENTS_PER_CHANGE = 40, OVERLAPS_PER_CHANGE = 3;
const TRAIN_STUCK_MS = 12 * 60_000;
/** Tier 2's default model: short prompts, a fraction of a cent each (2026-10-08: Haiku 5.5). */
export const DEFAULT_REPLAY_MODEL = 'claude-haiku-5-5';
/** Watch a run (public, no sign-in): one at a time, 40 a day (judges in many timezones, manager 2026-10-08), 3 a day and one per 5 min per IP. */
export const WATCH = { perDay: 40, perIpDay: 3, ipCooldownS: 300, agents: 6, speed: 2, maxMs: 5 * 60_000 };
export const DEMO_MAX_AGENTS = 24, DEMO_MAX_MS = 20 * 60_000, DEMO_MAX_STORY_AGENTS = 12, BUSY_MAX_TASKS = 400, BUSY_MAX_WAITING = 40;
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
    // Over the cap: overlap warnings go first, then the oldest events; 'asked' always stays.
    while (c.events.length > EVENTS_PER_CHANGE) {
      const i = c.events.findIndex((e) => e.what === 'overlap');
      c.events.splice(i >= 0 ? i : c.events.findIndex((e, k) => k > 0 || e.what !== 'asked'), 1);
    }
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
  async record(slug: string, c: Pick<Change, 'id' | 'title' | 'intent' | 'agent' | 'kind' | 'fork' | 'remote' | 'base'> & Partial<Pick<Change, 'claims' | 'needs' | 'provides' | 'stackedOn' | 'task'>>, runId?: number) {
    const m = await this.#m(slug);
    if (c.kind === 'demo' && (!m.demo?.running || m.demo.startedAt !== runId)) throw new Error('stale demo run: this scripted agent belongs to an earlier run');
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

  /** Warn when this change's files or claims overlap another open change's. At most
   *  OVERLAPS_PER_CHANGE warnings each, and the other change hears of it only while it is
   *  still being worked on: in busy mode every menu change warned every other one (13,253
   *  events in 6 minutes, pushing the real events out of each change's history). */
  async #overlaps(ch: Change, paths: string[]) {
    if (!paths.length) return;
    const count = (c: Change) => c.events.filter((e) => e.what === 'overlap').length;
    if (count(ch) >= OVERLAPS_PER_CHANGE) return;
    for (const o of await this.#all()) {
      if (o.id === ch.id || !OPEN(o) || o.id === ch.stackedOn || o.stackedOn === ch.id) continue;
      const theirs = new Set([...o.claims, ...o.files]);
      const shared = paths.filter((p) => theirs.has(p));
      if (!shared.length || ch.events.some((e) => e.what === 'overlap' && e.detail?.includes(o.id))) continue;
      this.#ev(ch, 'overlap', `${shared.slice(0, 3).join(', ')} with ${o.id}`);
      if ((o.state === 'working' || o.state === 'pushed') && count(o) < OVERLAPS_PER_CHANGE) {
        this.#ev(o, 'overlap', `${shared.slice(0, 3).join(', ')} with ${ch.id}`);
        await this.#put(o);
      }
      if (count(ch) >= OVERLAPS_PER_CHANGE) break;
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
    const m0 = await this.#m();
    if (m0.reviews) {
      let freed = false;
      for (const [rv, b] of Object.entries(m0.reviews.busy)) if (b.change === id) { delete m0.reviews.busy[rv]; (m0.reviews.coolUntil ||= {})[rv] = Date.now() + 25_000; freed = true; }
      if (freed) { await this.#saveMeta(); await this.#arm(26_000); }
    }
    const c = await this.#get(id); if (!c) return;
    c.review = { verdict, notes: notes.slice(0, 2000) };
    if (verdict === 'changes') { c.state = 'pushed'; this.#ev(c, 'changes-suggested', notes.split('\n')[0]); }
    else { this.#ev(c, 'approved', verdict === 'auto' ? (notes.split('\n')[0] || 'scripted review') : notes.split('\n')[0]); if (c.state === 'reviewing') c.state = 'pushed'; }
    await this.#put(c);
    // A change its agent redid on the latest main (tier 2) was approved by the person once
    // already: approved again by the reviewer, it goes straight back in line.
    if ((thenQueue || c.redo === 'llm' || (m0.flags.autoMerge && c.kind === 'agent')) && verdict !== 'changes') await this.approve(id);
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
    if (m.watchPrep) await this.#prepareWatch().catch((e) => log('landing', 'watch_prep_failed', { err: String((e as Error)?.stack || e) }));
    log('landing', 'alarm', { slug: m.slug, running: m.running, waiting: m.waiting.length, failStreak: m.failStreak || 0 });
    try {
      if (m.running) {
        // A train lost to a restart (the box reports back; if it never does, run it again).
        if (Date.now() - (m.runningSince || 0) > TRAIN_STUCK_MS) await this.#trainLost('no result from the merger box in 12 min');
        else { await this.#arm(30_000); return; }
      }
      await this.#startTrain();
    } finally {
      await this.#deliver();
      await this.#reviewTick().catch((e) => log('landing', 'review_tick_failed', { err: String(e) }));
      await this.#budgetTick().catch((e) => log('landing', 'budget_tick_failed', { err: String(e) }));
      await this.#demoTick();
    }
  }

  // ---- reviewer pool (landing projects with flags.reviewers >= 2) --------------------
  // The Project DO has one reviewer and one review at a time. A crew of 12 agents would
  // wait 12 reviews in a row, so Landing hands pushed changes to the first free of N
  // reviewer boxes (<slug>--review, --review2, …) through the Worker's review-dispatch verb,
  // and watches each one: a review with no verdict after 8 min is handed out again, once.
  #reviewers(m: Meta) { const n = Math.min(6, m.flags.reviewers || 1); return Array.from({ length: n }, (_, i) => `${m.slug}--review${i ? i + 1 : ''}`); }
  poolOn() { return (this.#meta?.flags.reviewers || 1) > 1; }
  async queueReview(id: string) {
    const m = await this.#m();
    const r = (m.reviews ||= { queue: [], busy: {} });
    for (const [rv, b] of Object.entries(r.busy)) if (b.change === id) delete r.busy[rv];   // a new push supersedes
    if (!r.queue.includes(id)) r.queue.push(id);
    await this.#saveMeta();
    await this.#arm(300);
  }
  async #reviewTick() {
    const m = await this.#m();
    if (!m.reviews || (m.flags.reviewers || 1) < 2) return;
    const r = m.reviews, now = Date.now();
    const H = { 'x-forq-secret': this.env.ADMIN_SECRET, 'user-agent': 'forq-internal/1', 'content-type': 'application/json' };
    // A reviewer that went idle without a verdict (seen: it stopped right after its preview
    // screenshot, dry run 2026-10-08) gets one nudge in the same conversation first.
    for (const [rv, b] of Object.entries(r.busy)) {
      if (b.nudged || now - b.at < 75_000) continue;
      const st = await fetch(`${this.env.API_BASE}/api/agents/${rv}/state`, { headers: H }).then((x) => x.json() as Promise<{ awake?: boolean; cc?: string }>).catch(() => null);
      if (!st?.awake || /busy|thinking|working|running|tool|compact/i.test(st.cc || '')) continue;
      b.nudged = now;
      await this.#saveMeta();
      const ok = await fetch(`${this.env.API_BASE}/api/agents/${rv}/send`, { method: 'POST', headers: H,
        body: JSON.stringify({ text: `You have not given your verdict on ${b.change} yet. Finish the review now: run  forq verdict ${b.change} approve "<one line>"  or  forq verdict ${b.change} changes "<what to fix>".` }) }).then((x) => x.ok).catch(() => false);
      log('landing', 'review_nudge', { slug: m.slug, change: b.change, reviewer: rv, cc: st.cc, ok });
    }
    for (const [rv, b] of Object.entries(r.busy)) {
      // Haiku reviews take 20-40 s: no verdict in 4 min means the hand-off was lost (a cold box,
      // or typed while the reviewer was still finishing its last turn, dry run 2026-10-08).
      if (now - b.at < 4 * 60_000) continue;
      delete r.busy[rv];
      if (b.sends < 3) { r.queue.unshift(b.change); (r as any).sends = { ...((r as any).sends || {}), [b.change]: b.sends + 1 }; log('landing', 'review_resend', { slug: m.slug, change: b.change, reviewer: rv, sends: b.sends }); }
      else { await this.reviewed(b.change, 'changes', 'The reviewer agent did not finish this review. Look at it yourself, or push again to retry.'); }
    }
    // A reviewer that just gave a verdict is still finishing its turn: 25 s before the next one.
    const free = this.#reviewers(m).filter((rv) => !r.busy[rv] && (r.coolUntil?.[rv] || 0) <= now);
    const jobs: [string, string, number][] = [];
    while (free.length && r.queue.length) {
      const change = r.queue.shift()!;
      const prev = Object.values(r.busy).find((b) => b.change === change);
      if (prev) continue;
      const rv = free.shift()!;
      const sends = ((r as any).sends?.[change] as number) || 1;
      r.busy[rv] = { change, at: now, sends };
      jobs.push([rv, change, sends]);
    }
    if (jobs.length) await this.#saveMeta();
    const [owner, name] = m.slug.split('.');
    await Promise.all(jobs.map(async ([rv, change]) => {
      const res = await fetch(`${this.env.API_BASE}/api/p/${owner}/${name}/review-dispatch`, {
        method: 'POST', headers: { 'x-forq-secret': this.env.ADMIN_SECRET, 'user-agent': 'forq-internal/1', 'content-type': 'application/json' },
        body: JSON.stringify({ agent: change, reviewer: rv, style: m.flags.reviewStyle || 'read' }), signal: AbortSignal.timeout(4 * 60_000),
      }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }) as any);
      log('landing', 'review_dispatch', { slug: m.slug, change, reviewer: rv, ok: res.ok, status: res.status });
      if (!res.ok) {
        const now2 = await this.#m();
        if (now2.reviews?.busy[rv]?.change === change) { delete now2.reviews.busy[rv]; now2.reviews.queue.push(change); await this.#saveMeta(); }
      } else {
        const c = await this.#get(change); if (c) { this.#ev(c, 'reviewing', `by ${rv.split('--')[1]}`); await this.#put(c); }
      }
    }));
    if (r.queue.length || Object.keys(r.busy).length) await this.#arm(jobs.length ? 15_000 : 30_000);
  }

  // ---- budget guard (flags.budgetUsd) --------------------------------------------------
  // Spent = this project's box time + Claude tokens from the cost ledger, priced
  // conservatively: every call at the model's >100k-prompt tier (costs.ts), so a pricing gap
  // can only stop the run early, never late. At the budget: every box of the project stops.
  // On Eyal's subscription these dollars are API-equivalent (quota use); real spend is box time.
  async #budgetTick() {
    const m = await this.#m();
    if (!m.flags.budgetUsd || m.flags.halted) return;
    const [owner, name] = m.slug.split('.');
    const rows = (await this.env.Ledger.get(this.env.Ledger.idFromName(owner)).rows(2)).filter((x) => x.project === `${owner}/${name}` || x.project === m.slug);
    let boxes = 0, claude = 0;
    for (const x of rows) {
      if (x.kind === 'boxes') boxes += x.usd || 0;
      if (x.kind === 'claude' && x.tokens) {
        // The project's box model from forq's price table (Haiku 5.5 at its >100k tier); no model
        // set = Opus, the most expensive the boxes could run. Claude Code's own estimate is not
        // used: its table lags new models (it priced Haiku 5.5 as Haiku 4.5, 2026-10-08).
        // Lab variants set a model per role: price at the most expensive one this project runs.
        // Short names are the 5.5 models (the table's plain 'haiku' row is Haiku 4.5).
        const full = (s: string) => ({ haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' } as Record<string, string>)[s] || s;
        const roleModels = ([m.flags.plannerModel, m.flags.coderModel, m.flags.reviewers ? m.flags.reviewerModel : undefined, m.flags.agentModel].filter(Boolean) as string[]).map(full);
        const priciest = roleModels.length ? roleModels.reduce((a, b) => ((claudeUsd(b, x.tokens!) ?? Infinity) > (claudeUsd(a, x.tokens!) ?? Infinity) ? b : a)) : 'opus';
        claude += Math.max(claudeUsd(priciest, x.tokens) ?? claudeUsd('opus', x.tokens) ?? 0, x.usd || 0);
      }
    }
    const total = boxes + claude;
    // A budget counts from when it was set (the second crew run of a day started with the first one's $2.74 in the ledger).
    if (m.spentBase === undefined) m.spentBase = total;
    const run = Math.max(0, total - m.spentBase);
    m.spent = { usd: Math.round(run * 1000) / 1000, at: Date.now(), boxes: Math.round(boxes * 1000) / 1000, claude: Math.round(claude * 1000) / 1000 };
    if (m.spent.usd >= m.flags.budgetUsd) await this.#halt(m, `budget reached: $${m.spent.usd} of $${m.flags.budgetUsd}`);
    await this.#saveMeta();
    if (!m.flags.halted) await this.#arm(60_000);
  }
  async #halt(m: Meta, why: string) {
    m.flags.halted = true;
    const p = await this.env.Project.get(this.env.Project.idFromName(m.slug)).info();
    const ids = [...(p?.agents || []).map((a) => a.id), `${m.slug}--router`, ...this.#reviewers({ ...m, flags: { ...m.flags, reviewers: 6 } })];
    for (const id of ids) await fetch(`${this.env.API_BASE}/api/agents/${id}/stop`, { method: 'POST', headers: { 'x-forq-secret': this.env.ADMIN_SECRET, 'user-agent': 'forq-internal/1' } }).catch(() => null);
    log('landing', 'halted', { slug: m.slug, why, stopped: ids.length });
    await pushAlert(this.env, `qodebase: ${m.slug} halted`, why, `https://${this.env.UI_HOST}/p/${m.slug.replace('.', '/')}/work`, 0).catch(() => {});
  }

  /** Messages to real agents (bounce: fix it; conflict: redo it; the router: decide). From
   *  the alarm, never from a request: waking a box can take longer than a request lives. */
  #tell(to: string, text: string) { const m = this.#meta!; (m.outbox ||= []).push({ to, text, tries: 0, at: Date.now() }); }
  async #deliver() {
    const m = await this.#m();
    const msg = m.outbox?.[0];
    if (!msg) return;
    let ok = false, err = '';
    try {
      const r = await fetch(`${this.env.API_BASE}/api/agents/${msg.to}/send`, {
        method: 'POST', headers: { 'x-forq-secret': this.env.ADMIN_SECRET, 'user-agent': 'forq-internal/1', 'content-type': 'application/json' },
        body: JSON.stringify({ text: msg.text }), signal: AbortSignal.timeout(4 * 60_000) });
      const j = await r.json().catch(() => ({})) as { ok?: boolean; error?: string };
      ok = r.ok && j.ok !== false; err = j.error || (r.ok ? '' : `HTTP ${r.status}`);
    } catch (e) { err = String((e as Error)?.message || e); }
    const now = await this.#m();
    const i = now.outbox?.findIndex((x) => x.at === msg.at && x.to === msg.to) ?? -1;
    if (i >= 0) { if (ok || msg.tries >= 2) now.outbox!.splice(i, 1); else now.outbox![i].tries++; }
    log('landing', 'tell', { slug: m.slug, to: msg.to, ok, err, tries: msg.tries });
    await this.#saveMeta();
    if (now.outbox?.length) await this.#arm(ok ? 1000 : 30_000);
  }

  /** Which waiting changes can go now: stacked ones only after their base. */
  async #pick(): Promise<Change[]> {
    const m = await this.#m();
    const out: Change[] = [];
    for (const id of m.waiting) {
      if (out.length >= (m.flags.trainMax || (m.flags.policy === 'ffa' ? 1 : TRAIN_MAX))) break;
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
    const job: MergeJob = { trainId: train.id, slug: m.slug, mainRemote: project.remote, mainToken, branch: project.importedFrom?.branch || null, changes: [],
      // Tier 2 runs on the owner's Claude subscription: only for the instance owner's projects (and the showcase).
      ...(m.flags.llmReplay && !m.demo?.publicRun && !this.#rebasePolicy(m) && (project.owner === this.env.OWNER_HANDLE || project.owner === 'forq') ? { llm: { model: m.flags.replayModel || DEFAULT_REPLAY_MODEL } } : {}),
      // github / ffa: plain git only (no handlers), ffa also without checks.
      ...(this.#rebasePolicy(m) ? { handlers: false, noChecks: m.flags.policy === 'ffa' } : {}) };
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
          if (how === 'replayed-llm' || how === 'lead') this.#ev(c, 'replayed', how === 'lead' ? `by ${c.lead || 'the lead'} on the latest code` : `by ${rc.llm?.model || 'a model'} on the latest code`);
          c.state = 'landed'; c.landedAt = Date.now(); delete c.redo;
          (m.landings ||= []).push([c.landedAt, Math.round((c.landedAt - c.createdAt) / 1000), how && how !== 'merged' ? 1 : 0]);
          if (m.landings.length > 2000) m.landings.splice(0, m.landings.length - 2000);
          c.landing = { how, conflicts: rc.conflicts, diff: rc.diff || [], commit: rc.commit, mainCommit: r.mainAfter || null,
            ...(rc.reviewedDiff ? { reviewedDiff: rc.reviewedDiff } : {}),
            ...(rc.llm ? { replay: { model: rc.llm.model, ms: rc.llm.ms, usd: rc.llm.usd, tokensIn: (rc.llm.in || 0) + (rc.llm.cacheRead || 0) + (rc.llm.cacheWrite || 0), tokensOut: rc.llm.out || 0, sameLinesAsReviewed: rc.llm.sameLines ?? null } } : {}) };
          this.#ev(c, 'landed', `${(rc.commit || '').slice(0, 7)} on main`);
          landed++;
        } else if (rc.bounced) {
          c.state = 'bounced';
          (m.bounces ||= []).push(Date.now()); if (m.bounces.length > 2000) m.bounces.splice(0, m.bounces.length - 2000);
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
      for (const rc of r.changes) if (rc.llm) {
        log('landing', 'replay_llm', { slug: m.slug, id: rc.id, landed: rc.landed, ...rc.llm });
        await recordCost(this.env, m.slug.split('.')[0], 'claude', m.slug, { usd: null, covered: false, billing: 'sub',
          tokens: { in: rc.llm.in || 0, out: rc.llm.out || 0, cw: rc.llm.cacheWrite || 0, cr: rc.llm.cacheRead || 0 } });
      }
      await this.#afterRealTrain(r);
    }
    await this.ctx.storage.put(`t:${t.id}`, t);
    await this.#saveMeta();
    log('landing', 'train_done', { slug: m.slug, train: t.id, state: t.state, ms: Date.now() - t.startedAt, checks: t.checks?.ok, main: r.mainAfter, ok: r.ok, error: r.error, failStreak: m.failStreak, waiting: m.waiting.length });
    // After a merger failure, wait longer each time (5 s, 10 s, 20 s … 5 min): a tight retry
    // loop ran a train every 5 s against a container that could not start (2026-10-07).
    if (m.waiting.length) await this.#arm(m.failStreak ? Math.min(300_000, 5000 * 2 ** (m.failStreak - 1)) : 500);
    else if (m.outbox?.length) await this.#arm(500);
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

  /** Real agents: landed ones are merged in the Project (and a Worker project redeploys);
   *  bounced ones are told why. Conflicts are handled in #escalate. */
  async #afterRealTrain(r: MergeResult) {
    const m = await this.#m();
    const P = this.env.Project.get(this.env.Project.idFromName(m.slug));
    let deploy = false;
    for (const rc of r.changes) {
      const c = await this.#get(rc.id);
      if (!c || c.kind !== 'agent') continue;
      if (rc.landed) { await P.setState(c.id, 'merged', `landed on main as ${(rc.commit || '').slice(0, 7)}`).catch((e) => log('landing', 'set_merged_failed', { id: c.id, err: String(e) })); deploy = true; }
      else if (rc.bounced) this.#tell(c.id, `qodebase merge queue: your change did not pass the project's checks on the latest main, so it was sent back.
Failures: ${(rc.checks?.failures || []).slice(0, 4).join(' | ') || rc.why}
Fix it on your fork, push, then run: forq status pushed "fixed: <what>"`);
    }
    if (deploy && (await P.kindOf()) === 'worker') await P.requestBuild('deploy').catch((e) => log('landing', 'deploy_request_failed', { err: String(e) }));
  }

  #rebasePolicy(m: Meta) { return m.flags.policy === 'github' || m.flags.policy === 'ffa'; }

  /** Tier 2 (LLM replay, flag) or tier 3 (the lead) for a real conflict. */
  async #escalate(c: Change, m: Meta) {
    if (c.kind === 'demo') {
      // The scripted lead redoes the change's intent on the latest main (demo.ts).
      c.state = 'with-lead'; c.lead = 'scripted lead'; c.redo = 'lead';
      this.#ev(c, 'with-lead', 'the scripted lead will redo it on the latest code');
      return;
    }
    const where = c.landing?.conflicts.join(', ') || 'shared files';
    if (this.#rebasePolicy(m)) {
      // GitHub-style: the conflict is the author's to fix. Back to the agent: rebase, push, review again.
      c.state = 'bounced';
      this.#ev(c, 'bounced', `conflict in ${where}: back to its agent to rebase on main`);
      this.#tell(c.id, `qodebase merge queue: your change conflicts with main in ${where}. Rebase it on the latest main: run \`forq sync-main\`, resolve the conflicts keeping BOTH main's changes and your task, run the tests, then: forq status pushed "rebased on main"`);
      return;
    }
    if (m.flags.llmReplay) {
      // Tier 2: the change's own agent redoes its intent on today's main.
      c.state = 'replaying'; c.redo = 'llm';
      this.#ev(c, 'replaying', 'its agent is asked to redo the change on the latest main');
      this.#tell(c.id, `qodebase merge queue: main changed under your change and it conflicts in ${where}. Redo your task on the latest main: run \`forq sync-main\` (it rebases your work on main; resolve any conflict keeping BOTH main's changes and your intent), run the tests, push, then: forq status pushed "redone on the latest main"`);
      return;
    }
    // Tier 3: the owner (or the router on their behalf) decides.
    c.state = 'with-lead'; c.lead = (await this.env.Project.get(this.env.Project.idFromName(m.slug)).info())?.owner || null;
    this.#ev(c, 'with-lead', `${c.lead || 'the owner'} decides: conflict in ${where}`);
    this.#tell(`${m.slug}--router`, `qodebase merge queue: agent ${c.id} ("${c.title}") conflicts with main in ${where}. Ask it to redo the change on the latest main (forq send ${c.id} "run forq sync-main, redo your change on it, push"), or tell the person it needs a decision.`);
  }

  async flags() { const m = (await this.ctx.storage.get<Meta>('meta')) || null; return m?.flags || { llmReplay: false }; }

  async setFlags(slug: string, flags: Partial<Meta['flags']>) {
    const m = await this.#m(slug);
    if ('budgetUsd' in flags) { delete m.spentBase; delete m.spent; await this.ctx.storage.setAlarm(Date.now() + 1000); }   // re-baselined by the next budget tick
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
    // Past its end time: over, even if no alarm came to say so (idle scripted agents arm none).
    if (m.demo?.running && Date.now() > m.demo.endsAt + 5_000) await this.demoStop('time cap (seen by a view)');
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
    return {
      now, mode: m.demo ? 'demo' : 'live', code: (this.env.CF_VERSION_METADATA?.id || '').slice(0, 8),
      demo: m.demo || m.flags.publicWatch ? { ...(m.demo || { running: false, agents: 0, speed: 1, startedAt: 0, endsAt: 0 }),
        active: this.#active(m), public: !!m.flags.publicWatch, runsLeftToday: Math.max(0, WATCH.perDay - (m.watchLog || []).filter((w) => now - w.at < 86400_000).length) } : null,
      flags: { llmReplay: m.flags.llmReplay, publicWatch: !!m.flags.publicWatch },
      ...(m.flags.budgetUsd ? { budget: { usd: m.flags.budgetUsd, spent: m.spent?.usd ?? 0, halted: !!m.flags.halted, reviewers: m.flags.reviewers || 1 } } : {}),
      watch: { enabled: !!m.flags.publicWatch, runsToday: (m.watchLog || []).filter((w) => now - w.at < 86400_000).length, maxPerDay: WATCH.perDay, running: this.#active(m) },
      queue: { trains: trains.map((t) => ({ id: t.id, state: t.state, changes: t.changes, startedAt: t.startedAt, endedAt: t.endedAt, checks: t.checks || { ok: false, ms: 0, failures: [] }, mainBefore: t.mainBefore, mainAfter: t.mainAfter, ...(t.note ? { note: t.note } : {}),
        // What was in the train, by name ("Landed: Add teas to the menu (scripted agent 4)").
        items: t.changes.map((id) => ({ id, title: byId.get(id)?.title || id, agent: byId.get(id)?.agent || '', outcome: t.outcomes?.[id] || (t.state === 'testing' ? 'testing' : null) })) })), waiting: m.waiting },
      changes: changes.slice().reverse().map(({ remote, queuedAt, tries, redo, task, choreTaken, ...c }) => c),
      areas: [...areas.values()].sort((a, b) => (b.working + b.claimed) - (a.working + a.claimed) || a.path.localeCompare(b.path)),
      stats: { landedToday: today.length, inQueue: m.waiting.length + (m.running ? (trains.find((t) => t.id === m.running)?.changes.length || 0) : 0),
        bounced: Math.max((m.bounces || []).filter((t) => now - t < DAY).length, changes.filter((c) => c.events.some((e) => e.what === 'bounced' && now - e.t < DAY)).length),
        replayed: Math.max(today.filter((x) => x[2]).length, changes.filter((c) => c.landedAt && now - c.landedAt < DAY && c.landing?.how && c.landing.how !== 'merged').length),
        // ^ the higher of a running counter and the kept records: the records alone (newest 150)
        //   went DOWN mid-run (qb7 2026-10-08); the counters alone miss landings before 2026-10-08 02:30.
        medianAskToLandS: lat.length ? Math.round(lat[Math.floor(lat.length / 2)]) : null },
    };
  }

  // ---- demo mode (scripted agents, src/landing/demo.ts) ------------------------------
  async demoStart(slug: string, agents: number, speed: number, mode: 'story' | 'busy' = 'story', o: { maxMs?: number; publicRun?: boolean; force?: boolean } = {}) {
    const m = await this.#m(slug);
    // The judges' project (publicWatch on): a visitor's run is never preempted, and busy or
    // filming runs belong on other projects (manager, 2026-10-08: a public run was replaced
    // by a 20-agent busy run 50 s after a visitor started it).
    if (!o.publicRun && !o.force) {
      if (m.demo?.publicRun && this.#active(m)) throw new Error("a visitor's run is going on this project; it is never preempted");
      if (m.flags.publicWatch && mode === 'busy') throw new Error('this is the public demo project: run busy mode on another project (cafe-lab, cafe-crew)');
    }
    agents = Math.max(1, Math.min(mode === 'busy' ? DEMO_MAX_AGENTS : DEMO_MAX_STORY_AGENTS, Math.round(agents || 4)));
    speed = Math.max(0.5, Math.min(4, speed || 1));
    // Agents of a bigger earlier run that are still ticking would keep taking tasks.
    if (m.demo && m.demo.agents > agents) for (let i = agents + 1; i <= m.demo.agents; i++) await this.env.DemoAgent.get(this.env.DemoAgent.idFromName(`${slug}#${i}`)).stop().catch(() => {});
    m.demo = { running: true, agents, speed, mode, startedAt: Date.now(), endsAt: Date.now() + Math.min(DEMO_MAX_MS, o.maxMs || DEMO_MAX_MS), ...(o.publicRun ? { publicRun: true } : {}) };
    delete m.watchStarting;
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

  /** Watch a run: may this visitor start one now? Records the start atomically (one DO). */
  async watchClaim(ip: string): Promise<{ state: 'running'; startedAt: number; endsAt: number; startedNow: false } | { state: 'limit'; reason: 'daily' | 'ip' | 'cooldown' | 'off'; retryAfterS: number } | { state: 'go' }> {
    const m = await this.#m();
    if (!m.flags.publicWatch) return { state: 'limit', reason: 'off', retryAfterS: 3600 };
    if (m.demo && this.#active(m)) return { state: 'running', startedAt: m.demo.startedAt, endsAt: m.demo.endsAt, startedNow: false };
    const now = Date.now();
    if (m.watchStarting && now - m.watchStarting < 60_000) return { state: 'running', startedAt: m.watchStarting, endsAt: m.watchStarting + WATCH.maxMs, startedNow: false };
    const day = (m.watchLog || []).filter((w) => now - w.at < 86400_000);
    if (day.length >= WATCH.perDay) return { state: 'limit', reason: 'daily', retryAfterS: Math.ceil((day[0].at + 86400_000 - now) / 1000) };
    const mine = day.filter((w) => w.ip === ip);
    if (mine.length >= WATCH.perIpDay) return { state: 'limit', reason: 'ip', retryAfterS: Math.ceil((mine[0].at + 86400_000 - now) / 1000) };
    const last = mine[mine.length - 1];
    if (last && now - last.at < WATCH.ipCooldownS * 1000) return { state: 'limit', reason: 'cooldown', retryAfterS: Math.ceil((last.at + WATCH.ipCooldownS * 1000 - now) / 1000) };
    if (m.running) return { state: 'limit', reason: 'cooldown', retryAfterS: 30 };   // the last run's final train is still landing
    m.watchLog = [...day, { at: now, ip }]; m.watchStarting = now;
    // Reply now, set up in the alarm (the reset took ~23 s before the reply, 2026-10-08).
    m.watchPrep = { prevAgents: m.demo?.agents || 0 };
    m.demo = { running: true, agents: WATCH.agents, speed: WATCH.speed, mode: 'story', startedAt: now, endsAt: now + WATCH.maxMs, publicRun: true };
    await this.#saveMeta();
    await this.ctx.storage.setAlarm(Date.now() + 50);
    log('landing', 'watch_start', { slug: m.slug, ip: ip.replace(/[.:][^.:]*$/, '.x'), today: m.watchLog.length });
    return { state: 'go', startedAt: now, endsAt: now + WATCH.maxMs } as any;
  }

  /** The visitor's run, from the alarm: the café back to its first version, records cleared,
   *  then the scripted agents start (the old run's forks are deleted after, off the clock). */
  async #prepareWatch() {
    const m = await this.#m();
    const prep = m.watchPrep;
    if (!prep || !m.demo) return;
    delete m.watchPrep;
    const demo = m.demo;
    for (let i = 1; i <= Math.max(prep.prevAgents, demo.agents); i++) await this.env.DemoAgent.get(this.env.DemoAgent.idFromName(`${m.slug}#${i}`)).stop().catch(() => {});
    const forks = m.demoForks || [];
    for (const id of m.order) await this.ctx.storage.delete(`c:${id}`);
    for (const id of m.trains) await this.ctx.storage.delete(`t:${id}`);
    Object.assign(m, { waiting: [], order: [], trains: [], tree: undefined, demoTaken: {}, demoForks: [], demoBusyNext: 0, landings: [], bounces: [] });
    const project = await this.env.Project.get(this.env.Project.idFromName(m.slug)).info();
    using repo = await this.env.ARTIFACTS.get(project!.repo);
    const head = (await repo.log({ limit: 1 }))[0]?.hash || null;
    await pushSeed(project!.remote, (await repo.createToken('write', 600)).plaintext, SEED, head, 'Reset the demo to the first version (Watch a run)');
    // The run's clock starts now that the café is ready.
    demo.startedAt = Date.now(); demo.endsAt = demo.startedAt + WATCH.maxMs; delete m.watchStarting;
    await this.#saveMeta();
    for (let i = 1; i <= demo.agents; i++) await this.env.DemoAgent.get(this.env.DemoAgent.idFromName(`${m.slug}#${i}`)).start(m.slug, i, demo.speed, demo.startedAt);
    log('landing', 'watch_ready', { slug: m.slug, forksToDelete: forks.length });
    for (let i = 0; i < forks.length; i += 10) await Promise.all(forks.slice(i, i + 10).map((f) => this.env.ARTIFACTS.delete(f).catch(() => false)));
  }

  /** Is a visitor's run going (reset/start by the owner must not preempt it)? */
  async publicActive() { const m = await this.#m(); return !!m.demo?.publicRun && this.#active(m); }

  /** A run is still going while its agents work OR its changes are still in line / landing. */
  #active(m: Meta) { return !!m.demo?.running || m.waiting.length > 0 || !!m.running || !!m.watchPrep; }

  /** Version check after a deploy: a Durable Object that never went idle keeps the old code. */
  async version() { return this.env.CF_VERSION_METADATA?.id || null; }
  /** Restart this object on the deployed code (admin, src/landing/routes.ts 'restart'). */
  async restart(): Promise<void> { this.ctx.abort('restart on the deployed code'); }

  async demoForks() { return (await this.#m()).demoForks || []; }

  /** Forget every record (demo reset). Main is reset separately by the demo. */
  async clear() {
    const m = await this.#m();
    if (m.running) throw new Error('a train is running');
    for (const id of m.order) await this.ctx.storage.delete(`c:${id}`);
    for (const id of m.trains) await this.ctx.storage.delete(`t:${id}`);
    this.#meta = { ...m, waiting: [], order: [], trains: [], tree: undefined, demoTaken: {}, demoForks: [], demoBusyNext: 0, landings: [], bounces: [], demo: m.demo && !m.demo.running ? null : m.demo };
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
  async demoNext(n: number, runId: number): Promise<{ key: string; stackOn?: { id: string; fork: string; commit: string }; chore?: 'fix' | 'redo'; id?: string; stop?: boolean } | null> {
    const m = await this.#m();
    // Only the current run's agents get work: a stray agent of an earlier run (stopped
    // mid-step) took three tasks of a filmed take and never finished them (2026-10-08).
    if (!m.demo?.running || m.demo.startedAt !== runId || n > m.demo.agents) return { key: '', stop: true };
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
      // Backpressure: with a long line, scripted agents wait for it to shorten (20 agents
      // took all 400 tasks in 4 minutes while trains landed ~30 a minute, 2026-10-08).
      if (m.waiting.length >= BUSY_MAX_WAITING) return null;
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
