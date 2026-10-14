// Asks = issues for the agent age (docs/contest/github-parity.md item 4, TASKS.md G4): every request the router got
// and every task on the agent board, with what became of it. Pure: built from the Project's request history and
// Landing's change records + board lists.
//   GET /api/p/<o>/<n>/asks   (anyone who can see the project)
// { asks: [{ id, text, from, at, state, changes: [changeId], changeStates: {id: state}, duplicateOf?, aliases? }], counts }
//   from:  person (typed or Build) | talk | issues (Cloudflare Issues) | board (a task list the router registered) |
//          script (a scripted demo task, corner-cafe: no router there, so each scripted change is its own ask) |
//          git (a person pushed to main over git, from the Artifacts push events)
//   state: planning (nothing started yet) | working | in-line (pushed, in review or in the merge queue) | landed |
//          bounced | mixed (all finished, some landed and some bounced)
// A router request's changes = the change records created after it and before the next request (the router splits
// a request into changes right after it); a board task's changes = the agents that claimed it.

export type AskFrom = 'person' | 'talk' | 'issues' | 'board' | 'script' | 'git';
export type AskState = 'planning' | 'working' | 'in-line' | 'landed' | 'bounced' | 'mixed';
export type Ask = { id: string; text: string; from: AskFrom; at: number; state: AskState; changes: string[];
  changeStates: Record<string, string>; duplicateOf?: string; aliases?: string[]; delivery?: string;
  /** X5: what agents and the router decided on the person's behalf, and (owner only) what they asked the person. */
  decided?: Decided[]; asked?: AskedPerson[] };
export type Decided = { at: number; by: string; what: string; why?: string };
export type AskedPerson = { at: number; by: string; question: string; why: 'secret' | 'money' | 'failing' | 'other'; state: 'open' | 'answered'; href?: string };
export type Note = { at: number; by: string; kind: 'decided' | 'asked-person'; text: string; why?: string; answered?: boolean };
export type AsksInput = {
  requests: { text: string; at: number; from?: string; state?: string }[];
  changes: { id: string; title: string; state: string; createdAt: number; agent?: string; kind?: string }[];
  lists: { by: string; at: number; items: { id: string; text: string }[] }[];
  done: string[]; claims: Record<string, { ids: string[]; at: number }>; aliases: { a: string; b: string }[];
  gitPushes?: { at: number; by: string; after: string; n: number; message: string }[];
  /** X5 notes (`qb-agent decided`, `qb-agent ask-person`); by = a change id or 'router'. */
  notes?: Note[]; owner?: boolean; base?: string;
};

const OPEN_WORK = new Set(['working', 'replaying', 'with-lead']);
const IN_LINE = new Set(['pushed', 'reviewing', 'queued', 'testing']);
/** One state for a set of changes. */
export function stateOf(states: string[]): AskState {
  if (!states.length) return 'planning';
  if (states.some((s) => OPEN_WORK.has(s))) return 'working';
  if (states.some((s) => IN_LINE.has(s))) return 'in-line';
  if (states.every((s) => s === 'landed')) return 'landed';
  if (states.every((s) => s === 'bounced')) return 'bounced';
  return 'mixed';
}

export function buildAsks(inp: AsksInput): { asks: Ask[]; counts: Record<AskState, number> } {
  const asks: Ask[] = [];
  const byId = new Map(inp.changes.map((c) => [c.id, c]));
  // Router requests, oldest first, each owning the changes created until the next one.
  const reqs = inp.requests.filter((r) => r.from !== 'merge' && r.text).sort((a, b) => a.at - b.at);
  reqs.forEach((r, i) => {
    const until = reqs[i + 1]?.at ?? Infinity;
    const mine = inp.changes.filter((c) => c.createdAt >= r.at && c.createdAt < until);
    const from: AskFrom = r.from === 'talk' || r.from === 'issues' ? r.from : 'person';
    asks.push({ id: `r${r.at.toString(36)}`, text: r.text.slice(0, 600), from, at: r.at,
      state: r.state === 'failed' && !mine.length ? 'bounced' : stateOf(mine.map((c) => c.state)),
      changes: mine.map((c) => c.id), changeStates: Object.fromEntries(mine.map((c) => [c.id, c.state])),
      ...(r.state && r.state !== 'sent' ? { delivery: r.state } : {}) });
  });
  // Board tasks: the lists the router registered (qb-agent tasks / qb-agent dedupe); one ask per task id.
  const holders = new Map<string, string[]>();
  for (const [agent, cl] of Object.entries(inp.claims)) for (const t of cl.ids) holders.set(t, [...(holders.get(t) || []), agent]);
  const done = new Set(inp.done);
  const seen = new Set<string>();
  const alias = new Map<string, string>();   // second name -> first
  for (const p of inp.aliases) if (!alias.has(p.b)) alias.set(p.b, p.a);
  // A list nobody claimed from (no claims, nothing marked done) is the router's dedupe list, not work agents picked:
  // its tasks would all read 'planning' forever (the R5 flagship's 40), so leave them out.
  const claimed = Object.keys(inp.claims).length > 0 || inp.done.length > 0;
  if (claimed) for (const l of inp.lists) for (const it of l.items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    // A claim holder is an agent name; its change is the record whose id ends with it (`<slug>--<name>`).
    const ids = (holders.get(it.id) || []).map((h) => inp.changes.find((c) => c.id === h || c.id.endsWith(`--${h}`))?.id || h);
    const sts = ids.map((id) => byId.get(id)?.state).filter(Boolean) as string[];
    const state: AskState = done.has(it.id) ? 'landed' : sts.length ? stateOf(sts) : 'planning';
    const same = inp.aliases.filter((p) => p.a === it.id || p.b === it.id).map((p) => (p.a === it.id ? p.b : p.a));
    asks.push({ id: `t:${it.id}`, text: it.text.slice(0, 600), from: 'board', at: l.at, state, changes: ids,
      changeStates: Object.fromEntries(ids.map((id) => [id, byId.get(id)?.state || 'unknown'])),
      ...(alias.has(it.id) ? { duplicateOf: `t:${alias.get(it.id)}` } : {}),
      ...(same.length ? { aliases: same.map((s) => inp.lists.flatMap((x) => x.items).find((x) => x.id === s)?.text || s) } : {}) });
  }
  // A person's push to main over git (events.ts): already on main, so landed; the text says who and what.
  for (const g of inp.gitPushes || [])
    asks.push({ id: `g:${g.after.slice(0, 12)}`, text: `${g.message || `${g.n} commit${g.n === 1 ? '' : 's'}`} (pushed by ${g.by} via git)`, from: 'git', at: g.at, state: 'landed', changes: [], changeStates: {} });
  // Scripted demo changes have no request and no list: each is its own ask (the café's task script).
  const covered = new Set(asks.flatMap((a) => a.changes));
  for (const c of inp.changes) if (c.kind === 'demo' && !covered.has(c.id))
    asks.push({ id: `c:${c.id}`, text: c.title, from: 'script', at: c.createdAt, state: stateOf([c.state]), changes: [c.id], changeStates: { [c.id]: c.state } });
  // X5: each note goes to the ask that holds its change; the router's to the request it was working on (the newest
  // request before the note). Questions to the person are the owner's only (one can name a secret).
  const reqAsks = asks.filter((a) => a.from === 'person' || a.from === 'talk' || a.from === 'issues').sort((a, b) => a.at - b.at);
  for (const n of (inp.notes || []).slice().sort((a, b) => a.at - b.at)) {
    if (n.kind === 'asked-person' && !inp.owner) continue;
    const home = n.by === 'router'
      ? reqAsks.filter((a) => a.at <= n.at).at(-1) || reqAsks[0]
      : reqAsks.find((a) => a.changes.includes(n.by)) || asks.find((a) => a.changes.includes(n.by));
    if (!home) continue;
    if (n.kind === 'decided') (home.decided ||= []).push({ at: n.at, by: n.by, what: n.text.slice(0, 140), ...(n.why ? { why: n.why.slice(0, 200) } : {}) });
    else {
      const why = (['secret', 'money', 'failing'] as const).find((w) => w === n.why) || 'other';
      (home.asked ||= []).push({ at: n.at, by: n.by, question: n.text.slice(0, 600), why, state: n.answered ? 'answered' : 'open',
        ...(inp.base ? { href: n.by === 'router' ? inp.base : `${inp.base}/work#/change/${encodeURIComponent(n.by)}` } : {}) });
    }
  }
  asks.sort((a, b) => b.at - a.at);
  const counts = { planning: 0, working: 0, 'in-line': 0, landed: 0, bounced: 0, mixed: 0 } as Record<AskState, number>;
  for (const a of asks) counts[a.state]++;
  return { asks, counts };
}
