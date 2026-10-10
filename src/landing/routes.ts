// The landing system's API (index.ts hands /api/p/<o>/<n>/landing[/<verb>] here, after the
// private-project gate):
//   GET  /api/p/<o>/<n>/landing             the contract view (docs/contest/PLAN.md); anyone who can see the project
//   POST /api/p/<o>/<n>/landing/approve     {id}: the merge tap -> the change waits for the next train (owner)
//   POST /api/p/<o>/<n>/landing/demo        {action: 'start'|'stop'|'reset'|'seed', agents?, speed?, mode?: 'story'|'busy'} (owner)
//   POST /api/p/<o>/<n>/landing/flags       {llmReplay?, agentModel?, replayModel?} (owner; models: alias or claude-… id, null clears)
//   GET  /api/p/<o>/<n>/landing/state       merger box + alarm state (admin)
//   GET  /api/p/<o>/<n>/landing/board       the agent board: ?recent=<min, default 30>&files=a,b&area=X&tail=N (anyone who can see the project)

import type { Env } from '../env';
import type { ProjectInfo } from '../project';
import { log } from '../box';
import { SEED } from './demoproject';
import { pushSeed } from './demo';
import { DEMO_MAX_AGENTS, WATCH } from './landing';

const json = (v: unknown, status = 200) => Response.json(v, { status, headers: { 'cache-control': 'no-store' } });

export const landingStub = (env: Env, slug: string) => env.Landing.get(env.Landing.idFromName(slug));

/** Main back to the café's first version (a new commit on top, so history stays), records
 *  cleared, the scripted forks deleted (ten at a time: one by one took ~8 min after a busy run). */
async function resetDemo(env: Env, info: ProjectInfo, L: ReturnType<typeof landingStub>) {
  using repo = await env.ARTIFACTS.get(info.repo);
  const head = (await repo.log({ limit: 1 }).catch(() => []))[0]?.hash || null;
  await L.demoStop('reset');
  const forks = await L.demoForks();
  await L.clear();
  const token = (await repo.createToken('write', 600)).plaintext;
  const commit = await pushSeed(info.remote, token, SEED, head, 'Reset the demo to the first version');
  let deleted = 0;
  for (let i = 0; i < forks.length; i += 10)
    deleted += (await Promise.all(forks.slice(i, i + 10).map((f) => env.ARTIFACTS.delete(f).catch(() => false)))).filter(Boolean).length;
  log('landing', 'demo_reset', { slug: info.slug, commit, forksDeleted: deleted });
  return { ok: true, commit, forksDeleted: deleted };
}

export async function landingRoute(request: Request, env: Env, info: ProjectInfo, verb: string, me: { handle: string | null; admin?: boolean }): Promise<Response> {
  const L = landingStub(env, info.slug);
  if (verb === '' && request.method === 'GET') return json(await L.view(info.slug));
  // Watch a run: anyone, no sign-in, on projects with flags.publicWatch (eyal/corner-cafe). Caps in Landing.watchClaim.
  if (verb === 'watch' && request.method === 'POST') {
    if (info.private) return json({ error: 'no such project' }, 404);
    // Only cf-connecting-ip: Cloudflare sets it, and fromFront() (index.ts) moves a verified front
    // request's x-qb-ip there. x-qb-ip itself could be sent by anyone straight to projectsbase.dev.
    // The admin (laptop scripts, tests) gets its own bucket so tests don't spend the laptop IP's runs.
    const ip = me.admin ? 'admin' : request.headers.get('cf-connecting-ip') || 'unknown';
    const c = await L.watchClaim(ip) as any;
    // Both spellings: state running|started|limit, why/reason, nextAt/retryAfterS.
    if (c.state === 'limit') return json({ ...c, why: c.reason, nextAt: Date.now() + c.retryAfterS * 1000 });
    if (c.state === 'running') return json(c);
    // Set up in Landing's alarm (reset + start, ~20 s): the reply does not wait for it.
    return json({ state: 'started', startedAt: c.startedAt, endsAt: c.endsAt, startedNow: true, preparing: true });
  }
  // The board for people (`qb board`): who works on what now, what finished in the window, aliases.
  if (verb === 'board' && request.method === 'GET') {
    const u = new URL(request.url);
    const recent = Math.min(24 * 60, Number(u.searchParams.get('recent') ?? 30) || 0) * 60_000;
    const who = await L.boardWho({ recent, files: u.searchParams.get('files') || '', area: u.searchParams.get('area') });
    return json(u.searchParams.has('tail') ? { ...who, tail: await L.boardTail(Number(u.searchParams.get('tail')) || 50) } : who);
  }
  if (info.owner !== me.handle && !me.admin) return json({ error: 'not your project' }, 403);
  if (verb === 'restart' && me.admin) {
    // After a deploy: objects that never went idle keep the old code; this restarts them on the new one.
    let merger: string | null = null;
    try { merger = ((await env.MergeBox.get(env.MergeBox.idFromName(`${info.slug}--merge`)).state()) as { version?: string | null }).version || null; } catch {}
    const before = { landing: await L.version().catch(() => null), merger };
    await L.restart().catch(() => {});
    await env.MergeBox.get(env.MergeBox.idFromName(`${info.slug}--merge`)).restart().catch(() => {});
    return json({ before, now: env.CF_VERSION_METADATA?.id || null });
  }
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) as Record<string, unknown> : {};
  try {
    if (verb === 'approve' && request.method === 'POST') return json(await L.approve(String(body.id || '')));
    if (verb === 'flags' && request.method === 'POST') {
      // A model: an alias (sonnet, haiku, opus) or a full id (claude-haiku-5-5). null clears it.
      const model = (v: unknown) => (typeof v === 'string' && /^(sonnet|haiku|opus|claude-[a-z0-9-]{3,40})$/.test(v) ? { ok: v } : v === null ? { ok: undefined } : null);
      const am = model(body.agentModel), rm = model(body.replayModel);
      if (typeof body.unlisted === 'boolean') await env.Project.get(env.Project.idFromName(info.slug)).setUnlisted(body.unlisted);
      if (typeof body.landing === 'boolean') await env.Project.get(env.Project.idFromName(info.slug)).setLanding(body.landing);   // lab projects: not seeded by the demo
      return json(await L.setFlags(info.slug, { ...(typeof body.llmReplay === 'boolean' ? { llmReplay: body.llmReplay } : {}),
        ...(typeof body.publicWatch === 'boolean' ? { publicWatch: body.publicWatch } : {}),
        // A crew run: caps {agents, awake}, reviewers (pool size, 1-4), budgetUsd (hard stop), halted:false to resume.
        ...(body.caps && typeof body.caps === 'object' ? { caps: { agents: Math.min(16, Number((body.caps as any).agents) || 0) || undefined, awake: Math.min(16, Number((body.caps as any).awake) || 0) || undefined } } : body.caps === null ? { caps: undefined } : {}),
        ...(Number(body.reviewers) >= 0 && body.reviewers !== null && body.reviewers !== undefined && body.reviewers !== '' ? { reviewers: Math.min(6, Math.round(Number(body.reviewers))) } : {}),
        ...(Number(body.budgetUsd) > 0 ? { budgetUsd: Math.min(20, Number(body.budgetUsd)) } : body.budgetUsd === null ? { budgetUsd: undefined } : {}),
        ...(body.halted === false ? { halted: false } : {}),
        ...(typeof body.autoMerge === 'boolean' ? { autoMerge: body.autoMerge } : {}),
        // Variants lab knobs (docs/lab/runs-schema.md).
        ...(model(body.plannerModel) ? { plannerModel: model(body.plannerModel)!.ok } : {}),
        ...(model(body.coderModel) ? { coderModel: model(body.coderModel)!.ok } : {}),
        ...(model(body.reviewerModel) ? { reviewerModel: model(body.reviewerModel)!.ok } : {}),
        ...(body.reviewStyle === 'read' || body.reviewStyle === 'adversarial' ? { reviewStyle: body.reviewStyle } : {}),
        ...(['intent', 'ffa', 'phases', 'stacking', 'leads', 'github'].includes(String(body.policy)) ? { policy: body.policy as 'intent' } : {}),
        ...(Number(body.trainMax) >= 1 ? { trainMax: Math.min(24, Math.round(Number(body.trainMax))) } : {}),
        ...(typeof body.claims === 'boolean' ? { claims: body.claims } : {}),
        ...(typeof body.dedupe === 'boolean' ? { dedupe: body.dedupe } : {}),
        ...(typeof body.board === 'boolean' ? { board: body.board } : {}),
        ...(typeof body.crossDedupe === 'boolean' ? { crossDedupe: body.crossDedupe } : {}),
        ...(typeof body.nextTask === 'string' ? { nextTask: body.nextTask.slice(0, 1000) || undefined } : body.nextTask === null ? { nextTask: undefined } : {}),
        // agentModel: the model this project's agent boxes run on the owner's subscription (a cheap test);
        // replayModel: the model tier-2 replays use (default Haiku 5.5).
        ...(am ? { agentModel: am.ok } : {}), ...(rm ? { replayModel: rm.ok } : {}) }));
    }
    if (verb === 'state' && me.admin) {
      const v = await L.view(info.slug);
      const agents = [];
      for (let i = 1; i <= (v.demo?.agents || 0); i++) agents.push(await env.DemoAgent.get(env.DemoAgent.idFromName(`${info.slug}#${i}`)).peek());
      // This project's ledger rows (box time, Claude tokens) for the last 2 days: what a real-agent test cost.
      const costs = (await env.Ledger.get(env.Ledger.idFromName(info.owner)).rows(2).catch(() => [])).filter((r) => r.project.includes(info.name));
      return json({ merger: await env.MergeBox.get(env.MergeBox.idFromName(`${info.slug}--merge`)).state(), agents, costs });
    }
    if (verb === 'demo' && request.method === 'POST') {
      const action = String(body.action || '');
      if (action === 'start') return json(await L.demoStart(info.slug, Number(body.agents) || 4, Number(body.speed) || 1, body.mode === 'busy' ? 'busy' : 'story', { force: body.force === true }));
      if (action === 'stop') return json(await L.demoStop());
      if (action === 'seed') {
        using repo = await env.ARTIFACTS.get(info.repo);
        const head = (await repo.log({ limit: 1 }).catch(() => []))[0]?.hash || null;
        if (head) return json({ error: 'not empty: use reset' }, 400);
        const token = (await repo.createToken('write', 600)).plaintext;
        const commit = await pushSeed(info.remote, token, SEED, null, 'Corner Café: the first version');
        await env.Project.get(env.Project.idFromName(info.slug)).setLanding(true);
        log('landing', 'demo_seed', { slug: info.slug, commit });
        return json({ ok: true, commit });
      }
      if (action === 'reset') {
        if (body.force !== true && (await L.publicActive())) return json({ error: "a visitor's run is going on this project; it is never preempted (force: true to override)" }, 409);
        return json(await resetDemo(env, info, L));
      }
      return json({ error: `action: start (mode story|busy, agents 1-${DEMO_MAX_AGENTS}, speed 0.5-4), stop, reset, seed` }, 400);
    }
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 400);
  }
  return json({ error: 'unknown landing verb' }, 404);
}
