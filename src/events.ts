// Artifacts event subscriptions (Eyal, 2026-10-12): pushes to a project's repos reach forq through a Queue.
//   Queue forq-artifacts-events (forq account) -> queue() in index.ts -> handleArtifactsBatch -> Landing.gitPushed
// What Artifacts offers (checked 2026-10-12): account-level events (repo.created/deleted/forked/imported) for every
// repo in the account, NOT filterable by namespace (a namespace on that source fails with 'Unknown Internal Error'),
// and repo-level events (pushed/cloned/fetched) that need one subscription per repo ("We currently do not support
// multiple subscriptions on the same resource"). wrangler 4.145 has no --namespace/--repo-name for artifacts.repo,
// so subscriptions are made over the REST API with a Queues-Write token (secret CF_EVENTS_TOKEN).
// Which repos get 'pushed': only project MAINS of landing projects (subscribed by Landing with the first real agent's
// change), never lab projects or the demo; agent forks are left out (forq push reports agent pushes; Eyal, 2026-10-12).
// The account-level stream (subscription 'forq-repos') carries every repo event in the account, the sim's namespace
// and the demo's forks included: repoEventTarget() keeps only a project's own lifecycle (imported, a person's fork
// of it, deleted) in namespace forq and drops the rest (created is skipped: every Build creates a repo).

import type { Env } from './env';
// box.ts's JSONL log line, inline so this module loads in plain Node tests (events.test.mjs).
const log = (module: string, event: string, fields: Record<string, unknown> = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), module, event, ...fields }));

const API = 'https://api.cloudflare.com/client/v4';

export type Pusher = { kind: 'agent' | 'lander' | 'platform' | 'person'; name: string; email: string };
export type PushEv = { repo: string; namespace: string; ref: string; before: string; after: string; n: number; message: string; by: Pusher; at: number };

/** Who made a push, from its newest commit's committer: an agent box, the merge queue, forq itself, or a person. */
export function whoPushed(c: { name?: string; email?: string } | undefined): Pusher {
  const name = String(c?.name || ''), email = String(c?.email || '');
  if (/^agent\+/.test(email) || /^forq agent /.test(name)) return { kind: 'agent', name, email };
  if (name === 'qodebase lander' || /^lander@/.test(email)) return { kind: 'lander', name, email };
  if (/^qodebase\b/.test(name) || /@qodebase\.app$/.test(email)) return { kind: 'platform', name, email };
  return { kind: 'person', name: name || email || 'someone', email };
}

/** One queue message -> a push, or null (not a push event, or malformed). */
export function parsePush(body: unknown): PushEv | null {
  const b = body as { type?: string; source?: { namespace?: string; repoName?: string }; payload?: Record<string, any>; metadata?: { eventTimestamp?: string } };
  if (!b || b.type !== 'cf.artifacts.repo.pushed' || !b.source?.repoName || !b.payload?.after) return null;
  // Only branch pushes with commits: the merge queue pushes its git notes (refs/notes/qodebase) after every train, and
  // those read as '0 commits pushed by someone via git' (the R5 flagship's public Asks showed 21).
  if (!String(b.payload.ref || '').startsWith('refs/heads/')) return null;
  const commits = Array.isArray(b.payload.commits) ? b.payload.commits : [];
  const newest = commits.find((c: any) => c?.id === b.payload!.after) || commits.at(-1);
  if (!newest) return null;   // no commit to say who pushed
  return {
    repo: b.source.repoName, namespace: String(b.source.namespace || ''), ref: String(b.payload.ref || ''),
    before: String(b.payload.before || ''), after: String(b.payload.after), n: Number(b.payload.totalCommitsCount ?? commits.length) || commits.length,
    message: String(newest?.message || '').split('\n')[0].slice(0, 200), by: whoPushed(newest?.committer || newest?.author),
    at: Date.parse(b.metadata?.eventTimestamp || '') || Date.now(),
  };
}

/** The project slug a repo belongs to, and the change id when it is an agent's fork (`<slug>--<id>`). */
export function repoTarget(repo: string): { slug: string; change: string | null } {
  const i = repo.indexOf('--');
  return i > 0 ? { slug: repo.slice(0, i), change: repo } : { slug: repo, change: null };
}

/** Lab, unlisted and sim work never subscribes (manager, 2026-10-12). */
export const eligibleSlug = (slug: string) => /^[a-z0-9-]+\.[a-z0-9-]+$/.test(slug) && !/\.lab-/.test(slug);

export async function subscribePush(env: Env, repo: string): Promise<{ id?: string; error?: string }> {
  if (!env.CF_EVENTS_TOKEN || !env.EVENTS_QUEUE_ID) return { error: 'events not set up' };
  const r = await fetch(`${API}/accounts/${env.ACCOUNT_ID}/event_subscriptions/subscriptions`, {
    method: 'POST', headers: { authorization: `Bearer ${env.CF_EVENTS_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: `push-${repo}`.slice(0, 120), enabled: true, source: { type: 'artifacts.repo', namespace: 'forq', repo_name: repo },
      destination: { type: 'queues.queue', queue_id: env.EVENTS_QUEUE_ID }, events: ['pushed'] }) });
  const j = await r.json().catch(() => ({})) as { success?: boolean; result?: { id?: string }; errors?: { message?: string }[] };
  const out = j.success && j.result?.id ? { id: j.result.id } : { error: (j.errors || []).map((e) => e.message).join('; ').slice(0, 200) || `HTTP ${r.status}` };
  log('events', 'subscribe', { repo, ...out });
  return out;
}

export async function unsubscribe(env: Env, id: string, repo: string) {
  if (!env.CF_EVENTS_TOKEN) return;
  const r = await fetch(`${API}/accounts/${env.ACCOUNT_ID}/event_subscriptions/subscriptions/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${env.CF_EVENTS_TOKEN}` } });
  log('events', 'unsubscribe', { repo, id, status: r.status });
}

/** An account-level repo event, if it is about a project (namespace forq, a main, not an agent's or the demo's fork):
 *  which project, and one line for its board/timeline. Null for everything else (the sim, agent forks, other kinds). */
export function repoEventTarget(body: unknown): { slug: string; key: string; at: number; kind: string; text: string } | null {
  const b = body as { type?: string; source?: { namespace?: string; repoName?: string }; payload?: Record<string, any>; metadata?: { eventTimestamp?: string } };
  const t = b?.type || '';
  if (!/^cf\.artifacts\.repo\.(imported|forked|deleted)$/.test(t) || b.source?.namespace !== 'forq' || !b.source?.repoName) return null;
  const at = Date.parse(b.metadata?.eventTimestamp || '') || Date.now(), src = b.source.repoName;
  const isMain = (r: string) => eligibleSlug(r) && !r.includes('--');
  if (t.endsWith('.forked')) {
    // A fork of a main into another project's name = someone forked the project (agent forks have '--').
    const to = String(b.payload?.repoName || '');
    if (!isMain(src) || !isMain(to)) return null;
    return { slug: src, key: `forked:${to}`, at, kind: 'forked', text: `forked as ${to.replace('.', '/')}` };
  }
  if (!isMain(src)) return null;
  const kind = t.split('.').pop()!;
  const text = kind === 'imported' ? `imported from ${String(b.payload?.sourceUrl || 'a git remote').replace(/^https?:\/\//, '').replace(/\.git$/, '')}` : 'repository deleted';
  return { slug: src, key: `${kind}:${src}:${b.payload?.repoId || at}`, at, kind, text };
}

/** The Queue consumer: pushes and project repo events to the Landing of their project; the rest is acked and logged. */
export async function handleArtifactsBatch(batch: MessageBatch<unknown>, env: Env) {
  for (const msg of batch.messages) {
    const ev = parsePush(msg.body);
    if (!ev) {
      const re = repoEventTarget(msg.body);
      if (re) {
        try { const r = await env.Landing.get(env.Landing.idFromName(re.slug)).repoEvent(re); log('events', 'repo', { slug: re.slug, kind: re.kind, result: r }); }
        catch (e) { log('events', 'repo_failed', { slug: re.slug, err: String(e).slice(0, 300) }); }
      }
      msg.ack(); continue;
    }
    const t = repoTarget(ev.repo);
    try {
      const r = await env.Landing.get(env.Landing.idFromName(t.slug)).gitPushed({ ...ev, change: t.change });
      log('events', 'push', { repo: ev.repo, after: ev.after.slice(0, 10), by: ev.by.kind, n: ev.n, result: r });
      msg.ack();
    } catch (e) {
      log('events', 'push_failed', { repo: ev.repo, err: String((e as Error)?.stack || e).slice(0, 400), attempts: msg.attempts });
      if (msg.attempts < 3) msg.retry({ delaySeconds: 10 }); else msg.ack();
    }
  }
}
