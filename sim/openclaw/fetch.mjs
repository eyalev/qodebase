// Read-only mirror of openclaw/openclaw metadata (PRs, issues, CI runs) for the OpenClaw
// experiment (docs/openclaw/PLAN.md). GET/POST-graphql reads only; every request is logged
// to requests.jsonl with its rate-limit cost. Resumable: a cursor file per stream.
//   node sim/openclaw/fetch.mjs prs|issues [--since 2026-09-08] [--budget 1500]
//   node sim/openclaw/fetch.mjs prs-days --from 2026-09-08 --to 2026-09-20  # same rows, by day (search),
//        to run beside `prs` from the other end; dedupe by number when reading
//   node sim/openclaw/fetch.mjs titles                # every issue's number/title/created (triage agent's search index)
//   node sim/openclaw/fetch.mjs runs [--days 7]      # ci.yml workflow runs (REST)
//   node sim/openclaw/fetch.mjs jobs [--sample 300] [--event schedule]  # jobs of a sample of runs (runner minutes)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DATA = process.env.OPENCLAW_DATA || path.join(os.homedir(), 'projects/github/openclaw/data');
const REPO = ['openclaw', 'openclaw'];
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const SINCE = opt('since', '2026-09-08T00:00:00Z');
const BUDGET = +opt('budget', 1500);
const TOKEN = execFileSync('gh', ['auth', 'token']).toString().trim();
fs.mkdirSync(DATA, { recursive: true });

const logReq = (o) => fs.appendFileSync(path.join(DATA, 'requests.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...o }) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let spent = 0;

async function gql(query, variables, stream) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const t0 = Date.now();
    const r = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: { authorization: `bearer ${TOKEN}`, 'user-agent': 'qodebase-openclaw-study/1 (read-only)' },
      body: JSON.stringify({ query, variables }),
    });
    const body = await r.json().catch(() => ({}));
    const rl = body?.data?.rateLimit;
    logReq({ api: 'graphql', stream, status: r.status, ms: Date.now() - t0, cost: rl?.cost, remaining: rl?.remaining, errors: body.errors?.map((e) => e.message).slice(0, 2) });
    if (r.ok && body.data && !body.errors) { spent += rl?.cost || 1; return body.data; }
    if (body.data && body.errors && body.data.repository) { spent += rl?.cost || 1; return body.data; } // partial: keep it
    await sleep(2000 * 2 ** attempt); // 502 / timeout on big pages: back off and retry
  }
  throw new Error('graphql failed 5 times');
}

async function rest(url, stream) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const t0 = Date.now();
    const r = await fetch(url, { headers: { authorization: `bearer ${TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'qodebase-openclaw-study/1 (read-only)' } });
    const remaining = r.headers.get('x-ratelimit-remaining');
    logReq({ api: 'rest', stream, status: r.status, ms: Date.now() - t0, url: url.replace('https://api.github.com', ''), remaining: remaining && +remaining });
    if (r.ok) { spent += 1; return r.json(); }
    if (r.status === 403 || r.status === 429) { const reset = +r.headers.get('x-ratelimit-reset') * 1000; await sleep(Math.max(60_000, reset - Date.now())); continue; }
    await sleep(2000 * 2 ** attempt);
  }
  throw new Error('rest failed 5 times: ' + url);
}

const PR_Q = `query($o:String!,$n:String!,$after:String,$page:Int!){ rateLimit{cost remaining}
 repository(owner:$o,name:$n){ pullRequests(first:$page, after:$after, orderBy:{field:CREATED_AT, direction:DESC}){
  pageInfo{hasNextPage endCursor}
  nodes{ number title author{login __typename} authorAssociation createdAt closedAt mergedAt state isDraft
   additions deletions changedFiles baseRefName headRefName mergedBy{login} mergeCommit{oid}
   labels(first:30){nodes{name}}
   files(first:100){totalCount nodes{path additions deletions}}
   closingIssuesReferences(first:5){nodes{number}}
   commits{totalCount}
   lastCommit: commits(last:1){nodes{commit{oid committedDate statusCheckRollup{state}}}}
   timelineItems(first:12, itemTypes:[LABELED_EVENT, ISSUE_COMMENT, PULL_REQUEST_REVIEW, CLOSED_EVENT, HEAD_REF_FORCE_PUSHED_EVENT]){ totalCount nodes{ __typename
    ... on LabeledEvent{createdAt actor{login} label{name}}
    ... on IssueComment{createdAt author{login}}
    ... on PullRequestReview{createdAt author{login} state}
    ... on ClosedEvent{createdAt actor{login}}
    ... on HeadRefForcePushedEvent{createdAt} } }
 } } } }`;

const ISSUE_Q = `query($o:String!,$n:String!,$after:String,$page:Int!){ rateLimit{cost remaining}
 repository(owner:$o,name:$n){ issues(first:$page, after:$after, orderBy:{field:CREATED_AT, direction:DESC}){
  pageInfo{hasNextPage endCursor}
  nodes{ number title author{login __typename} authorAssociation createdAt closedAt state stateReason
   labels(first:30){nodes{name}} comments{totalCount}
   timelineItems(first:15, itemTypes:[LABELED_EVENT, ISSUE_COMMENT, CLOSED_EVENT, MARKED_AS_DUPLICATE_EVENT, CONNECTED_EVENT, CROSS_REFERENCED_EVENT]){ totalCount nodes{ __typename
    ... on LabeledEvent{createdAt actor{login} label{name}}
    ... on IssueComment{createdAt author{login}}
    ... on ClosedEvent{createdAt actor{login} stateReason closer{__typename ... on PullRequest{number mergedAt} ... on Commit{oid}}}
    ... on MarkedAsDuplicateEvent{createdAt actor{login} canonical{__typename ... on Issue{number} ... on PullRequest{number}}}
    ... on ConnectedEvent{createdAt subject{__typename ... on PullRequest{number}}}
    ... on CrossReferencedEvent{createdAt source{__typename ... on PullRequest{number state mergedAt author{login}}}} } }
 } } } }`;

// Same PR fields through search, one created-day per query (a day is ~650 PRs, under search's 1,000 cap).
const PR_NODE = PR_Q.slice(PR_Q.indexOf('nodes{ number'), PR_Q.lastIndexOf('} } } }') - 0);
const PR_SEARCH_Q = `query($q:String!,$after:String,$page:Int!){ rateLimit{cost remaining}
 search(type:ISSUE, query:$q, first:$page, after:$after){ issueCount pageInfo{hasNextPage endCursor}
  nodes{ ... on PullRequest{ ${PR_NODE.replace(/^nodes\{/, '')} } } } }`;
async function prDays() {
  const from = new Date(opt('from', '2026-09-08') + 'T00:00:00Z'), to = new Date(opt('to', '2026-09-20') + 'T00:00:00Z');
  const out = path.join(DATA, 'prs-days.jsonl');
  const doneFile = path.join(DATA, 'prs-days.done');
  const done = new Set(fs.existsSync(doneFile) ? fs.readFileSync(doneFile, 'utf8').split('\n').filter(Boolean) : []);
  for (let d = from; d < to && spent < BUDGET; d = new Date(d.getTime() + 864e5)) {
    const day = d.toISOString().slice(0, 10);
    if (done.has(day)) continue;
    // Halves of a day, so a busy day stays under search's 1,000-result cap.
    for (const [a, b] of [['00:00:00', '11:59:59'], ['12:00:00', '23:59:59']]) {
      let after = null, n = 0, total = 0;
      do {
        const q = `repo:${REPO.join('/')} is:pr created:${day}T${a}Z..${day}T${b}Z`;
        const r = await gql(PR_SEARCH_Q, { q, after, page: 40 }, 'prs-days');
        const nodes = r.search.nodes.filter((x) => x && x.number);
        total = r.search.issueCount;
        fs.appendFileSync(out, nodes.map((x) => JSON.stringify(x)).join('\n') + (nodes.length ? '\n' : ''));
        n += nodes.length; after = r.search.pageInfo.hasNextPage ? r.search.pageInfo.endCursor : null;
      } while (after);
      console.error(`[prs-days] ${day} ${a} ${n}/${total} spent ${spent}`);
      if (total > 1000) console.error(`[prs-days] WARNING ${day} ${a}: ${total} > 1000, truncated`);
    }
    fs.appendFileSync(doneFile, day + '\n');
  }
}

async function pages(kind, query, field) {
  const out = path.join(DATA, `${kind}.jsonl`);
  const cur = path.join(DATA, `${kind}.cursor`);
  let after = fs.existsSync(cur) ? fs.readFileSync(cur, 'utf8').trim() || null : null;
  let page = +opt('page', kind === 'prs' ? 40 : 50), n = 0;
  while (spent < BUDGET) {
    let d;
    try { d = await gql(query, { o: REPO[0], n: REPO[1], after, page }, kind); }
    catch (e) { if (page > 10) { page = Math.floor(page / 2); console.error(`[${kind}] shrinking page to ${page}`); continue; } throw e; }
    const conn = d.repository[field];
    const nodes = conn.nodes.filter(Boolean);
    fs.appendFileSync(out, nodes.map((x) => JSON.stringify(x)).join('\n') + (nodes.length ? '\n' : ''));
    n += nodes.length;
    after = conn.pageInfo.endCursor;
    fs.writeFileSync(cur, after || '');
    const oldest = nodes.at(-1)?.createdAt;
    console.error(`[${kind}] +${nodes.length} (total ${n}) oldest ${oldest} cost so far ${spent} remaining ${d.rateLimit?.remaining}`);
    if (!conn.pageInfo.hasNextPage || (kind !== 'titles' && oldest && oldest < SINCE)) { fs.writeFileSync(cur + '.done', oldest || ''); break; }
  }
  console.error(`[${kind}] stop: ${n} rows, spent ${spent}`);
}

async function runs() {
  const days = +opt('days', 7);
  const out = path.join(DATA, 'runs.jsonl');
  const since = new Date(Date.now() - days * 864e5);
  // One day per query window: the runs API caps any filtered listing at 1,000 results.
  for (let d = 0; d < days * 4; d++) {
    const a = new Date(since.getTime() + d * 6 * 3600e3), b = new Date(a.getTime() + 6 * 3600e3);
    const created = `${a.toISOString().slice(0, 19)}Z..${b.toISOString().slice(0, 19)}Z`;
    for (let p = 1; p <= 10; p++) {
      const j = await rest(`https://api.github.com/repos/${REPO.join('/')}/actions/workflows/ci.yml/runs?per_page=100&page=${p}&created=${encodeURIComponent(created)}`, 'runs');
      const rows = j.workflow_runs.map((r) => ({ id: r.id, event: r.event, branch: r.head_branch, sha: r.head_sha, status: r.status, conclusion: r.conclusion, created_at: r.created_at, run_started_at: r.run_started_at, updated_at: r.updated_at, run_attempt: r.run_attempt, prs: r.pull_requests?.map((x) => x.number), actor: r.actor?.login }));
      fs.appendFileSync(out, rows.map((x) => JSON.stringify(x)).join('\n') + (rows.length ? '\n' : ''));
      console.error(`[runs] ${created} p${p} +${rows.length} of ${j.total_count}`);
      if (rows.length < 100) break;
    }
  }
}

async function jobs() {
  const sample = +opt('sample', 300);
  const ev = opt('event', null); // --event schedule: every run of that event instead of a spread sample
  const all = fs.readFileSync(path.join(DATA, 'runs.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).filter((r) => r.status === 'completed' && (!ev || r.event === ev));
  const out = path.join(DATA, 'jobs.jsonl');
  const done = new Set(fs.existsSync(out) ? fs.readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).run_id) : []);
  // Deterministic spread over the window: every k-th completed run.
  const k = Math.max(1, Math.floor(all.length / sample));
  const pick = all.filter((_, i) => i % k === 0).slice(0, sample).filter((r) => !done.has(r.id));
  for (const r of pick) {
    if (spent >= BUDGET) break;
    const js = [];
    // 100-job pages time out (502/504): a run has 100+ jobs, so take 40 at a time.
    for (let p = 1; p <= 10; p++) {
      const j = await rest(`https://api.github.com/repos/${REPO.join('/')}/actions/runs/${r.id}/jobs?per_page=40&page=${p}`, 'jobs');
      js.push(...j.jobs);
      if (j.jobs.length < 40) break;
    }
    const row = { run_id: r.id, event: r.event, conclusion: r.conclusion, jobs: js.map((x) => ({ name: x.name, conclusion: x.conclusion, started_at: x.started_at, completed_at: x.completed_at, labels: x.labels })) };
    fs.appendFileSync(out, JSON.stringify(row) + '\n');
  }
  console.error(`[jobs] spent ${spent}`);
}

const TITLES_Q = `query($o:String!,$n:String!,$after:String,$page:Int!){ rateLimit{cost remaining}
 repository(owner:$o,name:$n){ issues(first:$page, after:$after, orderBy:{field:CREATED_AT, direction:ASC}){
  pageInfo{hasNextPage endCursor} nodes{ number title createdAt } } } }`;
if (cmd === 'titles') { args.push('--page', '100'); await pages('titles', TITLES_Q, 'issues'); }
else if (cmd === 'prs') await pages('prs', PR_Q, 'pullRequests');
else if (cmd === 'issues') await pages('issues', ISSUE_Q, 'issues');
else if (cmd === 'prs-days') await prDays();
else if (cmd === 'runs') await runs();
else if (cmd === 'jobs') await jobs();
else { console.error('usage: fetch.mjs prs|issues|runs|jobs'); process.exit(2); }
