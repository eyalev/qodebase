// The `qb-agent` command inside every box (written to /usr/local/bin/qb-agent at boot; `forq` is a symlink to it, the
// old name, so agents that started before the rename keep working).
// It talks to the Worker's /api/agent/* verbs with the box's own signed token
// (/run/forq/agent-token, tmpfs). Router-only verbs are refused for agents.

export const FORQ_CLI = String.raw`#!/usr/bin/env python3
"""qb-agent - talk to the qodebase platform from inside an agent box (forq is the old name, kept as an alias).

  qb-agent status <working|pushed|blocked> "note"   report your state (agents)
  qb-agent list                                     this project's agents
  qb-agent spawn "task" [--files a,b] [--on <agent-id>] [--skeleton]
                                                start an agent on its own fork (router); --files claims
                                                the files it expects to change, --on stacks it on
                                                another agent's unlanded work; --skeleton marks the
                                                build's runnable skeleton (other spawns wait until it lands)
  qb-agent parts N                                  say how many tasks you planned, the skeleton included (router)
  qb-agent decided "what it means for the person" [--why "tech detail"]
                                                log a choice you made on the person's behalf, in plain
                                                words (they see it in Asks); the technical part goes in --why
  qb-agent ask-person --why secret|money|failing|other "question"
                                                ask the person; ONLY for a secret/key, spending money, or a
                                                change that keeps failing; then carry on with what you can
  qb-agent send <agent-id> "text"                   message an agent (router)
  qb-agent merge <agent-id>                         merge an agent's fork into main (router); on projects
                                                with the merge queue it queues the change instead
  qb-agent sync-main                                rebase your work on the latest main (agents)
  qb-agent skip                                     during sync-main conflicts: drop your commit when main
                                                already has its task, and go on
  qb-agent push                                     push your work to your own fork (agents); after a
                                                sync-main its history is rewritten, and this pushes anyway
  qb-agent fetch-agent <agent-id>                   fetch an agent's work to review it (reviewer)
  qb-agent verdict <agent-id> approve|changes "notes"   your review verdict (reviewer)
  qb-agent who [--recent [30m]] [--files a,b] [--area X]
                                                the agent board: who works on what now (--recent: and
                                                what others landed on main in that window)
  qb-agent intent "what you are doing" [--files a,b]  say on the board which task you took and its files
  qb-agent next                                     take the next free task of the project's list (when on)
  qb-agent tasks <file>                             register a task list (router)
  qb-agent dedupe <file> | "task" "task" ...        one quick pass: which tasks are the same work (shown on
                                                the board as aliases: build it once)
"""
import json, os, re, subprocess, sys, time, urllib.parse, urllib.request

RUN = os.environ.get('FORQ_RUN', '/run/forq')   # tests point these elsewhere
REPO = os.environ.get('FORQ_REPO', '/workspace/repo')
def secret(n):
    try: return open(f'{RUN}/{n}').read().strip()
    except OSError: sys.exit(f'qb-agent: {RUN}/{n} missing (box not booted by forq?)')

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
        sys.exit(f'qb-agent: {msg} ({e.code})')

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
            out(ev, f"Agent board: {f} was also touched in the last 10 min by:\n" + '\n'.join(x['line'] for x in rows[:3]) + "\nYour work lands through the merge queue either way; keep your change to this file small, or see: qb-agent who --files " + f)
        for m in (edits, warned):
            for k in [k for k, t in m.items() if now - t > 3600]: del m[k]
        save()
    elif ev == 'PostToolUse':
        # Heartbeat on any tool use, at most every 2 min: keeps this agent and its claim live while it works
        # without posting (a slow agent lost its claim after 10 silent minutes).
        if now - st.get('alive', 0) >= 120:
            st['alive'] = now; save()
            r = try_api('POST', '/api/agent/board', {'kind': 'alive'})
            if r is not None and r.get('off'): st['offUntil'] = now + 120; save(); return
        if tool != 'Bash': return
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

def haiku(prompt):
    """One Haiku call (the dedupe and twin passes): no settings, so this box's own hooks do not fire inside it; no
    tools; one turn. Returns (answer text, usage dict for the ledger, is_error, exit code)."""
    model = 'claude-haiku-5-5'
    c = subprocess.run(['claude', '-p', '--model', model, '--output-format', 'json', '--max-turns', '1', '--tools', '', '--setting-sources', '',
        '--system-prompt', 'You find duplicate tasks in a backlog. Answer with one JSON object only.'], input=prompt, text=True, capture_output=True, timeout=300,
        env=dedupe_env())   # run from inside an agent's own Claude Code: its session variables must not reach the nested call
    try: j = json.loads(c.stdout)
    except Exception: return None, None, True, c.returncode
    u = j.get('usage') or {}
    return (j.get('result') or ''), {'model': model, 'in': u.get('input_tokens', 0), 'out': u.get('output_tokens', 0), 'cr': u.get('cache_read_input_tokens', 0), 'cw': u.get('cache_creation_input_tokens', 0)}, bool(j.get('is_error')), c.returncode

def dedupe_env():
    """The nested claude -p's env. Claude Code keeps credentials out of its Bash tool's env (the pass
    failed with api_error and 0 tokens from inside an agent, 2026-10-10), so take them from tmux, where
    boot.sh put them. Never printed."""
    env = {k: x for k, x in os.environ.items() if not (k == 'CLAUDECODE' or k.startswith('CLAUDE_CODE_SSE') or k in ('CLAUDE_CODE_ENTRYPOINT', 'ANTHROPIC_MODEL'))}
    for k in ('CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'):
        if env.get(k): continue
        p = subprocess.run(['tmux', 'show-environment', '-g', k], text=True, capture_output=True)
        if p.returncode == 0 and p.stdout.startswith(k + '='): env[k] = p.stdout.strip()[len(k) + 1:]
    return env

CONFLICT_MSG = ('qb-agent: conflicts while rebasing on main. If main already has this commit\'s task (another change landed it), '
    'run: qb-agent skip (it drops that commit and goes on; your fork is yours alone, no approval needed). Otherwise resolve them '
    'keeping BOTH main\'s changes and your intent, then: git add -A && git rebase --continue && qb-agent push && qb-agent status pushed "redone on the latest main"')

def rebasing():
    return os.path.isdir(os.path.join(REPO, '.git', 'rebase-merge')) or os.path.isdir(os.path.join(REPO, '.git', 'rebase-apply'))

def on_main(commit, mref):
    """Does main already contain this commit's change? Its diff, reversed, applies cleanly to main's tree."""
    if git('rev-parse', '-q', '--verify', commit + '^', check=False).returncode: return False
    patch = git('diff', '--binary', commit + '^', commit, check=False).stdout
    if not patch.strip(): return True
    idx = os.path.join(REPO, '.git', 'forq-onmain.idx')
    env = {**os.environ, 'GIT_INDEX_FILE': idx}
    try:
        if subprocess.run(['git', 'read-tree', mref], cwd=REPO, env=env, capture_output=True).returncode: return False
        return subprocess.run(['git', 'apply', '--cached', '--check', '-R'], cwd=REPO, env=env, input=patch, text=True, capture_output=True).returncode == 0
    finally:
        try: os.remove(idx)
        except OSError: pass

def git(*a, check=True):
    p = subprocess.run(['git', *a], cwd=REPO, text=True, capture_output=True)
    if check and p.returncode: sys.exit(f'qb-agent: git {" ".join(a[:2])} failed:\n{p.stdout}{p.stderr}')
    return p

def main(argv):
    if not argv or argv[0] in ('-h', '--help', 'help'): print(__doc__.strip()); return
    v, rest = argv[0], argv[1:]
    if v == 'status':
        if not rest or rest[0] not in ('working', 'pushed', 'blocked'): sys.exit('usage: qb-agent status <working|pushed|blocked> "note"')
        api('POST', '/api/agent/status', {'state': rest[0], 'note': ' '.join(rest[1:])}); print('ok')
    elif v == 'autopush':
        # B-1 (2026-10-13): the Stop hook at the end of every turn of a change agent. Agents finished and went quiet
        # with their work committed but not pushed (R3's last change sat 25 min; the proof build's skeleton 4 min).
        # Only the agent's own fork, only commits not on it yet; nothing to push = nothing done. Never fails the turn.
        try:
            me = secret('agent-token').rsplit('.', 1)[0]
            tail = me.split('--')[-1] if '--' in me else ''
            if not tail or tail.startswith('router') or tail.startswith('review') or tail == 'ask': return
            if git('rev-parse', '--abbrev-ref', '@{u}', check=False).returncode: return
            ahead = git('rev-list', '--count', '@{u}..HEAD', check=False).stdout.strip()
            if not ahead.isdigit() or int(ahead) == 0: return
            subject = git('log', '-1', '--format=%s', check=False).stdout.strip()[:120]
            r = git('push', '-q', '--force', 'origin', 'HEAD', check=False)
            if r.returncode:
                try_api('POST', '/api/agent/board', {'kind': 'note', 'status': f'auto-push failed: {(r.stderr or r.stdout)[-120:]}'}, timeout=5)
                return
            git('fetch', '-q', 'origin', check=False)
            api('POST', '/api/agent/status', {'state': 'pushed', 'note': f'{subject} (pushed automatically at the end of a turn: {ahead} commit{"s" if ahead != "1" else ""})'})
            print(f'qb-agent: pushed {ahead} unpushed commit(s) and reported them')
        except SystemExit: pass
        except Exception as e: print(f'qb-agent autopush: {e}', file=sys.stderr)
    elif v == 'list':
        for a in api('GET', '/api/agent/list')['agents']:
            print(f"{a['id']}  [{a['state']}]  {a['task'][:70]}")
            if a.get('note'): print(f"    note: {a['note'][:200]}")
            if a.get('claims'): print(f"    claims: {', '.join(a['claims'][:12])}")
            if a.get('landing'): print(f"    queue: {a['landing']}")
    elif v == 'hold':
        # A task held until an agent is free: the person sees it as waiting; qb-agent spawn of the same task clears it.
        if rest[:1] == ['--clear']: r = api('POST', '/api/agent/hold', {'clear': True})
        elif rest[:1] == ['--done']: r = api('POST', '/api/agent/hold', {'done': ' '.join(rest[1:])})
        elif rest: r = api('POST', '/api/agent/hold', {'task': ' '.join(rest)})
        else: sys.exit('usage: qb-agent hold "<task>" | qb-agent hold --done "<task>" | qb-agent hold --clear')
        held = r.get('held') or []
        print(f"holding {len(held)}: " + '; '.join(h['text'][:60] for h in held) if held else 'holding nothing')
    elif v == 'spawn':
        files, on, words, skeleton = [], None, [], False
        it = iter(rest)
        for w in it:
            if w == '--files': files += [f for f in next(it, '').split(',') if f]
            elif w == '--on': on = next(it, None)
            elif w == '--skeleton': skeleton = True
            else: words.append(w)
        if not words: sys.exit('usage: qb-agent spawn "task" [--files a,b] [--on <agent-id>] [--skeleton]')
        task = ' '.join(words)
        # W9c: on a board project, one quick pass checks the new task against work under way or just landed. A twin is
        # not dropped: it goes out as "a thin alias of <the original> under this task's name" (its name is still wanted).
        tw = try_api('POST', '/api/agent/twin', {'stage': 'prompt', 'task': task}, timeout=10)
        if tw and tw.get('items') and len(tw['items']) > 1:
            ans, usage, err, code = haiku(tw['prompt'])
            if ans is not None:
                t = try_api('POST', '/api/agent/twin', {'stage': 'answer', 'task': task, 'answer': ans, 'usage': usage}, timeout=10)
                if t and t.get('twin'):
                    task = t['task']
                    print(f"same work as {t['twin']['change']} (\"{t['twin']['title'][:60]}\"): handed out as a thin alias of it")
        body = {'task': task}
        if files: body['files'] = files
        if on: body['on'] = on
        if skeleton: body['skeleton'] = True
        a = api('POST', '/api/agent/spawn', body); print(f"started {a['id']}" + (f" (stacked on {on})" if on else '') + (' (the skeleton: other agents wait until it lands)' if skeleton else ''))
    elif v in ('decided', 'ask-person'):
        why, words = None, []
        it = iter(rest)
        for w in it:
            if w == '--why': why = next(it, None)
            else: words.append(w)
        if not words: sys.exit(f'usage: forq {v} "text" [--why ...]')
        body = {'text': ' '.join(words)}
        if why: body['why'] = why
        api('POST', f'/api/agent/{v}', body)
        print('logged: the person sees it in Asks' if v == 'decided' else 'asked: the person gets it in their Inbox; carry on with what you can meanwhile')
    elif v == 'parts':
        if not rest or not rest[0].isdigit(): sys.exit('usage: qb-agent parts <N>   (how many tasks you planned, the skeleton included)')
        print(api('POST', '/api/agent/parts', {'parts': int(rest[0])}))
    elif v == 'send':
        if len(rest) < 2: sys.exit('usage: qb-agent send <agent-id> "text"')
        print(api('POST', '/api/agent/send', {'agent': rest[0], 'text': ' '.join(rest[1:])}))
    elif v == 'merge':
        if not rest: sys.exit('usage: qb-agent merge <agent-id>')
        f = api('GET', '/api/agent/merge-info?agent=' + rest[0])
        if f.get('queued'):
            print(f"queued {rest[0]} for the merge queue: it lands on main once it passes the checks (state: {f.get('state')})"); return
        # The default branch is not always main (GitHub imports keep master, gh-pages…).
        br = git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD', check=False).stdout.strip().split('/', 1)[-1] or 'main'
        git('checkout', '-q', br); git('pull', '-q', '--ff-only', 'origin', br)
        git('-c', f"http.extraHeader=Authorization: Bearer {f['token']}", 'fetch', '-q', f['remote'], br)
        m = git('merge', '--no-edit', '-m', f"Merge {rest[0]}", 'FETCH_HEAD', check=False)
        if m.returncode:
            sys.exit(f'qb-agent: merge conflict - resolve in /workspace/repo, commit, then: git push origin HEAD && qb-agent merged {rest[0]}\n{m.stdout}{m.stderr}')
        git('push', '-q', 'origin', f'HEAD:{br}')
        api('POST', '/api/agent/merged', {'agent': rest[0]}); print(f'merged {rest[0]} into main')
    elif v == 'fetch-agent':
        if not rest: sys.exit('usage: qb-agent fetch-agent <agent-id>')
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
        if len(rest) < 2 or rest[1] not in ('approve', 'changes'): sys.exit('usage: qb-agent verdict <agent-id> approve|changes "notes"')
        # Say which commit was reviewed: forq refuses a verdict on an older one.
        c = git('rev-parse', f'refs/agents/{rest[0]}', check=False).stdout.strip()
        if not c: sys.exit(f'qb-agent: run "qb-agent fetch-agent {rest[0]}" first')
        api('POST', '/api/agent/verdict', {'agent': rest[0], 'verdict': rest[1], 'notes': ' '.join(rest[2:]), 'commit': c}); print('ok')
    elif v == 'sync-main':
        f = api('GET', '/api/agent/main-info')
        auth = f"http.extraHeader=Authorization: Bearer {f['token']}"
        br = f.get('branch') or 'main'
        git('-c', auth, 'fetch', '-q', f['remote'], f'+refs/heads/{br}:refs/remotes/main/{br}')
        mref = f'refs/remotes/main/{br}'
        # A rebase left half-done by an earlier sync-main is aborted first (agents stopped there, waiting for a
        # person to run git rebase --skip: W4c orders 13 and 9).
        if rebasing(): git('rebase', '--abort', check=False)
        r = git('rebase', mref, check=False)
        skipped = []
        # A commit whose change main already contains (it landed under another commit, or another agent did the
        # same task) is skipped here: its own diff reverses cleanly on main.
        while r.returncode and rebasing() and len(skipped) < 50:
            cur = git('rev-parse', 'REBASE_HEAD', check=False).stdout.strip()
            if not cur or not on_main(cur, mref): break
            skipped.append(cur[:7]); r = git('rebase', '--skip', check=False)
        if skipped: print(f"skipped {len(skipped)} commit(s) main already has: {', '.join(skipped)}")
        if r.returncode:
            sys.exit(CONFLICT_MSG + f'\n{r.stdout}{r.stderr}')
        git('push', '-q', '-f', 'origin', 'HEAD')
        print(f'rebased on main ({br}) and pushed. Run the tests, then: qb-agent status pushed "redone on the latest main"')
    elif v == 'skip':
        # The agent's own call: main already has this commit's task (another change landed it), so drop it.
        if not rebasing(): sys.exit('qb-agent: no rebase in progress (run qb-agent sync-main)')
        mref = git('for-each-ref', '--format=%(refname)', 'refs/remotes/main/', check=False).stdout.split('\n')[0].strip()
        r = git('rebase', '--skip', check=False); n = 1
        while r.returncode and rebasing() and n < 50:
            cur = git('rev-parse', 'REBASE_HEAD', check=False).stdout.strip()
            if not cur or not mref or not on_main(cur, mref): break
            n += 1; r = git('rebase', '--skip', check=False)
        if r.returncode: sys.exit(CONFLICT_MSG + f'\n{r.stdout}{r.stderr}')
        git('push', '-q', '-f', 'origin', 'HEAD')
        print(f'dropped {n} commit(s) main already has; rebased on main and pushed. If nothing of yours is left, your task is already on main: qb-agent status pushed "already on main"')
    elif v == 'push':
        # An agent's fork is its own: after sync-main (a rebase) a plain push is refused and agents would not
        # force-push without asking, so the run stalled with 'blocked' agents (board W4c r1d, 2026-10-10).
        me = secret('agent-token').rsplit('.', 1)[0]   # <agent-id>.<hmac>
        tail = me.split('--')[-1] if '--' in me else ''
        if not tail or tail.startswith('router') or tail.startswith('review') or tail == 'ask':
            sys.exit('qb-agent push is for agents on their own fork; the router pushes main with git push')
        r = git('push', '-q', '--force', 'origin', 'HEAD', check=False)
        if r.returncode: sys.exit(f'qb-agent: push failed:\n{r.stdout}{r.stderr}')
        print('pushed to your fork. Now run: qb-agent status pushed "<what you did>"')
    elif v == 'next':
        r = api('POST', '/api/agent/next', {})
        if r.get('off'): sys.exit('qb-agent next is off in this project: pick a task yourself')
        if r.get('error'): sys.exit('qb-agent: ' + r['error'])
        if r.get('none'): print('no task left: every task is done or taken. Reply "done".'); return
        print(f"your task{' (still yours)' if r.get('again') else ''}: {r['id']}: {r['text']}")
        if r.get('aliases'): print(f"also add {', '.join(r['aliases'])} as a thin alias of it: the same work under another name")
        print('It is reserved for you: no other agent gets it. When it has landed, run qb-agent next again.')
    elif v == 'tasks':
        if not rest: sys.exit('usage: qb-agent tasks <file>   (router: register the task list for qb-agent next and claims)')
        p = rest[0] if os.path.isabs(rest[0]) else os.path.join(REPO, rest[0])
        if not os.path.isfile(p): sys.exit(f'qb-agent: no such file {rest[0]}')
        r = api('POST', '/api/agent/tasks', {'text': open(p).read()})
        print(f"registered {r.get('ids', 0)} task ids ({r.get('items', 0)} items) from {rest[0]}")
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
        if not words: sys.exit('usage: qb-agent intent "what you are doing" [--files a,b]')
        r = api('POST', '/api/agent/intent', {'intent': ' '.join(words), 'files': files})
        if r.get('off'): print('the agent board is off in this project'); return
        print('on the board: ' + ' '.join(words))
        if r.get('taken'): print(r['taken'])
        if r.get('others'): print('Others on the same files, or landed on main in the last 30 min (if one of these is the same work as yours, under any name, pick another task or make yours a thin alias of it):\n' + r['others'])
    elif v == 'dedupe':
        if not rest: sys.exit('usage: qb-agent dedupe <file> | "task" "task" ...')
        p = rest[0] if len(rest) == 1 else ''
        if p and not os.path.isabs(p): p = os.path.join(REPO, p) if os.path.exists(os.path.join(REPO, p)) else p
        text = open(p).read() if p and os.path.isfile(p) else '\n'.join('- ' + w for w in rest)
        f = api('POST', '/api/agent/dedupe', {'stage': 'prompt', 'text': text})
        if len(f.get('items') or []) < 2: print('fewer than two tasks: nothing to compare'); return
        ans, usage, err, code = haiku(f['prompt'])
        if ans is None: sys.exit('qb-agent: the dedupe pass gave no answer')
        if err or '{' not in ans: print(f"qb-agent: the dedupe pass answered oddly: {ans[:300]}", file=sys.stderr)
        r = api('POST', '/api/agent/dedupe', {'stage': 'answer', 'ids': [i['id'] for i in f['items']], 'answer': ans, 'isError': err, 'exit': code, 'usage': usage})
        pairs = r.get('pairs') or []
        print(f"{len(f['items'])} tasks, {len(pairs)} pair(s) of the same work" + (':' if pairs else ''))
        for a, b in pairs: print(f'  {a} = {b}  (build it once; the other is a thin alias)')
    elif v == 'merged':
        api('POST', '/api/agent/merged', {'agent': rest[0]}); print('ok')
    else:
        sys.exit(f'qb-agent: unknown verb {v}. Try: qb-agent help')

main(sys.argv[1:])
`;
