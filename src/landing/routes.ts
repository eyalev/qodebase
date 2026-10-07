// The landing system's API (index.ts hands /api/p/<o>/<n>/landing[/<verb>] here, after the
// private-project gate):
//   GET  /api/p/<o>/<n>/landing             the contract view (docs/contest/PLAN.md); anyone who can see the project
//   POST /api/p/<o>/<n>/landing/approve     {id}: the merge tap -> the change waits for the next train (owner)
//   POST /api/p/<o>/<n>/landing/demo        {action: 'start'|'stop'|'reset'|'seed', agents?, speed?, mode?: 'story'|'busy'} (owner)
//   POST /api/p/<o>/<n>/landing/flags       {llmReplay?, agentModel?, replayModel?} (owner; models: alias or claude-… id, null clears)
//   GET  /api/p/<o>/<n>/landing/state       merger box + alarm state (admin)

import type { Env } from '../env';
import type { ProjectInfo } from '../project';
import { log } from '../box';
import { SEED } from './demoproject';
import { pushSeed } from './demo';
import { DEMO_MAX_AGENTS } from './landing';

const json = (v: unknown, status = 200) => Response.json(v, { status, headers: { 'cache-control': 'no-store' } });

export const landingStub = (env: Env, slug: string) => env.Landing.get(env.Landing.idFromName(slug));

export async function landingRoute(request: Request, env: Env, info: ProjectInfo, verb: string, me: { handle: string | null; admin?: boolean }): Promise<Response> {
  const L = landingStub(env, info.slug);
  if (verb === '' && request.method === 'GET') return json(await L.view(info.slug));
  if (info.owner !== me.handle && !me.admin) return json({ error: 'not your project' }, 403);
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) as Record<string, unknown> : {};
  try {
    if (verb === 'approve' && request.method === 'POST') return json(await L.approve(String(body.id || '')));
    if (verb === 'flags' && request.method === 'POST') {
      // A model: an alias (sonnet, haiku, opus) or a full id (claude-haiku-5-5). null clears it.
      const model = (v: unknown) => (typeof v === 'string' && /^(sonnet|haiku|opus|claude-[a-z0-9-]{3,40})$/.test(v) ? { ok: v } : v === null ? { ok: undefined } : null);
      const am = model(body.agentModel), rm = model(body.replayModel);
      return json(await L.setFlags(info.slug, { ...(typeof body.llmReplay === 'boolean' ? { llmReplay: body.llmReplay } : {}),
        // agentModel: the model this project's agent boxes run on the owner's subscription (a cheap test);
        // replayModel: the model tier-2 replays use (default Haiku 5.5).
        ...(am ? { agentModel: am.ok } : {}), ...(rm ? { replayModel: rm.ok } : {}) }));
    }
    if (verb === 'state' && me.admin) {
      const v = await L.view(info.slug);
      const agents = [];
      for (let i = 1; i <= (v.demo?.agents || 0); i++) agents.push(await env.DemoAgent.get(env.DemoAgent.idFromName(`${info.slug}#${i}`)).peek());
      return json({ merger: await env.MergeBox.get(env.MergeBox.idFromName(`${info.slug}--merge`)).state(), agents });
    }
    if (verb === 'demo' && request.method === 'POST') {
      const action = String(body.action || '');
      if (action === 'start') return json(await L.demoStart(info.slug, Number(body.agents) || 4, Number(body.speed) || 1, body.mode === 'busy' ? 'busy' : 'story'));
      if (action === 'stop') return json(await L.demoStop());
      if (action === 'seed' || action === 'reset') {
        // seed: an empty project gets the café; reset: main goes back to the café's first
        // version (a new commit on top, so history stays) and the records are cleared.
        using repo = await env.ARTIFACTS.get(info.repo);
        const head = (await repo.log({ limit: 1 }).catch(() => []))[0]?.hash || null;
        if (action === 'seed' && head) return json({ error: 'not empty: use reset' }, 400);
        let forks: string[] = [];
        if (action === 'reset') {
          await L.demoStop('reset');
          forks = await L.demoForks();
          await L.clear();
        }
        const token = (await repo.createToken('write', 600)).plaintext;
        const commit = await pushSeed(info.remote, token, SEED, head, action === 'seed' ? 'Corner Café: the first version' : 'Reset the demo to the first version');
        // The scripted agents' forks are throwaway: delete them (Artifacts storage).
        let deleted = 0;
        for (const f of forks) if (await env.ARTIFACTS.delete(f).catch(() => false)) deleted++;
        if (action === 'seed') await env.Project.get(env.Project.idFromName(info.slug)).setLanding(true);
        log('landing', `demo_${action}`, { slug: info.slug, commit, forksDeleted: deleted });
        return json({ ok: true, commit, forksDeleted: deleted });
      }
      return json({ error: `action: start (mode story|busy, agents 1-${DEMO_MAX_AGENTS}, speed 0.5-4), stop, reset, seed` }, 400);
    }
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 400);
  }
  return json({ error: 'unknown landing verb' }, 404);
}
