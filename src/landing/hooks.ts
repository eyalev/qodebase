// Real agents and the landing system: the calls index.ts makes at spawn, push, verdict and
// merge. Only for projects with the landing system on (`info.landing`); every other
// project keeps the old flow (the router merges with `forq merge`).

import type { Env } from '../env';
import type { Agent, ProjectInfo } from '../project';
import { head, diffTrees } from '../code';
import { log } from '../box';

export const landingOn = (info: ProjectInfo | null | undefined) => !!info?.landing;
const L = (env: Env, slug: string) => env.Landing.get(env.Landing.idFromName(slug));

/** spawn: the change's record, with the router's expected files as claims. */
export async function onSpawn(env: Env, info: ProjectInfo, agent: Agent, o: { files?: string[]; on?: string | null }) {
  await L(env, info.slug).record(info.slug, {
    id: agent.id, title: agent.task.split('\n')[0].slice(0, 60), intent: agent.request ? `${agent.task}\n\nAsked: ${agent.request}` : agent.task,
    agent: `agent ${agent.id.split('--')[1]}`, kind: 'agent', fork: agent.fork, remote: agent.remote, base: agent.base?.commit || null,
    claims: (o.files || []).map((f) => f.trim().replace(/^\.?\//, '')).filter(Boolean).slice(0, 50), stackedOn: o.on || null,
  });
}

/** `forq status pushed`: the fork's head and the files it changed since its base. */
export async function onPushed(env: Env, ctx: ExecutionContext, info: ProjectInfo, agentId: string, note: string, pooled: boolean | 'none' = false) {
  const a = info.agents.find((x) => x.id === agentId);
  if (!a) return;
  const tip = await head(env, ctx, a.fork);
  if (!tip) return;
  let files: string[] = [];
  if (a.base?.tree) files = (await diffTrees(env, ctx, info.repo, a.base.tree, a.fork, tip.tree).catch(() => [])).map((c) => c.path);
  const L_ = L(env, info.slug);
  if (!(await L_.change(agentId))) await onSpawn(env, info, a, {});   // spawned before the system was on
  await L_.pushed(agentId, tip.commit, files, note || undefined);
  if (pooled === 'none') await L_.reviewed(agentId, 'auto', 'no reviewer in this variant', true);   // straight to the queue
  else if (pooled) await L_.queueReview(agentId);   // a free reviewer of the pool takes it (Landing alarm)
  else await L_.reviewing(agentId);
}

export async function onVerdict(env: Env, slug: string, agentId: string, verdict: 'approved' | 'changes', notes: string) {
  await L(env, slug).reviewed(agentId, verdict, notes);
}

/** The merge tap (the person) or `forq merge` (the router): into the queue. */
export async function onMerge(env: Env, slug: string, agentId: string) {
  const c = await L(env, slug).approve(agentId);
  log('landing', 'merge_tap', { slug, agentId, state: c.state });
  return c;
}
