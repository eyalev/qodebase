// The `forq` command inside every box (written to /usr/local/bin/forq at boot).
// It talks to the Worker's /api/agent/* verbs with the box's own signed token
// (/run/forq/agent-token, tmpfs). Router-only verbs are refused for agents.

export const FORQ_CLI = String.raw`#!/usr/bin/env python3
"""forq - talk to the forq platform from inside an agent box.

  forq status <working|pushed|blocked> "note"   report your state (agents)
  forq list                                     this project's agents
  forq spawn "task"                             start an agent on its own fork (router)
  forq send <agent-id> "text"                   message an agent (router)
  forq merge <agent-id>                         merge an agent's fork into main (router)
  forq fetch-agent <agent-id>                   fetch an agent's work to review it (reviewer)
  forq verdict <agent-id> approve|changes "notes"   your review verdict (reviewer)
"""
import json, os, subprocess, sys, urllib.request

RUN = '/run/forq'
def secret(n):
    try: return open(f'{RUN}/{n}').read().strip()
    except OSError: sys.exit(f'forq: {RUN}/{n} missing (box not booted by forq?)')

def api(method, path, body=None):
    req = urllib.request.Request(secret('api') + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        # A named User-Agent: Cloudflare answers Python-urllib's default with
        # error 1010 (403) before the request reaches the Worker (2026-10-01).
        headers={'content-type': 'application/json', 'x-forq-agent': secret('agent-token'), 'user-agent': 'forq-cli/1'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return json.load(r)
    except urllib.error.HTTPError as e:
        try: msg = json.load(e).get('error')
        except Exception: msg = e.reason
        sys.exit(f'forq: {msg} ({e.code})')

def git(*a, check=True):
    p = subprocess.run(['git', *a], cwd='/workspace/repo', text=True, capture_output=True)
    if check and p.returncode: sys.exit(f'forq: git {" ".join(a[:2])} failed:\n{p.stdout}{p.stderr}')
    return p

def main(argv):
    if not argv or argv[0] in ('-h', '--help', 'help'): print(__doc__.strip()); return
    v, rest = argv[0], argv[1:]
    if v == 'status':
        if not rest or rest[0] not in ('working', 'pushed', 'blocked'): sys.exit('usage: forq status <working|pushed|blocked> "note"')
        api('POST', '/api/agent/status', {'state': rest[0], 'note': ' '.join(rest[1:])}); print('ok')
    elif v == 'list':
        for a in api('GET', '/api/agent/list')['agents']:
            print(f"{a['id']}  [{a['state']}]  {a['task'][:70]}")
            if a.get('note'): print(f"    note: {a['note'][:200]}")
    elif v == 'spawn':
        if not rest: sys.exit('usage: forq spawn "task"')
        a = api('POST', '/api/agent/spawn', {'task': ' '.join(rest)}); print(f"started {a['id']}")
    elif v == 'send':
        if len(rest) < 2: sys.exit('usage: forq send <agent-id> "text"')
        print(api('POST', '/api/agent/send', {'agent': rest[0], 'text': ' '.join(rest[1:])}))
    elif v == 'merge':
        if not rest: sys.exit('usage: forq merge <agent-id>')
        f = api('GET', '/api/agent/merge-info?agent=' + rest[0])
        # The default branch is not always main (GitHub imports keep master, gh-pages…).
        br = git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD', check=False).stdout.strip().split('/', 1)[-1] or 'main'
        git('checkout', '-q', br); git('pull', '-q', '--ff-only', 'origin', br)
        git('-c', f"http.extraHeader=Authorization: Bearer {f['token']}", 'fetch', '-q', f['remote'], br)
        m = git('merge', '--no-edit', '-m', f"Merge {rest[0]}", 'FETCH_HEAD', check=False)
        if m.returncode:
            sys.exit(f'forq: merge conflict - resolve in /workspace/repo, commit, then: git push origin HEAD && forq merged {rest[0]}\n{m.stdout}{m.stderr}')
        git('push', '-q', 'origin', f'HEAD:{br}')
        api('POST', '/api/agent/merged', {'agent': rest[0]}); print(f'merged {rest[0]} into main')
    elif v == 'fetch-agent':
        if not rest: sys.exit('usage: forq fetch-agent <agent-id>')
        f = api('GET', '/api/agent/review-info?agent=' + rest[0])
        ref = f'refs/agents/{rest[0]}'
        git('-c', f"http.extraHeader=Authorization: Bearer {f['token']}", 'fetch', '-q', f['remote'], f'+HEAD:{ref}')
        if f.get('base'):
            # Shallow imports may lack the base commit locally; deepen once if needed.
            if git('cat-file', '-e', f['base'] + '^{commit}', check=False).returncode:
                git('-c', f"http.extraHeader=Authorization: Bearer {f['token']}", 'fetch', '-q', '--deepen=50', f['remote'], f'+HEAD:{ref}', check=False)
        print(f"agent:   {rest[0]}\ntask:    {f['task']}")
        if f.get('request'): print(f"asked:   {f['request']}")
        print(f"base:    {f.get('base') or '(unknown: diff against main)'}\nfetched: {ref}\npreview: {f['preview']}")
        print(f"diff:    git diff {f.get('base') or 'HEAD'} {ref}")
    elif v == 'verdict':
        if len(rest) < 2 or rest[1] not in ('approve', 'changes'): sys.exit('usage: forq verdict <agent-id> approve|changes "notes"')
        # Say which commit was reviewed: forq refuses a verdict on an older one.
        c = git('rev-parse', f'refs/agents/{rest[0]}', check=False).stdout.strip()
        if not c: sys.exit(f'forq: run "forq fetch-agent {rest[0]}" first')
        api('POST', '/api/agent/verdict', {'agent': rest[0], 'verdict': rest[1], 'notes': ' '.join(rest[2:]), 'commit': c}); print('ok')
    elif v == 'merged':
        api('POST', '/api/agent/merged', {'agent': rest[0]}); print('ok')
    else:
        sys.exit(f'forq: unknown verb {v}. Try: forq help')

main(sys.argv[1:])
`;
