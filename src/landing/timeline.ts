// Run timeline (docs/board/TASKS.md T1): one run of a project as a trace / Gantt. Pure: built from what Landing keeps
// (each change's timestamped events, each train with the merger's phases) plus the project's last router request.
//   GET /api/p/<o>/<n>/landing/timeline[?since=<ms>]   (owner, or anyone on a publicWatch project)
// Shape (qb7's proposal, T2):
//   { v, run: {start, end, now, label, kind: demo|build|lab|project, open},
//     lanes: [{id, group: planner|agents|reviewers|queue|merger|main, label, agent?}],
//     spans: [{id, lane, phase, start, end, open?, change?, train?, label?, detail?}],
//     marks: [{lane: 'main', at, change, kind: landed|bounced, train?}],
//     critical: [spanId…],   // the chain that set the run's end: the last landing, back through its train and its change
//     totals: {phase: ms} }  // summed span time per phase (agents' rows, the queue row and the merger row separately)
// Times are epoch ms. A span still running has open: true and ends at `now`.

import type { Change, Train, Ev } from './landing';

export type TlPhase = 'plan' | 'work' | 'wait_review' | 'review' | 'wait_merge' | 'wait_queue' | 'train' | 'wait_lead'
  | 'wait_box' | 'wake' | 'fetch' | 'apply' | 'replay' | 'checks' | 'push' | 'notes';
export type TlLane = { id: string; group: 'planner' | 'agents' | 'reviewers' | 'queue' | 'merger' | 'main'; label: string; agent?: string };
export type TlSpan = { id: string; lane: string; phase: TlPhase; start: number; end: number; open?: true; change?: string; train?: string; label?: string; detail?: string };
export type TlMark = { lane: 'main'; at: number; change: string; kind: 'landed' | 'bounced'; train?: string };
export type Timeline = {
  v: 1; run: { start: number; end: number; now: number; label: string; kind: 'demo' | 'build' | 'lab' | 'project'; open: boolean };
  lanes: TlLane[]; spans: TlSpan[]; marks: TlMark[]; critical: string[]; totals: Record<string, number>;
};
export type TlInput = {
  slug: string; now: number; since?: number | null;
  changes: Change[]; trains: Train[];
  request?: { at: number; sentAt?: number; text?: string } | null;
  kind: Timeline['run']['kind'];
};

/** What each change event starts (null: the event only adds detail to the span it falls in). */
const STARTS: Partial<Record<Ev['what'], TlPhase | 'end'>> = {
  asked: 'work', working: 'work', 'changes-suggested': 'work', replaying: 'work',
  pushed: 'wait_review', reviewing: 'review', approved: 'wait_merge', queued: 'wait_queue', testing: 'train',
  'with-lead': 'wait_lead', landed: 'end', bounced: 'end',
};
// Merger phases as the merge job and the box name them -> the timeline's phases.
const MERGER: Record<string, [TlPhase, string?]> = {
  'box-queue': ['wait_box', 'waiting for the merger box'], wake: ['wake', 'box already awake'], 'wake-cold': ['wake', 'box started (cold)'], upload: ['wake', 'job sent to the box'],
  'ls-remote': ['fetch', 'branch lookup'], 'fetch-all': ['fetch', 'main, notes and forks together'], 'fetch-main': ['fetch', 'main'], 'fetch-forks': ['fetch', 'agents\' forks'], apply: ['apply'], replay: ['replay', 'shared-file handler'], 'replay-llm': ['replay', 'model replay'],
  checks: ['checks', 'whole train'], 'checks-solo': ['checks', 'one change alone'], notes: ['notes'], push: ['push'], 'push-notes': ['notes', 'pushed'],
};
export const agentLane = (c: Change) => c.agent || c.id;
const short = (id: string) => (id.includes('--') ? id.slice(id.indexOf('--') + 2) : id);

export function buildTimeline(inp: TlInput): Timeline {
  const { now } = inp;
  const since = inp.since ?? 0;
  const changes = inp.changes.filter((c) => (c.events.at(-1)?.t ?? c.createdAt) >= since).sort((a, b) => a.createdAt - b.createdAt);
  const ids = new Set(changes.map((c) => c.id));
  const trains = inp.trains.filter((t) => t.startedAt >= since || t.changes.some((id) => ids.has(id))).sort((a, b) => a.startedAt - b.startedAt);
  const lanes = new Map<string, TlLane>(), spans: TlSpan[] = [], marks: TlMark[] = [];
  let n = 0;
  const lane = (l: TlLane) => { if (!lanes.has(l.id)) lanes.set(l.id, l); return l.id; };
  const span = (s: Omit<TlSpan, 'id'>) => { if (s.end < s.start) s.end = s.start; const x = { id: `s${++n}`, ...s } as TlSpan; spans.push(x); return x; };

  // Planner: the router's last request, from asked to the first change it opened (or to now while it plans).
  const rq = inp.request;
  if (rq && rq.at >= since) {
    const first = changes.find((c) => c.createdAt >= rq.at);
    const pl = lane({ id: 'planner', group: 'planner', label: 'Router (planning)' });
    if (rq.sentAt && rq.sentAt > rq.at) span({ lane: pl, phase: 'wake', start: rq.at, end: rq.sentAt, label: 'router box waking' });
    span({ lane: pl, phase: 'plan', start: rq.sentAt || rq.at, end: first ? first.createdAt : now, ...(first ? {} : { open: true as const }), label: 'planning', detail: (rq.text || '').slice(0, 160) });
  }

  // Each change: its events as consecutive spans on its agent's row; reviews also on the reviewer's row.
  const byChange = new Map<string, TlSpan[]>();
  for (const c of changes) {
    const al = lane({ id: `a:${agentLane(c)}`, group: 'agents', label: short(agentLane(c)), agent: agentLane(c) });
    const mine: TlSpan[] = [];
    let cur: { phase: TlPhase; start: number; label?: string; reviewer?: string } | null = null;
    const close = (t: number) => {
      if (!cur) return;
      mine.push(span({ lane: al, phase: cur.phase, start: cur.start, end: t, change: c.id, label: cur.label || c.title }));
      if (cur.phase === 'review') span({ lane: lane({ id: `r:${cur.reviewer || 'reviewer'}`, group: 'reviewers', label: cur.reviewer ? `Reviewer ${cur.reviewer}` : 'Reviewer' }), phase: 'review', start: cur.start, end: t, change: c.id, label: c.title });
      cur = null;
    };
    const evs = c.events.length ? c.events : [{ t: c.createdAt, what: 'asked' as const }];
    for (const e of evs) {
      const p = STARTS[e.what];
      if (!p) continue;
      if (p === 'end') {
        close(e.t);
        marks.push({ lane: 'main', at: e.t, change: c.id, kind: e.what === 'landed' ? 'landed' : 'bounced' });
        continue;
      }
      if (cur && cur.phase === p && p !== 'work') continue;   // "queued" twice in a row is one wait
      if (cur && cur.phase === p && p === 'work' && e.what === 'working') continue;   // asked -> working: same work
      close(e.t);
      const by = e.what === 'reviewing' ? /^by (\S+)/.exec(e.detail || '')?.[1] : undefined;
      cur = { phase: p, start: e.t, ...(e.what === 'changes-suggested' ? { label: `fixing: ${c.title}` } : e.what === 'replaying' ? { label: `redo: ${c.title}` } : {}), ...(by ? { reviewer: by } : {}) };
    }
    if (cur) {
      const c2: { phase: TlPhase; start: number; label?: string; reviewer?: string } = cur;
      mine.push(span({ lane: al, phase: c2.phase, start: c2.start, end: Math.max(now, c2.start), open: true, change: c.id, label: c2.label || c.title }));
      if (c2.phase === 'review') span({ lane: lane({ id: `r:${c2.reviewer || 'reviewer'}`, group: 'reviewers', label: c2.reviewer ? `Reviewer ${c2.reviewer}` : 'Reviewer' }), phase: 'review', start: c2.start, end: now, open: true, change: c.id, label: c.title });
    }
    byChange.set(c.id, mine);
  }

  // Trains on the queue row; the merger's phases on its own row; each landing as a tick on main.
  const byTrain = new Map<string, TlSpan[]>();
  const ql = trains.length ? lane({ id: 'queue', group: 'queue', label: 'Merge queue (trains)' }) : '';
  for (const t of trains) {
    const end = t.endedAt ?? now;
    const own: TlSpan[] = [span({ lane: ql, phase: 'train', start: t.startedAt, end, ...(t.endedAt ? {} : { open: true as const }), train: t.id,
      label: `${t.changes.length} change${t.changes.length === 1 ? '' : 's'}`, detail: t.outcomes ? Object.entries(t.outcomes).map(([id, o]) => `${short(id)} ${o}`).join(', ') : t.note || t.state })];
    if (t.phases?.length) {
      const ml = lane({ id: 'merger', group: 'merger', label: 'Merger box' });
      for (const [name, s, e, id] of t.phases) {
        const [phase, label] = MERGER[name] || ['apply', name];
        const fm = t.fetchMs && (name === 'fetch-all' || name === 'fetch-main' || name === 'fetch-forks')
          ? `main ${(t.fetchMs.main / 1000).toFixed(1)} s, notes ${(t.fetchMs.notes / 1000).toFixed(1)} s, forks ${t.fetchMs.forks.map((x) => (x / 1000).toFixed(1)).join(' / ')} s` : null;
        own.push(span({ lane: ml, phase, start: s, end: e, train: t.id, ...(id ? { change: id } : {}), label: id ? `${label ? label + ': ' : ''}${short(id)}` : (label || name), ...(name === 'wake-cold' ? { detail: 'cold start' } : fm ? { detail: fm } : {}) }));
      }
    }
    byTrain.set(t.id, own);
    for (const m of marks) if (t.changes.includes(m.change) && t.endedAt && Math.abs(m.at - t.endedAt) < 60_000) m.train = t.id;
  }
  if (marks.length) lane({ id: 'main', group: 'main', label: 'main' });

  // Critical path: the last landing, its train (queue + merger rows) and its change's own spans.
  const critical: string[] = [];
  const last = marks.filter((m) => m.kind === 'landed').sort((a, b) => b.at - a.at)[0];
  if (last) {
    for (const s of byChange.get(last.change) || []) critical.push(s.id);
    const tr = trains.filter((t) => t.changes.includes(last.change) && t.startedAt <= last.at).at(-1);
    if (tr) for (const s of byTrain.get(tr.id) || []) critical.push(s.id);
    const plan = spans.find((s) => s.phase === 'plan');
    if (plan) critical.unshift(plan.id);
  }

  const totals: Record<string, number> = {};
  for (const s of spans) { const k = `${lanes.get(s.lane)?.group}:${s.phase}`; totals[k] = (totals[k] || 0) + (s.end - s.start); }
  const start = Math.min(...spans.map((s) => s.start), ...(spans.length ? [] : [now]));
  const open = spans.some((s) => s.open);
  const end = open ? now : Math.max(...spans.map((s) => s.end), start);
  const order: TlLane['group'][] = ['planner', 'agents', 'reviewers', 'queue', 'merger', 'main'];
  return {
    v: 1, run: { start, end, now, label: inp.slug.replace('.', '/'), kind: inp.kind, open },
    lanes: [...lanes.values()].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group)),
    spans, marks: marks.sort((a, b) => a.at - b.at), critical, totals,
  };
}
