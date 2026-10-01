// GitHub lookups for Import: one repo's metadata, and repository search.
// Unauthenticated public API (60 core / 10 search requests a minute per IP),
// so every answer is memoised per colo in caches.default (repo 10 min, search
// 1 h) and the page debounces typing. Enough for one person; a public forq
// would want a token and a per-user budget.

import { log } from './box';

export type GhRepo = {
  fullName: string; name: string; description: string; url: string; stars: number;
  license: string | null; branch: string; sizeKb: number; archived: boolean; private: boolean;
  pushedAt: number; homepage: string | null;
};

/** Imports above this are refused (Artifacts caps a repo at 1 GB; imports are shallow). */
export const MAX_IMPORT_KB = 200 * 1024;

/** `owner/repo` from a GitHub URL, a git URL or a bare `owner/repo`; null if it is a search query. */
export function parseRepoRef(input: string): string | null {
  const s = input.trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)(?:\/.*)?$/i)
    || s.match(/^git@github\.com:([\w.-]+)\/([\w.-]+)$/i)
    || s.match(/^([\w.-]+)\/([\w.-]+)$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

const toRepo = (r: any): GhRepo => ({
  fullName: r.full_name, name: r.name, description: r.description || '', url: r.html_url,
  stars: r.stargazers_count || 0, license: r.license?.spdx_id && r.license.spdx_id !== 'NOASSERTION' ? r.license.spdx_id : null,
  branch: r.default_branch || 'main', sizeKb: r.size || 0, archived: !!r.archived, private: !!r.private,
  pushedAt: r.pushed_at ? Date.parse(r.pushed_at) : 0, homepage: r.homepage || null,
});

async function ghGet(path: string, ttlS: number, ctx: ExecutionContext): Promise<{ status: number; body: any }> {
  const key = new Request(`https://forq-gh-cache.internal${path}`);
  const hit = await caches.default.match(key);
  if (hit) return { status: 200, body: await hit.json() };
  const r = await fetch(`https://api.github.com${path}`, {
    headers: { 'user-agent': 'forq (self-hostable git platform for agents)', accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
  });
  const body = await r.json().catch(() => ({}));
  log('github', 'api', { path: path.slice(0, 120), status: r.status, remaining: r.headers.get('x-ratelimit-remaining') });
  if (r.ok) ctx.waitUntil(caches.default.put(key, new Response(JSON.stringify(body), { headers: { 'cache-control': `max-age=${ttlS}` } })));
  return { status: r.status, body };
}

export async function getRepo(fullName: string, ctx: ExecutionContext): Promise<GhRepo | { error: string; status: number }> {
  const r = await ghGet(`/repos/${fullName}`, 600, ctx);
  if (r.status === 404) return { error: `github.com/${fullName} was not found, or it is private`, status: 404 };
  if (r.status === 403 || r.status === 429) return { error: 'GitHub is rate-limiting forq; try again in a minute', status: 429 };
  if (r.status !== 200) return { error: `GitHub answered ${r.status}`, status: 502 };
  return toRepo(r.body);
}

export async function searchRepos(q: string, ctx: ExecutionContext): Promise<GhRepo[] | { error: string; status: number }> {
  const query = `${q.trim().slice(0, 100)} fork:false`;
  const r = await ghGet(`/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=12`, 3600, ctx);
  if (r.status === 403 || r.status === 429) return { error: 'GitHub search is rate-limited for a minute; paste a URL instead', status: 429 };
  if (r.status !== 200) return { error: `GitHub answered ${r.status}`, status: 502 };
  return (r.body.items || []).map(toRepo);
}

/** A forq project name from a GitHub repo name. */
export const nameFor = (repoName: string) =>
  repoName.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 39) || 'project';
