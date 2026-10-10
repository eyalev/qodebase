// The `forq` command inside every box (written to /usr/local/bin/forq at boot).
// It talks to the Worker's /api/agent/* verbs with the box's own signed token
// (/run/forq/agent-token, tmpfs). Router-only verbs are refused for agents.

export const FORQ_CLI = String.raw`#!/usr/bin/env python3
"""forq - talk to the forq platform from inside an agent box.

  forq status <working|pushed|blocked> "note"   report your state (agents)
  forq list                                     this project's agents
  forq spawn "task" [--files a,b] [--on <agent-id>]
                                                start an agent on its own fork (router); --files claims
                                                the files it expects to change, --on stacks it on
                                                another agent's unlanded work
  forq send <agent-id> "text"                   message an agent (router)
  forq merge <agent-id>                         merge an agent's fork into main (router); on projects
                                                with the merge queue it queues the change instead
  forq sync-main                                rebase your work on the latest main (agents)
  forq fetch-agent <agent-id>                   fetch an agent's work to review it (reviewer)
  forq verdict <agent-id> approve|changes "notes"   your review verdict (reviewer)
  forq who [--recent [30m]] [--files a,b] [--area X]
                                                the agent board: who works on what now (--recent: and
                                                what others finished in that window)
  forq intent "what you are doing" [--files a,b]  say on the board which task you took and its files
  forq dedupe <file> | "task" "task" ...        one quick pass: which tasks are the same work (shown on
                                                the board as aliases: build it once)
"""
import json, os, re, subprocess, sys, time, urllib.parse, urllib.request

RUN = os.environ.get('FORQ_RUN', '/run/forq')   # tests point these elsewhere
REPO = os.environ.get('FORQ_REPO', '/workspace/repo')
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

def try_api(method, path, body=None, timeout=3):
    """The hook's calls: short, and never an error (the hook must not get in the agent's way)."""
    try:
        req = urllib.request.Request(secret('api') + path, method=method, data=json.dumps(body).encode() if body is not None else None,
            headers={'content-type': 'application/json', 'x-forq-agent': secret('agent-token'), 'user-agent': 'forq-cli/1'})
        with urllib.request.urlopen(req, timeout=timeout) as r: return json.load(r)
    except BaseException: return None

def dur_ms(s, d=30 * 60_000):
    m = re.match(r'^(\d+(?:\.\d+)?)\s*(s|m|h)?$', s or '')
    return int(float(m.group(1)) * {'s': 1e3, 'm': 6e4, 'h': 36e5}[m.group(2) or 'm']) if m else d

def board_hook():
    """Claude Code hook (settings.json in the box, src/box.ts) for the agent board. Posts files and commits,
    never command bodies or file contents; reads the board into the agent's context. Exits 0 always."""
    try: inp = json.load(sys.stdin)
    except Exception: return
    sp = RUN + '/board-state.json'
    try: st = json.load(open(sp))
    except Exception: st = {}
    now = time.time()
    if st.get('offUntil', 0) > now: return
    def save():
        try: json.dump(st, open(sp, 'w'))
        except Exception: pass
    def out(ev, text):
        if text: print(json.dumps({'hookSpecificOutput': {'hookEventName': ev, 'additionalContext': text}}))
    ev, tool = inp.get('hook_event_name'), inp.get('tool_name') or ''
    if ev == 'UserPromptSubmit':
        r = try_api('GET', '/api/agent/who?recent=1800000')
        if r is None: return
        if r.get('on') is False: st['offUntil'] = now + 120; save(); return
        if r.get('text'): out(ev, 'Agent board (who works on what in this project; advisory, not locks):\n' + r['text'])
    elif ev == 'PreToolUse' and tool in ('Edit', 'Write', 'MultiEdit'):
        f = (inp.get('tool_input') or {}).get('file_path') or ''
        if f.startswith(REPO + '/'): f = f[len(REPO) + 1:]
        if not f or f.startswith('/'): return
        edits, warned = st.setdefault('edits', {}), st.setdefault('warned', {})
        if now - edits.get(f, 0) < 30:
            return
        edits[f] = now
        r = try_api('POST', '/api/agent/board', {'kind': 'editing', 'files': [f], 'who': True})
        if r is not None and r.get('off'): st['offUntil'] = now + 120
        rows = (r or {}).get('rows') or []
        if rows and now - warned.get(f, 0) >= 300:
            warned[f] = now
            out(ev, f"Agent board: {f} was also touched in the last 10 min by:\n" + '\n'.join(x['line'] for x in rows[:3]) + "\nYour work lands through the merge queue either way; keep your change to this file small, or see: forq who --files " + f)
        for m in (edits, warned):
            for k in [k for k, t in m.items() if now - t > 3600]: del m[k]
        save()
    elif ev == 'PostToolUse' and tool == 'Bash':
        cmd = str((inp.get('tool_input') or {}).get('command') or '')
        if not re.search(r'(^|[;&|(]\s*)git\s+(-\S+\s+\S+\s+)*commit\b', cmd): return
        g = lambda *a: subprocess.run(['git', *a], cwd=REPO, text=True, capture_output=True).stdout.strip()
        head = g('rev-parse', 'HEAD')
        try: fresh = now - int(g('log', '-1', '--format=%ct') or 0) < 120
        except ValueError: fresh = False
        if not head or head == st.get('lastHead') or not fresh: return
        st['lastHead'] = head; save()
        try_api('POST', '/api/agent/board', {'kind': 'committed', 'status': g('log', '-1', '--format=%s')[:80],
            'files': [x for x in g('diff-tree', '--root', '--no-commit-id', '--name-only', '-r', 'HEAD').split('\n') if x][:20]})

def git(*a, check=True):
    p = subprocess.run(['git', *a], cwd=REPO, text=True, capture_output=True)
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
            if a.get('claims'): print(f"    claims: {', '.join(a['claims'][:12])}")
            if a.get('landing'): print(f"    queue: {a['landing']}")
    elif v == 'spawn':
        files, on, words = [], None, []
        it = iter(rest)
        for w in it:
            if w == '--files': files += [f for f in next(it, '').split(',') if f]
            elif w == '--on': on = next(it, None)
            else: words.append(w)
        if not words: sys.exit('usage: forq spawn "task" [--files a,b] [--on <agent-id>]')
        body = {'task': ' '.join(words)}
        if files: body['files'] = files
        if on: body['on'] = on
        a = api('POST', '/api/agent/spawn', body); print(f"started {a['id']}" + (f" (stacked on {on})" if on else ''))
    elif v == 'send':
        if len(rest) < 2: sys.exit('usage: forq send <agent-id> "text"')
        print(api('POST', '/api/agent/send', {'agent': rest[0], 'text': ' '.join(rest[1:])}))
    elif v == 'merge':
        if not rest: sys.exit('usage: forq merge <agent-id>')
        f = api('GET', '/api/agent/merge-info?agent=' + rest[0])
        if f.get('queued'):
            print(f"queued {rest[0]} for the merge queue: it lands on main once it passes the checks (state: {f.get('state')})"); return
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
    elif v == 'sync-main':
        f = api('GET', '/api/agent/main-info')
        auth = f"http.extraHeader=Authorization: Bearer {f['token']}"
        br = f.get('branch') or 'main'
        git('-c', auth, 'fetch', '-q', f['remote'], f'+refs/heads/{br}:refs/remotes/main/{br}')
        r = git('rebase', f'refs/remotes/main/{br}', check=False)
        if r.returncode:
            sys.exit(f'forq: conflicts while rebasing on main. Resolve them keeping BOTH main\'s changes and your intent, then: git add -A && git rebase --continue && git push -f origin HEAD && forq status pushed "redone on the latest main"\n{r.stdout}{r.stderr}')
        git('push', '-q', '-f', 'origin', 'HEAD')
        print(f'rebased on main ({br}) and pushed. Run the tests, then: forq status pushed "redone on the latest main"')
    elif v == 'hook':
        board_hook()
    elif v == 'who':
        q, it = {}, iter(rest)
        for w in it:
            if w == '--recent':
                nx = rest[rest.index(w) + 1] if rest.index(w) + 1 < len(rest) and not rest[rest.index(w) + 1].startswith('--') else None
                q['recent'] = dur_ms(nx)
                if nx: next(it, None)
            elif w == '--files': q['files'] = next(it, '')
            elif w == '--area': q['area'] = next(it, '')
        r = api('GET', '/api/agent/who?' + urllib.parse.urlencode(q))
        if r.get('on') is False: print('the agent board is off in this project'); return
        print(r.get('text') or 'nobody else is working on that right now')
    elif v == 'intent':
        files, words, it = [], [], iter(rest)
        for w in it:
            if w == '--files': files += [f for f in next(it, '').split(',') if f]
            else: words.append(w)
        if not words: sys.exit('usage: forq intent "what you are doing" [--files a,b]')
        r = api('POST', '/api/agent/intent', {'intent': ' '.join(words), 'files': files})
        if r.get('off'): print('the agent board is off in this project'); return
        print('on the board: ' + ' '.join(words))
        if r.get('others'): print('Others on the same files, or finished in the last 30 min (if one of these is the same work as yours, under any name, pick another task or make yours a thin alias of it):\n' + r['others'])
    elif v == 'dedupe':
        if not rest: sys.exit('usage: forq dedupe <file> | "task" "task" ...')
        p = rest[0] if len(rest) == 1 else ''
        if p and not os.path.isabs(p): p = os.path.join(REPO, p) if os.path.exists(os.path.join(REPO, p)) else p
        text = open(p).read() if p and os.path.isfile(p) else '\n'.join('- ' + w for w in rest)
        f = api('POST', '/api/agent/dedupe', {'stage': 'prompt', 'text': text})
        if len(f.get('items') or []) < 2: print('fewer than two tasks: nothing to compare'); return
        model = 'claude-haiku-5-5'
        # No settings (so this box's own hooks do not fire inside the pass), no tools, one turn.
        c = subprocess.run(['claude', '-p', '--model', model, '--output-format', 'json', '--max-turns', '1', '--tools', '', '--setting-sources', '',
            '--system-prompt', 'You find duplicate tasks in a backlog. Answer with one JSON object only.'], input=f['prompt'], text=True, capture_output=True, timeout=300,
            # Run from inside an agent's own Claude Code: its session variables must not reach the nested call.
            env={k: x for k, x in os.environ.items() if not (k == 'CLAUDECODE' or k.startswith('CLAUDE_CODE_SSE') or k in ('CLAUDE_CODE_ENTRYPOINT', 'ANTHROPIC_MODEL'))})
        try: j = json.loads(c.stdout)
        except Exception: sys.exit(f'forq: the dedupe pass gave no answer: {(c.stderr or c.stdout)[-300:]}')
        if j.get('is_error') or '{' not in str(j.get('result') or ''): print(f"forq: the dedupe pass answered oddly: {str(j.get('result'))[:300]}", file=sys.stderr)
        u = j.get('usage') or {}
        r = api('POST', '/api/agent/dedupe', {'stage': 'answer', 'ids': [i['id'] for i in f['items']], 'answer': j.get('result') or '', 'isError': bool(j.get('is_error')), 'exit': c.returncode,
            'usage': {'model': model, 'in': u.get('input_tokens', 0), 'out': u.get('output_tokens', 0), 'cr': u.get('cache_read_input_tokens', 0), 'cw': u.get('cache_creation_input_tokens', 0)}})
        pairs = r.get('pairs') or []
        print(f"{len(f['items'])} tasks, {len(pairs)} pair(s) of the same work" + (':' if pairs else ''))
        for a, b in pairs: print(f'  {a} = {b}  (build it once; the other is a thin alias)')
    elif v == 'merged':
        api('POST', '/api/agent/merged', {'agent': rest[0]}); print('ok')
    else:
        sys.exit(f'forq: unknown verb {v}. Try: forq help')

main(sys.argv[1:])
`;
