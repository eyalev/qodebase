var __defProp = Object.defineProperty;
var __knownSymbol = (name, symbol) => (symbol = Symbol[name]) ? symbol : /* @__PURE__ */ Symbol.for("Symbol." + name);
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __using = (stack, value, async) => {
  if (value != null) {
    if (typeof value !== "object" && typeof value !== "function") __typeError("Object expected");
    var dispose, inner;
    if (async) dispose = value[__knownSymbol("asyncDispose")];
    if (dispose === void 0) {
      dispose = value[__knownSymbol("dispose")];
      if (async) inner = dispose;
    }
    if (typeof dispose !== "function") __typeError("Object not disposable");
    if (inner) dispose = function() {
      try {
        inner.call(this);
      } catch (e) {
        return Promise.reject(e);
      }
    };
    stack.push([async, dispose, value]);
  } else if (async) {
    stack.push([async]);
  }
  return value;
};
var __callDispose = (stack, error, hasError) => {
  var E = typeof SuppressedError === "function" ? SuppressedError : function(e, s, m, _) {
    return _ = Error(m), _.name = "SuppressedError", _.error = e, _.suppressed = s, _;
  };
  var fail = (e) => error = hasError ? new E(e, error, "An error was suppressed during disposal") : (hasError = true, e);
  var next = (it) => {
    while (it = stack.pop()) {
      try {
        var result = it[1] && it[1].call(it[2]);
        if (it[0]) return Promise.resolve(result).then(next, (e) => (fail(e), next()));
      } catch (e) {
        fail(e);
      }
    }
    if (hasError) throw error;
  };
  return next();
};

// ../src/fresh.ts
var esc = /* @__PURE__ */ __name((s) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]), "esc");
var freshLevel = /* @__PURE__ */ __name((ts, now, steps) => steps.filter((h) => Math.max(0, now - ts) < h * 36e5).length, "freshLevel");
var relShort = /* @__PURE__ */ __name((ts, now) => {
  const s = Math.max(0, Math.round((now - ts) / 1e3));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 60) return `${Math.floor(s / 86400)}d ago`;
  if (s < 86400 * 730) return `${Math.floor(s / 86400 / 30)} mo ago`;
  return `${Math.floor(s / 86400 / 365)}y ago`;
}, "relShort");
var freshTag = /* @__PURE__ */ __name((ts, now, steps) => {
  const l = freshLevel(ts, now, steps);
  return `<button type="button" class="fresh${l === 4 ? " is-new" : ""}" style="--l:${l}" popovertarget="fresh-help" aria-label="${esc(relShort(ts, now))}, how recent"><span class="fresh-t">${esc(relShort(ts, now))}</span></button>`;
}, "freshTag");
var span = /* @__PURE__ */ __name((h) => h === 24 ? "a day" : h > 48 && h % 24 === 0 ? `${h / 24} days` : h === 1 ? "1 hour" : `${h} hours`, "span");
var freshLegend = /* @__PURE__ */ __name((steps) => `<p class="fresh-legend">The shading behind a date shows how recent it is: full within ${span(steps[3])}, empty after ${span(steps[0])}.</p>`, "freshLegend");
var freshHelp = /* @__PURE__ */ __name((steps) => `<div id="fresh-help" popover class="fresh-pop"><b>How recent</b>
  <p>The shading behind a date fills in quarters: under ${[...steps].reverse().map(span).join(", under ")}. Empty means older than ${span(steps[0])}.</p>
  <button type="button" class="chipbtn" popovertarget="fresh-help" popovertargetaction="hide">Close</button></div>`, "freshHelp");
var FRESH_CSS = `
:root{--fresh:color-mix(in srgb,var(--fg) 22%,var(--card))}
button.fresh{display:inline-block;font:inherit;font-size:12px;line-height:1.35;color:var(--dim);border:0;border-radius:4px;
 margin:-1px 0;padding:1px 6px;min-width:var(--fresh-w,6.4em);text-align:left;font-variant-numeric:tabular-nums;cursor:help;vertical-align:baseline;
 background:linear-gradient(to right,var(--fresh) calc(var(--l,0) * 25%),var(--chip) 0);box-shadow:inset 0 0 0 1px var(--line)}
button.fresh.is-new{color:var(--fg)}
.fresh-legend{color:var(--dim);font-size:12px;margin:0 0 8px}
.fresh-pop{max-width:min(340px,calc(100vw - 32px));border:1px solid var(--line);border-radius:12px;padding:14px;background:var(--card);color:var(--fg);font-size:14px}
.fresh-pop p{margin:6px 0 10px;color:var(--dim)}
.fresh-pop::backdrop{background:rgb(0 0 0 / .25)}
`;

// ../src/md.ts
var esc2 = /* @__PURE__ */ __name((s) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]), "esc");
function inline(s) {
  const codes = [];
  let t = esc2(s).replace(/`([^`]+)`/g, (_, c) => `\0${codes.push(`<code>${c}</code>`) - 1}\0`);
  t = t.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a || b}</strong>`).replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,!?:;]|$)|(^|[\s(])_([^_\s][^_]*)_(?=[\s).,!?:;]|$)/g, (_, p1, a, p2, b) => `${p1 ?? p2 ?? ""}<em>${a || b}</em>`).replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener nofollow">$1</a>').replace(/\[([^\]]+)\]\((?!https?:)[^)\s]+\)/g, "$1").replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,!?:;'"])/g, '$1<a href="$2" rel="noopener nofollow">$2</a>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}
__name(inline, "inline");
function stripHtml(src) {
  return src.split(/(^```[\s\S]*?^```)/m).map((part, i) => i % 2 ? part : stripTags(part)).join("");
}
__name(stripHtml, "stripHtml");
function stripImages(src) {
  return src.split(/(`[^`\n]*`)/).map((part, i) => i % 2 ? part : stripImagesIn(part)).join("");
}
__name(stripImages, "stripImages");
function stripImagesIn(src) {
  return src.replace(/\[!\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])\](?:\([^)]*\)|\[[^\]]*\])/g, "").replace(/!\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])/g, "").replace(/^\s{0,3}\[[^\]]+\]:\s*\S+.*$/gm, "").replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1");
}
__name(stripImagesIn, "stripImagesIn");
function stripTags(src) {
  return stripImages(src).replace(/<!--[\s\S]*?-->/g, "").replace(/<br\s*\/?>/gi, "\n").replace(/<img\b[^>]*>/gi, "").replace(/<\/?(?:a|p|div|span|h[1-6]|b|strong|i|em|center|sup|sub|picture|source|details|summary|table|tr|td|th|thead|tbody|kbd|code)\b[^>]*>/gi, "");
}
__name(stripTags, "stripTags");
function markdown(src) {
  const out = [];
  const lines = stripHtml(src).replace(/\r/g, "").split("\n");
  let para = [], list = [], code = null, ordered = false, table2 = [];
  const cells = /* @__PURE__ */ __name((r) => r.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|")), "cells");
  const flushTable = /* @__PURE__ */ __name(() => {
    if (!table2.length) return;
    if (table2.length >= 2 && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(table2[1])) {
      const head3 = cells(table2[0]), body = table2.slice(2).map(cells);
      const th = head3.some((c) => c) ? `<thead><tr>${head3.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>` : "";
      out.push(`<div class="tbl"><table>${th}<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
    } else out.push(`<p>${inline(table2.join(" "))}</p>`);
    table2 = [];
  }, "flushTable");
  const flush = /* @__PURE__ */ __name(() => {
    flushTable();
    if (para.length) {
      out.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
    if (list.length) {
      const tag2 = ordered ? "ol" : "ul";
      out.push(`<${tag2}>${list.map((l) => `<li>${inline(l)}</li>`).join("")}</${tag2}>`);
      list = [];
    }
  }, "flush");
  for (const line of lines) {
    if (code) {
      if (line.startsWith("```")) {
        out.push(`<pre><code>${esc2(code.join("\n"))}</code></pre>`);
        code = null;
      } else code.push(line);
      continue;
    }
    if (line.startsWith("```")) {
      flush();
      code = [];
      continue;
    }
    if (line.trim().startsWith("|")) {
      if (!table2.length) flush();
      table2.push(line);
      continue;
    }
    if (table2.length) flush();
    if (para.length === 1 && /^(=+|-+)\s*$/.test(line)) {
      const n = line.trim()[0] === "=" ? 2 : 3;
      out.push(`<h${n}>${inline(para[0])}</h${n}>`);
      para = [];
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      out.push("<hr>");
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      flush();
      const n = Math.min(h[1].length + 1, 4);
      out.push(`<h${n}>${inline(h[2])}</h${n}>`);
      continue;
    }
    const li = line.match(/^\s*[-*+]\s+(.*)/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (li || ol) {
      if (para.length || list.length && ordered !== !!ol) flush();
      ordered = !!ol;
      list.push((li || ol)[1]);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (list.length) flush();
    para.push(line.trim());
  }
  if (code) out.push(`<pre><code>${esc2(code.join("\n"))}</code></pre>`);
  flush();
  return out.join("\n");
}
__name(markdown, "markdown");

// ../src/box.ts
import { DurableObject as DurableObject2 } from "cloudflare:workers";

// ../src/cli.ts
var FORQ_CLI = String.raw`#!/usr/bin/env python3
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

// ../src/registry.ts
import { DurableObject } from "cloudflare:workers";
var Registry = class extends DurableObject {
  static {
    __name(this, "Registry");
  }
  async list() {
    const m = await this.ctx.storage.list({ prefix: "p:" });
    return [...m.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async get(slug) {
    return await this.ctx.storage.get(`p:${slug}`) || null;
  }
  async put(e) {
    await this.ctx.storage.put(`p:${e.slug}`, e);
  }
  async touch(slug, at = Date.now()) {
    const e = await this.get(slug);
    if (e) {
      e.updatedAt = at;
      await this.put(e);
    }
  }
  // ---- users: u:<email> → User, h:<handle> → email
  async getUser(email) {
    return await this.ctx.storage.get(`u:${email}`) || null;
  }
  async getUserByHandle(handle) {
    const email = await this.ctx.storage.get(`h:${handle}`);
    return email ? this.getUser(email) : null;
  }
  async putUser(u) {
    const old = await this.getUser(u.email);
    if (old && old.handle !== u.handle) await this.ctx.storage.delete(`h:${old.handle}`);
    await this.ctx.storage.put({ [`u:${u.email}`]: u, [`h:${u.handle}`]: u.email });
  }
  async userCount() {
    return (await this.ctx.storage.list({ prefix: "u:" })).size;
  }
  // ---- CLI sign-in (src/cliauth.ts): cd:<device hash> → pending login,
  // cu:<user code> → device hash, ct:<token hash> → CliToken. Only hashes are stored.
  async cliStart(deviceHash, userCode2, exp) {
    const old = await this.ctx.storage.list({ prefix: "cd:" });
    const dead = [...old].filter(([, v]) => v.exp < Date.now()).flatMap(([k2, v]) => [k2, `cu:${v.userCode}`]);
    if (dead.length) await this.ctx.storage.delete(dead);
    await this.ctx.storage.put({ [`cd:${deviceHash}`]: { userCode: userCode2, exp }, [`cu:${userCode2}`]: deviceHash });
  }
  async cliPending(userCode2) {
    const dh = await this.ctx.storage.get(`cu:${userCode2}`);
    const p = dh ? await this.ctx.storage.get(`cd:${dh}`) : null;
    return p && p.exp > Date.now() ? p : null;
  }
  async cliApprove(userCode2, email, label2) {
    const dh = await this.ctx.storage.get(`cu:${userCode2}`);
    const p = dh ? await this.ctx.storage.get(`cd:${dh}`) : null;
    if (!dh || !p || p.exp < Date.now() || p.email) return false;
    await this.ctx.storage.put(`cd:${dh}`, { ...p, email, label: label2 });
    return true;
  }
  /** The approved login for this device, once: stores the new token's hash and forgets the login. */
  async cliClaim(deviceHash, tokenHash) {
    const p = await this.ctx.storage.get(`cd:${deviceHash}`);
    if (!p || p.exp < Date.now()) return { status: "expired" };
    if (!p.email) return { status: "pending" };
    await this.ctx.storage.delete([`cd:${deviceHash}`, `cu:${p.userCode}`]);
    const t = { email: p.email, label: p.label || "CLI", createdAt: Date.now(), usedAt: Date.now(), id: tokenHash.slice(0, 8) };
    await this.ctx.storage.put(`ct:${tokenHash}`, t);
    return { status: "ok", email: p.email };
  }
  async cliToken(tokenHash) {
    const t = await this.ctx.storage.get(`ct:${tokenHash}`);
    if (t && Date.now() - t.usedAt > 36e5) {
      t.usedAt = Date.now();
      await this.ctx.storage.put(`ct:${tokenHash}`, t);
    }
    return t || null;
  }
  async cliTokens(email) {
    const m = await this.ctx.storage.list({ prefix: "ct:" });
    return [...m.values()].filter((t) => t.email === email).sort((a, b) => b.createdAt - a.createdAt);
  }
  async cliRevoke(email, id) {
    const m = await this.ctx.storage.list({ prefix: "ct:" });
    const hit = [...m].find(([, t]) => t.email === email && t.id === id);
    if (hit) await this.ctx.storage.delete(hit[0]);
    return !!hit;
  }
  // ---- managed boxes: the instance's base snapshot (box.ts #setup)
  async getBaseSnap(v) {
    const b = await this.ctx.storage.get("baseSnap");
    return b && b.v === v ? b.snap : null;
  }
  async setBaseSnap(b) {
    if (b) await this.ctx.storage.put("baseSnap", b);
    else await this.ctx.storage.delete("baseSnap");
  }
  async remove(slug) {
    await this.ctx.storage.delete(`p:${slug}`);
  }
};
var registry = /* @__PURE__ */ __name((env) => env.Registry.get(env.Registry.idFromName("main")), "registry");
var canSee = /* @__PURE__ */ __name((e, handle, admin = false) => !!e && (!e.private || admin || !!handle && e.owner === handle), "canSee");
async function listFor(env, handle, admin = false) {
  return (await registry(env).list()).filter((e) => canSee(e, handle, admin));
}
__name(listFor, "listFor");

// ../src/box.ts
import BOOT_SH from "./116cd79a380f66dbb7c940a88ebd1bf1d443bd9d-boot.sh";
import BOX_API from "./47d0a22a41a1936a0e7f7a6c7e16578c568166f2-box-api.mjs";
var MA_PORT = 7901;
var TW_PORT = 7681;
var IDLE_MS = 5 * 6e4;
var BUSY_MAX_MS = 4 * 60 * 6e4;
var ALARM_EVERY_MS = 6e4;
var SNAPSHOT_EVERY_MS = 15 * 6e4;
var INACTIVITY_BACKSTOP_MS = 45 * 6e4;
var INSTANCE = { vcpu: 1, memoryMib: 3072, diskMb: 8e3 };
var INPUT_EMPTY_SH = String.raw`tmux capture-pane -p -t claude | python3 -c "
import sys
L=[l.rstrip() for l in sys.stdin.read().splitlines()]
r=[i for i,l in enumerate(L) if l.startswith(chr(0x2500)*10)]
above=[l for l in (L[:r[-1]] if r else []) if l.strip()]
last=above[-1].strip() if above else ''
sys.exit(0 if last in (chr(0x276f), '') else 1)
"`;
var ENTRYPOINT = ["/bin/bash", "-c", "chown 0:0 / 2>/dev/null; mkdir -p /workspace /run/opendev /run/forq && chmod 700 /run/opendev /run/forq && exec sleep infinity"];
var REPO_DIR = "/workspace/repo";
function log(module, event, fields = {}) {
  console.log(JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), module, event, ...fields }));
}
__name(log, "log");
var MANAGED_IMAGE = "cloudflare/debian-trixie";
var SETUP_V = 1;
var MA_BASE_REF = "9aa1a4d82a79";
var MANAGED_SETUP = String.raw`set -e
export DEBIAN_FRONTEND=noninteractive HOME=/root PATH=/root/.local/bin:/usr/local/bin:$PATH
fail() { echo "[forq] setup failed: $1"; touch /opt/forq-setup-failed; exit 1; }
rm -f /opt/forq-setup-failed
echo "[forq] apt"; { apt-get update -qq && apt-get install -y -qq --no-install-recommends ca-certificates curl git jq python3 tmux ncurses-term procps > /dev/null; } || fail apt
echo "[forq] claude code"; npm i -g --allow-scripts=@anthropic-ai/claude-code @anthropic-ai/claude-code > /tmp/forq-npm.log 2>&1 || fail claude-code
echo "[forq] mobile-agent"; rm -rf /opt/mobile-agent && git clone -q https://github.com/eyalev/mobile-agent.git /opt/mobile-agent || fail clone
(cd /opt/mobile-agent && git checkout -q "$MA_BASE_REF" && rm -rf .git && npm ci --omit=dev --no-audit --no-fund > /tmp/forq-ma-npm.log 2>&1) || fail mobile-agent
printf '%s' "$BOOT_SH" > /opt/boot.sh && chmod +x /opt/boot.sh
printf '%s' "$BOX_API" > /opt/box-api.mjs
rm -rf /var/lib/apt/lists/* /root/.npm/_cacache
echo "$SETUP_V" > /opt/forq-ready
echo "[forq] ready"`;
var AgentBox = class extends DurableObject2 {
  static {
    __name(this, "AgentBox");
  }
  #booting = null;
  constructor(ctx, env) {
    super(ctx, env);
    const c = ctx.container;
    if (c?.running) {
      void ctx.blockConcurrencyWhile(async () => {
        await c.setInactivityTimeout(INACTIVITY_BACKSTOP_MS);
        if (await ctx.storage.getAlarm() === null) await ctx.storage.setAlarm(Date.now() + ALARM_EVERY_MS);
        log("box", "rearmed_after_restart");
      });
    }
  }
  get c() {
    const c = this.ctx.container;
    if (!c) throw new Error("DO is not container-enabled (check wrangler.jsonc)");
    return c;
  }
  /** The image a fresh box starts from: forq's registry image, or Cloudflare's managed one. */
  #image() {
    return this.env.BOX_IMAGE === "managed" ? MANAGED_IMAGE : this.c.images.computer;
  }
  /** Managed boxes: install what the image would have (MANAGED_SETUP), in the background,
   *  polled with short execs; then make it the instance's base snapshot if there is none. */
  async #setup(agentId) {
    const t0 = Date.now();
    const have = await this.#sh("cat /opt/forq-ready 2>/dev/null");
    if (have.stdout.trim() === String(SETUP_V)) return { ok: true };
    await this.#sh('(setsid bash -c "$SETUP" > /tmp/forq-setup.log 2>&1 < /dev/null &)', { SETUP: MANAGED_SETUP, BOOT_SH, BOX_API, MA_BASE_REF, SETUP_V: String(SETUP_V) });
    log("box", "setup_started", { agentId });
    for (let i = 0; i < 200; i++) {
      await new Promise((r) => setTimeout(r, 3e3));
      const st = await this.#sh("if [ -f /opt/forq-ready ]; then echo ready; elif [ -f /opt/forq-setup-failed ]; then echo failed; tail -15 /tmp/forq-setup.log /tmp/forq-npm.log /tmp/forq-ma-npm.log 2>/dev/null; else echo working; fi");
      const out = st.stdout.trim();
      if (out.startsWith("ready")) {
        log("box", "setup_done", { agentId, ms: Date.now() - t0 });
        if (!await registry(this.env).getBaseSnap(SETUP_V)) {
          try {
            const snap = await this.c.snapshotContainer({ name: `base-v${SETUP_V}` });
            await registry(this.env).setBaseSnap({ snap, v: SETUP_V });
            log("box", "base_snapshot", { agentId, id: snap.id, sizeMB: Math.round(snap.size / 1e6) });
          } catch (e) {
            log("box", "base_snapshot_failed", { agentId, err: String(e) });
          }
        }
        return { ok: true };
      }
      if (out.startsWith("failed")) {
        log("box", "setup_failed", { agentId, ms: Date.now() - t0, tail: out.slice(-1500) });
        return { ok: false, error: `box setup failed: ${out.slice(6, 400).trim()}` };
      }
    }
    log("box", "setup_timeout", { agentId });
    return { ok: false, error: "box setup took over 10 minutes" };
  }
  async #sh(cmd, env = {}) {
    const p = await this.c.exec(["bash", "-c", cmd], { env });
    const o = await p.output();
    const dec = new TextDecoder();
    return { exitCode: o.exitCode, stdout: dec.decode(o.stdout), stderr: dec.decode(o.stderr) };
  }
  async #maUp() {
    if (!this.c.running) return false;
    try {
      const r = await this.c.getTcpPort(MA_PORT).fetch("http://container/", { signal: AbortSignal.timeout(3e3) });
      return r.status < 500;
    } catch {
      return false;
    }
  }
  async isAwake() {
    return !!this.ctx.container?.running;
  }
  /** For the page's progress line: is it booting, and has its task gone in yet? */
  async phase() {
    return { awake: !!this.ctx.container?.running, booting: !!this.#booting, taskSent: !!await this.ctx.storage.get("taskSent") };
  }
  async touch(agentId) {
    await this.ctx.storage.put("lastActive", Date.now());
    await this.ctx.storage.put("agentId", agentId);
    if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now() + ALARM_EVERY_MS);
  }
  ensureUp(spec) {
    if (!this.#booting) this.#booting = this.#boot(spec).finally(() => {
      this.#booting = null;
    });
    return this.#booting;
  }
  async #boot(spec) {
    const t0 = Date.now();
    await this.touch(spec.agentId);
    if (await this.#maUp()) return { ok: true, ms: 0, from: "running" };
    let from = "running";
    if (!this.c.running) {
      const snap = await this.ctx.storage.get("snapshot");
      const managed = this.env.BOX_IMAGE === "managed";
      const base = !snap && managed ? await registry(this.env).getBaseSnap(SETUP_V) : null;
      from = snap ? "snapshot" : base ? "base" : "image";
      try {
        this.c.start({
          instance: INSTANCE,
          enableInternet: true,
          entrypoint: ENTRYPOINT,
          ...snap ? { containerSnapshot: snap } : base ? { containerSnapshot: base } : { image: this.#image() }
        });
        await this.#sh("true");
      } catch (e) {
        if (base) await registry(this.env).setBaseSnap(null);
        log("box", "start_failed", { agentId: spec.agentId, from, snapshot: snap?.id, err: String(e), stack: e?.stack });
        if (!snap && !base) return { ok: false, ms: Date.now() - t0, from, error: String(e) };
        if (snap) {
          const lost = await this.ctx.storage.get("failedSnapshots") || [];
          lost.push(snap);
          await this.ctx.storage.put("failedSnapshots", lost);
          await this.ctx.storage.delete("snapshot");
        }
        try {
          if (this.c.running) await this.c.destroy();
        } catch {
        }
        from = "image-after-failed-restore";
        this.c.start({ instance: INSTANCE, enableInternet: true, entrypoint: ENTRYPOINT, image: this.#image() });
        await this.#sh("true");
      }
      await this.c.setInactivityTimeout(INACTIVITY_BACKSTOP_MS);
      this.#watchExit(spec.agentId, from);
    }
    if (this.env.BOX_IMAGE === "managed") {
      const st = await this.#setup(spec.agentId);
      if (!st.ok) return { ok: false, ms: Date.now() - t0, from, error: st.error };
    }
    const repo = await this.#sh(`set -e
      mkdir -p /run/forq && chmod 700 /run/forq
      printf '%s' "\${GIT_TOKEN%%\\?expires=*}" > /run/forq/git-token
      git config --global credential.helper '!f() { echo username=x; echo "password=$(cat /run/forq/git-token)"; }; f'
      git config --global user.name "forq agent $AGENT_ID"
      git config --global user.email "agent+$AGENT_ID@$UI_HOST"
      git config --global init.defaultBranch main
      if [ ! -d ${REPO_DIR}/.git ]; then
        git clone -q "$REMOTE" ${REPO_DIR}
      fi
      echo ${REPO_DIR} > /workspace/.sbx-cwd
      # Trust ${REPO_DIR} before Claude Code starts. boot.sh only pre-trusts
      # /workspace/project; without this the trust dialog's default "No, exit"
      # took the task's Enter and Claude Code quit (2026-10-01, first agent).
      python3 - <<'PY'
import json
p = '/workspace/claude-config.json'
try: d = json.load(open(p))
except Exception: d = {"hasCompletedOnboarding": True, "theme": "dark", "bypassPermissionsModeAccepted": True}
for k in ('/workspace/project', '${REPO_DIR}'):
    d.setdefault('projects', {}).setdefault(k, {})['hasTrustDialogAccepted'] = True
json.dump(d, open(p, 'w'))
PY
      printf '%s' "$AGENT_TOKEN" > /run/forq/agent-token
      printf '%s' "$API_BASE" > /run/forq/api
      printf '%s' "$FORQ_CLI" > /usr/local/bin/forq && chmod 755 /usr/local/bin/forq
      # An empty repo (a self-hosted copy's Build starts empty) has no commit to show yet.
      git -C ${REPO_DIR} log --oneline -1 2>/dev/null || echo '(empty repository)'`, {
      GIT_TOKEN: spec.gitToken,
      REMOTE: spec.remote,
      AGENT_ID: spec.agentId,
      UI_HOST: spec.uiHost,
      AGENT_TOKEN: spec.agentToken,
      API_BASE: spec.apiBase,
      FORQ_CLI
    });
    log("box", "repo_ready", { agentId: spec.agentId, exit: repo.exitCode, head: repo.stdout.trim().slice(-80), err: repo.stderr.slice(-300) });
    if (repo.exitCode !== 0) return { ok: false, ms: Date.now() - t0, from, error: `clone failed: ${repo.stderr.slice(-200)}` };
    const ma = await this.#sh(`set -e
      [ "$(cat /opt/mobile-agent/.forq-rev 2>/dev/null)" = "$MA_REV" ] && { echo current; exit 0; }
      curl -sfS --max-time 30 -A forq-cli/1 -H "x-forq-agent: $(cat /run/forq/agent-token)" "$(cat /run/forq/api)/api/agent/mobile-agent.tgz" -o /tmp/ma.tgz
      tar xzf /tmp/ma.tgz -C /opt/mobile-agent && rm -f /tmp/ma.tgz
      printf '%s' "$MA_REV" > /opt/mobile-agent/.forq-rev && echo updated`, { MA_REV: spec.maRev });
    log("box", "mobile_agent", { agentId: spec.agentId, rev: spec.maRev, exit: ma.exitCode, out: ma.stdout.trim().slice(-40), err: ma.stderr.slice(-200) });
    const boot = await this.#sh(`set +e
      mkdir -p /run/opendev && chmod 700 /run/opendev
      printf '%s' "$BOOT_ENV" > /run/opendev/boot.env && ln -sfn /run/opendev/boot.env /tmp/boot.env
      sed -e "s#--allow-origin opendev.page#--allow-origin $UI_HOST#" -e "s#https://opendev.page/dashboard#https://$UI_HOST/#" /opt/boot.sh > /tmp/forq-boot.sh
      (setsid bash /tmp/forq-boot.sh > /tmp/boot.log 2>&1 < /dev/null &)
      for i in $(seq 1 450); do grep -q MA_READY /tmp/boot.log && break; sleep 0.2; done
      for i in $(seq 1 100); do grep -q TW_READY /tmp/boot.log && break; sleep 0.2; done
      for i in $(seq 1 150); do tmux capture-pane -p -t claude 2>/dev/null | grep -qE 'for shortcuts|auto mode|shift\\+tab' && break; sleep 0.2; done
      if [ -f /tmp/boot.env ] && [ ! -L /tmp/boot.env ]; then mv /tmp/boot.env /run/opendev/boot.env && ln -sfn /run/opendev/boot.env /tmp/boot.env; fi
      grep -c MA_READY /tmp/boot.log`, { BOOT_ENV: spec.bootEnv, UI_HOST: spec.uiHost });
    const ok = boot.stdout.trim().endsWith("1");
    log("box", "booted", { agentId: spec.agentId, from, ok, ms: Date.now() - t0, tail: ok ? void 0 : boot.stdout.slice(-300) + boot.stderr.slice(-300) });
    if (!ok) return { ok, ms: Date.now() - t0, from, error: "boot.sh did not report MA_READY" };
    if (!await this.ctx.storage.get("taskSent")) {
      const sent = await this.send(taskPrompt(spec));
      log("box", "task_sent", { agentId: spec.agentId, ok: sent.ok, err: sent.error });
      if (sent.ok) await this.ctx.storage.put("taskSent", true);
    }
    return { ok: true, ms: Date.now() - t0, from };
  }
  /** Type a message into the box's Claude Code (via the in-box tmux-web). */
  async send(text) {
    const alive = await this.#sh(`pgrep -x claude >/dev/null`);
    if (alive.exitCode !== 0) {
      log("box", "send_refused", { why: "no claude process" });
      return { ok: false, error: "Claude Code is not running in the pane" };
    }
    const status = await this.ccStatus();
    if (status === "untrusted") return { ok: false, error: "Claude Code is waiting on its folder-trust prompt" };
    const ready = await this.#sh(`for i in $(seq 1 30); do tmux capture-pane -p -t claude | grep -q '^\u276F' && tmux capture-pane -p -t claude | grep -qE 'for shortcuts|auto mode|shift\\+tab' && exit 0; sleep 0.5; done; exit 1`);
    if (ready.exitCode !== 0) log("box", "send_not_ready", { agentId: await this.ctx.storage.get("agentId") });
    const REPLIES = `tmux capture-pane -p -S - -t claude | grep -c '^\u25CF '`;
    const before = Number((await this.#sh(REPLIES).catch(() => null))?.stdout.trim() || 0);
    const r = await this.c.getTcpPort(TW_PORT).fetch("http://container/api/conversation/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session: "claude", text, delay: text.includes("\n") ? 1500 : 500 })
    });
    if (!r.ok) return { ok: false, error: `${r.status} ${(await r.text()).slice(0, 200)}` };
    const check = await this.#sh(`set +e
      for i in 1 2 3 4 5 6; do
        sleep 1
        ${INPUT_EMPTY_SH} && { echo submitted; exit 0; }
        if [ $i -eq 3 ] || [ $i -eq 5 ]; then tmux send-keys -t claude Enter; echo enter; fi
      done
      echo unsent`);
    const outcome = check.stdout.trim().split("\n");
    if (outcome.includes("enter")) log("box", "send_extra_enter", { agentId: await this.ctx.storage.get("agentId"), outcome: outcome.join(",") });
    if (outcome.includes("unsent")) {
      const st = await this.ccStatus();
      const pane2 = await this.#sh(`tmux capture-pane -p -t claude | tail -14`).catch(() => null);
      log("box", "send_unsent", { agentId: await this.ctx.storage.get("agentId"), cc: st, pane: pane2?.stdout });
      if (/busy|thinking|working|running|tool|compact/i.test(st)) return { ok: true };
      return { ok: false, error: "typed but not submitted (still in the input box)" };
    }
    for (let i = 0; i < 15; i++) {
      if (/busy|thinking|working|running|tool|compact/i.test(await this.ccStatus())) return { ok: true };
      if (Number((await this.#sh(REPLIES).catch(() => null))?.stdout.trim() || 0) > before) return { ok: true };
      await new Promise((res) => setTimeout(res, 1e3));
    }
    const pane = await this.#sh(`tmux capture-pane -p -t claude | tail -14`).catch(() => null);
    log("box", "send_not_started", { agentId: await this.ctx.storage.get("agentId"), pane: pane?.stdout });
    return { ok: false, error: "Claude Code did not start working on the message" };
  }
  /** Start Claude Code on a fresh conversation (/clear). Typing "/clear" opens
   *  the slash-command menu and the first Enter only picks the entry, so this
   *  presses Enter again while the input still holds the command. */
  async clearContext() {
    if (!this.c.running) return false;
    const r = await this.#sh(`set +e
      pgrep -x claude >/dev/null || exit 3
      # Leftover text in the input (an unsent earlier request): one Ctrl-C empties
      # it. Only when non-empty: on an empty input Ctrl-C starts "press again to exit".
      ${INPUT_EMPTY_SH} || { tmux send-keys -t claude C-c; sleep 0.6; }
      tmux send-keys -t claude Escape; sleep 0.3
      tmux send-keys -t claude -l '/clear'; sleep 0.8
      for i in 1 2 3; do
        tmux send-keys -t claude Enter; sleep 1.2
        if ! tmux capture-pane -p -t claude | grep -q '^\u276F /clear'; then
          # Settle: text typed while Claude Code is still finishing /clear is
          # lost (a review request vanished this way, 2026-10-01). Wait for the
          # empty prompt and its hint line before anyone types.
          for j in $(seq 1 20); do
            tmux capture-pane -p -t claude | grep -q '^\u276F *$' && tmux capture-pane -p -t claude | grep -qE 'for shortcuts|auto mode|shift\\+tab' && { sleep 1; exit 0; }
            sleep 0.5
          done
          exit 0
        fi
      done
      exit 4`);
    log("box", "clear_context", { agentId: await this.ctx.storage.get("agentId"), exit: r.exitCode });
    return r.exitCode === 0;
  }
  /** Claude Code's state (busy/idle/…). tmux-web's cc-status misses spinner
   *  words it does not know ("Flowing…" read as idle while the reviewer worked,
   *  2026-10-02), so a spinner line on screen always means busy: a glyph, a
   *  capitalised word ending in "…", then "(" and a running time. The glyph is
   *  matched as "not a space": the box's shell is in the C locale, where \S is
   *  one byte and never matches a 3-byte glyph like ✢. */
  async ccStatus() {
    if (!this.c.running) return "asleep";
    let st = "unknown";
    try {
      const r = await this.c.getTcpPort(TW_PORT).fetch("http://container/api/sessions/claude/cc-status", { signal: AbortSignal.timeout(3e3) });
      st = (await r.json()).status || "unknown";
    } catch {
    }
    if (/busy|thinking|working|running|tool|compact/i.test(st)) return st;
    const pane = await this.#sh(`tmux capture-pane -p -t claude 2>/dev/null | grep -cE '^[^ ]+ [A-Z][a-z]+\u2026 \\([0-9]+(m|s)'`).catch(() => null);
    return pane && Number(pane.stdout.trim()) > 0 ? "busy" : st;
  }
  /** The router's (or an agent's) latest reply, for the project page. */
  async lastReply() {
    if (!this.c.running) return void 0;
    try {
      const r = await this.c.getTcpPort(TW_PORT).fetch("http://container/api/conversation?session=claude&tail=80", { signal: AbortSignal.timeout(3e3) });
      if (!r.ok) return void 0;
      const { messages } = await r.json();
      const last = messages.filter((m) => m.type === "assistant_text" && (m.text || "").trim()).pop();
      return last?.text?.trim().slice(0, 600);
    } catch {
      return void 0;
    }
  }
  #watchExit(agentId, from) {
    const started = Date.now();
    this.c.monitor().then(
      () => log("box", "container_exit", { agentId, from, clean: true, ranMs: Date.now() - started }),
      (e) => log("box", "container_exit", { agentId, from, clean: false, ranMs: Date.now() - started, exitCode: e?.exitCode, err: String(e) })
    );
  }
  async #agentBusy() {
    try {
      const r = await this.c.getTcpPort(MA_PORT).fetch("http://container/api/p/terminal/states", { signal: AbortSignal.timeout(3e3) });
      if (!r.ok) return false;
      return !!(await r.json()).busy;
    } catch {
      return false;
    }
  }
  async snapshot(why) {
    if (!this.c.running) return null;
    const t0 = Date.now();
    try {
      await this.#sh(`[ -L /tmp/boot.env ] || rm -f /tmp/boot.env; sync`);
      const agentId = await this.ctx.storage.get("agentId");
      const snap = await this.c.snapshotContainer({ name: `${agentId || "agent"}-${why}` });
      await this.ctx.storage.put("snapshot", snap);
      await this.ctx.storage.put("lastSnapshot", Date.now());
      log("box", "snapshot", { agentId, why, ms: Date.now() - t0, id: snap.id, sizeMB: Math.round(snap.size / 1e6) });
      return snap;
    } catch (e) {
      log("box", "snapshot_failed", { why, ms: Date.now() - t0, err: String(e), stack: e?.stack });
      return null;
    }
  }
  async letGo(why) {
    if (!this.c.running) return;
    const snap = await this.snapshot(why);
    if (!snap) {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_EVERY_MS);
      return;
    }
    await this.c.destroy();
    log("box", "let_go", { why, agentId: await this.ctx.storage.get("agentId") });
  }
  /** Delete the agent: stop without a snapshot and forget everything. */
  async destroy() {
    try {
      if (this.c.running) await this.c.destroy();
    } catch {
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
  async alarm() {
    const agentId = await this.ctx.storage.get("agentId");
    if (!this.c.running) {
      log("box", "alarm_not_running", { agentId });
      return;
    }
    const idle = Date.now() - (await this.ctx.storage.get("lastActive") || 0);
    let keep = idle < IDLE_MS;
    let busy = false;
    if (!keep && idle < BUSY_MAX_MS) {
      const [ma, cc] = await Promise.all([this.#agentBusy(), this.ccStatus().catch(() => "unknown")]);
      busy = ma || /busy|thinking|working|running|tool|compact/i.test(cc);
      keep = busy;
      if (busy !== ma) log("box", "busy_by_cc_status", { agentId, ma, cc });
    }
    log("box", "alarm", { agentId, idleS: Math.round(idle / 1e3), busy, keep });
    if (keep) {
      const last = await this.ctx.storage.get("lastSnapshot") || 0;
      if (Date.now() - last > SNAPSHOT_EVERY_MS) await this.snapshot("periodic");
      await this.ctx.storage.setAlarm(Date.now() + ALARM_EVERY_MS);
      return;
    }
    log("box", "idle_stop", { agentId, idleMin: Math.round(idle / 6e4) });
    await this.letGo("idle");
  }
  /** Proxy to mobile-agent (default) or the in-box tmux-web (x-forq-port: 7681).
   *  A fetch handler, not RPC: a WebSocket 101 cannot come back over RPC. */
  async fetch(request) {
    const url = new URL(request.url);
    const port = request.headers.get("x-forq-port") === "7681" ? TW_PORT : MA_PORT;
    const headers = new Headers(request.headers);
    headers.delete("x-forq-port");
    return this.c.getTcpPort(port).fetch(new Request(`http://container${url.pathname}${url.search}`, new Request(request, { headers })));
  }
  async adminExec(cmd) {
    if (!this.c.running) return { error: "not running" };
    return this.#sh(cmd);
  }
  async state() {
    const keys = ["agentId", "lastActive", "lastSnapshot", "snapshot", "failedSnapshots", "taskSent"];
    const m = await this.ctx.storage.get(keys);
    return { running: !!this.ctx.container?.running, alarm: await this.ctx.storage.getAlarm(), ...Object.fromEntries(m) };
  }
};
var REVIEW_STEPS = [
  `For each review: run \`forq fetch-agent <agent-id>\` (it fetches the agent's work into refs/agents/<agent-id> and prints its task, where it started and its preview URL). Read the change with \`git diff <base> refs/agents/<agent-id>\`. If the project has a web page, look at the agent's preview at phone size: \`chromium --headless=new --hide-scrollbars --window-size=390,844 --screenshot=/tmp/<agent-id>.png <preview-url>\`, then open that PNG with your Read tool and look at it.`,
  `Judge the change against the agent's own task (the "task:" line). The person's request ("asked:") may have been split across several agents, so parts of it that belong to other tasks are not missing from this one. Check: does it do what its task asked, does anything look broken or out of place, any obvious bug. Be brief and concrete. Then give your verdict with exactly one of: \`forq verdict <agent-id> approve "<one or two lines>"\` or \`forq verdict <agent-id> changes "<what to fix, specific>"\`. Never edit or push code yourself.`
];
function taskPrompt(spec) {
  if (spec.role === "reviewer") {
    return [
      `You are the reviewer agent of the forq project ${spec.project}. ${REPO_DIR} is a read-only clone of the project's main line. Agents work on their own forks; when one pushes, you are asked to review it before the person merges.`,
      ...REVIEW_STEPS,
      `Reply now with one line saying you are ready, then wait for review requests.`
    ].join("\n\n");
  }
  if (spec.role === "router") {
    return [
      `You are the router agent of the forq project ${spec.project}. ${REPO_DIR} is a clone of the project's main line (its default branch). You coordinate; agents do the work.`,
      `The person will message you from their phone. For each request: split it into independent tasks that touch different parts of the code where possible, and start one agent per task with \`forq spawn "<task>"\` (each agent gets its own fork and box; give it a complete, self-contained task). Small questions about the code you may answer yourself. Do not edit main yourself unless asked.`,
      `\`forq list\` shows the agents and their notes. When asked to merge an agent: \`forq merge <agent-id>\`; if it reports a conflict, resolve it in ${REPO_DIR}, commit, \`git push origin HEAD\`, then \`forq merged <agent-id>\`. \`forq send <agent-id> "text"\` messages an agent. \`forq help\` for the rest.`,
      `Keep replies short; the person reads them on a phone. Reply now with one line saying you are ready.`
    ].join("\n\n");
  }
  return [
    `You are a forq agent (${spec.agentId}) on the project ${spec.project}. You work in ${REPO_DIR}, a clone of your own fork; no other agent touches it.`,
    `Your task: ${spec.task}`,
    `Check your change works before you push (run it locally where you can). When the task is done: commit with a clear message, push with \`git push origin HEAD\` (your clone is on the default branch), and run \`forq status pushed "<one-line summary>"\` right away: that is what builds your preview and starts the review, so never wait for a deploy yourself. Then reply with a 2-3 line summary. If you are blocked or the task is unclear, run \`forq status blocked "<why>"\` and say so instead of guessing.`
  ].join("\n\n");
}
__name(taskPrompt, "taskPrompt");

// ../src/github.ts
var MAX_IMPORT_KB = 200 * 1024;
function parseRepoRef(input) {
  const s = input.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)(?:\/.*)?$/i) || s.match(/^git@github\.com:([\w.-]+)\/([\w.-]+)$/i) || s.match(/^([\w.-]+)\/([\w.-]+)$/);
  return m ? `${m[1]}/${m[2]}` : null;
}
__name(parseRepoRef, "parseRepoRef");
var toRepo = /* @__PURE__ */ __name((r) => ({
  fullName: r.full_name,
  name: r.name,
  description: r.description || "",
  url: r.html_url,
  stars: r.stargazers_count || 0,
  license: r.license?.spdx_id && r.license.spdx_id !== "NOASSERTION" ? r.license.spdx_id : null,
  branch: r.default_branch || "main",
  sizeKb: r.size || 0,
  archived: !!r.archived,
  private: !!r.private,
  pushedAt: r.pushed_at ? Date.parse(r.pushed_at) : 0,
  homepage: r.homepage || null
}), "toRepo");
async function ghGet(path2, ttlS, ctx) {
  const key = new Request(`https://forq-gh-cache.internal${path2}`);
  const hit = await caches.default.match(key);
  if (hit) return { status: 200, body: await hit.json() };
  const r = await fetch(`https://api.github.com${path2}`, {
    headers: { "user-agent": "forq (self-hostable git platform for agents)", accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" }
  });
  const body = await r.json().catch(() => ({}));
  log("github", "api", { path: path2.slice(0, 120), status: r.status, remaining: r.headers.get("x-ratelimit-remaining") });
  if (r.ok) ctx.waitUntil(caches.default.put(key, new Response(JSON.stringify(body), { headers: { "cache-control": `max-age=${ttlS}` } })));
  return { status: r.status, body };
}
__name(ghGet, "ghGet");
async function getRepo(fullName, ctx) {
  const r = await ghGet(`/repos/${fullName}`, 600, ctx);
  if (r.status === 404) return { error: `github.com/${fullName} was not found, or it is private`, status: 404 };
  if (r.status === 403 || r.status === 429) return { error: "GitHub is rate-limiting forq; try again in a minute", status: 429 };
  if (r.status !== 200) return { error: `GitHub answered ${r.status}`, status: 502 };
  return toRepo(r.body);
}
__name(getRepo, "getRepo");
async function searchRepos(q, ctx) {
  const query = `${q.trim().slice(0, 100)} fork:false`;
  const r = await ghGet(`/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=12`, 3600, ctx);
  if (r.status === 403 || r.status === 429) return { error: "GitHub search is rate-limited for a minute; paste a URL instead", status: 429 };
  if (r.status !== 200) return { error: `GitHub answered ${r.status}`, status: 502 };
  return (r.body.items || []).map(toRepo);
}
__name(searchRepos, "searchRepos");
var nameFor = /* @__PURE__ */ __name((repoName) => repoName.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "").slice(0, 39).replace(/-+$/, "") || "project", "nameFor");

// ../src/env.ts
var slugOf = /* @__PURE__ */ __name((owner, name) => `${owner}.${name}`, "slugOf");
var NAME_RE = /^(?!.*--)[a-z0-9][a-z0-9-]{0,38}$/;
var AGENT_RE = /^([a-z0-9-]+\.[a-z0-9-]+)--([a-z0-9]+)$/;
var projectOf = /* @__PURE__ */ __name((agentId) => agentId.split("--")[0], "projectOf");
var appWorkerName = /* @__PURE__ */ __name((slug) => `forq-app-${slug.replace(/\./g, "-")}`.slice(0, 50).replace(/-+$/, ""), "appWorkerName");
var appHost = /* @__PURE__ */ __name((slug, domain) => {
  if (!domain) return void 0;
  const [owner, name] = slug.split(".");
  return `${name.slice(0, 63 - 2 - owner.length).replace(/-+$/, "")}--${owner}.${domain}`;
}, "appHost");
function runHost(repo, domain) {
  if (domain.endsWith(".workers.dev")) return void 0;
  const m = repo.match(/^([a-z0-9-]+)\.([a-z0-9-]+?)(?:--([a-z0-9]+))?$/);
  if (!m) return void 0;
  const [, owner, name, short] = m;
  const label2 = short ? `ag-${short}--${name}--${owner}` : `${name}--${owner}`;
  return label2.length <= 63 ? `${label2}.${domain}` : void 0;
}
__name(runHost, "runHost");
function repoOfHostLabel(label2) {
  const p = label2.split("--");
  if (p.length === 2 && p.every(Boolean)) return `${p[1]}.${p[0]}`;
  if (p.length === 3 && /^ag-[a-z0-9]+$/.test(p[0]) && p[1] && p[2]) return `${p[2]}.${p[1]}--${p[0].slice(3)}`;
  return null;
}
__name(repoOfHostLabel, "repoOfHostLabel");
var previewAlias = /* @__PURE__ */ __name((agentId) => `ag-${agentId.split("--")[1]}`, "previewAlias");
var uiHosts = /* @__PURE__ */ __name((env) => [env.UI_HOST, ...(env.FRONT_HOSTS || "").split(",").map((h) => h.trim()).filter(Boolean)], "uiHosts");
var isUiHost = /* @__PURE__ */ __name((env, host) => uiHosts(env).includes(host), "isUiHost");
var frontHosts = /* @__PURE__ */ __name((env) => (env.FRONT_HOSTS || "").split(",").map((h) => h.trim()).filter(Boolean), "frontHosts");

// ../src/runurl.ts
var runUrl = /* @__PURE__ */ __name((runBase, repo, at = "") => {
  const h = runHost(repo, runBase.replace(/^https?:\/\//, ""));
  return h ? `https://${h}/${at}` : `${runBase}/${repo}/${at}`;
}, "runUrl");

// ../src/sheet.ts
var esc3 = /* @__PURE__ */ __name((s) => String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]), "esc");
var shortId = /* @__PURE__ */ __name((id) => id.split("--")[1] || id, "shortId");
function previewTabs(info, runBase, current) {
  const at = info.entry || "";
  const worker = info.kind === "worker";
  const live = worker ? info.app?.url ? `${info.app.url}/` : "about:blank" : runUrl(runBase, info.repo, at);
  const forks = info.agents.filter((a) => a.state !== "merged" && a.state !== "stopped" && (!worker || a.preview?.url));
  const tab = /* @__PURE__ */ __name((src, label2, title) => `<button type="button" class="ptab${(current || live) === src ? " on" : ""}" data-src="${esc3(src)}" title="${esc3(title)}">${esc3(label2)}</button>`, "tab");
  return `${tab(live, "Live", "main, what everyone sees")}${forks.map((a) => tab(worker ? `${a.preview.url}/` : runUrl(runBase, a.fork, at), shortId(a.id), `agent ${shortId(a.id)}'s fork`)).join("")}`;
}
__name(previewTabs, "previewTabs");
var SHEET_HTML = `<div class="sheet" id="sheet" aria-hidden="true">
<button type="button" class="grab" id="sh-grab" aria-label="Drag to resize, tap for full height"><span></span></button>
<div class="sh-h"><b id="sh-name"></b><div class="seg" role="tablist"><button type="button" data-m="chat" role="tab">Chat</button><button type="button" data-m="term" role="tab">Terminal</button></div><button type="button" class="x" id="sh-x" aria-label="Close">\xD7</button></div>
<div class="sh-body">
 <div class="chatv" id="sh-chat"><div class="log" id="sh-log"></div>
  <form class="sh-send" id="sh-send"><textarea name="text" rows="1" placeholder="Message this agent" enterkeyhint="send"></textarea><button class="btn">Send</button></form></div>
 <iframe id="sh-term" title="Terminal" hidden></iframe>
</div></div>`;
var SHEET_CSS = `
.pbar{display:flex;align-items:center;gap:8px;margin:16px 0 8px}
.ptabs{flex:1;min-width:0;display:flex;gap:6px;overflow-x:auto;scrollbar-width:none}
.ptabs::-webkit-scrollbar{display:none}
.ptab{flex:none;min-height:36px;padding:0 12px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--dim);font:500 14px 'Instrument Sans',sans-serif;cursor:pointer}
.ptab.on{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.pext{flex:none;margin-left:auto;font-size:14px;padding:8px 4px;white-space:nowrap}
.sheet{position:fixed;left:0;right:0;bottom:0;z-index:20;max-width:720px;margin:0 auto;height:72dvh;display:flex;flex-direction:column;
 background:var(--bg);border:1px solid var(--line);border-bottom:0;border-radius:16px 16px 0 0;box-shadow:0 -8px 32px rgb(0 0 0 / .18);
 transform:translateY(105%);transition:transform .22s ease,height .22s ease;visibility:hidden}
.sheet.open{transform:none;visibility:visible}
.sheet.full{height:calc(100dvh - 8px)}
.grab{display:flex;justify-content:center;align-items:center;height:28px;border:0;background:none;cursor:ns-resize;flex:none;touch-action:none;width:100%}
.grab span{width:44px;height:5px;border-radius:3px;background:var(--dim);opacity:.45}
.sheet.dragging{transition:none}
.sheet.dragging iframe{pointer-events:none}
.sh-h{display:flex;align-items:center;gap:8px;padding:0 12px 8px 16px;border-bottom:1px solid var(--line);flex:none}
.sh-h b{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.seg{display:flex;background:var(--chip);border-radius:8px;padding:2px}
.seg button{min-height:36px;padding:0 12px;border:0;border-radius:6px;background:none;color:var(--dim);font:500 14px 'Instrument Sans',sans-serif;cursor:pointer}
.seg button.on{background:var(--bg);color:var(--fg)}
.x{width:44px;height:44px;border:0;background:none;color:var(--dim);font-size:24px;cursor:pointer}
.sh-body{flex:1;min-height:0;display:flex;flex-direction:column}
.sh-body iframe{flex:1;width:100%;border:0;background:#0d1117}
.chatv{flex:1;min-height:0;display:flex;flex-direction:column}
.chatv[hidden],.sh-body iframe[hidden]{display:none}
.log{flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:10px;overscroll-behavior:contain}
.m-u{align-self:flex-end;max-width:85%;background:var(--acc);color:var(--acc-fg);border-radius:12px 12px 4px 12px;padding:8px 12px;white-space:pre-wrap;word-break:break-word}
.m-a{max-width:95%;white-space:pre-wrap;word-break:break-word;font-size:15px}
.m-s{font-size:13px;color:var(--dim);background:var(--card);border-radius:8px;padding:6px 10px;align-self:flex-start;cursor:pointer}
.m-s .names{display:none;margin-top:4px}
.m-s.open .names{display:block}
.m-q{background:var(--card);border-radius:12px;padding:10px 12px;font-size:14px}
.m-x{color:var(--dim);font-size:14px;text-align:center;padding:24px 0}
.sh-send{display:flex;gap:8px;padding:8px 12px calc(8px + env(safe-area-inset-bottom));border-top:1px solid var(--line);flex:none}
.sh-send textarea{flex:1;font:16px 'Instrument Sans',sans-serif;padding:10px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);resize:none;max-height:30dvh}
.sh-send .btn{min-height:44px}
body.sheet-open{overflow:hidden}
`;
var SHEET_JS = String.raw`
(function(){
 const frame=document.querySelector('.preview iframe'),ptabs=document.getElementById('ptabs'),pext=document.getElementById('pext');
 function showPreview(src){if(!frame)return;frame.src=src;pext.href=src;
  for(const b of ptabs.querySelectorAll('.ptab'))b.classList.toggle('on',b.dataset.src===src);}
 if(ptabs)ptabs.addEventListener('click',(e)=>{const b=e.target.closest('.ptab');if(b)showPreview(b.dataset.src);});
 window.forqShowPreview=(src)=>{showPreview(src);document.querySelector('.preview').scrollIntoView({behavior:'smooth',block:'center'});};
 window.forqCurrentPreview=()=>frame&&frame.src;

 const sheet=document.getElementById('sheet');if(!sheet)return;
 const log=document.getElementById('sh-log'),term=document.getElementById('sh-term'),chat=document.getElementById('sh-chat'),form=document.getElementById('sh-send');
 let cur=null,mode='chat',timer=null,lastKey='',busy=false,touched=Date.now();
 const esc=(t)=>String(t||'').replace(/[<>&"]/g,(c)=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
 function setMode(m){mode=m;
  for(const b of sheet.querySelectorAll('.seg button'))b.classList.toggle('on',b.dataset.m===m);
  chat.hidden=m!=='chat';term.hidden=m!=='term';
  if(m==='term'){const src='/a/'+cur.id+'/agent/?ui=minimal';if(term.dataset.for!==cur.id){term.src=src;term.dataset.for=cur.id;}}
  else poll();}
 window.forqOpenSheet=(id,name,m)=>{
  if(!cur||cur.id!==id){log.innerHTML='<div class="m-x">Loading…</div>';lastKey='';term.removeAttribute('src');term.dataset.for='';}
  cur={id,name};document.getElementById('sh-name').textContent=name;
  applySaved();sheet.classList.add('open');sheet.setAttribute('aria-hidden','false');document.body.classList.add('sheet-open');touched=Date.now();
  setMode(m||'chat');};
 function close(){sheet.classList.remove('open','full');sheet.style.height='';sheet.setAttribute('aria-hidden','true');document.body.classList.remove('sheet-open');clearTimeout(timer);}
 document.getElementById('sh-x').onclick=close;
 // The handle: drag to any height (remembered per viewer), tap to switch
 // half/full, drag below a fifth of the screen to close.
 const grab=document.getElementById('sh-grab'),HKEY='forq.sheetH';
 const clampH=(h)=>Math.max(160,Math.min(innerHeight-8,h));
 function applySaved(){try{const f=Number(localStorage.getItem(HKEY));if(f>0.2&&f<=1)sheet.style.height=clampH(f*innerHeight)+'px';}catch{}}
 let drag=null;
 grab.addEventListener('pointerdown',(e)=>{drag={y:e.clientY,h:sheet.getBoundingClientRect().height,moved:false};try{grab.setPointerCapture(e.pointerId)}catch{}sheet.classList.add('dragging');});
 grab.addEventListener('pointermove',(e)=>{if(!drag)return;const dy=drag.y-e.clientY;if(Math.abs(dy)>4)drag.moved=true;
  if(drag.moved){sheet.classList.remove('full');sheet.style.height=clampH(drag.h+dy)+'px';}});
 grab.addEventListener('pointerup',(e)=>{if(!drag)return;sheet.classList.remove('dragging');const d=drag;drag=null;
  if(!d.moved){const full=sheet.getBoundingClientRect().height>innerHeight*0.85;sheet.style.height=full?'':(innerHeight-8)+'px';try{localStorage.removeItem(HKEY)}catch{}return;}
  const h=sheet.getBoundingClientRect().height;
  if(e.clientY>innerHeight*0.8&&h<innerHeight*0.25){close();return;}
  try{localStorage.setItem(HKEY,String(h/innerHeight))}catch{}});
 grab.addEventListener('pointercancel',()=>{drag=null;sheet.classList.remove('dragging');});
 sheet.querySelector('.seg').onclick=(e)=>{const b=e.target.closest('button');if(b)setMode(b.dataset.m);};

 function render(j){
  if(j.asleep){log.innerHTML='<div class="m-x">Asleep. Send a message and it wakes up (a few seconds).</div>';busy=false;return;}
  const msgs=j.messages||[];const key=msgs.length+':'+(msgs.length?JSON.stringify(msgs[msgs.length-1]).length:0)+':'+j.status;
  busy=/busy|thinking|working|running|tool/.test(j.status||'');
  if(key===lastKey)return;lastKey=key;
  const near=log.scrollHeight-log.scrollTop-log.clientHeight<80;
  const out=[];let steps=[];
  const flush=()=>{if(steps.length){out.push('<div class="m-s">'+steps.length+' step'+(steps.length>1?'s':'')+'<div class="names">'+steps.map(esc).join('<br>')+'</div></div>');steps=[];}};
  for(const m of msgs){
   if(m.type==='tool_use'){steps.push(m.toolName||m.name||m.text||'tool');continue;}
   if(m.type==='user'){const t=(m.text||'').trim();if(!t)continue;flush();out.push('<div class="m-u">'+esc(t)+'</div>');continue;}
   if(m.type==='assistant_text'||m.type==='recap'){const t=(m.text||'').trim();if(!t)continue;flush();out.push('<div class="m-a">'+esc(t)+'</div>');continue;}
   if(m.type==='question_prompt'||m.type==='plan_prompt'){flush();out.push('<div class="m-q">'+esc(m.text||'')+'<br><i>Answer in the Terminal tab.</i></div>');}
  }
  flush();
  if(busy)out.push('<div class="m-x">Working…</div>');
  log.innerHTML=out.join('')||'<div class="m-x">No messages yet.</div>';
  if(near||lastKey.startsWith(msgs.length+':'))log.scrollTop=log.scrollHeight;}
 async function poll(){clearTimeout(timer);
  if(!cur||mode!=='chat'||!sheet.classList.contains('open'))return;
  if(!document.hidden&&Date.now()-touched<10*60000){
   try{const r=await fetch('/api/agents/'+cur.id+'/conversation');if(r.ok)render(await r.json());}catch{}}
  timer=setTimeout(poll,busy?1500:3000);}
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
 form.onsubmit=async(e)=>{e.preventDefault();const t=form.text.value.trim();if(!t||!cur)return;form.text.value='';touched=Date.now();
  log.insertAdjacentHTML('beforeend','<div class="m-u">'+esc(t)+'</div><div class="m-x">Sending…</div>');log.scrollTop=log.scrollHeight;
  const r=await fetch('/api/agents/'+cur.id+'/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:t})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.ok===false){log.insertAdjacentHTML('beforeend','<div class="m-x">Not sent: '+esc(j.error||r.status)+'</div>');form.text.value=t;}
  lastKey='';busy=true;poll();};
 form.text.addEventListener('keydown',(e)=>{if(e.key==='Enter'&&!e.shiftKey&&matchMedia('(hover:hover)').matches){e.preventDefault();form.requestSubmit();}});
 // Every [data-sheet] / [data-preview] button on the page, including ones the poll re-renders.
 document.addEventListener('click',(e)=>{
  const s=e.target.closest('[data-sheet]');if(s){window.forqOpenSheet(s.dataset.sheet,s.dataset.name,s.dataset.mode);return;}
  const p=e.target.closest('[data-preview]');if(p)window.forqShowPreview(p.dataset.preview);});
})();
`;

// ../src/ui.ts
var esc4 = /* @__PURE__ */ __name((s) => String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]), "esc");
var STEPS = [14 * 24, 3 * 24, 24, 3];
var path = /* @__PURE__ */ __name((slug) => `/p/${slug.replace(".", "/")}`, "path");
var label = /* @__PURE__ */ __name((slug) => slug.replace(".", " / "), "label");
var CSS = `
:root{--bg:#fff;--card:#f6f7f8;--chip:#eceef1;--line:#e2e5e9;--fg:#15171a;--dim:#5f6670;--acc:#17695a;--acc-fg:#fff;--busy:#b7791f;--warn:#b42d1f;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0f1112;--card:#171a1c;--chip:#202427;--line:#272b2f;--fg:#e8eaec;--dim:#9ba2a9;--acc:#4fbf9f;--acc-fg:#0f1112;--busy:#e0a948;--warn:#f08a7e;color-scheme:dark}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
input:focus,textarea:focus{outline:none;border-color:var(--acc)!important;box-shadow:0 0 0 3px color-mix(in srgb,var(--acc) 22%,transparent)}
a:focus-visible,button:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 'Instrument Sans',sans-serif}
main{max-width:720px;margin:0 auto;padding:12px 16px calc(32px + env(safe-area-inset-bottom))}
a{color:var(--acc);text-decoration:none}
header.top{display:flex;align-items:center;justify-content:space-between;height:48px}
.mark{font-weight:600;font-size:20px;color:var(--fg);letter-spacing:-.01em}
.who{font-size:13px;color:var(--dim)}
.top .tr{display:flex;align-items:center;gap:12px}
.top .chipbtn{min-height:40px;font-size:14px;padding:0 12px}
.intro{color:var(--dim);margin:4px 0 24px;font-size:15px}
h1{font-size:24px;line-height:1.2;margin:8px 0 4px;font-weight:600;word-break:break-word}
h2{font-size:15px;font-weight:600;margin:32px 0 8px}
.owner{color:var(--dim);font-weight:400}
.rows{display:flex;flex-direction:column;gap:8px}
.row{position:relative;display:block;background:var(--card);border-radius:12px;padding:12px 14px;color:inherit}
.row .t{display:block;font-size:15px;color:var(--fg)}
/* The whole card is the link (stretched ::after); the freshbar sits above it so a tap on it opens the explainer instead. */
.stretch::after{content:'';position:absolute;inset:0;border-radius:12px}
.row button.fresh{position:relative;z-index:1}.row .t b{font-weight:600}
.row .d{color:var(--dim);font-size:14px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.meta .yours{color:var(--acc)}
.meta.one{flex-wrap:nowrap;overflow:hidden;white-space:nowrap}
.meta.one span:last-child{overflow:hidden;text-overflow:ellipsis}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;font-size:13px;color:var(--dim);margin-top:8px}
.back{display:inline-flex;align-items:center;min-height:44px;font-size:15px}
.desc{color:var(--dim);margin:0}
.actions{display:flex;gap:8px;margin:16px 0}
.btn,.chipbtn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 16px;border-radius:8px;border:0;font:500 15px 'Instrument Sans',sans-serif;cursor:pointer;transition:background-color .12s}
.btn{background:var(--acc);color:var(--acc-fg)}
.chipbtn{background:var(--chip);color:var(--fg)}
.btn[disabled]{opacity:.6}
.preview{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--card);height:min(560px,70dvh)}
.preview iframe{width:100%;height:100%;border:0;display:block;background:#fff}
.note{background:var(--card);border-radius:12px;padding:12px 14px;font-size:14px;color:var(--dim);margin-top:16px}
.files{display:flex;flex-wrap:wrap;gap:6px}
.files span,.files a{font:13px 'JetBrains Mono',monospace;background:var(--chip);border-radius:4px;padding:6px 8px;color:var(--fg)}
.readme{background:var(--card);border-radius:12px;padding:4px 16px;font-size:15px;overflow-wrap:anywhere}
.readme h2,.readme h3,.readme h4{margin:16px 0 6px;font-size:17px}
.readme code{font:13px 'JetBrains Mono',monospace;background:var(--chip);border-radius:4px;padding:1px 4px}
.readme .tbl{overflow-x:auto;margin:0 0 14px}
.readme table{border-collapse:collapse;font-size:14px;min-width:100%}
.readme th,.readme td{overflow-wrap:normal;word-break:normal;text-align:left;vertical-align:top;padding:7px 10px;border-bottom:1px solid var(--line)}
.readme th{font-weight:600}
.readme pre{overflow-x:auto;background:var(--chip);border-radius:8px;padding:10px}
.readme hr{border:0;border-top:1px solid var(--line);margin:16px 0}
.commit{display:flex;gap:8px;align-items:baseline;font-size:14px;padding:6px 0;border-bottom:1px solid var(--line)}
.commit .msg{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.commit code{font:12px 'JetBrains Mono',monospace;color:var(--dim)}
.composer textarea{width:100%;min-height:76px;font:16px 'Instrument Sans',sans-serif;padding:12px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);resize:vertical}
.composer .bar{display:flex;gap:8px;margin-top:8px;align-items:center}
.composer .bar .btn{flex:1}
.router{background:var(--card);border-radius:12px;padding:12px 14px;margin-top:12px;font-size:14px}
.router .rh{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;min-height:24px}
.router .who{font-weight:600;color:var(--fg)}
.router .phase{color:var(--dim);font-variant-numeric:tabular-nums}
.router.busy .phase{color:var(--fg)}
.router .phase .n{color:var(--fg)}
.router .phase .chipbtn{min-height:36px;padding:0 12px;font-size:14px;margin-left:4px}
.router .err{color:var(--fg)}
.router .you{margin-top:8px;color:var(--fg);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.router .you b{font-weight:600;margin-right:4px}
.router .acts{display:flex;gap:8px;margin-top:10px}
.router .acts .chipbtn{min-height:40px;padding:0 12px;font-size:14px}
.router .said{margin-top:8px;color:var(--dim);white-space:pre-wrap;word-break:break-word;max-height:9.5em;overflow:auto}
.card .h .st{font-variant-numeric:tabular-nums}
.card.busy .h .st{color:var(--fg)}
.cards{display:flex;flex-direction:column;gap:8px;margin-top:12px}
.card{background:var(--card);border-radius:12px;padding:12px 14px}
.card .h{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dim)}
.card .h .st{margin-left:auto}
.dot{width:9px;height:9px;border-radius:50%;background:var(--line);flex:none}
.dot.idle{background:var(--acc)}.dot.busy{background:var(--busy)}
.io{margin:8px 0 0}
.io dt{font-size:12px;color:var(--dim);margin-top:8px}
.io dt:first-child{margin-top:0}
.io dd{margin:2px 0 0;font-size:15px;word-break:break-word}
.io dd.none{color:var(--dim);font-size:14px}
.io dd.clamp{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.io dd.clamp.open{-webkit-line-clamp:unset}
.io dd.rv b{font-weight:600}
.card .pv{margin:8px 0 0;font-size:14px;color:var(--dim)}
.card .pv.busy{color:var(--fg)}
.note.deploy b{color:var(--fg)}
.note.deploy .chipbtn{min-height:36px;padding:0 12px;font-size:14px;margin-left:4px}
.io dd.rv.approved b{color:var(--acc)}
.io dd.rv .rn{display:block;margin-top:2px;color:var(--fg)}
.router.reviewer{margin-top:8px}
.card .acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.card .acts .chipbtn,.card .acts .btn{min-height:40px;padding:0 12px;font-size:14px}
.empty{color:var(--dim);font-size:14px}
.search input{width:100%;font:16px 'Instrument Sans',sans-serif;padding:12px 14px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);margin:16px 0 12px}
.sugg{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:16px}
.sugg>span{color:var(--dim);font-size:14px}
.sugg[hidden]{display:none}
.sugg .chipbtn{min-height:40px;font-size:14px;padding:0 12px}
.row.gh .acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center}
.row.gh .acts .btn,.row.gh .acts .chipbtn{min-height:40px;font-size:14px;padding:0 14px}
@media (hover:hover){.row:hover{background:var(--chip)}.chipbtn:hover{background:var(--line)}}
${FRESH_CSS}${SHEET_CSS}`;
var shell = /* @__PURE__ */ __name((title, body, steps = STEPS) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc4(title)}</title><meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body><main>${body}</main>${freshHelp(steps)}</body></html>`, "shell");
var stars = /* @__PURE__ */ __name((n) => `${n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "k" : n} stars`, "stars");
function row(e, forks, now, mineFork) {
  return `<div class="row"><a class="t stretch" href="${path(e.slug)}"><span class="owner">${esc4(e.owner)} /</span> <b>${esc4(e.name)}</b></a>
  ${e.description ? `<div class="d">${esc4(e.description)}</div>` : ""}
  <div class="meta one">${freshTag(e.updatedAt, now, STEPS)}${mineFork ? `<span class="yours">you have a fork</span>` : ""}${forks ? `<span>${forks} fork${forks > 1 ? "s" : ""}</span>` : ""}${e.forkedFrom ? `<span>forked from ${esc4(label(e.forkedFrom))}</span>` : e.importedFrom ? `<span>${stars(e.importedFrom.stars)} on GitHub</span>` : ""}</div></div>`;
}
__name(row, "row");
function explorePage(entries, me) {
  const now = Date.now();
  const forks = /* @__PURE__ */ __name((slug) => entries.filter((e) => e.forkedFrom === slug).length, "forks");
  const mine = entries.filter((e) => e.owner === me);
  const others = entries.filter((e) => e.owner !== me);
  return shell("forq", `<header class="top"><span class="mark">qodebase</span><span class="tr">${me ? `<a class="chipbtn" href="/import">Import from GitHub</a><a class="who" href="/settings">${esc4(me)}</a>` : `<a class="chipbtn" href="/login">Sign in</a>`}</span></header>
<p class="intro">Projects that run. Open one, fork it, then tell its router agent what to change.${me ? "" : " Reading is open to everyone; sign in with your email to fork and run agents with your own Anthropic API key."}</p>
${mine.length ? `<h2>Yours</h2><p class="fresh-legend">Shaded dates: full today, empty after two weeks. Tap one for more.</p><div class="rows">${mine.map((e) => row(e, forks(e.slug), now)).join("")}</div>` : ""}
<h2>Explore</h2>${mine.length ? "" : '<p class="fresh-legend">Shaded dates: full today, empty after two weeks. Tap one for more.</p>'}<div class="rows">${others.map((e) => row(e, forks(e.slug), now, mine.find((m) => m.forkedFrom === e.slug))).join("") || '<p class="empty">Nothing here yet.</p>'}</div>
<p class="empty" style="margin-top:32px"><a href="/about">About</a>&nbsp;&nbsp; <a href="/privacy">Privacy</a>&nbsp;&nbsp; <a href="/feedback?from=/">Feedback</a></p>`);
}
__name(explorePage, "explorePage");
function deployLine(info, d, own) {
  const now = Date.now();
  const logLink = d?.log ? ` <a href="/p/${info.owner}/${info.name}/build-log">View build log</a>` : "";
  const again = own ? ` <button type="button" class="chipbtn" id="redeploy">Deploy again</button>` : "";
  const body = !d ? "A Cloudflare Worker. Not deployed yet; it deploys when this page first loads." : d.status === "building" ? `<b>Deploying</b> <span data-since="${d.at}">0s</span>. qodebase's builder runs wrangler for it; the first deploy takes about a minute.` : d.status === "failed" ? `<b>Deploy failed:</b> ${esc4(d.error || "unknown error")}.${logLink}${again}` : `Live as a Cloudflare Worker at <a href="${esc4(d.url || "")}" target="_blank" rel="noopener">${esc4((d.url || "").replace("https://", ""))}</a> ${freshTag(d.at, now, STEPS)}${logLink}${again}`;
  return `<p class="note deploy${d?.status === "building" ? " busy" : ""}">${body}</p>${d?.status === "building" ? "<script>setTimeout(function(){location.reload()},6000)<\/script>" : ""}
<script>(function(){const b=document.getElementById('redeploy');if(b)b.onclick=async()=>{b.disabled=true;b.textContent='Queued';await fetch('/api/p/${info.owner}/${info.name}/deploy',{method:'POST'});location.reload();};
for(const el of document.querySelectorAll('.deploy [data-since]')){const t=Number(el.dataset.since);setInterval(()=>{el.textContent=Math.round((Date.now()-t)/1000)+'s'},1000);}})();<\/script>`;
}
__name(deployLine, "deployLine");
function projectPage(o) {
  const { info, entry, forks, overview, me, runBase } = o;
  const now = Date.now();
  const own = info.owner === me;
  const isWorker2 = (overview.kind ?? info.kind) === "worker";
  const dep = overview.app ?? info.app;
  const webAt = isWorker2 ? "" : overview.entry ?? info.entry;
  const app2 = isWorker2 ? dep?.url ? `${dep.url}/` : "" : runUrl(runBase, info.repo, webAt || "");
  const src = info.importedFrom;
  const myForks = forks.filter((e) => e.owner === me);
  return shell(`${info.owner}/${info.name} \xB7 qodebase`, `<a class="back" href="/">Explore</a>
<h1><span class="owner">${esc4(info.owner)} /</span> ${esc4(info.name)}</h1>
${info.description ? `<p class="desc">${esc4(info.description)}</p>` : ""}
<div class="meta">${freshTag(entry.updatedAt, now, STEPS)}${forks.length ? `<span>${forks.length} fork${forks.length > 1 ? "s" : ""}</span>` : ""}${info.forkedFrom ? `<span>forked from <a href="${path(info.forkedFrom)}">${esc4(label(info.forkedFrom))}</a></span>` : ""}${src && !info.forkedFrom ? `<span>imported from <a href="${esc4(src.url)}" rel="noopener">GitHub ${esc4(src.fullName)}</a></span>` : ""}${src ? `<span>${stars(src.stars)}</span>${src.license ? `<span>${esc4(src.license)}</span>` : ""}` : ""}</div>
${own ? "" : myForks.length ? `<div class="actions"><a class="btn" href="${path(myForks[0].slug)}">Open your fork</a><button class="chipbtn" id="fork">Fork again</button></div>
<p class="desc">You forked it as <a href="${path(myForks[0].slug)}">${esc4(label(myForks[0].slug))}</a>${myForks.length > 1 ? ` and ${myForks.length - 1} more` : ""}.</p>` : me ? `<div class="actions"><button class="btn" id="fork">Fork to ${esc4(me)}</button></div>` : `<div class="actions"><a class="btn" href="/login?next=${encodeURIComponent(path(info.slug))}">Sign in to fork</a></div>`}
${overview.importing ? `<p class="note" id="importing">Importing from GitHub. This page refreshes when it is ready (usually a few seconds).</p>
<script>setTimeout(function(){location.reload()},3000)<\/script>` : isWorker2 ? `${deployLine(info, dep, own)}${dep?.url ? `<div class="pbar"><div class="ptabs" id="ptabs">${previewTabs(info, runBase)}</div><a class="pext" id="pext" href="${app2}" target="_blank" rel="noopener">Open in new tab</a></div>
<div class="preview"><iframe src="${app2}" title="${esc4(info.name)} app" loading="lazy"></iframe></div>` : ""}` : webAt === null ? `<p class="note">No web page to show: qodebase looks for an index.html at the root and in demo/, docs/, public/, dist/, www/, site/ and examples/. The code is below, and agents can still work on it.</p>` : `<div class="pbar"><div class="ptabs" id="ptabs">${previewTabs(info, runBase)}</div><a class="pext" id="pext" href="${app2}" target="_blank" rel="noopener">Open in new tab</a></div>
<div class="preview"><iframe src="${app2}" title="${esc4(info.name)} app" loading="lazy"></iframe></div>`}
${own && o.needsKey ? `<h2>Agents</h2><p class="note">Agents here run Claude Code with your own Anthropic API key. <a href="/settings">Add your key in Settings</a> to start one.</p>` : ""}${own && !o.needsKey ? `<h2>Agents</h2>
<form class="composer" id="ask"><textarea name="text" placeholder="Tell the router agent what to change. It splits the work and starts one agent per task." required enterkeyhint="send"></textarea>
<div class="bar"><button class="btn">Send</button></div></form>
<div id="agents">${o.agentsHtml}</div>${SHEET_HTML}` : ""}${own ? "" : `<p class="note">Fork it to change it: your copy gets its own page, its own live app and its own agents.</p>`}
<h2>Code</h2><div class="files">${overview.files.map((f) => `<a href="/p/${info.owner}/${info.name}/code/${esc4(f.name)}${f.dir ? "/" : ""}">${esc4(f.name)}${f.dir ? "/" : ""}</a>`).join("") || "<span>empty</span>"}</div>
<p style="margin:10px 0 0"><a class="chipbtn" href="/p/${info.owner}/${info.name}/code/">Browse and search the code</a></p>
${overview.readme ? `<h2>README</h2><div class="readme">${markdown(overview.readme)}</div>` : ""}
${forks.length ? `<h2>Forks</h2><div class="rows">${forks.map((e) => row(e, 0, now)).join("")}</div>` : ""}
<h2>Recent commits</h2>${src && !info.forkedFrom ? `<p class="empty">Imported with the latest commit only; full history stays on <a href="${esc4(src.url)}" rel="noopener">GitHub</a>.</p>` : ""}${overview.commits.map((c) => `<div class="commit">${freshTag(c.at, now, STEPS)}<span class="msg">${esc4(c.message)}</span><code>${esc4(c.hash.slice(0, 7))}</code></div>`).join("") || '<p class="empty">No commits yet.</p>'}
<script>
const API='/api/p/${esc4(info.owner)}/${esc4(info.name)}';
const fork=document.getElementById('fork');
if(fork)fork.onclick=async()=>{fork.disabled=true;fork.textContent='Forking';
 const r=await fetch(API+'/fork',{method:'POST'});const j=await r.json();
 if(r.ok)location.href=j.path;else{fork.disabled=false;fork.textContent=j.error||'Fork failed';}};
const ask=document.getElementById('ask');
if(ask){
 const box=document.getElementById('agents');
 // Seconds since a phase began, ticking every second on every [data-since].
 const tick=()=>{for(const el of document.querySelectorAll('[data-since]')){const s=Math.max(0,Math.round((Date.now()-Number(el.dataset.since))/1000));el.textContent=s<60?s+'s':Math.floor(s/60)+'m '+(s%60)+'s';}};
 setInterval(tick,1000);
 const esc=(t)=>t.replace(/[<>&"]/g,(c)=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
 async function send(text){
  // Show it at once: the request, and a phase line that ticks while the server works.
  const rp=box.querySelector('.router');
  if(rp)rp.outerHTML='<div class="router busy"><div class="rh"><span class="dot busy"></span><span class="who">Router agent</span><span class="phase">Sending <span data-since="'+Date.now()+'">0s</span></span></div><div class="you"><b>You</b> '+esc(text)+'</div></div>';
  tick();
  const r=await fetch(API+'/router',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text})});
  if(!r.ok){const j=await r.json().catch(()=>({}));const ph=box.querySelector('.router .phase');if(ph)ph.textContent=j.error||'Could not send. Try again.';return false;}
  poll();return true;
 }
 ask.onsubmit=async(e)=>{e.preventDefault();const t=ask.text.value.trim();if(!t)return;ask.text.value='';
  if(!(await send(t)))ask.text.value=t;};
 box.addEventListener('click',async(e)=>{
  const retry=e.target.closest('[data-retry]');if(retry){retry.disabled=true;send(retry.dataset.retry);return;}
  const c=e.target.closest('dd.clamp');if(c){c.classList.toggle('open');return;}
  const fx=e.target.closest('[data-fix],[data-review]');if(fx){fx.disabled=true;const isFix=!!fx.dataset.fix;fx.textContent=isFix?'Sending to the agent':'Queueing review';
   const r=await fetch(API+(isFix?'/fix':'/review'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({agent:fx.dataset.fix||fx.dataset.review})});
   if(!r.ok){const j=await r.json().catch(()=>({}));fx.textContent=j.error||'Failed';}poll();return;}
  const m=e.target.closest('[data-merge]');if(!m)return;
  m.disabled=true;m.textContent='Asking the router agent';
  const r=await fetch(API+'/merge',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({agent:m.dataset.merge})});
  if(!r.ok){const j=await r.json().catch(()=>({}));m.textContent=j.error||'Failed';}poll();});
 let timer=null;
 async function poll(){clearTimeout(timer);
  if(!document.hidden){try{const r=await fetch(API+'/agents-html');if(r.ok){const j=await r.json();box.innerHTML=j.html;tick();
   const pt=document.getElementById('ptabs');if(pt&&j.tabs!==undefined){const cur=window.forqCurrentPreview&&window.forqCurrentPreview();pt.innerHTML=j.tabs;for(const b of pt.querySelectorAll('.ptab'))b.classList.toggle('on',b.dataset.src===cur);}}}catch{}}
  // Fast while anything is in progress, slow when all is quiet.
  timer=setTimeout(poll,box.querySelector('.busy')?2000:5000);}
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
 tick();timer=setTimeout(poll,box.querySelector('.busy')?2000:5000);
}
<\/script><script>${SHEET_JS}<\/script>`);
}
__name(projectPage, "projectPage");
var fromIssues = /* @__PURE__ */ __name((t) => t.startsWith("Production error from Cloudflare Issues"), "fromIssues");
var BUSY = /busy|thinking|working|running|tool/;
var since = /* @__PURE__ */ __name((t) => `<span data-since="${t}">0s</span>`, "since");
function agentPhase(a, s) {
  if (a.state === "pushed") return { word: "pushed", dot: s.awake ? "idle" : "", busy: false };
  if (a.state === "blocked") return { word: "blocked", dot: "busy", busy: false };
  if (a.state === "merged" || a.state === "stopped") return { word: a.state, dot: "", busy: false };
  if (s.booting || s.awake && !s.taskSent || !s.awake && !s.taskSent) return { word: "starting", dot: "busy", busy: true, since: a.createdAt };
  if (s.awake && BUSY.test(s.cc)) return { word: "working", dot: "busy", busy: true };
  if (s.awake) return { word: "waiting for you", dot: "idle", busy: false };
  return { word: "asleep", dot: "", busy: false };
}
__name(agentPhase, "agentPhase");
function routerPanel(info, r) {
  const q = info.lastRequest;
  const now = Date.now();
  const started = q ? info.agents.filter((a) => a.createdAt >= q.at).length : 0;
  const startedTxt = started ? ` <span class="n">${started} agent${started > 1 ? "s" : ""} started</span>` : "";
  let phase = "", busy = false, said = "";
  if (q?.state === "failed") {
    phase = `<span class="err">Could not reach it: ${esc4(q.error || "unknown error")}</span> <button class="chipbtn" data-retry="${esc4(q.text)}">Retry</button>`;
  } else if (q?.state === "waking") {
    busy = true;
    phase = !r.awake ? `Waking up ${since(q.at)}` : `Starting Claude Code ${since(q.at)}`;
  } else if (q?.state === "sent" && (BUSY.test(r.cc) || now - (q.sentAt || 0) < 8e3)) {
    busy = true;
    phase = `Working on it ${since(q.sentAt || q.at)}${startedTxt}`;
  } else {
    said = r.said || "";
    phase = r.awake ? said ? "" : "Ready" : "Asleep. It wakes when you send something.";
  }
  const dot2 = busy ? "busy" : r.awake ? "idle" : "";
  return `<div class="router${busy ? " busy" : ""}"><div class="rh"><span class="dot ${dot2}"></span><span class="who">Router agent</span>${phase ? `<span class="phase">${phase}</span>` : ""}</div>
<div class="acts"><button type="button" class="chipbtn" data-sheet="${info.slug}--router" data-name="Router agent" data-mode="chat">Chat</button><button type="button" class="chipbtn" data-sheet="${info.slug}--router" data-name="Router agent" data-mode="term">Terminal</button></div>
${q ? `<div class="you"><b>${fromIssues(q.text) ? "Cloudflare Issues" : "You"}</b> ${esc4(q.text)}</div>` : ""}${said ? `<div class="said">${esc4(said)}</div>` : ""}</div>`;
}
__name(routerPanel, "routerPanel");
var REVIEW_WORD = { queued: "Waiting for the reviewer", reviewing: "Reviewing now", approved: "Approved", changes: "Changes suggested", sent: "Sent to the agent to fix" };
function previewLine(info, a) {
  const p = a.preview;
  if (!p) return "";
  if (p.status === "building") return `<p class="pv busy">Building its preview <span data-since="${p.at}">0s</span></p>`;
  if (p.status === "failed") return `<p class="pv">Preview build failed: ${esc4(p.error || "")}. <a href="/p/${info.owner}/${info.name}/build-log?agent=${a.id.split("--")[1]}">Build log</a></p>`;
  return "";
}
__name(previewLine, "previewLine");
function reviewBlock(a) {
  const r = a.review;
  if (!r) return "";
  const live = r.state === "queued" || r.state === "reviewing";
  return `<dt>Review</dt><dd class="rv ${r.state}${live ? " busy" : ""}"><b>${REVIEW_WORD[r.state] || r.state}</b>${live ? ` <span data-since="${r.at}">0s</span>` : ""}${r.notes ? `<span class="rn">${esc4(r.notes)}</span>` : ""}</dd>`;
}
__name(reviewBlock, "reviewBlock");
function reviewerRow(info, s) {
  const doing = info.agents.find((a) => a.review?.state === "reviewing");
  const queued = info.agents.filter((a) => a.review?.state === "queued").length;
  const word = doing ? `Reviewing ${shortId(doing.id)}${queued ? `, ${queued} waiting` : ""}` : s.awake ? "Idle" : "Asleep. It reviews every push before you merge.";
  return `<div class="router reviewer${doing ? " busy" : ""}"><div class="rh"><span class="dot ${doing ? "busy" : s.awake ? "idle" : ""}"></span><span class="who">Reviewer agent</span><span class="phase">${esc4(word)}</span></div>
<div class="acts"><button type="button" class="chipbtn" data-sheet="${info.slug}--review" data-name="Reviewer agent" data-mode="chat">Chat</button><button type="button" class="chipbtn" data-sheet="${info.slug}--review" data-name="Reviewer agent" data-mode="term">Terminal</button></div></div>`;
}
__name(reviewerRow, "reviewerRow");
function agentsHtml(info, runBase, router, status, reviewer = { awake: false, cc: "asleep" }) {
  const now = Date.now();
  const card = /* @__PURE__ */ __name((a) => {
    const s = status[a.id] || { awake: false, cc: "asleep" };
    const ph = agentPhase(a, s);
    const reviewing = a.review?.state === "queued" || a.review?.state === "reviewing";
    return `<div class="card${ph.busy || reviewing ? " busy" : ""}"><div class="h"><span class="dot ${ph.dot}"></span><span>${esc4(a.id.split("--")[1])}</span>${freshTag(a.noteAt || a.createdAt, now, STEPS)}<span class="st">${ph.word}${ph.since ? ` ${since(ph.since)}` : ""}</span></div>
<dl class="io">
${a.request ? `<dt>${fromIssues(a.request) ? "Reported by Cloudflare Issues" : "You asked"}</dt><dd class="clamp">${esc4(a.request)}</dd>` : ""}
<dt>${a.request ? "Its task, from the router agent" : "Its task"}</dt><dd class="clamp">${esc4(a.task)}</dd>
<dt>Result</dt><dd${a.note ? "" : ' class="none"'}>${a.note ? esc4(a.note) : ph.busy ? "Not yet. It reports here when it pushes." : "No report yet."}</dd>
${reviewBlock(a)}
</dl>
${info.kind === "worker" ? previewLine(info, a) : ""}<div class="acts">${info.kind === "worker" ? a.preview?.url ? `<button type="button" class="chipbtn" data-preview="${esc4(a.preview.url)}/">Preview</button>` : "" : `<button type="button" class="chipbtn" data-preview="${runUrl(runBase, a.fork, info.entry || "")}">Preview</button>`}<a class="chipbtn" href="/p/${info.owner}/${info.name}/changes/${shortId(a.id)}">Changes</a><button type="button" class="chipbtn" data-sheet="${a.id}" data-name="Agent ${shortId(a.id)}" data-mode="chat">Chat</button><button type="button" class="chipbtn" data-sheet="${a.id}" data-name="Agent ${shortId(a.id)}" data-mode="term">Terminal</button>${a.review?.state === "changes" ? `<button type="button" class="chipbtn" data-fix="${esc4(a.id)}">Ask agent to fix</button>` : ""}${a.state === "pushed" && !a.review ? `<button type="button" class="chipbtn" data-review="${esc4(a.id)}">Review it</button>` : ""}${a.state === "pushed" ? `<button class="btn" data-merge="${esc4(a.id)}">Merge${a.review?.state === "changes" ? " anyway" : ""}</button>` : ""}</div></div>`;
  }, "card");
  const open = info.agents.filter((a) => a.state !== "merged" && a.state !== "stopped").reverse();
  const done = info.agents.filter((a) => a.state === "merged").reverse().slice(0, 5);
  return `${routerPanel(info, router)}${reviewerRow(info, reviewer)}
<div class="cards">${open.map(card).join("") || '<p class="empty">No agents working. Ask the router agent for a change.</p>'}</div>
${done.length ? `<h2>Merged</h2><div class="cards">${done.map(card).join("")}</div>` : ""}`;
}
__name(agentsHtml, "agentsHtml");
var REPO_STEPS = [365 * 24, 90 * 24, 30 * 24, 7 * 24];
function importPage(me) {
  if (!me) return shell("Import from GitHub \xB7 qodebase", `<a class="back" href="/">Explore</a>
<h1>Import from GitHub</h1>
<p class="desc">Bring any public GitHub repository into qodebase: it runs here, you can fork it, and agents can work on it.</p>
<div class="actions"><a class="btn" href="/login?next=/import">Sign in with your email to import</a></div>`);
  return shell("Import from GitHub \xB7 qodebase", `<a class="back" href="/">Explore</a>
<h1>Import from GitHub</h1>
<p class="desc">Search public repositories, or paste a repo's URL. qodebase copies the latest commit, finds its web page if it has one, and the project is yours to fork and hand to agents.</p>
<form id="gq" class="search" role="search"><input id="q" type="search" name="q" placeholder="Search GitHub, or paste a URL" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="search"></form>
<div class="sugg" id="sugg"><span>Try</span>${["2048", "reveal.js", "particles.js", "tetris javascript", "https://github.com/SortableJS/Sortable"].map((t) => `<button type="button" class="chipbtn" data-q="${esc4(t)}">${esc4(t.replace("https://github.com/", ""))}</button>`).join("")}</div>
<p class="fresh-legend">Shaded dates: last push, full this week, empty after a year.</p>
<div id="res" class="rows" aria-live="polite"></div>
<script>
const $q=document.getElementById('q'),$res=document.getElementById('res');
const esc=(t)=>String(t||'').replace(/[<>&"]/g,(c)=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
const stars=(n)=>(n>=1000?(n/1000).toFixed(n>=10000?0:1)+'k':n)+' stars';
const STEPS=${JSON.stringify(REPO_STEPS)};
function rel(ts){const s=Math.max(0,(Date.now()-ts)/1000);if(s<3600)return Math.floor(s/60)+' min ago';if(s<86400)return Math.floor(s/3600)+'h ago';if(s<86400*60)return Math.floor(s/86400)+'d ago';if(s<86400*730)return Math.floor(s/86400/30)+' mo ago';return Math.floor(s/86400/365)+'y ago';}
function fresh(ts){const age=Date.now()-ts;const l=STEPS.filter((h)=>age<h*3600000).length;return '<button type="button" class="fresh'+(l===4?' is-new':'')+'" style="--l:'+l+'" popovertarget="fresh-help">'+rel(ts)+'</button>';}
let seq=0,timer=null;
async function run(){const q=$q.value.trim();const my=++seq;
 document.getElementById('sugg').hidden=!!q;
 if(q.length<2){$res.innerHTML='';return;}
 $res.innerHTML='<p class="empty">Searching GitHub</p>';
 let j;try{const r=await fetch('/api/github/search?q='+encodeURIComponent(q));j=await r.json();if(!r.ok)throw new Error(j.error||r.status);}catch(e){if(my===seq)$res.innerHTML='<p class="empty">'+esc(e.message)+'</p>';return;}
 if(my!==seq)return;
 if(!j.repos.length){$res.innerHTML='<p class="empty">Nothing found. Try other words, or paste the repo URL.</p>';return;}
 $res.innerHTML=j.repos.map((r)=>{const big=r.sizeKb>${MAX_IMPORT_KB};
  return '<div class="row gh"><div class="t"><span class="owner">'+esc(r.fullName.split('/')[0])+' /</span> <b>'+esc(r.name)+'</b></div>'+
  (r.description?'<div class="d">'+esc(r.description)+'</div>':'')+
  '<div class="meta">'+(r.pushedAt?fresh(r.pushedAt):'')+'<span>'+stars(r.stars)+'</span>'+(r.license?'<span>'+esc(r.license)+'</span>':'<span>no license</span>')+'<span>'+(r.sizeKb>=1024?Math.round(r.sizeKb/1024)+' MB':r.sizeKb+' KB')+'</span>'+(r.archived?'<span>archived</span>':'')+'</div>'+
  '<div class="acts">'+(big?'<span class="empty">Too big to import (over ${MAX_IMPORT_KB / 1024} MB)</span>':'<button type="button" class="btn" data-import="'+esc(r.fullName)+'">Import</button>')+'<a class="chipbtn" href="'+esc(r.url)+'" target="_blank" rel="noopener">View on GitHub</a></div></div>';}).join('');}
$q.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(run,450);});
document.getElementById('gq').onsubmit=(e)=>{e.preventDefault();clearTimeout(timer);run();};
document.getElementById('sugg').onclick=(e)=>{const b=e.target.closest('[data-q]');if(b){$q.value=b.dataset.q;run();}};
$res.addEventListener('click',async(e)=>{const b=e.target.closest('[data-import]');if(!b)return;
 b.disabled=true;b.textContent='Importing';
 const r=await fetch('/api/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({repo:b.dataset.import})});
 const j=await r.json().catch(()=>({}));if(r.ok)location.href=j.path;else{b.disabled=false;b.textContent=j.error||'Import failed';}});
if(location.hash.length>1){$q.value=decodeURIComponent(location.hash.slice(1));run();}
<\/script>`, REPO_STEPS);
}
__name(importPage, "importPage");
function buildLogPage(info, label2, d) {
  return shell(`Build log \xB7 ${info.name} \xB7 qodebase`, `<a class="back" href="/p/${info.owner}/${info.name}">${esc4(info.owner)} / ${esc4(info.name)}</a>
<h1>Build log</h1><p class="desc">${esc4(label2)}${d ? `: ${esc4(d.status)}${d.error ? `, ${esc4(d.error)}` : ""}` : ": no build yet"}</p>
${d?.url ? `<p><a href="${esc4(d.url)}" target="_blank" rel="noopener">${esc4(d.url)}</a></p>` : ""}
<pre style="background:var(--card);border-radius:12px;padding:12px;overflow:auto;font:12px/1.5 'JetBrains Mono',monospace;white-space:pre-wrap;word-break:break-word">${esc4(d?.log || "No log.")}</pre>`);
}
__name(buildLogPage, "buildLogPage");
function settingsPage(u, owner, projects, welcome, cli = []) {
  const keyBlock = owner ? `<p class="desc">Your agents run on this instance's Claude subscription. No API key needed.</p>` : `${u.apiKeyTail ? `<p class="desc">Key ending in <b>\u2026${esc4(u.apiKeyTail)}</b>, checked ${freshTag(u.apiKeyCheckedAt || 0, Date.now(), STEPS)}. Your agents run on it with ${esc4({ "claude-sonnet-5-5": "Sonnet 5.5", "claude-opus-5-5": "Opus 5.5", "claude-sonnet-5": "Sonnet 5" }[u.model || "claude-sonnet-5-5"] || u.model || "Sonnet 5.5")}.</p>` : `<p class="desc">Agents run Claude Code with your own Anthropic API key. You pay Anthropic directly; qodebase measured about $1\u20132 per finished, reviewed change on Sonnet.</p>`}
<form class="composer" id="keyf"><input class="field" name="key" type="password" autocomplete="off" placeholder="sk-ant-\u2026" aria-label="Anthropic API key">
<div class="bar"><button class="btn">${u.apiKeyTail ? "Replace key" : "Save key"}</button>${u.apiKeyTail ? '<button type="button" class="chipbtn" id="rmkey">Remove</button>' : ""}</div></form>
<p class="note">The key is checked with one call to Anthropic, stored encrypted, and only used to start Claude Code in your projects' boxes. Get one at <a href="https://console.anthropic.com/settings/keys" rel="noopener" target="_blank">console.anthropic.com</a>. Have a Claude subscription instead? Run <code>claude setup-token</code> on your computer and paste the token it prints (sk-ant-oat\u2026): your agents then run on your subscription.</p>`;
  return shell("Settings \xB7 qodebase", `<a class="back" href="/">Explore</a>
<h1>${welcome ? "Welcome to qodebase" : "Settings"}</h1>
${welcome ? `<p class="desc">You are signed in. ${[projects ? "" : "Pick the name your projects live under", owner ? "" : "add your Anthropic API key", "then fork something from Explore"].filter(Boolean).join(", ").replace(/^./, (c) => c.toUpperCase())}.</p>` : ""}
<h2>Your name</h2>
<form class="composer" id="hf"><input class="field" name="handle" value="${esc4(u.handle)}" ${projects ? "disabled" : ""} autocapitalize="none" spellcheck="false" aria-label="Handle">
${projects ? `<p class="note">You own ${projects} project${projects > 1 ? "s" : ""} under this name, so it stays.</p>` : '<div class="bar"><button class="btn">Save name</button></div>'}</form>
<h2>Anthropic API key</h2>${keyBlock}
<p class="err" id="msg" role="status"></p>
<h2>Command line</h2>
<p class="desc">${cli.length ? `Signed-in CLIs (last used):` : `No CLI signed in.`} <a href="/cli">Install qb</a> to use qodebase from a terminal or an agent.</p>
${cli.map((t) => `<div class="actions cli-t"><span><b>${esc4(t.label)}</b> ${freshTag(t.usedAt, Date.now(), STEPS)}</span><button type="button" class="chipbtn" data-revoke="${esc4(t.id)}">Revoke</button></div>`).join("")}
<h2>Account</h2><p class="desc">Signed in as ${esc4(u.email)}.</p><div class="actions"><a class="chipbtn" href="/logout">Sign out</a></div>
<style>.field{width:100%;font:16px 'Instrument Sans',sans-serif;padding:12px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg)}.cli-t{align-items:center;justify-content:space-between;margin:8px 0}.cli-t span{display:flex;gap:8px;align-items:center;min-width:0}.err{min-height:1.4em;color:var(--dim);font-size:15px;margin:8px 0 0}.err.bad{color:var(--fg);font-weight:600}</style>
<script>
const msg=document.getElementById('msg');
// The message shows under the form that was used, not at the foot of the page
// (a refused key was easy to miss there, seen in the sign-up video).
async function call(url,method,body,form){if(form)form.after(msg);msg.classList.remove('bad');const r=await fetch(url,{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const j=await r.json().catch(()=>({}));if(!r.ok){msg.textContent=j.error||'Failed';msg.classList.add('bad');return null;}return j;}
const hf=document.getElementById('hf');if(hf)hf.onsubmit=async(e)=>{e.preventDefault();msg.textContent='Saving';if(await call('/api/me/handle','POST',{handle:hf.handle.value},hf))location.reload();};
const kf=document.getElementById('keyf');if(kf)kf.onsubmit=async(e)=>{e.preventDefault();msg.textContent='Checking the key with Anthropic';if(await call('/api/me/key','POST',{key:kf.key.value},kf))location.reload();};
document.querySelectorAll('[data-revoke]').forEach((b)=>b.onclick=async()=>{if(await call('/api/cli/revoke','POST',{id:b.dataset.revoke},b.parentElement))location.reload();});
const rm=document.getElementById('rmkey');if(rm)rm.onclick=async()=>{if(await call('/api/me/key','DELETE'))location.reload();};
<\/script>`);
}
__name(settingsPage, "settingsPage");
function aboutPage() {
  return shell("About \xB7 qodebase", `<a class="back" href="/">Explore</a>
<h1>About qodebase</h1>
<p class="desc">qodebase is a git platform for the age of agents, built on Cloudflare (Artifacts, Containers, Durable Objects, Workers) and made for the phone. Every project runs; every fork comes with its own agents.</p>
<h2>How it works</h2>
<p class="desc">You tell a project's router agent what to change. It starts one agent per task, each in its own container on its own fork. A reviewer agent checks every push in a live preview before you merge. Errors from a deployed app can start a fix by themselves.</p>
<h2>Whose Claude</h2>
<p class="desc">Agents run Claude Code with your own Anthropic API key, which you add in Settings. You pay Anthropic directly. qodebase measured about $1\u20132 per finished, reviewed change on Sonnet.</p>
<h2>Contact</h2>
<p class="desc">hello@kapps.dev, or the <a href="/feedback?from=/about">feedback form</a>.</p>`);
}
__name(aboutPage, "aboutPage");
function privacyPage() {
  return shell("Privacy \xB7 qodebase", `<a class="back" href="/">Explore</a>
<h1>Privacy</h1>
<p class="desc">What qodebase stores: your email address and the name you choose; your Anthropic API key, encrypted, used only to start Claude Code in your projects' containers; the projects, forks and agent conversations you create. Projects are public to read.</p>
<p class="desc">Private projects: only you see them on qodebase (the project, its code, its live app and its agents). Their code is still stored in this instance's Cloudflare account, so whoever runs the instance can technically read it; for code only you can reach, <a href="/own">get your own qodebase</a>.</p>
<p class="desc">Sign-in is handled by Cloudflare Access: with your Google account, or with a one-time code sent to your email. With Google, qodebase receives only your email address from Google, nothing else from your account. qodebase sets one cookie, to keep you signed in.</p>
<p class="desc">Visits are counted with our own analytics (kstats), sent to qodebase itself and not to a third party: the pages you open, the buttons and links you tap, the kind of device and the country. Your IP address is used once to make a visitor code that changes every day, and is not stored. No ad trackers.</p>
<p class="desc">The <a href="/feedback">feedback form</a> keeps your message, the page you sent it from, the kind of device, and your email only if you give one.</p>
<p class="desc">Your agents' requests go to Anthropic under your key and Anthropic's terms. To delete your account and data, write to hello@kapps.dev.</p>`);
}
__name(privacyPage, "privacyPage");

// ../src/alert.ts
var log2 = /* @__PURE__ */ __name((event, data = {}) => console.log(JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), level: event === "alert_failed" ? "error" : "info", module: "alert", event, ...data })), "log");
async function pushAlert(env, title, message2, url, priority = 0) {
  if (!env.PUSHOVER_TOKEN || !env.PUSHOVER_USER) {
    log2("alert_unconfigured", { title });
    return;
  }
  const form = new FormData();
  form.set("token", env.PUSHOVER_TOKEN);
  form.set("user", env.PUSHOVER_USER);
  form.set("title", title.slice(0, 250));
  form.set("message", message2.slice(0, 1024));
  form.set("priority", String(priority));
  if (url) form.set("url", url);
  try {
    const r = await fetch("https://api.pushover.net/1/messages.json", { method: "POST", body: form });
    log2(r.ok ? "alert_sent" : "alert_failed", { title, status: r.status });
  } catch (err) {
    log2("alert_failed", { title, err: String(err) });
  }
}
__name(pushAlert, "pushAlert");

// ../src/baseline.ts
var KSTATS_SITE = "forq";
var KSTATS_COLLECTOR = "https://stats.kapps.dev/e";
var INBOX = "https://remote-manage.kapps.dev/api/agent/feedback";
var log3 = /* @__PURE__ */ __name((event, data = {}) => console.log(JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), level: /fail|error/.test(event) ? "error" : "info", module: "baseline", event, ...data })), "log");
var esc5 = /* @__PURE__ */ __name((s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]), "esc");
async function withBaseline(request, env, res) {
  if (!(res.headers.get("content-type") || "").startsWith("text/html") || res.status !== 200) return res;
  const url = new URL(request.url);
  const host = request.headers.get("x-forq-host") || url.hostname;
  let title = "";
  let desc = "";
  let hasOg = false;
  return new HTMLRewriter().on("title", { text(t) {
    title += t.text;
  } }).on('meta[name="description"]', { element(e) {
    desc = e.getAttribute("content") || desc;
  } }).on('meta[property="og:image"]', { element() {
    hasOg = true;
  } }).on("head", {
    element(e) {
      e.onEndTag(async (end) => {
        const tags = !env.KSTATS_KEY ? [] : [`<script>(function(){function k(){var s=document.createElement('script');s.defer=true;s.src='https://stats.kapps.dev/k.js';s.setAttribute('data-site','${KSTATS_SITE}');document.head.appendChild(s)}if(document.prerendering)document.addEventListener('prerenderingchange',k,{once:true});else k()})()<\/script>`];
        tags.push('<link rel="icon" href="/icon.svg" type="image/svg+xml">');
        tags.push('<script src="/talk.js" defer><\/script>');
        if (!hasOg) tags.push(...await shareTags(env, host, url.pathname, title, desc));
        end.before(tags.join(""), { html: true });
      });
    }
  }).transform(res);
}
__name(withBaseline, "withBaseline");
async function shareTags(env, host, path2, rawTitle, desc) {
  const title = rawTitle.replace(/\s*·\s*qodebase(\s*\([A-D]\))?\s*$/, "").trim() || "qodebase";
  const page = `https://${host}${path2}`;
  const tags = [
    `<meta property="og:site_name" content="qodebase">`,
    `<meta property="og:title" content="${esc5(title)}">`,
    `<meta property="og:url" content="${esc5(page)}">`,
    `<meta property="og:type" content="website">`
  ];
  if (desc) tags.push(`<meta property="og:description" content="${esc5(desc)}">`);
  if (env.OG_KEY) {
    const project = path2.match(/^\/p\/([a-z0-9-]+)\/([a-z0-9.-]+)/);
    const spec = {
      v: 1,
      layout: "text",
      ...project ? { eyebrow: `${project[1]}/${project[2]}` } : {},
      title: project && title.startsWith(`${project[1]}/`) ? desc || title : title,
      ...desc && !(project && title.startsWith(`${project[1]}/`)) ? { subtitle: desc.slice(0, 400) } : {},
      footer: env.UI_HOST
    };
    const img = await signedCard(env.OG_KEY, spec);
    tags.push(`<meta property="og:image" content="${img}">`, `<meta property="og:image:width" content="1200">`, `<meta property="og:image:height" content="630">`, `<meta name="twitter:card" content="summary_large_image">`);
  }
  return tags;
}
__name(shareTags, "shareTags");
var b64url = /* @__PURE__ */ __name((bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), "b64url");
var ogKey;
async function signedCard(secret, spec) {
  ogKey ||= crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const payload = b64url(new TextEncoder().encode(JSON.stringify(spec)));
  const sig2 = b64url(new Uint8Array(await crypto.subtle.sign("HMAC", await ogKey, new TextEncoder().encode(payload))));
  return `https://og.kapps.dev/forq/${payload}.${sig2}.png`;
}
__name(signedCard, "signedCard");
function kstatsForward(request, env, ctx) {
  if (request.method === "GET") {
    const on = new URL(request.url).searchParams.get("self") !== "0";
    return new Response(
      `<!doctype html><meta charset=utf-8><title>kstats</title><body style="font:15px system-ui;padding:2rem">
<script>try{${on ? "localStorage.setItem('k:self','1')" : "localStorage.removeItem('k:self')"};document.body.append('${on ? "This browser is now excluded from stats on " : "This browser is counted again on "}'+location.hostname)}catch(e){document.body.append('localStorage unavailable')}<\/script>`,
      { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
    );
  }
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const cf2 = request.cf || {};
  ctx.waitUntil(fetch(KSTATS_COLLECTOR, {
    method: "POST",
    body: request.body,
    headers: {
      "content-type": "application/json",
      "x-k-key": env.KSTATS_KEY || "",
      "x-k-ip": request.headers.get("cf-connecting-ip") || "",
      "x-k-ua": request.headers.get("user-agent") || "",
      "x-k-cc": cf2.country || "",
      "x-k-vbot": cf2.verifiedBotCategory || "",
      "x-k-asn": String(cf2.asn || ""),
      "x-k-asorg": cf2.asOrganization || ""
    }
  }).then((r) => {
    if (!r.ok) log3("kstats_forward_failed", { status: r.status });
  }).catch((err) => log3("kstats_forward_failed", { err: String(err) })));
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
__name(kstatsForward, "kstatsForward");
var KINDS = [["problem", "Something is wrong"], ["idea", "An idea"], ["praise", "I like it"], ["other", "Something else"]];
function device(ua) {
  const os = /Android/.test(ua) ? "android" : /iPhone|iPad/.test(ua) ? "ios" : /Mac OS X/.test(ua) ? "mac" : /Windows/.test(ua) ? "windows" : /Linux/.test(ua) ? "linux" : "other";
  const br = /Edg\//.test(ua) ? "edge" : /Firefox\//.test(ua) ? "firefox" : /Chrome\//.test(ua) ? "chrome" : /Safari\//.test(ua) ? "safari" : "other";
  return `${os}/${br}`;
}
__name(device, "device");
var safeFrom = /* @__PURE__ */ __name((s) => s && s.startsWith("/") && !s.startsWith("//") ? s.slice(0, 300) : "/", "safeFrom");
function feedbackPage(o) {
  const body = o.done ? `<h1>Thank you</h1><p class="desc">It reached us. If you left an email, a person will answer.</p><div class="actions"><a class="btn" href="${esc5(o.from)}">Back to where you were</a></div>` : `<h1>Feedback</h1>
<p class="desc">What is wrong, missing or good. A person reads every message.</p>
${o.error ? `<p class="fb-err" role="alert">${esc5(o.error)}</p>` : ""}
<form method="post" action="/feedback" class="fb">
<input type="hidden" name="from" value="${esc5(o.from)}"><input type="hidden" name="self" value="0" id="fbself">
<fieldset><legend>It is about</legend>${KINDS.map(([v, l]) => `<label><input type="radio" name="kind" value="${v}"${(o.kind || "problem") === v ? " checked" : ""}> ${l}</label>`).join("")}</fieldset>
<label for="fbmsg">Message</label><textarea id="fbmsg" name="msg" required maxlength="5000" rows="6">${esc5(o.msg || "")}</textarea>
<label for="fbmail">Email, only to reply (optional)</label><input id="fbmail" class="field" type="email" name="email" value="${esc5(o.email || "")}" autocomplete="email">
<div class="hp" aria-hidden="true"><label>Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label></div>
<div class="bar"><button class="btn">Send</button></div>
<p class="note">Sent from ${esc5(o.from)}. We keep the message, the page, the kind of device and the email if you give one. See <a href="/privacy">Privacy</a>.</p>
</form>
<script>try{if(localStorage.getItem('k:self')==='1')document.getElementById('fbself').value='1'}catch(e){}<\/script>`;
  return shell("Feedback \xB7 qodebase", `<a class="back" href="${esc5(o.from)}">Back</a>
${body}
<style>.fb{display:grid;gap:8px;margin-top:16px}.fb fieldset{border:0;padding:0;margin:0 0 8px;display:grid;gap:8px}.fb legend{font-weight:600;margin-bottom:4px}
.fb label{font-size:15px}.fb fieldset label{display:flex;align-items:center;gap:10px;min-height:44px;padding:0 12px;border:1px solid var(--line);border-radius:8px;background:var(--card)}
.fb textarea,.fb .field{width:100%;font:16px 'Instrument Sans',sans-serif;padding:12px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg)}
.fb .bar{margin-top:8px}.fb .note{color:var(--dim);font-size:14px}.hp{position:absolute;left:-9999px}.fb-err{color:var(--warn,#b45309);font-weight:500}</style>`);
}
__name(feedbackPage, "feedbackPage");
async function feedback(request, env) {
  const page = /* @__PURE__ */ __name((o2, status = 200) => new Response(feedbackPage(o2), { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }), "page");
  const url = new URL(request.url);
  if (request.method === "GET") return page({ from: safeFrom(url.searchParams.get("from")) });
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const f = await request.formData().catch(() => null);
  const get = /* @__PURE__ */ __name((k2) => String(f?.get(k2) ?? "").trim(), "get");
  const o = { from: safeFrom(get("from")), kind: KINDS.some(([v]) => v === get("kind")) ? get("kind") : "other", msg: get("msg").slice(0, 5e3), email: get("email").slice(0, 200) };
  if (get("website")) {
    log3("feedback_honeypot", { from: o.from });
    return page({ from: o.from, done: true });
  }
  if (!o.msg) return page({ ...o, error: "Write a message first." }, 400);
  const self = get("self") === "1";
  const body = { project: "forq", kind: o.kind, msg: o.msg, email: o.email || void 0, page: `https://${request.headers.get("x-forq-host") || url.hostname}${o.from}`, loc: "en", dev: device(request.headers.get("user-agent") || ""), self };
  let r = null;
  try {
    r = await fetch(INBOX, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.FEEDBACK_KEY || ""}` }, body: JSON.stringify(body) });
  } catch (err) {
    log3("feedback_store_failed", { err: String(err), stack: err?.stack });
  }
  if (r?.ok) {
    log3("feedback_stored", { kind: o.kind, self });
    return page({ from: o.from, done: true });
  }
  log3("feedback_store_failed", { status: r?.status ?? 0, body: r ? (await r.text().catch(() => "")).slice(0, 200) : "" });
  await pushAlert(env, "qodebase feedback NOT stored", `${o.kind} from ${o.email || "no email"} on ${o.from}:
${o.msg}`, body.page, 1);
  return page({ ...o, error: "It did not go through on our side. Your text is still here: try again, or email hello@kapps.dev." }, 502);
}
__name(feedback, "feedback");
async function health(env, ctx, origin) {
  const cache2 = caches.default;
  const key = new Request(`${origin}/health.json?memo=${env.CF_VERSION_METADATA?.id || "none"}`);
  const hit = await cache2.match(key);
  if (hit) return new Response(hit.body, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  const checks = [];
  const at = (/* @__PURE__ */ new Date()).toISOString();
  try {
    const entries = await registry(env).list();
    const infos = await Promise.all(entries.map((e) => env.Project.get(env.Project.idFromName(e.slug)).info().catch(() => null)));
    const failed = infos.filter((i) => i?.kind === "worker" && i.app?.status === "failed" && (i.owner === env.OWNER_HANDLE || i.owner === "forq")).map((i) => i.slug);
    checks.push({ id: "builds", label: "Worker app deploys", status: failed.length ? "bad" : "ok", detail: failed.length ? `${failed.length} failed: ${failed.slice(0, 3).join(", ")}` : `${infos.filter((i) => i?.kind === "worker").length} live`, at });
  } catch (err) {
    checks.push({ id: "builds", label: "Worker app deploys", status: "unknown", detail: `could not read: ${String(err).slice(0, 80)}`, at });
  }
  const res = new Response(
    JSON.stringify({ sha: env.CF_VERSION_METADATA?.tag || null, version: env.CF_VERSION_METADATA?.id || null, built: env.CF_VERSION_METADATA?.timestamp || null, checks }),
    { headers: { "content-type": "application/json", "cache-control": "no-store" } }
  );
  const memo2 = new Response(res.clone().body, { headers: { "content-type": "application/json", "cache-control": "s-maxage=300" } });
  ctx.waitUntil(cache2.put(key, memo2));
  return res;
}
__name(health, "health");

// ../node_modules/jose/dist/webapi/lib/buffer_utils.js
var encoder = new TextEncoder();
var decoder = new TextDecoder();
var strictDecoder = new TextDecoder("utf-8", { fatal: true });
var MAX_INT32 = 2 ** 32;
function concat(...buffers) {
  const size = buffers.reduce((acc, { length }) => acc + length, 0), buf = new Uint8Array(size);
  let i = 0;
  for (const buffer of buffers)
    buf.set(buffer, i), i += buffer.length;
  return buf;
}
__name(concat, "concat");
var NON_ASCII = /[^\x00-\x7f]/;
function encode(string) {
  if (typeof string == "string" && string.length >= 128) {
    if (NON_ASCII.test(string))
      throw new TypeError("non-ASCII string encountered in encode()");
    return encoder.encode(string);
  }
  const bytes = new Uint8Array(string.length);
  for (let i = 0; i < string.length; i++) {
    const code = string.charCodeAt(i);
    if (code > 127)
      throw new TypeError("non-ASCII string encountered in encode()");
    bytes[i] = code;
  }
  return bytes;
}
__name(encode, "encode");
function decodeBase64(encoded, url = false) {
  if (Uint8Array.fromBase64)
    return Uint8Array.fromBase64(encoded, { alphabet: url ? "base64url" : "base64" });
  if (url) {
    if (encoded.includes("+") || encoded.includes("/"))
      throw new TypeError("Invalid base64url");
    encoded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  }
  const binary = atob(encoded), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++)
    bytes[i] = binary.charCodeAt(i);
  return bytes;
}
__name(decodeBase64, "decodeBase64");

// ../node_modules/jose/dist/webapi/util/errors.js
var JOSEError = class extends Error {
  static {
    __name(this, "JOSEError");
  }
  static code = "ERR_JOSE_GENERIC";
  code = "ERR_JOSE_GENERIC";
  constructor(message2, options) {
    super(message2, options), this.name = this.constructor.name, Error.captureStackTrace?.(this, this.constructor);
  }
};
var JWTClaimValidationFailed = class extends JOSEError {
  static {
    __name(this, "JWTClaimValidationFailed");
  }
  static code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
  code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
  claim;
  reason;
  payload;
  constructor(message2, payload, claim = "unspecified", reason = "unspecified") {
    super(message2, { cause: { claim, reason, payload } }), this.claim = claim, this.reason = reason, this.payload = payload;
  }
};
var JWTExpired = class extends JOSEError {
  static {
    __name(this, "JWTExpired");
  }
  static code = "ERR_JWT_EXPIRED";
  code = "ERR_JWT_EXPIRED";
  claim;
  reason;
  payload;
  constructor(message2, payload, claim = "unspecified", reason = "unspecified") {
    super(message2, { cause: { claim, reason, payload } }), this.claim = claim, this.reason = reason, this.payload = payload;
  }
};
var JOSEAlgNotAllowed = class extends JOSEError {
  static {
    __name(this, "JOSEAlgNotAllowed");
  }
  static code = "ERR_JOSE_ALG_NOT_ALLOWED";
  code = "ERR_JOSE_ALG_NOT_ALLOWED";
};
var JOSENotSupported = class extends JOSEError {
  static {
    __name(this, "JOSENotSupported");
  }
  static code = "ERR_JOSE_NOT_SUPPORTED";
  code = "ERR_JOSE_NOT_SUPPORTED";
};
var JWSInvalid = class extends JOSEError {
  static {
    __name(this, "JWSInvalid");
  }
  static code = "ERR_JWS_INVALID";
  code = "ERR_JWS_INVALID";
};
var JWTInvalid = class extends JOSEError {
  static {
    __name(this, "JWTInvalid");
  }
  static code = "ERR_JWT_INVALID";
  code = "ERR_JWT_INVALID";
};
var JWKSInvalid = class extends JOSEError {
  static {
    __name(this, "JWKSInvalid");
  }
  static code = "ERR_JWKS_INVALID";
  code = "ERR_JWKS_INVALID";
};
var JWKSNoMatchingKey = class extends JOSEError {
  static {
    __name(this, "JWKSNoMatchingKey");
  }
  static code = "ERR_JWKS_NO_MATCHING_KEY";
  code = "ERR_JWKS_NO_MATCHING_KEY";
  constructor(message2 = "no applicable key found in the JSON Web Key Set", options) {
    super(message2, options);
  }
};
var JWKSMultipleMatchingKeys = class extends JOSEError {
  static {
    __name(this, "JWKSMultipleMatchingKeys");
  }
  [Symbol.asyncIterator] = async function* () {
  };
  static code = "ERR_JWKS_MULTIPLE_MATCHING_KEYS";
  code = "ERR_JWKS_MULTIPLE_MATCHING_KEYS";
  constructor(message2 = "multiple matching keys found in the JSON Web Key Set", options) {
    super(message2, options);
  }
};
var JWKSTimeout = class extends JOSEError {
  static {
    __name(this, "JWKSTimeout");
  }
  static code = "ERR_JWKS_TIMEOUT";
  code = "ERR_JWKS_TIMEOUT";
  constructor(message2 = "request timed out", options) {
    super(message2, options);
  }
};
var JWSSignatureVerificationFailed = class extends JOSEError {
  static {
    __name(this, "JWSSignatureVerificationFailed");
  }
  static code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
  code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
  constructor(message2 = "signature verification failed", options) {
    super(message2, options);
  }
};

// ../node_modules/jose/dist/webapi/util/base64url.js
var invalid = "The input to be decoded is not correctly encoded.";
function decode(input) {
  try {
    return decodeBase64(typeof input == "string" ? input : decoder.decode(input), true);
  } catch (cause) {
    throw new TypeError(invalid, { cause });
  }
}
__name(decode, "decode");

// ../node_modules/jose/dist/webapi/lib/validate.js
function isObject(input) {
  if (typeof input != "object" || input === null || Object.prototype.toString.call(input) !== "[object Object]")
    return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}
__name(isObject, "isObject");
function isJwkSet(input) {
  return isObject(input) && Array.isArray(input.keys) && Array.from(input.keys).every(isObject);
}
__name(isJwkSet, "isJwkSet");
function isDisjoint(...headers) {
  const parameters = /* @__PURE__ */ new Set();
  for (const header of headers)
    if (header)
      for (const parameter of Object.keys(header)) {
        if (parameters.has(parameter))
          return false;
        parameters.add(parameter);
      }
  return true;
}
__name(isDisjoint, "isDisjoint");
function decodeBase64url(value, label2, ErrorClass) {
  try {
    return decode(value);
  } catch {
    throw new ErrorClass(`Failed to base64url decode the ${label2}`);
  }
}
__name(decodeBase64url, "decodeBase64url");
function encodeBase64url(value, label2, ErrorClass) {
  try {
    return encode(value);
  } catch {
    throw new ErrorClass(`The ${label2} is not a valid base64url string`);
  }
}
__name(encodeBase64url, "encodeBase64url");
function parseJoseHeader(b642, ErrorClass, message2) {
  let parsed;
  try {
    parsed = JSON.parse(strictDecoder.decode(decode(b642)));
  } catch {
    throw new ErrorClass(message2);
  }
  if (!isObject(parsed))
    throw new ErrorClass(message2);
  return parsed;
}
__name(parseJoseHeader, "parseJoseHeader");
var JWS_RECOGNIZED = { __proto__: null, b64: true };
function validateAlgorithms(option, algorithms) {
  if (algorithms !== void 0 && (!Array.isArray(algorithms) || algorithms.some((s) => typeof s != "string")))
    throw new TypeError(`"${option}" option must be an array of strings`);
  return algorithms === void 0 ? void 0 : new Set(algorithms);
}
__name(validateAlgorithms, "validateAlgorithms");
function validateCrit(Err, recognizedDefault, recognizedOption, protectedHeader, joseHeader) {
  if (joseHeader.crit !== void 0 && protectedHeader?.crit === void 0)
    throw new Err('"crit" (Critical) Header Parameter MUST be integrity protected');
  if (!protectedHeader || protectedHeader.crit === void 0)
    return [];
  if (!Array.isArray(protectedHeader.crit) || protectedHeader.crit.length === 0 || protectedHeader.crit.some((input) => typeof input != "string" || input.length === 0))
    throw new Err('"crit" (Critical) Header Parameter MUST be an array of non-empty strings when present');
  const recognized = recognizedOption === void 0 ? recognizedDefault : { __proto__: null, ...recognizedOption, ...recognizedDefault };
  for (const parameter of protectedHeader.crit) {
    if (!(parameter in recognized))
      throw new JOSENotSupported(`Extension Header Parameter "${parameter}" is not recognized`);
    if (!Object.hasOwn(joseHeader, parameter) || joseHeader[parameter] === void 0)
      throw new Err(`Extension Header Parameter "${parameter}" is missing`);
    if (recognized[parameter] && (!Object.hasOwn(protectedHeader, parameter) || protectedHeader[parameter] === void 0))
      throw new Err(`Extension Header Parameter "${parameter}" MUST be integrity protected`);
  }
  return protectedHeader.crit;
}
__name(validateCrit, "validateCrit");
function validateB64(protectedHeader, extensions) {
  if (extensions.includes("b64")) {
    const b642 = protectedHeader.b64;
    if (typeof b642 != "boolean")
      throw new JWSInvalid('The "b64" (base64url-encode payload) Header Parameter must be a boolean');
    return b642;
  }
  return true;
}
__name(validateB64, "validateB64");

// ../node_modules/jose/dist/webapi/lib/key.js
var tag = /* @__PURE__ */ __name((key) => key[Symbol.toStringTag], "tag");
var jwkMatchesOp = /* @__PURE__ */ __name((entry, key, usage) => {
  const { alg } = entry;
  if (key.use !== void 0) {
    const expected = usage === "sign" || usage === "verify" ? "sig" : "enc";
    if (key.use !== expected)
      throw new TypeError(`Invalid key for this operation, its "use" must be "${expected}" when present`);
  }
  if (key.alg !== void 0 && key.alg !== alg)
    throw new TypeError(`Invalid key for this operation, its "alg" must be "${alg}" when present`);
  if (Array.isArray(key.key_ops)) {
    const expectedKeyOp = usage === "encrypt" || usage === "decrypt" ? entry.ops?.[usage === "encrypt" ? 0 : 1] : usage;
    if (expectedKeyOp && !key.key_ops.includes(expectedKeyOp))
      throw new TypeError(`Invalid key for this operation, its "key_ops" must include "${expectedKeyOp}" when present`);
  }
}, "jwkMatchesOp");
async function prepareKey(entry, key, usage) {
  const { alg, secret } = entry, privateKey = usage === "decrypt" || usage === "sign";
  if (secret && key instanceof Uint8Array)
    return key;
  let normalized, keyObject;
  if (isObject(key)) {
    if (normalized = normalizeJwk(key), typeof normalized.kty != "string")
      throw invalidKeyType(alg, key, secret);
    if (!(secret ? normalized.kty === "oct" && typeof normalized.k == "string" : normalized.kty !== "oct" && (privateKey ? normalized.kty === "AKP" && typeof normalized.priv == "string" || typeof normalized.d == "string" : normalized.d === void 0 && normalized.priv === void 0)))
      throw new TypeError(secret ? 'JSON Web Key for symmetric algorithms must have JWK "kty" (Key Type) equal to "oct" and the JWK "k" (Key Value) present' : `JSON Web Key for this operation must be a ${privateKey ? "private" : "public"} JWK`);
    if (jwkMatchesOp(entry, normalized, usage), normalized.kty === "oct")
      return decode(normalized.k);
    if (!Object.isFrozen(key)) {
      const { key_ops } = key;
      Array.isArray(key_ops) && Object.freeze(key_ops), Object.freeze(key);
    }
  } else {
    if (!isKeyLike(key))
      throw invalidKeyType(alg, key, secret);
    const expectedType = secret ? "secret" : privateKey ? "private" : "public";
    if (key.type !== expectedType && (secret || ["secret", "public", "private"].includes(key.type)))
      throw new TypeError(`${tag(key)} instances must be of type "${expectedType}" for the ${alg} algorithm`);
    if (isCryptoKey(key))
      return key;
    if (keyObject = key, keyObject.type === "secret")
      return keyObject.export();
  }
  cache ||= /* @__PURE__ */ new WeakMap();
  const cacheKey = key;
  let cached = cache.get(cacheKey);
  if (cached?.[alg])
    return cached[alg];
  if (cached || cache.set(cacheKey, cached = {}), keyObject && typeof keyObject.toCryptoKey == "function") {
    const isPublic = keyObject.type === "public", crv = nist[keyObject.asymmetricKeyDetails?.namedCurve], params = entry.resolve?.({ crv, asymmetricKeyType: keyObject.asymmetricKeyType }) ?? entry.subtle;
    return cached[alg] = keyObject.toCryptoKey(params, isPublic, entry.usages[isPublic ? 0 : 1]);
  }
  return normalized ??= keyObject.export({ format: "jwk" }), normalized.alg = alg, cached[alg] = await jwkToKey(entry, normalized);
}
__name(prepareKey, "prepareKey");
var cache;
var nist = {
  __proto__: null,
  prime256v1: "P-256",
  secp384r1: "P-384",
  secp521r1: "P-521"
};
var isCryptoKey = /* @__PURE__ */ __name((key) => {
  if (key?.[Symbol.toStringTag] === "CryptoKey")
    return true;
  try {
    return key instanceof CryptoKey;
  } catch {
    return false;
  }
}, "isCryptoKey");
var isKeyObject = /* @__PURE__ */ __name((key) => key?.[Symbol.toStringTag] === "KeyObject", "isKeyObject");
var isKeyLike = /* @__PURE__ */ __name((key) => isCryptoKey(key) || isKeyObject(key), "isKeyLike");
function message(msg, actual, ...types) {
  if (types.length > 2) {
    const last = types.pop();
    msg += `one of type ${types.join(", ")}, or ${last}.`;
  } else types.length === 2 ? msg += `one of type ${types[0]} or ${types[1]}.` : msg += `of type ${types[0]}.`;
  return actual == null ? msg += ` Received ${actual}` : typeof actual == "function" && actual.name ? msg += ` Received function ${actual.name}` : typeof actual == "object" && actual != null && actual.constructor?.name && (msg += ` Received an instance of ${actual.constructor.name}`), msg;
}
__name(message, "message");
function invalidKeyType(alg, actual, secret) {
  const types = ["CryptoKey", "KeyObject", "JSON Web Key"];
  return secret && types.push("Uint8Array"), new TypeError(message(`Key for the ${alg} algorithm must be `, actual, ...types));
}
__name(invalidKeyType, "invalidKeyType");
var unusable = /* @__PURE__ */ __name((name, prop = "algorithm.name") => new TypeError(`CryptoKey does not support this operation, its ${prop} must be ${name}`), "unusable");
function checkUsage(key, usage) {
  if (usage && !key.usages.includes(usage))
    throw new TypeError(`CryptoKey does not support this operation, its usages must include ${usage}.`);
}
__name(checkUsage, "checkUsage");
function checkModulusLength(alg, key) {
  const { modulusLength } = key.algorithm;
  if (typeof modulusLength != "number" || modulusLength < 2048)
    throw new TypeError(`${alg} requires key modulusLength to be 2048 bits or larger`);
}
__name(checkModulusLength, "checkModulusLength");
function checkCryptoKey(key, expected, usage) {
  const algorithm = key.algorithm;
  if (algorithm.name !== expected.name)
    throw unusable(expected.name);
  if (expected.hash && algorithm.hash?.name !== expected.hash)
    throw unusable(expected.hash, "algorithm.hash");
  if (expected.namedCurve && algorithm.namedCurve !== expected.namedCurve)
    throw unusable(expected.namedCurve, "algorithm.namedCurve");
  if (expected.length !== void 0 && algorithm.length !== expected.length)
    throw unusable(expected.length, "algorithm.length");
  checkUsage(key, usage);
}
__name(checkCryptoKey, "checkCryptoKey");
function snapshotJwk(jwk) {
  return { __proto__: null, ...jwk };
}
__name(snapshotJwk, "snapshotJwk");
function normalizeJwk(jwk) {
  const normalized = snapshotJwk(jwk);
  if (normalized.ext !== void 0 && typeof normalized.ext != "boolean")
    throw new TypeError('"ext" (Extractable) Parameter must be a boolean');
  if (normalized.key_ops !== void 0) {
    const value = normalized.key_ops, keyOps = Array.isArray(value) ? [...value] : void 0;
    if (!keyOps || keyOps.some((operation) => typeof operation != "string") || new Set(keyOps).size !== keyOps.length)
      throw new TypeError('"key_ops" (Key Operations) Parameter must be an array of unique strings');
    normalized.key_ops = keyOps;
  }
  return normalized;
}
__name(normalizeJwk, "normalizeJwk");
async function jwkToKey(entry, jwk, extractable) {
  if (!entry.kty.includes(jwk.kty))
    throw new JOSENotSupported('Invalid or unsupported JWK "alg" (Algorithm) Parameter value');
  const algorithm = entry.resolve?.({ kty: jwk.kty, crv: jwk.crv }) ?? entry.subtle, isPrivate = !!(jwk.d || jwk.priv), keyData = { ...jwk, ext: extractable ?? jwk.ext };
  return keyData.kty !== "AKP" && delete keyData.alg, delete keyData.use, crypto.subtle.importKey("jwk", keyData, algorithm, keyData.ext ?? !isPrivate, jwk.key_ops ?? entry.usages[isPrivate ? 1 : 0]);
}
__name(jwkToKey, "jwkToKey");
async function rawKey(key, expected, usage, extractable = false) {
  return key instanceof Uint8Array && (key = await crypto.subtle.importKey("raw", key, expected, extractable, [usage])), checkCryptoKey(key, expected, usage), key;
}
__name(rawKey, "rawKey");

// ../node_modules/jose/dist/webapi/lib/key_descriptor.js
function table(entries) {
  const out = { __proto__: null };
  for (const alg in entries)
    out[alg] = { ...entries[alg], alg };
  return out;
}
__name(table, "table");

// ../node_modules/jose/dist/webapi/lib/jws_algorithms.js
var sig = [["verify"], ["sign"]];
function hmac(bits) {
  const subtle = { name: "HMAC", hash: `SHA-${bits}` };
  return { kty: ["oct"], secret: true, subtle, signing: subtle, usages: sig };
}
__name(hmac, "hmac");
function rsa(bits, saltLength) {
  const subtle = { name: saltLength ? "RSA-PSS" : "RSASSA-PKCS1-v1_5", hash: `SHA-${bits}` };
  return {
    kty: ["RSA"],
    subtle,
    signing: saltLength ? { ...subtle, saltLength } : subtle,
    usages: sig,
    minRsaBits: 2048
  };
}
__name(rsa, "rsa");
function ecdsa(crv, bits) {
  return {
    kty: ["EC"],
    crv,
    subtle: { name: "ECDSA", namedCurve: crv },
    signing: { name: "ECDSA", hash: `SHA-${bits}` },
    usages: sig
  };
}
__name(ecdsa, "ecdsa");
function eddsa() {
  const subtle = { name: "Ed25519" };
  return {
    kty: ["OKP"],
    crv: "Ed25519",
    subtle,
    signing: subtle,
    usages: sig
  };
}
__name(eddsa, "eddsa");
function mldsa(bits) {
  const subtle = { name: `ML-DSA-${bits}` };
  return {
    kty: ["AKP"],
    subtle,
    signing: subtle,
    usages: sig
  };
}
__name(mldsa, "mldsa");
var JWS = table({
  HS256: hmac(256),
  HS384: hmac(384),
  HS512: hmac(512),
  RS256: rsa(256),
  RS384: rsa(384),
  RS512: rsa(512),
  PS256: rsa(256, 32),
  PS384: rsa(384, 48),
  PS512: rsa(512, 64),
  ES256: ecdsa("P-256", 256),
  ES384: ecdsa("P-384", 384),
  ES512: ecdsa("P-521", 512),
  EdDSA: eddsa(),
  Ed25519: eddsa(),
  "ML-DSA-44": mldsa(44),
  "ML-DSA-65": mldsa(65),
  "ML-DSA-87": mldsa(87)
});
function jwsAlgorithm(alg) {
  const entry = typeof alg == "string" ? JWS[alg] : void 0;
  if (!entry)
    throw new JOSENotSupported(`alg ${alg} is not supported either by JOSE or your javascript runtime`);
  return entry;
}
__name(jwsAlgorithm, "jwsAlgorithm");

// ../node_modules/jose/dist/webapi/lib/jws_verify.js
function prepareVerify(options) {
  return [options && validateAlgorithms("algorithms", options.algorithms), options?.crit];
}
__name(prepareVerify, "prepareVerify");
function parseProtectedHeader(encodedProtected) {
  return encodedProtected === void 0 ? {} : parseJoseHeader(encodedProtected, JWSInvalid, "JWS Protected Header is invalid");
}
__name(parseProtectedHeader, "parseProtectedHeader");
function encodeCompactUnencodedPayload(payload) {
  try {
    return encode(payload);
  } catch {
    throw new JWSInvalid("JWS Compact Serialization payload must use only ASCII characters");
  }
}
__name(encodeCompactUnencodedPayload, "encodeCompactUnencodedPayload");
async function verifySignature(jws, shared, key, encodeUnencodedPayload, parsedProtected) {
  const { protected: encodedProtected, header, payload: inputPayload } = jws, parsedProt = parsedProtected ?? parseProtectedHeader(encodedProtected);
  if (!isDisjoint(parsedProt, header))
    throw new JWSInvalid("JWS Protected and JWS Unprotected Header Parameter names must be disjoint");
  const joseHeader = { ...parsedProt, ...header }, b642 = validateB64(parsedProt, validateCrit(JWSInvalid, JWS_RECOGNIZED, shared[1], parsedProt, joseHeader)), { alg } = joseHeader;
  if (typeof alg != "string" || !alg)
    throw new JWSInvalid('JWS "alg" (Algorithm) Header Parameter missing or invalid');
  if (shared[0] && !shared[0].has(alg))
    throw new JOSEAlgNotAllowed('"alg" (Algorithm) Header Parameter value not allowed');
  if (b642) {
    if (typeof inputPayload != "string")
      throw new JWSInvalid("JWS Payload must be a string");
  } else if (typeof inputPayload != "string" && !(inputPayload instanceof Uint8Array))
    throw new JWSInvalid("JWS Payload must be a string or an Uint8Array instance");
  const signingPayload = b642 || typeof inputPayload != "string" ? inputPayload : encodeUnencodedPayload(inputPayload);
  let resolvedKey = false;
  typeof key == "function" && (key = await key(parsedProt, jws), resolvedKey = true);
  const entry = jwsAlgorithm(alg), data = concat(encodedProtected !== void 0 ? encode(encodedProtected) : new Uint8Array(), encode("."), typeof signingPayload == "string" ? shared[2] ??= encodeBase64url(signingPayload, "payload", JWSInvalid) : signingPayload), signature = decodeBase64url(jws.signature, "signature", JWSInvalid), k2 = await prepareKey(entry, key, "verify"), cryptoKey = await rawKey(k2, entry.subtle, "verify");
  entry.minRsaBits && checkModulusLength(entry.alg, cryptoKey);
  let verified = false;
  try {
    verified = await crypto.subtle.verify(entry.signing, cryptoKey, signature, data);
  } catch {
  }
  if (!verified)
    throw new JWSSignatureVerificationFailed();
  const result = { payload: typeof signingPayload == "string" ? decodeBase64url(signingPayload, "payload", JWSInvalid) : signingPayload };
  return encodedProtected !== void 0 && (result.protectedHeader = parsedProt), header !== void 0 && (result.unprotectedHeader = header), resolvedKey ? [{ ...result, key: k2 }, b642] : [result, b642];
}
__name(verifySignature, "verifySignature");
async function verifyCompact(jws, shared, key) {
  if (jws instanceof Uint8Array && (jws = decoder.decode(jws)), typeof jws != "string")
    throw new JWSInvalid("Compact JWS must be a string or Uint8Array");
  const { 0: protectedHeader, 1: payload, 2: signature, length } = jws.split(".");
  if (length !== 3)
    throw new JWSInvalid("Invalid Compact JWS");
  return verifySignature({ payload, protected: protectedHeader, signature }, shared, key, encodeCompactUnencodedPayload);
}
__name(verifyCompact, "verifyCompact");

// ../node_modules/jose/dist/webapi/lib/jwt_claims_set.js
var epoch = /* @__PURE__ */ __name((date) => Math.floor(date.getTime() / 1e3), "epoch");
var multipliers = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
  y: 31557600
};
var REGEX = /^(\+|\-)? ?(\d+|\d+\.\d+) ?(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)(?: (ago|from now))?$/i;
var checkFailed = "check_failed";
function invalidDuration() {
  throw new TypeError("Invalid time period format");
}
__name(invalidDuration, "invalidDuration");
function secs(str) {
  typeof str != "string" && invalidDuration();
  const matched = REGEX.exec(str);
  (!matched || matched[4] && matched[1]) && invalidDuration();
  const value = parseFloat(matched[2]), numericDate2 = Math.round(value * multipliers[matched[3][0].toLowerCase()]);
  return Number.isFinite(numericDate2) || invalidDuration(), matched[1] === "-" || matched[4] === "ago" ? -numericDate2 : numericDate2;
}
__name(secs, "secs");
function validateInput(label2, input) {
  if (!Number.isFinite(input))
    throw new TypeError(`Invalid ${label2} input`);
  return input;
}
__name(validateInput, "validateInput");
var normalizeTyp = /* @__PURE__ */ __name((value) => {
  const normalized = value.toLowerCase();
  return value.includes("/") ? normalized : `application/${normalized}`;
}, "normalizeTyp");
var checkAudiencePresence = /* @__PURE__ */ __name((audPayload, audOption) => typeof audPayload == "string" ? audOption.includes(audPayload) : Array.isArray(audPayload) ? audOption.some((aud) => audPayload.includes(aud)) : false, "checkAudiencePresence");
function validateNumericDate(payload, claim, required = false) {
  const value = payload[claim];
  if (!(value === void 0 && !required)) {
    if (typeof value != "number")
      throw new JWTClaimValidationFailed(`"${claim}" claim must be a number`, payload, claim, "invalid");
    return value;
  }
}
__name(validateNumericDate, "validateNumericDate");
function unexpectedClaim(payload, claim) {
  throw new JWTClaimValidationFailed(`unexpected "${claim}" claim value`, payload, claim, checkFailed);
}
__name(unexpectedClaim, "unexpectedClaim");
function validateClaimsSet(protectedHeader, encodedPayload, options = {}) {
  let payload;
  try {
    payload = JSON.parse(strictDecoder.decode(encodedPayload));
  } catch {
  }
  if (!isObject(payload))
    throw new JWTInvalid("JWT Claims Set must be a top-level JSON object");
  const { typ } = options;
  if (typ !== void 0 && (typeof protectedHeader.typ != "string" || normalizeTyp(protectedHeader.typ) !== normalizeTyp(typ)))
    throw new JWTClaimValidationFailed('unexpected "typ" JWT header value', payload, "typ", checkFailed);
  const { requiredClaims = [], issuer, subject, audience, maxTokenAge } = options, presenceCheck = [...requiredClaims];
  maxTokenAge !== void 0 && presenceCheck.push("iat"), audience !== void 0 && presenceCheck.push("aud"), subject !== void 0 && presenceCheck.push("sub"), issuer !== void 0 && presenceCheck.push("iss");
  for (const claim of new Set(presenceCheck.reverse()))
    if (!Object.hasOwn(payload, claim))
      throw new JWTClaimValidationFailed(`missing required "${claim}" claim`, payload, claim, "missing");
  issuer !== void 0 && !(Array.isArray(issuer) ? issuer : [issuer]).includes(payload.iss) && unexpectedClaim(payload, "iss"), subject !== void 0 && payload.sub !== subject && unexpectedClaim(payload, "sub"), audience !== void 0 && !checkAudiencePresence(payload.aud, typeof audience == "string" ? [audience] : audience) && unexpectedClaim(payload, "aud");
  const { clockTolerance } = options;
  let tolerance = 0;
  if (typeof clockTolerance == "string")
    tolerance = secs(clockTolerance);
  else if (clockTolerance !== void 0) {
    if (typeof clockTolerance != "number")
      throw new TypeError("Invalid clockTolerance option type");
    tolerance = clockTolerance;
  }
  validateInput("clockTolerance option", tolerance);
  const { currentDate } = options, now = validateInput("currentDate option", epoch(currentDate === void 0 ? /* @__PURE__ */ new Date() : currentDate)), iat = validateNumericDate(payload, "iat", maxTokenAge !== void 0), nbf = validateNumericDate(payload, "nbf");
  if (nbf !== void 0 && nbf > now + tolerance)
    throw new JWTClaimValidationFailed('"nbf" claim timestamp check failed', payload, "nbf", checkFailed);
  const exp = validateNumericDate(payload, "exp");
  if (exp !== void 0 && exp <= now - tolerance)
    throw new JWTExpired('"exp" claim timestamp check failed', payload, "exp", checkFailed);
  if (maxTokenAge !== void 0) {
    const age = now - iat, max = validateInput("maxTokenAge option", typeof maxTokenAge == "number" ? maxTokenAge : secs(maxTokenAge));
    if (age - tolerance > max)
      throw new JWTExpired('"iat" claim timestamp check failed (too far in the past)', payload, "iat", checkFailed);
    if (age < -tolerance)
      throw new JWTClaimValidationFailed('"iat" claim timestamp check failed (it should be in the past)', payload, "iat", checkFailed);
  }
  return payload;
}
__name(validateClaimsSet, "validateClaimsSet");

// ../node_modules/jose/dist/webapi/jwt/verify.js
async function jwtVerify(jwt, key, options) {
  const [verified, b642] = await verifyCompact(jwt, prepareVerify(options), key);
  if (!b642)
    throw new JWTInvalid("JWTs MUST NOT use unencoded payload");
  const payload = validateClaimsSet(verified.protectedHeader, verified.payload, options);
  return { ...verified, payload };
}
__name(jwtVerify, "jwtVerify");

// ../node_modules/jose/dist/webapi/jwks/local.js
function isUsableJWK(jwk, entry, alg, kid) {
  const { kty, key_ops: keyOps, ext, kid: jwkKid, alg: jwkAlg, use, crv } = jwk;
  return (ext === void 0 || typeof ext == "boolean") && (keyOps === void 0 || Array.isArray(keyOps) && keyOps.every((operation, index) => typeof operation == "string" && keyOps.indexOf(operation) === index) && keyOps.includes("verify")) && entry.kty.includes(kty) && (kid === void 0 || typeof kid == "string" && kid === jwkKid) && (jwkAlg === void 0 ? kty !== "AKP" : alg === jwkAlg) && (use === void 0 || use === "sig") && (!entry.crv || crv === entry.crv);
}
__name(isUsableJWK, "isUsableJWK");
async function importWithAlgCache(cache2, jwk, entry) {
  const cached = cache2.get(jwk) || cache2.set(jwk, {}).get(jwk), { alg } = entry;
  if (cached[alg] === void 0) {
    const pending = jwkToKey(entry, jwk, true).then((key) => {
      if (key.type !== "public")
        throw new JWKSInvalid("JSON Web Key Set members must be public keys");
      return cached[alg] = key, key;
    }).catch((error) => {
      throw cached[alg] === pending && delete cached[alg], error;
    });
    cached[alg] = pending;
  }
  return cached[alg];
}
__name(importWithAlgCache, "importWithAlgCache");
function createLocalJWKSet(jwks2) {
  let snapshot;
  try {
    snapshot = structuredClone(jwks2);
  } catch {
  }
  if (!isJwkSet(snapshot))
    throw new JWKSInvalid("JSON Web Key Set malformed");
  const metadata = snapshot.keys.map((jwk) => {
    const normalized = snapshotJwk(jwk);
    return Array.isArray(normalized.key_ops) && (normalized.key_ops = [...normalized.key_ops]), normalized;
  }), cached = /* @__PURE__ */ new WeakMap();
  return Object.defineProperty(async (protectedHeader, token) => {
    const { alg, kid } = { ...protectedHeader, ...token?.header }, entry = typeof alg == "string" ? JWS[alg] : void 0;
    if (!entry || entry.secret)
      throw new JOSENotSupported('Unsupported "alg" value for a JSON Web Key Set');
    const candidates = snapshot.keys.filter((_, index) => isUsableJWK(metadata[index], entry, alg, kid)), { 0: jwk, length } = candidates;
    if (!length)
      throw new JWKSNoMatchingKey();
    if (length !== 1) {
      const error = new JWKSMultipleMatchingKeys();
      throw error[Symbol.asyncIterator] = async function* () {
        for (const jwk2 of candidates)
          try {
            yield await importWithAlgCache(cached, jwk2, entry);
          } catch {
          }
      }, error;
    }
    return importWithAlgCache(cached, jwk, entry);
  }, "jwks", {
    value: /* @__PURE__ */ __name(() => structuredClone(snapshot), "value")
  });
}
__name(createLocalJWKSet, "createLocalJWKSet");

// ../node_modules/jose/dist/webapi/jwks/remote.js
function isCloudflareWorkers() {
  return typeof WebSocketPair < "u" || typeof navigator < "u" && true || typeof EdgeRuntime < "u" && EdgeRuntime === "vercel";
}
__name(isCloudflareWorkers, "isCloudflareWorkers");
var USER_AGENT;
(typeof navigator > "u" || !"Cloudflare-Workers"?.startsWith?.("Mozilla/5.0 ")) && (USER_AGENT = "jose/v6.2.12");
var customFetch = /* @__PURE__ */ Symbol();
async function fetchJwks(url, headers, signal, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    method: "GET",
    signal,
    redirect: "manual",
    headers
  }).catch((err) => {
    throw err.name === "TimeoutError" ? new JWKSTimeout() : err;
  });
  if (response.status !== 200)
    throw new JOSEError("Expected 200 OK from the JSON Web Key Set HTTP response");
  try {
    return await response.json();
  } catch {
    throw new JOSEError("Failed to parse the JSON Web Key Set HTTP response as JSON");
  }
}
__name(fetchJwks, "fetchJwks");
var jwksCache = /* @__PURE__ */ Symbol();
function isFreshFor(timestamp, duration) {
  return Number.isFinite(timestamp) && Date.now() < timestamp + duration;
}
__name(isFreshFor, "isFreshFor");
function validateDuration(value, fallback, option) {
  if (Number.isNaN(value))
    throw new TypeError(`"${option}" option must not be NaN`);
  return typeof value == "number" ? value : fallback;
}
__name(validateDuration, "validateDuration");
function createRemoteJWKSet(url, options) {
  if (!(url instanceof URL))
    throw new TypeError("url must be an instance of URL");
  const href = new URL(url.href).href, opts = options ?? {}, timeoutOption = opts.timeoutDuration;
  if (typeof timeoutOption == "number" && (!Number.isInteger(timeoutOption) || timeoutOption < 0))
    throw new TypeError('"timeoutDuration" option must be a non-negative integer');
  const timeoutDuration = typeof timeoutOption == "number" ? timeoutOption : 5e3, cooldownDuration = validateDuration(opts.cooldownDuration, 3e4, "cooldownDuration"), cacheMaxAge = validateDuration(opts.cacheMaxAge, 6e5, "cacheMaxAge"), headers = new Headers(opts.headers);
  USER_AGENT && !headers.has("User-Agent") && headers.set("User-Agent", USER_AGENT), headers.has("accept") || headers.set("accept", "application/json, application/jwk-set+json");
  const fetchImpl = opts[customFetch], cache2 = opts[jwksCache];
  let jwksTimestamp, pendingFetch, reloadSequence = 0, appliedSequence = 0, local;
  if (cache2 && typeof cache2 == "object") {
    const { uat, jwks: jwks2 } = cache2;
    isFreshFor(uat, cacheMaxAge) && isJwkSet(jwks2) && (jwksTimestamp = uat, local = createLocalJWKSet(jwks2));
  }
  const reload = /* @__PURE__ */ __name(async () => {
    if (pendingFetch && isCloudflareWorkers() && (pendingFetch = void 0), !pendingFetch) {
      const sequence = ++reloadSequence, current = pendingFetch = fetchJwks(href, headers, AbortSignal.timeout(timeoutDuration), fetchImpl).then((json4) => {
        const next = createLocalJWKSet(json4);
        if (sequence <= appliedSequence)
          return;
        local = next;
        const updatedAt = Date.now();
        cache2 && (cache2.uat = updatedAt, cache2.jwks = json4), jwksTimestamp = updatedAt, appliedSequence = sequence;
      }).finally(() => {
        pendingFetch === current && (pendingFetch = void 0);
      });
    }
    await pendingFetch;
  }, "reload");
  return Object.defineProperties(async (protectedHeader, token) => {
    (!local || !isFreshFor(jwksTimestamp, cacheMaxAge)) && await reload();
    try {
      return await local(protectedHeader, token);
    } catch (err) {
      if (err instanceof JWKSNoMatchingKey && !isFreshFor(jwksTimestamp, cooldownDuration))
        return await reload(), local(protectedHeader, token);
      throw err;
    }
  }, {
    coolingDown: {
      get: /* @__PURE__ */ __name(() => isFreshFor(jwksTimestamp, cooldownDuration), "get"),
      enumerable: true
    },
    fresh: {
      get: /* @__PURE__ */ __name(() => isFreshFor(jwksTimestamp, cacheMaxAge), "get"),
      enumerable: true
    },
    reload: {
      value: reload,
      enumerable: true
    },
    reloading: {
      get: /* @__PURE__ */ __name(() => !!pendingFetch, "get"),
      enumerable: true
    },
    jwks: {
      value: /* @__PURE__ */ __name(() => local?.jwks(), "value"),
      enumerable: true
    }
  });
}
__name(createRemoteJWKSet, "createRemoteJWKSet");

// ../src/project.ts
import { DurableObject as DurableObject4 } from "cloudflare:workers";

// ../src/build.ts
import { DurableObject as DurableObject3 } from "cloudflare:workers";
async function excludeFromRunRoute(env, host) {
  if (!env.APPS_ZONE_ID) return;
  for (const pattern of [`${host}/*`, `*.${host}/*`]) {
    const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${env.APPS_ZONE_ID}/workers/routes`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.CF_DEPLOY_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ pattern })
    }).catch((e) => ({ ok: false, status: 0, json: /* @__PURE__ */ __name(async () => ({ errors: [{ message: String(e) }] }), "json") }));
    const j = await r.json().catch(() => ({}));
    const dup = (j.errors || []).some((e) => e.code === 10020 || /duplicate|already exists/i.test(e.message || ""));
    log("build", r.ok || dup ? "route_excluded" : "route_exclude_failed", { pattern, status: r.status, errors: r.ok || dup ? void 0 : j.errors });
  }
}
__name(excludeFromRunRoute, "excludeFromRunRoute");
var WRANGLER = "wrangler@4.146.0";
var INSTANCE2 = { vcpu: 1, memoryMib: 3072, diskMb: 8e3 };
var IDLE_STOP_MS = 5 * 6e4;
var ENTRYPOINT2 = ["/bin/bash", "-c", "chown 0:0 / 2>/dev/null; mkdir -p /build && exec sleep infinity"];
var SANITIZE = String.raw`
const fs = require('fs'), path = require('path');
const T = '/opt/forq-tools/node_modules/';
const toml = require(T + 'smol-toml'), jsonc = require(T + 'jsonc-parser');
const dir = process.argv[2], worker = process.argv[3], host = process.argv[4] || '';
const names = ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml'];
const found = names.find((n) => fs.existsSync(path.join(dir, n)));
if (!found) { console.error('FORQ_ERROR no wrangler.jsonc, wrangler.json or wrangler.toml at the repo root'); process.exit(3); }
const raw = fs.readFileSync(path.join(dir, found), 'utf8');
const c = found.endsWith('.toml') ? toml.parse(raw) : jsonc.parse(raw);
// Bindings that point at resources in someone else's account cannot be deployed here (yet).
const UNSUPPORTED = ['kv_namespaces', 'd1_databases', 'r2_buckets', 'queues', 'services', 'hyperdrive', 'vectorize',
  'analytics_engine_datasets', 'dispatch_namespaces', 'mtls_certificates', 'secrets_store_secrets', 'workflows', 'containers', 'send_email', 'pipelines'];
const bad = UNSUPPORTED.filter((k) => c[k] && (Array.isArray(c[k]) ? c[k].length : Object.keys(c[k]).length));
if (bad.length) { console.error('FORQ_ERROR needs ' + bad.join(', ') + ', which qodebase cannot create yet'); process.exit(4); }
const out = { ...c, name: worker, workers_dev: true, preview_urls: true };
for (const k of ['route', 'routes', 'env', 'account_id', 'tail_consumers', 'logpush', 'triggers']) delete out[k];
// Logs + Issues (Cloudflare's error grouping; forq's automation turns issues into agent work).
out.observability = { ...(c.observability || {}), enabled: true, issues: { enabled: true } };
// The app's own hostname on the apps domain; previews_enabled gives every preview
// <alias>.<host> (Cloudflare adds the wildcard record and certificate).
if (host) out.routes = [{ pattern: host, custom_domain: true, previews_enabled: true }];
// Previews: per-preview Durable Object namespaces (keep the bindings the code reads from env).
out.previews = { ...(c.previews || {}) };
if (c.durable_objects && c.durable_objects.bindings) out.previews.durable_objects = { bindings: c.durable_objects.bindings };
if (c.ai) out.previews.ai = c.ai;
fs.writeFileSync(path.join(dir, 'forq.wrangler.json'), JSON.stringify(out, null, 2));
console.log('FORQ_CONFIG from ' + found + ' -> forq.wrangler.json (' + worker + ')');
`;
var BuildBox = class extends DurableObject3 {
  static {
    __name(this, "BuildBox");
  }
  get c() {
    return this.ctx.container;
  }
  async #sh(cmd, env = {}) {
    const p = await this.c.exec(["bash", "-c", cmd], { env });
    const o = await p.output();
    const dec = new TextDecoder();
    return { exitCode: o.exitCode, stdout: dec.decode(o.stdout), stderr: dec.decode(o.stderr) };
  }
  /** Queue a job and make sure the alarm will run it. */
  async enqueue(job) {
    const q = await this.ctx.storage.get("queue") || [];
    const key = /* @__PURE__ */ __name((j) => `${j.kind}:${j.agentId || j.install?.installId || ""}`, "key");
    const next = q.filter((j) => key(j) !== key(job)).concat(job);
    await this.ctx.storage.put("queue", next);
    await this.ctx.storage.setAlarm(Date.now() + 100);
    log("build", "queued", { slug: job.slug, kind: job.kind, agentId: job.agentId, depth: next.length });
  }
  async alarm() {
    const q = await this.ctx.storage.get("queue") || [];
    const stale = await this.ctx.storage.get("running");
    if (stale) {
      await this.ctx.storage.delete("running");
      if ((stale.tries || 0) < 2) {
        q.unshift({ ...stale, tries: (stale.tries || 0) + 1 });
        log("build", "resumed", { slug: stale.slug, kind: stale.kind, tries: (stale.tries || 0) + 1 });
      } else await this.#report(stale, { id: stale.id, kind: stale.kind, agentId: stale.agentId, ok: false, log: "interrupted three times", ms: 0, error: "The build was interrupted three times. Try again." });
    }
    const job = q.shift();
    if (!job) {
      const last = await this.ctx.storage.get("lastBuild") || 0;
      if (this.c.running && Date.now() - last > IDLE_STOP_MS) {
        await this.c.destroy().catch(() => {
        });
        log("build", "idle_stop", {});
      } else if (this.c.running) await this.ctx.storage.setAlarm(Date.now() + 6e4);
      return;
    }
    await this.ctx.storage.put({ queue: q, running: job });
    const result = await this.#run(job);
    await this.ctx.storage.delete("running");
    await this.ctx.storage.put("lastBuild", Date.now());
    if (!result.ok && /Network connection lost|temporarily unavailable/i.test(result.error || "") && (job.tries || 0) < 2) {
      q.unshift({ ...job, tries: (job.tries || 0) + 1 });
      await this.ctx.storage.put("queue", q);
      log("build", "retry", { slug: job.slug, kind: job.kind, tries: (job.tries || 0) + 1, error: result.error });
      await this.ctx.storage.setAlarm(Date.now() + 5e3);
      return;
    }
    await this.#report(job, result);
    await this.ctx.storage.setAlarm(Date.now() + (q.length ? 100 : 6e4));
  }
  /** Keep the result (Installs asks for it if the call below is lost) and hand it on. */
  async #report(job, result) {
    await this.ctx.storage.put(`result:${job.id}`, { ...result, at: Date.now() });
    const kept = await this.ctx.storage.list({ prefix: "result:" });
    if (kept.size > 30) await this.ctx.storage.delete([...kept].sort((x, y) => x[1].at - y[1].at).slice(0, kept.size - 30).map(([k2]) => k2));
    if (job.install) {
      try {
        await this.env.Installs.get(this.env.Installs.idFromName(job.install.owner.toLowerCase())).buildDone(result);
        log("build", "reported", { install: job.install.installId, ok: result.ok });
      } catch (e) {
        log("build", "report_failed", { install: job.install.installId, err: String(e) });
      }
    } else {
      if (!result.ok && !result.agentId) await pushAlert(this.env, `forq: deploy failed, ${job.slug}`, (result.error || "no error text").slice(0, 500), `https://${this.env.UI_HOST}/p/${job.slug.replace(".", "/")}`, 0);
      try {
        await this.env.Project.get(this.env.Project.idFromName(job.slug)).buildDone(result);
      } catch (e) {
        log("build", "report_failed", { slug: job.slug, err: String(e) });
      }
    }
  }
  /** A finished job's result, if this builder still has it. */
  async result(id) {
    return await this.ctx.storage.get(`result:${id}`) || null;
  }
  /** A container that answers. One that claims to run but does not (a Worker
   *  deploy killed it mid-build, seen 2026-10-01: "container connection is
   *  temporarily unavailable") is destroyed and started fresh, once. */
  async #ensureContainer(add) {
    if (this.c.running) {
      try {
        await this.#sh("true");
        return;
      } catch (e) {
        add(`container not answering (${String(e).slice(0, 120)}), restarting it`);
        try {
          await this.c.destroy();
        } catch {
        }
      }
    }
    this.c.start({ instance: INSTANCE2, enableInternet: true, entrypoint: ENTRYPOINT2, image: this.c.images.computer });
    await this.#sh("true");
    add("container started");
  }
  async #run(job) {
    const t0 = Date.now();
    const lines = [];
    const add = /* @__PURE__ */ __name((s) => {
      for (const l of s.split("\n")) if (l.trim()) lines.push(l.replace(/\x1b\[[0-9;]*m/g, ""));
    }, "add");
    const done = /* @__PURE__ */ __name((ok, extra = {}) => {
      const r = { id: job.id, kind: job.kind, agentId: job.agentId, ok, log: lines.slice(-150).join("\n"), ms: Date.now() - t0, ...extra };
      log("build", "done", { slug: job.slug, kind: job.kind, agentId: job.agentId, ok, ms: r.ms, url: r.url, error: r.error });
      return r;
    }, "done");
    if (!job.install && (!this.env.CF_DEPLOY_TOKEN || this.env.BOX_IMAGE === "managed")) {
      add("This instance cannot deploy Worker projects yet (no deploy token).");
      return done(false, { error: "Worker projects cannot be deployed on this instance yet" });
    }
    try {
      await this.#ensureContainer(add);
      const tools = await this.#sh(`[ -d /opt/forq-tools/node_modules/smol-toml ] || (mkdir -p /opt/forq-tools && cd /opt/forq-tools && npm init -y >/dev/null && npm i --no-audit --no-fund smol-toml@1 jsonc-parser@3 2>&1 | tail -2); printf '%s' "$SANITIZE" > /opt/forq-tools/sanitize.js`, { SANITIZE });
      if (tools.exitCode !== 0) {
        add(tools.stdout + tools.stderr);
        return done(false, { error: "could not install build tools" });
      }
      const dir = `/build/${job.id}`;
      const clone = await this.#sh(
        `set -e; rm -rf "$D"; git -c http.extraHeader="Authorization: Bearer $TOK" clone -q --depth 1 "$REMOTE" "$D"; git -C "$D" log -1 --format='commit %H %s'`,
        { D: dir, TOK: job.token, REMOTE: job.remote }
      );
      add(clone.stdout + clone.stderr);
      if (clone.exitCode !== 0) return done(false, { error: "clone failed" });
      const commit = (clone.stdout.match(/commit ([0-9a-f]{40})/) || [])[1];
      if (job.install) {
        const [ok, extra] = await this.#install(job, dir, add);
        return done(ok, { commit, ...extra });
      }
      const cfg = await this.#sh(`node /opt/forq-tools/sanitize.js "$D" "$W" "$H"`, { D: dir, W: job.worker, H: job.host || "" });
      add(cfg.stdout + cfg.stderr);
      if (cfg.exitCode !== 0) return done(false, { commit, error: (cfg.stderr.match(/FORQ_ERROR (.*)/) || [])[1] || "config could not be read" });
      const install = await this.#sh(`cd "$D"; if [ -f package.json ] && node -e "const p=require('./package.json');process.exit(Object.keys({...p.dependencies,...p.devDependencies}).length?0:1)"; then
          (npm ci --no-audit --no-fund 2>&1 || npm install --no-audit --no-fund 2>&1) | tail -5; else echo "no dependencies to install"; fi`, { D: dir });
      add(install.stdout + install.stderr);
      if (install.exitCode !== 0) return done(false, { commit, error: "npm install failed" });
      const cmd = job.kind === "deploy" ? `npx -y ${WRANGLER} deploy --config forq.wrangler.json` : `npx -y ${WRANGLER} preview --config forq.wrangler.json --name "$ALIAS"`;
      const run = await this.#sh(`cd "$D"; ${cmd} 2>&1`, {
        D: dir,
        ALIAS: job.alias || "",
        CLOUDFLARE_API_TOKEN: this.env.CF_DEPLOY_TOKEN,
        CLOUDFLARE_ACCOUNT_ID: this.env.ACCOUNT_ID,
        WRANGLER_SEND_METRICS: "false",
        CI: "true",
        NO_COLOR: "1"
      });
      add(run.stdout + run.stderr);
      await this.#sh(`rm -rf "$D"`, { D: dir });
      if (run.exitCode !== 0) return done(false, { commit, error: job.kind === "deploy" ? "wrangler deploy failed" : "wrangler preview failed" });
      const url = job.host ? job.kind === "deploy" ? `https://${job.host}` : `https://${job.alias}.${job.host}` : job.kind === "deploy" ? (run.stdout.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/) || [])[0] : (run.stdout.match(/Preview URL:\s*(https:\/\/\S+)/) || [])[1];
      return done(true, { commit, url });
    } catch (e) {
      add(String(e?.stack || e));
      return done(false, { error: String(e?.message || e) });
    }
  }
  /** Deploy <dir>/wrangler.base.json (a prebuilt, no_bundle release) as the
   *  user's Worker, with their access token. Never logs the token. */
  async #install(job, dir, add) {
    const ins = job.install;
    const cfgJs = `const fs=require('fs');const p=process.env.R+'/wrangler.base.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));
c.name=process.env.W;c.workers_dev=true;c.vars=Object.assign(c.vars||{},JSON.parse(process.env.V));
const b=JSON.parse(process.env.B||'null');if(b){c.r2_buckets=(c.r2_buckets||[]).filter(x=>x.binding!==b.binding).concat({binding:b.binding,bucket_name:b.name});}
fs.writeFileSync(process.env.R+'/wrangler.json',JSON.stringify(c));console.log('FORQ_INSTALL config for '+c.name);`;
    const root = `${dir}/${ins.dir}`;
    const cfg = await this.#sh(`node -e "$JS"`, { JS: cfgJs, R: root, W: job.worker, V: JSON.stringify(ins.vars), B: JSON.stringify(ins.bucket || null) });
    add(cfg.stdout + cfg.stderr);
    if (cfg.exitCode !== 0) return [false, { error: "could not prepare the release" }];
    const wenv = { CLOUDFLARE_API_TOKEN: ins.cfToken, CLOUDFLARE_ACCOUNT_ID: ins.accountId, WRANGLER_SEND_METRICS: "false", CI: "true", NO_COLOR: "1" };
    const run = await this.#sh(`cd "$R"; npx -y ${WRANGLER} deploy --config wrangler.json 2>&1`, { R: root, ...wenv });
    add(run.stdout.replaceAll(ins.cfToken, "***"));
    const fail = /* @__PURE__ */ __name((out) => {
      const why = (out.match(/✘ \[ERROR\] (.+)/) || out.match(/ERROR\]? (.+)/) || [])[1];
      return [false, { error: why ? why.slice(0, 300) : "wrangler deploy failed" }];
    }, "fail");
    if (run.exitCode !== 0) {
      await this.#sh(`rm -rf "$D"`, { D: dir });
      return fail(run.stdout);
    }
    const url = (run.stdout.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/) || [])[0];
    if (ins.runWorker) {
      const runCfg = `const fs=require('fs');const p=process.env.R+'/run/wrangler.base.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));
c.name=process.env.W+'-run';c.workers_dev=true;c.services=[{binding:'MAIN',service:process.env.W}];
fs.writeFileSync(process.env.R+'/run/wrangler.json',JSON.stringify(c));console.log('FORQ_INSTALL config for '+c.name);`;
      const rc = await this.#sh(`node -e "$JS"`, { JS: runCfg, R: root, W: job.worker });
      add(rc.stdout + rc.stderr);
      const r2 = await this.#sh(`cd "$R/run"; npx -y ${WRANGLER} deploy --config wrangler.json 2>&1`, { R: root, ...wenv });
      add(r2.stdout.replaceAll(ins.cfToken, "***"));
      if (rc.exitCode !== 0 || r2.exitCode !== 0) {
        await this.#sh(`rm -rf "$D"`, { D: dir });
        return fail(r2.stdout);
      }
    }
    await this.#sh(`rm -rf "$D"`, { D: dir });
    return [true, { url }];
  }
  async state() {
    return { running: !!this.ctx.container?.running, queue: (await this.ctx.storage.get("queue") || []).map((j) => ({ kind: j.kind, agentId: j.agentId })), alarm: await this.ctx.storage.getAlarm() };
  }
};

// ../src/project.ts
var roleOf = /* @__PURE__ */ __name((id) => id.endsWith("--router") ? "router" : id.endsWith("--review") ? "reviewer" : "agent", "roleOf");
var Project = class extends DurableObject4 {
  static {
    __name(this, "Project");
  }
  async info() {
    return await this.ctx.storage.get("info") || null;
  }
  async #register(info) {
    await this.ctx.storage.put("info", info);
    const e = {
      slug: info.slug,
      owner: info.owner,
      name: info.name,
      description: info.description,
      forkedFrom: info.forkedFrom,
      createdAt: info.createdAt,
      updatedAt: Date.now(),
      importedFrom: info.importedFrom ? { fullName: info.importedFrom.fullName, stars: info.importedFrom.stars, license: info.importedFrom.license } : void 0,
      ...info.private ? { private: true } : {}
    };
    await registry(this.env).put(e);
  }
  /** A new, empty project (the first push fills main). Returns a write token for that push. */
  async create(owner, name, description) {
    if (!NAME_RE.test(owner) || !NAME_RE.test(name)) throw new Error("names: lowercase letters, digits, dashes");
    if (await this.info()) throw new Error("project exists");
    const slug = slugOf(owner, name);
    const created = await this.env.ARTIFACTS.create(slug, { description, setDefaultBranch: "main" });
    const info = {
      slug,
      owner,
      name,
      description,
      repo: created.name,
      remote: created.remote,
      forkedFrom: null,
      createdAt: Date.now(),
      agents: []
    };
    await this.#register(info);
    log("project", "created", { slug });
    return { info, token: created.token };
  }
  /** This project as a fork of `source` (a user-level fork: own page, own agents). */
  /** `fresh`: a new project started from a starter (Build), not shown as a fork of it. */
  async createFork(owner, name, source, description = source.description, fresh = false) {
    var _stack = [];
    try {
      if (await this.info()) throw new Error("project exists");
      const slug = slugOf(owner, name);
      const repo = __using(_stack, await this.env.ARTIFACTS.get(source.repo));
      const forked = await repo.fork(slug, { description, defaultBranchOnly: true });
      const info = {
        slug,
        owner,
        name,
        description,
        repo: forked.name,
        remote: forked.remote,
        forkedFrom: fresh ? null : source.slug,
        createdAt: Date.now(),
        agents: [],
        importedFrom: fresh ? void 0 : source.importedFrom,
        entry: source.entry,
        ...source.private && !fresh ? { private: true } : {}
      };
      await this.#register(info);
      log("project", fresh ? "started" : "forked", { slug, from: source.slug });
      return info;
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  }
  /** A project imported from a public GitHub repo (shallow). Artifacts imports
   *  in the background; the page shows "Importing" until main can be read. */
  async createImported(owner, name, src, description) {
    if (!NAME_RE.test(owner) || !NAME_RE.test(name)) throw new Error("names: lowercase letters, digits, dashes");
    if (await this.info()) throw new Error("project exists");
    const slug = slugOf(owner, name);
    const imported = await this.env.ARTIFACTS.import({
      source: { url: src.url, branch: src.branch, depth: 1 },
      target: { name: slug, opts: { description: description.slice(0, 300) } }
    });
    const info = {
      slug,
      owner,
      name,
      description,
      repo: imported.name,
      remote: imported.remote,
      forkedFrom: null,
      createdAt: Date.now(),
      agents: [],
      importedFrom: src
    };
    await this.#register(info);
    log("project", "imported", { slug, from: src.fullName, branch: src.branch });
    return info;
  }
  /** Public or private (owner-only). */
  async setPrivate(v) {
    const info = await this.#need();
    if (!!info.private === v) return info;
    if (v) info.private = true;
    else delete info.private;
    await this.#register(info);
    log("project", "visibility", { slug: info.slug, private: v });
    return info;
  }
  /** Owner override of the previewed page: a folder ('demo/') or a file ('demo.html'). */
  async setEntry(entry) {
    const info = await this.#need();
    if (entry !== null && !/^([\w.-]+\/)*([\w.-]+\.html?)?$/.test(entry)) throw new Error("entry: a folder like demo/ or a file like demo.html");
    info.entry = entry;
    await this.ctx.storage.put("info", info);
  }
  async mainToken(ttlS = 3600) {
    var _stack = [];
    try {
      const info = await this.#need();
      const repo = __using(_stack, await this.env.ARTIFACTS.get(info.repo));
      const t = await repo.createToken("write", ttlS);
      return { remote: info.remote, token: t.plaintext };
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  }
  /** A git token for main (qb clone): write for the owner, read for others; 1 hour. */
  async gitToken(mode) {
    var _stack = [];
    try {
      const info = await this.#need();
      const repo = __using(_stack, await this.env.ARTIFACTS.get(info.repo));
      const t = await repo.createToken(mode, 3600);
      return { remote: info.remote, token: t.plaintext, branch: info.importedFrom?.branch || null };
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  }
  async addAgent(task) {
    var _stack = [];
    try {
      const info = await this.#need();
      const max = Number(this.env.MAX_AGENTS_PER_PROJECT || 6);
      const live = info.agents.filter((a) => a.state === "working" || a.state === "pushed" || a.state === "blocked");
      if (live.length >= max) throw new Error(`agent limit reached (${max} open per project)`);
      const id = `${info.slug}--${Math.random().toString(36).slice(2, 7)}`;
      const repo = __using(_stack, await this.env.ARTIFACTS.get(info.repo));
      const baseC = (await repo.log({ limit: 1 }).catch(() => []))[0];
      const forked = await repo.fork(id, { description: task.slice(0, 200), defaultBranchOnly: true });
      const agent = {
        id,
        task,
        fork: forked.name,
        remote: forked.remote,
        createdAt: Date.now(),
        state: "working",
        request: info.lastRequest && Date.now() - info.lastRequest.at < 30 * 6e4 ? info.lastRequest.text.slice(0, 1e3) : void 0,
        base: baseC ? { commit: baseC.hash, tree: baseC.treeHash } : void 0
      };
      info.agents.push(agent);
      await this.ctx.storage.put("info", info);
      log("project", "agent_added", { slug: info.slug, id });
      return agent;
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  }
  /** Remote + write token for what a box clones: its fork, or main for the router. */
  async boxRepo(agentId, ttlS = 7 * 86400) {
    var _stack2 = [];
    try {
      const info = await this.#need();
      const role = roleOf(agentId);
      if (role !== "agent") {
        var _stack = [];
        try {
          const repo2 = __using(_stack, await this.env.ARTIFACTS.get(info.repo));
          return { task: "", remote: info.remote, token: (await repo2.createToken(role === "router" ? "write" : "read", ttlS)).plaintext, role };
        } catch (_) {
          var _error = _, _hasError = true;
        } finally {
          __callDispose(_stack, _error, _hasError);
        }
      }
      const agent = info.agents.find((a) => a.id === agentId);
      if (!agent) throw new Error("unknown agent");
      const repo = __using(_stack2, await this.env.ARTIFACTS.get(agent.fork));
      return { task: agent.task, remote: agent.remote, token: (await repo.createToken("write", ttlS)).plaintext, role };
    } catch (_2) {
      var _error2 = _2, _hasError2 = true;
    } finally {
      __callDispose(_stack2, _error2, _hasError2);
    }
  }
  // ---- builds (Worker projects): BuildBox `<slug>--build` --------------------
  /** Queue a deploy of main, or a Preview of an agent's fork. */
  async requestBuild(kind, agentId) {
    var _stack = [];
    try {
      const info = await this.#need();
      if (this.env.OWNER_HANDLE !== info.owner && info.owner !== "forq") throw new Error("Worker deploys are reserved for the owner of this forq instance");
      const agent = agentId ? info.agents.find((a) => a.id === agentId) : void 0;
      if (kind === "preview" && !agent) throw new Error("unknown agent");
      const repoName = agent ? agent.fork : info.repo;
      const repo = __using(_stack, await this.env.ARTIFACTS.get(repoName));
      const token = (await repo.createToken("read", 3600)).plaintext;
      const job = {
        id: crypto.randomUUID().slice(0, 8),
        slug: info.slug,
        kind,
        repo: repoName,
        remote: agent ? agent.remote : info.remote,
        token,
        worker: appWorkerName(info.slug),
        alias: agent ? previewAlias(agent.id) : void 0,
        host: appHost(info.slug, this.env.APPS_DOMAIN),
        agentId,
        queuedAt: Date.now()
      };
      const building = { status: "building", at: Date.now() };
      if (agent) agent.preview = { ...agent.preview, ...building, error: void 0 };
      else info.app = { ...info.app || {}, ...building, error: void 0, worker: job.worker };
      await this.ctx.storage.put("info", info);
      await this.env.BuildBox.get(this.env.BuildBox.idFromName(`${info.slug}--build`)).enqueue(job);
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  }
  /** BuildBox reports back. A ready preview of a pushed agent starts its review. */
  async buildDone(r) {
    const info = await this.#need();
    const d = { status: r.ok ? "live" : "failed", url: r.url, commit: r.commit, at: Date.now(), error: r.error, log: r.log };
    if (r.agentId) {
      const a = info.agents.find((x) => x.id === r.agentId);
      if (!a) return;
      a.preview = { ...d, url: r.url || a.preview?.url };
      await this.ctx.storage.put("info", info);
      if (a.state === "pushed") await this.#kick("review", a.id);
    } else {
      info.app = { ...d, url: r.url || info.app?.url, worker: info.app?.worker || appWorkerName(info.slug) };
      await this.ctx.storage.put("info", info);
      if (r.ok) await registry(this.env).touch(info.slug);
      const host = appHost(info.slug, this.env.APPS_DOMAIN);
      if (r.ok && host) await excludeFromRunRoute(this.env, host);
    }
    log("project", "build_done", { slug: info.slug, agentId: r.agentId, ok: r.ok, url: r.url, ms: r.ms, error: r.error });
  }
  /** Ask the Worker to do something only it can (wake the reviewer box). */
  async #kick(what, agentId) {
    const info = await this.#need();
    const [owner, name] = info.slug.split(".");
    const r = await fetch(`${this.env.API_BASE}/api/p/${owner}/${name}/review`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forq-secret": this.env.ADMIN_SECRET, "user-agent": "forq-internal/1" },
      body: JSON.stringify({ agent: agentId })
    }).catch((e) => ({ ok: false, status: 0, text: /* @__PURE__ */ __name(async () => String(e), "text") }));
    log("project", "kick", { what, agentId, ok: r.ok, status: r.status });
  }
  async kindOf() {
    return (await this.#need()).kind;
  }
  // ---- reviews: one reviewer per project, one review at a time -----------
  /** Queue a review of an agent's latest push. Returns the agent to review
   *  now if the reviewer is free, else null (it is picked up on the next verdict). */
  async queueReview(agentId, commit) {
    const info = await this.#need();
    const a = info.agents.find((x) => x.id === agentId);
    if (!a) throw new Error("unknown agent");
    a.review = { state: "queued", at: Date.now(), commit };
    await this.ctx.storage.put("info", info);
    const busy = info.agents.some((x) => x.review?.state === "reviewing");
    return busy ? null : this.#startNext(info);
  }
  async #startNext(info) {
    const next = info.agents.filter((x) => x.review?.state === "queued").sort((x, y) => x.review.at - y.review.at)[0];
    if (!next) return null;
    next.review = { ...next.review, state: "reviewing", at: Date.now() };
    await this.ctx.storage.put("info", info);
    return next.id;
  }
  /** The reviewer's verdict. Returns the next agent to review, if any. */
  async setVerdict(agentId, verdict, notes) {
    const info = await this.#need();
    const a = info.agents.find((x) => x.id === agentId);
    if (!a) throw new Error("unknown agent");
    a.review = { state: verdict, notes: notes.slice(0, 2e3), at: Date.now(), commit: a.review?.commit };
    await this.ctx.storage.put("info", info);
    log("project", "review_verdict", { slug: info.slug, agentId, verdict });
    return this.#startNext(info);
  }
  /** A review stuck in 'reviewing' (box died) goes back to the queue. */
  async requeueStale(maxMs = 20 * 6e4) {
    const info = await this.#need();
    let changed = false;
    for (const a of info.agents) if (a.review?.state === "reviewing" && Date.now() - a.review.at > maxMs) {
      a.review.state = "queued";
      changed = true;
    }
    if (changed) await this.ctx.storage.put("info", info);
    return info.agents.some((x) => x.review?.state === "reviewing") ? null : this.#startNext(info);
  }
  async markReviewSent(agentId) {
    const info = await this.#need();
    const a = info.agents.find((x) => x.id === agentId);
    if (a?.review) {
      a.review.state = "sent";
      a.review.at = Date.now();
      await this.ctx.storage.put("info", info);
    }
  }
  /** What the reviewer needs: the fork (read token) and where the agent started. */
  async reviewInfo(agentId) {
    var _stack = [];
    try {
      const info = await this.#need();
      const a = info.agents.find((x) => x.id === agentId);
      if (!a) throw new Error("unknown agent");
      const repo = __using(_stack, await this.env.ARTIFACTS.get(a.fork));
      return {
        remote: a.remote,
        token: (await repo.createToken("read", 1800)).plaintext,
        base: a.base?.commit || null,
        task: a.task,
        request: a.request,
        entry: info.entry || "",
        previewUrl: info.kind === "worker" ? a.preview?.url : void 0
      };
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  }
  /** What the router needs to merge an agent: the fork's remote + a read token. */
  async forkForMerge(agentId) {
    var _stack = [];
    try {
      const info = await this.#need();
      const agent = info.agents.find((a) => a.id === agentId);
      if (!agent) throw new Error("unknown agent");
      const repo = __using(_stack, await this.env.ARTIFACTS.get(agent.fork));
      return { remote: agent.remote, token: (await repo.createToken("read", 600)).plaintext };
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  }
  async setRequest(patch) {
    const info = await this.#need();
    info.lastRequest = { ...info.lastRequest || { text: "", at: Date.now(), state: "waking" }, ...patch };
    await this.ctx.storage.put("info", info);
  }
  /** Deliver the last request to the router agent from an alarm, retrying.
   *  Waking a box plus typing can outlast a request's waitUntil (~30 s): a
   *  request sat at "waking" for 38 min with nothing delivered (2026-10-01).
   *  The alarm calls the Worker's deliver verb and waits for it. */
  async scheduleDelivery() {
    await this.ctx.storage.put("deliverPending", true);
    await this.ctx.storage.setAlarm(Date.now() + 50);
  }
  /** Review watchdog. Every review is handed to the reviewer from this alarm,
   *  which then keeps watching until a verdict lands: if the reviewer is idle
   *  or asleep for 3 minutes with no verdict, the review is handed over again
   *  (5 times at most), then recorded as unfinished. Replaces direct dispatch,
   *  which lost reviews three ways on 2026-10-01 (typed into a busy reviewer,
   *  typed during /clear, gave up while the reviewer was busy). */
  async scheduleReviewDispatch(agentId) {
    await this.ctx.storage.put("reviewDispatch", { agentId, tries: 0, sends: 0, sentAt: 0 });
    await this.ctx.storage.setAlarm(Date.now() + 1e3);
  }
  async #reviewAlarm() {
    const job = await this.ctx.storage.get("reviewDispatch");
    if (!job) return false;
    const info = await this.#need();
    const a = info.agents.find((x) => x.id === job.agentId);
    if (!a || a.review?.state !== "reviewing") {
      await this.ctx.storage.delete("reviewDispatch");
      return false;
    }
    const [owner, name] = info.slug.split(".");
    const call = /* @__PURE__ */ __name(async (verb, body) => {
      const r2 = await fetch(`${this.env.API_BASE}/api/p/${owner}/${name}/${verb}`, {
        method: "POST",
        headers: { "x-forq-secret": this.env.ADMIN_SECRET, "user-agent": "forq-internal/1", "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5 * 6e4)
      }).catch((e) => ({ ok: false, status: 0, json: /* @__PURE__ */ __name(async () => ({ error: String(e) }), "json") }));
      return { ok: r2.ok, status: r2.status, ...await r2.json().catch(() => ({})) };
    }, "call");
    const current = /* @__PURE__ */ __name(async () => {
      const j = await this.ctx.storage.get("reviewDispatch");
      if (!j || j.agentId !== job.agentId || j.sends !== job.sends || j.sentAt !== job.sentAt) return false;
      const now = (await this.#need()).agents.find((x) => x.id === job.agentId);
      return now?.review?.state === "reviewing";
    }, "current");
    const superseded = /* @__PURE__ */ __name(async () => {
      log("project", "review_job_superseded", { slug: info.slug, agentId: job.agentId, next: (await this.ctx.storage.get("reviewDispatch"))?.agentId ?? null });
      return !!await this.ctx.storage.get("reviewDispatch");
    }, "superseded");
    if (job.sentAt) {
      const st = await call("reviewer-state", {});
      if (!await current()) return superseded();
      if (!st.idle || Date.now() - job.sentAt < 3 * 6e4) return true;
      if (job.sends >= 5) {
        await this.ctx.storage.delete("reviewDispatch");
        log("project", "review_unfinished", { slug: info.slug, agentId: job.agentId, sends: job.sends });
        const next = await this.setVerdict(job.agentId, "changes", "The reviewer agent did not finish this review. Look at the changes yourself, or push again to retry.");
        if (next) await this.scheduleReviewDispatch(next);
        return false;
      }
      log("project", "review_resend", { slug: info.slug, agentId: job.agentId, sends: job.sends });
    }
    if (!await current()) return superseded();
    const r = await call("review-dispatch", { agent: job.agentId });
    log("project", "review_dispatch_attempt", { slug: info.slug, agentId: job.agentId, ok: r.ok, busy: r.busy, sends: job.sends, err: r.error });
    if (!await current()) return superseded();
    if (r.ok) await this.ctx.storage.put("reviewDispatch", { ...job, sends: job.sends + 1, sentAt: Date.now() });
    else await this.ctx.storage.put("reviewDispatch", { ...job, tries: job.tries + 1 });
    return true;
  }
  async alarm() {
    const again = await this.#reviewAlarm();
    if (again) await this.ctx.storage.setAlarm(Date.now() + ((await this.ctx.storage.get("reviewDispatch"))?.sentAt === 0 ? 1e3 : 3e4));
    if (!await this.ctx.storage.get("deliverPending")) return;
    const info = await this.#need();
    const q = info.lastRequest;
    if (!q || q.state !== "waking") {
      await this.ctx.storage.delete("deliverPending");
      return;
    }
    const attempt = (q.attempts || 0) + 1;
    await this.setRequest({ attempts: attempt });
    const [owner, name] = info.slug.split(".");
    let ok = false, err = "";
    try {
      const r = await fetch(`${this.env.API_BASE}/api/p/${owner}/${name}/deliver`, {
        method: "POST",
        headers: { "x-forq-secret": this.env.ADMIN_SECRET, "user-agent": "forq-internal/1", "content-type": "application/json" },
        body: JSON.stringify({ at: q.at }),
        signal: AbortSignal.timeout(5 * 6e4)
      });
      const j = await r.json().catch(() => ({}));
      ok = r.ok && j.ok !== false;
      err = j.error || (r.ok ? "" : `HTTP ${r.status}`);
    } catch (e) {
      err = String(e?.message || e);
    }
    log("project", "deliver_attempt", { slug: info.slug, attempt, ok, err });
    if (!ok && /has not added an Anthropic API key|reserved for the owner/.test(err)) {
      await this.setRequest({ state: "failed", error: err });
      await this.ctx.storage.delete("deliverPending");
      return;
    }
    if (ok) {
      await this.ctx.storage.delete("deliverPending");
      if (again) await this.ctx.storage.setAlarm(Date.now() + 3e4);
      return;
    }
    if (attempt >= 3) {
      await this.setRequest({ state: "failed", error: `could not reach the router agent after ${attempt} tries: ${err}` });
      await this.ctx.storage.delete("deliverPending");
      return;
    }
    await this.ctx.storage.setAlarm(Date.now() + attempt * 3e4);
  }
  async setState(agentId, state, note) {
    const info = await this.#need();
    const a = info.agents.find((x) => x.id === agentId);
    if (!a) throw new Error("unknown agent");
    a.state = state;
    if (note !== void 0) {
      a.note = note.slice(0, 500);
      a.noteAt = Date.now();
    }
    await this.ctx.storage.put("info", info);
    if (state === "merged") await registry(this.env).touch(info.slug);
  }
  /** Main's newest commits + root files, for the project page. */
  async overview() {
    var _stack = [];
    try {
      const info = await this.#need();
      let repo;
      try {
        repo = await this.env.ARTIFACTS.get(info.repo);
      } catch (e) {
        log("project", "overview_not_ready", { slug: info.slug, err: String(e).slice(0, 160) });
        return { importing: true, entry: info.entry, commits: [], files: [], readme: null };
      }
      const _r = __using(_stack, repo);
      const commits = await repo.log({ limit: 5 }).catch(() => []);
      const tree2 = commits[0] ? await repo.readTree(commits[0].treeHash).catch(() => null) : null;
      const readmeName = (tree2 || []).find((e) => /^readme(\.md|\.markdown)?$/i.test(e.name))?.name || "README.md";
      const readme = commits[0] ? await repo.readFile({ ref: commits[0].hash, path: readmeName }).catch(() => null) : null;
      if (tree2 && info.kind === void 0) {
        info.kind = tree2.some((e) => e.type !== "tree" && /^wrangler\.(toml|json|jsonc)$/.test(e.name)) ? "worker" : "static";
        await this.ctx.storage.put("info", info);
        log("project", "kind_detected", { slug: info.slug, kind: info.kind });
      }
      if (tree2 && info.entry === void 0) {
        info.entry = await detectEntry(repo, commits[0].hash, tree2);
        await this.ctx.storage.put("info", info);
        log("project", "entry_detected", { slug: info.slug, entry: info.entry });
      }
      if (info.kind === "worker" && !info.app) {
        if (this.env.OWNER_HANDLE === info.owner || info.owner === "forq") {
          await this.requestBuild("deploy");
          Object.assign(info, await this.#need());
        } else {
          info.app = { status: "failed", at: Date.now(), worker: "", error: "Deploying Worker projects is reserved for the owner of this forq instance. Self-host forq to deploy your own (see SELF_HOST.md). Agents can still work on the code" };
          await this.ctx.storage.put("info", info);
        }
      }
      return {
        importing: false,
        entry: info.entry,
        kind: info.kind,
        app: info.app,
        commits: commits.map((c) => ({ hash: c.hash, message: c.message.split("\n")[0], at: c.committedAt * 1e3, author: c.author.name })),
        files: (tree2 || []).map((e) => ({ name: e.name, dir: e.type === "tree" })),
        readme: readme ? (await readme.text()).slice(0, 2e4) : null
      };
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  }
  /** Admin cleanup: forget this project's state (does not delete repos). */
  async wipe() {
    const info = await this.info();
    if (info?.slug) await registry(this.env).remove(info.slug);
    await this.ctx.storage.deleteAll();
  }
  // ---- content search ---------------------------------------------------
  // One FTS5 table (trigram: substring matches, like grep) holding the text
  // files of the few most recent versions searched, keyed by root tree hash.
  // Built on the first search of a version; the four newest versions are kept.
  #indexing = /* @__PURE__ */ new Map();
  #ensureSearchTables() {
    const sql = this.ctx.storage.sql;
    sql.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS code_fts USING fts5(ver UNINDEXED, path, body, tokenize='trigram')`);
    sql.exec(`CREATE TABLE IF NOT EXISTS code_idx (ver TEXT PRIMARY KEY, files INTEGER, bytes INTEGER, skipped INTEGER, at INTEGER)`);
  }
  async #buildIndex(repoName, rootTree) {
    var _stack = [];
    try {
      const t0 = Date.now();
      const MAX_FILES = 3e3, MAX_TOTAL = 20 * 1024 * 1024, MAX_FILE = 256 * 1024;
      const SKIP = /\.(png|jpe?g|gif|webp|ico|bmp|woff2?|ttf|otf|eot|mp3|ogg|wav|mp4|webm|mov|zip|gz|tgz|7z|pdf|wasm|lock|min\.js|min\.css|map)$/i;
      const repo = __using(_stack, await this.env.ARTIFACTS.get(repoName));
      const files = [];
      const walk = /* @__PURE__ */ __name(async (hash, prefix) => {
        const entries = await repo.readTree(hash) || [];
        const dirs = [];
        for (const e of entries) {
          if (files.length >= MAX_FILES) return;
          if (e.type === "tree") {
            if (!/^(node_modules|\.git|vendor)$/.test(e.name)) dirs.push(walk(e.hash, `${prefix}${e.name}/`));
          } else if (e.type === "blob" && !SKIP.test(e.name)) files.push({ path: prefix + e.name, hash: e.hash });
        }
        await Promise.all(dirs);
      }, "walk");
      await walk(rootTree, "");
      let bytes = 0, skipped = 0, n = 0;
      const sql = this.ctx.storage.sql;
      for (let i = 0; i < files.length; i += 12) {
        const batch = await Promise.all(files.slice(i, i + 12).map(async (f) => {
          const b = await repo.readBlob(f.hash).catch(() => null);
          if (!b || b.size > MAX_FILE) return null;
          const buf = new Uint8Array(await b.arrayBuffer());
          if (buf.subarray(0, 8192).includes(0)) return null;
          return { path: f.path, text: new TextDecoder().decode(buf) };
        }));
        for (const r of batch) {
          if (!r || bytes + r.text.length > MAX_TOTAL) {
            skipped++;
            continue;
          }
          sql.exec(`INSERT INTO code_fts (ver, path, body) VALUES (?, ?, ?)`, rootTree, r.path, r.text);
          bytes += r.text.length;
          n++;
        }
      }
      sql.exec(`INSERT OR REPLACE INTO code_idx (ver, files, bytes, skipped, at) VALUES (?, ?, ?, ?, ?)`, rootTree, n, bytes, skipped, Date.now());
      const old = sql.exec(`SELECT ver FROM code_idx ORDER BY at DESC LIMIT -1 OFFSET 4`).toArray();
      for (const o of old) {
        sql.exec(`DELETE FROM code_fts WHERE ver = ?`, o.ver);
        sql.exec(`DELETE FROM code_idx WHERE ver = ?`, o.ver);
      }
      log("project", "search_indexed", { repo: repoName, tree: rootTree.slice(0, 8), files: n, bytes, skipped, pruned: old.length, ms: Date.now() - t0 });
      return { files: n, bytes, skipped };
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  }
  /** Search the text files of one version (repo + root tree) for `q`. */
  async searchCode(repoName, rootTree, q) {
    this.#ensureSearchTables();
    const sql = this.ctx.storage.sql;
    const have = sql.exec(`SELECT files, skipped FROM code_idx WHERE ver = ?`, rootTree).toArray()[0];
    let indexedNow = false;
    if (!have) {
      let p = this.#indexing.get(rootTree);
      if (!p) {
        p = this.#buildIndex(repoName, rootTree).finally(() => this.#indexing.delete(rootTree));
        this.#indexing.set(rootTree, p);
      }
      await p;
      indexedNow = true;
    }
    const needle = q.trim();
    if (needle.length < 3) return { error: "type at least 3 characters", results: [] };
    const phrase = `"${needle.replace(/"/g, '""')}"`;
    const rows = sql.exec(`SELECT path, body FROM code_fts WHERE code_fts MATCH ? AND ver = ? LIMIT 60`, phrase, rootTree).toArray();
    const lower = needle.toLowerCase();
    const results = rows.map((r) => {
      const lines = [];
      const all = r.body.split("\n");
      for (let i = 0; i < all.length && lines.length < 6; i++) if (all[i].toLowerCase().includes(lower)) lines.push({ n: i + 1, text: all[i].slice(0, 300) });
      let count = 0;
      for (const l of all) if (l.toLowerCase().includes(lower)) count++;
      return { path: r.path, lines, count };
    }).filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
    const meta = sql.exec(`SELECT files, skipped FROM code_idx WHERE ver = ?`, rootTree).toArray()[0];
    return { results, indexedNow, files: meta?.files ?? 0, skipped: meta?.skipped ?? 0 };
  }
  async #need() {
    const info = await this.info();
    if (!info) throw new Error("no such project");
    return info;
  }
};
var ENTRY_DIRS = ["demo", "docs", "public", "dist", "www", "site", "example", "examples", "web", "app"];
async function detectEntry(repo, ref, tree2) {
  if (tree2.some((e) => e.type !== "tree" && e.name.toLowerCase() === "index.html")) return "";
  for (const d of ENTRY_DIRS) {
    const dir = tree2.find((e) => e.type === "tree" && e.name.toLowerCase() === d);
    if (!dir) continue;
    const f = await repo.readFile({ ref, path: `${dir.name}/index.html` }).catch(() => null);
    if (f) return `${dir.name}/`;
  }
  return null;
}
__name(detectEntry, "detectEntry");

// ../src/run.ts
var HEAD_TTL_S = 15;
var SERVE_V = 3;
var FILE_TTL_S = 86400;
var TYPES = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  woff2: "font/woff2",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  webmanifest: "application/manifest+json",
  wasm: "application/wasm"
};
var deny = /* @__PURE__ */ __name((status, msg, extra = {}) => new Response(msg, { status, headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex", ...extra } }), "deny");
async function serveRun(request, env, ctx) {
  const cf2 = request.cf || {};
  if (cf2.verifiedBotCategory || cf2.botManagement?.verifiedBot) return deny(403, "not for crawlers", { "retry-after": "86400" });
  if (request.method !== "GET" && request.method !== "HEAD") return deny(405, "GET only");
  const url = new URL(request.url);
  if (url.pathname === "/robots.txt") return deny(200, "User-agent: *\nDisallow: /\n");
  let repoName;
  let rest;
  let shim = false;
  if (url.hostname !== env.RUN_HOST) {
    const label2 = url.hostname.slice(0, -(env.RUN_HOST.length + 1));
    const repo = label2.includes(".") ? null : repoOfHostLabel(label2);
    if (!repo || await isWorker(env, repo)) return fetch(request);
    repoName = repo;
    rest = url.pathname;
  } else {
    const m = url.pathname.match(/^\/([a-z0-9][a-z0-9.-]*\.[a-z0-9-]+(?:--[a-z0-9]+)?)(\/.*)?$/);
    if (!m) return deny(404, "not found");
    repoName = m[1];
    const host = runHost(repoName, env.RUN_HOST);
    if (host) return Response.redirect(`https://${host}${m[2] || "/"}${url.search}`, 301);
    if (!m[2]) return Response.redirect(`${url.origin}/${repoName}/`, 301);
    rest = m[2];
    shim = true;
  }
  const meta = await projectMeta(env, repoName);
  if (meta.private) {
    const slug = repoName.split("--")[0];
    const cookieName = `qbp_${slug.replace(/[^a-z0-9]/g, "_")}`;
    const given = url.searchParams.get("__qb");
    if (given) {
      if (!await checkRunPass(env, slug, given)) return deny(404, "no such project");
      url.searchParams.delete("__qb");
      return new Response(null, { status: 302, headers: {
        location: url.pathname + (url.search || ""),
        "cache-control": "no-store",
        "set-cookie": `${cookieName}=${given}; Path=/; Max-Age=${PASS_TTL_S}; HttpOnly; Secure; SameSite=None; Partitioned`
      } });
    }
    const c = (request.headers.get("cookie") || "").match(new RegExp(`${cookieName}=([0-9a-f.]+)`));
    if (!c || !await checkRunPass(env, slug, c[1])) return deny(404, "no such project");
  }
  let path2 = decodeURIComponent(rest.slice(1));
  if (path2 === "" || path2.endsWith("/")) path2 += "index.html";
  if (path2.split("/").some((s) => s === ".." || s.startsWith(".git"))) return deny(404, "not found");
  const cache2 = caches.default;
  const headKey = new Request(`https://${env.RUN_HOST}/__head/${repoName}`);
  let head3 = await cache2.match(headKey).then((r) => r?.text());
  if (!head3) {
    try {
      var _stack = [];
      try {
        const repo = __using(_stack, await env.ARTIFACTS.get(repoName));
        head3 = (await repo.log({ limit: 1 }))[0]?.hash;
      } catch (_) {
        var _error = _, _hasError = true;
      } finally {
        __callDispose(_stack, _error, _hasError);
      }
    } catch (e) {
      log("run", "head_failed", { repoName, err: String(e) });
    }
    if (!head3) return deny(404, "no such project, or nothing pushed yet");
    ctx.waitUntil(cache2.put(headKey, new Response(head3, { headers: { "cache-control": `max-age=${HEAD_TTL_S}` } })));
  }
  const fileKey = new Request(`https://${env.RUN_HOST}/__f${SERVE_V}${shim ? "s" : ""}/${repoName}/${head3}/${encodeURIComponent(path2)}`);
  const hit = await cache2.match(fileKey);
  if (hit) return withHeaders(hit, head3);
  let blob2 = null;
  try {
    var _stack2 = [];
    try {
      const repo = __using(_stack2, await env.ARTIFACTS.get(repoName));
      blob2 = await repo.readFile({ ref: head3, path: path2 });
      if (!blob2 && !path2.endsWith(".html") && !/\.[a-z0-9]+$/i.test(path2)) {
        path2 = `${path2}/index.html`;
        blob2 = await repo.readFile({ ref: head3, path: path2 });
      }
    } catch (_2) {
      var _error2 = _2, _hasError2 = true;
    } finally {
      __callDispose(_stack2, _error2, _hasError2);
    }
  } catch (e) {
    log("run", "read_failed", { repoName, path: path2, err: String(e) });
  }
  if (!blob2) return deny(404, `${path2} is not in ${repoName}`);
  const ext = (path2.split(".").pop() || "").toLowerCase();
  let body = await blob2.arrayBuffer();
  if (shim && (ext === "html" || ext === "htm")) {
    const text = new TextDecoder().decode(body);
    const at = text.search(/<head[^>]*>/i);
    const doctype = text.match(/^\s*<!doctype[^>]*>/i);
    body = at >= 0 ? text.replace(/<head[^>]*>/i, (m) => m + storageShim(repoName)) : doctype ? doctype[0] + storageShim(repoName) + text.slice(doctype[0].length) : storageShim(repoName) + text;
  }
  const res = new Response(body, {
    headers: { "content-type": TYPES[ext] || blob2.type || "application/octet-stream", "cache-control": `max-age=${FILE_TTL_S}` }
  });
  ctx.waitUntil(cache2.put(fileKey, res.clone()));
  return withHeaders(res, head3);
}
__name(serveRun, "serveRun");
function storageShim(repo) {
  return `<script>/* forq: storage scoped to ${repo} */(function(){var P=${JSON.stringify(repo + "::")};
function scope(real){var own=function(){var k=[];for(var i=0;i<real.length;i++){var n=real.key(i);if(n&&n.indexOf(P)===0)k.push(n.slice(P.length));}return k;};
var api={getItem:function(k){return real.getItem(P+k);},setItem:function(k,v){real.setItem(P+k,String(v));},removeItem:function(k){real.removeItem(P+k);},
clear:function(){own().forEach(function(k){real.removeItem(P+k);});},key:function(i){var k=own();return i<k.length?k[i]:null;}};
return new Proxy(api,{get:function(t,k){if(k==='length')return own().length;if(k in api)return api[k];if(typeof k==='symbol')return undefined;return real.getItem(P+k)===null?undefined:real.getItem(P+k);},
set:function(t,k,v){if(k in api)return false;real.setItem(P+k,String(v));return true;},deleteProperty:function(t,k){real.removeItem(P+k);return true;},
has:function(t,k){return k in api||real.getItem(P+k)!==null;},ownKeys:function(){return own();},getOwnPropertyDescriptor:function(t,k){var v=real.getItem(P+k);return v===null?undefined:{value:v,enumerable:true,configurable:true,writable:true};}});}
['localStorage','sessionStorage'].forEach(function(n){try{var real=window[n];var s=scope(real);Object.defineProperty(window,n,{get:function(){return s;},configurable:true});}catch(e){}});})();<\/script>`;
}
__name(storageShim, "storageShim");
var kinds = /* @__PURE__ */ new Map();
async function projectMeta(env, repo) {
  const slug = repo.split("--")[0];
  const hit = kinds.get(slug);
  if (hit && Date.now() - hit.at < 6e4) return hit;
  const info = await env.Project.get(env.Project.idFromName(slug)).info().catch(() => null);
  const meta = { worker: info?.kind === "worker", private: !!info?.private, at: Date.now() };
  kinds.set(slug, meta);
  return meta;
}
__name(projectMeta, "projectMeta");
var isWorker = /* @__PURE__ */ __name(async (env, repo) => (await projectMeta(env, repo)).worker, "isWorker");
var PASS_TTL_S = 12 * 3600;
async function passSig(env, slug, exp) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.ADMIN_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig2 = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`runpass:${slug}:${exp}`));
  return [...new Uint8Array(sig2)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(passSig, "passSig");
async function mintRunPass(env, slug) {
  const exp = Math.floor(Date.now() / 1e3) + PASS_TTL_S;
  return `${exp}.${await passSig(env, slug, exp)}`;
}
__name(mintRunPass, "mintRunPass");
async function checkRunPass(env, slug, pass) {
  const [e, sig2] = pass.split(".");
  const exp = Number(e);
  return !!sig2 && exp > Date.now() / 1e3 && sig2 === await passSig(env, slug, exp);
}
__name(checkRunPass, "checkRunPass");
function withHeaders(r, head3) {
  const out = new Response(r.body, r);
  out.headers.set("cache-control", "no-cache");
  out.headers.set("x-robots-tag", "noindex");
  out.headers.set("x-forq-commit", head3.slice(0, 12));
  out.headers.set("referrer-policy", "no-referrer");
  return out;
}
__name(withHeaders, "withHeaders");

// ../src/catalog.json
var catalog_default = {
  builtAt: "2026-10-03T12:33:56.335Z",
  projects: [
    {
      full: "affaan-m/ECC",
      desc: "The agent harness performance optimization system. Skills, instincts, memory, security, and research-first development for Claude Code, Code",
      stars: 271777,
      license: "MIT",
      sizeKb: 54908,
      cat: "ai",
      topic: "llm",
      homepage: "https://ecc.tools",
      pushed: 1790906474e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "yt-dlp/yt-dlp",
      desc: "A feature-rich command-line audio/video downloader",
      stars: 195154,
      license: "Unlicense",
      sizeKb: 64797,
      cat: "cli",
      topic: "cli",
      homepage: "https://discord.gg/H5MNcFW63r",
      pushed: 1790546953e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Python"
    },
    {
      full: "ohmyzsh/ohmyzsh",
      desc: "\u{1F643}   A delightful community-driven (with 2,500+ contributors) framework for managing your zsh configuration. Includes 300+ optional plugins ",
      stars: 190052,
      license: "MIT",
      sizeKb: 14262,
      cat: "cli",
      topic: "cli",
      homepage: "https://ohmyz.sh",
      pushed: 1790696321e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Shell"
    },
    {
      full: "firecrawl/firecrawl",
      desc: "Supercharge your AI agents with data from the web and beyond. Building the library for superintelligence. \u{1F525}",
      stars: 188109,
      license: "AGPL-3.0",
      sizeKb: 182407,
      cat: "ai",
      topic: "llm",
      homepage: "https://firecrawl.dev",
      pushed: 1791007858e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "ollama/ollama",
      desc: "Get up and running with Kimi, GLM, MiniMax, DeepSeek, gpt-oss, Qwen, Gemma and other models.",
      stars: 182085,
      license: "MIT",
      sizeKb: 94983,
      cat: "ai",
      topic: "llm",
      homepage: "https://ollama.com",
      pushed: 1791000574e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Go"
    },
    {
      full: "DietrichGebert/ponytail",
      desc: "Makes your AI agent think like the laziest senior dev in the room. The best code is the code you never wrote.",
      stars: 152426,
      license: "MIT",
      sizeKb: 2712,
      cat: "ai",
      topic: "llm",
      homepage: "https://ponytail.dev",
      pushed: 1791004375e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "Graphify-Labs/graphify",
      desc: "Turn any codebase, with its docs, SQL schemas, configs, and PDFs, into a queryable knowledge graph. A /graphify skill for Claude Code, Curso",
      stars: 123432,
      license: "Apache-2.0",
      sizeKb: 26703,
      cat: "ai",
      topic: "llm",
      homepage: "https://www.graphify.com",
      pushed: 1790979123e3,
      branch: "v8",
      entry: null,
      runs: false,
      lang: "Python"
    },
    {
      full: "browser-use/browser-use",
      desc: "Agents that use the browser.",
      stars: 117041,
      license: "MIT",
      sizeKb: 37009,
      cat: "ai",
      topic: "llm",
      homepage: "https://browser-use.com",
      pushed: 1790985968e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Python"
    },
    {
      full: "d3/d3",
      desc: "Bring data to life with SVG, Canvas and HTML. :bar_chart::chart_with_upwards_trend::tada:",
      stars: 113799,
      license: "ISC",
      sizeKb: 59348,
      cat: "data",
      topic: "data-visualization",
      homepage: "https://d3js.org",
      pushed: 1779979381e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Shell"
    },
    {
      full: "TauricResearch/TradingAgents",
      desc: "TradingAgents: Multi-Agents LLM Financial Trading Framework",
      stars: 109579,
      license: "Apache-2.0",
      sizeKb: 6123,
      cat: "ai",
      topic: "llm",
      homepage: "https://arxiv.org/pdf/2412.20138",
      pushed: 179066251e4,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Python"
    },
    {
      full: "google-gemini/gemini-cli",
      desc: "An open-source AI agent that brings the power of Gemini directly into your terminal.",
      stars: 107223,
      license: "Apache-2.0",
      sizeKb: 103589,
      cat: "ai",
      topic: "ai-agents",
      homepage: "https://geminicli.com",
      pushed: 1790990954e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "microsoft/terminal",
      desc: "The new Windows Terminal and the original Windows console host, all in the same place!",
      stars: 105060,
      license: "MIT",
      sizeKb: 180218,
      cat: "cli",
      topic: "terminal",
      homepage: null,
      pushed: 1790897997e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "C++"
    },
    {
      full: "tailwindlabs/tailwindcss",
      desc: "A utility-first CSS framework for rapid UI development.",
      stars: 97755,
      license: "MIT",
      sizeKb: 114012,
      cat: "frameworks",
      topic: "css-framework",
      homepage: "https://tailwindcss.com/",
      pushed: 1790364763e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "sherlock-project/sherlock",
      desc: "Hunt down social media accounts by username across social networks",
      stars: 93173,
      license: "MIT",
      sizeKb: 19083,
      cat: "cli",
      topic: "cli",
      homepage: "https://sherlockproject.xyz",
      pushed: 1791004609e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Python"
    },
    {
      full: "louislam/uptime-kuma",
      desc: "A fancy self-hosted monitoring tool",
      stars: 92082,
      license: "MIT",
      sizeKb: 38760,
      cat: "selfhosted",
      topic: "self-hosted",
      homepage: "https://uptime.kuma.pet",
      pushed: 1790986008e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "infiniflow/ragflow",
      desc: "RAGFlow is a leading open-source Retrieval-Augmented Generation (RAG) engine that fuses cutting-edge RAG with Agent capabilities to create a",
      stars: 91622,
      license: "Apache-2.0",
      sizeKb: 175212,
      cat: "ai",
      topic: "ai-agents",
      homepage: "https://ragflow.io",
      pushed: 1791024186e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Go"
    },
    {
      full: "gohugoio/hugo",
      desc: "The world\u2019s fastest framework for building websites.",
      stars: 90022,
      license: "Apache-2.0",
      sizeKb: 146525,
      cat: "frameworks",
      topic: "static-site-generator",
      homepage: "https://gohugo.io",
      pushed: 1790876008e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Go"
    },
    {
      full: "Panniantong/Agent-Reach",
      desc: "Give your AI agent eyes to see the entire internet. Read & search Twitter, Reddit, YouTube, GitHub, Bilibili, XiaoHongShu \u2014 one CLI, zero AP",
      stars: 89371,
      license: "MIT",
      sizeKb: 2024,
      cat: "cli",
      topic: "cli",
      homepage: null,
      pushed: 1789488984e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Python"
    },
    {
      full: "unclecode/crawl4ai",
      desc: "Open-source web crawler and scraper for LLMs and AI agents: any website into clean, LLM-ready Markdown. Run it yourself, or use Crawl4AI Clo",
      stars: 84682,
      license: "Apache-2.0",
      sizeKb: 151642,
      cat: "ai",
      topic: "ai-agents",
      homepage: "https://crawl4ai.com",
      pushed: 1790318234e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Python"
    },
    {
      full: "junegunn/fzf",
      desc: ":cherry_blossom: A command-line fuzzy finder",
      stars: 83360,
      license: "MIT",
      sizeKb: 8485,
      cat: "cli",
      topic: "cli",
      homepage: "https://junegunn.github.io/fzf/",
      pushed: 1791007571e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Go"
    },
    {
      full: "bytedance/deer-flow",
      desc: "An open-source long-horizon SuperAgent harness that researches, codes, and creates. With the help of sandboxes, memories, tools, skill, suba",
      stars: 83350,
      license: "MIT",
      sizeKb: 75157,
      cat: "ai",
      topic: "ai-agents",
      homepage: "https://deerflow.tech",
      pushed: 1791030624e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Python"
    },
    {
      full: "mlabonne/llm-course",
      desc: "Course to get into Large Language Models (LLMs) with roadmaps and Colab notebooks.",
      stars: 83274,
      license: "Apache-2.0",
      sizeKb: 7637,
      cat: "ai",
      topic: "machine-learning",
      homepage: "https://mlabonne.github.io/blog/",
      pushed: 1770296966e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: null
    },
    {
      full: "jesseduffield/lazygit",
      desc: "simple terminal UI for git commands",
      stars: 82864,
      license: "MIT",
      sizeKb: 158067,
      cat: "cli",
      topic: "cli",
      homepage: null,
      pushed: 1790868531e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Go"
    },
    {
      full: "rtk-ai/rtk",
      desc: "CLI proxy that reduces LLM token consumption by 60-90% on common dev commands. Single Rust binary, zero dependencies",
      stars: 82281,
      license: "Apache-2.0",
      sizeKb: 11593,
      cat: "cli",
      topic: "cli",
      homepage: "https://www.rtk-ai.app",
      pushed: 1790987394e3,
      branch: "develop",
      entry: null,
      runs: false,
      lang: "Rust"
    },
    {
      full: "hoppscotch/hoppscotch",
      desc: "Open-Source API Development Ecosystem \u2022 https://hoppscotch.io \u2022 Offline, On-Prem & Cloud \u2022 Web, Desktop & CLI \u2022 Open-Source Alternative to P",
      stars: 80562,
      license: "MIT",
      sizeKb: 100465,
      cat: "devtools",
      topic: "developer-tools",
      homepage: "https://hoppscotch.io",
      pushed: 1790771186e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "dair-ai/Prompt-Engineering-Guide",
      desc: "\u{1F419} Guides, papers, lessons, notebooks and resources for prompt engineering, context engineering, RAG, and AI Agents.",
      stars: 78799,
      license: "MIT",
      sizeKb: 82777,
      cat: "ai",
      topic: "ai-agents",
      homepage: "https://www.promptingguide.ai/",
      pushed: 1773259753e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "MDX"
    },
    {
      full: "tesseract-ocr/tesseract",
      desc: "Tesseract Open Source OCR Engine (main repository)",
      stars: 76815,
      license: "Apache-2.0",
      sizeKb: 54811,
      cat: "ai",
      topic: "machine-learning",
      homepage: "https://tesseract-ocr.github.io/",
      pushed: 1790581238e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "C++"
    },
    {
      full: "pallets/flask",
      desc: "The Python micro framework for building web applications.",
      stars: 74799,
      license: "BSD-3-Clause",
      sizeKb: 12311,
      cat: "frameworks",
      topic: "web-framework",
      homepage: "https://flask.palletsprojects.com",
      pushed: 1788885653e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Python"
    },
    {
      full: "Eugeny/tabby",
      desc: "A terminal for a more modern age",
      stars: 74786,
      license: "MIT",
      sizeKb: 100082,
      cat: "cli",
      topic: "terminal",
      homepage: "https://tabby.sh",
      pushed: 1790654594e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "binhnguyennus/awesome-scalability",
      desc: "The Patterns of Scalable, Reliable, and Performant Large-Scale Systems",
      stars: 74498,
      license: "MIT",
      sizeKb: 1607,
      cat: "ai",
      topic: "machine-learning",
      homepage: null,
      pushed: 1767498707e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: null
    },
    {
      full: "headroomlabs-ai/headroom",
      desc: "Compress tool outputs, logs, files, and RAG chunks before they reach the LLM. 20% fewer tokens for coding agents, 60-95% fewer tokens for JS",
      stars: 74316,
      license: "Apache-2.0",
      sizeKb: 88188,
      cat: "ai",
      topic: "rag",
      homepage: "https://docs.headroomlabs.ai/docs",
      pushed: 1791013552e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Python"
    },
    {
      full: "career-ops-hq/career-ops",
      desc: "Open-source AI job search agent and job finder: scan job boards, score each job 1-5 against your CV before you apply, tailor an ATS-friendly",
      stars: 73359,
      license: "MIT",
      sizeKb: 83516,
      cat: "cli",
      topic: "cli",
      homepage: "https://career-ops.org",
      pushed: 1791030634e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "juliangarnier/anime",
      desc: "JavaScript animation engine",
      stars: 73285,
      license: "MIT",
      sizeKb: 185076,
      cat: "libraries",
      topic: "javascript-library",
      homepage: "https://animejs.com",
      pushed: 178734779e4,
      branch: "master",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "hakimel/reveal.js",
      desc: "The HTML Presentation Framework",
      stars: 72378,
      license: "MIT",
      sizeKb: 35674,
      cat: "slides",
      topic: "slides",
      homepage: "https://revealjs.com",
      pushed: 1790797093e3,
      branch: "master",
      entry: "",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "BurntSushi/ripgrep",
      desc: "ripgrep recursively searches directories for a regex pattern while respecting your gitignore",
      stars: 68800,
      license: "Unlicense",
      sizeKb: 5700,
      cat: "cli",
      topic: "cli",
      homepage: null,
      pushed: 1785851984e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Rust"
    },
    {
      full: "labmlai/annotated_deep_learning_paper_implementations",
      desc: "\u{1F9D1}\u200D\u{1F3EB} 60+ Implementations/tutorials of deep learning papers with side-by-side notes \u{1F4DD}; including transformers (original, xl, switch, feedba",
      stars: 67509,
      license: "MIT",
      sizeKb: 156370,
      cat: "ai",
      topic: "machine-learning",
      homepage: "https://nn.labml.ai",
      pushed: 176905596e4,
      branch: "master",
      entry: "docs",
      runs: true,
      lang: "Python"
    },
    {
      full: "Mintplex-Labs/anything-llm",
      desc: "Stop renting your intelligence. Own it with AnythingLLM. Everything you need for a powerful local-first agent experience",
      stars: 66683,
      license: "MIT",
      sizeKb: 93939,
      cat: "ai",
      topic: "rag",
      homepage: "https://anythingllm.com",
      pushed: 17909903e5,
      branch: "master",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "mem0ai/mem0",
      desc: "The Memory Layer for AI Agents - Drop-in memory infrastructure for AI agents and apps. Context that persists. Built for production.",
      stars: 66516,
      license: "Apache-2.0",
      sizeKb: 65673,
      cat: "ai",
      topic: "rag",
      homepage: "https://mem0.ai",
      pushed: 1790885259e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Python"
    },
    {
      full: "alacritty/alacritty",
      desc: "A cross-platform, OpenGL terminal emulator.",
      stars: 65881,
      license: "Apache-2.0",
      sizeKb: 14582,
      cat: "cli",
      topic: "terminal",
      homepage: "https://alacritty.org",
      pushed: 1788210672e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Rust"
    },
    {
      full: "usememos/memos",
      desc: "A personal timeline for quick notes. Write short memos, find them later by search, tag, or date. Open source and self-hosted.",
      stars: 63482,
      license: "MIT",
      sizeKb: 44801,
      cat: "selfhosted",
      topic: "self-hosted",
      homepage: "https://usememos.com",
      pushed: 1790979474e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Go"
    },
    {
      full: "coollabsio/coolify",
      desc: "An open-source, self-hostable PaaS alternative to Vercel, Heroku & Netlify that lets you easily deploy static sites, databases, full-stack a",
      stars: 62538,
      license: "Apache-2.0",
      sizeKb: 90703,
      cat: "selfhosted",
      topic: "self-hosted",
      homepage: "https://coolify.io",
      pushed: 1790960171e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "PHP"
    },
    {
      full: "nuxt/nuxt",
      desc: "The full-stack Vue framework.",
      stars: 60918,
      license: "MIT",
      sizeKb: 152955,
      cat: "frameworks",
      topic: "static-site-generator",
      homepage: "https://nuxt.com",
      pushed: 1791021879e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "sharkdp/bat",
      desc: "A cat(1) clone with wings.",
      stars: 60648,
      license: "Apache-2.0",
      sizeKb: 35310,
      cat: "cli",
      topic: "cli",
      homepage: null,
      pushed: 1790820791e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Rust"
    },
    {
      full: "pathwaycom/llm-app",
      desc: "Ready-to-run cloud templates for RAG, AI pipelines, and enterprise search with live data. \u{1F433}Docker-friendly.\u26A1Always in sync with Sharepoint,",
      stars: 58857,
      license: "MIT",
      sizeKb: 62554,
      cat: "ai",
      topic: "rag",
      homepage: "https://pathway.com/developers/templates/",
      pushed: 1783274347e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Jupyter Notebook"
    },
    {
      full: "Textualize/rich",
      desc: "Rich is a Python library for rich text and beautiful formatting in the terminal.",
      stars: 57471,
      license: "MIT",
      sizeKb: 50632,
      cat: "cli",
      topic: "terminal",
      homepage: "https://rich.readthedocs.io/en/latest/",
      pushed: 1782184219e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Python"
    },
    {
      full: "hugohe3/ppt-master",
      desc: "AI turns documents or topics into real, native PowerPoint decks\u2014with native shapes, transitions and animations, data-backed charts and table",
      stars: 57455,
      license: "MIT",
      sizeKb: 129036,
      cat: "slides",
      topic: "presentation",
      homepage: "https://hugohe3.github.io/ppt-master-examples/",
      pushed: 1790788041e3,
      branch: "main",
      entry: "",
      runs: true,
      lang: "Python"
    },
    {
      full: "ayghri/i-have-adhd",
      desc: "A skill to stop your coding agent from burying the answer. ADHD-friendly output.",
      stars: 53058,
      license: "MIT",
      sizeKb: 416,
      cat: "devtools",
      topic: "developer-tools",
      homepage: null,
      pushed: 1789836286e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Python"
    },
    {
      full: "etcd-io/etcd",
      desc: "Distributed reliable key-value store for the most critical data of a distributed system",
      stars: 52323,
      license: "Apache-2.0",
      sizeKb: 99517,
      cat: "data",
      topic: "database",
      homepage: "https://etcd.io",
      pushed: 1790886175e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Go"
    },
    {
      full: "jekyll/jekyll",
      desc: ":globe_with_meridians: Jekyll is a blog-aware static site generator in Ruby",
      stars: 51706,
      license: "MIT",
      sizeKb: 71700,
      cat: "frameworks",
      topic: "static-site-generator",
      homepage: "https://jekyllrb.com",
      pushed: 1789672803e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Ruby"
    },
    {
      full: "Semantic-Org/Semantic-UI",
      desc: "Semantic is a UI component framework based around useful principles from natural language.",
      stars: 51025,
      license: "MIT",
      sizeKb: 113201,
      cat: "frameworks",
      topic: "css-framework",
      homepage: "http://www.semantic-ui.com",
      pushed: 1732741308e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "jgthms/bulma",
      desc: "Modern CSS framework based on Flexbox",
      stars: 50055,
      license: "MIT",
      sizeKb: 116402,
      cat: "frameworks",
      topic: "css-framework",
      homepage: "https://bulma.io",
      pushed: 1789984594e3,
      branch: "main",
      entry: "docs",
      runs: true,
      lang: "CSS"
    },
    {
      full: "HKUDS/nanobot",
      desc: "Ultra-lightweight, open-source, self-hosted personal AI agent framework in Python with WebUI, tools, memory, MCP, multi-agent workflows, aut",
      stars: 48755,
      license: "MIT",
      sizeKb: 70650,
      cat: "selfhosted",
      topic: "self-hosted",
      homepage: "https://nanobot.wiki",
      pushed: 1791030307e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Python"
    },
    {
      full: "brillout/awesome-react-components",
      desc: "Curated List of React Components & Libraries.",
      stars: 48540,
      license: "CC0-1.0",
      sizeKb: 1367,
      cat: "libraries",
      topic: "react-components",
      homepage: null,
      pushed: 1769445405e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: null
    },
    {
      full: "pixijs/pixijs",
      desc: "The HTML5 Creation Engine: Create beautiful digital content with the fastest, most flexible 2D WebGL renderer.",
      stars: 48270,
      license: "MIT",
      sizeKb: 137432,
      cat: "data",
      topic: "data-visualization",
      homepage: "http://pixijs.com",
      pushed: 1790945332e3,
      branch: "dev",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "usebruno/bruno",
      desc: "Opensource IDE For Exploring and Testing API's (lightweight alternative to Postman/Insomnia)",
      stars: 47329,
      license: "MIT",
      sizeKb: 66217,
      cat: "devtools",
      topic: "developer-tools",
      homepage: "https://www.usebruno.com/",
      pushed: 1790863658e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "LeCoupa/awesome-cheatsheets",
      desc: "\u{1F469}\u200D\u{1F4BB}\u{1F468}\u200D\u{1F4BB} Awesome cheatsheets for popular programming languages, frameworks and development tools. They include everything you should know ",
      stars: 46532,
      license: "MIT",
      sizeKb: 8889,
      cat: "data",
      topic: "database",
      homepage: "https://lecoupa.github.io/awesome-cheatsheets/",
      pushed: 177601477e4,
      branch: "master",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "vercel/hyper",
      desc: "A terminal built on web technologies",
      stars: 44738,
      license: "MIT",
      sizeKb: 23469,
      cat: "cli",
      topic: "terminal",
      homepage: "https://hyper.is",
      pushed: 1787345079e3,
      branch: "canary",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "sharkdp/fd",
      desc: "A simple, fast and user-friendly alternative to 'find'",
      stars: 44626,
      license: "Apache-2.0",
      sizeKb: 2451,
      cat: "cli",
      topic: "terminal",
      homepage: null,
      pushed: 17909886e5,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Rust"
    },
    {
      full: "gradio-app/gradio",
      desc: "Build and share delightful machine learning apps, all in Python. \u{1F31F} Star to support our work!",
      stars: 43663,
      license: "Apache-2.0",
      sizeKb: 125263,
      cat: "data",
      topic: "data-visualization",
      homepage: "http://www.gradio.app",
      pushed: 1790975128e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Python"
    },
    {
      full: "cathrynlavery/diagram-design",
      desc: "Editorial diagram design for Claude Code, Codex, GitHub Copilot, Factory Droid, and Pi. 42 diagram types. Self-contained HTML + SVG. No shad",
      stars: 43168,
      license: "MIT",
      sizeKb: 16061,
      cat: "data",
      topic: "data-visualization",
      homepage: "https://cathrynlavery.github.io/diagram-design/",
      pushed: 1790874187e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "HTML"
    },
    {
      full: "sxyazi/yazi",
      desc: "\u{1F4A5} Blazing fast terminal file manager written in Rust, based on async I/O.",
      stars: 42590,
      license: "MIT",
      sizeKb: 10183,
      cat: "cli",
      topic: "terminal",
      homepage: "https://yazi-rs.github.io",
      pushed: 1791026275e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Rust"
    },
    {
      full: "hexojs/hexo",
      desc: "A fast, simple & powerful blog framework, powered by Node.js.",
      stars: 41773,
      license: "MIT",
      sizeKb: 7302,
      cat: "frameworks",
      topic: "static-site-generator",
      homepage: "https://hexo.io",
      pushed: 1787996192e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "Kong/insomnia",
      desc: "The open-source, cross-platform API client for GraphQL, REST, WebSockets, SSE and gRPC. With Cloud, Local and Git storage.",
      stars: 40036,
      license: "Apache-2.0",
      sizeKb: 164639,
      cat: "devtools",
      topic: "api-client",
      homepage: "https://insomnia.rest",
      pushed: 1790986946e3,
      branch: "develop",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "ajeetdsouza/zoxide",
      desc: "A smarter cd command. Supports all major shells.",
      stars: 39852,
      license: "MIT",
      sizeKb: 5023,
      cat: "cli",
      topic: "command-line-tool",
      homepage: "https://crates.io/crates/zoxide",
      pushed: 1791029982e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Rust"
    },
    {
      full: "drawdb-io/drawdb",
      desc: "Free, simple, and intuitive online database diagram editor and SQL generator.",
      stars: 39826,
      license: "AGPL-3.0",
      sizeKb: 7920,
      cat: "data",
      topic: "database",
      homepage: "https://drawdb.app",
      pushed: 1790718771e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "umami-software/umami",
      desc: "Umami is a privacy-first analytics platform. Traffic, campaigns, behavior, conversions, and revenue in one place \u2014 no cookies, no surveillan",
      stars: 39136,
      license: "MIT",
      sizeKb: 29808,
      cat: "data",
      topic: "analytics",
      homepage: "https://umami.is",
      pushed: 1790998727e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "lapce/lapce",
      desc: "Lightning-fast and Powerful Code Editor written in Rust",
      stars: 38887,
      license: "Apache-2.0",
      sizeKb: 28855,
      cat: "devtools",
      topic: "code-editor",
      homepage: "https://lap.dev/lapce/",
      pushed: 1790988516e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Rust"
    },
    {
      full: "Dogfalo/materialize",
      desc: "Materialize, a CSS Framework based on Material Design",
      stars: 38795,
      license: "MIT",
      sizeKb: 165858,
      cat: "frameworks",
      topic: "css-framework",
      homepage: "https://materializecss.com",
      pushed: 1787233751e3,
      branch: "v1-dev",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "httpie/cli",
      desc: "\u{1F967} HTTPie CLI  \u2014 modern, user-friendly command-line HTTP client for the API era. JSON support, colors, sessions, downloads, plugins & more.",
      stars: 38606,
      license: "BSD-3-Clause",
      sizeKb: 6925,
      cat: "devtools",
      topic: "api-client",
      homepage: "https://httpie.io",
      pushed: 1734456635e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Python"
    },
    {
      full: "IceWhaleTech/CasaOS",
      desc: "CasaOS - A simple, easy-to-use, elegant open-source Personal Cloud system.",
      stars: 37283,
      license: "Apache-2.0",
      sizeKb: 181034,
      cat: "selfhosted",
      topic: "home-automation",
      homepage: "https://casaos.zimaspace.com",
      pushed: 1790591834e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Go"
    },
    {
      full: "blakeblackshear/frigate",
      desc: "NVR with realtime local object detection for IP cameras",
      stars: 36333,
      license: "MIT",
      sizeKb: 131391,
      cat: "selfhosted",
      topic: "home-automation",
      homepage: "https://frigate.video",
      pushed: 1790976907e3,
      branch: "dev",
      entry: null,
      runs: false,
      lang: "Python"
    },
    {
      full: "zeromicro/go-zero",
      desc: "A cloud-native Go microservices framework with cli tool for productivity.",
      stars: 33364,
      license: "MIT",
      sizeKb: 33262,
      cat: "frameworks",
      topic: "web-framework",
      homepage: "https://go-zero.dev",
      pushed: 1790970776e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Go"
    },
    {
      full: "yewstack/yew",
      desc: "Rust / Wasm framework for creating reliable and efficient web applications",
      stars: 32824,
      license: "Apache-2.0",
      sizeKb: 22067,
      cat: "frameworks",
      topic: "web-framework",
      homepage: "https://yew.rs",
      pushed: 1791027181e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Rust"
    },
    {
      full: "labstack/echo",
      desc: "High performance, minimalist Go web framework",
      stars: 32750,
      license: "MIT",
      sizeKb: 6776,
      cat: "frameworks",
      topic: "web-framework",
      homepage: "https://echo.labstack.com",
      pushed: 1790966927e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Go"
    },
    {
      full: "honojs/hono",
      desc: "Web framework built on Web Standards",
      stars: 32402,
      license: "MIT",
      sizeKb: 9907,
      cat: "frameworks",
      topic: "web-framework",
      homepage: "https://hono.dev",
      pushed: 1790935478e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "academic/awesome-datascience",
      desc: ":memo: An awesome Data Science repository to learn and apply for real world problems.",
      stars: 30104,
      license: "MIT",
      sizeKb: 1761,
      cat: "data",
      topic: "data-visualization",
      homepage: null,
      pushed: 1790972458e3,
      branch: "live",
      entry: null,
      runs: false,
      lang: null
    },
    {
      full: "community-scripts/ProxmoxVE",
      desc: "Proxmox VE Helper-Scripts (Community Edition)",
      stars: 29716,
      license: "MIT",
      sizeKb: 46231,
      cat: "selfhosted",
      topic: "home-automation",
      homepage: "https://community-scripts.org/",
      pushed: 1791008504e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Shell"
    },
    {
      full: "reflex-dev/reflex",
      desc: "\u{1F578}\uFE0F Web apps in pure Python \u{1F40D}",
      stars: 28936,
      license: "Apache-2.0",
      sizeKb: 121172,
      cat: "data",
      topic: "data-visualization",
      homepage: "https://reflex.dev",
      pushed: 1790985814e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Python"
    },
    {
      full: "getredash/redash",
      desc: "Make Your Company Data Driven. Connect to any data source, easily visualize, dashboard and share your data.",
      stars: 28830,
      license: "BSD-2-Clause",
      sizeKb: 38250,
      cat: "data",
      topic: "analytics",
      homepage: "http://redash.io/",
      pushed: 1790970552e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Python"
    },
    {
      full: "ggreer/the_silver_searcher",
      desc: "A code-searching tool similar to ack, but faster.",
      stars: 27122,
      license: "Apache-2.0",
      sizeKb: 2426,
      cat: "cli",
      topic: "command-line-tool",
      homepage: "http://geoff.greer.fm/ag/",
      pushed: 1718566661e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "C"
    },
    {
      full: "bvaughn/react-virtualized",
      desc: "React components for efficiently rendering large lists and tabular data",
      stars: 27073,
      license: "MIT",
      sizeKb: 48767,
      cat: "libraries",
      topic: "react-components",
      homepage: "http://bvaughn.github.io/react-virtualized/",
      pushed: 1737409344e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "vapor/vapor",
      desc: "\u{1F4A7} A server-side Swift HTTP web framework.",
      stars: 26228,
      license: "MIT",
      sizeKb: 18871,
      cat: "frameworks",
      topic: "web-framework",
      homepage: "https://vapor.codes",
      pushed: 1790948034e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Swift"
    },
    {
      full: "Modernizr/Modernizr",
      desc: "Modernizr is a JavaScript library that detects HTML5 and CSS3 features in the user\u2019s browser.",
      stars: 25679,
      license: "MIT",
      sizeKb: 20835,
      cat: "libraries",
      topic: "javascript-library",
      homepage: "https://www.npmjs.com/package/modernizr",
      pushed: 1791004528e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "kataras/iris",
      desc: "The fastest HTTP/2 Go Web Framework. New, modern and easy to learn. Fast development with Code you control. Unbeatable cost-performance rati",
      stars: 25560,
      license: "BSD-3-Clause",
      sizeKb: 18478,
      cat: "frameworks",
      topic: "web-framework",
      homepage: "https://www.iris-go.com",
      pushed: 1785144852e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Go"
    },
    {
      full: "spicetify/cli",
      desc: "Command-line tool to customize Spotify client. Supports Windows, macOS, and Linux.",
      stars: 24768,
      license: "LGPL-2.1",
      sizeKb: 9875,
      cat: "cli",
      topic: "command-line-tool",
      homepage: "https://spicetify.app",
      pushed: 1791004685e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "uutils/coreutils",
      desc: "Cross-platform Rust rewrite of the GNU coreutils",
      stars: 24216,
      license: "MIT",
      sizeKb: 47160,
      cat: "cli",
      topic: "command-line-tool",
      homepage: "https://uutils.org",
      pushed: 179102852e4,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Rust"
    },
    {
      full: "kriasoft/react-starter-kit",
      desc: "Modern React starter kit with Bun, TypeScript, Tailwind CSS, tRPC, Stripe, and Cloudflare Workers. Production-ready monorepo for building fa",
      stars: 23688,
      license: "MIT",
      sizeKb: 34845,
      cat: "selfhosted",
      topic: "cloudflare-workers",
      homepage: "https://reactstarter.com",
      pushed: 1790972342e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "phoenixframework/phoenix",
      desc: "Peace of mind from prototype to production",
      stars: 23170,
      license: "MIT",
      sizeKb: 25520,
      cat: "frameworks",
      topic: "web-framework",
      homepage: "https://www.phoenixframework.org",
      pushed: 1790857372e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Elixir"
    },
    {
      full: "CodeEditApp/CodeEdit",
      desc: "\u{1F4DD} CodeEdit App for macOS \u2013 Elevate your code editing experience. Open source, free forever.",
      stars: 23055,
      license: "MIT",
      sizeKb: 21909,
      cat: "devtools",
      topic: "code-editor",
      homepage: "https://codeedit.app",
      pushed: 1787088275e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Swift"
    },
    {
      full: "mochajs/mocha",
      desc: "\u2615\uFE0F Classic, reliable, trusted test framework for Node.js and the browser",
      stars: 22890,
      license: "MIT",
      sizeKb: 33184,
      cat: "devtools",
      topic: "testing-tools",
      homepage: "https://mochajs.org",
      pushed: 1790991375e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "vuejs/vuepress",
      desc: "\u{1F4DD} Minimalistic Vue-powered static site generator",
      stars: 22726,
      license: "MIT",
      sizeKb: 14613,
      cat: "frameworks",
      topic: "static-site-generator",
      homepage: "https://vuepress.vuejs.org",
      pushed: 1723025207e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "react-bootstrap/react-bootstrap",
      desc: "Bootstrap components built with React",
      stars: 22601,
      license: "MIT",
      sizeKb: 33776,
      cat: "libraries",
      topic: "react-components",
      homepage: "https://react-bootstrap.github.io/",
      pushed: 1790980485e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "gitui-org/gitui",
      desc: "Blazing \u{1F4A5} fast terminal-ui for git written in rust \u{1F980}",
      stars: 22546,
      license: "MIT",
      sizeKb: 65833,
      cat: "cli",
      topic: "command-line-tool",
      homepage: null,
      pushed: 1785832041e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Rust"
    },
    {
      full: "mkdocs/mkdocs",
      desc: "Project documentation with Markdown.",
      stars: 22489,
      license: "BSD-2-Clause",
      sizeKb: 33238,
      cat: "frameworks",
      topic: "static-site-generator",
      homepage: "https://www.mkdocs.org",
      pushed: 1760966226e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Python"
    },
    {
      full: "dream-num/univer",
      desc: "The Office Harness for AI Agents \u2014 Spreadsheets, Docs, Slides, Canvas, Relational Tables, and PDF in one runtime.",
      stars: 22320,
      license: "Apache-2.0",
      sizeKb: 174804,
      cat: "slides",
      topic: "presentation",
      homepage: "https://docs.univer.ai",
      pushed: 1791014827e3,
      branch: "dev",
      entry: "examples",
      runs: true,
      lang: "TypeScript"
    },
    {
      full: "necolas/react-native-web",
      desc: "Cross-platform React UI packages",
      stars: 22138,
      license: "MIT",
      sizeKb: 95420,
      cat: "libraries",
      topic: "react-components",
      homepage: "https://necolas.github.io/react-native-web",
      pushed: 1790348657e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "nostalgic-css/NES.css",
      desc: "NES-style CSS Framework | \u30D5\u30A1\u30DF\u30B3\u30F3\u98A8CSS\u30D5\u30EC\u30FC\u30E0\u30EF\u30FC\u30AF",
      stars: 21844,
      license: "MIT",
      sizeKb: 4745,
      cat: "frameworks",
      topic: "css-framework",
      homepage: "https://nostalgic-css.github.io/NES.css/",
      pushed: 1705524789e3,
      branch: "develop",
      entry: "docs",
      runs: true,
      lang: "SCSS"
    },
    {
      full: "allinurl/goaccess",
      desc: "GoAccess is a real-time web log analyzer and interactive viewer that runs in a terminal in *nix systems or through your browser.",
      stars: 20992,
      license: "MIT",
      sizeKb: 9807,
      cat: "data",
      topic: "analytics",
      homepage: "https://goaccess.io",
      pushed: 1790859366e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "C"
    },
    {
      full: "gofr-dev/gofr",
      desc: "An opinionated GoLang framework for accelerated microservice development. Built in support for databases and observability.",
      stars: 20874,
      license: "Apache-2.0",
      sizeKb: 30716,
      cat: "frameworks",
      topic: "web-framework",
      homepage: "https://gofr.dev",
      pushed: 1790848649e3,
      branch: "development",
      entry: null,
      runs: false,
      lang: "Go"
    },
    {
      full: "11ty/buildawesome",
      desc: "A simpler site generator. Transforms a directory of templates (of varying types) into HTML.",
      stars: 19945,
      license: "MIT",
      sizeKb: 6782,
      cat: "frameworks",
      topic: "static-site-generator",
      homepage: "https://build.awesome.me/",
      pushed: 1790956651e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "enzymejs/enzyme",
      desc: "JavaScript Testing utilities for React",
      stars: 19813,
      license: "MIT",
      sizeKb: 7893,
      cat: "libraries",
      topic: "react-components",
      homepage: "https://enzymejs.github.io/enzyme/",
      pushed: 176114853e4,
      branch: "master",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "decaporg/decap-cms",
      desc: "A Git-based CMS for Static Site Generators",
      stars: 19407,
      license: "MIT",
      sizeKb: 101008,
      cat: "frameworks",
      topic: "static-site-generator",
      homepage: "https://decapcms.org",
      pushed: 1790965828e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "adonisjs/core",
      desc: "AdonisJS is a TypeScript-first web framework for building web apps and API servers. It comes with support for testing, modern tooling, an ec",
      stars: 19141,
      license: "MIT",
      sizeKb: 6811,
      cat: "frameworks",
      topic: "web-framework",
      homepage: "https://adonisjs.com",
      pushed: 1791003648e3,
      branch: "7.x",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "baidu/amis",
      desc: "\u524D\u7AEF\u4F4E\u4EE3\u7801\u6846\u67B6\uFF0C\u901A\u8FC7 JSON \u914D\u7F6E\u5C31\u80FD\u751F\u6210\u5404\u79CD\u9875\u9762\u3002",
      stars: 18894,
      license: "Apache-2.0",
      sizeKb: 192406,
      cat: "frameworks",
      topic: "frontend-framework",
      homepage: "https://baidu.github.io/amis/",
      pushed: 177384286e4,
      branch: "master",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "tradingview/lightweight-charts",
      desc: "Performant financial charts built with HTML5 canvas",
      stars: 17458,
      license: "Apache-2.0",
      sizeKb: 180549,
      cat: "libraries",
      topic: "charting-library",
      homepage: "https://www.tradingview.com/lightweight-charts/",
      pushed: 1790953641e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "vitest-dev/vitest",
      desc: "Next generation testing framework powered by Vite.",
      stars: 17180,
      license: "MIT",
      sizeKb: 73272,
      cat: "devtools",
      topic: "testing-tools",
      homepage: "https://vitest.dev",
      pushed: 1790957452e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "picocss/pico",
      desc: "Minimal CSS Framework for semantic HTML",
      stars: 16876,
      license: "MIT",
      sizeKb: 10373,
      cat: "frameworks",
      topic: "css-framework",
      homepage: "https://picocss.com",
      pushed: 1778350566e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "CSS"
    },
    {
      full: "tremorlabs/tremor-npm",
      desc: "React components to build charts and dashboards",
      stars: 16486,
      license: "Apache-2.0",
      sizeKb: 11495,
      cat: "libraries",
      topic: "react-components",
      homepage: "https://npm.tremor.so",
      pushed: 173677357e4,
      branch: "main",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "infernojs/inferno",
      desc: ":fire: An extremely fast, React-like JavaScript library for building modern user interfaces",
      stars: 16454,
      license: "MIT",
      sizeKb: 47288,
      cat: "libraries",
      topic: "javascript-library",
      homepage: "https://infernojs.org",
      pushed: 1791016874e3,
      branch: "master",
      entry: "docs",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "ast-grep/ast-grep",
      desc: "\u26A1A CLI tool for code structural search, lint and rewriting. Written in Rust",
      stars: 16108,
      license: "MIT",
      sizeKb: 10324,
      cat: "cli",
      topic: "command-line-tool",
      homepage: "https://ast-grep.github.io/",
      pushed: 1790883107e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Rust"
    },
    {
      full: "mockito/mockito",
      desc: "Most popular Mocking framework for unit tests written in Java",
      stars: 15454,
      license: "MIT",
      sizeKb: 49695,
      cat: "devtools",
      topic: "testing-tools",
      homepage: "http://mockito.org",
      pushed: 1790877778e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Java"
    },
    {
      full: "sqshq/sampler",
      desc: "Tool for shell commands execution, visualization and alerting. Configured with a simple YAML file.",
      stars: 14811,
      license: "GPL-3.0",
      sizeKb: 2230,
      cat: "cli",
      topic: "command-line-tool",
      homepage: "https://sampler.dev",
      pushed: 1708597275e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Go"
    },
    {
      full: "thomaspark/bootswatch",
      desc: "Themes for Bootstrap",
      stars: 14751,
      license: "MIT",
      sizeKb: 93800,
      cat: "frameworks",
      topic: "css-framework",
      homepage: "https://bootswatch.com",
      pushed: 1780709337e3,
      branch: "v5",
      entry: "docs",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "Tonejs/Tone.js",
      desc: "A Web Audio framework for making interactive music in the browser.",
      stars: 14748,
      license: "MIT",
      sizeKb: 25526,
      cat: "music",
      topic: "web-audio",
      homepage: "https://tonejs.github.io",
      pushed: 1790993587e3,
      branch: "dev",
      entry: "examples",
      runs: true,
      lang: "TypeScript"
    },
    {
      full: "maillab/cloud-mail",
      desc: "A Cloudflare-based email service  | \u57FA\u4E8E Cloudflare \u7684\u90AE\u7BB1\u670D\u52A1  | Cloudflare Email \u90AE\u7BB1 Mail",
      stars: 14512,
      license: "MIT",
      sizeKb: 29404,
      cat: "selfhosted",
      topic: "cloudflare-workers",
      homepage: "https://skymail.ink",
      pushed: 1788623644e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "pandao/editor.md",
      desc: "The open source embeddable online markdown editor (component).",
      stars: 14319,
      license: "MIT",
      sizeKb: 16106,
      cat: "tools",
      topic: "markdown-editor",
      homepage: "http://editor.md.ipandao.com/",
      pushed: 1714121755e3,
      branch: "master",
      entry: "docs",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "adobe-webplatform/Snap.svg",
      desc: "The JavaScript library for modern SVG graphics.",
      stars: 14006,
      license: "Apache-2.0",
      sizeKb: 3791,
      cat: "libraries",
      topic: "javascript-library",
      homepage: "http://snapsvg.io",
      pushed: 1781264619e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "shuding/nextra",
      desc: "Simple, powerful and flexible site generation framework with everything you love from Next.js.",
      stars: 13934,
      license: "MIT",
      sizeKb: 40982,
      cat: "frameworks",
      topic: "static-site-generator",
      homepage: "https://nextra.site",
      pushed: 1785530344e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "nextapps-de/flexsearch",
      desc: "Next-generation full-text search library for Browser and Node.js",
      stars: 13803,
      license: "Apache-2.0",
      sizeKb: 7568,
      cat: "libraries",
      topic: "javascript-library",
      homepage: null,
      pushed: 1782669903e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "gabrielecirulli/2048",
      desc: "The source code for 2048",
      stars: 13407,
      license: "MIT",
      sizeKb: 625,
      cat: "games",
      topic: "puzzle-game",
      homepage: "https://play2048.co",
      pushed: 1729775179e3,
      branch: "master",
      entry: "",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "chartist-js/chartist",
      desc: "Simple responsive charts",
      stars: 13389,
      license: "MIT",
      sizeKb: 15552,
      cat: "libraries",
      topic: "charting-library",
      homepage: "https://chartist.dev",
      pushed: 1790833334e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "getpelican/pelican",
      desc: "Static site generator that supports Markdown and reST syntax. Powered by Python.",
      stars: 13345,
      license: "AGPL-3.0",
      sizeKb: 7672,
      cat: "frameworks",
      topic: "static-site-generator",
      homepage: "https://getpelican.com",
      pushed: 177669899e4,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Python"
    },
    {
      full: "Canop/broot",
      desc: "A new way to see and navigate directory trees",
      stars: 13035,
      license: "MIT",
      sizeKb: 20734,
      cat: "cli",
      topic: "command-line-tool",
      homepage: "https://dystroy.org/broot",
      pushed: 1791027946e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Rust"
    },
    {
      full: "catdad/canvas-confetti",
      desc: "\u{1F389} performant confetti animation in the browser",
      stars: 12775,
      license: "ISC",
      sizeKb: 317,
      cat: "visual",
      topic: "particles",
      homepage: "https://catdad.github.io/canvas-confetti/",
      pushed: 1761369441e3,
      branch: "master",
      entry: "",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "casesandberg/react-color",
      desc: ":art: Color Pickers from Sketch, Photoshop, Chrome, Github, Twitter & more",
      stars: 12322,
      license: "MIT",
      sizeKb: 5947,
      cat: "tools",
      topic: "color-picker",
      homepage: "http://casesandberg.github.io/react-color/",
      pushed: 1705101594e3,
      branch: "master",
      entry: "docs",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "alyssaxuu/flowy",
      desc: "The minimal javascript library to create flowcharts \u2728",
      stars: 12139,
      license: "MIT",
      sizeKb: 432,
      cat: "libraries",
      topic: "javascript-library",
      homepage: null,
      pushed: 1720890088e3,
      branch: "master",
      entry: "demo",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "ant-design/ant-design-mobile",
      desc: "Essential UI blocks for building mobile web apps.",
      stars: 12055,
      license: "MIT",
      sizeKb: 170649,
      cat: "libraries",
      topic: "react-components",
      homepage: "https://mobile.ant.design",
      pushed: 1789376779e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "wix/Detox",
      desc: "Gray box end-to-end testing and automation framework for mobile apps",
      stars: 12031,
      license: "MIT",
      sizeKb: 77053,
      cat: "devtools",
      topic: "testing-tools",
      homepage: "https://wix.github.io/Detox/",
      pushed: 1788792519e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "dreamhunter2333/cloudflare_temp_email",
      desc: "CloudFlare free temp domain email \u514D\u8D39\u6536\u53D1 \u4E34\u65F6\u57DF\u540D\u90AE\u7BB1 \u652F\u6301\u9644\u4EF6 IMAP SMTP TelegramBot",
      stars: 11901,
      license: "MIT",
      sizeKb: 12222,
      cat: "selfhosted",
      topic: "cloudflare-workers",
      homepage: "https://mail.awsl.uk",
      pushed: 179089834e4,
      branch: "main",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "wenzhixin/bootstrap-table",
      desc: "An extended table for integration with some of the most widely used CSS frameworks. (Supports Bootstrap, Semantic UI, Bulma, Material Design",
      stars: 11811,
      license: "MIT",
      sizeKb: 51080,
      cat: "frameworks",
      topic: "css-framework",
      homepage: "https://bootstrap-table.com/",
      pushed: 1790985642e3,
      branch: "develop",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "majd/ipatool",
      desc: "Command-line tool that allows you to search for iOS, iPadOS, tvOS, visionOS, and macOS apps on the App Store, and download .ipa or macOS .pk",
      stars: 11470,
      license: "MIT",
      sizeKb: 1539,
      cat: "cli",
      topic: "command-line-tool",
      homepage: null,
      pushed: 1790884635e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Go"
    },
    {
      full: "picturepan2/spectre",
      desc: "Spectre.css - A Lightweight, Responsive and Modern CSS Framework",
      stars: 11310,
      license: "MIT",
      sizeKb: 6514,
      cat: "frameworks",
      topic: "css-framework",
      homepage: "https://picturepan2.github.io/spectre/",
      pushed: 1712852419e3,
      branch: "master",
      entry: "docs",
      runs: true,
      lang: "CSS"
    },
    {
      full: "mui/base-ui",
      desc: "Unstyled UI components for building accessible web apps and design systems. From the creators of Radix, Floating UI, and Material UI.",
      stars: 11062,
      license: "MIT",
      sizeKb: 47339,
      cat: "libraries",
      topic: "react-components",
      homepage: "https://base-ui.com",
      pushed: 1790988471e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "katspaugh/wavesurfer.js",
      desc: "Audio waveform player",
      stars: 10426,
      license: "BSD-3-Clause",
      sizeKb: 51389,
      cat: "music",
      topic: "web-audio",
      homepage: "https://wavesurfer.xyz",
      pushed: 1790929158e3,
      branch: "main",
      entry: "",
      runs: true,
      lang: "TypeScript"
    },
    {
      full: "milligram/milligram",
      desc: "A minimalist CSS framework.",
      stars: 10216,
      license: "MIT",
      sizeKb: 8427,
      cat: "frameworks",
      topic: "css-framework",
      homepage: "https://milligram.io",
      pushed: 1788298119e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "HTML"
    },
    {
      full: "DevExpress/testcafe",
      desc: "A Node.js tool to automate end-to-end web testing.",
      stars: 9899,
      license: "MIT",
      sizeKb: 136971,
      cat: "devtools",
      topic: "testing-tools",
      homepage: "https://testcafe.io",
      pushed: 1789081684e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "crynta/terax-ai",
      desc: "Lightweight (7MB) Terminal-first AI-native dev workspace",
      stars: 9289,
      license: "Apache-2.0",
      sizeKb: 19774,
      cat: "devtools",
      topic: "code-editor",
      homepage: "https://terax.app",
      pushed: 1791029269e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "zizifn/edgetunnel",
      desc: "Running V2ray inside edge/serverless runtime",
      stars: 9213,
      license: "GPL-2.0",
      sizeKb: 9032,
      cat: "selfhosted",
      topic: "cloudflare-workers",
      homepage: null,
      pushed: 1732699563e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "LearningCircuit/local-deep-research",
      desc: "~95% on SimpleQA (e.g. Qwen3.6-27B on a 3090). Supports all local and cloud LLMs (llama.cpp, Ollama, Google, ...). 10+ search engines - arXi",
      stars: 9149,
      license: "MIT",
      sizeKb: 101323,
      cat: "selfhosted",
      topic: "home-automation",
      homepage: null,
      pushed: 1791030521e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Python"
    },
    {
      full: "teslamate-org/teslamate",
      desc: "A self-hosted data logger for your Tesla  \u{1F698} [main maintainer=@JakobLichterfeld]",
      stars: 9069,
      license: "AGPL-3.0",
      sizeKb: 93549,
      cat: "selfhosted",
      topic: "home-automation",
      homepage: "https://docs.teslamate.org",
      pushed: 1791020528e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Elixir"
    },
    {
      full: "webstudio-is/webstudio",
      desc: "Open source website builder and Webflow alternative. Webstudio is an advanced visual builder that connects to any headless CMS, supports all",
      stars: 9020,
      license: "AGPL-3.0",
      sizeKb: 143508,
      cat: "selfhosted",
      topic: "cloudflare-workers",
      homepage: "https://webstudio.is",
      pushed: 1791029719e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "karatelabs/karate",
      desc: "Test Automation Made Simple",
      stars: 8975,
      license: "MIT",
      sizeKb: 38009,
      cat: "devtools",
      topic: "testing-tools",
      homepage: "https://docs.karatelabs.io",
      pushed: 1790955985e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Java"
    },
    {
      full: "CoreBunch/Instatic",
      desc: "The open-source alternative to Webflow, Framer and WordPress. Agentic self-hosted visual CMS outputting clean static pages. Users, roles, pl",
      stars: 8847,
      license: "MIT",
      sizeKb: 194875,
      cat: "frameworks",
      topic: "css-framework",
      homepage: "https://instatic.com",
      pushed: 1789332673e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "uber/react-vis",
      desc: "Data Visualization Components",
      stars: 8786,
      license: "MIT",
      sizeKb: 93663,
      cat: "libraries",
      topic: "charting-library",
      homepage: "https://uber.github.io/react-vis",
      pushed: 1734560674e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "kognise/water.css",
      desc: "A drop-in collection of CSS styles to make simple websites just a little nicer",
      stars: 8652,
      license: "MIT",
      sizeKb: 1879,
      cat: "frameworks",
      topic: "css-framework",
      homepage: "https://watercss.kognise.dev",
      pushed: 170766302e4,
      branch: "master",
      entry: "docs",
      runs: true,
      lang: "CSS"
    },
    {
      full: "panva/jose",
      desc: "JWA, JWS, JWE, JWT, JWK, JWKS for Node.js, Browser, Cloudflare Workers, Deno, Bun, and other Web-interoperable runtimes",
      stars: 7812,
      license: "MIT",
      sizeKb: 16350,
      cat: "selfhosted",
      topic: "cloudflare-workers",
      homepage: null,
      pushed: 1790896267e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "evcc-io/evcc",
      desc: "solar charging \u2600\uFE0F\u{1F698}",
      stars: 7319,
      license: "MIT",
      sizeKb: 83846,
      cat: "selfhosted",
      topic: "home-automation",
      homepage: "https://evcc.io",
      pushed: 1791030539e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Go"
    },
    {
      full: "Acode-Foundation/Acode",
      desc: "Acode - powerful text/code editor for android",
      stars: 7219,
      license: "MIT",
      sizeKb: 66925,
      cat: "devtools",
      topic: "code-editor",
      homepage: "https://acode.app",
      pushed: 1791016134e3,
      branch: "main",
      entry: "www",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "jwilber/roughViz",
      desc: "Reusable JavaScript library for creating sketchy/hand-drawn styled charts in the browser.",
      stars: 7160,
      license: "MIT",
      sizeKb: 3572,
      cat: "libraries",
      topic: "charting-library",
      homepage: "https://www.jwilber.me/roughviz/",
      pushed: 1714132488e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "massCodeIO/massCode",
      desc: "A free, open-source developer workspace. Snippets, notes, HTTP requests, calculations, and dev tools in one local-first app.",
      stars: 7012,
      license: "AGPL-3.0",
      sizeKb: 16648,
      cat: "devtools",
      topic: "api-client",
      homepage: "https://masscode.io",
      pushed: 1790836236e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "sbstjn/timesheet.js",
      desc: "JavaScript library for HTML5 & CSS3 time sheets",
      stars: 6973,
      license: "MIT",
      sizeKb: 445,
      cat: "libraries",
      topic: "charting-library",
      homepage: "https://sbstjn.github.io/timesheet.js",
      pushed: 1527198005e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "reactchartjs/react-chartjs-2",
      desc: "React components for Chart.js, the most popular charting library",
      stars: 6940,
      license: "MIT",
      sizeKb: 6245,
      cat: "libraries",
      topic: "charting-library",
      homepage: "https://react-chartjs-2.js.org",
      pushed: 1790830399e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "josStorer/RWKV-Runner",
      desc: "A RWKV management and startup tool, full automation, only 8MB. And provides an interface compatible with the OpenAI API. RWKV is a large lan",
      stars: 6483,
      license: "MIT",
      sizeKb: 134104,
      cat: "devtools",
      topic: "api-client",
      homepage: "https://www.rwkv.com",
      pushed: 178852903e4,
      branch: "master",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "lite-xl/lite-xl",
      desc: "A lightweight text editor written in Lua",
      stars: 6424,
      license: "MIT",
      sizeKb: 17163,
      cat: "devtools",
      topic: "code-editor",
      homepage: "https://lite-xl.com",
      pushed: 1773248649e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Lua"
    },
    {
      full: "ncase/trust",
      desc: "An interactive guide to the game theory of cooperation",
      stars: 6301,
      license: "CC0-1.0",
      sizeKb: 7406,
      cat: "learning",
      topic: "picked",
      homepage: null,
      pushed: 1766970039e3,
      branch: "gh-pages",
      entry: "",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "jerosoler/Drawflow",
      desc: "Simple flow library \u{1F5A5}\uFE0F\u{1F5B1}\uFE0F",
      stars: 6133,
      license: "MIT",
      sizeKb: 7434,
      cat: "libraries",
      topic: "javascript-library",
      homepage: "https://jerosoler.github.io/Drawflow/",
      pushed: 17293749e5,
      branch: "master",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "jvalen/pixel-art-react",
      desc: "Pixel art animation and drawing web app powered by React",
      stars: 6033,
      license: "MIT",
      sizeKb: 6595,
      cat: "creative",
      topic: "pixel-art",
      homepage: "https://www.pixelartcss.com/",
      pushed: 1770330635e3,
      branch: "master",
      entry: "public",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "prasathmani/tinyfilemanager",
      desc: "Single-file PHP file manager, browser and manage your files efficiently and easily with tinyfilemanager",
      stars: 5978,
      license: "GPL-3.0",
      sizeKb: 7152,
      cat: "devtools",
      topic: "code-editor",
      homepage: "https://tinyfilemanager.github.io",
      pushed: 1784518858e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "PHP"
    },
    {
      full: "oomol-lab/open-connector",
      desc: "Open-source auth gateway connecting 1500+ SaaS providers to AI agents through SDK, CLI, MCP, HTTP, and OpenAPI.",
      stars: 5942,
      license: "Apache-2.0",
      sizeKb: 32426,
      cat: "selfhosted",
      topic: "cloudflare-workers",
      homepage: "https://oomol.com",
      pushed: 1790998283e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "vikiboss/60s",
      desc: "\u23F0 60s API \u514D\u8D39\u63A5\u53E3\u3002\u6BCF\u5929 60 \u79D2\u770B\u4E16\u754C\u3001\u5965\u8FD0\u5956\u724C\u699C\u3001\u5C0F\u7EA2\u4E66/B\u7AD9/\u5FAE\u535A/\u6296\u97F3/\u77E5\u4E4E\u70ED\u641C\u3001\u91D1\u4EF7\u3001\u6CB9\u4EF7\u3001\u5929\u6C14\u3001\u7FFB\u8BD1\u3001\u58C1\u7EB8\u3001Epic \u6E38\u620F\u3001\u4E8C\u7EF4\u7801\u3001\u732B\u773C\u7968\u623F\uFF5C\u4E00\u7CFB\u5217 \u9AD8\u8D28\u91CF\u3001\u5F00\u6E90\u3001\u53EF\u9760\u3001\u5168\u7403 CDN \u52A0\u901F \u7684\u5F00\u653E API \u96C6\u5408\uFF0C\u652F\u6301 Docker / Deno / Bun ",
      stars: 5785,
      license: "MIT",
      sizeKb: 2976,
      cat: "selfhosted",
      topic: "cloudflare-workers",
      homepage: "https://docs.60s-api.viki.moe",
      pushed: 1789004487e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "apertureless/vue-chartjs",
      desc: "\u{1F4CA}  Vue.js wrapper for Chart.js",
      stars: 5718,
      license: "MIT",
      sizeKb: 12899,
      cat: "libraries",
      topic: "charting-library",
      homepage: "https://vue-chartjs.org",
      pushed: 1789487313e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "makenotion/notion-sdk-js",
      desc: "Official Notion JavaScript Client",
      stars: 5669,
      license: "MIT",
      sizeKb: 3191,
      cat: "devtools",
      topic: "api-client",
      homepage: "https://developers.notion.com/",
      pushed: 1790888272e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "hey-api/hey-api",
      desc: "\u{1F468}\u200D\u{1F680} Turn API specifications into production-ready SDKs, validators, mocks, and more. 20+ plugins. Millions of weekly npm downloads. Used b",
      stars: 5467,
      license: "MIT",
      sizeKb: 106607,
      cat: "devtools",
      topic: "api-client",
      homepage: "https://heyapi.dev",
      pushed: 1790795383e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "7Sageer/sublink-worker",
      desc: "One Worker, All Subscriptions",
      stars: 5454,
      license: "MIT",
      sizeKb: 3488,
      cat: "selfhosted",
      topic: "cloudflare-workers",
      homepage: "https://sublink.works/",
      pushed: 1790266196e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "cloudflare/vibesdk",
      desc: "An open-source vibe coding platform that helps you build your own vibe-coding platform, built entirely on Cloudflare stack",
      stars: 5395,
      license: "MIT",
      sizeKb: 7425,
      cat: "selfhosted",
      topic: "cloudflare-workers",
      homepage: "https://build.cloudflare.dev",
      pushed: 1790074148e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "clientIO/joint",
      desc: "A proven SVG-based JavaScript diagramming library powering exceptional UIs",
      stars: 5393,
      license: "MPL-2.0",
      sizeKb: 57342,
      cat: "libraries",
      topic: "javascript-library",
      homepage: "https://jointjs.com",
      pushed: 1790868574e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "williamngan/pts",
      desc: "A library for visualization and creative-coding",
      stars: 5348,
      license: "Apache-2.0",
      sizeKb: 30888,
      cat: "creative",
      topic: "generative-art",
      homepage: "https://ptsjs.org",
      pushed: 179101743e4,
      branch: "master",
      entry: "",
      runs: true,
      lang: "TypeScript"
    },
    {
      full: "RitikPatni/Front-End-Web-Development-Resources",
      desc: "This repository contains content which will be helpful in your journey as a front-end Web Developer",
      stars: 5168,
      license: "MIT",
      sizeKb: 806,
      cat: "frameworks",
      topic: "frontend-framework",
      homepage: null,
      pushed: 1719225516e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: null
    },
    {
      full: "alandefreitas/matplotplusplus",
      desc: "Matplot++: A C++ Graphics Library for Data Visualization \u{1F4CA}\u{1F5FE}",
      stars: 4935,
      license: "MIT",
      sizeKb: 40108,
      cat: "libraries",
      topic: "charting-library",
      homepage: "https://alandefreitas.github.io/matplotplusplus/",
      pushed: 1775138866e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "C++"
    },
    {
      full: "homeassistant-ai/ha-mcp",
      desc: "The Unofficial and Awesome Home Assistant MCP Server",
      stars: 4931,
      license: "MIT",
      sizeKb: 49526,
      cat: "selfhosted",
      topic: "home-automation",
      homepage: "https://homeassistant-ai.github.io/ha-mcp/",
      pushed: 179103036e4,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Python"
    },
    {
      full: "sodiray/radash",
      desc: "Functional utility library - modern, simple, typed, powerful",
      stars: 4835,
      license: "MIT",
      sizeKb: 631,
      cat: "libraries",
      topic: "javascript-library",
      homepage: "https://radash-docs.vercel.app",
      pushed: 1750220549e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "AAChartModel/AAChartKit",
      desc: "\u{1F4C8}\u{1F4CA}\u{1F680}\u{1F680}\u{1F680}An elegant modern declarative data visualization chart framework for iOS, iPadOS and macOS. Extremely powerful, supports line, spl",
      stars: 4765,
      license: "MIT",
      sizeKb: 11754,
      cat: "libraries",
      topic: "charting-library",
      homepage: "https://cocoapods.org/pods/AAChartKit",
      pushed: 1778553069e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Objective-C"
    },
    {
      full: "simonwep/pickr",
      desc: "\u{1F3A8} Pickr - A simple, multi-themed, responsive and hackable Color-Picker library. No dependencies, no jQuery. Compatible with all CSS Framewo",
      stars: 4489,
      license: "MIT",
      sizeKb: 6646,
      cat: "tools",
      topic: "color-picker",
      homepage: "https://simonwep.github.io/pickr",
      pushed: 1788882873e3,
      branch: "master",
      entry: "",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "sadanandpai/javascript-code-challenges",
      desc: "A collection of JavaScript modern interview code challenges for beginners to experts",
      stars: 4463,
      license: "MIT",
      sizeKb: 991,
      cat: "frameworks",
      topic: "frontend-framework",
      homepage: "https://jscodechallenges.vercel.app",
      pushed: 1775024755e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "MDX"
    },
    {
      full: "hustcc/canvas-nest.js",
      desc: ":cancer: Interactive Particle / Nest System With JavaScript and Canvas, no jQuery.",
      stars: 4333,
      license: "MIT",
      sizeKb: 311,
      cat: "visual",
      topic: "particles",
      homepage: "https://git.hust.cc/canvas-nest.js",
      pushed: 1746679549e3,
      branch: "master",
      entry: "",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "microsoft/flint-chart",
      desc: "\u{1FA84} Flint is a visualization language that lets AI agents reliably create expressive, good-looking charts from simple, human-editable chart s",
      stars: 4331,
      license: "MIT",
      sizeKb: 33745,
      cat: "libraries",
      topic: "charting-library",
      homepage: "https://microsoft.github.io/flint-chart/",
      pushed: 1790816391e3,
      branch: "main",
      entry: "site",
      runs: true,
      lang: "TypeScript"
    },
    {
      full: "rytilahti/python-miio",
      desc: "Python library & console tool for controlling Xiaomi smart appliances",
      stars: 4315,
      license: "GPL-3.0",
      sizeKb: 3171,
      cat: "selfhosted",
      topic: "home-automation",
      homepage: "https://python-miio.readthedocs.io",
      pushed: 1784998481e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Python"
    },
    {
      full: "securingsincity/react-ace",
      desc: "React Ace Component",
      stars: 4205,
      license: "MIT",
      sizeKb: 55188,
      cat: "devtools",
      topic: "code-editor",
      homepage: "http://securingsincity.github.io/react-ace/",
      pushed: 1790905988e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "aholachek/react-flip-toolkit",
      desc: "A lightweight magic-move library for configurable layout transitions",
      stars: 4186,
      license: "MIT",
      sizeKb: 169929,
      cat: "libraries",
      topic: "animation-library",
      homepage: null,
      pushed: 1727487288e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "ekzhang/rustpad",
      desc: "Efficient and minimal collaborative code editor, self-hosted, no database required",
      stars: 4077,
      license: "MIT",
      sizeKb: 335,
      cat: "devtools",
      topic: "code-editor",
      homepage: "https://rustpad.io",
      pushed: 1738460669e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Rust"
    },
    {
      full: "seed-rs/seed",
      desc: "A Rust framework for creating web apps",
      stars: 3837,
      license: "MIT",
      sizeKb: 10526,
      cat: "frameworks",
      topic: "frontend-framework",
      homepage: null,
      pushed: 1736588565e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Rust"
    },
    {
      full: "swar/nba_api",
      desc: "An API Client package to access the APIs for NBA.com",
      stars: 3792,
      license: "MIT",
      sizeKb: 6348,
      cat: "devtools",
      topic: "api-client",
      homepage: null,
      pushed: 1786903547e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Python"
    },
    {
      full: "surmon-china/vue-codemirror",
      desc: "@codemirror code editor component for @vuejs",
      stars: 3477,
      license: "MIT",
      sizeKb: 1388,
      cat: "devtools",
      topic: "code-editor",
      homepage: "https://github.surmon.me/vue-codemirror",
      pushed: 1708535552e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "shoheiyokoyama/Gemini",
      desc: "Gemini is rich scroll based animation framework for iOS, written in Swift.",
      stars: 3308,
      license: "MIT",
      sizeKb: 3716,
      cat: "libraries",
      topic: "animation-library",
      homepage: "https://www.youtube.com/watch?v=bPtq5E6lKzw&utm_content=bufferfa3fd&utm_medium=social&utm_source=twitter.com&utm_campaign=buffer",
      pushed: 1751093416e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Swift"
    },
    {
      full: "jogboms/flutter_spinkit",
      desc: "\u2728 A collection of loading indicators animated with flutter. Heavily Inspired by http://tobiasahlin.com/spinkit.",
      stars: 3148,
      license: "MIT",
      sizeKb: 3211,
      cat: "libraries",
      topic: "animation-library",
      homepage: null,
      pushed: 1782101347e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Dart"
    },
    {
      full: "OCNYang/Android-Animation-Set",
      desc: ":books: Android \u6240\u6709\u52A8\u753B\u7CFB\u5217\u8BE6\u5C3D\u6559\u7A0B\u3002          Explain all animations in Android.",
      stars: 3137,
      license: "Apache-2.0",
      sizeKb: 39473,
      cat: "libraries",
      topic: "animation-library",
      homepage: "https://www.jianshu.com/p/0eb89d43eea4",
      pushed: 1676949049e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "Java"
    },
    {
      full: "Sidenai/sidex",
      desc: "VS Code rebuilt on Tauri. Same architecture, 96% smaller. Early release.",
      stars: 3053,
      license: "MIT",
      sizeKb: 22758,
      cat: "devtools",
      topic: "code-editor",
      homepage: "https://discord.gg/8CUCnEAC4J",
      pushed: 1787774299e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "TypeScript"
    },
    {
      full: "mkkellogg/GaussianSplats3D",
      desc: "Three.js-based implementation of 3D Gaussian splatting",
      stars: 2903,
      license: "MIT",
      sizeKb: 3725,
      cat: "visual",
      topic: "three-js",
      homepage: null,
      pushed: 17609147e5,
      branch: "main",
      entry: "demo",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "chinchang/web-maker",
      desc: "A blazing fast & offline frontend code editor",
      stars: 2700,
      license: "MIT",
      sizeKb: 36868,
      cat: "devtools",
      topic: "code-editor",
      homepage: "https://webmaker.app",
      pushed: 1785796108e3,
      branch: "master",
      entry: null,
      runs: false,
      lang: "JavaScript"
    },
    {
      full: "django-commons/django-unicorn",
      desc: "The magical reactive component framework for Django \u2728",
      stars: 2668,
      license: "MIT",
      sizeKb: 8993,
      cat: "frameworks",
      topic: "frontend-framework",
      homepage: "https://www.django-unicorn.com",
      pushed: 1779428438e3,
      branch: "main",
      entry: null,
      runs: false,
      lang: "Python"
    },
    {
      full: "nolangz/pixel2motion",
      desc: "AI logo animation skill: turn raster logos into smooth SVG animation, animated HTML demos, GIF/video previews, and motion QA evidence.",
      stars: 2368,
      license: "MIT",
      sizeKb: 3618,
      cat: "creative",
      topic: "creative-coding",
      homepage: "https://nolangz.github.io/pixel2motion/",
      pushed: 1787314017e3,
      branch: "main",
      entry: "docs",
      runs: true,
      lang: "Python"
    },
    {
      full: "sharkdp/cube-composer",
      desc: "A puzzle game inspired by functional programming",
      stars: 2046,
      license: "MIT",
      sizeKb: 692,
      cat: "games",
      topic: "browser-game",
      homepage: "https://david-peter.de/cube-composer",
      pushed: 167049142e4,
      branch: "master",
      entry: "",
      runs: true,
      lang: "PureScript"
    },
    {
      full: "ncase/loopy",
      desc: "A tool for thinking in systems",
      stars: 1747,
      license: "CC0-1.0",
      sizeKb: 2805,
      cat: "learning",
      topic: "picked",
      homepage: "http://ncase.me/loopy/",
      pushed: 1720428623e3,
      branch: "gh-pages",
      entry: "",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "mumuy/pacman",
      desc: "\u57FA\u4E8EHTML5\u7684\u5403\u8C46\u4EBA\u6E38\u620F - \u7ECF\u5178\u6E38\u620F\u5F00\u53D1\u6837\u4F8B_Pacman based on HTML5",
      stars: 1645,
      license: "MIT",
      sizeKb: 124,
      cat: "games",
      topic: "html5-game",
      homepage: "https://passer-by.com/pacman/",
      pushed: 177815972e4,
      branch: "master",
      entry: "",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "mikebryant/ac-nh-turnip-prices",
      desc: "Price calculator/predictor for Turnip prices",
      stars: 1556,
      license: "Apache-2.0",
      sizeKb: 688,
      cat: "tools",
      topic: "calculator",
      homepage: "https://turnipprophet.io",
      pushed: 1669332423e3,
      branch: "master",
      entry: "",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "bitjson/qr-code",
      desc: "A no-framework, no-dependencies, customizable, animate-able, SVG-based <qr-code> HTML element.",
      stars: 1382,
      license: "MIT",
      sizeKb: 296,
      cat: "tools",
      topic: "qr-code-generator",
      homepage: "https://qr.bitjson.com/",
      pushed: 1677623935e3,
      branch: "master",
      entry: "",
      runs: true,
      lang: "TypeScript"
    },
    {
      full: "rohitg00/k8sgames",
      desc: "Learn Kubernetes by playing. Deploy pods, fix CrashLoopBackOff, type real kubectl commands: 3D browser game, no install needed.",
      stars: 1379,
      license: "Apache-2.0",
      sizeKb: 1433,
      cat: "games",
      topic: "browser-game",
      homepage: "https://k8sgames.com",
      pushed: 1777370023e3,
      branch: "main",
      entry: "",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "ncase/polygons",
      desc: "A playable post on how harmless choices can make a harmful world.",
      stars: 1358,
      license: "CC0-1.0",
      sizeKb: 9875,
      cat: "learning",
      topic: "picked",
      homepage: "http://ncase.me/polygons",
      pushed: 1667835089e3,
      branch: "gh-pages",
      entry: "",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "maximecb/noisecraft",
      desc: "Browser-based visual programming language and platform for sound synthesis.",
      stars: 1225,
      license: "GPL-2.0",
      sizeKb: 986,
      cat: "music",
      topic: "synthesizer",
      homepage: "https://noisecraft.app",
      pushed: 1790168146e3,
      branch: "main",
      entry: "public",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "bbodi/notecalc3",
      desc: "NoteCalc is a handy calculator trying to bring the advantages of Soulver to the web.",
      stars: 1194,
      license: "AGPL-3.0",
      sizeKb: 7678,
      cat: "tools",
      topic: "calculator",
      homepage: "https://bbodi.github.io/notecalc3/",
      pushed: 1773321583e3,
      branch: "develop",
      entry: "",
      runs: true,
      lang: "Rust"
    },
    {
      full: "boona13/mykonos-island-voxels",
      desc: "A browser-based isometric island builder with the soft, sun-bleached look of Mykonos. Vanilla ES modules, no bundler, mobile-friendly.",
      stars: 1058,
      license: "MIT",
      sizeKb: 81388,
      cat: "games",
      topic: "html5-game",
      homepage: "https://mykonos-island-voxels.netlify.app",
      pushed: 177873714e4,
      branch: "main",
      entry: "",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "hvianna/audioMotion-analyzer",
      desc: "High-resolution real-time graphic audio spectrum analyzer JavaScript module with no dependencies.",
      stars: 955,
      license: "AGPL-3.0",
      sizeKb: 70846,
      cat: "music",
      topic: "web-audio",
      homepage: "https://audioMotion.dev",
      pushed: 1784488081e3,
      branch: "master",
      entry: "",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "maoschanz/drawing",
      desc: "Simple image editor for Linux",
      stars: 870,
      license: "GPL-3.0",
      sizeKb: 40415,
      cat: "creative",
      topic: "drawing-app",
      homepage: "https://maoschanz.github.io/drawing/",
      pushed: 1769624959e3,
      branch: "master",
      entry: "docs",
      runs: true,
      lang: "Python"
    },
    {
      full: "hvianna/audioMotion.js",
      desc: "Media player and real-time audio spectrum analyzer written in JavaScript.",
      stars: 641,
      license: "AGPL-3.0",
      sizeKb: 87289,
      cat: "music",
      topic: "web-audio",
      homepage: "https://audiomotion.app/",
      pushed: 1790085865e3,
      branch: "master",
      entry: "docs",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "taniarascia/mvc",
      desc: "A simple MVC application in plain JavaScript.",
      stars: 598,
      license: "MIT",
      sizeKb: 19,
      cat: "productivity",
      topic: "todo-app",
      homepage: "https://taniarascia.github.io/mvc",
      pushed: 1710911903e3,
      branch: "master",
      entry: "",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "stared/interactive-machine-learning-list",
      desc: "A collaborative list of interactive Machine Learning, Deep Learning and Statistics websites",
      stars: 455,
      license: "MIT",
      sizeKb: 4723,
      cat: "learning",
      topic: "explorable-explanations",
      homepage: "https://p.migdal.pl/interactive-machine-learning-list/",
      pushed: 1773583387e3,
      branch: "master",
      entry: "",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "ncase/crowds",
      desc: "The Wisdom and/or Madness of the Crowds",
      stars: 449,
      license: "CC0-1.0",
      sizeKb: 19228,
      cat: "learning",
      topic: "picked",
      homepage: "http://ncase.me/crowds",
      pushed: 1633020406e3,
      branch: "master",
      entry: "",
      runs: true,
      lang: "HTML"
    },
    {
      full: "dmcinnes/HTML5-Asteroids",
      desc: "Pure Javascript Asteroids",
      stars: 355,
      license: "MIT",
      sizeKb: 281,
      cat: "games",
      topic: "html5-game",
      homepage: "http://dougmcinnes.com/2010/05/12/html-5-asteroids/",
      pushed: 1713498218e3,
      branch: "master",
      entry: "",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "gd4Ark/star-battle",
      desc: "\u{1F3AE} A spaceship shooting game developed using JavaScript ES6, Canvas",
      stars: 354,
      license: "MIT",
      sizeKb: 2073,
      cat: "games",
      topic: "javascript-game",
      homepage: "https://4ark.me/star-battle",
      pushed: 1711465365e3,
      branch: "master",
      entry: "",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "ncase/remember",
      desc: "An interactive comic on Spaced Repetition",
      stars: 351,
      license: "CC0-1.0",
      sizeKb: 58656,
      cat: "learning",
      topic: "picked",
      homepage: null,
      pushed: 1661532662e3,
      branch: "gh-pages",
      entry: "",
      runs: true,
      lang: "HTML"
    },
    {
      full: "ncase/fireflies",
      desc: "Fireflies: an example of emergence",
      stars: 345,
      license: "CC0-1.0",
      sizeKb: 2662,
      cat: "learning",
      topic: "picked",
      homepage: null,
      pushed: 1579366402e3,
      branch: "gh-pages",
      entry: "",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "fasiha/ebisu",
      desc: "Public-domain Python library for flashcard quiz scheduling using Bayesian statistics. (JavaScript, Java, Dart, and other ports available!)",
      stars: 338,
      license: "Unlicense",
      sizeKb: 8149,
      cat: "learning",
      topic: "quiz",
      homepage: "https://fasiha.github.io/ebisu",
      pushed: 1727843499e3,
      branch: "gh-pages",
      entry: "",
      runs: true,
      lang: "Python"
    },
    {
      full: "Lallassu/wizardwarz",
      desc: "WebGL Multiplayer game with NodeJS backend",
      stars: 308,
      license: "MIT",
      sizeKb: 32611,
      cat: "games",
      topic: "javascript-game",
      homepage: null,
      pushed: 142858004e4,
      branch: "master",
      entry: "",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "personalizedrefrigerator/js-draw",
      desc: "Draw pictures using a pen, touchscreen, or mouse! JS-draw is a freehand drawing library for JavaScript and TypeScript.",
      stars: 299,
      license: "MIT",
      sizeKb: 10641,
      cat: "creative",
      topic: "drawing-app",
      homepage: "https://personalizedrefrigerator.github.io/js-draw/typedoc/",
      pushed: 1774997367e3,
      branch: "main",
      entry: "docs",
      runs: true,
      lang: "TypeScript"
    },
    {
      full: "henshmi/Classic-Pool-Game",
      desc: "Classic 8 Ball pool game written in JavaScript",
      stars: 292,
      license: "MIT",
      sizeKb: 36320,
      cat: "games",
      topic: "javascript-game",
      homepage: "https://henshmi.github.io/Classic-Pool-Game/",
      pushed: 1581065482e3,
      branch: "master",
      entry: "",
      runs: true,
      lang: "JavaScript"
    },
    {
      full: "alenaksu/json-viewer",
      desc: "Web Component to visualize JSON data in a tree view",
      stars: 242,
      license: "MIT",
      sizeKb: 1375,
      cat: "tools",
      topic: "json-viewer",
      homepage: "https://alenaksu.github.io/json-viewer/",
      pushed: 1743691721e3,
      branch: "master",
      entry: "docs",
      runs: true,
      lang: "TypeScript"
    },
    {
      full: "henni99/WriteBuddy",
      desc: "\u{1F4DD} Write smarter, smoother: A Compose-based handwriting assistant \u270D\uFE0F",
      stars: 235,
      license: "Apache-2.0",
      sizeKb: 961,
      cat: "creative",
      topic: "drawing-app",
      homepage: "https://henni99.github.io/WriteBuddy/",
      pushed: 1745325762e3,
      branch: "main",
      entry: "docs",
      runs: true,
      lang: "Kotlin"
    },
    {
      full: "ncase/ballot",
      desc: "An interactive guide to alternative voting systems",
      stars: 222,
      license: "CC0-1.0",
      sizeKb: 1179,
      cat: "learning",
      topic: "picked",
      homepage: null,
      pushed: 1729644015e3,
      branch: "gh-pages",
      entry: "",
      runs: true,
      lang: "HTML"
    },
    {
      full: "sundegan/JsonStudio",
      desc: "A fast, modern desktop JSON app built for daily development. The all-in-one workspace for every JSON task, designed to redefine your workflo",
      stars: 192,
      license: "Apache-2.0",
      sizeKb: 43535,
      cat: "tools",
      topic: "json-viewer",
      homepage: "https://jsonstudio.js.org/",
      pushed: 1791016275e3,
      branch: "main",
      entry: "docs",
      runs: true,
      lang: "JavaScript"
    }
  ]
};

// ../src/catalog.ts
var ITEMS = catalog_default.projects;
var runsHere = /* @__PURE__ */ __name((x) => x.runs ?? x.entry !== null, "runsHere");
var CATS = [
  ["ai", "AI"],
  ["frameworks", "Frameworks"],
  ["libraries", "Libraries"],
  ["devtools", "Dev tools"],
  ["cli", "CLI"],
  ["data", "Data"],
  ["selfhosted", "Self-hosted"],
  ["games", "Games"],
  ["creative", "Creative"],
  ["music", "Music"],
  ["productivity", "Productivity"],
  ["tools", "Tools"],
  ["learning", "Learning"],
  ["slides", "Slides"],
  ["visual", "Visual"]
];
var PLAY = `<svg class="ic" viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M4.5 2.8v10.4L13 8z"/></svg>`;
var RUNS = `<span class="runs">${PLAY}Runs here</span>`;
var CAT_LABEL = Object.fromEntries(CATS);
var STAR = `<svg class="ic" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="m8 1.8 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/></svg>`;
var k = /* @__PURE__ */ __name((n) => n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "")}k` : String(n), "k");
var avatar = /* @__PURE__ */ __name((owner, size = 44) => `<img class="gav" src="https://github.com/${esc4(owner)}.png?size=${size * 2}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async">`, "avatar");
var ghPath = /* @__PURE__ */ __name((full) => `/gh/${full}`, "ghPath");
var CATALOG_CSS = `
.gav{flex:none;border-radius:8px;background:var(--card);border:1px solid var(--line);object-fit:cover}
.intro3{font-size:15px;color:var(--dim);margin:0 0 12px}
.onforq{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;color:var(--acc)}
.gh-head{display:flex;gap:14px;align-items:center;margin:4px 0 12px}
.gh-head h1{font-size:20px;line-height:1.25;margin:0;font-weight:600;overflow-wrap:anywhere}
.gh-head h1 .o{color:var(--dim);font-weight:400}
.gh-desc{font-size:16px;margin:0 0 10px}
.gh-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;font-size:13px;color:var(--dim);margin:0 0 16px;font-variant-numeric:tabular-nums}
.gh-meta .st{display:inline-flex;align-items:center;gap:4px;color:var(--fg);font-weight:500}
.gh-acts{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 8px}
.gh-acts .btn{flex:1 1 100%}
.gh-note{font-size:13px;color:var(--dim);margin:0 0 20px}
.skel{display:flex;flex-direction:column;gap:10px;margin-top:8px}
.skel i{display:block;height:14px;border-radius:4px;background:var(--card)}
.skel i:nth-child(1){width:60%;height:20px}.skel i:nth-child(3){width:85%}.skel i:nth-child(5){width:70%}
.pp .gav{width:44px;height:44px}
.pp .tx span a{color:var(--dim)}
.pst{display:inline-flex;align-items:center;gap:4px;font-size:13px;font-weight:500;font-variant-numeric:tabular-nums}
.runs{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;color:var(--acc);border:1px solid color-mix(in srgb,var(--acc) 45%,transparent);border-radius:4px;padding:0 6px;line-height:18px}
.plist[data-list=gh] .upd{display:none}
.plist.by-upd .upd{display:inline}
.back3{display:inline-flex;align-items:center;min-height:44px;font-size:15px}
@media (min-width:600px){.gh-acts .btn{flex:0 0 auto}}
`;
function importedMap(entries) {
  const m = /* @__PURE__ */ new Map();
  for (const e of entries) if (e.importedFrom && !e.forkedFrom) {
    const key = e.importedFrom.fullName.toLowerCase();
    if (!m.has(key) || e.owner === "forq") m.set(key, e);
  }
  return m;
}
__name(importedMap, "importedMap");
function catalogBody(entries, opts) {
  const now = Date.now();
  const onForq = importedMap(entries);
  const cat = opts.cat === "forq" || opts.cat === "runs" || opts.cat && CAT_LABEL[opts.cat] ? opts.cat : "";
  const sort = opts.sort === "updated" ? "updated" : "top";
  const q = /* @__PURE__ */ __name((c, so) => `/explore?${[c ? `cat=${c}` : "", so === "updated" ? "sort=updated" : ""].filter(Boolean).join("&")}`.replace(/\?$/, ""), "q");
  const native = entries.filter((e) => !e.forkedFrom && e.slug !== "forq.blank");
  const count = /* @__PURE__ */ __name((c) => ITEMS.filter((x) => x.cat === c).length, "count");
  const chip = /* @__PURE__ */ __name((c, l, n) => `<a href="${q(c, sort)}" data-cat="${c}" class="${cat === c ? "on" : ""}">${l}<span>${n}</span></a>`, "chip");
  const cats = `<nav class="cats" aria-label="Categories">${chip("", "All", ITEMS.length)}${chip("runs", "Runs here", ITEMS.filter(runsHere).length)}${CATS.filter(([c]) => count(c)).map(([c, l]) => chip(c, l, count(c))).join("")}${chip("forq", "On qodebase", native.length)}</nav>`;
  const sorts = `<nav class="sorts" aria-label="Sort"${cat === "forq" ? " hidden" : ""}><a href="${q(cat, "top")}" data-sort="top" class="${sort === "top" ? "on" : ""}">Top</a><a href="${q(cat, "updated")}" data-sort="updated" class="${sort === "updated" ? "on" : ""}">Recently updated</a>
<span class="why">${sort === "top" ? "most GitHub stars" : "latest commit first"}</span></nav>`;
  const shown = /* @__PURE__ */ __name((x) => !cat || (cat === "runs" ? runsHere(x) : x.cat === cat), "shown");
  const ordered = [...ITEMS].sort((a, b) => sort === "top" ? b.stars - a.stars : b.pushed - a.pushed);
  const rows = ordered.map((x) => {
    const [owner, name] = x.full.split("/");
    const there = onForq.get(x.full.toLowerCase());
    return `<a class="pr" href="${ghPath(x.full)}" data-cat="${esc4(x.cat)}"${runsHere(x) ? " data-runs" : ""} data-stars="${x.stars}" data-pushed="${x.pushed}"${shown(x) && cat !== "forq" ? "" : " hidden"}>${avatar(owner)}<span class="bd">
<span class="n"><span class="o">${esc4(owner)} /</span> ${esc4(name)}</span><span class="d">${esc4(x.desc)}</span>
<span class="m"><span class="st">${STAR}${k(x.stars)}</span><span class="upd">${freshTag(x.pushed, now, [365 * 24, 90 * 24, 30 * 24, 7 * 24])}</span>${runsHere(x) ? RUNS : ""}<span class="tg">${esc4(CAT_LABEL[x.cat] || x.cat)}</span><span>${esc4(x.license)}</span>${there ? '<span class="onforq">On qodebase</span>' : ""}</span></span></a>`;
  }).join("");
  const forqRows = native.sort((a, b) => b.updatedAt - a.updatedAt).map((e) => `<a class="pr" href="${path(e.slug)}">${avatar(e.importedFrom ? e.importedFrom.fullName.split("/")[0] : e.owner)}<span class="bd">
<span class="n"><span class="o">${esc4(e.owner)} /</span> ${esc4(e.name)}</span><span class="d">${esc4(e.description || "")}</span>
<span class="m">${e.importedFrom ? `<span class="st">${STAR}${k(e.importedFrom.stars)}</span>` : ""}${freshTag(e.updatedAt, now, STEPS)}</span></span></a>`).join("") || '<p class="empty">Nothing imported yet.</p>';
  return `${cats}${sorts}<div class="plist${sort === "updated" ? " by-upd" : ""}" data-list="gh"${cat === "forq" ? " hidden" : ""}>${rows}</div><div class="plist" data-list="forq"${cat === "forq" ? "" : " hidden"}>${forqRows}</div>`;
}
__name(catalogBody, "catalogBody");
function peopleBody(entries) {
  const by = /* @__PURE__ */ new Map();
  for (const x of ITEMS) {
    const o = x.full.split("/")[0];
    by.set(o, [...by.get(o) || [], x]);
  }
  const owners = [...by.entries()].map(([o, list]) => ({ o, list: list.sort((a, b) => b.stars - a.stars), stars: list.reduce((n, x) => n + x.stars, 0) })).sort((a, b) => b.stars - a.stars);
  entries = entries.filter((e) => e.slug !== "forq.blank");
  const onForq = [...new Set(entries.map((e) => e.owner))].map((h) => ({ h, n: entries.filter((e) => e.owner === h).length })).sort((a, b) => b.n - a.n);
  return `<div class="people">${owners.map((p) => `<div class="pp">${avatar(p.o)}<div class="tx"><b><a href="https://github.com/${esc4(p.o)}" target="_blank" rel="noopener" style="color:inherit">${esc4(p.o)}</a></b>
<span>${p.list.map((x) => `<a href="${ghPath(x.full)}">${esc4(x.full.split("/")[1])}</a>`).join(", ")}</span></div><span class="pst">${STAR}${k(p.stars)}</span></div>`).join("")}</div>
${onForq.length ? `<p class="sec2">On this qodebase</p><div class="people">${onForq.map((p) => `<div class="pp">${avatar(p.h)}<div class="tx"><b>${esc4(p.h)}</b><span>${p.n} project${p.n === 1 ? "" : "s"}</span></div></div>`).join("")}</div>` : ""}`;
}
__name(peopleBody, "peopleBody");
function catalogPage(full, entries, me) {
  const x = ITEMS.find((i) => i.full.toLowerCase() === full.toLowerCase());
  if (!x) return null;
  const now = Date.now();
  const [owner, name] = x.full.split("/");
  const there = importedMap(entries).get(x.full.toLowerCase());
  const action = there ? `<a class="btn" href="${path(there.slug)}">Open on qodebase</a>` : me ? `<button class="btn" id="imp" data-repo="${esc4(x.full)}">Import into qodebase</button>` : `<a class="btn" href="/login?next=${encodeURIComponent(ghPath(x.full))}">Sign in to import</a>`;
  const body = `<a class="back3" href="/">Projects</a>
<div class="gh-head">${avatar(owner, 56)}<h1><span class="o">${esc4(owner)} /</span> ${esc4(name)}</h1></div>
<p class="gh-desc">${esc4(x.desc)}</p>
<div class="gh-meta">${runsHere(x) ? RUNS : ""}<span class="st">${STAR}${k(x.stars)} stars</span><span>${esc4(x.license)}</span>${x.lang ? `<span>${esc4(x.lang)}</span>` : ""}<span class="tg">${esc4(CAT_LABEL[x.cat] || x.cat)}</span><span>updated ${freshTag(x.pushed, now, [365 * 24, 90 * 24, 30 * 24, 7 * 24])}</span></div>
<div class="gh-acts">${action}<a class="chipbtn" href="https://github.com/${esc4(x.full)}" target="_blank" rel="noopener">GitHub</a>${x.homepage ? `<a class="chipbtn" href="${esc4(x.homepage)}" target="_blank" rel="noopener">Live demo</a>` : ""}</div>
<p class="gh-note">${there ? `Already imported as ${esc4(there.owner)} / ${esc4(there.name)}: open it to run it, fork it and change it with agents.` : runsHere(x) ? "Runs here: importing copies its latest commit into qodebase and opens it as a live app on its own address, ready to fork and change with agents." : "Importing copies its latest commit into qodebase: read and search the code, fork it, and change it with agents. It has no page qodebase can open as an app."}</p>
<h3>README</h3><div class="readme" id="readme"><div class="skel" aria-label="Loading the README"><i></i><i></i><i></i><i></i><i></i></div></div>
<script>
fetch(location.pathname.replace(/\\/$/,'')+'/readme').then((r)=>r.ok?r.text():Promise.reject()).then((h)=>{document.getElementById('readme').innerHTML=h;})
 .catch(()=>{document.getElementById('readme').innerHTML='<p class="empty">The README could not be loaded. <a href="https://github.com/${esc4(x.full)}" rel="noopener">Read it on GitHub</a>.</p>';});
const b=document.getElementById('imp');if(b)b.onclick=async()=>{b.disabled=true;b.textContent='Importing';
 const r=await fetch('/api/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({repo:b.dataset.repo})});
 const j=await r.json().catch(()=>({}));if(r.ok)location.href=j.path;else{b.disabled=false;b.textContent=j.error||'Import failed';}};
<\/script>`;
  return { title: `${owner}/${name}`, body };
}
__name(catalogPage, "catalogPage");
async function catalogReadme(full, ctx) {
  const x = ITEMS.find((i) => i.full.toLowerCase() === full.toLowerCase());
  if (!x) return null;
  const key = new Request(`https://forq-readme-cache.internal/v2/${x.full}`);
  const hit = await caches.default.match(key);
  if (hit) return hit.text();
  let text = null;
  for (const f of ["README.md", "readme.md", "Readme.md", "README.markdown", "README"]) {
    const r = await fetch(`https://raw.githubusercontent.com/${x.full}/${x.branch}/${f}`, { headers: { "user-agent": "forq" } });
    if (r.ok) {
      text = await r.text();
      break;
    }
  }
  if (text == null) return null;
  const html4 = markdown(text.slice(0, 2e5));
  ctx.waitUntil(caches.default.put(key, new Response(html4, { headers: { "cache-control": "max-age=86400", "content-type": "text/html" } })));
  return html4;
}
__name(catalogReadme, "catalogReadme");

// ../src/newproject.ts
var STARTER = "forq.blank";
var buildPayload = /* @__PURE__ */ __name((prompt, empty = false) => (empty ? `This is a brand-new, EMPTY project (no commits yet). First write a placeholder index.html and a README.md, commit them and push to main (git push origin HEAD:main), so the project runs and agents can fork it. Then build it. The person wants:

${prompt}

` : `This is a brand-new project: it only has a placeholder index.html and README.md. The person wants:

${prompt}

`) + `Build what they asked for: any kind of code (an app, a site, a tool, a library, a Worker). If people will use it in a browser, prefer plain static files (index.html at the root, no build step) so it runs here at once; if it is a library, a CLI or other code, write it as that, with a README showing how to use it and the placeholder page replaced by a short page about it. Replace the README either way. Split the work into a few tasks and start one agent per task.`, "buildPayload");
var EXAMPLES = ["A shared shopping list for my family", "A pomodoro timer with a daily streak", "A quiz game for my class", "A page that splits a restaurant bill", "A habit tracker with three habits", "A recipe box that scales servings"];
var BUILD_CSS = `
.bld{max-width:640px;margin:0 auto}
.bld h1{font-size:24px;line-height:1.2;font-weight:600;margin:4px 0 6px}
.bld .lede{margin:0 0 16px}
.bld textarea{width:100%;min-height:120px;font:17px/1.45 'Instrument Sans',sans-serif;padding:14px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--fg);resize:vertical}
.bld .row{display:flex;gap:8px;margin-top:10px}
.bld .row .btn{flex:1}
.bld .mic{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:52px}
.bld .mic.on{background:var(--warn);color:#fff}
.bld .mic svg{width:20px;height:20px}
.bld .ex{display:flex;flex-wrap:wrap;gap:6px;margin:18px 0 0}
.bld .ex button{min-height:36px;padding:0 12px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font:500 14px 'Instrument Sans',sans-serif;cursor:pointer}
.bld .exl{font-size:13px;color:var(--dim);margin:18px 0 0}
.brief{background:var(--card);border-radius:12px;padding:14px;margin:4px 0 14px}
.brief label{display:block;font-size:13px;color:var(--dim);margin:0 0 4px}
.brief input{width:100%;font:500 16px 'JetBrains Mono',monospace;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg)}
.brief textarea{min-height:90px;background:var(--bg);font-size:16px}
.brief .fld+.fld{margin-top:12px}
.brief .url{font-size:13px;color:var(--dim);margin:4px 0 0;overflow-wrap:anywhere}
.steps3{margin:0 0 16px;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px}
.steps3 li{display:flex;gap:10px;font-size:15px}
.steps3 li b{flex:none;width:22px;height:22px;border-radius:50%;background:var(--chip);display:flex;align-items:center;justify-content:center;font-size:12px}
.bld .err{color:var(--warn);font-size:14px;min-height:1.4em;margin:8px 0 0}
.vis{border:0;padding:0;margin:12px 0 0}.vis legend{font-size:14px;font-weight:500;margin-bottom:6px}
.vis label{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--line);border-radius:8px;margin-top:8px;cursor:pointer}
.vis label:has(input:checked){border-color:var(--acc)}.vis input{margin-top:3px;accent-color:var(--acc)}
.vis span{display:flex;flex-direction:column;font-size:14px;color:var(--dim)}.vis b{color:var(--fg);font-size:15px;font-weight:500}
.bld .back4{background:none;border:0;color:var(--acc);font:500 15px 'Instrument Sans',sans-serif;padding:10px 0;cursor:pointer}
`;
var MIC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>`;
var esc6 = /* @__PURE__ */ __name((s) => String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]), "esc");
function buildBody(me, needsKey, runDomain) {
  return `<div class="bld">
<section id="s1"><h1>What do you want to build?</h1>
<p class="lede">Say it in a sentence: an app, a site, a tool, a library. Agents write it, and you keep changing it in plain words. Anything that opens in a browser gets its own address.</p>
<textarea id="idea" placeholder="A shared shopping list for my family\u2026" enterkeyhint="next" aria-label="What do you want to build?"></textarea>
<div class="row"><button type="button" class="chipbtn mic" id="mic" hidden aria-label="Speak instead of typing">${MIC}<span>Speak</span></button><button type="button" class="btn" id="next">Next</button></div>
<p class="exl">Or start from one of these</p><div class="ex">${EXAMPLES.map((e) => `<button type="button" data-ex="${esc6(e)}">${esc6(e)}</button>`).join("")}</div>
<p class="exl imp">Already have code? <a href="/import">Import a GitHub repo</a></p></section>
<section id="s2" hidden><button type="button" class="back4" id="back">Change the idea</button>
<h1>Here's what qodebase will build</h1>
<div class="brief"><div class="fld"><label for="pname">Project name</label><input id="pname" autocapitalize="none" autocomplete="off" spellcheck="false" maxlength="39">
<p class="url">It will live at <b id="purl"></b></p></div>
<div class="fld"><label for="pidea">What you asked for</label><textarea id="pidea"></textarea></div>
<fieldset class="fld vis"><legend>Who can see it</legend>
<label><input type="radio" name="vis" value="public" checked><span><b>Public</b>Anyone can see it, try it and fork it</span></label>
<label><input type="radio" name="vis" value="private"><span><b>Private</b>Only you: the project, its code and its app</span></label></fieldset></div>
<ol class="steps3"><li><b>1</b>A new project is created${me ? ` under ${esc6(me)}` : ""}, with its own code and history.</li>
<li><b>2</b>Its router agent plans the work and starts an agent for each part.</li>
<li><b>3</b>A reviewer agent checks every change in a preview before it goes live.</li>
<li><b>4</b>You watch it happen, try the result, and ask for more changes any time.</li></ol>
${needsKey ? `<p class="lede">Agents run on your own Anthropic API key. <a href="/settings">Add it in Settings</a> first; your idea stays here.</p>` : ""}
<button class="btn" id="go" style="width:100%"${needsKey ? " disabled" : ""}>${me ? "Start building" : "Sign in to start building"}</button>
<p class="err" id="err" role="status"></p></section></div>
<script>
(function(){
 const KEY='forq.buildDraft',DOM=${JSON.stringify(runDomain)},ME=${JSON.stringify(me)};
 const $=(id)=>document.getElementById(id),idea=$('idea'),pname=$('pname'),pidea=$('pidea');
 const STOP=new Set('a an the for my our your with that which to of and in on at by from app web page website site tool simple small little i we me want need make build create please some lets let us like who what where when'.split(' '));
 const suggest=(t)=>(t.toLowerCase().replace(/[^a-z0-9 ]+/g,' ').split(/\\s+/).filter((w)=>w&&!STOP.has(w)).slice(0,3).join('-')||'my-app').slice(0,39);
 const clean=(n)=>n.toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/-{2,}/g,'-').replace(/^-+|-+$/g,'').slice(0,39);
 const url=()=>{$('purl').textContent=(clean(pname.value)||'my-app')+'--'+(ME||'you')+'.'+DOM;};
 const save=()=>{try{localStorage.setItem(KEY,JSON.stringify({idea:pidea.value||idea.value,name:pname.value}))}catch{}};
 function brief(){const t=idea.value.trim();if(!t){idea.focus();return;}
  pidea.value=t;if(!pname.dataset.touched)pname.value=suggest(t);url();$('s1').hidden=true;$('s2').hidden=false;scrollTo(0,0);save();
  history.replaceState(null,'','/build?step=brief');}
 $('next').onclick=brief;
 idea.addEventListener('keydown',(e)=>{if(e.key==='Enter'&&!e.shiftKey&&matchMedia('(hover:hover)').matches){e.preventDefault();brief();}});
 for(const b of document.querySelectorAll('[data-ex]'))b.onclick=()=>{idea.value=b.dataset.ex;brief();};
 $('back').onclick=()=>{idea.value=pidea.value;$('s2').hidden=true;$('s1').hidden=false;history.replaceState(null,'','/build');idea.focus();};
 pname.addEventListener('input',()=>{pname.dataset.touched=1;url();save();});pidea.addEventListener('input',save);
 // Speak: the browser's own speech recognition (Chrome on Android and desktop); hidden where there is none.
 const SR=window.SpeechRecognition||window.webkitSpeechRecognition,mic=$('mic');
 if(SR){mic.hidden=false;let rec=null,base='';
  mic.onclick=()=>{if(rec){rec.stop();return;}
   rec=new SR();rec.interimResults=true;rec.continuous=false;rec.lang=navigator.language||'en-US';base=idea.value?idea.value.trim()+' ':'';
   rec.onresult=(e)=>{let t='';for(const r of e.results)t+=r[0].transcript;idea.value=base+t;};
   rec.onend=()=>{rec=null;mic.classList.remove('on');mic.querySelector('span').textContent='Speak';};
   rec.onerror=()=>{};rec.start();mic.classList.add('on');mic.querySelector('span').textContent='Listening';};}
 // From the home page's box (/build?idea=\u2026): straight to the brief.
 const fromHome=new URLSearchParams(location.search).get('idea');
 if(fromHome){idea.value=fromHome;pname.dataset.touched='';brief();}
 // Back from sign-in (or a reload): the brief, filled in.
 try{const d=JSON.parse(localStorage.getItem(KEY)||'null');if(d&&d.idea&&new URLSearchParams(location.search).get('step')==='brief'){idea.value=d.idea;if(d.name){pname.value=d.name;pname.dataset.touched=1;}brief();}}catch{}
 $('go').onclick=async()=>{const name=clean(pname.value),prompt=pidea.value.trim(),err=$('err');
  if(!name){err.textContent='Give the project a name.';return;}if(!prompt){err.textContent='Say what to build.';return;}
  save();if(!ME){location.href='/login?next='+encodeURIComponent('/build?step=brief');return;}
  const b=$('go');b.disabled=true;b.textContent='Creating the project';err.textContent='';
  const r=await fetch('/api/build',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,prompt,private:(document.querySelector('input[name=vis]:checked')||{}).value==='private'})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok){b.disabled=false;b.textContent='Start building';err.textContent=j.error||'Could not start';return;}
  try{localStorage.removeItem(KEY)}catch{}location.href=j.path;};
})();
<\/script>`;
}
__name(buildBody, "buildBody");

// ../src/world.ts
var WORLD_CSS = `
.sample{display:flex;gap:8px;align-items:center;margin:0 0 8px;padding:6px 10px;border:1px dashed var(--line);border-radius:8px;font-size:13px;color:var(--dim)}
.pulse{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 0 16px}
.pulse div{background:var(--card);border-radius:12px;padding:8px 12px}
.pulse b{display:block;font-size:20px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.2}
.pulse span{font-size:13px;color:var(--dim);white-space:nowrap}
.pulse .live b{display:flex;align-items:center;gap:6px}
.pulse .live b::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--busy);animation:pulse 1.6s ease-in-out infinite}
.lede2{font-size:17px;line-height:1.35;margin:0 0 12px;font-weight:500}
.sub3{position:sticky;top:0;z-index:5;display:flex;gap:4px;margin:0 -16px 12px;padding:6px 16px;background:var(--bg);border-bottom:1px solid var(--line)}
.sub3 a{flex:1;text-align:center;min-height:36px;display:flex;align-items:center;justify-content:center;border-radius:8px;color:var(--dim);font:500 14px 'Instrument Sans',sans-serif}
.sub3 a.on{background:var(--chip);color:var(--fg)}
.feed{display:flex;flex-direction:column}
.ev{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}
.av{flex:none;width:36px;height:36px;border-radius:50%;background:var(--chip);color:var(--fg);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:15px}
.ev .tx{flex:1;min-width:0;font-size:15px;line-height:1.4}
.ev .tx b{font-weight:600}
.ev .what{display:block;margin-top:4px;padding:8px 10px;background:var(--card);border-radius:8px;font-size:14px}
.ev .what.k-x{border-left:3px solid var(--warn)}
.ev .what.k-m{border-left:3px solid var(--acc)}
.ev .what.k-a{border-left:3px solid var(--busy)}
.ev .meta2{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:13px;color:var(--dim)}
.sec2{font-size:13px;font-weight:600;color:var(--dim);margin:20px 0 8px}
.sec2:first-child{margin-top:4px}
.cards2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.pc{position:relative;display:flex;flex-direction:column;gap:6px;background:var(--card);border-radius:12px;padding:12px;color:inherit;min-height:132px}
.pc .tile{width:40px;height:40px;border-radius:8px;background:var(--bg);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-weight:600}
.pc .n{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pc .o{color:var(--dim);font-weight:400}
.pc .d{font-size:13px;color:var(--dim);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pc .s{margin-top:auto;display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dim)}
.pc .s.busy{color:var(--fg)}
.pc .s.busy .dot{background:var(--busy);animation:pulse 1.6s ease-in-out infinite}
.cats{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:0 -16px 8px;padding:0 16px}
.cats::-webkit-scrollbar{display:none}
.cats a{flex:none;display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 12px;border-radius:8px;border:1px solid var(--line);color:var(--fg);font:500 14px 'Instrument Sans',sans-serif}
.cats a span{color:var(--dim);font-variant-numeric:tabular-nums}
.cats a.on{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.cats a.on span{color:color-mix(in srgb,var(--bg) 70%,var(--fg))}
.sorts{display:flex;align-items:center;gap:16px;margin:4px 0 4px;font-size:14px}
.sorts a{color:var(--dim);font-weight:500;padding:8px 0;border-bottom:2px solid transparent}
.sorts a.on{color:var(--fg);border-bottom-color:var(--fg)}
.sorts .why{margin-left:auto;font-size:12px;color:var(--dim)}
.plist{display:flex;flex-direction:column}
.pr{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--line);color:inherit}
.pr .tile{flex:none;width:44px;height:44px;border-radius:8px;background:var(--card);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:17px}
.pr .bd{flex:1;min-width:0}
.pr .n{display:block;font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pr .n .o{color:var(--dim);font-weight:400}
.pr .d{display:block;font-size:14px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px}
.pr .m{display:flex;align-items:center;flex-wrap:wrap;gap:4px 12px;margin-top:6px;font-size:13px;color:var(--dim);font-variant-numeric:tabular-nums}
.pr .m .st{display:inline-flex;align-items:center;gap:4px;color:var(--fg);font-weight:500}
.pr .m .up{color:var(--acc);font-weight:500}
.pr .m .f{display:inline-flex;align-items:center;gap:4px}
.pr .m .w{display:inline-flex;align-items:center;gap:6px;color:var(--fg)}
.pr .m .w .dot{background:var(--busy);animation:pulse 1.6s ease-in-out infinite}
.pr .tg{display:inline-block;font-size:12px;color:var(--dim);background:var(--chip);border-radius:4px;padding:1px 6px}
.ic{flex:none}
.people{display:flex;flex-direction:column}
.pp{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}
.pp .av{width:44px;height:44px;font-size:17px}
.pp .tx{flex:1;min-width:0}
.pp b{display:block;font-weight:600}
.pp .tx span{font-size:13px;color:var(--dim)}
@media (min-width:700px){.cards2{grid-template-columns:repeat(3,1fr)}}
@media (hover:hover){.pc:hover{background:var(--chip)}}
`;
function worldBody(tab, real, signedIn, opts = {}) {
  real = real.filter((e) => !e.private);
  const sub = /* @__PURE__ */ __name((id, labelT) => `<a href="/${id === "projects" ? "" : `?s=${id}`}" data-tab="${id}" class="${tab === id ? "on" : ""}"${tab === id ? ' aria-current="page"' : ""}>${labelT}</a>`, "sub");
  const head3 = `<nav class="sub3" aria-label="Home">${sub("projects", "Projects")}${sub("people", "People")}</nav>`;
  const body = `<section data-panel="projects"${tab === "projects" ? "" : " hidden"}>${catalogBody(real, { cat: opts.tag, sort: opts.sort })}</section>
<section data-panel="people"${tab === "people" ? "" : " hidden"}>${peopleBody(real)}</section>`;
  return `${head3}${body}${signedIn ? "" : '<p class="empty" style="margin-top:20px"><a href="/login">Sign in</a> to import projects, fork them and run agents with your own Anthropic API key.</p>'}
<script>${HOME_JS}<\/script>${SPECULATE}`;
}
__name(worldBody, "worldBody");
var SPECULATE = `<script type="speculationrules">${JSON.stringify({
  prerender: [{ where: { and: [{ href_matches: "/*" }, { not: { href_matches: ["/api/*", "/login*", "/logout*", "/a/*", "/feedback*", "/e*"] } }] }, eagerness: "moderate" }]
})}<\/script>`;
var HOME_JS = String.raw`(function(){
 const list=document.querySelector('.plist[data-list=gh]'),forq=document.querySelector('.plist[data-list=forq]'),sorts=document.querySelector('.sorts'),view=document.getElementById('view');
 if(!list)return;
 const rows=[...list.children];
 const read=()=>{const u=new URLSearchParams(location.search);return{s:u.get('s')==='people'?'people':'projects',cat:u.get('cat')||u.get('tag')||'',sort:u.get('sort')==='updated'?'updated':'top'};};
 let st=read(),last={cat:st.cat,sort:st.sort};
 const url=()=>st.s==='people'?'/explore?s=people':'/explore'+(([st.cat?'cat='+st.cat:'',st.sort==='updated'?'sort=updated':''].filter(Boolean).join('&'))?'?'+[st.cat?'cat='+st.cat:'',st.sort==='updated'?'sort=updated':''].filter(Boolean).join('&'):'');
 function apply(push){
  for(const a of document.querySelectorAll('.sub3 a')){const on=a.dataset.tab===st.s;a.classList.toggle('on',on);on?a.setAttribute('aria-current','page'):a.removeAttribute('aria-current');}
  for(const p of document.querySelectorAll('[data-panel]'))p.hidden=p.dataset.panel!==st.s;
  if(st.s==='projects'){
   for(const a of document.querySelectorAll('.cats a'))a.classList.toggle('on',a.dataset.cat===st.cat);
   for(const a of document.querySelectorAll('.sorts a'))a.classList.toggle('on',a.dataset.sort===st.sort);
   sorts.querySelector('.why').textContent=st.sort==='top'?'most GitHub stars':'latest commit first';
   const isForq=st.cat==='forq';sorts.hidden=isForq;list.hidden=isForq;forq.hidden=!isForq;
   list.classList.toggle('by-upd',st.sort==='updated');
   const key=st.sort==='top'?'stars':'pushed';
   rows.sort((a,b)=>Number(b.dataset[key])-Number(a.dataset[key]));
   for(const r of rows){r.hidden=!(!st.cat||(st.cat==='runs'?r.hasAttribute('data-runs'):r.dataset.cat===st.cat));list.appendChild(r);}
   document.querySelector('.cats a.on')?.scrollIntoView({inline:'center',block:'nearest'});
  }
  if(push){history.pushState(null,'',url());if(view)view.scrollTop=0;}
 }
 document.addEventListener('click',(e)=>{
  if(e.metaKey||e.ctrlKey||e.shiftKey||e.button)return;
  const t=e.target.closest('.sub3 a[data-tab]'),c=e.target.closest('.cats a[data-cat]'),o=e.target.closest('.sorts a[data-sort]');
  if(!t&&!c&&!o)return;e.preventDefault();
  if(t){if(st.s===t.dataset.tab)return;if(st.s==='projects')last={cat:st.cat,sort:st.sort};st.s=t.dataset.tab;if(st.s==='projects'){st.cat=last.cat;st.sort=last.sort;}}
  if(c)st.cat=c.dataset.cat;
  if(o)st.sort=o.dataset.sort;
  apply(true);});
 addEventListener('popstate',()=>{st=read();apply(false);});
 document.querySelector('.cats a.on')?.scrollIntoView({inline:'center',block:'nearest'});
})();`;

// ../src/v2.ts
var uiOf = /* @__PURE__ */ __name((request) => {
  const v = request.headers.get("x-forq-ui");
  return v === "a" || v === "b" || v === "c" || v === "d" ? v : null;
}, "uiOf");
var NAMES = { a: "Views, home tabs (two bars)", b: "Views, one bar", c: "Views", d: "Views, global top, project bottom" };
var BUSY2 = /busy|thinking|working|running|tool/;
var isMerge = /* @__PURE__ */ __name((t) => !!t && /^Merge [a-z0-9]+$/.test(t), "isMerge");
var fromIssues2 = /* @__PURE__ */ __name((t) => !!t && t.startsWith("Production error from Cloudflare Issues"), "fromIssues");
function titleOf(task) {
  const t = task.replace(/\s+/g, " ").trim();
  const m = t.match(/^(.{12,}?[.!?])(\s|$)/);
  return (m ? m[1] : t).replace(/[.]$/, "");
}
__name(titleOf, "titleOf");
function changeOf(info, a, s, runBase) {
  const worker = info.kind === "worker";
  const tryUrl = worker ? a.preview?.status === "live" && a.preview.url ? `${a.preview.url}/` : void 0 : runUrl(runBase, a.fork, info.entry || "");
  const base = { a, title: titleOf(a.task), tryUrl, busy: false };
  const r = a.review;
  if (a.state === "merged" || a.state === "stopped") return { ...base, state: "merged", word: a.state === "merged" ? "Merged" : "Stopped" };
  if (a.state === "blocked") return { ...base, state: "waiting", word: "Needs your answer", notes: a.note };
  if (a.state === "pushed") {
    if (r?.state === "sent") return { ...base, state: "working", word: "Fixing", busy: true, since: r.at };
    if (r?.state === "queued" || r?.state === "reviewing") return { ...base, state: "checking", word: "Checking", busy: true, since: r.at };
    if (r?.state === "changes") return { ...base, state: "fix", word: "Needs a fix", notes: r.notes };
    return { ...base, state: "ready", word: "Ready to merge", notes: r?.notes };
  }
  const st = s || { awake: false, cc: "asleep" };
  if (st.booting || !st.taskSent || st.awake && BUSY2.test(st.cc)) return { ...base, state: "working", word: "Working", busy: true, since: a.createdAt };
  if (st.awake) return { ...base, state: "waiting", word: "Waiting for you" };
  return { ...base, state: "paused", word: "Paused" };
}
__name(changeOf, "changeOf");
function changesOf(info, status, runBase) {
  const all = info.agents.map((a) => changeOf(info, a, status[a.id], runBase));
  const open = all.filter((c) => c.state !== "merged").reverse().sort((x, y) => ORDER.indexOf(x.state) - ORDER.indexOf(y.state));
  const done = all.filter((c) => c.a.state === "merged").reverse();
  return { open, done };
}
__name(changesOf, "changesOf");
var ORDER = ["waiting", "fix", "ready", "working", "checking", "paused", "merged"];
function summaryOf(open, planning) {
  if (planning) return { html: planning, state: "working", busy: true };
  if (!open.length) return { html: "No changes in progress", state: "", busy: false };
  const n = /* @__PURE__ */ __name((s) => open.filter((c) => c.state === s).length, "n");
  const moving = n("working") + n("checking");
  const top2 = n("waiting") ? `${n("waiting")} waiting for your answer` : n("fix") ? `${n("fix")} need${n("fix") > 1 ? "" : "s"} a fix` : n("ready") ? `${n("ready")} ready to merge` : moving ? `${moving} in progress` : `${n("paused")} paused`;
  const state = ["waiting", "fix", "ready", "working", "paused"].find((s) => (s === "working" ? moving : n(s)) > 0) || "";
  return { html: top2, state, busy: moving > 0 };
}
__name(summaryOf, "summaryOf");
function planningOf(info, r) {
  const q = info.lastRequest;
  const since3 = /* @__PURE__ */ __name((t) => `<span data-since="${t}">0s</span>`, "since");
  if (!q) return { line: "" };
  if (q.state === "failed") return { line: "", failed: q.error || "unknown error" };
  const doing = isMerge(q.text) ? "Merging" : "Planning your request";
  if (q.state === "waking") return { line: `${doing} ${since3(q.at)}` };
  if (q.state === "sent" && (BUSY2.test(r.cc) || Date.now() - (q.sentAt || 0) < 8e3)) {
    if (isMerge(q.text)) return { line: `Merging ${since3(q.sentAt || q.at)}` };
    const n = info.agents.filter((a) => a.createdAt >= q.at).length;
    return { line: `Planning your request ${since3(q.sentAt || q.at)}${n ? `, ${n} change${n > 1 ? "s" : ""} started` : ""}` };
  }
  return { line: "", said: r.said };
}
__name(planningOf, "planningOf");
var since2 = /* @__PURE__ */ __name((t) => t ? ` <span class="t" data-since="${t}">0s</span>` : "", "since");
var dot = /* @__PURE__ */ __name((c) => `<span class="dot s-${c.state}"></span>`, "dot");
function primary(c, accent = false) {
  const k2 = accent ? "btn" : "chipbtn";
  if (c.state === "ready") return `<button class="${k2}" data-merge="${esc4(c.a.id)}">Merge</button>`;
  if (c.state === "fix") return `<button class="${k2}" data-fix="${esc4(c.a.id)}">Ask to fix</button>`;
  if (c.state === "waiting") return `<button class="${k2}" data-sheet="${esc4(c.a.id)}" data-name="${esc4(c.title)}" data-mode="chat">Reply</button>`;
  return "";
}
__name(primary, "primary");
var accentOf = /* @__PURE__ */ __name((cs) => cs.find((c) => primary(c))?.a.id, "accentOf");
function secondary(info, c, opts = {}) {
  const a = c.a;
  const out = [];
  if (opts.tryIt !== false && c.tryUrl && c.state !== "merged") out.push(`<button type="button" class="chipbtn" data-try="${esc4(c.tryUrl)}" data-title="${esc4(c.title)}" data-agent="${esc4(a.id)}" data-state="${c.state}">Try it</button>`);
  const links = [`<a href="/p/${info.owner}/${info.name}/changes/${shortId(a.id)}">See the code</a>`];
  if (c.state !== "merged") links.push(`<button type="button" class="lnk" data-sheet="${esc4(a.id)}" data-name="${esc4(c.title)}" data-mode="chat">Talk to its agent</button>`);
  if (c.state === "fix") links.push(`<button type="button" class="lnk" data-merge="${esc4(a.id)}">Merge anyway</button>`);
  return `${out.join("")}<span class="links">${links.join("")}</span>`;
}
__name(secondary, "secondary");
function detail(info, c) {
  const a = c.a;
  const rv = a.review;
  const check = rv?.state === "approved" ? `<p><b>Checked.</b> ${esc4(rv.notes || "")}</p>` : rv?.state === "changes" ? `<p><b>The check found a problem.</b> ${esc4(rv.notes || "")}</p>` : c.state === "checking" ? `<p>The reviewer agent is trying it in a preview.</p>` : "";
  const pv = a.preview?.status === "building" ? `<p>Building its preview${since2(a.preview.at)}</p>` : a.preview?.status === "failed" ? `<p>Its preview did not build: ${esc4(a.preview.error || "")}. <a href="/p/${info.owner}/${info.name}/build-log?agent=${shortId(a.id)}">Build log</a></p>` : "";
  return `<div class="more">
${a.note ? `<p><b>What it did.</b> ${esc4(a.note)}</p>` : ""}${check}${pv}
<p class="dim"><b>${fromIssues2(a.request) ? "Reported by Cloudflare Issues." : a.request ? "You asked." : "Task."}</b> ${esc4(fromIssues2(a.request) ? a.task : a.request || a.task)}</p>
<div class="acts">${secondary(info, c)}</div></div>`;
}
__name(detail, "detail");
var ROW_STEPS = STEPS;
function changeRow(info, c, now, accentId) {
  const act = primary(c, c.a.id === accentId);
  return `<div class="chg s-${c.state}${c.busy ? " busy" : ""}" data-id="${esc4(c.a.id)}" id="c-${esc4(shortId(c.a.id))}"><div class="chg-row">
<div class="chg-h" data-open role="button" tabindex="0" aria-expanded="false"><span class="chg-t">${esc4(c.title)}</span>
<span class="chg-s">${dot(c)}<span class="w">${c.word}${since2(c.since)}</span>${freshTag(c.a.noteAt || c.a.createdAt, now, ROW_STEPS)}</span></div>
${act ? `<div class="chg-p">${act}</div>` : ""}</div>${detail(info, c)}</div>`;
}
__name(changeRow, "changeRow");
var legend = /* @__PURE__ */ __name((n) => n ? freshLegend(STEPS) : "", "legend");
var TRYBAR = `<div class="trybar" id="trybar" hidden><div class="tt">Trying <b></b></div><button type="button" class="btn" data-trymerge>Merge</button><button type="button" class="chipbtn" data-trylive>Back to live</button></div>`;
var SEND = `<button class="send chipbtn">Send</button>`;
var VISIT = `<p class="visit">On qodebase. Fork it to make it yours and ask agents for changes.</p>`;
function planningHtml(p, q) {
  if (p.failed) return `<div class="plan bad">Could not start: ${esc4(p.failed)} <button class="chipbtn" data-retry="${esc4(q?.text || "")}">Retry</button></div>`;
  if (p.line) return `<div class="plan busy">${p.line}</div>`;
  return "";
}
__name(planningHtml, "planningHtml");
var TOKENS = `
:root{--bg:#fff;--card:#f6f7f8;--chip:#eceef1;--line:#e2e5e9;--fg:#15171a;--dim:#5f6670;--acc:#17695a;--acc-fg:#fff;--busy:#b7791f;--warn:#b42d1f;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0f1112;--card:#171a1c;--chip:#202427;--line:#272b2f;--fg:#e8eaec;--dim:#9ba2a9;--acc:#4fbf9f;--acc-fg:#0f1112;--busy:#e0a948;--warn:#f08a7e;color-scheme:dark}}`;
var BASE_CSS = `${TOKENS}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 'Instrument Sans',sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--acc);text-decoration:none}
input:focus,textarea:focus{outline:none;border-color:var(--acc)!important;box-shadow:0 0 0 3px color-mix(in srgb,var(--acc) 22%,transparent)}
a:focus-visible,button:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.btn,.chipbtn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 16px;border-radius:8px;border:0;font:500 15px 'Instrument Sans',sans-serif;cursor:pointer;transition:background-color .12s;white-space:nowrap;text-decoration:none}
.btn{background:var(--acc);color:var(--acc-fg)}
.chipbtn{background:var(--chip);color:var(--fg)}
.btn[disabled],.chipbtn[disabled]{opacity:.6}
.dim{color:var(--dim)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--line);flex:none}
.dot.s-working,.dot.s-checking{background:var(--busy)}
.dot.s-ready{background:var(--acc)}
.dot.s-fix,.dot.s-waiting{background:var(--warn)}
.dot.s-merged{background:var(--dim)}
.busy .dot{animation:pulse 1.6s ease-in-out infinite}
@keyframes pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.busy .dot{animation:none}}
/* change rows */
.chg{background:var(--card);border-radius:12px;overflow:hidden}
.chg-h{display:block;width:100%;text-align:left;background:none;border:0;padding:12px 14px 10px;color:inherit;font:inherit;cursor:pointer}
.chg-t{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:15px;font-weight:500;line-height:1.35}
.chg-s{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:13px;color:var(--dim)}
.chg-s .w{flex:1;min-width:0;font-variant-numeric:tabular-nums}
.chg.s-ready .chg-s .w{color:var(--acc);font-weight:500}
.chg.s-fix .chg-s .w,.chg.s-waiting .chg-s .w{color:var(--warn);font-weight:500}
.chg-row{display:flex;align-items:center}
.chg-row .chg-h{flex:1;min-width:0}
.chg-p{flex:none;padding:0 12px 0 0}
.chg-p .btn,.chg-p .chipbtn{min-height:40px;padding:0 14px;font-size:14px}
.links{display:inline-flex;flex-wrap:wrap;align-items:center;gap:4px 16px;margin-left:4px}
.links a,.lnk{font:500 14px 'Instrument Sans',sans-serif;color:var(--acc);background:none;border:0;padding:10px 0;cursor:pointer}
.chg .more{display:none;padding:0 14px 14px;font-size:14px;border-top:1px solid var(--line);margin-top:2px}
.chg.open .more{display:block}
.more p{margin:10px 0 0;overflow-wrap:anywhere}
.more b{font-weight:600}
.acts{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px}
.acts .chipbtn,.acts .btn{min-height:40px;padding:0 12px;font-size:14px}
.plan{font-size:14px;color:var(--fg);display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-variant-numeric:tabular-nums}
.plan.busy::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--busy);animation:pulse 1.6s ease-in-out infinite}
.plan .chipbtn{min-height:36px;padding:0 12px;font-size:14px}
.said{font-size:14px;color:var(--dim);white-space:pre-wrap;overflow-wrap:anywhere;max-height:9.5em;overflow:auto}
.empty{color:var(--dim);font-size:14px;margin:0}
.fresh-legend{margin:8px 2px 0}
/* Trying a change: a strip above the app, never over it. */
.trybar{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 8px 8px 14px;background:var(--fg);color:var(--bg)}
.trybar .tt{flex:1 1 180px;min-width:0;font-size:14px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.trybar .tt b{font-weight:600}
.trybar .btn,.trybar .chipbtn{min-height:40px;padding:0 14px;font-size:14px}
.trybar .chipbtn{background:color-mix(in srgb,var(--bg) 20%,var(--fg));color:var(--bg)}
.ask .send.chipbtn{color:var(--dim)}
.visit{color:var(--dim);font-size:14px;margin:0}
.ask textarea{width:100%;font:16px 'Instrument Sans',sans-serif;padding:12px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--fg);resize:none}
.readme{font-size:15px;overflow-wrap:anywhere}
.readme h2,.readme h3,.readme h4{margin:16px 0 6px;font-size:17px}
.readme code{font:13px 'JetBrains Mono',monospace;background:var(--chip);border-radius:4px;padding:1px 4px}
.readme .tbl{overflow-x:auto;margin:0 0 14px}
.readme table{border-collapse:collapse;font-size:14px;min-width:100%}
.readme th,.readme td{overflow-wrap:normal;word-break:normal;text-align:left;vertical-align:top;padding:7px 10px;border-bottom:1px solid var(--line)}
.readme th{font-weight:600}
.readme pre{overflow-x:auto;background:var(--chip);border-radius:8px;padding:10px}
.readme hr{border:0;border-top:1px solid var(--line);margin:16px 0}
.files{display:flex;flex-wrap:wrap;gap:6px}
.files a{font:13px 'JetBrains Mono',monospace;background:var(--chip);border-radius:4px;padding:6px 8px;color:var(--fg)}
.vtag{font-size:12px;color:var(--dim);border:1px solid var(--line);border-radius:4px;padding:2px 6px;margin-left:8px;font-weight:400;vertical-align:2px}
@media (hover:hover){.chipbtn:hover{background:var(--line)}.chg-h:hover{background:var(--chip)}}
${FRESH_CSS}${SHEET_CSS}`;
function shell2(ui, title, body, css, bodyClass = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc4(title)}</title><meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono&display=swap" rel="stylesheet">
<style>${BASE_CSS}${css}</style></head><body class="${bodyClass}">${body}${freshHelp(STEPS)}</body></html>`;
}
__name(shell2, "shell2");
function pageJs(info, pollQ = "") {
  return `<script>
const API='/api/p/${esc4(info.owner)}/${esc4(info.name)}';
const live=document.getElementById('live');
const tick=()=>{for(const el of document.querySelectorAll('[data-since]')){const s=Math.max(0,Math.round((Date.now()-Number(el.dataset.since))/1000));el.textContent=s<60?s+'s':Math.floor(s/60)+'m '+(s%60)+'s';}};
setInterval(tick,1000);tick();
const openIds=new Set();
function restore(){for(const id of openIds){const r=document.querySelector('.chg[data-id="'+CSS.escape(id)+'"]');if(r){r.classList.add('open');r.querySelector('[data-open]')?.setAttribute('aria-expanded','true');}}}
let timer=null;
async function poll(){clearTimeout(timer);
 if(live&&!document.hidden){try{const r=await fetch(API+'/agents-html${pollQ}');if(r.ok){const j=await r.json();live.innerHTML=j.html;restore();tick();window.forqAfterPoll&&window.forqAfterPoll(j);}}catch{}}
 timer=setTimeout(poll,document.querySelector('#live .busy,#live .plan.busy')?2000:5000);}
// The design fixture shows sample data: never replace it with the real project's.
if(live&&!location.pathname.startsWith('/design-fixture')){document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});timer=setTimeout(poll,2000);}
async function post(verb,body){const r=await fetch(API+'/'+verb,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})});const j=await r.json().catch(()=>({}));return r.ok?j:Promise.reject(new Error(j.error||'Failed'));}
async function ask(text){window.forqAsked&&window.forqAsked(text);
 if(live){const p=live.querySelector('.plan');const h='<div class="plan busy">Sending <span data-since="'+Date.now()+'">0s</span></div>';if(p)p.outerHTML=h;else live.insertAdjacentHTML('afterbegin',h);tick();}
 try{await post('router',{text});poll();return true;}catch(e){const p=live&&live.querySelector('.plan');if(p){p.className='plan bad';p.textContent=e.message;}else{const ta=document.querySelector('form.ask textarea');if(ta)ta.placeholder=e.message;}return false;}}
document.addEventListener('keydown',(e)=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-open]')){e.preventDefault();e.target.click();}});
// Trying a change: the app shows its preview under a strip that says so.
const frame=document.getElementById('app'),ext=document.getElementById('ext'),tbar=document.getElementById('trybar');
const liveSrc=frame&&(frame.getAttribute('src')||frame.dataset.src);let trying=null;
function forqTry(src,title,agent,state){if(!frame||!tbar)return;window.forqBeforeTry&&window.forqBeforeTry();
 frame.src=src;if(ext)ext.href=src;trying=agent;tbar.querySelector('b').textContent=title;
 tbar.querySelector('[data-trymerge]').hidden=state!=='ready';tbar.hidden=false;document.body.classList.add('trying');window.forqAfterTry&&window.forqAfterTry();}
function backLive(){if(!frame)return;frame.src=liveSrc;if(ext)ext.href=liveSrc;if(tbar)tbar.hidden=true;trying=null;document.body.classList.remove('trying');}
for(const f of document.querySelectorAll('form.ask')){
 const ta=f.querySelector('textarea'),sb=f.querySelector('.send');
 // Send is quiet until there is something to send: one accent per screen.
 const lit=()=>{if(sb)sb.className='send '+(ta.value.trim()?'btn':'chipbtn');};
 const grow=()=>{ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,160)+'px';lit();};ta.addEventListener('input',grow);
 ta.addEventListener('keydown',(e)=>{if(e.key==='Enter'&&!e.shiftKey&&matchMedia('(hover:hover)').matches){e.preventDefault();f.requestSubmit();}});
 // Pressing Send must not take focus from the box first: on a phone that closes the
 // keyboard, the page re-lays out, Send moves and the tap misses (2026-10-04, measured
 // 57 px at 390 px wide). Keeping focus keeps Send where the finger is.
 if(sb)sb.addEventListener('pointerdown',(e)=>{if(document.activeElement===ta)e.preventDefault();});
 // A suggested change (from the home page's Try row) is waiting in the box, not sent.
 const sug=new URLSearchParams(location.search).get('ask');if(sug&&!ta.value){ta.value=sug.slice(0,500);grow();}
 f.onsubmit=async(e)=>{e.preventDefault();const t=ta.value.trim();if(!t)return;ta.value='';grow();if(!(await ask(t))){ta.value=t;grow();}else if(window.forqAskedGo)location.href=window.forqAskedGo;};}
document.addEventListener('click',async(e)=>{
 const o=!e.target.closest('.fresh')&&e.target.closest('[data-open]');if(o){const r=o.closest('.chg');const on=r.classList.toggle('open');o.setAttribute('aria-expanded',on);on?openIds.add(r.dataset.id):openIds.delete(r.dataset.id);return;}
 const t=e.target.closest('[data-try]');if(t){forqTry(t.dataset.try,t.dataset.title,t.dataset.agent,t.dataset.state);return;}
 if(e.target.closest('[data-trylive]')){backLive();return;}
 const tm=e.target.closest('[data-trymerge]');if(tm){tm.disabled=true;tm.textContent='Merging';try{await post('merge',{agent:trying});backLive();}catch(err){tm.textContent=err.message;return;}tm.disabled=false;tm.textContent='Merge';poll();return;}
 const rt=e.target.closest('[data-retry]');if(rt){rt.disabled=true;ask(rt.dataset.retry);return;}
 const b=e.target.closest('[data-merge],[data-fix]');if(!b)return;
 b.disabled=true;const m=!!b.dataset.merge;b.textContent=m?'Merging':'Sending to its agent';
 try{await post(m?'merge':'fix',{agent:b.dataset.merge||b.dataset.fix});window.forqMerged&&m&&window.forqMerged(b.dataset.merge);}catch(err){b.textContent=err.message;}
 poll();});
<\/script><script>${SHEET_JS}<\/script>`;
}
__name(pageJs, "pageJs");
function forkAction(info, me, myForks, cls = "btn") {
  if (myForks.length) return `<a class="${cls}" href="${path(myForks[0].slug)}">Open your copy</a>`;
  if (me) return `<button class="${cls}" id="fork">Fork to change it</button>`;
  return `<a class="${cls}" href="/login?next=${encodeURIComponent(path(info.slug))}">Sign in to fork</a>`;
}
__name(forkAction, "forkAction");
var FORK_JS = `<script>(function(){const ak=new URLSearchParams(location.search).get('ask');
const v=document.querySelector('.visit');if(ak&&v){v.textContent='';v.append('After you fork, ask for: ');const b=document.createElement('b');b.textContent=ak;v.append(b);}
if(ak)for(const a of document.querySelectorAll('a[href^="/login?next="]'))a.href='/login?next='+encodeURIComponent(location.pathname+location.search);
const fk=document.getElementById('fork');if(!fk)return;const api='/api/p/'+location.pathname.split('/').slice(2,4).join('/');
fk.onclick=async()=>{fk.disabled=true;fk.textContent='Forking';const r=await fetch(api+'/fork',{method:'POST'});const j=await r.json().catch(()=>({}));
if(r.ok)location.href=j.path+(ak?'?ask='+encodeURIComponent(ak):'');else{fk.disabled=false;fk.textContent=j.error||'Fork failed';}};})();<\/script>`;
function appUrl(o) {
  const { info, overview, runBase } = o;
  const isWorker2 = (overview.kind ?? info.kind) === "worker";
  const dep = overview.app ?? info.app;
  if (isWorker2) return dep?.url ? `${dep.url}/` : "";
  const at = overview.entry ?? info.entry;
  return at === null ? "" : runUrl(runBase, info.repo, at || "");
}
__name(appUrl, "appUrl");
function noApp(o) {
  const isWorker2 = (o.overview.kind ?? o.info.kind) === "worker";
  const dep = o.overview.app ?? o.info.app;
  if (o.overview.importing) return `<div class="noapp">Importing from GitHub<script>setTimeout(()=>location.reload(),3000)<\/script></div>`;
  if (isWorker2 && dep?.status === "building") return `<div class="noapp">Deploying <span data-since="${dep.at}">0s</span><script>setTimeout(()=>location.reload(),6000)<\/script></div>`;
  if (isWorker2 && dep?.status === "failed") return `<div class="noapp">The deploy failed: ${esc4(dep.error || "")}. <a href="/p/${o.info.owner}/${o.info.name}/build-log">Build log</a></div>`;
  return `<div class="noapp">This project has no web page to show.</div>`;
}
__name(noApp, "noApp");
var keyNote = `<p class="empty">Agents run on your own Anthropic API key. <a href="/settings">Add it in Settings</a>.</p>`;
var A_CSS = `
body.app{height:100dvh;display:flex;flex-direction:column;overflow:hidden}
.abar{display:flex;align-items:center;gap:4px;height:52px;padding:0 8px 0 4px;border-bottom:1px solid var(--line);flex:none}
.abar .home{display:inline-flex;align-items:center;min-height:44px;padding:0 10px;font-weight:600;color:var(--fg)}
.abar .nm{flex:1;min-width:0;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.abar .nm .o{color:var(--dim)}
.abar .lnk{padding:10px 8px}
.abar .chipbtn{min-height:36px;padding:0 12px;font-size:14px;gap:6px}
.ico{width:14px;height:14px;flex:none}
.stage{flex:1;min-height:0;display:flex;flex-direction:column;background:var(--card)}
.stage iframe{flex:1;width:100%;border:0;display:block;background:#fff}
.noapp{display:flex;align-items:center;justify-content:center;flex:1;padding:24px;text-align:center;color:var(--dim);font-size:15px}
.dock{flex:none;border-top:1px solid var(--line);background:var(--bg);padding:4px 12px calc(8px + env(safe-area-inset-bottom))}
.status{display:flex;align-items:center;gap:8px;width:100%;min-height:48px;background:none;border:0;padding:0 2px;color:var(--fg);font:500 15px 'Instrument Sans',sans-serif;text-align:left;cursor:pointer;font-variant-numeric:tabular-nums}
.status .tx{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.status.s-fix .tx,.status.s-waiting .tx{color:var(--warn)}
.status.s-ready .tx{color:var(--acc)}
.status .up{width:10px;height:10px;border-left:2px solid var(--dim);border-top:2px solid var(--dim);transform:rotate(45deg);margin:4px 6px 0}
.dock .ask{display:flex;gap:8px;align-items:flex-end}
.dock .ask textarea{flex:1;min-height:44px;max-height:160px;padding:10px 12px}
.list{position:fixed;left:0;right:0;bottom:0;z-index:19;max-width:720px;margin:0 auto;max-height:80dvh;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--line);border-bottom:0;border-radius:16px 16px 0 0;box-shadow:0 -8px 32px rgb(0 0 0 / .18);transform:translateY(105%);transition:transform .22s ease;visibility:hidden}
.list.open{transform:none;visibility:visible}
.list .lh{display:flex;align-items:center;padding:4px 8px 4px 16px;border-bottom:1px solid var(--line);flex:none}
.list .lh b{flex:1;font-weight:600}
.list .x{width:44px;height:44px;border:0;background:none;color:var(--dim);font-size:24px;cursor:pointer}
.list .lb>*{flex:none}
.list .lb{overflow-y:auto;padding:12px 12px calc(16px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:8px;overscroll-behavior:contain}
.list .sec{font-size:13px;color:var(--dim);margin:12px 4px 0}
.scrim{position:fixed;inset:0;z-index:18;background:rgb(0 0 0 / .25);opacity:0;pointer-events:none;transition:opacity .22s}
.scrim.on{opacity:1;pointer-events:auto}
.info .lb p{margin:0}
.dock .visit{margin:6px 2px 8px}
/* Desktop: the app on the left, the changes always open on the right. */
@media (min-width:1000px){
 body.app .stage{margin-right:400px}
 body.app #list{left:auto;right:0;top:52px;bottom:64px;width:400px;max-width:none;max-height:none;margin:0;transform:none;visibility:visible;border:0;border-left:1px solid var(--line);border-radius:0;box-shadow:none;z-index:5}
 body.app #list .x{display:none}
 body.app .dock{position:fixed;right:0;bottom:0;width:400px;border-left:1px solid var(--line);padding-top:8px}
 body.app .status{display:none}
}
`;
var OPEN_ICON = `<svg class="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M9 3h4v4M13 3 7.5 8.5M12 9.5V13H3V4h3.5"/></svg>`;
function liveA(info, open, done, plan) {
  const now = Date.now();
  const sum = summaryOf(open, plan.line);
  const accent = accentOf(open);
  return `<template id="sum" data-state="${plan.failed ? "fix" : sum.state}" data-busy="${sum.busy ? 1 : ""}">${plan.failed ? `Could not start: ${esc4(plan.failed)}` : sum.html}</template>
${planningHtml(plan, info.lastRequest)}${plan.said ? `<div class="said">${esc4(plan.said)}</div>` : ""}
${open.map((c) => changeRow(info, c, now, accent)).join("") || (plan.line ? "" : '<p class="empty">Nothing in progress. Ask for a change below.</p>')}
${done.length ? `<p class="sec">Merged</p>${done.slice(0, 8).map((c) => changeRow(info, c, now)).join("")}` : ""}${legend(open.length + done.length)}`;
}
__name(liveA, "liveA");
function projectA(o) {
  const { info, me, forks, overview } = o;
  const own = info.owner === me;
  const app2 = appUrl(o);
  const myForks = forks.filter((e) => e.owner === me);
  return shell2("a", `${info.owner}/${info.name} \xB7 qodebase`, `
<header class="abar"><a class="home" href="/" aria-label="All projects">qodebase</a><span class="nm"><span class="o">${esc4(info.owner)} /</span> ${esc4(info.name)}</span>
<button type="button" class="lnk" id="info-b">About</button>${app2 ? `<a class="chipbtn" id="ext" href="${esc4(app2)}" target="_blank" rel="noopener">Open app${OPEN_ICON}</a>` : ""}</header>
<div class="stage">${TRYBAR}${app2 ? `<iframe id="app" src="${esc4(app2)}" title="${esc4(info.name)}"></iframe>` : noApp(o)}</div>
<div class="dock">${own ? o.needsKey ? keyNote : `<button type="button" class="status" id="status" aria-label="Show changes"><span class="dot"></span><span class="tx">No changes in progress</span><span class="up"></span></button>
<form class="ask"><textarea rows="1" placeholder="Ask for a change" enterkeyhint="send" aria-label="Ask for a change"></textarea>${SEND}</form>` : `${VISIT}<div style="display:flex">${forkAction(info, me, myForks, 'btn" style="flex:1')}</div>`}</div>
<div class="scrim" id="scrim"></div>
${own ? `<div class="list" id="list" aria-hidden="true"><div class="lh"><b>Changes</b><button type="button" class="x" data-close aria-label="Close">\xD7</button></div><div class="lb" id="live">${o.liveHtml}</div></div>` : ""}
<div class="list info" id="info" aria-hidden="true"><div class="lh"><b>${esc4(info.name)}</b><button type="button" class="x" data-close aria-label="Close">\xD7</button></div><div class="lb">
${info.description ? `<p>${esc4(info.description)}</p>` : ""}
<p class="dim" style="font-size:14px">${info.forkedFrom ? `Forked from <a href="${path(info.forkedFrom)}">${esc4(label(info.forkedFrom))}</a>. ` : ""}${forks.length ? `${forks.length} fork${forks.length > 1 ? "s" : ""}. ` : ""}${info.importedFrom ? `From <a href="${esc4(info.importedFrom.url)}" rel="noopener">GitHub</a>.` : ""}</p>
<div class="acts"><a class="chipbtn" href="/p/${info.owner}/${info.name}/code/">Code</a>${own ? `<button type="button" class="chipbtn" data-sheet="${info.slug}--router" data-name="Router agent" data-mode="chat">Router agent</button><button type="button" class="chipbtn" data-sheet="${info.slug}--review" data-name="Reviewer agent" data-mode="chat">Reviewer agent</button>` : ""}</div>
${overview.readme ? `<div class="readme">${markdown(overview.readme)}</div>` : ""}</div></div>
${own ? SHEET_HTML : ""}
${pageJs(info)}${FORK_JS}
<script>
(function(){
 const scrim=document.getElementById('scrim');
 const sheets=[...document.querySelectorAll('.list')];
 function show(el){for(const s of sheets)s.classList.toggle('open',s===el);scrim.classList.toggle('on',!!el);}
 scrim.onclick=()=>show(null);
 for(const x of document.querySelectorAll('[data-close]'))x.onclick=()=>show(null);
 document.getElementById('info-b').onclick=()=>show(document.getElementById('info'));
 const st=document.getElementById('status'),list=document.getElementById('list');
 if(st)st.onclick=()=>show(list);
 // Opening an agent's chat closes the list first (one surface at a time).
 document.addEventListener('click',(e)=>{if(e.target.closest('[data-sheet]'))show(null);},true);
 function sync(){const s=document.getElementById('sum');if(!s||!st)return;st.querySelector('.tx').innerHTML=s.innerHTML;
  st.className='status'+(s.dataset.state?' s-'+s.dataset.state:'')+(s.dataset.busy?' busy':'');
  st.querySelector('.dot').className='dot'+(s.dataset.state?' s-'+s.dataset.state:'');tick();}
 sync();window.forqAfterPoll=sync;
 window.forqAsked=()=>{if(st){st.querySelector('.tx').textContent='Sending';st.classList.add('busy');}};
 window.forqBeforeTry=()=>show(null);
})();
<\/script>`, A_CSS, "app");
}
__name(projectA, "projectA");
var B_CSS = `
main{max-width:720px;margin:0 auto;padding:4px 16px calc(32px + env(safe-area-inset-bottom))}
.top{display:flex;align-items:center;justify-content:space-between;height:48px}
.top .home{font-weight:600;font-size:18px;color:var(--fg)}
.top .me{font-size:14px;color:var(--dim)}
h1{font-size:24px;line-height:1.2;margin:8px 0 4px;font-weight:600;word-break:break-word}
h1 .o{color:var(--dim);font-weight:400}
.lede{color:var(--dim);margin:0;font-size:15px}
h2{font-size:15px;font-weight:600;margin:24px 0 10px}
.frame{margin-top:16px;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--card);scroll-margin-top:8px}
.frame .fh{display:flex;align-items:center;gap:8px;min-height:44px;padding:0 6px 0 14px;border-bottom:1px solid var(--line);font-size:14px;color:var(--dim)}
.frame .fh span{flex:1}
.frame .fh .chipbtn{min-height:36px;padding:0 12px;font-size:14px;gap:6px}
body.trying .frame .fh{display:none}
.ico{width:14px;height:14px;flex:none}
.frame iframe{width:100%;height:min(520px,56dvh);border:0;display:block;background:#fff}
.own .frame iframe{height:min(420px,38dvh)}
.noapp{padding:32px 16px;text-align:center;color:var(--dim);font-size:15px}
.ask{display:flex;gap:8px;align-items:flex-end}
.ask textarea{flex:1;min-height:44px;max-height:160px;padding:10px 12px}
#live{display:flex;flex-direction:column;gap:8px;margin-top:12px}
details.fold{border-top:1px solid var(--line);margin-top:24px}
details.fold summary{display:flex;align-items:center;min-height:52px;font-weight:600;font-size:15px;cursor:pointer;list-style:none}
details.fold summary::-webkit-details-marker{display:none}
details.fold summary .n{margin-left:8px;color:var(--dim);font-weight:400}
details.fold summary::after{content:'';margin-left:auto;width:8px;height:8px;border-right:2px solid var(--dim);border-bottom:2px solid var(--dim);transform:rotate(45deg);transition:transform .12s}
details.fold[open] summary::after{transform:rotate(-135deg)}
details.fold .in{padding-bottom:16px;display:flex;flex-direction:column;gap:8px}
#live details.fold{margin-top:16px}
.forkbar{margin-top:16px;display:flex}
.forkbar .btn{flex:1}
.lede+.visit{margin-top:6px}
`;
var OPEN_ICON_B = `<svg class="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M9 3h4v4M13 3 7.5 8.5M12 9.5V13H3V4h3.5"/></svg>`;
function liveB(info, open, done, plan) {
  const now = Date.now();
  const accent = accentOf(open);
  return `${planningHtml(plan, info.lastRequest)}${plan.said ? `<div class="said">${esc4(plan.said)}</div>` : ""}
${open.map((c) => changeRow(info, c, now, accent)).join("") || (plan.line ? "" : '<p class="empty">No changes in progress.</p>')}
${legend(open.length + done.length)}
${done.length ? `<details class="fold"><summary>Merged<span class="n">${done.length}</span></summary><div class="in">${done.slice(0, 10).map((c) => changeRow(info, c, now)).join("")}</div></details>` : ""}`;
}
__name(liveB, "liveB");
function projectB(o) {
  const { info, me, forks, overview } = o;
  const own = info.owner === me;
  const app2 = appUrl(o);
  const myForks = forks.filter((e) => e.owner === me);
  return shell2("b", `${info.owner}/${info.name} \xB7 qodebase`, `<main>
<header class="top"><a class="home" href="/">qodebase</a>${me ? `<a class="me" href="/settings">${esc4(me)}</a>` : `<a class="chipbtn" href="/login">Sign in</a>`}</header>
<h1><span class="o">${esc4(info.owner)} /</span> ${esc4(info.name)}</h1>
${info.description ? `<p class="lede">${esc4(info.description)}</p>` : ""}${own ? "" : VISIT}
${own ? "" : `<div class="forkbar">${forkAction(info, me, myForks)}</div>`}
<div class="frame">${TRYBAR}<div class="fh"><span>Live app</span>${app2 ? `<a class="chipbtn" id="ext" href="${esc4(app2)}" target="_blank" rel="noopener">Open app${OPEN_ICON_B}</a>` : ""}</div>
${app2 ? `<iframe id="app" src="${esc4(app2)}" title="${esc4(info.name)}" loading="lazy"></iframe>` : noApp(o)}</div>
${own ? `<h2>Changes</h2>${o.needsKey ? keyNote : `<form class="ask"><textarea rows="1" placeholder="Ask for a change" enterkeyhint="send" aria-label="Ask for a change"></textarea>${SEND}</form>
<div id="live">${o.liveHtml}</div>`}` : ""}
<details class="fold"><summary>About this project</summary><div class="in">
<p class="dim" style="margin:0;font-size:14px">${info.forkedFrom ? `Forked from <a href="${path(info.forkedFrom)}">${esc4(label(info.forkedFrom))}</a>. ` : ""}${forks.length ? `${forks.length} fork${forks.length > 1 ? "s" : ""}. ` : ""}${info.importedFrom ? `Imported from <a href="${esc4(info.importedFrom.url)}" rel="noopener">GitHub</a>.` : ""}</p>
${overview.readme ? `<div class="readme">${markdown(overview.readme)}</div>` : ""}</div></details>
<details class="fold"><summary>Code<span class="n">${overview.files.length} item${overview.files.length === 1 ? "" : "s"}</span></summary><div class="in">
<div class="files">${overview.files.map((f) => `<a href="/p/${info.owner}/${info.name}/code/${esc4(f.name)}${f.dir ? "/" : ""}">${esc4(f.name)}${f.dir ? "/" : ""}</a>`).join("")}</div>
<div class="acts"><a class="chipbtn" href="/p/${info.owner}/${info.name}/code/">Browse and search</a>${own ? `<button type="button" class="chipbtn" data-sheet="${info.slug}--router" data-name="Router agent" data-mode="chat">Router agent</button><button type="button" class="chipbtn" data-sheet="${info.slug}--review" data-name="Reviewer agent" data-mode="chat">Reviewer agent</button>` : ""}</div></div></details>
</main>${own ? SHEET_HTML : ""}${pageJs(info)}${FORK_JS}
<script>window.forqAfterTry=()=>document.querySelector('.frame').scrollIntoView({behavior:'smooth',block:'start'});<\/script>`, B_CSS, own ? "own" : "");
}
__name(projectB, "projectB");
var C_CSS = `
body.chat{height:100dvh;display:flex;flex-direction:column;overflow:hidden}
.cbar{flex:none;border-bottom:1px solid var(--line);padding:0 12px}
.cbar .r1{display:flex;align-items:center;gap:4px;height:48px}
.cbar .home{font-weight:600;color:var(--fg);min-height:44px;display:inline-flex;align-items:center;padding-right:8px}
.cbar .nm{flex:1;min-width:0;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cbar .nm .o{color:var(--dim)}
.cbar .lnk{padding:10px 8px}
.cbar .chipbtn{min-height:36px;padding:0 12px;font-size:14px;gap:6px}
.ico{width:14px;height:14px;flex:none}
.tabs{display:flex;gap:4px;padding-bottom:8px}
.tabs button{flex:1;min-height:40px;border:0;border-radius:8px;background:none;color:var(--dim);font:500 15px 'Instrument Sans',sans-serif;cursor:pointer}
.tabs button.on{background:var(--chip);color:var(--fg)}
.pane{flex:1;min-height:0;display:none;flex-direction:column}
.pane.on{display:flex}
.thread>*,.them>*{flex:none}
.thread{flex:1;overflow-y:auto;padding:0 12px 8px;display:flex;flex-direction:column;gap:12px;overscroll-behavior:contain}
.thread>:nth-child(2){margin-top:16px}
.needbar{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:8px;min-height:44px;margin:0 -12px;padding:0 12px;background:var(--bg);border-bottom:1px solid var(--line);font:500 14px 'Instrument Sans',sans-serif;color:var(--warn)}
.needbar.none{display:none}
.needbar .tx{flex:1}
.needbar i{font-style:normal;color:var(--acc)}
.you{align-self:flex-end;max-width:86%;background:var(--chip);color:var(--fg);border-radius:12px 12px 4px 12px;padding:10px 14px;white-space:pre-wrap;overflow-wrap:anywhere}
.you.sys{align-self:stretch;max-width:none;background:none;border:1px solid var(--line);border-radius:12px;font-size:14px}
.you.sys b{display:block;font-weight:600;margin-bottom:2px}
.when{align-self:center;font-size:12px;color:var(--dim)}
.them{display:flex;flex-direction:column;gap:8px;max-width:100%}
.them .said{color:var(--fg);font-size:15px;max-height:none}
.thread .plan{padding:2px 2px}
.compose{flex:none;border-top:1px solid var(--line);padding:8px 12px calc(8px + env(safe-area-inset-bottom));background:var(--bg)}
.compose .ask{display:flex;gap:8px;align-items:flex-end}
.compose .ask textarea{flex:1;min-height:44px;max-height:160px;padding:10px 12px}
.appw{flex:1;min-height:0;display:flex;flex-direction:column}
.appw iframe{flex:1;width:100%;border:0;background:#fff}
.noapp{padding:32px 16px;text-align:center;color:var(--dim)}
.codep{overflow-y:auto;padding:16px}
.codep h2{font-size:15px;margin:20px 0 8px}
.forkbar{padding:8px 12px calc(8px + env(safe-area-inset-bottom));border-top:1px solid var(--line);display:flex;flex-direction:column;gap:8px}
.forkbar .btn{flex:1}
/* Desktop: a conversation reads best in a column; the app keeps the full width. */
@media (min-width:800px){.cbar,.thread,.compose,.codep,.forkbar{padding-left:max(12px,calc(50% - 360px));padding-right:max(12px,calc(50% - 360px))}.needbar{margin:0 calc(-1 * max(12px,calc(50% - 360px)));padding:0 max(12px,calc(50% - 360px))}}
`;
var OPEN_ICON_C = `<svg class="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M9 3h4v4M13 3 7.5 8.5M12 9.5V13H3V4h3.5"/></svg>`;
function liveC(info, all, plan) {
  const now = Date.now();
  const groups = [];
  for (const c of [...all].sort((x, y) => x.a.createdAt - y.a.createdAt)) {
    const text = c.a.request || "";
    const g = groups.find((x) => x.text === text && Math.abs(c.a.createdAt - x.at) < 6 * 36e5);
    if (g) g.changes.push(c);
    else groups.push({ text, at: c.a.createdAt, issues: fromIssues2(text), changes: [c] });
  }
  const q = info.lastRequest;
  const lastHasAgents = q && groups.some((g) => g.text === q.text && g.at >= q.at - 6e4);
  if (q && !lastHasAgents && !isMerge(q.text)) groups.push({ text: q.text, at: q.at, issues: fromIssues2(q.text), changes: [] });
  const needs = all.filter((c) => primary(c)).sort((x, y) => ORDER.indexOf(x.state) - ORDER.indexOf(y.state));
  const accent = needs[0]?.a.id;
  const need = needs.length ? `<a class="needbar" href="#c-${esc4(shortId(needs[0].a.id))}"><span class="dot s-${needs[0].state}"></span><span class="tx">${needs.length} need${needs.length > 1 ? "" : "s"} you</span><i>Show</i></a>` : '<div class="needbar none"></div>';
  const day2 = /* @__PURE__ */ __name((t) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" }), "day");
  let lastDay = "";
  const out = groups.map((g, i) => {
    const d = day2(g.at);
    const when = d !== lastDay ? `<div class="when">${d}</div>` : "";
    lastDay = d;
    const isLast = i === groups.length - 1;
    const you = !g.text ? "" : g.issues ? `<div class="you sys"><b>Cloudflare Issues reported an error</b>${esc4(g.text.replace(/^Production error from Cloudflare Issues:\s*/, "").slice(0, 220))}</div>` : `<div class="you">${esc4(g.text)}</div>`;
    const tail = isLast && !(q && isMerge(q.text)) ? `${planningHtml(plan, q)}${plan.said ? `<div class="said">${esc4(plan.said)}</div>` : ""}` : "";
    return `${when}${you}<div class="them">${g.changes.map((c) => changeRow(info, c, now, accent)).join("")}${tail}</div>`;
  });
  if (q && isMerge(q.text)) out.push(`${planningHtml(plan, q)}`);
  return need + (out.join("") || `<p class="empty" style="text-align:center;margin-top:24px">Ask for a change. qodebase splits it into tasks, an agent does each one, and a reviewer checks it before you merge.</p>`) + legend(all.length);
}
__name(liveC, "liveC");
function projectC(o) {
  const { info, me, forks, overview } = o;
  const own = info.owner === me;
  const app2 = appUrl(o);
  const myForks = forks.filter((e) => e.owner === me);
  const codeHref = `/p/${info.owner}/${info.name}/code/`;
  return shell2("c", `${info.owner}/${info.name} \xB7 qodebase`, `
<header class="cbar"><div class="r1"><a class="home" href="/">qodebase</a><span class="nm"><span class="o">${esc4(info.owner)} /</span> ${esc4(info.name)}</span>${own ? "" : `<a class="lnk" href="${codeHref}">Code</a>`}${app2 ? `<a class="chipbtn" id="ext" href="${esc4(app2)}" target="_blank" rel="noopener">Open app${OPEN_ICON_C}</a>` : ""}</div>
${own ? `<nav class="tabs" role="tablist"><button type="button" role="tab" data-tab="chat" class="on">Changes</button><button type="button" role="tab" data-tab="app">App</button><button type="button" role="tab" data-tab="code">Code</button></nav>` : ""}</header>
${own ? `<section class="pane on" id="p-chat"><div class="thread" id="live">${o.liveHtml}</div>
<div class="compose">${o.needsKey ? keyNote : `<form class="ask"><textarea rows="1" placeholder="Ask for a change" enterkeyhint="send" aria-label="Ask for a change"></textarea>${SEND}</form>`}</div></section>` : ""}
<section class="pane${own ? "" : " on"}" id="p-app"><div class="appw">${TRYBAR}${app2 ? `<iframe id="app" ${own ? "data-src" : "src"}="${esc4(app2)}" title="${esc4(info.name)}"></iframe>` : noApp(o)}</div>
${own ? "" : `<div class="forkbar">${VISIT}${forkAction(info, me, myForks)}</div>`}</section>
${own ? `<section class="pane" id="p-code"><div class="codep">
${info.description ? `<p style="margin:0 0 8px">${esc4(info.description)}</p>` : ""}
<div class="acts" style="margin-top:0"><a class="chipbtn" href="${codeHref}">Browse and search the code</a></div>
<h2>Files</h2><div class="files">${overview.files.map((f) => `<a href="${codeHref}${esc4(f.name)}${f.dir ? "/" : ""}">${esc4(f.name)}${f.dir ? "/" : ""}</a>`).join("")}</div>
<h2>The agents behind it</h2><div class="acts" style="margin-top:0"><button type="button" class="chipbtn" data-sheet="${info.slug}--router" data-name="Router agent" data-mode="chat">Router agent</button><button type="button" class="chipbtn" data-sheet="${info.slug}--review" data-name="Reviewer agent" data-mode="chat">Reviewer agent</button></div>
${overview.readme ? `<h2>README</h2><div class="readme">${markdown(overview.readme)}</div>` : ""}</div></section>` : ""}
${own ? SHEET_HTML : ""}${pageJs(info)}${FORK_JS}
<script>
(function(){
 const panes={},btns=document.querySelectorAll('.tabs button');for(const b of btns)panes[b.dataset.tab]=document.getElementById('p-'+b.dataset.tab);
 const fr=document.getElementById('app');
 function tab(t){for(const b of btns)b.classList.toggle('on',b.dataset.tab===t);for(const k in panes)panes[k].classList.toggle('on',k===t);
  if(t==='app'&&fr&&!fr.getAttribute('src'))fr.src=fr.dataset.src;}
 for(const b of btns)b.onclick=()=>tab(b.dataset.tab);
 const th=document.getElementById('live');const bottom=()=>{if(th)th.scrollTop=th.scrollHeight;};bottom();
 (document.fonts?document.fonts.ready:Promise.resolve()).then(()=>requestAnimationFrame(bottom));
 window.forqBeforeTry=()=>tab('app');
 const near=()=>th&&th.scrollHeight-th.scrollTop-th.clientHeight<120;
 let stick=true;if(th)th.addEventListener('scroll',()=>{stick=near();});
 window.forqAfterPoll=()=>{if(stick)bottom();};
 window.forqAsked=(t)=>{if(!th)return;const e=document.createElement('div');e.className='you';e.textContent=t;th.appendChild(e);bottom();};
 // The needs-you bar jumps to the card, inside the thread's own scroller.
 document.addEventListener('click',(e)=>{const a=e.target.closest('.needbar[href]');if(!a)return;e.preventDefault();
  const c=document.querySelector(a.getAttribute('href'));if(c){c.scrollIntoView({behavior:'smooth',block:'center'});c.classList.add('open');}});
})();
<\/script>`, C_CSS, "chat");
}
__name(projectC, "projectC");
var HOME_CSS = `
main{max-width:720px;margin:0 auto;padding:4px 16px calc(32px + env(safe-area-inset-bottom))}
.top{display:flex;align-items:center;justify-content:space-between;height:52px}
.top .home{font-weight:600;font-size:20px;color:var(--fg)}
.top .tr{display:flex;align-items:center;gap:8px}
.top .chipbtn{min-height:40px;font-size:14px;padding:0 12px}
.top .me{font-size:14px;color:var(--dim);padding:8px 4px}
.hero{margin:12px 0 4px;font-size:22px;line-height:1.25;font-weight:600;letter-spacing:-.01em}
.sub{color:var(--dim);margin:0 0 8px;font-size:15px}
h2{display:flex;align-items:baseline;font-size:15px;font-weight:600;margin:28px 0 10px}
h2 a{margin-left:auto;font-weight:500;font-size:14px}
.rows{display:flex;flex-direction:column;gap:8px}
.prow{position:relative;display:block;background:var(--card);border-radius:12px;padding:12px 14px;color:inherit}
.prow .t{display:block;font-size:15px;color:var(--fg)}
.prow .t b{font-weight:600}.prow .t .o{color:var(--dim)}
.prow .d{color:var(--dim);font-size:14px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prow .m{display:flex;align-items:center;gap:8px 12px;margin-top:8px;font-size:13px;color:var(--dim);white-space:nowrap;overflow:hidden}
.prow .m .st{display:inline-flex;align-items:center;gap:6px;color:var(--fg);font-weight:500}
.prow .m .st.ready{color:var(--acc)}
.stretch::after{content:'';position:absolute;inset:0;border-radius:12px}
.prow button.fresh{position:relative;z-index:1}
.foot{margin-top:32px;font-size:14px;display:flex;gap:16px}
.vnote{display:block;margin:8px 0 4px;padding:12px 14px;border-radius:12px;border:1px solid var(--line);color:var(--fg);font-size:15px}
.vnote b{display:block;font-weight:600}
@media (hover:hover){.prow:hover{background:var(--chip)}}
`;
function homeV2(ui, entries, me, status) {
  const now = Date.now();
  const mine = entries.filter((e) => e.owner === me).sort((a, b) => b.updatedAt - a.updatedAt);
  const others = entries.filter((e) => e.owner !== me);
  const forks = /* @__PURE__ */ __name((slug) => entries.filter((e) => e.forkedFrom === slug).length, "forks");
  const st = /* @__PURE__ */ __name((s) => {
    if (!s) return "";
    if (s.ready) return `<span class="st ready"><span class="dot s-ready"></span>${s.ready} ready to merge</span>`;
    if (s.fix) return `<span class="st"><span class="dot s-fix"></span>${s.fix} need${s.fix > 1 ? "" : "s"} a fix</span>`;
    if (s.working) return `<span class="st"><span class="dot s-working"></span>${s.working} in progress</span>`;
    return "";
  }, "st");
  const row2 = /* @__PURE__ */ __name((e, withStatus) => `<div class="prow"><a class="t stretch" href="${path(e.slug)}"><span class="o">${esc4(e.owner)} /</span> <b>${esc4(e.name)}</b></a>
${e.description ? `<div class="d">${esc4(e.description)}</div>` : ""}
<div class="m">${withStatus ? st(status[e.slug]) : ""}${freshTag(e.updatedAt, now, STEPS)}${!withStatus && forks(e.slug) ? `<span>${forks(e.slug)} fork${forks(e.slug) > 1 ? "s" : ""}</span>` : ""}${e.importedFrom ? `<span>${e.importedFrom.stars >= 1e3 ? (e.importedFrom.stars / 1e3).toFixed(1) + "k" : e.importedFrom.stars} stars</span>` : ""}</div></div>`, "row");
  return shell2(ui, "forq", `<main>
<header class="top"><a class="home" href="/">qodebase<span class="vtag">Variant ${ui.toUpperCase()}: ${NAMES[ui]}</span></a><span class="tr">${me ? `<a class="chipbtn" href="/import">Import</a><a class="me" href="/settings">${esc4(me)}</a>` : `<a class="chipbtn" href="/login">Sign in</a>`}</span></header>
${ui === "c" ? `<a class="vnote" href="/design-fixture"><b>The views design lives inside a project.</b> Open any project below, or see the sample with every state</a>` : ""}
${mine.length ? "" : `<p class="hero">Projects that run, and agents that change them.</p><p class="sub">Open one to use it. Fork it, then ask for a change in plain words.</p>`}
${mine.length ? `<h2>Your projects</h2><div class="rows">${mine.map((e) => row2(e, true)).join("")}</div>` : ""}
<h2>${mine.length ? "Explore" : "Projects"}</h2><div class="rows">${others.map((e) => row2(e, false)).join("") || '<p class="empty">Nothing here yet.</p>'}</div>
<p class="foot"><a href="/about">About</a><a href="/privacy">Privacy</a><a href="/feedback">Feedback</a></p></main>`, HOME_CSS, "home");
}
__name(homeV2, "homeV2");
function projectV2(ui, o) {
  return ui === "a" ? projectA(o) : ui === "b" ? projectB(o) : projectC(o);
}
__name(projectV2, "projectV2");
function liveV2(ui, info, router, status, runBase) {
  const { open, done } = changesOf(info, status, runBase);
  const plan = planningOf(info, router);
  if (ui === "a") return liveA(info, open, done, plan);
  if (ui === "b") return liveB(info, open, done, plan);
  return liveC(info, [...done.slice(0, 12).reverse(), ...open.slice().reverse()].sort((x, y) => x.a.createdAt - y.a.createdAt), plan);
}
__name(liveV2, "liveV2");
function fixtureV2(ui, runBase, mode) {
  const f = fixtureData(runBase, mode);
  return projectV2(ui, { info: f.info, entry: f.entry, forks: [], overview: f.overview, me: "eyal", runBase, liveHtml: liveV2(ui, f.info, f.router, f.status, runBase) });
}
__name(fixtureV2, "fixtureV2");
function fixtureData(runBase, mode) {
  const now = Date.now();
  const m = 6e4;
  const ask = "Two changes: a switch that rounds each person's share up to the next whole number, and a Copy button next to the per-person amount.";
  const mk = /* @__PURE__ */ __name((id, task, extra) => ({ id: `eyal.tipsplit--${id}`, task, fork: "eyal.tipsplit", remote: "", createdAt: now - 20 * m, state: "working", ...extra }), "mk");
  const agents = mode === "empty" ? [] : [
    mk("m1", "Add a dark theme that follows the system setting.", { state: "merged", createdAt: now - 3 * 864e5, note: "Dark theme via prefers-color-scheme; all colours moved to CSS variables.", noteAt: now - 3 * 864e5 }),
    mk("m2", "Remember the last tip percentage between visits.", { state: "merged", createdAt: now - 26 * 36e5, note: "Saved in localStorage, restored on load.", noteAt: now - 26 * 36e5 }),
    mk("r1", "Add a toggle that rounds each person's share up to the next whole number, and show how much extra that adds.", { state: "pushed", request: ask, createdAt: now - 14 * m, note: 'Added a "Round up each share" switch; shows the extra in a row under Total.', noteAt: now - 4 * m, review: { state: "approved", at: now - 2 * m, notes: "Works at phone size: 3 people on 47.50 with 15% gives 19 each and 2.38 extra. Toggle state is clear." } }),
    mk("f1", "Add a Copy button next to the per-person amount that copies it to the clipboard.", { state: "pushed", request: ask, createdAt: now - 14 * m, note: 'Copy button next to Each, with a "Copied" confirmation.', noteAt: now - 5 * m, review: { state: "changes", at: now - 1 * m, notes: "The button overlaps the amount on a 360 px screen. Move it under the amount or shrink the label." } }),
    ...mode === "full" ? [
      mk("c1", "Show the bill split as a short text you can paste into a group chat.", { state: "pushed", request: "Make it easy to send the split to friends", createdAt: now - 9 * m, note: 'Added "Share text" with the per-person line.', noteAt: now - 1 * m, review: { state: "reviewing", at: now - 4e4 } }),
      mk("w1", "Add a currency picker with EUR, USD, GBP and ILS.", { request: "Make it easy to send the split to friends", createdAt: now - 3 * m }),
      mk("b1", "Support splitting unevenly by item.", { state: "blocked", request: "Uneven splits", createdAt: now - 30 * m, note: "Should items be typed in, or picked from a photo of the receipt?", noteAt: now - 20 * m })
    ] : []
  ];
  const info = {
    slug: "eyal.tipsplit",
    owner: "eyal",
    name: "tipsplit",
    description: "Split a bill: amount, tip, people.",
    repo: "eyal.tipsplit",
    remote: "",
    forkedFrom: "forq.tipsplit",
    createdAt: now - 5 * 864e5,
    entry: "",
    kind: "static",
    agents,
    lastRequest: mode === "planning" ? { text: "Add a history of past bills", at: now - 12e3, state: "sent", sentAt: now - 9e3 } : mode === "empty" ? void 0 : { text: "Make it easy to send the split to friends", at: now - 9 * m, state: "sent", sentAt: now - 9 * m }
  };
  const busy = { awake: true, taskSent: true, cc: "working" };
  const status = { "eyal.tipsplit--w1": busy, "eyal.tipsplit--b1": { awake: true, taskSent: true, cc: "idle" } };
  const router = mode === "planning" ? busy : { awake: false, cc: "asleep" };
  const entry = { slug: info.slug, owner: "eyal", name: "tipsplit", description: info.description, forkedFrom: "forq.tipsplit", createdAt: info.createdAt, updatedAt: now - 4 * m };
  const overview = { kind: "static", entry: "", commits: [], files: [{ name: "index.html", dir: false }, { name: "README.md", dir: false }, { name: "LICENSE", dir: false }], readme: "# Tip split\n\nSplit a restaurant bill: type the amount, pick a tip, set how many people. One HTML file, no dependencies." };
  return { info, entry, overview, status, router };
}
__name(fixtureData, "fixtureData");

// ../src/v3.ts
var VIEW_IDS = ["readme", "changes", "app", "code", "history", "more", "agents", "errors"];
function docRank(path2) {
  const name = path2.split("/").pop();
  const base = name.replace(/\.[a-z]+$/i, "").toUpperCase();
  const isText = /\.(md|markdown|mdx|txt|rst)$/i.test(name) || /^(LICEN[CS]E|COPYING|AUTHORS|NOTICE|CHANGELOG|CHANGES)$/i.test(name);
  if (!isText) return null;
  if (path2.includes("/")) return /\.(md|markdown)$/i.test(name) ? 5 : null;
  if (base === "README") return 0;
  if (base === "CONTRIBUTING") return 1;
  if (/^(CHANGELOG|CHANGES|HISTORY|NEWS|RELEASES)$/.test(base)) return 2;
  if (/^(AGENTS|CLAUDE)$/.test(base)) return 3;
  if (/^(LICEN[CS]E|COPYING|NOTICE)$/.test(base)) return 9;
  return 4;
}
__name(docRank, "docRank");
var docLabel = /* @__PURE__ */ __name((path2) => path2.replace(/\.(md|markdown|mdx|txt|rst)$/i, ""), "docLabel");
var I = /* @__PURE__ */ __name((d) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`, "I");
var ICONS = {
  changes: I('<path d="M4 5h16v11H9l-5 4z"/>'),
  app: I('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>'),
  code: I('<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>'),
  history: I('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  more: I('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
  agents: I('<rect x="5" y="8" width="14" height="11" rx="2"/><path d="M12 4v4M9 13h.01M15 13h.01"/>'),
  errors: I('<path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/>'),
  about: I('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>'),
  readme: I('<path d="M5 4h10l4 4v12H5z"/><path d="M14 4v5h5M8.5 13h7M8.5 16.5h5"/>')
};
var needsOf = /* @__PURE__ */ __name((open) => open.filter((c) => primary(c)), "needsOf");
var FOOT = `<p class="foot3"><a href="/about">About</a><a href="/privacy">Privacy</a><a href="/feedback" data-fb>Feedback</a></p>
<script>for(const a of document.querySelectorAll('a[data-fb]'))a.href='/feedback?from='+encodeURIComponent(location.pathname+location.search);<\/script>`;
var askBox = /* @__PURE__ */ __name((c) => c.needsKey ? `<div class="compose">${keyNote}</div>` : `<div class="compose"><form class="ask"><textarea rows="1" placeholder="Ask for a change" enterkeyhint="send" aria-label="Ask for a change"></textarea>${SEND}</form></div>`, "askBox");
function changesView(c) {
  return {
    body: `<div class="thread"><div class="tin" id="live">${liveChanges(c)}</div></div>`,
    compose: askBox(c),
    poll: true,
    // Your message and a "Sending" line appear at the bottom at once; the poll replaces both.
    js: `window.forqAsked=(t)=>{const th=document.getElementById('live');for(const p of th.querySelectorAll('.plan,.hello'))p.remove();const e=document.createElement('div');e.className='you';e.textContent=t;th.appendChild(e);th.insertAdjacentHTML('beforeend','<div class="plan busy">Sending</div>');};`
  };
}
__name(changesView, "changesView");
function liveChanges(c) {
  const { info, open, done, plan } = c;
  const now = Date.now();
  const groups = [];
  for (const ch of [...open].sort((x, y) => x.a.createdAt - y.a.createdAt)) {
    const text = ch.a.request || "";
    const g = groups.find((x) => x.text === text);
    if (g) g.changes.push(ch);
    else groups.push({ text, at: ch.a.createdAt, changes: [ch] });
  }
  const q = info.lastRequest;
  if (q && !isMerge(q.text) && !groups.some((g) => g.text === q.text) && (q.state !== "sent" || plan.line || Date.now() - q.at < 15 * 6e4)) groups.push({ text: q.text, at: q.at, changes: [] });
  const accent = accentOf([...open].sort((x, y) => ORDER.indexOf(x.state) - ORDER.indexOf(y.state)));
  const out = groups.map((g, i) => {
    const you = !g.text ? "" : fromIssues2(g.text) ? `<div class="you sys"><b>Cloudflare Issues reported an error</b>${esc4(g.text.replace(/^Production error from Cloudflare Issues:\s*/, "").slice(0, 220))}</div>` : `<div class="you">${esc4(g.text)}</div>`;
    const last = i === groups.length - 1;
    const tail = last && !(q && isMerge(q.text)) ? `${planningHtml(plan, q)}${plan.said ? `<div class="said">${esc4(plan.said)}</div>` : ""}` : "";
    return `${you}${g.changes.map((ch) => changeRow(info, ch, now, accent)).join("")}${tail}`;
  });
  if (q && isMerge(q.text)) out.push(planningHtml(plan, q));
  const merged = done.length ? `<a class="older" href="${c.base}/history">${done.length} merged change${done.length > 1 ? "s" : ""} in History</a>` : "";
  const fresh = info.forkedFrom && !info.agents.length && !q;
  const empty = !out.join("").trim() ? fresh ? `<div class="hello"><b>This is your copy.</b><p>Forked from <a href="/p/${esc4(info.forkedFrom.replace(".", "/"))}">${esc4(info.forkedFrom.replace(".", " / "))}</a>. Say what to change below, in plain words: qodebase splits it into tasks, an agent does each one, and a reviewer checks it before you merge. The original is not touched.</p></div>` : `<div class="hello"><b>Nothing in progress.</b><p>Ask for a change in plain words. qodebase splits it into tasks, an agent does each one on its own fork, and a reviewer checks it before you merge.</p></div>` : "";
  return `<template id="needs" data-n="${needsOf(open).length}"></template>${merged}${empty}${out.join("")}${legend(open.length)}`;
}
__name(liveChanges, "liveChanges");
function appView(c) {
  const app2 = appUrl(c);
  const tryable = c.own ? c.open.filter((ch) => ch.tryUrl) : [];
  const sel = tryable.find((ch) => shortId(ch.a.id) === c.tryAgent);
  const src = sel?.tryUrl || app2;
  const picker = tryable.length ? `<div class="pick" role="tablist"><button type="button" role="tab" data-pick="${esc4(app2)}" class="${sel ? "" : "on"}">Live</button>${tryable.map((ch) => `<button type="button" role="tab" data-pick="${esc4(ch.tryUrl)}" data-agent="${esc4(shortId(ch.a.id))}" data-state="${ch.state}" data-id="${esc4(ch.a.id)}" data-word="${esc4(ch.word)}" class="${sel === ch ? "on" : ""}"><span class="dot s-${ch.state}"></span>${esc4(ch.title)}</button>`).join("")}</div>
<div class="pstrip" id="pstrip"${sel ? "" : " hidden"}><span id="pword">${sel ? esc4(sel.word) : ""}</span><button type="button" class="btn" id="pmerge"${sel?.state === "ready" ? "" : " hidden"}>Merge</button></div>` : "";
  return {
    full: true,
    action: app2 ? `<a class="hact" id="ext" href="${esc4(src)}" target="_blank" rel="noopener" aria-label="Open the app in a new tab">${OPEN_ICON_C}</a>` : "",
    body: `${picker}${app2 ? `<iframe id="app" src="${esc4(src)}" title="${esc4(c.info.name)}"></iframe>` : noApp(c)}${c.own ? "" : `<div class="forkbar">${VISIT}${forkAction(c.info, c.me, c.forks.filter((e) => e.owner === c.me))}</div>`}`,
    js: `(function(){const f=document.getElementById('app'),x=document.getElementById('ext'),ps=document.getElementById('pstrip'),pm=document.getElementById('pmerge');let cur=null;
document.addEventListener('click',async(e)=>{const b=e.target.closest('[data-pick]');if(b){f.src=b.dataset.pick;if(x)x.href=b.dataset.pick;for(const o of document.querySelectorAll('[data-pick]'))o.classList.toggle('on',o===b);
 cur=b.dataset.id||null;if(ps){ps.hidden=!cur;document.getElementById('pword').textContent=b.dataset.word||'';pm.hidden=b.dataset.state!=='ready';}
 history.replaceState(null,'',location.pathname+(b.dataset.agent?'?try='+b.dataset.agent:''));return;}
 if(e.target===pm){pm.disabled=true;pm.textContent='Merging';try{await post('merge',{agent:cur});location.href=location.pathname;}catch(err){pm.textContent=err.message;}}});
if(${JSON.stringify(sel?.a.id || "")})cur=${JSON.stringify(sel?.a.id || "")};})();`
  };
}
__name(appView, "appView");
function historyView(c) {
  const now = Date.now();
  const items = [];
  for (const ch of c.done) items.push({ at: ch.a.noteAt || ch.a.createdAt, html: `<span class="k">Merged</span><span class="t">${esc4(ch.title)}</span><a class="sub" href="/p/${c.info.owner}/${c.info.name}/changes/${shortId(ch.a.id)}">See the code</a>` });
  for (const cm of c.overview.commits) if (!/^Merge /.test(cm.message)) items.push({ at: cm.at, html: `<span class="k">Commit</span><span class="t">${esc4(cm.message)}</span><code class="sub">${esc4(cm.hash.slice(0, 7))}</code>` });
  const dep = c.overview.app ?? c.info.app;
  if (dep?.status === "live") items.push({ at: dep.at, html: `<span class="k">Deployed</span><span class="t"><a href="${esc4(dep.url || "")}" target="_blank" rel="noopener">${esc4((dep.url || "").replace("https://", ""))}</a></span>` });
  for (const f of c.forks) items.push({ at: f.createdAt, html: `<span class="k">Forked</span><span class="t"><a href="${path(f.slug)}">${esc4(label(f.slug))}</a></span>` });
  items.push({ at: c.info.createdAt, html: `<span class="k">${c.info.forkedFrom ? "Forked from" : c.info.importedFrom ? "Imported" : "Created"}</span><span class="t">${c.info.forkedFrom ? `<a href="${path(c.info.forkedFrom)}">${esc4(label(c.info.forkedFrom))}</a>` : c.info.importedFrom ? `<a href="${esc4(c.info.importedFrom.url)}" rel="noopener">${esc4(c.info.importedFrom.fullName)}</a>` : esc4(c.info.name)}</span>` });
  items.sort((a, b) => b.at - a.at);
  const day2 = /* @__PURE__ */ __name((t) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: new Date(t).getFullYear() === (/* @__PURE__ */ new Date()).getFullYear() ? void 0 : "numeric" }), "day");
  let last = "";
  const rows = items.map((it) => {
    const d = day2(it.at);
    const h = d !== last ? `<h3>${d}</h3>` : "";
    last = d;
    return `${h}<div class="hi">${it.html}${freshTag(it.at, now, STEPS)}</div>`;
  }).join("");
  return { body: `<div class="pad">${rows}${legend(items.length)}</div>` };
}
__name(historyView, "historyView");
function agentsView(c) {
  return { body: `<div class="pad" id="live">${liveAgents(c)}</div>`, poll: true };
}
__name(agentsView, "agentsView");
function liveAgents(c) {
  const { info, router, reviewer, open, plan } = c;
  const row2 = /* @__PURE__ */ __name((id, name, word, busy, sub = "") => `<div class="ag${busy ? " busy" : ""}"><div class="agh"><span class="dot ${busy ? "s-working" : ""}"></span><b>${esc4(name)}</b><span class="w">${word}</span></div>${sub}
<div class="acts"><button type="button" class="chipbtn" data-sheet="${esc4(id)}" data-name="${esc4(name)}" data-mode="chat">Chat</button><button type="button" class="chipbtn" data-sheet="${esc4(id)}" data-name="${esc4(name)}" data-mode="term">Terminal</button></div></div>`, "row");
  const doing = info.agents.find((a) => a.review?.state === "reviewing");
  const st = /* @__PURE__ */ __name((s) => s.awake ? BUSY2.test(s.cc) ? "Working" : "Idle" : "Asleep", "st");
  return `<p class="lede">Every change is made by its own agent, on its own fork, in its own container. These are their conversations and terminals.</p>
${row2(`${info.slug}--router`, "Router agent", plan.line || st(router), !!plan.line || BUSY2.test(router.cc), '<p class="sub">Reads your requests and starts one agent per task. Does the merges.</p>')}
${row2(`${info.slug}--review`, "Reviewer agent", doing ? "Reviewing" : st(reviewer), !!doing, '<p class="sub">Tries every push in a preview before you merge.</p>')}
${open.length ? "<h3>Change agents</h3>" : ""}${open.map((ch) => row2(ch.a.id, ch.title, `${esc4(ch.word)} <code>${esc4(shortId(ch.a.id))}</code>`, ch.busy)).join("")}`;
}
__name(liveAgents, "liveAgents");
function errorsView(c) {
  const now = Date.now();
  const all = [...c.open, ...c.done].filter((ch) => fromIssues2(ch.a.request)).sort((x, y) => y.a.createdAt - x.a.createdAt);
  const q = c.info.lastRequest;
  const pending = q && fromIssues2(q.text) && !all.some((ch) => ch.a.request === q.text) ? `<div class="you sys"><b>Reported ${freshTag(q.at, now, STEPS)}</b>${esc4(q.text.replace(/^Production error from Cloudflare Issues:\s*/, "").slice(0, 300))}</div>${planningHtml(c.plan, q)}` : "";
  return { body: `<div class="pad"><p class="lede">When this app throws errors in production, Cloudflare Issues reports them here and the router agent starts a fix: it reproduces the error first, then hands it to an agent.</p>
${pending}${all.map((ch) => changeRow(c.info, ch, now, accentOf(c.open))).join("") || (pending ? "" : '<p class="empty">No production errors reported.</p>')}</div>` };
}
__name(errorsView, "errorsView");
function readmeView(c) {
  const { info, forks } = c;
  const d = c.docs || { list: [], current: null, text: null };
  const cur = d.current;
  const chips = d.list.length > 1 ? `<nav class="docs" aria-label="Documents">${d.list.map((x) => `<a href="${c.base}/readme${x.path === d.list[0].path ? "" : `?doc=${encodeURIComponent(x.path)}`}" class="${x.path === cur ? "on" : ""}"${x.path === cur ? ' aria-current="page"' : ""}>${esc4(x.label)}</a>`).join("")}</nav>` : "";
  const isMd = cur && /\.(md|markdown|mdx)$/i.test(cur);
  const doc = !cur ? `<p class="empty">This project has no README yet.${c.own ? ' Ask for one in <a href="' + c.base + '/changes">Changes</a>.' : ""}</p>` : d.text == null ? `<p class="empty">This file could not be shown. <a href="/p/${info.owner}/${info.name}/code/${esc4(cur)}">Open it in Code</a>.</p>` : isMd ? `<div class="readme">${markdown(d.text)}</div>` : `<pre class="plain">${esc4(d.text)}</pre>`;
  const origin = [
    info.forkedFrom ? `Forked from <a href="${path(info.forkedFrom)}">${esc4(label(info.forkedFrom))}</a>` : "",
    info.importedFrom ? `From <a href="${esc4(info.importedFrom.url)}" rel="noopener">${esc4(info.importedFrom.fullName)}</a> on GitHub` : "",
    forks.length ? `${forks.length} fork${forks.length > 1 ? "s" : ""}` : ""
  ].filter(Boolean);
  return { body: `<div class="pad">${info.description ? `<p class="big">${esc4(info.description)}</p>` : ""}${origin.length ? `<p class="lede">${origin.join(". ")}.</p>` : ""}
${c.own ? "" : `<div class="forkbar in">${VISIT}${forkAction(info, c.me, forks.filter((e) => e.owner === c.me))}</div>`}
${chips}${doc}${cur ? `<p class="srcl"><a href="/p/${info.owner}/${info.name}/code/${esc4(cur)}">${esc4(cur)} in Code</a></p>` : ""}${FOOT}</div>` };
}
__name(readmeView, "readmeView");
function moreMenu(c) {
  const extra = VIEWS.filter((v) => !v.tab && v.when(c));
  return `${c.own ? visibilityRow(c) : ""}<div class="menu">${extra.map((v) => `<a class="mi" href="${c.base}/${v.id}">${v.icon}<span><b>${v.label}</b><span>${v.desc}</span></span></a>`).join("")}
<a class="mi" href="/settings">${ICONS.about}<span><b>Account</b><span>Your name${c.own ? "" : ", your Anthropic API key"}, sign out</span></span></a>
<a class="mi" href="/">${ICONS.app}<span><b>All projects</b><span>Your projects and Explore</span></span></a>
<a class="mi" href="/feedback" data-fb>${ICONS.changes}<span><b>Feedback</b><span>Something missing, confusing or broken? Tell us.</span></span></a></div>`;
}
__name(moreMenu, "moreMenu");
function moreView(c) {
  return { body: `<div class="pad">${moreMenu(c)}</div>` };
}
__name(moreView, "moreView");
function visibilityRow(c) {
  const pv = !!c.info.private;
  return `<div class="visrow"><div><b>${pv ? `${LOCK} Private` : "Public"}</b><span>${pv ? "Only you can see this project, its code and its app." : "Anyone can see this project, try its app and fork it."}</span></div>
<button type="button" class="chipbtn" data-visto="${pv ? "public" : "private"}">${pv ? "Make public" : "Make private"}</button></div>
<p class="err" data-vismsg role="status"></p>
<script>(function(){if(window.__visBound)return;window.__visBound=1;
// The menu can be on the page twice (the More view and the More sheet): one handler for every button.
document.addEventListener('click',async(e)=>{const b=e.target.closest&&e.target.closest('[data-visto]');if(!b)return;
document.querySelectorAll('[data-visto]').forEach((x)=>x.disabled=true);
const r=await fetch('/api/p/${esc4(c.info.owner)}/${esc4(c.info.name)}/visibility',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({private:b.dataset.to==='private'})});
if(r.ok)location.reload();else{document.querySelectorAll('[data-visto]').forEach((x)=>x.disabled=false);document.querySelectorAll('[data-vismsg]').forEach((m)=>m.textContent='Could not change it. Try again.');}});})();<\/script>`;
}
__name(visibilityRow, "visibilityRow");
var VIEWS = [
  { id: "readme", label: "Readme", icon: ICONS.readme, tab: true, when: /* @__PURE__ */ __name(() => true, "when"), render: readmeView },
  { id: "changes", label: "Changes", icon: ICONS.changes, tab: true, when: /* @__PURE__ */ __name((c) => c.own, "when"), render: changesView },
  { id: "app", label: "App", icon: ICONS.app, tab: true, when: /* @__PURE__ */ __name(() => true, "when"), render: appView },
  { id: "code", label: "Code", icon: ICONS.code, tab: true, when: /* @__PURE__ */ __name(() => true, "when"), href: /* @__PURE__ */ __name((c) => `/p/${c.info.owner}/${c.info.name}/code/`, "href") },
  { id: "more", label: "More", icon: ICONS.more, tab: true, when: /* @__PURE__ */ __name((c) => c.own, "when"), render: moreView },
  { id: "history", label: "History", icon: ICONS.history, desc: "Merged changes, commits, deploys and forks, by day", when: /* @__PURE__ */ __name(() => true, "when"), render: historyView },
  { id: "agents", label: "Agents", icon: ICONS.agents, desc: "The router, the reviewer and each change's agent: chat or terminal", when: /* @__PURE__ */ __name((c) => c.own, "when"), render: agentsView },
  { id: "errors", label: "Errors", icon: ICONS.errors, desc: "Production errors from Cloudflare Issues and the fixes they started", when: /* @__PURE__ */ __name((c) => c.worker, "when"), render: errorsView }
];
function tabsFor(c) {
  return c.own ? VIEWS.filter((v) => v.tab && v.when(c)) : VIEWS.filter((v) => ["readme", "app", "code", "history"].includes(v.id));
}
__name(tabsFor, "tabsFor");
function tabBar(c, active, needs, top2 = false) {
  const tabs = tabsFor(c);
  return `<nav class="${top2 ? "ptop" : "tabbar"}" aria-label="Project views">${tabs.map((v) => {
    const on = v.id === active || v.id === "more" && !tabs.some((t) => t.id === active);
    const href = v.href ? v.href(c) : `${c.base}/${v.id}`;
    if (v.id === "more") return `<a href="${href}" class="tab${on ? " on" : ""}" data-more aria-expanded="false" aria-controls="moresheet">${v.icon}<span>${v.label}</span></a>`;
    const badge = v.id === "changes" && needs ? `<span class="badge" id="badge">${needs}</span>` : v.id === "changes" ? '<span class="badge" id="badge" hidden></span>' : "";
    return `<a href="${href}" class="tab${on ? " on" : ""}"${on ? ' aria-current="page"' : ""}>${v.icon}${badge}<span>${v.label}</span></a>`;
  }).join("")}</nav>`;
}
__name(tabBar, "tabBar");
var V3_CSS = `
body.v3{height:100dvh;display:flex;flex-direction:column;overflow:hidden}
.h3{flex:none;display:flex;align-items:center;gap:4px;height:48px;padding:0 4px 0 4px;border-bottom:1px solid var(--line);background:var(--bg)}
.h3 .home{font-weight:600;color:var(--fg);min-height:44px;display:inline-flex;align-items:center;padding:0 10px}
.h3 .nm{flex:1;min-width:0;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.h3 .nm .o{color:var(--dim)}
.h3 .nm b{font-weight:600}
.hact{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;color:var(--fg)}
.hact .ico{width:18px;height:18px}
.ico{width:14px;height:14px;flex:none}
.view{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain}
.view.full{display:flex;flex-direction:column;overflow:hidden}
.pad{padding:16px 16px 24px;max-width:760px;margin:0 auto}
.lede{color:var(--dim);font-size:14px;margin:0 0 16px}
.big{font-size:17px;margin:0 0 8px}
h3{font-size:13px;font-weight:600;color:var(--dim);margin:24px 0 8px}
.pad>h3:first-child{margin-top:4px}
/* Changes: a scroller that starts at the bottom without script (column-reverse). */
.thread{height:100%;overflow-y:auto;display:flex;flex-direction:column-reverse;overscroll-behavior:contain}
.tin{display:flex;flex-direction:column;gap:10px;padding:16px 12px 12px;max-width:760px;width:100%;margin:0 auto}
.tin>*{flex:none}
.you{align-self:flex-end;max-width:86%;background:var(--chip);color:var(--fg);border-radius:12px 12px 4px 12px;padding:10px 14px;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:8px}
.you.sys{align-self:stretch;max-width:none;background:none;border:1px solid var(--line);border-radius:12px;font-size:14px}
.you.sys b{display:block;font-weight:600;margin-bottom:2px}
.older{align-self:center;font-size:13px;padding:8px 12px}
.hello{margin:auto 0 0;padding:24px 8px;color:var(--dim);font-size:15px}
.hello b{display:block;color:var(--fg);font-size:17px;margin-bottom:4px}
.hello p{margin:0}
.compose{flex:none;border-top:1px solid var(--line);padding:8px 12px;background:var(--bg)}
.compose .ask{display:flex;gap:8px;align-items:flex-end;max-width:760px;margin:0 auto}
.compose .ask textarea{flex:1;min-height:44px;max-height:160px;padding:10px 12px}
/* App */
.view.full iframe{flex:1;width:100%;border:0;display:block;background:#fff}
.pick{flex:none;display:flex;gap:6px;padding:8px 12px;overflow-x:auto;scrollbar-width:none;border-bottom:1px solid var(--line)}
.pick::-webkit-scrollbar{display:none}
.pick button{flex:none;display:inline-flex;align-items:center;gap:6px;min-height:36px;max-width:min(70vw,280px);padding:0 12px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--dim);font:500 14px 'Instrument Sans',sans-serif;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pick button.on{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.pstrip{flex:none;display:flex;align-items:center;gap:8px;padding:6px 8px 6px 14px;background:var(--card);border-bottom:1px solid var(--line);font-size:14px;color:var(--dim)}
.pstrip span{flex:1}
.pstrip .btn{min-height:36px;padding:0 14px;font-size:14px}
.noapp{flex:1;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;color:var(--dim)}
.forkbar{flex:none;padding:8px 12px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:8px}
.forkbar.in{border:0;padding:0;margin:8px 0 0}
.forkbar .btn{width:100%}
/* History */
.hi{display:flex;align-items:baseline;gap:10px;padding:10px 0;border-bottom:1px solid var(--line);font-size:15px}
.hi .k{flex:none;width:6.5em;color:var(--dim);font-size:13px}
.hi .t{flex:1;min-width:0;overflow-wrap:anywhere}
.hi .sub{display:none}
.hi code{font:12px 'JetBrains Mono',monospace;color:var(--dim)}
.hi button.fresh{flex:none}
@media (min-width:600px){.hi .sub{display:inline;font-size:13px;flex:none}}
/* Agents */
.ag{background:var(--card);border-radius:12px;padding:12px 14px;margin-bottom:8px}
.agh{display:flex;align-items:center;gap:8px;font-size:15px}
.agh b{flex:1;min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.agh .w{font-size:13px;color:var(--dim);font-variant-numeric:tabular-nums;white-space:nowrap}
.agh code{font:12px 'JetBrains Mono',monospace}
.ag .sub{margin:4px 0 0;font-size:14px;color:var(--dim)}
.ag .acts{margin-top:10px}
/* More */
.menu{display:flex;flex-direction:column}
.mi{display:flex;align-items:center;gap:14px;padding:14px 4px;border-bottom:1px solid var(--line);color:var(--fg)}
.mi svg{flex:none;color:var(--dim)}
.mi b{display:block;font-weight:600}
.mi span span{display:block;color:var(--dim);font-size:14px}
/* Readme: the project's documents as a row of tabs over the rendered file. */
.docs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:16px -16px 8px;padding:0 16px 10px;border-bottom:1px solid var(--line)}
.docs::-webkit-scrollbar{display:none}
.docs a{flex:none;display:inline-flex;align-items:center;min-height:36px;padding:0 12px;border-radius:8px;border:1px solid var(--line);color:var(--dim);font:500 14px 'Instrument Sans',sans-serif}
.docs a.on{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.plain{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.55 'JetBrains Mono',monospace;background:var(--card);border-radius:8px;padding:12px}
.srcl{font-size:13px;margin:24px 0 0}
.forkbar.in .visit{margin:0}
/* More: a sheet over the current view, toggled by its tab. */
.scrim3{position:fixed;inset:0;z-index:24;background:rgb(0 0 0 / .25);opacity:0;pointer-events:none;transition:opacity .2s}
.scrim3.on{opacity:1;pointer-events:auto}
.moresheet{position:fixed;left:0;right:0;bottom:calc(57px + env(safe-area-inset-bottom));z-index:25;max-width:720px;margin:0 auto;background:var(--bg);border:1px solid var(--line);border-bottom:0;border-radius:16px 16px 0 0;box-shadow:0 -8px 32px rgb(0 0 0 / .16);padding:4px 16px;transform:translateY(calc(100% + 60px));transition:transform .22s ease;visibility:hidden}
.moresheet.open{transform:none;visibility:visible}
.moresheet .mi:last-child{border-bottom:0}
.tab[data-more].open{color:var(--fg)}
.tabbar{position:relative;z-index:26}
@media (min-width:900px){.moresheet{left:88px;right:auto;bottom:16px;width:360px;border:1px solid var(--line);border-radius:12px;transform:translateX(-12px);opacity:0;transition:opacity .15s,transform .15s}.moresheet.open{transform:none;opacity:1}}
.foot3{display:flex;gap:16px;margin:32px 0 8px;font-size:14px}
/* Tab bar: bottom on a phone, a left rail on a desktop. */
.tabbar{flex:none;display:flex;border-top:1px solid var(--line);background:var(--bg);padding-bottom:env(safe-area-inset-bottom)}
.tab{flex:1;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-height:56px;color:var(--dim);font-size:12px;font-weight:500}
.tab.on{color:var(--fg)}
.tab.on svg{stroke-width:2.2}
.badge{position:absolute;top:6px;left:calc(50% + 6px);min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--warn);color:#fff;font-size:11px;font-weight:600;line-height:18px;text-align:center;font-variant-numeric:tabular-nums}
body.typing .tabbar{display:none}
@media (min-width:900px){
 body.v3{display:grid;grid-template-columns:80px 1fr;grid-template-rows:48px 1fr auto}
 .tabbar{grid-column:1;grid-row:1 / 4;flex-direction:column;justify-content:flex-start;border-top:0;border-right:1px solid var(--line);padding:56px 0 0}
 .tab{flex:none;min-height:64px}
 .h3,.view,.compose{grid-column:2}
 body.typing .tabbar{display:flex}
}
@media (hover:hover){.tab:hover{color:var(--fg)}.mi:hover{background:var(--card)}}

.priv{display:inline-flex;align-items:center;gap:4px;color:var(--dim)}.lockic{flex:none}
.visrow{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0 16px;border-bottom:1px solid var(--line);margin-bottom:8px}
.visrow b{display:inline-flex;align-items:center;gap:6px;font-weight:600}.visrow span{display:block;color:var(--dim);font-size:14px;margin-top:2px}
.visrow .chipbtn{flex:none;min-height:44px}
`;
function projectV3(o) {
  const g = o.g || { nav: "c", inbox: 0 };
  const { info, me } = o;
  const own = info.owner === me;
  const worker = (o.overview.kind ?? info.kind) === "worker";
  const { open, done } = changesOf(info, o.status, o.runBase);
  const c = { ...o, own, worker, base: o.base || `/p/${info.owner}/${info.name}`, status: o.status, router: o.router, reviewer: o.reviewer, open, done, plan: planningOf(info, o.router), tryAgent: o.tryAgent, docs: o.docs };
  let id = o.view || "readme";
  let v = VIEWS.find((x) => x.id === id && x.when(c) && x.render);
  if (!v) {
    id = "readme";
    v = VIEWS.find((x) => x.id === id);
  }
  const r = v.render(c);
  const needs = own ? needsOf(open).length : 0;
  const home = g.nav === "a" ? `<a class="home back" href="/" aria-label="All projects${g.inbox ? `, ${g.inbox} need you` : ""}">${CHEV}qodebase${g.inbox ? `<span class="hbadge">${g.inbox}</span>` : ""}</a>` : `<a class="home" href="/" aria-label="All projects">qodebase</a>`;
  return shell2(g.nav, `${v.label} \xB7 ${info.owner}/${info.name} \xB7 qodebase`, `${g.nav === "d" ? globalTop(own ? "projects" : "explore", g.inbox, me) : ""}
<header class="h3${g.nav === "d" ? " sub" : ""}">${g.nav === "d" ? "" : home}<a class="nm" href="${c.base}" style="color:inherit"><span class="o">${esc4(info.owner)} /</span> <b>${esc4(info.name)}</b>${info.private ? ` <span class="priv" title="Private: only you">${LOCK}</span>` : ""}</a>${r.action || ""}</header>
${g.nav === "b" ? tabBar(c, id, needs, true) : ""}
<main class="view${r.full ? " full" : ""}" id="view">${r.body}</main>${r.compose || (own ? askBox(c) : "")}
${g.nav === "b" ? globalBar("projects", g.inbox, me) : tabBar(c, id, needs)}
${own ? `<div class="scrim3" id="scrim3"></div><div class="moresheet" id="moresheet" aria-hidden="true">${moreMenu(c)}</div>` : ""}
${own ? SHEET_HTML : ""}${pageJs(info, r.poll ? `?view=${id}` : "?view=none")}${FORK_JS}
<script>
${r.poll ? "" : "clearTimeout(timer);"}
window.forqAfterPoll=(j)=>{const n=document.getElementById('needs');const b=document.getElementById('badge');if(n&&b){const k=Number(n.dataset.n);b.hidden=!k;b.textContent=k;}};
// "Try it" in a change opens the App view on that change.
forqTry=(src,title,agent)=>{location.href='${c.base}/app?try='+encodeURIComponent(agent.split('--')[1]||agent);};
// More toggles a sheet over the current view; tap More again (or outside) to close it.
(function(){const ms=document.getElementById('moresheet'),sc=document.getElementById('scrim3'),mt=document.querySelector('[data-more]');if(!ms||!mt)return;
 const set=(on)=>{ms.classList.toggle('open',on);sc.classList.toggle('on',on);mt.classList.toggle('open',on);mt.setAttribute('aria-expanded',on);ms.setAttribute('aria-hidden',!on);};
 mt.addEventListener('click',(e)=>{e.preventDefault();set(!ms.classList.contains('open'));});
 sc.addEventListener('click',()=>set(false));document.addEventListener('keydown',(e)=>{if(e.key==='Escape')set(false);});})();
// The keyboard covers half a phone: hide the tab bar while typing.
document.addEventListener('focusin',(e)=>{if(e.target.matches('textarea,input'))document.body.classList.add('typing');});
// \u2026and bring it back only after focus has really left, so nothing moves under a tap.
document.addEventListener('focusout',()=>setTimeout(()=>{if(!document.activeElement?.matches('textarea,input'))document.body.classList.remove('typing');},250));
${!r.compose && own ? `window.forqAskedGo='${c.base}/changes';` : ""}
${r.js || ""}
<\/script>`, V3_CSS + NAV_CSS, `v3 nav-${g.nav}`);
}
__name(projectV3, "projectV3");
function liveV3(view2, o) {
  const own = o.info.owner === o.me;
  const { open, done } = changesOf(o.info, o.status, o.runBase);
  const c = { ...o, own, worker: o.info.kind === "worker", base: `/p/${o.info.owner}/${o.info.name}`, open, done, plan: planningOf(o.info, o.router) };
  return view2 === "agents" ? liveAgents(c) : liveChanges(c);
}
__name(liveV3, "liveV3");
function withTabs(html4, info, me, g = { nav: "c", inbox: 0 }) {
  const own = info.owner === me;
  const { open } = changesOf(info, {}, "");
  const pc = { own, base: `/p/${info.owner}/${info.name}`, worker: info.kind === "worker", info };
  const n = own ? needsOf(open).length : 0;
  if (g.nav === "b") {
    const css2 = `<style>${V3_CSS.slice(V3_CSS.indexOf("/* Tab bar"))}${NAV_CSS}
.tabbar{position:fixed;left:0;right:0;bottom:0;z-index:30}
body{padding-bottom:calc(64px + env(safe-area-inset-bottom))}
.ptop{position:sticky;top:0;z-index:20;margin:0 0 8px}
@media (min-width:900px){.tabbar{right:auto;top:0;bottom:0;width:80px}body{padding-bottom:0;padding-left:80px}}
.badge{position:absolute}</style>`;
    return html4.replace("</head>", `${css2}</head>`).replace(/<body([^>]*)>/, `<body$1>${tabBar(pc, "code", n, true)}`).replace("</body>", `${globalBar("projects", g.inbox, me)}</body>`);
  }
  if (g.nav === "d") {
    const css2 = `<style>${V3_CSS.slice(V3_CSS.indexOf("/* Tab bar"))}${NAV_CSS}
.tabbar{position:fixed;left:0;right:0;bottom:0;z-index:30}
body{padding-bottom:calc(64px + env(safe-area-inset-bottom))}
.gtop{margin:0 0 8px}
@media (min-width:900px){.tabbar{right:auto;top:48px;bottom:0;width:80px}body{padding-bottom:0;padding-left:80px}.gtop{margin-left:-80px}}
.badge{position:absolute}.gtop .badge{position:static}</style>`;
    return html4.replace("</head>", `${css2}</head>`).replace(/<body([^>]*)>/, `<body$1>${globalTop("projects", g.inbox, me)}`).replace("</body>", `${tabBar(pc, "code", n)}</body>`);
  }
  const bar = tabBar(pc, "code", n);
  const css = `<style>${V3_CSS.slice(V3_CSS.indexOf("/* Tab bar"))}
.tabbar{position:fixed;left:0;right:0;bottom:0;z-index:30}
body{padding-bottom:calc(64px + env(safe-area-inset-bottom))}
@media (min-width:900px){.tabbar{right:auto;top:0;bottom:0;width:80px}body{padding-bottom:0;padding-left:80px}}
.badge{position:absolute}</style>`;
  return html4.replace("</head>", `${css}</head>`).replace("</body>", `${bar}</body>`);
}
__name(withTabs, "withTabs");
function fixtureV3(runBase, mode, view2, tryAgent, g) {
  const f = fixtureData(runBase, mode);
  const docs = { list: ["README.md", "CONTRIBUTING.md", "CHANGELOG.md", "docs/sharing.md", "LICENSE"].map((p) => ({ path: p, label: docLabel(p) })), current: "README.md", text: f.overview.readme };
  return projectV3({ info: f.info, entry: f.entry, forks: [], overview: f.overview, me: "eyal", runBase, liveHtml: "", view: view2, status: f.status, router: f.router, reviewer: { awake: true, cc: "idle" }, tryAgent, base: "/design-fixture", docs, g });
}
__name(fixtureV3, "fixtureV3");
var CHEV = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg>`;
var HI = {
  projects: I('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  inbox: I('<path d="M3 13h5l1.5 2.5h5L16 13h5"/><path d="M5.5 5h13L21 13v6H3v-6z"/>'),
  explore: I('<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>'),
  account: I('<circle cx="12" cy="9" r="3.5"/><path d="M5 20c1.2-3.5 4-5 7-5s5.8 1.5 7 5"/>'),
  home: I('<path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z"/>'),
  mine: I('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>')
};
function globalBar(active, inbox, me) {
  const tabs = me ? [["projects", "Projects", "/"], ["inbox", "Inbox", "/inbox"], ["explore", "Explore", "/explore"], ["account", "Account", "/settings"]] : [["explore", "Explore", "/"], ["account", "Sign in", "/login"]];
  return `<nav class="tabbar" aria-label="qodebase">${tabs.map(([id, labelT, href]) => {
    const on = id === active;
    const badge = id === "inbox" ? `<span class="badge"${inbox ? "" : " hidden"}>${inbox || ""}</span>` : "";
    return `<a href="${href}" class="tab${on ? " on" : ""}"${on ? ' aria-current="page"' : ""}>${HI[id]}${badge}<span>${labelT}</span></a>`;
  }).join("")}</nav>`;
}
__name(globalBar, "globalBar");
var NAV_CSS = `
.gtop{flex:none;display:flex;align-items:stretch;height:48px;padding:0 4px;border-bottom:1px solid var(--line);background:var(--bg);overflow-x:auto;scrollbar-width:none}
.gtop::-webkit-scrollbar{display:none}
.gtop .mark{display:flex;align-items:center;padding:0 10px 0 8px;font-weight:600;font-size:16px;color:var(--fg)}
.gtop .g{flex:none;display:flex;align-items:center;gap:6px;padding:0 7px;font:500 14px 'Instrument Sans',sans-serif;color:var(--dim);border-bottom:2px solid transparent}
.gtop .g.on{color:var(--fg);border-bottom-color:var(--fg)}
.gtop .gbuild{flex:none;align-self:center;margin-left:auto;min-height:34px;padding:0 12px;font-size:14px;border-radius:8px}
.gtop .gmenu{flex:none;align-self:center;display:inline-flex;align-items:center;justify-content:center;width:40px;height:44px;margin-left:0;border:0;background:none;color:var(--fg);cursor:pointer;-webkit-tap-highlight-color:transparent}
.gmenupop{position:fixed;inset:52px 8px auto auto;margin:0;width:min(300px,calc(100vw - 16px));padding:6px;border:1px solid var(--line);border-radius:12px;background:var(--bg);color:var(--fg);box-shadow:0 8px 32px rgb(0 0 0 / .16)}
.gmenupop a{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:8px;color:var(--fg);text-decoration:none}
.gmenupop a b{font-weight:500;font-size:15px}.gmenupop a span{font-size:13px;color:var(--dim)}
.gmenupop a[aria-current]{background:var(--card)}
@media (hover:hover){.gmenupop a:hover{background:var(--card)}}
/* Home, Explore, Yours, Inbox, Build: the page itself scrolls (so Chrome's pull-to-refresh
   works) under a sticky header. Project pages keep the app shell: their Changes thread
   scrolls on its own, starting at the bottom. */
body.v3.dhome{height:auto;min-height:100dvh;display:block;overflow:visible}
body.dhome>.gtop{position:sticky;top:0;z-index:20}
body.dhome>.view{overflow:visible;min-height:0}
.gtop .badge{position:static;margin:0;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--warn);color:#fff;font-size:11px;font-weight:600;line-height:18px;text-align:center}
.h3.sub{height:44px;background:var(--card)}
.h3.sub .nm{padding-left:12px}
@media (min-width:900px){body.nav-d{grid-template-rows:48px 44px 1fr auto}body.nav-d>.gtop{grid-column:1 / 3;grid-row:1}body.nav-d>.h3{grid-row:2}body.nav-d>.tabbar{grid-row:2 / 5;padding-top:8px}}
.h3 .home.back{gap:2px;padding-left:6px;position:relative}
.hbadge{margin-left:6px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--warn);color:#fff;font-size:11px;font-weight:600;line-height:18px;text-align:center}
.ptop{flex:none;display:flex;gap:2px;overflow-x:auto;scrollbar-width:none;border-bottom:1px solid var(--line);background:var(--bg);padding:0 8px}
.ptop::-webkit-scrollbar{display:none}
.ptop .tab{flex:none;flex-direction:row;gap:6px;min-height:44px;padding:0 12px;font-size:14px;border-bottom:2px solid transparent}
.ptop .tab svg{display:none}
@media (max-width:599px){.ptop{justify-content:space-between}}
.ptop .tab{padding:0 10px}
.ptop .tab.on{border-bottom-color:var(--fg)}
.ptop .badge{position:static;margin-left:2px}
@media (min-width:900px){body.nav-b{grid-template-rows:48px auto 1fr auto}body.nav-b .ptop{grid-column:2}body.nav-b>.tabbar{grid-row:1 / 5}}
.htitle{flex:1;font-size:15px;font-weight:600}
.home-list{display:flex;flex-direction:column;gap:8px}
.prow{position:relative;display:block;background:var(--card);border-radius:12px;padding:12px 14px;color:inherit}
.prow .t{display:block;font-size:15px;color:var(--fg)}
.prow .t b{font-weight:600}.prow .t .o{color:var(--dim)}
.prow .d{color:var(--dim);font-size:14px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prow .m{display:flex;align-items:center;gap:8px 12px;margin-top:8px;font-size:13px;color:var(--dim);white-space:nowrap;overflow:hidden}
.prow .m .st{display:inline-flex;align-items:center;gap:6px;font-weight:500}
.prow .m .st.ready{color:var(--acc)}.prow .m .st.fix{color:var(--warn)}.prow .m .st.working{color:var(--fg)}
.stretch::after{content:'';position:absolute;inset:0;border-radius:12px}
.prow button.fresh{position:relative;z-index:1}
.hrow{display:flex;align-items:center;gap:8px;margin:0 0 12px}
.hrow .btn,.hrow .chipbtn{min-height:40px;padding:0 14px;font-size:14px}
.ibx h3 a{color:var(--fg)}
.ibx .chg{margin-bottom:8px}
@media (hover:hover){.prow:hover{background:var(--chip)}}
`;
var LOCK = `<svg class="lockic" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
function projRow(e, now, st, forks = 0) {
  const s = !st ? "" : st.fix ? `<span class="st fix"><span class="dot s-fix"></span>${st.fix} need${st.fix > 1 ? "" : "s"} you</span>` : st.ready ? `<span class="st ready"><span class="dot s-ready"></span>${st.ready} ready to merge</span>` : st.working ? `<span class="st working"><span class="dot s-working"></span>${st.working} in progress</span>` : "";
  return `<div class="prow"><a class="t stretch" href="${path(e.slug)}"><span class="o">${esc4(e.owner)} /</span> <b>${esc4(e.name)}</b></a>
${e.description ? `<div class="d">${esc4(e.description)}</div>` : ""}
<div class="m">${e.private ? `<span class="priv">${LOCK}Private</span>` : ""}${s}${freshTag(e.updatedAt, now, STEPS)}${forks ? `<span>${forks} fork${forks > 1 ? "s" : ""}</span>` : ""}${e.importedFrom ? `<span>${e.importedFrom.stars >= 1e3 ? (e.importedFrom.stars / 1e3).toFixed(1) + "k" : e.importedFrom.stars} stars</span>` : ""}</div></div>`;
}
__name(projRow, "projRow");
function homeV3(nav, tab, entries, me, items, world = "projects", wopts = {}, selfHost = false) {
  const now = Date.now();
  const inboxN = items.reduce((n, it) => n + needsOf(it.open).length, 0);
  const forks = /* @__PURE__ */ __name((slug) => entries.filter((e) => e.forkedFrom === slug).length, "forks");
  const mine = entries.filter((e) => me && e.owner === me).sort((a, b) => b.updatedAt - a.updatedAt);
  const others = entries.filter((e) => e.owner !== me);
  const st = /* @__PURE__ */ __name((slug) => {
    const it = items.find((x) => x.entry.slug === slug);
    if (!it) return void 0;
    const n = /* @__PURE__ */ __name((k2) => it.open.filter((c) => c.state === k2).length, "n");
    return { ready: n("ready"), fix: n("fix") + n("waiting"), working: n("working") + n("checking") };
  }, "st");
  let title = "", body = "";
  if (tab === "home" && nav === "d") {
    title = "qodebase";
    body = landBody(entries, selfHost);
  } else if (tab === "explore" && nav === "d") {
    title = "Explore";
    body = worldBody(world, entries, !!me, wopts);
  } else if (tab === "home") {
    title = "qodebase";
    body = worldBody(world, entries, !!me, wopts);
  } else if (tab === "projects" || tab === "mine") {
    title = "Your projects";
    body = `<div class="hrow"><span class="lede" style="flex:1;margin:0">${mine.length} project${mine.length === 1 ? "" : "s"}</span><a class="chipbtn" href="/import">Import from GitHub</a></div>
<div class="home-list">${mine.map((e) => projRow(e, now, st(e.slug))).join("") || `<p class="empty">No projects yet. Fork one from <a href="/explore">Explore</a>.</p>`}</div>`;
  } else if (tab === "inbox") {
    title = "Inbox";
    const need = items.map((it) => ({ ...it, need: needsOf(it.open).sort((x, y) => ORDER.indexOf(x.state) - ORDER.indexOf(y.state)) })).filter((it) => it.need.length);
    const moving = items.flatMap((it) => it.open.filter((c) => c.state === "working" || c.state === "checking").map((c) => ({ it, c })));
    let first = true;
    body = `<div class="ibx">${need.length ? need.map((it) => `<h3><a href="${path(it.entry.slug)}/changes">${esc4(label(it.entry.slug))}</a></h3>${it.need.map((c) => {
      const html4 = changeRow(it.info, c, now, first ? c.a.id : void 0).replace('<div class="chg ', `<div data-api="/api/p/${it.info.owner}/${it.info.name}" class="chg `);
      first = false;
      return html4;
    }).join("")}`).join("") : `<div class="hello"><b>Nothing needs you.</b><p>When a change is ready to merge, needs a fix, or an agent has a question, it shows up here, from every project.</p></div>`}
${moving.length ? `<h3>In progress</h3>${moving.map(({ it, c }) => `<a class="mi" href="${path(it.entry.slug)}/changes"><span class="dot s-${c.state}"></span><span><b>${esc4(c.title)}</b><span>${esc4(label(it.entry.slug))}, ${c.word.toLowerCase()}</span></span></a>`).join("")}` : ""}</div>`;
  } else {
    title = "Explore";
    body = `<div class="hrow"><span class="lede" style="flex:1;margin:0">Projects that run. Open one, fork it, ask for changes.</span>${me ? '<a class="chipbtn" href="/import">Import</a>' : ""}</div>
<div class="home-list">${others.map((e) => projRow(e, now, void 0, forks(e.slug))).join("") || '<p class="empty">Nothing here yet.</p>'}</div>`;
  }
  return shell2(nav, title === "qodebase" ? "qodebase" : `${title} \xB7 qodebase`, `${nav === "d" ? globalTop(tab, inboxN, me) : `
<header class="h3"><a class="home" href="/">qodebase</a><span class="htitle">${title}</span></header>`}
<main class="view" id="view"><div class="pad">${body}${tab === "home" && nav === "d" ? "" : legend(1)}${FOOT}</div></main>
${nav === "d" ? "" : globalBar(tab, inboxN, me)}
<script>
// Inbox actions: each row knows its project's API.
document.addEventListener('click',async(e)=>{
 const o=!e.target.closest('.fresh')&&e.target.closest('[data-open]');if(o){const r=o.closest('.chg');r.classList.toggle('open');return;}
 const b=e.target.closest('[data-merge],[data-fix]');if(!b)return;const api=b.closest('[data-api]').dataset.api;const m=!!b.dataset.merge;
 b.disabled=true;b.textContent=m?'Merging':'Sending to its agent';
 const r=await fetch(api+'/'+(m?'merge':'fix'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({agent:b.dataset.merge||b.dataset.fix})});
 if(!r.ok){const j=await r.json().catch(()=>({}));b.textContent=j.error||'Failed';return;}setTimeout(()=>location.reload(),1200);});
<\/script>`, V3_CSS + NAV_CSS + WORLD_CSS + CATALOG_CSS + LAND_CSS + `@media (min-width:900px){body.v3.dhome{display:flex;flex-direction:column}}`, `v3 nav-${nav}${nav === "d" ? " dhome" : ""}`);
}
__name(homeV3, "homeV3");
function withGlobal(html4, tab, inbox, me, nav = "a") {
  if (nav === "d") {
    const css2 = `<style>${NAV_CSS}.gtop{margin:0 0 8px}</style>`;
    return html4.replace("</head>", `${css2}</head>`).replace(/<body([^>]*)>/, `<body$1>${globalTop(tab, inbox, me)}`);
  }
  const css = `<style>${V3_CSS.slice(V3_CSS.indexOf("/* Tab bar"))}${NAV_CSS}
.tabbar{position:fixed;left:0;right:0;bottom:0;z-index:30}
body{padding-bottom:calc(64px + env(safe-area-inset-bottom))}
@media (min-width:900px){.tabbar{right:auto;top:0;bottom:0;width:80px}body{padding-bottom:0;padding-left:80px}}
.badge{position:absolute}</style>`;
  return html4.replace("</head>", `${css}</head>`).replace("</body>", `${globalBar(tab, inbox, me)}</body>`);
}
__name(withGlobal, "withGlobal");
function globalTop(active, inbox, me) {
  const tabs = me ? [["explore", "Explore", "/explore"], ["inbox", "Inbox", "/inbox"], ["mine", "Yours", "/mine"]] : [["explore", "Explore", "/explore"], ["account", "Sign in", "/login"]];
  if (active === "projects") active = "mine";
  return `<nav class="gtop" aria-label="qodebase"><a class="mark" href="/">qodebase</a>${tabs.map(([id, labelT, href]) => `<a href="${href}" class="g${id === active ? " on" : ""}"${id === active ? ' aria-current="page"' : ""}>${labelT}${id === "inbox" && inbox ? `<span class="badge">${inbox}</span>` : ""}</a>`).join("")}<a class="btn gbuild" href="/build"${active === "build" ? ' aria-current="page"' : ""}>Build</a>${gmenu(me, active)}</nav>`;
}
__name(globalTop, "globalTop");
var MENU_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
function gmenu(me, active) {
  const item = /* @__PURE__ */ __name((href, label2, sub, on = false) => `<a href="${href}"${on ? ' aria-current="page"' : ""}><b>${label2}</b><span>${sub}</span></a>`, "item");
  return `<button type="button" class="gmenu" popovertarget="gmenupop" aria-label="Menu">${MENU_ICON}</button>
<div id="gmenupop" class="gmenupop" popover>
${me ? item("/settings", "Account", `${esc4(me)}: your name, API key, sign out`, active === "account") : ""}
${item("/import", "Import from GitHub", "Bring a public repo in and change it with agents")}
${item("/cli", "Command line", "qb: qodebase from a terminal or an agent")}
${item("/about", "About", "What qodebase is")}
${item("/feedback", "Feedback", "Something missing or broken? Tell us")}
</div>`;
}
__name(gmenu, "gmenu");
function catalogV3(nav, full, entries, me, inbox) {
  const pg = catalogPage(full, entries, me);
  if (!pg) return null;
  return shell2(nav, `${pg.title} \xB7 qodebase`, `${globalTop("explore", inbox, me)}
<main class="view" id="view"><div class="pad">${pg.body}${legend(1)}${FOOT}</div></main>${SPECULATE}`, V3_CSS + NAV_CSS + WORLD_CSS + CATALOG_CSS + `@media (min-width:900px){body.v3.dhome{display:flex;flex-direction:column}}`, `v3 nav-${nav} dhome`);
}
__name(catalogV3, "catalogV3");
function buildV3(nav, me, inbox, needsKey, runDomain) {
  return shell2(nav, "Build \xB7 qodebase", `${globalTop("build", inbox, me)}
<main class="view" id="view"><div class="pad">${buildBody(me, needsKey, runDomain)}${FOOT}</div></main>`, V3_CSS + NAV_CSS + BUILD_CSS + `@media (min-width:900px){body.v3.dhome{display:flex;flex-direction:column}}`, `v3 nav-${nav} dhome`);
}
__name(buildV3, "buildV3");
function landBody(entries, selfHost = false) {
  const n = ITEMS.length + entries.filter((e) => !e.forkedFrom && !e.private && e.slug !== "forq.blank").length;
  return `<section class="land">
<h1>Own your codebase.</h1>
<p class="lede">Apps, sites, backends, CLIs: AI agents build and change them for you. Anything with a web page runs live. On Cloudflare, from your phone.</p>
<form class="landask" action="/build" method="get">
<textarea name="idea" rows="3" placeholder="What do you want to build?" aria-label="What do you want to build?" enterkeyhint="go" required></textarea>
<button class="btn" type="submit">Build it</button>
</form>
<nav class="doors" aria-label="More">
${selfHost ? "" : `<a class="browse own" href="/own"><span>Get your own qodebase<small>Your own copy, in your own Cloudflare account. Yours to keep.</small></span></a>
<a class="browse own" href="/personal-agents"><span>Your own AI assistant<small>OpenClaw, Hermes, T3 Code, Mobile Agent and more, in your Cloudflare account.</small></span></a>`}
<a class="browse" href="/explore"><span>Explore projects</span><span class="n">${n}</span></a>
</nav>
${tryRow(entries)}
</section>${SPECULATE}
<script>(function(){const f=document.querySelector('.landask'),t=f.querySelector('textarea');
t.addEventListener('keydown',(e)=>{if(e.key==='Enter'&&!e.shiftKey&&matchMedia('(hover:hover)').matches){e.preventDefault();if(t.value.trim())f.requestSubmit();}});})();<\/script>`;
}
__name(landBody, "landBody");
var LAND_CSS = `
.land{max-width:560px;margin:0 auto;padding:5vh 0 24px}
.land h1{font-size:34px;line-height:1.15;font-weight:600;margin:0 0 10px;letter-spacing:-.01em;text-wrap:balance}
.land .lede{margin:0 0 24px;font-size:17px}
.landask{display:flex;flex-direction:column;gap:10px}
.landask textarea{width:100%;min-height:96px;font:17px/1.45 'Instrument Sans',sans-serif;padding:14px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--fg);resize:none}
.landask .btn{min-height:48px;font-size:16px}
.land .browse{display:flex;align-items:center;justify-content:space-between;margin:28px 0 0;padding:14px 0;border-top:1px solid var(--line);color:var(--fg);font-weight:500;text-decoration:none}
.land .browse .n{color:var(--dim);font-variant-numeric:tabular-nums;font-weight:400}
.land .browse+.browse{margin-top:0}
.doors{margin-top:28px}
.doors .browse{margin-top:0}
.doors .browse:last-child{border-bottom:1px solid var(--line)}
.tryh{font-size:17px;font-weight:600;margin:32px 0 2px}
.trys{margin:0 0 12px;color:var(--dim);font-size:15px}
.tryrow{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;scroll-padding-inline:16px;margin:0 -16px;padding:2px 16px 6px;scrollbar-width:none}
.tryrow::-webkit-scrollbar{display:none}
.tcard{flex:none;width:148px;scroll-snap-align:start;color:var(--fg);text-decoration:none}
.tcard img{display:block;width:148px;height:197px;object-fit:cover;object-position:top;border-radius:10px;box-shadow:inset 0 0 0 1px var(--line);border:1px solid var(--line);background:var(--card)}
.tcard b{display:block;font-size:15px;font-weight:600;margin:8px 0 2px}
.tcard span{display:block;font-size:13px;line-height:1.35;color:var(--dim)}
@media (min-width:900px){.tryrow{margin:0;padding:2px 0 6px;scroll-padding-inline:0}}
.land .browse small{display:block;margin-top:2px;color:var(--dim);font-size:14px;font-weight:400;line-height:1.4}
.land~.foot3{max-width:560px;margin-left:auto;margin-right:auto}
/* One green button on the start page: the box's own Build it. */
body:has(.land) .gbuild{display:none}
@media (min-width:900px){.land{padding-top:16vh}.land h1{font-size:36px}}
`;
var TRY = [
  ["calculator", "Calculator", "Add a history of past results"],
  ["2048", "2048", "Show the best score of all time"],
  ["javascript-tetris", "Tetris", "Add touch controls so it plays on a phone"],
  ["timer", "Focus timer", "Add a 90 minute option"],
  ["tipsplit", "Tip split", "Let each person pay a different share"],
  ["todo", "To-do", "Add due dates"]
];
function tryRow(entries) {
  const have = new Set(entries.map((e) => e.slug));
  const items = TRY.filter(([n]) => have.has(`forq.${n}`));
  if (!items.length) return "";
  return `<h2 class="tryh">Or try changing one of these</h2>
<p class="trys">Open it, tap Fork, and send the change under it. Agents do the rest.</p>
<div class="tryrow">${items.map(([n, title, ask]) => `<a class="tcard" href="/p/forq/${n}/app?ask=${encodeURIComponent(ask)}">
<img src="/_forq/thumbs/${n}.webp" alt="" width="360" height="480" loading="lazy" decoding="async"><b>${esc4(title)}</b><span>Try asking: ${esc4(ask)}</span></a>`).join("")}</div>`;
}
__name(tryRow, "tryRow");

// ../src/auth.ts
var COOKIE = "forq_session";
var SESSION_DAYS = 30;
var DEFAULT_API_MODEL = "claude-sonnet-5-5";
var HANDLE_RE = /^[a-z][a-z0-9-]{1,23}$/;
var RESERVED = /* @__PURE__ */ new Set(["forq", "admin", "api", "login", "logout", "settings", "import", "explore", "about", "privacy", "p", "a", "www", "help", "eyal-admin"]);
var enc = new TextEncoder();
var b64 = /* @__PURE__ */ __name((u) => btoa(String.fromCharCode(...u)), "b64");
var unb64 = /* @__PURE__ */ __name((s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)), "unb64");
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig2 = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return [...new Uint8Array(sig2)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hmacHex, "hmacHex");
async function sessionCookie(env, email) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const body = `${email}|${exp}`;
  const v = btoa(`${body}|${await hmacHex(env.ADMIN_SECRET, `session:${body}`)}`).replace(/=+$/, "");
  return `${COOKIE}=${v}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`;
}
__name(sessionCookie, "sessionCookie");
async function handoffToken(env, email, host) {
  const body = `${email}|${Date.now() + 12e4}|${host}`;
  return btoa(`${body}|${await hmacHex(env.ADMIN_SECRET, `handoff:${body}`)}`);
}
__name(handoffToken, "handoffToken");
async function handoffEmail(env, token, host) {
  try {
    const [email, exp, h, sig2] = atob(token).split("|");
    if (!email || h !== host || Number(exp) < Date.now()) return null;
    return sig2 === await hmacHex(env.ADMIN_SECRET, `handoff:${email}|${exp}|${h}`) ? email : null;
  } catch {
    return null;
  }
}
__name(handoffEmail, "handoffEmail");
var clearCookie = /* @__PURE__ */ __name(() => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`, "clearCookie");
async function sessionEmail(env, request) {
  const m = (request.headers.get("cookie") || "").match(new RegExp(`${COOKIE}=([A-Za-z0-9+/]+)`));
  if (!m) return null;
  try {
    const [email, exp, sig2] = atob(m[1]).split("|");
    if (!email || Number(exp) < Date.now()) return null;
    return sig2 === await hmacHex(env.ADMIN_SECRET, `session:${email}|${exp}`) ? email : null;
  } catch {
    return null;
  }
}
__name(sessionEmail, "sessionEmail");
async function aesKey(env) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`forq-api-keys:${env.KEY_ENC_SECRET}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
__name(aesKey, "aesKey");
async function encryptKey(env, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), enc.encode(plain)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64(out);
}
__name(encryptKey, "encryptKey");
async function decryptKey(env, blob2) {
  const all = unb64(blob2);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, await aesKey(env), all.slice(12));
  return new TextDecoder().decode(pt);
}
__name(decryptKey, "decryptKey");
var isClaudeToken = /* @__PURE__ */ __name((key) => key.startsWith("sk-ant-oat"), "isClaudeToken");
async function checkApiKey(key) {
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) return { ok: false, error: "That does not look like an Anthropic API key (sk-ant-\u2026)." };
  if (isClaudeToken(key)) return { ok: true };
  const r = await fetch("https://api.anthropic.com/v1/models?limit=1", {
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01" }
  }).catch((e) => ({ ok: false, status: 0, text: /* @__PURE__ */ __name(async () => String(e), "text") }));
  if (r.ok) return { ok: true };
  log("auth", "api_key_rejected", { status: r.status });
  return { ok: false, error: r.status === 401 ? "Anthropic rejected this key (401)." : `Could not check the key (HTTP ${r.status}).` };
}
__name(checkApiKey, "checkApiKey");
var userByEmail = /* @__PURE__ */ __name((env, email) => registry(env).getUser(email.toLowerCase()), "userByEmail");
var userByHandle = /* @__PURE__ */ __name((env, handle) => registry(env).getUserByHandle(handle), "userByHandle");
async function suggestHandle(env, email) {
  let base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^[^a-z]+/, "").replace(/-+$/, "").slice(0, 20) || "user";
  if (base.length < 2) base = `user-${base}`;
  for (let i = 0; i < 50; i++) {
    const h = i ? `${base}-${i + 1}` : base;
    if (!RESERVED.has(h) && !await userByHandle(env, h)) return h;
  }
  return `user-${crypto.randomUUID().slice(0, 6)}`;
}
__name(suggestHandle, "suggestHandle");
async function claimHandle(env, email, handle) {
  handle = handle.trim().toLowerCase();
  if (!HANDLE_RE.test(handle)) return { ok: false, error: "2\u201324 characters: lowercase letters, digits and dashes, starting with a letter." };
  if (RESERVED.has(handle)) return { ok: false, error: "That name is reserved." };
  if (handle.includes("--")) return { ok: false, error: "Use single dashes only." };
  const taken = await userByHandle(env, handle);
  if (taken && taken.email !== email.toLowerCase()) return { ok: false, error: "That name is taken." };
  const user = { email: email.toLowerCase(), handle, createdAt: Date.now() };
  await registry(env).putUser(user);
  log("auth", "user_created", { handle });
  if (!taken) await pushAlert(env, "qodebase: new sign-up", `${handle} (${user.email}) chose a name on qodebase.`, `https://${env.UI_HOST}/`);
  return { ok: true, user };
}
__name(claimHandle, "claimHandle");
var isOwner = /* @__PURE__ */ __name((env, handle) => handle === env.OWNER_HANDLE || handle === "forq", "isOwner");
var onSubscription = /* @__PURE__ */ __name((env, handle) => isOwner(env, handle) && !!env.CLAUDE_CODE_OAUTH_TOKEN, "onSubscription");

// ../src/code.ts
var C = "https://forq-code-cache.internal";
var IMMUTABLE = "max-age=86400";
var MAX_VIEW_BYTES = 512 * 1024;
var BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|bmp|svgz|woff2?|ttf|otf|eot|mp3|ogg|wav|mp4|webm|mov|zip|gz|tgz|bz2|7z|pdf|wasm|exe|dll|so|dylib|bin|psd|ai|sketch|fig)$/i;
async function memo(ctx, key, ttl, make) {
  const k2 = new Request(`${C}/${key}`);
  const hit = await caches.default.match(k2);
  if (hit) return hit.json();
  const v = await make();
  if (v !== null && v !== void 0) ctx.waitUntil(caches.default.put(k2, new Response(JSON.stringify(v), { headers: { "cache-control": ttl } })));
  return v;
}
__name(memo, "memo");
async function head(env, ctx, repo) {
  return memo(ctx, `head/${repo}`, "max-age=15", async () => {
    var _stack = [];
    try {
      const r = __using(_stack, await env.ARTIFACTS.get(repo));
      const c = (await r.log({ limit: 1 }))[0];
      return c ? { commit: c.hash, tree: c.treeHash, message: c.message.split("\n")[0], at: c.committedAt * 1e3 } : null;
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  });
}
__name(head, "head");
async function tree(env, ctx, repo, hash) {
  return memo(ctx, `tree/${hash}`, IMMUTABLE, async () => {
    var _stack = [];
    try {
      const r = __using(_stack, await env.ARTIFACTS.get(repo));
      const t = await r.readTree(hash);
      return (t || []).map((e) => ({ name: e.name, type: e.type, hash: e.hash, mode: e.mode }));
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  });
}
__name(tree, "tree");
async function resolvePath(env, ctx, repo, rootTree, path2) {
  let cur = { name: "", type: "tree", hash: rootTree, mode: "040000" };
  for (const seg of path2.split("/").filter(Boolean)) {
    if (cur.type !== "tree") return null;
    const next = (await tree(env, ctx, repo, cur.hash)).find((e) => e.name === seg);
    if (!next) return null;
    cur = next;
  }
  return cur;
}
__name(resolvePath, "resolvePath");
async function blob(env, ctx, repo, hash, name = "") {
  return memo(ctx, `blob/${hash}`, IMMUTABLE, async () => {
    var _stack = [];
    try {
      const r = __using(_stack, await env.ARTIFACTS.get(repo));
      const b = await r.readBlob(hash);
      if (!b) return { text: null, bytes: 0, binary: false, tooBig: false };
      const bytes = b.size;
      if (BINARY_EXT.test(name)) return { text: null, bytes, binary: true, tooBig: false };
      if (bytes > MAX_VIEW_BYTES) return { text: null, bytes, binary: false, tooBig: true };
      const buf = new Uint8Array(await b.arrayBuffer());
      if (buf.subarray(0, 8192).includes(0)) return { text: null, bytes, binary: true, tooBig: false };
      return { text: new TextDecoder().decode(buf), bytes, binary: false, tooBig: false };
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  });
}
__name(blob, "blob");
async function allFiles(env, ctx, repo, rootTree, cap = 5e3) {
  return memo(ctx, `files/${rootTree}`, IMMUTABLE, async () => {
    const files = [];
    let truncated = false;
    const walk = /* @__PURE__ */ __name(async (hash, prefix) => {
      const entries = await tree(env, ctx, repo, hash);
      const dirs = [];
      for (const e of entries) {
        if (files.length >= cap) {
          truncated = true;
          return;
        }
        if (e.type === "tree") dirs.push(walk(e.hash, `${prefix}${e.name}/`));
        else if (e.type === "blob") files.push({ path: prefix + e.name, hash: e.hash });
      }
      await Promise.all(dirs);
    }, "walk");
    await walk(rootTree, "");
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files, truncated };
  });
}
__name(allFiles, "allFiles");
async function diffTrees(env, ctx, oldRepo, oldTree, newRepo, newTree) {
  const out = [];
  const all = /* @__PURE__ */ __name(async (repo, hash, prefix, status) => {
    for (const f of (await allFiles(env, ctx, repo, hash)).files) {
      out.push(status === "added" ? { path: prefix + f.path, status, newHash: f.hash } : { path: prefix + f.path, status, oldHash: f.hash });
    }
  }, "all");
  const walk = /* @__PURE__ */ __name(async (a, b, prefix) => {
    if (a === b) return;
    const [ta, tb] = await Promise.all([tree(env, ctx, oldRepo, a), tree(env, ctx, newRepo, b)]);
    const ma = new Map(ta.map((e) => [e.name, e])), mb = new Map(tb.map((e) => [e.name, e]));
    const jobs = [];
    for (const [name, eb] of mb) {
      const ea = ma.get(name);
      const p = prefix + name;
      if (!ea) jobs.push(eb.type === "tree" ? all(newRepo, eb.hash, p + "/", "added") : Promise.resolve(void out.push({ path: p, status: "added", newHash: eb.hash })));
      else if (ea.hash !== eb.hash) {
        if (ea.type === "tree" && eb.type === "tree") jobs.push(walk(ea.hash, eb.hash, p + "/"));
        else if (ea.type !== "tree" && eb.type !== "tree") out.push({ path: p, status: "modified", oldHash: ea.hash, newHash: eb.hash });
        else {
          out.push({ path: p, status: "removed", oldHash: ea.hash });
          out.push({ path: p, status: "added", newHash: eb.hash });
        }
      }
    }
    for (const [name, ea] of ma) {
      if (mb.has(name)) continue;
      const p = prefix + name;
      jobs.push(ea.type === "tree" ? all(oldRepo, ea.hash, p + "/", "removed") : Promise.resolve(void out.push({ path: p, status: "removed", oldHash: ea.hash })));
    }
    await Promise.all(jobs);
  }, "walk");
  await walk(oldTree, newTree, "");
  out.sort((x, y) => x.path.localeCompare(y.path));
  return out;
}
__name(diffTrees, "diffTrees");
async function forkBase(env, mainRepo, forkRepo, forkedAt) {
  var _stack = [];
  try {
    const m = __using(_stack, await env.ARTIFACTS.get(mainRepo));
    const f = __using(_stack, await env.ARTIFACTS.get(forkRepo));
    const [ml, fl] = await Promise.all([m.log({ limit: 300 }), f.log({ limit: 300 })]);
    const inFork = new Set(fl.map((c) => c.hash));
    const base = ml.find((c) => c.committedAt * 1e3 <= forkedAt && inFork.has(c.hash));
    if (!base) log("code", "fork_base_not_found", { mainRepo, forkRepo, main: ml.length, fork: fl.length });
    return base ? { commit: base.hash, tree: base.treeHash } : null;
  } catch (_) {
    var _error = _, _hasError = true;
  } finally {
    __callDispose(_stack, _error, _hasError);
  }
}
__name(forkBase, "forkBase");

// ../src/codeui.ts
var HLJS = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js";
var JSDIFF = "https://cdnjs.cloudflare.com/ajax/libs/jsdiff/5.2.0/diff.min.js";
var MAX_HIGHLIGHT_LINES = 4e3;
var CODE_CSS = `<style>
:root{--add:color-mix(in srgb,#2da44e 16%,var(--bg));--del:color-mix(in srgb,#cf222e 14%,var(--bg));--addfg:#1a7f37;--delfg:#cf222e;
 --tk-kw:#8250df;--tk-str:#0a3069;--tk-com:#6e7781;--tk-num:#0550ae;--tk-fn:#953800;--tk-tag:#116329;--tk-attr:#0550ae}
@media (prefers-color-scheme:dark){:root{--addfg:#3fb950;--delfg:#f85149;--tk-kw:#d2a8ff;--tk-str:#a5d6ff;--tk-com:#8b949e;--tk-num:#79c0ff;--tk-fn:#ffa657;--tk-tag:#7ee787;--tk-attr:#79c0ff}}
.vtabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:12px 0 8px}
.vtabs::-webkit-scrollbar{display:none}
.vtabs a{flex:none;min-height:36px;display:inline-flex;align-items:center;padding:0 12px;border-radius:8px;border:1px solid var(--line);color:var(--dim);font-size:14px}
.vtabs a.on{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.crumbs{font:14px 'JetBrains Mono',monospace;margin:12px 0;word-break:break-all;line-height:1.7}
.crumbs a{color:var(--acc)}.crumbs .sep{color:var(--dim);margin:0 4px}
.goto{position:relative;margin:8px 0 12px}
.goto input{width:100%;font:16px 'Instrument Sans',sans-serif;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg)}
.goto .hits{display:none;flex-direction:column;background:var(--card);border:1px solid var(--line);border-radius:8px;margin-top:6px;max-height:50dvh;overflow:auto}
.goto .hits.on{display:flex}
.goto .hits a{padding:10px 12px;font:13px 'JetBrains Mono',monospace;color:var(--fg);border-bottom:1px solid var(--line);word-break:break-all}
.goto .hits a b{color:var(--acc);font-weight:600}
.goto .hits p{margin:0;padding:10px 12px;color:var(--dim);font-size:14px}
.goto .deep{min-height:44px;border:0;border-top:1px solid var(--line);background:var(--chip);color:var(--fg);font:500 14px 'Instrument Sans',sans-serif;text-align:left;padding:0 12px;cursor:pointer}
.goto .sr{border-bottom:1px solid var(--line)}
.goto .sr a.f{display:flex;justify-content:space-between;gap:8px;font-weight:600;border-bottom:0}
.goto .sr a.f span{color:var(--dim);font-weight:400;font-family:'Instrument Sans',sans-serif}
.goto .sr a.l{display:flex;gap:10px;padding:4px 12px 4px 12px;font-size:12px;color:var(--dim);border-bottom:0;white-space:pre;overflow:hidden;text-overflow:ellipsis}
.goto .sr a.l:last-child{padding-bottom:10px}
.goto .sr .ln{flex:none;min-width:2.5em;text-align:right;color:var(--dim)}
.goto .sr .lt{min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--fg)}
.ls{display:flex;flex-direction:column;background:var(--card);border-radius:12px;overflow:hidden}
.ls a{display:flex;align-items:center;gap:10px;min-height:44px;padding:0 14px;border-bottom:1px solid var(--line);color:var(--fg);font:14px 'JetBrains Mono',monospace;word-break:break-all}
.ls a:last-child{border-bottom:0}
.ls .k{width:16px;flex:none;color:var(--dim);font-family:'Instrument Sans',sans-serif;font-size:13px;text-align:center}
.ls .dir{font-weight:600}
.fmeta{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;color:var(--dim);font-size:13px;margin:8px 0}
.fmeta .chipbtn{min-height:36px;padding:0 12px;font-size:14px}
.code{background:var(--card);border-radius:12px;overflow:auto;font:12.5px/1.55 'JetBrains Mono',monospace;-webkit-text-size-adjust:100%}
.code table{border-collapse:collapse;min-width:100%}
.code td{padding:0;vertical-align:top}
.code td.n{position:sticky;left:0;background:var(--card);color:var(--dim);text-align:right;padding:0 10px 0 12px;user-select:none;min-width:2.5em;cursor:pointer}
.code td.c{white-space:pre;padding:0 14px 0 4px}
.code tr.hl td{background:color-mix(in srgb,var(--busy) 18%,var(--card))}
.code tr:first-child td{padding-top:10px}.code tr:last-child td{padding-bottom:10px}
.md{background:var(--card);border-radius:12px;padding:4px 16px;font-size:15px;overflow-wrap:anywhere}
.md img{max-width:100%;height:auto}
.md code{font:13px 'JetBrains Mono',monospace;background:var(--chip);border-radius:4px;padding:1px 4px}
.md .tbl{overflow-x:auto;margin:0 0 14px}
.md table{border-collapse:collapse;font-size:14px;min-width:100%}
.md th,.md td{overflow-wrap:normal;word-break:normal;text-align:left;vertical-align:top;padding:7px 10px;border-bottom:1px solid var(--line)}
.md th{font-weight:600}
.md pre{overflow-x:auto;background:var(--chip);border-radius:8px;padding:10px}
.imgv{background:var(--card);border-radius:12px;padding:16px;text-align:center}.imgv img{max-width:100%;height:auto}
.hljs-keyword,.hljs-built_in,.hljs-selector-tag,.hljs-literal{color:var(--tk-kw)}
.hljs-string,.hljs-regexp,.hljs-template-tag{color:var(--tk-str)}
.hljs-comment,.hljs-quote{color:var(--tk-com);font-style:italic}
.hljs-number,.hljs-symbol{color:var(--tk-num)}
.hljs-title,.hljs-function .hljs-title,.hljs-title.function_{color:var(--tk-fn)}
.hljs-tag,.hljs-name,.hljs-selector-class,.hljs-selector-id{color:var(--tk-tag)}
.hljs-attr,.hljs-attribute,.hljs-property,.hljs-variable{color:var(--tk-attr)}
.chg{display:flex;flex-direction:column;gap:12px}
.chg details{background:var(--card);border-radius:12px;overflow:hidden}
.chg summary{display:flex;align-items:center;gap:8px;min-height:44px;padding:0 14px;cursor:pointer;font:13px 'JetBrains Mono',monospace;word-break:break-all;list-style:none}
.chg summary::-webkit-details-marker{display:none}
.chg .st{font:600 12px 'Instrument Sans',sans-serif;border-radius:4px;padding:1px 6px;flex:none}
.chg .st.added{background:var(--add);color:var(--addfg)}.chg .st.removed{background:var(--del);color:var(--delfg)}.chg .st.modified{background:var(--chip);color:var(--fg)}
.chg .cnt{margin-left:auto;font:12px 'Instrument Sans',sans-serif;color:var(--dim);flex:none}
.chg .cnt .a{color:var(--addfg)}.chg .cnt .d{color:var(--delfg)}
.dl{overflow:auto;font:12px/1.55 'JetBrains Mono',monospace;border-top:1px solid var(--line)}
.dl table{border-collapse:collapse;min-width:100%}
.dl td{white-space:pre;padding:0 12px 0 4px}
.dl td.n{color:var(--dim);text-align:right;padding:0 6px 0 10px;user-select:none;min-width:2.2em}
.dl tr.a td{background:var(--add)}.dl tr.d td{background:var(--del)}
.dl tr.h td{background:var(--chip);color:var(--dim);padding:4px 12px}
.sum{color:var(--dim);font-size:14px;margin:8px 0 16px}.sum .a{color:var(--addfg)}.sum .d{color:var(--delfg)}
</style>`;
function versionTabs(info, v, at) {
  const base = `/p/${info.owner}/${info.name}/code/${at}`;
  const agents = info.agents.filter((a) => a.state !== "stopped");
  return `<nav class="vtabs" aria-label="Version"><a class="${v ? "" : "on"}" href="${esc4(base)}">Live</a>${agents.map((a) => {
    const s = a.id.split("--")[1];
    return `<a class="${v === s ? "on" : ""}" href="${esc4(base)}?v=${s}">${esc4(s)}${a.state === "merged" ? " (merged)" : ""}</a>`;
  }).join("")}</nav>`;
}
__name(versionTabs, "versionTabs");
function crumbs(info, path2, v) {
  const q = v ? `?v=${v}` : "";
  const segs = path2.split("/").filter(Boolean);
  const root = `<a href="/p/${info.owner}/${info.name}/code/${q}">${esc4(info.name)}</a>`;
  return `<div class="crumbs">${root}${segs.map((s, i) => {
    const p = segs.slice(0, i + 1).join("/");
    return `<span class="sep">/</span>${i === segs.length - 1 ? esc4(s) : `<a href="/p/${info.owner}/${info.name}/code/${esc4(p)}/${q}">${esc4(s)}</a>`}`;
  }).join("")}</div>`;
}
__name(crumbs, "crumbs");
var gotoBox = /* @__PURE__ */ __name((info, v) => `<div class="goto"><input id="goto" type="search" placeholder="Go to file, or search the code" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="go"><div class="hits" id="hits"></div></div>
<script>(function(){const $i=document.getElementById('goto'),$h=document.getElementById('hits');let files=null;
const esc=(t)=>t.replace(/[<>&"]/g,(c)=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
async function load(){if(files)return files;const r=await fetch('/api/p/${info.owner}/${info.name}/files${v ? `?v=${v}` : ""}');const j=await r.json();files=j.files||[];return files;}
// Matches in the file name rank above matches in folder names; shorter paths first. null = no match.
function score(p,q){const l=p.toLowerCase();const i=l.indexOf(q);if(i<0)return null;const base=l.lastIndexOf('/')+1;return (i>=base?1000:0)-i-p.length/100;}
$i.addEventListener('focus',load);
const API='/api/p/${info.owner}/${info.name}',V='${v ? `?v=${v}` : ""}',VQ='${v ? `&v=${v}` : ""}';
const codeUrl=(f,n)=>'/p/${info.owner}/${info.name}/code/'+encodeURI(f)+V+(n?'#L'+n:'');
const mark=(t,q)=>{const i=t.toLowerCase().indexOf(q);return i<0?esc(t):esc(t.slice(0,i))+'<b>'+esc(t.slice(i,i+q.length))+'</b>'+esc(t.slice(i+q.length));};
let seq=0;
$i.addEventListener('input',async()=>{const q=$i.value.trim().toLowerCase();const my=++seq;if(!q){$h.classList.remove('on');return;}
 const fs=await load();if(my!==seq)return;
 const hits=fs.map((f)=>[f,score(f,q)]).filter((x)=>x[1]!==null).sort((a,b)=>b[1]-a[1]).slice(0,30);
 $h.classList.add('on');
 $h.innerHTML=(hits.length?hits.map(([f])=>'<a href="'+codeUrl(f)+'">'+mark(f,q)+'</a>').join(''):'<p>No file name matches.</p>')+
  (q.length>=3?'<button type="button" class="deep" id="deep">Search file contents for \u201C'+esc($i.value.trim())+'\u201D</button>':'');});
$h.addEventListener('click',async(e)=>{if(!e.target.closest('#deep'))return;const q=$i.value.trim();const my=++seq;
 $h.innerHTML='<p>Searching the code. The first search of a version indexes it, a few seconds.</p>';
 let j;try{const r=await fetch(API+'/search?q='+encodeURIComponent(q)+VQ);j=await r.json();if(!r.ok||j.error)throw new Error(j.error||r.status);}catch(err){if(my===seq)$h.innerHTML='<p>'+esc(err.message)+'</p>';return;}
 if(my!==seq)return;const ql=q.toLowerCase();
 $h.innerHTML='<p>'+(j.results.length?j.results.length+' file'+(j.results.length>1?'s':'')+' contain \u201C'+esc(q)+'\u201D':'No file contains \u201C'+esc(q)+'\u201D')+', '+j.files+' files searched'+(j.skipped?', '+j.skipped+' skipped (binary or large)':'')+'</p>'+
  j.results.map((r)=>'<div class="sr"><a class="f" href="'+codeUrl(r.path)+'">'+esc(r.path)+'<span>'+r.count+'</span></a>'+r.lines.map((l)=>'<a class="l" href="'+codeUrl(r.path,l.n)+'"><span class="ln">'+l.n+'</span><span class="lt">'+mark(l.text.trim(),ql)+'</span></a>').join('')+'</div>').join('');});
})();<\/script>`, "gotoBox");
var head2 = /* @__PURE__ */ __name((info, v, at, title, rev) => `${CODE_CSS}<a class="back" href="/p/${info.owner}/${info.name}">${esc4(info.owner)} / ${esc4(info.name)}</a>
<h1>${esc4(title)}</h1>
${versionTabs(info, v, at)}${rev ? `<div class="fmeta"><span>at ${esc4(rev.commit.slice(0, 7))}</span><span>${esc4(rev.message)}</span></div>` : ""}`, "head");
function dirPage(o) {
  const { info, v, path: path2 } = o;
  const q = v ? `?v=${v}` : "";
  const sorted = [...o.entries].sort((a, b) => (a.type === "tree" ? 0 : 1) - (b.type === "tree" ? 0 : 1) || a.name.localeCompare(b.name));
  const up = path2 ? `<a href="/p/${info.owner}/${info.name}/code/${esc4(path2.split("/").filter(Boolean).slice(0, -1).join("/"))}${path2.split("/").filter(Boolean).length > 1 ? "/" : ""}${q}"><span class="k">..</span>up a folder</a>` : "";
  return shell(`${path2 || info.name} \xB7 code \xB7 qodebase`, `${head2(info, v, path2, "Code", o.rev)}${gotoBox(info, v)}${crumbs(info, path2, v)}
<div class="ls">${up}${sorted.map((e) => `<a class="${e.type === "tree" ? "dir" : ""}" href="/p/${info.owner}/${info.name}/code/${esc4(path2 + e.name)}${e.type === "tree" ? "/" : ""}${q}"><span class="k">${e.type === "tree" ? "/" : ""}</span>${esc4(e.name)}</a>`).join("") || '<p class="empty" style="padding:14px">Empty folder.</p>'}</div>
${o.readme ? `<h2>README</h2><div class="md">${markdown(o.readme)}</div>` : ""}`);
}
__name(dirPage, "dirPage");
var LANG = { js: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript", tsx: "typescript", jsx: "javascript", json: "json", html: "xml", htm: "xml", xml: "xml", svg: "xml", css: "css", scss: "scss", md: "markdown", py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", kt: "kotlin", sh: "bash", yml: "yaml", yaml: "yaml", toml: "ini", c: "c", h: "c", cpp: "cpp", php: "php", sql: "sql" };
function filePage(o) {
  const { info, v, path: path2, file } = o;
  const name = path2.split("/").pop() || path2;
  const ext = (name.split(".").pop() || "").toLowerCase();
  const size = file.bytes >= 1024 ? `${(file.bytes / 1024).toFixed(1)} KB` : `${file.bytes} bytes`;
  const isImg = /^(png|jpe?g|gif|webp|svg|ico|bmp)$/.test(ext);
  const actions = `<a class="chipbtn" href="${esc4(o.runUrl)}" target="_blank" rel="noopener">Raw</a>${/^html?$/.test(ext) ? `<a class="chipbtn" href="${esc4(o.runUrl)}" target="_blank" rel="noopener">Open in preview</a>` : ""}`;
  let body;
  if (isImg) body = `<div class="imgv"><img src="${esc4(o.runUrl)}" alt="${esc4(name)}"></div>`;
  else if (file.binary) body = `<p class="note">Binary file, not shown.</p>`;
  else if (file.tooBig || file.text === null) body = `<p class="note">Too large to show here (${size}). Use Raw.</p>`;
  else if (ext === "md") {
    body = `<div class="md">${markdown(file.text)}</div><h2>Source</h2>${codeBlock(file.text, "markdown")}`;
  } else body = codeBlock(file.text, LANG[ext]);
  const lines = file.text ? file.text.split("\n").length : 0;
  return shell(`${name} \xB7 code \xB7 qodebase`, `${head2(info, v, path2, name, o.rev)}${crumbs(info, path2, v)}
<div class="fmeta"><span>${size}</span>${lines ? `<span>${lines} lines</span>` : ""}${actions}</div>${body}`);
}
__name(filePage, "filePage");
function codeBlock(text, lang) {
  const lines = text.replace(/\n$/, "").split("\n");
  const hl = lang && lines.length <= MAX_HIGHLIGHT_LINES;
  return `<div class="code" id="code"><table>${lines.map((l, i) => `<tr id="L${i + 1}"><td class="n">${i + 1}</td><td class="c">${esc4(l) || " "}</td></tr>`).join("")}</table></div>
${hl ? `<script src="${HLJS}"><\/script><script>(function(){try{
 const rows=[...document.querySelectorAll('#code td.c')];const src=rows.map((r)=>r.textContent).join('\\n');
 const html=hljs.highlight(src,{language:${JSON.stringify(lang)},ignoreIllegals:true}).value;
 let open=[];const out=html.split('\\n').map((ln)=>{const pre=open.join('');
  const re=/<span class="([^"]+)">|<\\/span>/g;let m;while((m=re.exec(ln)))m[1]?open.push('<span class="'+m[1]+'">'):open.pop();
  return pre+ln+'</span>'.repeat(open.length);});
 rows.forEach((r,i)=>{r.innerHTML=out[i]||' ';});}catch(e){console.warn('highlight',e)}})();<\/script>` : ""}
<script>(function(){function mark(){document.querySelectorAll('#code tr.hl').forEach((r)=>r.classList.remove('hl'));const m=location.hash.match(/^#L(\\d+)$/);if(!m)return;const r=document.getElementById('L'+m[1]);if(r){r.classList.add('hl');r.scrollIntoView({block:'center'});}}
 document.getElementById('code').addEventListener('click',(e)=>{const n=e.target.closest('td.n');if(!n)return;history.replaceState(null,'','#L'+n.textContent);mark();
  try{navigator.clipboard.writeText(location.href);n.textContent='copied';setTimeout(()=>{n.textContent=n.parentElement.id.slice(1)},900);}catch{}});
 mark();})();<\/script>`;
}
__name(codeBlock, "codeBlock");
function changesPage(o) {
  const { info, agent, changes } = o;
  const s = agent.id.split("--")[1];
  const data = JSON.stringify(changes.map((c) => ({ p: c.path, s: c.status, a: c.oldText, b: c.newText, n: c.note || null }))).replace(/</g, "\\u003c");
  return shell(`Changes by ${s} \xB7 qodebase`, `${CODE_CSS}<a class="back" href="/p/${info.owner}/${info.name}">${esc4(info.owner)} / ${esc4(info.name)}</a>
<h1>Changes by agent ${esc4(s)}</h1>
<p class="desc">${esc4(agent.task)}</p>
<div class="fmeta"><span>${esc4(o.baseNote)}</span><a class="chipbtn" href="/p/${info.owner}/${info.name}/code/?v=${s}">Browse its code</a><a class="chipbtn" href="${esc4(o.previewUrl)}" target="_blank" rel="noopener">Open its preview</a></div>
<p class="sum" id="sum">${changes.length ? `${changes.length} file${changes.length > 1 ? "s" : ""} changed` : "No changes yet: the fork matches where it started."}</p>
<div class="chg" id="chg"></div>
<script src="${JSDIFF}"><\/script>
<script>(function(){const C=${data};const $c=document.getElementById('chg');let ta=0,td=0;
const esc=(t)=>String(t).replace(/[<>&]/g,(c)=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
for(const c of C){let rows='',a=0,d=0;
 if(c.n){rows='<tr class="h"><td colspan="3">'+esc(c.n)+'</td></tr>';}
 else{const p=Diff.structuredPatch(c.p,c.p,c.a||'',c.b||'','','',{context:3});
  for(const h of p.hunks){rows+='<tr class="h"><td colspan="3">@@ -'+h.oldStart+','+h.oldLines+' +'+h.newStart+','+h.newLines+' @@</td></tr>';let o=h.oldStart,n=h.newStart;
   for(const l of h.lines){const k=l[0],t=esc(l.slice(1))||' ';
    if(k==='+'){a++;rows+='<tr class="a"><td class="n"></td><td class="n">'+(n++)+'</td><td>+'+t+'</td></tr>';}
    else if(k==='-'){d++;rows+='<tr class="d"><td class="n">'+(o++)+'</td><td class="n"></td><td>-'+t+'</td></tr>';}
    else if(k===' '){rows+='<tr><td class="n">'+(o++)+'</td><td class="n">'+(n++)+'</td><td> '+t+'</td></tr>';}}}}
 ta+=a;td+=d;
 const el=document.createElement('details');if(C.length<=6)el.open=true;
 el.innerHTML='<summary><span class="st '+c.s+'">'+c.s+'</span><span>'+esc(c.p)+'</span><span class="cnt"><span class="a">+'+a+'</span> <span class="d">\u2212'+d+'</span></span></summary><div class="dl"><table>'+rows+'</table></div>';
 $c.appendChild(el);}
if(C.length)document.getElementById('sum').innerHTML=C.length+' file'+(C.length>1?'s':'')+' changed, <span class="a">+'+ta+'</span> <span class="d">\u2212'+td+'</span>';
})();<\/script>`);
}
__name(changesPage, "changesPage");

// ../src/pages.ts
var esc7 = /* @__PURE__ */ __name((s) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]), "esc");
var startingPage = /* @__PURE__ */ __name((name, error) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Starting ${esc7(name)}</title>
<body style="margin:0;height:100dvh;display:flex;align-items:center;justify-content:center;background:#141516;color:#e8e8e6;font:15px system-ui;padding:0 16px">
<div style="text-align:center"><div style="font-weight:600">Starting ${esc7(name)}\u2026</div><div id="el" style="margin-top:8px;font-size:20px;font-variant-numeric:tabular-nums">0s</div>
<div id="sub" style="margin-top:6px;font-size:13px;color:#9a9da2">${error ? esc7(error) : "usually ready in a few seconds"}</div></div>
<script>const t0=Date.now(),el=document.getElementById('el'),sub=document.getElementById('sub');
setInterval(()=>{const s=Math.floor((Date.now()-t0)/1000);el.textContent=s+'s';if(s>20&&!${JSON.stringify(!!error)})sub.textContent='the first start on a new host downloads the image (a couple of minutes)';},500);
(async function poll(){try{const r=await fetch(location.href,{cache:'no-store',headers:{accept:'text/html'}});if(r.ok){location.replace(location.href);return;}}catch{}setTimeout(poll,2500);})();<\/script></body>`,
  { status: 503, headers: { "content-type": "text/html; charset=utf-8", "retry-after": "2" } }
), "startingPage");

// ../src/personal.ts
var CSS2 = `
:root{--bg:#fff;--card:#f6f7f8;--chip:#eceef1;--line:#e2e5e9;--fg:#15171a;--dim:#5f6670;--acc:#17695a;--acc-fg:#fff;--busy:#b7791f;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0f1112;--card:#171a1c;--chip:#202427;--line:#272b2f;--fg:#e8eaec;--dim:#9ba2a9;--acc:#4fbf9f;--acc-fg:#0f1112;--busy:#e0a948;color-scheme:dark}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
a:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 'Instrument Sans',sans-serif}
main{max-width:720px;margin:0 auto;padding:12px 16px calc(40px + env(safe-area-inset-bottom))}
a{color:var(--acc);text-decoration:none}
header{display:flex;align-items:center;justify-content:space-between;height:48px}
.mark{font-weight:600;font-size:20px;color:var(--fg)}
h1{font-size:28px;line-height:1.15;margin:16px 0 8px;font-weight:600;letter-spacing:-.01em}
h2{font-size:20px;font-weight:600;margin:40px 0 8px}
h3{font-size:17px;font-weight:600;margin:0}
p{margin:8px 0}
.lede{font-size:17px;color:var(--fg)}
.dim{color:var(--dim)}
.pts{margin:8px 0 20px;padding-left:20px;font-size:17px}.pts li{margin:4px 0}
.facts{margin:8px 0 0;padding-left:18px;color:var(--dim);font-size:15px}.facts li{margin:2px 0}
.need{display:grid;gap:8px;margin:12px 0 0;padding:0;list-style:none}
.need li{background:var(--card);border-radius:8px;padding:12px 14px}
.need b{font-weight:600}
.cards{display:flex;flex-direction:column;gap:12px;margin-top:12px}
.card{background:var(--card);border-radius:12px;padding:16px}
.card .head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.tag{font-size:13px;background:var(--chip);border-radius:4px;padding:2px 8px;white-space:nowrap;color:var(--fg)}
.tag.acc{background:color-mix(in srgb,var(--acc) 16%,transparent);color:var(--acc)}
a.tag{text-decoration:none}
.ico{width:.95em;height:.95em;vertical-align:-.12em;margin-left:.25em;flex:none}
button.tag{border:0;font:inherit;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;min-height:28px}
.linkish{background:none;border:0;padding:0;font:inherit;color:var(--acc);cursor:pointer;display:inline-flex;align-items:center}
.planpop{max-width:min(420px,calc(100vw - 32px));border:0;border-radius:12px;padding:20px;background:var(--bg);color:var(--fg);box-shadow:0 12px 40px rgba(0,0,0,.25),inset 0 0 0 1px var(--line)}
.planpop::backdrop{background:rgba(0,0,0,.35)}
.planpop h3{margin:0 0 8px;font-size:18px}.planpop p{font-size:15px;color:var(--dim);margin:8px 0}.planpop p b{color:var(--fg)}
.planpop .btns{margin-top:16px}
.planline{font-size:14px;color:var(--dim);margin:-8px 0 16px}
.tag.busy{background:color-mix(in srgb,var(--busy) 18%,transparent);color:var(--busy)}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;margin:12px 0;font-size:15px}
dt{color:var(--dim)}dd{margin:0}
.btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.btn{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border-radius:8px;font-weight:600;font-size:15px}
.btn.pri{background:var(--acc);color:var(--acc-fg)}
.btn.sec{background:var(--chip);color:var(--fg)}
details{border-top:1px solid var(--line);margin-top:12px}
summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:500;color:var(--acc);list-style:none}
summary::-webkit-details-marker{display:none}
details[open] summary{color:var(--fg)}
ol{margin:0 0 4px;padding-left:22px}ol li{margin:6px 0}
code{font:14px 'JetBrains Mono',monospace;background:var(--chip);border-radius:4px;padding:1px 5px;word-break:break-all}
.cmp{width:100%;border-collapse:collapse;font-size:14px;margin-top:12px}
.cmpwrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
.cmp th,.cmp td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:top}
.cmp th{font-weight:600}.cmp td:first-child{color:var(--dim);white-space:nowrap}
.foot{display:flex;gap:16px;margin-top:48px;font-size:14px}
@media (hover:hover){.btn.pri:hover{filter:brightness(1.08)}.btn.sec:hover{background:var(--line)}}
`;
var shell3 = /* @__PURE__ */ __name((title, body, extraCss = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono&display=swap" rel="stylesheet">
<style>${CSS2}${INSTALL_CSS}${extraCss}</style></head><body><main>
<header><a class="mark" href="/">qodebase</a><a href="/personal-agents">Assistants</a></header>
${body}
</main></body></html>`, "shell");
var INSTALL_CSS = `
.field{display:flex;flex-direction:column;gap:6px;margin:16px 0}
.field label{font-weight:600;font-size:15px}
.field input,.field select{font:16px 'Instrument Sans',sans-serif;min-height:48px;padding:0 12px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg)}
.field .hint{font-size:13px;color:var(--dim)}
.addr{font:14px 'JetBrains Mono',monospace;color:var(--dim);word-break:break-all}
button.btn{border:0;cursor:pointer;font:600 15px 'Instrument Sans',sans-serif;width:100%;justify-content:center}
.btn.wide{width:100%;justify-content:center}
.err{background:color-mix(in srgb,#b42d1f 12%,transparent);color:var(--fg);border-radius:8px;padding:12px 14px;margin:12px 0}
.steps{list-style:none;padding:0;margin:20px 0;display:flex;flex-direction:column;gap:2px}
.steps li{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--line)}
.dot{flex:0 0 12px;height:12px;border-radius:50%;margin-top:5px;background:var(--chip);box-shadow:inset 0 0 0 1px var(--line)}
.dot.doing{background:var(--busy);animation:pulse 1s ease-in-out infinite alternate}.dot.done{background:var(--acc)}.dot.failed{background:#b42d1f}
@keyframes pulse{to{opacity:.35}}
@media (prefers-reduced-motion:reduce){.dot.doing{animation:none}}
.steps .t{font-size:15px}.steps .n{font-size:13px;color:var(--dim)}
.small{font-size:13px;color:var(--dim)}
.linkbtn{background:none;border:0;color:var(--acc);font:inherit;padding:0;cursor:pointer;min-height:44px}
`;
var esc8 = /* @__PURE__ */ __name((s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]), "esc");
function installPage(st) {
  if (st.kind === "error") return shell3("Could not connect \xB7 qodebase", `<h1>That did not work</h1><p class="err">${esc8(st.text)}</p><div class="btns"><a class="btn pri wide" href="${esc8(st.next)}">Back</a></div>`);
  if (st.kind === "connect") return shell3(`Install ${st.template.title} \xB7 qodebase`, `<h1>Install ${esc8(st.template.title)}</h1>
<ul class="pts"><li>It goes into <b>your</b> Cloudflare account</li><li>qodebase asks Cloudflare for permission once</li><li>No GitHub, no keys to copy</li></ul>
<div class="btns"><a class="btn pri wide" href="${esc8(st.startHref)}">Sign in with Cloudflare</a></div>
<p class="small">No account yet? You can make one on the same screen. You can take qodebase's access back any time in your Cloudflare profile.</p>`);
  const many = st.accounts.length > 1;
  return shell3(`Install ${st.template.title} \xB7 qodebase`, `<h1>Install ${esc8(st.template.title)}</h1>
${st.error ? `<p class="err">${esc8(st.error)}</p>` : ""}
<form method="post">
<div class="field"><label for="name">Name</label>
<input id="name" name="name" value="${esc8(st.name)}" required pattern="[a-z][a-z0-9-]{1,38}[a-z0-9]" autocapitalize="none" autocomplete="off" spellcheck="false" inputmode="url">
<span class="hint">Lowercase letters, numbers and dashes. It becomes the address.</span></div>
${many ? `<div class="field"><label for="account">Cloudflare account</label><select id="account" name="account">${st.accounts.map((a) => `<option value="${esc8(a.id)}">${esc8(a.name)}</option>`).join("")}</select></div>` : `<input type="hidden" name="account" value="${esc8(st.accounts[0]?.id || "")}"><p class="small">Into ${esc8(st.accounts[0]?.name || "")}</p>`}
<div class="btns"><button class="btn pri" type="submit">Install</button></div>
</form>
<form method="post" action="/connect/cf/disconnect?next=/personal-agents"><button class="linkbtn" type="submit">Disconnect Cloudflare</button></form>`);
}
__name(installPage, "installPage");
function installProgressPage(v) {
  const body = `<h1 id="h">${v.url ? `${esc8(v.name)} is ready` : v.error ? "Install stopped" : `Installing ${esc8(v.name)}`}</h1>
<p class="small">${esc8(v.title)} into ${esc8(v.accountName)}</p>
${v.url || v.error ? "" : `<p class="small">Usually under a minute. You can leave this page; it keeps going.</p>`}
<ul class="steps" id="steps">${v.steps.map((s) => `<li><span class="dot ${esc8(s.state)}"></span><div><div class="t">${esc8(s.label)}</div>${s.note ? `<div class="n">${esc8(s.note)}</div>` : ""}</div></li>`).join("")}</ul>
<div id="end">${v.url ? `<div class="btns"><a class="btn pri wide" href="${esc8(v.url)}">Open ${esc8(v.title)}</a></div><p class="addr">${esc8(v.url)}</p><p class="small">It is locked to you, so the first time you open it Cloudflare asks you to sign in once more. Choose <b>Cloudflare</b> (quickest if this browser is signed in to the Cloudflare dashboard) or <b>get a code by email</b>.</p>${v.extra ? `<div class="btns"><a class="btn sec wide" href="${esc8(v.extra.href)}">${esc8(v.extra.text)}</a></div>` : ""}<p class="small">Only you can open it. The first visit asks you to sign in with Cloudflare.${v.wakes ? " The first start takes about a minute; after that it sleeps when idle and wakes in seconds." : ""}</p>` : v.error ? `<p class="err">${esc8(v.error)}</p>${v.fix ? `<div class="btns"><a class="btn pri wide" href="${esc8(v.fix.href)}">${esc8(v.fix.text)}</a></div>` : ""}<div class="btns"><a class="btn sec wide" href="/personal-agents">Back</a></div>${v.log ? `<details><summary>Details</summary><pre class="addr" style="white-space:pre-wrap">${esc8(v.log)}</pre></details>` : ""}` : ""}</div>`;
  const poll = v.url || v.error ? "" : `<script>
(function(){var t=setInterval(function(){fetch(location.pathname+'.json',{cache:'no-store'}).then(function(r){return r.json()}).then(function(v){
if(v.url||v.error){clearInterval(t);location.reload();return}
var ul=document.getElementById('steps');ul.innerHTML=v.steps.map(function(s){return '<li><span class="dot '+s.state+'"></span><div><div class="t">'+s.label+'</div>'+(s.note?'<div class="n">'+s.note.replace(/[<>&]/g,'')+'</div>':'')+'</div></li>'}).join('')
}).catch(function(){})},2000)})();<\/script>`;
  return shell3(`${v.name} \xB7 qodebase`, body + poll);
}
__name(installProgressPage, "installProgressPage");
function personalAgentsPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Your own AI assistant \xB7 qodebase</title>
<meta name="description" content="Run a personal AI assistant in your own Cloudflare account: what it is, what it costs, and how to set one up without writing code.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono&display=swap" rel="stylesheet">
<style>${CSS2}</style></head><body><main>
<header><a class="mark" href="/">qodebase</a><a href="/about">About</a></header>

<h1>Your own AI assistant</h1>
<ul class="pts">
<li>Runs in <b>your</b> Cloudflare account</li>
<li>Your data, your AI model, no ads</li>
<li>No code, no GitHub: sign in with Cloudflare, tap Install</li>
</ul>
<p class="planline">Cloudflare Agent fits Cloudflare's free plan (as of Oct 2026). The others need Cloudflare's Workers Paid plan: <b>$5 a month for your whole Cloudflare account</b>, not per assistant. One plan covers all of them. <button class="linkish" type="button" popovertarget="planinfo">What you get <svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.2v4M8 4.9v.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button></p>

<div id="planinfo" popover class="planpop">
<h3>One plan for all your assistants</h3>
<p>Cloudflare's Workers Paid plan costs <b>$5 a month per Cloudflare account</b>, not per assistant. Install OpenClaw, Hermes, T3 Code, Mobile Agent and Pi in the same account and you still pay $5.</p>
<p>It includes a monthly amount of use (requests, compute, AI). Most personal use stays inside it; anything above is billed by Cloudflare to your account. Assistants sleep when idle to keep it low.</p>
<p>You pay Cloudflare directly. qodebase never sees your card.</p>
<div class="btns"><a class="btn sec" href="https://www.cloudflare.com/plans/developer-platform/" target="_blank" rel="noopener">Cloudflare's plan page<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></a><button class="btn pri" type="button" popovertarget="planinfo" popovertargetaction="hide">Got it</button></div>
</div>
<div class="cards">
<section class="card" id="agents-starter">
<div class="head"><h3>Cloudflare Agent</h3><span class="tag acc">Cloudflare free plan</span></div>
<ul class="facts"><li>Cloudflare's official <a href="https://github.com/cloudflare/agents-starter" target="_blank" rel="noopener">agents starter<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></a> (1.3k \u2605)</li><li>Chat, images, weather, reminders, scheduled tasks</li><li>Fits Cloudflare's free plan as of Oct 2026: <a href="https://developers.cloudflare.com/workers-ai/platform/pricing/" target="_blank" rel="noopener">10,000 AI units a day<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></a>, about 50\u2013100 messages</li></ul>
<div class="btns"><a class="btn pri" href="/personal-agents/install/agents-starter">Install in my Cloudflare</a><a class="btn sec" href="/p/forq/agents-starter">Code</a></div>
<details><summary>What happens</summary><ol>
<li>Sign in with Cloudflare (a free account is enough)</li>
<li>Name it, tap Install</li>
<li>Open it and chat</li>
</ol></details>
</section>


<section class="card" id="openclaw">
<div class="head"><h3>OpenClaw</h3><button class="tag busy" type="button" popovertarget="planinfo" aria-label="Needs the Cloudflare $5 a month plan. What this means">Cloudflare $5/mo plan <svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.2v4M8 4.9v.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button></div>
<ul class="facts"><li>The popular open-source assistant</li><li>Chat on the web, add Telegram later</li><li>Sleeps when idle and keeps your chats</li></ul>
<div class="btns"><a class="btn pri" href="/personal-agents/install/openclaw">Install in my Cloudflare</a><a class="btn sec" href="/p/forq/container-agents">Code</a></div>
<details><summary>What happens</summary><ol>
<li>Your Cloudflare account needs the <a href="https://www.cloudflare.com/plans/developer-platform/" target="_blank" rel="noopener">Workers Paid plan<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></a> ($5/month for your whole account)</li>
<li>Sign in with Cloudflare, name it, tap Install</li>
<li>First open installs it (a few minutes, once)</li>
</ol></details>
</section>

<section class="card" id="pi">
<div class="head"><h3>Pi</h3><button class="tag busy" type="button" popovertarget="planinfo" aria-label="Needs the Cloudflare $5 a month plan. What this means">Cloudflare $5/mo plan <svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.2v4M8 4.9v.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button></div>
<ul class="facts"><li>Pi, the popular coding agent (113k \u2605 on GitHub), as Pi Durable in <a href="https://github.com/cloudflare/agents/tree/main/examples/next/harnesses/pi" target="_blank" rel="noopener">Cloudflare's official example<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></a> (beta)</li><li>Reads and writes files, runs JavaScript, clones git repos</li><li>Close the tab mid-answer: it keeps working and picks up where it was</li><li>No container: always on, nothing to wake</li></ul>
<div class="btns"><a class="btn pri" href="/personal-agents/install/pi">Install in my Cloudflare</a><a class="btn sec" href="/p/forq/pi-durable">Code</a></div>
<details><summary>What happens</summary><ol>
<li>Your Cloudflare account needs the <a href="https://www.cloudflare.com/plans/developer-platform/" target="_blank" rel="noopener">Workers Paid plan<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></a> ($5/month for your whole account)</li>
<li>Sign in with Cloudflare, name it, tap Install</li>
<li>Open it and ask for an app</li>
</ol></details>
</section>

<section class="card" id="t3code">
<div class="head"><h3>T3 Code</h3><button class="tag busy" type="button" popovertarget="planinfo" aria-label="Needs the Cloudflare $5 a month plan. What this means">Cloudflare $5/mo plan <svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.2v4M8 4.9v.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button></div>
<ul class="facts"><li>Coding agents from your phone</li><li>OpenCode with a free model built in; sign in to Claude Code too</li><li>Keeps your projects; wakes in about 30 seconds</li></ul>
<div class="btns"><a class="btn pri" href="/personal-agents/install/t3code">Install in my Cloudflare</a><a class="btn sec" href="/p/forq/container-agents">Code</a></div>
<details><summary>What happens</summary><ol>
<li>Your Cloudflare account needs the <a href="https://www.cloudflare.com/plans/developer-platform/" target="_blank" rel="noopener">Workers Paid plan<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></a> ($5/month for your whole account)</li>
<li>Sign in with Cloudflare, name it, tap Install</li>
<li>First open installs it (a few minutes, once)</li>
</ol></details>
</section>

<section class="card" id="mobile-agent">
<div class="head"><h3>Mobile Agent</h3><button class="tag busy" type="button" popovertarget="planinfo" aria-label="Needs the Cloudflare $5 a month plan. What this means">Cloudflare $5/mo plan <svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.2v4M8 4.9v.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button></div>
<ul class="facts"><li>A terminal made for the phone: keys, input and chat in front</li><li>Claude Code and Codex built in, on your own Claude or ChatGPT plan</li><li>Keeps your work; sleeps when idle</li></ul>
<div class="btns"><a class="btn pri" href="/personal-agents/install/mobile-agent">Install in my Cloudflare</a><a class="btn sec" href="/p/forq/container-agents">Code</a></div>
<details><summary>What happens</summary><ol>
<li>Your Cloudflare account needs the <a href="https://www.cloudflare.com/plans/developer-platform/" target="_blank" rel="noopener">Workers Paid plan<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></a> ($5/month for your whole account)</li>
<li>Sign in with Cloudflare, name it, tap Install</li>
<li>First open installs it (a few minutes, once)</li>
<li>Sign in to Claude from its menu (needs a Claude Pro or Max plan)</li>
</ol></details>
</section>

<section class="card" id="hermes">
<div class="head"><h3>Hermes</h3><button class="tag busy" type="button" popovertarget="planinfo" aria-label="Needs the Cloudflare $5 a month plan. What this means">Cloudflare $5/mo plan <svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.2v4M8 4.9v.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button></div>
<ul class="facts"><li>Nous Research's agent that learns as it goes</li><li>Web dashboard, add Telegram later</li><li>Sleeps when idle and keeps what it learned</li></ul>
<div class="btns"><a class="btn pri" href="/personal-agents/install/hermes">Install in my Cloudflare</a><a class="btn sec" href="/p/forq/container-agents">Code</a></div>
<details><summary>What happens</summary><ol>
<li>Your Cloudflare account needs the <a href="https://www.cloudflare.com/plans/developer-platform/" target="_blank" rel="noopener">Workers Paid plan<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></a> ($5/month for your whole account)</li>
<li>Sign in with Cloudflare, name it, tap Install</li>
<li>First open installs it (a few minutes, once)</li>
</ol></details>
</section>
</div>

<p class="foot"><a href="/">qodebase</a><a href="/about">About</a><a href="/privacy">Privacy</a><a href="/feedback?from=/personal-agents">Feedback</a></p>
</main></body></html>`;
}
__name(personalAgentsPage, "personalAgentsPage");

// ../src/own.ts
var PLAN = "https://developers.cloudflare.com/workers/platform/pricing/";
var EXT = `<svg class="ico" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
function ownPage(installReady) {
  const action = installReady ? `<a class="btn" href="/personal-agents/install/qodebase">Install in my Cloudflare</a>` : `<a class="btn" href="/p/forq/forq/readme?doc=SELF_HOST.md">Read the setup guide</a><p class="note">One-tap install into your Cloudflare account is being built.</p>`;
  return shell("Get your own qodebase \xB7 qodebase", `<a class="back" href="/">qodebase</a>
<h1>Get your own qodebase</h1>
<p class="desc">The same qodebase, in your own Cloudflare account. Your projects, your apps and your agents live there.</p>
<ul class="ownpts">
<li>Your code in your account, on Cloudflare's git storage</li>
<li>Agents run on your own Claude account or Anthropic API key</li>
<li>Locked to you by Cloudflare sign-in</li>
<li>Needs Cloudflare's Workers Paid plan: <a href="${PLAN}" target="_blank" rel="noopener">$5 a month for the whole account${EXT}</a></li>
</ul>
<div class="ownact">${action}</div>
<p class="desc small">It is open source: <a href="https://github.com/eyalev/qodebase" target="_blank" rel="noopener">github.com/eyalev/qodebase${EXT}</a></p>
<style>.ownpts{margin:16px 0 24px;padding-left:20px;line-height:1.5}.ownpts li{margin:6px 0}.ownact .btn{display:flex;justify-content:center;align-items:center;min-height:48px;width:100%}.ownact .note{color:var(--dim);font-size:14px;margin:8px 0 0}.small{font-size:14px;margin-top:24px}.ico{vertical-align:-1px;margin-left:3px}</style>`);
}
__name(ownPage, "ownPage");

// ../src/install.ts
import { DurableObject as DurableObject5 } from "cloudflare:workers";

// ../src/cliauth.ts
import QB_CLI from "./a4249b714f342bdf224053349394aefd9e1a0244-qb.mjs";
var LOGIN_TTL_MS = 10 * 6e4;
var ALPHABET = "BCDFGHJKLMNPQRSTVWXZ23456789";
var json = /* @__PURE__ */ __name((data, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } }), "json");
var b64url2 = /* @__PURE__ */ __name((u) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), "b64url");
var random = /* @__PURE__ */ __name((n) => crypto.getRandomValues(new Uint8Array(n)), "random");
async function sha(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha, "sha");
var userCode = /* @__PURE__ */ __name(() => {
  const r = random(8);
  const c = [...r].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}, "userCode");
var normCode = /* @__PURE__ */ __name((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^(.{4})(.{4})$/, "$1-$2"), "normCode");
async function bearerEmail(env, request) {
  const m = (request.headers.get("authorization") || "").match(/^Bearer\s+(qb_[A-Za-z0-9_-]{20,})$/);
  if (!m) return request.headers.has("authorization") ? null : void 0;
  const t = await registry(env).cliToken(await sha(m[1]));
  return t ? t.email : null;
}
__name(bearerEmail, "bearerEmail");
async function cliPublicRoute(request, env, url) {
  const p = url.pathname;
  if (p === "/api/cli/start" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const device2 = `qbd_${b64url2(random(32))}`;
    const code = userCode();
    await registry(env).cliStart(await sha(device2), code, Date.now() + LOGIN_TTL_MS);
    log("cli", "login_start", { label: String(b.label || "").slice(0, 60) });
    return json({
      device_code: device2,
      user_code: code,
      verification_uri: `${url.origin}/cli/login`,
      verification_uri_complete: `${url.origin}/cli/login?code=${code}`,
      interval: 3,
      expires_in: LOGIN_TTL_MS / 1e3
    });
  }
  if (p === "/api/cli/token" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    if (!b.device_code) return json({ error: "device_code missing" }, 400);
    const token = `qb_${b64url2(random(32))}`;
    const r = await registry(env).cliClaim(await sha(b.device_code), await sha(token));
    if (r.status === "pending") return json({ status: "pending" }, 428);
    if (r.status === "expired") return json({ status: "expired", error: "This sign-in expired. Run qb login again." }, 410);
    const u = await registry(env).getUser(r.email);
    log("cli", "login_done", { handle: u?.handle });
    return json({ status: "ok", token, handle: u?.handle || null });
  }
  if (p === "/cli/qb.mjs") return new Response(QB_CLI, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=300" } });
  if (p === "/cli/install.sh") return new Response(installSh(url.origin), { headers: { "content-type": "text/x-shellscript; charset=utf-8", "cache-control": "public, max-age=300" } });
  if (p === "/llms.txt") return new Response(llmsTxt(url.origin), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
  if (p === "/cli" || p === "/cli/") return new Response(cliPage(url.origin), { headers: { "content-type": "text/html; charset=utf-8" } });
  return null;
}
__name(cliPublicRoute, "cliPublicRoute");
async function cliUserRoute(request, env, url, email, handle) {
  const p = url.pathname;
  if (p === "/cli/login" && request.method === "GET") {
    const code = normCode(url.searchParams.get("code") || "");
    const pend = code ? await registry(env).cliPending(code) : null;
    return html(approvePage(code, !!pend && !pend.email, handle));
  }
  if (p === "/cli/login" && request.method === "POST") {
    const form = await request.formData();
    const code = normCode(String(form.get("code") || ""));
    const label2 = String(form.get("label") || "").trim().slice(0, 60) || "CLI";
    const ok = await registry(env).cliApprove(code, email, label2);
    log("cli", ok ? "login_approved" : "login_refused", { handle });
    return html(ok ? donePage(handle) : approvePage(code, false, handle, true), ok ? 200 : 400);
  }
  if (p === "/api/cli/me") return json({ handle, email });
  if (p === "/api/cli/tokens" && request.method === "GET") {
    return json({ tokens: (await registry(env).cliTokens(email)).map(({ id, label: label2, createdAt, usedAt }) => ({ id, label: label2, createdAt, usedAt })) });
  }
  if (p === "/api/cli/revoke" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    return json({ ok: await registry(env).cliRevoke(email, String(b.id || "")) });
  }
  return null;
}
__name(cliUserRoute, "cliUserRoute");
var html = /* @__PURE__ */ __name((body, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }), "html");
var CSS3 = `<style>.field{width:100%;font:16px 'Instrument Sans',sans-serif;padding:12px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg)}
.code{font:600 28px 'JetBrains Mono',monospace;letter-spacing:.06em;margin:8px 0 4px}.cmd{font:14px 'JetBrains Mono',monospace;background:var(--chip);border-radius:8px;padding:10px 12px;white-space:pre-wrap;overflow-wrap:anywhere}
form .btn{margin-top:12px;width:100%}.err{color:var(--bad,#b3261e)}</style>`;
function approvePage(code, live, handle, failed = false) {
  if (!code || !live) {
    return shell("Sign in the CLI \xB7 qodebase", `${CSS3}<a class="back" href="/">qodebase</a>
<h1>Sign in the CLI</h1>
${failed || code ? `<p class="desc err">${code ? "That code has expired or was already used." : ""} Run <b>qb login</b> again for a new one.</p>` : ""}
<form method="get" action="/cli/login"><label class="desc" for="c">The code <b>qb login</b> printed</label>
<input class="field" id="c" name="code" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ABCD-EFGH" required>
<button class="btn">Continue</button></form>`);
  }
  return shell("Sign in the CLI \xB7 qodebase", `${CSS3}<a class="back" href="/">qodebase</a>
<h1>Sign in the CLI</h1>
<p class="desc">Check that this is the code on the computer where you ran <b>qb login</b>:</p>
<p class="code">${esc4(code)}</p>
<p class="desc">Approving lets that CLI act as <b>${esc4(handle)}</b>: create and fork projects, start agents, merge. Approve only a code you started yourself just now.</p>
<form method="post" action="/cli/login"><input type="hidden" name="code" value="${esc4(code)}">
<label class="desc" for="l">Name it (shown in Settings, where you can revoke it)</label>
<input class="field" id="l" name="label" maxlength="60" placeholder="Laptop" autocomplete="off">
<button class="btn">Approve</button></form>`);
}
__name(approvePage, "approvePage");
var donePage = /* @__PURE__ */ __name((handle) => shell("CLI signed in \xB7 qodebase", `${CSS3}<a class="back" href="/">qodebase</a>
<h1>Done</h1><p class="desc">The CLI is signed in as <b>${esc4(handle)}</b>. Go back to your terminal; it continues by itself.</p>`), "donePage");
function cliPage(origin) {
  return shell("Command line \xB7 qodebase", `${CSS3}<a class="back" href="/">qodebase</a>
<h1>qodebase from the command line</h1>
<p class="desc">For you and for your agents (Claude Code, Codex, anything with a shell). Needs Node 18 or newer.</p>
<h2>Install</h2><div class="cmd">curl -fsSL ${esc4(origin)}/cli/install.sh | sh</div>
<h2>Sign in</h2><div class="cmd">qb login</div>
<p class="desc">It prints a code and a link. Open the link on your phone, check the code, approve.</p>
<h2>Your own AI assistant</h2><div class="cmd">qb install agents-starter</div>
<p class="desc">Installs it into <b>your</b> Cloudflare account. The first time it asks you to approve twice on your phone: qodebase sign-in, then Cloudflare. <span class="cmd" style="display:inline;padding:1px 6px">qb installs</span> lists the others.</p>
<h2>Use it</h2><div class="cmd">qb new "a tip calculator with a dark mode"
qb import github.com/owner/repo
qb fork forq/todo
qb ask eyal/todo "add due dates"
qb agents eyal/todo
qb merge eyal/todo &lt;agent&gt;
qb clone eyal/todo</div>
<p class="desc">Every command prints JSON when its output is piped, so agents can read it. <a href="/llms.txt">llms.txt</a> describes all of them for agents.</p>`);
}
__name(cliPage, "cliPage");
var installSh = /* @__PURE__ */ __name((origin) => `#!/bin/sh
# Installs the qodebase CLI as ~/.local/bin/qb (needs Node 18+).
set -e
command -v node >/dev/null 2>&1 || { echo "qb needs Node 18 or newer: https://nodejs.org" >&2; exit 1; }
mkdir -p "$HOME/.local/bin"
curl -fsSL ${origin}/cli/qb.mjs -o "$HOME/.local/bin/qb"
chmod +x "$HOME/.local/bin/qb"
echo "Installed qb in $HOME/.local/bin. Next: qb install agents-starter (your own AI assistant, Cloudflare free plan), qb installs (all of them), or qb help"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo "Add $HOME/.local/bin to your PATH.";; esac
`, "installSh");
function llmsTxt(origin) {
  return `# qodebase

> A git platform for the age of agents, on Cloudflare, made for the phone. Every
> project runs as a live app; every fork comes with its own agents (Claude Code in a
> container, one fork each). Open source: run your own copy on your Cloudflare account.

## For agents: the qb CLI

Install: \`curl -fsSL ${origin}/cli/install.sh | sh\` (Node 18+), then \`qb login\`
(prints a code; a person approves it at ${origin}/cli/login). Output is JSON when piped
or with --json. Projects are named owner/name. Another instance: --host <url> or QB_HOST.

- \`qb whoami\` \u2014 who the token acts as
- \`qb ls [--mine] [--owner <handle>]\` \u2014 projects
- \`qb info <owner/name>\` \u2014 a project: description, live URL, agents and their states
- \`qb new "<what to build>" [--name <name>]\` \u2014 a new project; agents build it
- \`qb import <github url or owner/repo>\` \u2014 copy a public GitHub repo in
- \`qb visibility <owner/name> public|private\` \u2014 private = only the owner sees the project, its code and its live app (\`--private\` on new and import too)
- \`qb fork <owner/name>\` \u2014 your own copy
- \`qb ask <owner/name> "<request>"\` \u2014 the project's router agent splits it into tasks, one agent each
- \`qb spawn <owner/name> "<task>"\` \u2014 one agent on its own fork, directly
- \`qb agents <owner/name>\` \u2014 agents and states (working, pushed, blocked, merged)
- \`qb send <agent-id> "<text>"\` \u2014 message an agent
- \`qb chat <agent-id>\` \u2014 an agent's conversation so far
- \`qb merge <owner/name> <agent-id>\` \u2014 merge an agent's fork into main
- \`qb files <owner/name>\`, \`qb search <owner/name> "<text>"\` \u2014 read code without cloning
- \`qb installs\` \u2014 your own AI assistants (installed into YOUR Cloudflare account) and the ones you can install
- \`qb install <agents-starter|openclaw|pi|t3code|mobile-agent|hermes> [--name n] [--account id]\` \u2014 installs one; the first time it prints one link where a person lets qodebase into their Cloudflare account, then waits and prints the assistant's URL (locked to that person by Cloudflare Access). An existing name for the same agent updates it in place (keeps its data); a name used by a different agent is refused. Without a token it starts qb login first
- \`qb uninstall <name> --yes\` \u2014 deletes an installed assistant: its Worker and data, its Access app, the record (\`removed: true\` in qb installs = its Worker was deleted elsewhere)
- \`qb clone <owner/name> [dir]\` \u2014 git clone (a short-lived token: write for your own projects, read otherwise)
- \`qb open <owner/name>\` \u2014 the project's page and live app URLs
- \`qb tokens\`, \`qb revoke <id>\`, \`qb logout\`

## HTTP API

Everything qb does is HTTP with \`authorization: Bearer qb_\u2026\` on ${origin}:
GET /api/projects, GET /api/p/<owner>/<name>, POST /api/build {prompt,name,private}, POST /api/import {repo,private}, POST /api/p/<o>/<n>/visibility {private},
POST /api/p/<o>/<n>/fork, /router {text}, /agents {task}, /merge {agent}, /git-token,
GET /api/p/<o>/<n>/files, /search?q=, GET|POST|DELETE /api/installs {template,name,account} (409 + approve_url until Cloudflare is connected), GET /personal-agents/i/<id>.json, GET /api/agents/<id>/state, /conversation, POST /api/agents/<id>/send {text}.
`;
}
__name(llmsTxt, "llmsTxt");

// ../src/install.ts
var TEMPLATES = {
  openclaw: {
    id: "openclaw",
    title: "OpenClaw",
    repo: "forq.container-agents",
    dir: "forq-release-openclaw",
    defaultName: "my-openclaw",
    vars: { AGENT_KIND: "openclaw", MODEL: "@cf/zai-org/glm-4.7-flash" },
    secretVar: "AGENT_SECRET",
    container: true
  },
  // Get your own qodebase (/own): this code, from forq's own Artifacts copy (forq/forq,
  // forq-release-selfhost/ built by scripts/selfhost-release.mjs).
  qodebase: {
    id: "qodebase",
    title: "qodebase",
    repo: "forq.forq",
    dir: "forq-release-selfhost",
    defaultName: "my-qodebase",
    vars: { SELF_HOST: "1", BOX_IMAGE: "managed" },
    container: true,
    selfhost: true,
    artifacts: true
  },
  "agents-starter": { id: "agents-starter", title: "Cloudflare Agent", repo: "forq.agents-starter", dir: "forq-release", defaultName: "my-agent" },
  pi: { id: "pi", title: "Pi", repo: "forq.pi-durable", dir: "forq-release", defaultName: "my-pi", paid: true },
  t3code: {
    id: "t3code",
    title: "T3 Code",
    repo: "forq.container-agents",
    dir: "forq-release-t3code",
    defaultName: "my-t3code",
    vars: { AGENT_KIND: "t3code", MODEL: "@cf/zai-org/glm-4.7-flash" },
    secretVar: "AGENT_SECRET",
    container: true
  },
  "mobile-agent": {
    id: "mobile-agent",
    title: "Mobile Agent",
    repo: "forq.container-agents",
    dir: "forq-release-mobile-agent",
    defaultName: "my-mobile-agent",
    vars: { AGENT_KIND: "mobile-agent", MODEL: "@cf/zai-org/glm-4.7-flash" },
    secretVar: "AGENT_SECRET",
    container: true
  },
  hermes: {
    id: "hermes",
    title: "Hermes",
    repo: "forq.container-agents",
    dir: "forq-release-hermes",
    defaultName: "my-hermes",
    vars: { AGENT_KIND: "hermes", MODEL: "@cf/zai-org/glm-4.7-flash" },
    secretVar: "AGENT_SECRET",
    container: true
  }
};
var API = "https://api.cloudflare.com/client/v4";
var AUTH_URL = "https://dash.cloudflare.com/oauth2/auth";
var TOKEN_URL = "https://dash.cloudflare.com/oauth2/token";
var SCOPES = [
  "memberships.read",
  "account-settings.read",
  "workers-scripts.read",
  "workers-scripts.write",
  "containers.write",
  "ai.read",
  "aig.read",
  "aig.write",
  "browser-rendering.write",
  "access-app.write",
  "access-policy.write",
  "access-org.read",
  "access-org.write",
  "access-idp.read",
  "access-idp.write",
  "offline_access"
];
var WORKER_NAME_RE = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;
var STEPS2 = [
  { key: "account", label: "Check your Cloudflare account" },
  { key: "storage", label: "Make its private storage" },
  { key: "deploy", label: "Put the assistant in your account" },
  { key: "lock", label: "Lock it so only you can open it" },
  { key: "ready", label: "Ready" }
];
var enc2 = new TextEncoder();
async function hmac2(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc2.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc2.encode(msg)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hmac2, "hmac");
var safePath = /* @__PURE__ */ __name((p) => p && p.startsWith("/") && !p.startsWith("//") ? p : "/personal-agents", "safePath");
var html2 = /* @__PURE__ */ __name((body, status = 200, headers = {}) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers } }), "html");
var redirect = /* @__PURE__ */ __name((location, headers = {}) => new Response(null, { status: 302, headers: { location, "cache-control": "no-store", ...headers } }), "redirect");
var installsStub = /* @__PURE__ */ __name((env, email) => env.Installs.get(env.Installs.idFromName(email.toLowerCase())), "installsStub");
async function cf(token, path2, init = {}) {
  const r = await fetch(`${API}${path2}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers || {} } }).catch((e) => new Response(JSON.stringify({ success: false, errors: [{ message: String(e) }] }), { status: 599 }));
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && j.success !== false, status: r.status, result: j.result, errors: j.errors || [] };
}
__name(cf, "cf");
var errText = /* @__PURE__ */ __name((e) => e.map((x) => `${x.message || ""}${x.code ? ` (${x.code})` : ""}`).join("; ") || "unknown error", "errText");
var needsConnect = /* @__PURE__ */ __name((conn, t) => !conn.connected || !!t.container && !conn.scopes.includes("containers.write") || !!t.artifacts && !conn.scopes.includes("artifacts.write"), "needsConnect");
var callbackUrl = /* @__PURE__ */ __name((env, url) => `https://${isUiHost(env, url.hostname) ? url.hostname : env.UI_HOST}/connect/cf/callback`, "callbackUrl");
async function installRoute(request, env, ctx, url) {
  const p = url.pathname;
  if (!p.startsWith("/connect/cf/") && !p.startsWith("/personal-agents/install/") && !p.startsWith("/personal-agents/i/") && p !== "/api/installs") return null;
  const bearer = await bearerEmail(env, request);
  const email = bearer || await sessionEmail(env, request);
  const back = p + url.search;
  if (!email) return bearer === null || p === "/api/installs" || p.endsWith(".json") ? Response.json({ error: "Sign in first (qb login)" }, { status: 401 }) : redirect(`/login?next=${encodeURIComponent(back)}`);
  const stub = installsStub(env, email);
  if (p === "/api/installs") {
    const conn = await stub.connection();
    const approve = /* @__PURE__ */ __name((t) => `${url.origin}/connect/cf/start?next=${encodeURIComponent(t ? `/personal-agents/install/${t.id}` : "/personal-agents")}${conn.connected ? "&again=1" : ""}${t?.artifacts ? "&extra=artifacts" : ""}`, "approve");
    if (request.method === "GET") {
      return Response.json({
        connected: conn.connected,
        accounts: conn.accounts,
        templates: Object.values(TEMPLATES).map((t) => ({ id: t.id, title: t.title, defaultName: t.defaultName, needsPaidPlan: !!(t.paid || t.container) })),
        installs: latestInstalls(await stub.list(), conn.connected ? await stub.liveWorkers() : null)
      }, { headers: { "cache-control": "no-store" } });
    }
    if (request.method === "POST") {
      const b = await request.json().catch(() => ({}));
      const t = TEMPLATES[String(b.template || "")];
      if (!t) return Response.json({ error: `Unknown agent. One of: ${Object.keys(TEMPLATES).join(", ")}` }, { status: 400 });
      if (needsConnect(conn, t)) {
        return Response.json({ needs: "cloudflare", approve_url: approve(t), error: "Approve qodebase in your Cloudflare account first" }, { status: 409 });
      }
      if (!b.account && conn.accounts.length > 1) return Response.json({ error: "Pick the Cloudflare account (--account <id>)", accounts: conn.accounts }, { status: 400 });
      const r = await stub.start(t.id, String(b.name || t.defaultName).trim().toLowerCase(), String(b.account || ""), email);
      if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
      return Response.json({ id: r.id, page: `${url.origin}/personal-agents/i/${r.id}`, status: `${url.origin}/personal-agents/i/${r.id}.json` });
    }
    if (request.method === "DELETE") {
      const b = await request.json().catch(() => ({}));
      const name = String(b.name || "");
      const accts = [...new Set((await stub.list()).filter((i) => i.name === name).map((i) => i.accountId))];
      const account = String(b.account || (accts.length === 1 ? accts[0] : ""));
      if (!account) return Response.json({ error: accts.length ? "That name is in more than one account (--account <id>)" : `You have no assistant called ${name}.` }, { status: 400 });
      const r = await stub.uninstall(name, account);
      return Response.json(r, { status: r.ok ? 200 : 400 });
    }
    return Response.json({ error: "GET, POST or DELETE" }, { status: 405 });
  }
  if (p === "/connect/cf/start") {
    const next = safePath(url.searchParams.get("next"));
    const nonce = crypto.randomUUID();
    const exp = Date.now() + 15 * 6e4;
    const body = `${email}|${exp}|${next}|${nonce}`;
    const state = btoa(`${body}|${await hmac2(env.ADMIN_SECRET, `cfstate:${body}`)}`).replace(/=+$/, "");
    const extra = url.searchParams.get("extra") === "artifacts" ? ["artifacts.read", "artifacts.write"] : [];
    const q = new URLSearchParams({ response_type: "code", client_id: env.CF_OAUTH_CLIENT_ID, redirect_uri: callbackUrl(env, url), scope: [...SCOPES, ...extra].join(" "), state });
    if (url.searchParams.get("again")) q.set("prompt", "consent");
    log("install", "oauth_start", { email, next });
    return redirect(`${AUTH_URL}?${q}`, { "set-cookie": `forq_cfstate=${nonce}; Path=/connect/cf; Max-Age=900; HttpOnly; Secure; SameSite=Lax` });
  }
  if (p === "/connect/cf/callback") {
    const fail = /* @__PURE__ */ __name((why, extra = {}) => {
      log("install", "oauth_failed", { email, why, ...extra });
      return html2(installPage({ kind: "error", text: why, next: "/personal-agents" }), 400);
    }, "fail");
    if (url.searchParams.get("error")) return fail(url.searchParams.get("error") === "access_denied" ? "Cloudflare sign-in was cancelled." : `Cloudflare said: ${url.searchParams.get("error_description") || url.searchParams.get("error")}`);
    let parts;
    try {
      parts = atob(url.searchParams.get("state") || "").split("|");
    } catch {
      return fail("That sign-in link is broken. Start again.");
    }
    const [sEmail, sExp, sNext, sNonce, sig2] = parts;
    const cookieNonce = ((request.headers.get("cookie") || "").match(/forq_cfstate=([0-9a-f-]+)/) || [])[1];
    if (!sig2 || sig2 !== await hmac2(env.ADMIN_SECRET, `cfstate:${sEmail}|${sExp}|${sNext}|${sNonce}`) || sEmail !== email || Number(sExp) < Date.now() || cookieNonce !== sNonce) return fail("That sign-in link has expired. Start again.");
    const tok = await tokenRequest(env, { grant_type: "authorization_code", code: url.searchParams.get("code") || "", redirect_uri: callbackUrl(env, url) });
    if (!tok.access_token || !tok.refresh_token) return fail("Cloudflare did not hand over a sign-in token. Try again.", { status: tok.status, error: tok.error });
    const accts = await cf(tok.access_token, "/accounts?per_page=50");
    const accounts = (accts.result || []).map((a) => ({ id: a.id, name: a.name }));
    if (!accounts.length) return fail("No Cloudflare account was shared with forq. Start again and tick an account.");
    await stub.saveConnection(tok.access_token, tok.refresh_token, Number(tok.expires_in || 3600), accounts, String(tok.scope || "").split(/\s+/).filter(Boolean));
    log("install", "oauth_connected", { email, accounts: accounts.length, scope: tok.scope });
    return redirect(safePath(sNext), { "set-cookie": "forq_cfstate=; Path=/connect/cf; Max-Age=0; HttpOnly; Secure; SameSite=Lax" });
  }
  if (p === "/connect/cf/disconnect" && request.method === "POST") {
    await stub.disconnect();
    return redirect(safePath(url.searchParams.get("next")));
  }
  const m = p.match(/^\/personal-agents\/install\/([a-z0-9-]+)$/);
  if (m) {
    const t = TEMPLATES[m[1]];
    if (!t) return html2("No such agent", 404);
    const conn = await stub.connection();
    if (request.method === "POST") {
      const f = await request.formData();
      const r = await stub.start(t.id, String(f.get("name") || "").trim().toLowerCase(), String(f.get("account") || ""), email);
      if (!r.ok) return html2(installPage({ kind: "form", template: t, accounts: conn.accounts, name: String(f.get("name") || ""), error: r.error }), 400);
      return new Response(null, { status: 303, headers: { location: `/personal-agents/i/${r.id}` } });
    }
    if (needsConnect(conn, t)) return html2(installPage({ kind: "connect", template: t, startHref: `/connect/cf/start?next=${encodeURIComponent(p)}${conn.connected ? "&again=1" : ""}${t.artifacts ? "&extra=artifacts" : ""}` }));
    return html2(installPage({ kind: "form", template: t, accounts: conn.accounts, name: t.defaultName }));
  }
  const s = p.match(/^\/personal-agents\/i\/([a-z0-9]+)(\.json)?$/);
  if (s) {
    const inst = await stub.get(s[1]);
    if (!inst) return html2("No such install", 404);
    if (s[2]) return Response.json(view(inst), { headers: { "cache-control": "no-store" } });
    return html2(installProgressPage(view(inst)));
  }
  return null;
}
__name(installRoute, "installRoute");
function latestInstalls(all, live) {
  const rows = /* @__PURE__ */ new Map();
  for (const i of all) {
    const k2 = `${i.accountId}/${i.name}`;
    const row2 = rows.get(k2);
    if (!row2) {
      const { log: _log, ...v } = view(i);
      rows.set(k2, { ...v, account: i.accountId, updated: i.updatedAt, attempts: 1 });
      continue;
    }
    row2.attempts++;
    if (!row2.url && i.url) {
      row2.url = i.url;
      row2.runningOlder = true;
    }
  }
  for (const r of rows.values()) if (r.url && live?.[r.account] && !live[r.account].includes(r.name)) {
    r.removed = true;
    r.url = void 0;
  }
  return [...rows.values()];
}
__name(latestInstalls, "latestInstalls");
var RETIRED = { "personal-agent": "Personal Agent" };
var view = /* @__PURE__ */ __name((i) => ({
  id: i.id,
  title: TEMPLATES[i.template]?.title || RETIRED[i.template] || i.template,
  name: i.name,
  accountName: i.accountName,
  steps: i.steps,
  url: i.url,
  error: i.error,
  fix: i.fix,
  log: i.log,
  wakes: !!TEMPLATES[i.template]?.container,
  extra: i.url && i.template === "mobile-agent" ? { text: "Sign in to Claude (needed)", href: `${i.url}/__forq/claude` } : i.url && i.template === "t3code" ? { text: "Sign in to Claude Code (optional)", href: `${i.url}/__forq/claude` } : void 0
}), "view");
async function tokenRequest(env, params) {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { authorization: `Basic ${btoa(`${env.CF_OAUTH_CLIENT_ID}:${env.CF_OAUTH_CLIENT_SECRET}`)}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params)
  }).catch((e) => new Response(JSON.stringify({ error: String(e) }), { status: 599 }));
  const j = await r.json().catch(() => ({}));
  return { ...j, status: r.status };
}
__name(tokenRequest, "tokenRequest");
var Installs = class extends DurableObject5 {
  static {
    __name(this, "Installs");
  }
  async connection() {
    const c = await this.ctx.storage.get("conn");
    return { connected: !!c, accounts: c?.accounts || [], connectedAt: c?.connectedAt, scopes: c?.scopes || [] };
  }
  async saveConnection(access, refresh, expiresIn, accounts, scopes = []) {
    await this.ctx.storage.put("conn", {
      refreshEnc: await encryptKey(this.env, refresh),
      accessEnc: await encryptKey(this.env, access),
      accessExp: Date.now() + (expiresIn - 120) * 1e3,
      accounts,
      connectedAt: Date.now(),
      scopes
    });
  }
  async disconnect() {
    const c = await this.ctx.storage.get("conn");
    if (c) {
      const rt = await decryptKey(this.env, c.refreshEnc).catch(() => "");
      if (rt) await fetch("https://dash.cloudflare.com/oauth2/revoke", { method: "POST", headers: { authorization: `Basic ${btoa(`${this.env.CF_OAUTH_CLIENT_ID}:${this.env.CF_OAUTH_CLIENT_SECRET}`)}`, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: rt, token_type_hint: "refresh_token" }) }).catch(() => {
      });
    }
    await this.ctx.storage.delete("conn");
  }
  /** A live access token, refreshing (and saving the rotated refresh token) when needed. */
  /** Worker names per account that has installs, so the list can show removed ones. null = could not check. */
  async liveWorkers() {
    try {
      const token = await this.#token();
      const accts = [...new Set((await this.list()).filter((i) => i.url).map((i) => i.accountId))];
      const out = {};
      for (const a of accts) {
        const r = await cf(token, `/accounts/${a}/workers/scripts`);
        if (!r.ok) return null;
        out[a] = (r.result || []).map((x) => x.id);
      }
      return out;
    } catch (e) {
      log("install", "live_check_failed", { err: String(e) });
      return null;
    }
  }
  /** Deletes an installed assistant: its Worker (with its data), its Access app, our records. */
  async uninstall(name, accountId) {
    const mine = (await this.list()).filter((i) => i.name === name && i.accountId === accountId);
    if (!mine.length) return { ok: false, error: `You have no assistant called ${name} in that account.` };
    if (mine.some((i) => i.steps.some((st) => st.state === "doing"))) return { ok: false, error: `${name} is installing right now. Wait for it to finish.` };
    const token = await this.#token();
    const scripts = await cf(token, `/accounts/${accountId}/workers/scripts`);
    const tag2 = (scripts.result || []).find((x) => x.id === name)?.tag;
    let accessApps = 0;
    if (tag2) {
      const apps = await cf(token, `/accounts/${accountId}/access/apps?per_page=100`);
      for (const ap of apps.result || []) {
        if ((ap.destinations || []).some((d) => d.type === "worker" && d.worker_id === tag2)) {
          const d = await cf(token, `/accounts/${accountId}/access/apps/${ap.id}`, { method: "DELETE" });
          if (d.ok) accessApps++;
        }
      }
      const del = await cf(token, `/accounts/${accountId}/workers/scripts/${name}?force=true`, { method: "DELETE" });
      if (!del.ok) return { ok: false, error: `Cloudflare did not delete the Worker: ${JSON.stringify(del.errors || del).slice(0, 200)}` };
    }
    const buckets = [...new Set(mine.map((i) => i.steps.find((st) => st.key === "storage" && st.state === "done")?.note || "").filter((n) => /^[a-z0-9][a-z0-9-]{2,62}$/.test(n)))];
    const gone = [];
    for (const b of buckets) {
      const base = `/accounts/${accountId}/r2/buckets/${b}`;
      if ((await cf(token, base)).status === 404) continue;
      for (let page = 0; page < 20; page++) {
        const list = await cf(token, `${base}/objects?per_page=1000`);
        const keys = (list.result || []).map((o) => o.key);
        if (!keys.length) break;
        for (const k2 of keys) await cf(token, `${base}/objects/${encodeURIComponent(k2)}`, { method: "DELETE" });
      }
      const d = await cf(token, base, { method: "DELETE" });
      if (!d.ok) return { ok: false, error: `The Worker is deleted, but its storage bucket ${b} is not (${JSON.stringify(d.errors).slice(0, 160)}). Delete it in the Cloudflare dashboard under R2.` };
      gone.push(b);
    }
    await this.ctx.storage.delete(mine.map((i) => `i:${i.id}`));
    log("install", "uninstalled", { name, account: accountId, worker: !!tag2, accessApps, records: mine.length, buckets: gone });
    return { ok: true, worker: !!tag2, accessApps, records: mine.length, buckets: gone };
  }
  async #token() {
    const c = await this.ctx.storage.get("conn");
    if (!c) throw new Error("not connected to Cloudflare");
    if (Date.now() < c.accessExp) return decryptKey(this.env, c.accessEnc);
    const t = await tokenRequest(this.env, { grant_type: "refresh_token", refresh_token: await decryptKey(this.env, c.refreshEnc) });
    if (!t.access_token) {
      log("install", "refresh_failed", { status: t.status, error: t.error });
      throw new Error("Cloudflare sign-in expired: sign in with Cloudflare again");
    }
    await this.ctx.storage.put("conn", { ...c, accessEnc: await encryptKey(this.env, t.access_token), refreshEnc: t.refresh_token ? await encryptKey(this.env, t.refresh_token) : c.refreshEnc, accessExp: Date.now() + (Number(t.expires_in || 3600) - 120) * 1e3 });
    return t.access_token;
  }
  async get(id) {
    const i = await this.ctx.storage.get(`i:${id}`) || null;
    return i && this.#renamed(i);
  }
  async list() {
    return [...(await this.ctx.storage.list({ prefix: "i:" })).values()].map((i) => this.#renamed(i)).sort((a, b) => b.createdAt - a.createdAt);
  }
  /** Templates renamed since an install was made (claudecode → mobile-agent, 2026-10-06). */
  #renamed(i) {
    const to = { claudecode: "mobile-agent" }[i.template];
    return to ? { ...i, template: to } : i;
  }
  async start(template, name, accountId, email) {
    const c = await this.ctx.storage.get("conn");
    if (!c) return { ok: false, error: "Sign in with Cloudflare first." };
    if (!TEMPLATES[template]) return { ok: false, error: "Unknown agent." };
    if (!WORKER_NAME_RE.test(name)) return { ok: false, error: "Use 3 to 40 lowercase letters, numbers and dashes, starting with a letter." };
    const acct = c.accounts.find((a) => a.id === accountId) || (c.accounts.length === 1 ? c.accounts[0] : void 0);
    if (!acct) return { ok: false, error: "Pick the Cloudflare account to install into." };
    const clash = (await this.list()).find((i) => i.name === name && i.accountId === acct.id && i.template !== template && i.url);
    if (clash) return { ok: false, error: `${name} is already your ${TEMPLATES[clash.template]?.title || clash.template} in ${acct.name}. Pick another name.` };
    const waiting = (await this.list()).find((i) => i.name === name && i.accountId === acct.id && !i.error && i.steps.some((s) => s.state !== "done"));
    if (waiting) {
      if (waiting.template !== template) return { ok: false, error: `${name} is still installing. Wait for it to finish.` };
      if (!await this.ctx.storage.get("active")) await this.#next();
      return { ok: true, id: waiting.id };
    }
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const inst = {
      id,
      template,
      name,
      accountId: acct.id,
      accountName: acct.name,
      email,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      steps: STEPS2.map((s) => ({ ...s, state: "todo" }))
    };
    await this.ctx.storage.put(`i:${id}`, inst);
    const busy = await this.ctx.storage.get("active");
    if (!busy) await this.#next();
    log("install", "start", { email, template, name, account: acct.id, queued: !!busy });
    return { ok: true, id };
  }
  /** The current install is over (ready or failed): start the oldest one waiting in line. */
  async #next() {
    await this.ctx.storage.delete("active");
    const queued = (await this.list()).filter((i) => !i.error && i.steps.every((s) => s.state === "todo")).sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!queued) return;
    await this.ctx.storage.put("active", queued.id);
    await this.ctx.storage.setAlarm(Date.now() + 50);
    log("install", "dequeued", { id: queued.id, name: queued.name });
  }
  async #save(i) {
    i.updatedAt = Date.now();
    await this.ctx.storage.put(`i:${i.id}`, i);
  }
  #step(i, key, state, note) {
    const s = i.steps.find((x) => x.key === key);
    s.state = state;
    s.note = note;
  }
  async #fail(i, key, error, fix) {
    this.#step(i, key, "failed", error);
    i.error = error;
    i.fix = fix;
    await this.#save(i);
    await this.#next();
    log("install", "failed", { id: i.id, step: key, error });
  }
  async alarm() {
    const id = await this.ctx.storage.get("active");
    const i = id ? await this.get(id) : null;
    if (!i) return this.#next();
    const next = i.steps.find((s) => s.state !== "done");
    if (!next || next.state === "failed") return this.#next();
    if (next.key === "deploy" && next.state === "doing") {
      const kept = await this.env.BuildBox.get(this.env.BuildBox.idFromName("installs")).result(`install-${i.id}`).catch(() => null);
      if (kept) {
        log("install", "result_fetched", { id: i.id, ok: kept.ok });
        return this.buildDone(kept);
      }
      if (Date.now() - i.updatedAt > 20 * 6e4) return this.#fail(i, "deploy", "The upload did not finish. Try again.");
      await this.ctx.storage.setAlarm(Date.now() + 3e4);
      return;
    }
    let token;
    try {
      token = await this.#token();
    } catch (e) {
      return this.#fail(i, next.key, String(e.message), { text: "Sign in with Cloudflare again", href: `/connect/cf/start?next=${encodeURIComponent(`/personal-agents/install/${i.template}`)}` });
    }
    this.#step(i, next.key, "doing");
    await this.#save(i);
    const a = i.accountId;
    try {
      if (next.key === "account") {
        const sub = await cf(token, `/accounts/${a}/workers/subdomain`);
        let subdomain = sub.result?.subdomain;
        if (!subdomain) {
          const base = i.email.split("@")[0].toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20) || "me";
          for (const candidate of [base, `${base}-${crypto.randomUUID().slice(0, 4)}`]) {
            const put = await cf(token, `/accounts/${a}/workers/subdomain`, { method: "PUT", body: JSON.stringify({ subdomain: candidate }) });
            if (put.ok) {
              subdomain = put.result?.subdomain || candidate;
              break;
            }
          }
          if (!subdomain) return this.#fail(i, "account", "Could not give your account a workers.dev address.", { text: "Open Workers in Cloudflare", href: `https://dash.cloudflare.com/${a}/workers-and-pages` });
        }
        i.subdomain = subdomain;
        this.#step(i, "account", "done", `${i.accountName}`);
      } else if (next.key === "storage") {
        if (!TEMPLATES[i.template].bucketBinding) {
          this.#step(i, "storage", "done", "Built in, nothing to set up");
          await this.#save(i);
          await this.ctx.storage.setAlarm(Date.now() + 50);
          return;
        }
        const bucket = `${i.name}-vault`;
        const r = await cf(token, `/accounts/${a}/r2/buckets`, { method: "POST", body: JSON.stringify({ name: bucket }) });
        const exists = r.errors.some((e) => e.code === 10004 || /already exists/i.test(e.message || ""));
        if (!r.ok && !exists) {
          if (r.errors.some((e) => e.code === 10042)) return this.#fail(i, "storage", "Your account needs R2 turned on first. It is free up to 10 GB; Cloudflare asks for a card.", { text: "Turn on R2", href: `https://dash.cloudflare.com/${a}/r2/overview` });
          return this.#fail(i, "storage", `Could not make the storage: ${errText(r.errors)}`);
        }
        this.#step(i, "storage", "done", bucket);
      } else if (next.key === "deploy") {
        var _stack = [];
        try {
          const t = TEMPLATES[i.template];
          const info = await this.env.Project.get(this.env.Project.idFromName(t.repo)).info();
          if (!info) return this.#fail(i, "deploy", "The agent template is missing on forq.");
          const repo = __using(_stack, await this.env.ARTIFACTS.get(info.repo));
          const read = await repo.createToken("read", 1800);
          const job = {
            id: `install-${i.id}`,
            slug: t.repo,
            kind: "install",
            repo: info.repo,
            remote: info.remote,
            token: read.plaintext.split("?")[0],
            worker: i.name,
            queuedAt: Date.now(),
            install: {
              owner: i.email,
              installId: i.id,
              accountId: a,
              cfToken: token,
              dir: t.dir,
              vars: { CF_ACCOUNT_ID: a, ...t.vars || {}, ...t.secretVar ? { [t.secretVar]: await this.#agentSecret(a, i.name) } : {}, ...t.selfhost ? await this.#selfhostVars(i) : {} },
              bucket: t.bucketBinding ? { binding: t.bucketBinding, name: `${i.name}-vault` } : void 0,
              runWorker: !!t.selfhost
            }
          };
          await this.env.BuildBox.get(this.env.BuildBox.idFromName("installs")).enqueue(job);
          await this.#save(i);
          await this.ctx.storage.setAlarm(Date.now() + 3e4);
          return;
        } catch (_) {
          var _error = _, _hasError = true;
        } finally {
          __callDispose(_stack, _error, _hasError);
        }
      } else if (next.key === "lock") {
        const lock = await this.#lock(i, token);
        if (TEMPLATES[i.template]?.selfhost) await this.#setAccessSecrets(i, token, lock);
        this.#step(i, "lock", "done", "Only you");
      } else if (next.key === "ready") {
        i.url = `https://${i.name}.${i.subdomain}.workers.dev`;
        this.#step(i, "ready", "done");
        await this.#save(i);
        await this.#next();
        log("install", "ready", { id: i.id, url: i.url });
        return;
      }
    } catch (e) {
      return this.#fail(i, next.key, `Something broke: ${String(e.message || e).slice(0, 200)}`);
    }
    await this.#save(i);
    await this.ctx.storage.setAlarm(Date.now() + 50);
  }
  /** Access on the Worker itself: account members + the user's email. */
  async #lock(i, token) {
    const a = i.accountId;
    const org = await cf(token, `/accounts/${a}/access/organizations`);
    if (!org.ok || !org.result?.auth_domain) {
      const team = `${(i.subdomain || "forq").slice(0, 20)}-${crypto.randomUUID().slice(0, 6)}`;
      const made = await cf(token, `/accounts/${a}/access/organizations`, { method: "POST", body: JSON.stringify({ name: team, auth_domain: `${team}.cloudflareaccess.com` }) });
      if (!made.ok) throw new Error(`could not set up sign-in (Zero Trust): ${errText(made.errors)}`);
    }
    const idps = await cf(token, `/accounts/${a}/access/identity_providers`);
    const list = idps.result || [];
    let allowed = list.filter((p) => p.type === "cloudflare" || p.type === "onetimepin").map((p) => p.id);
    if (!allowed.length) {
      const otp = await cf(token, `/accounts/${a}/access/identity_providers`, { method: "POST", body: JSON.stringify({ name: "One-time PIN", type: "onetimepin", config: {} }) });
      if (otp.ok) allowed = [otp.result.id];
    }
    const scripts = await cf(token, `/accounts/${a}/workers/scripts`);
    const tag2 = (scripts.result || []).find((s) => s.id === i.name)?.tag;
    if (!tag2) throw new Error("the assistant was not found after upload");
    const teamDomain = String(org.result?.auth_domain || (await cf(token, `/accounts/${a}/access/organizations`)).result?.auth_domain || "");
    const apps = await cf(token, `/accounts/${a}/access/apps?per_page=100`);
    const have = (apps.result || []).find((ap) => (ap.destinations || []).some((d) => d.type === "worker" && d.worker_id === tag2));
    if (have) return { aud: String(have.aud || ""), teamDomain };
    const r = await cf(token, `/accounts/${a}/access/apps`, { method: "POST", body: JSON.stringify({
      type: "self_hosted",
      name: `${i.name} (qodebase)`,
      destinations: [{ type: "worker", worker_id: tag2 }],
      session_duration: "720h",
      ...allowed.length ? { allowed_idps: allowed, auto_redirect_to_identity: allowed.length === 1 } : {},
      policies: [{ name: "Only you", decision: "allow", include: [{ cloudflare_account_member: { account_id: a } }, { email: { email: i.email } }] }]
    }) });
    if (!r.ok) throw new Error(`could not lock it: ${errText(r.errors)}`);
    return { aud: String(r.result?.aud || ""), teamDomain };
  }
  /** qodebase's per-install vars: its hosts on the person's workers.dev, its owner, its secrets. */
  async #selfhostVars(i) {
    const sub = i.subdomain || "";
    const ui = `${i.name}.${sub}.workers.dev`, run = `${i.name}-run.${sub}.workers.dev`;
    const handle = (i.email.split("@")[0].toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").replace(/^([^a-z])/, "u$1") || "me").slice(0, 24);
    return {
      UI_HOST: ui,
      RUN_HOST: run,
      API_BASE: `https://${run}`,
      OWNER_HANDLE: handle,
      HANDLES: JSON.stringify({ [i.email.toLowerCase()]: handle }),
      ADMIN_SECRET: await this.#agentSecret(i.accountId, `${i.name}#admin`),
      KEY_ENC_SECRET: await this.#agentSecret(i.accountId, `${i.name}#keys`),
      CF_OAUTH_CLIENT_ID: "",
      MAX_AGENTS_PER_PROJECT: "6",
      MAX_AWAKE_BOXES: "3",
      MAX_TOTAL_AWAKE: "6",
      OTHERS_MAX_AWAKE: "2"
    };
  }
  /** The Access team and audience go to the copy as secrets (a new version of its Worker). */
  async #setAccessSecrets(i, token, lock) {
    for (const [name, text] of [["ACCESS_TEAM_DOMAIN", lock.teamDomain], ["ACCESS_AUD", lock.aud]]) {
      const r = await cf(token, `/accounts/${i.accountId}/workers/scripts/${i.name}/secrets`, { method: "PUT", body: JSON.stringify({ name, text, type: "secret_text" }) });
      if (!r.ok) throw new Error(`could not finish its sign-in setup: ${errText(r.errors)}`);
    }
    log("install", "access_secrets", { name: i.name, team: lock.teamDomain, aud: !!lock.aud });
  }
  /** The agent's own login secret, the same on every reinstall of one Worker
   *  (a new one would lock the running container out until it restarts). */
  async #agentSecret(accountId, name) {
    const key = `secret:${accountId}/${name}`;
    const have = await this.ctx.storage.get(key);
    if (have) return decryptKey(this.env, have);
    const fresh = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
    await this.ctx.storage.put(key, await encryptKey(this.env, fresh));
    return fresh;
  }
  /** BuildBox reports the deploy. */
  async buildDone(result) {
    const id = result.id.replace(/^install-/, "");
    const i = await this.get(id);
    log("install", "build_report", { id, ok: result.ok, found: !!i, step: i?.steps.find((st) => st.key === "deploy")?.state, url: result.url });
    if (!i) return;
    if (!result.ok) {
      log("install", "deploy_failed", { id, error: result.error, tail: result.log.slice(-800) });
      i.log = result.log.slice(-4e3);
      const t = TEMPLATES[i.template];
      if ((t?.container || t?.paid) && /paid|subscription|containers? (are|is) not (enabled|available)|not entitled|plan/i.test(`${result.error} ${result.log.slice(-1500)}`)) {
        return this.#fail(i, "deploy", `${t.title} needs the Workers Paid plan ($5/month).`, { text: "Turn on Workers Paid", href: `https://dash.cloudflare.com/${i.accountId}/workers/plans` });
      }
      return this.#fail(i, "deploy", `The upload failed: ${result.error || "no reason given"}`);
    }
    this.#step(i, "deploy", "done");
    await this.#save(i);
    await this.ctx.storage.setAlarm(Date.now() + 50);
  }
};

// ../src/talk.ts
import { DurableObject as DurableObject6 } from "cloudflare:workers";

// ../src/talkdecide.ts
var currentSlug = /* @__PURE__ */ __name((path2) => {
  const m = /^\/p\/([^/]+)\/([^/]+)/.exec(path2 || "");
  return m ? `${m[1]}.${m[2]}` : null;
}, "currentSlug");
var MODES = {
  act: "A request to do something in the app: go to a page, open a project or one of its parts, search, type, press something, go back, scroll. No answer needed beyond doing it.",
  ask: "A question or conversation for the assistant to answer in words: what is this, how does it work, why, should I, explain, tell me about, chit-chat.",
  both: 'Both: do something in the app AND answer or explain something ("open the calculator and tell me what it does", "show me the agents, which one is stuck?").',
  none: "Not a request at all: a fragment cut off mid-sentence, noise, or filler words."
};
var ACTIONS = {
  link: "Go to a page or open something listed on the screen or in the menu: the home page, Explore, Yours, Inbox, Build, Account, Import, Command line, About, Feedback, Get your own qodebase, Your own AI assistant, a document or file shown on the page (README, LICENSE), or any other link shown",
  project: "Open a project by its name, or one part of it (its app, code, readme, history, agents)",
  search: "Search or look for something by words: find a project, find text in the code",
  type: "Type words into a field on the page (an idea to build, a search box, a message to an agent)",
  press: "Press a button that is on the screen",
  back: 'Go back to the previous page (only when they say back or previous; "go home" is the home page link)',
  scroll: "Scroll to or show a section of this page (by its heading), or scroll to the top or bottom",
  explain: "Explain, describe or show around the page the person is looking at",
  none: "No action in the app"
};
var PARTS = {
  page: "The project page itself (its main page)",
  app: "Its live app, running (try it, use it, play it, run it)",
  code: "Its code, files, source",
  readme: "Its readme, its description document",
  history: "Its history, commits, changes",
  agents: "Its agents, the AI agents working on it"
};
var MARKERS = /* @__PURE__ */ new Set([
  "for",
  "find",
  "search",
  "called",
  "named",
  "type",
  "write",
  "saying",
  "say",
  "build",
  "make",
  "create",
  "about",
  "with",
  "containing",
  "contains",
  "that",
  "idea",
  "is",
  "to",
  "mentions"
]);
function spans(utterance) {
  const quoted = [...utterance.matchAll(/["“]([^"”]{1,120})["”]/g)].map((m) => m[1].trim());
  const words2 = utterance.trim().replace(/[.?!]+$/, "").split(/\s+/).filter(Boolean);
  const lw = words2.map((w) => w.toLowerCase().replace(/[^a-z0-9']/g, ""));
  const starts = /* @__PURE__ */ new Set(), ends = /* @__PURE__ */ new Set([words2.length]);
  lw.forEach((w, i) => {
    if (MARKERS.has(w) && i + 1 < words2.length) starts.add(i + 1);
    if (w === "and" || w === "please" || w === "then") ends.add(i);
    if (/[,;]$/.test(words2[i])) ends.add(i + 1);
  });
  const out = [...quoted];
  for (const s of [...starts].sort((a, b) => a - b)) {
    for (const e of [...ends].sort((a, b) => a - b)) {
      if (e <= s || e - s > 16) continue;
      const phrase = words2.slice(s, e).join(" ").replace(/[,;"“”]+$/g, "").replace(/^["“]/, "").trim();
      if (phrase && !/^(the|a|an|to|it|this|that|and|me|my)$/i.test(phrase)) out.push(phrase);
    }
  }
  return [...new Set(out)].slice(0, 24);
}
__name(spans, "spans");
var STOP = /* @__PURE__ */ new Set(["the", "a", "an", "my", "me", "open", "show", "go", "to", "app", "project", "please", "and", "of", "in", "on", "for", "it", "one", "that", "this", "i", "can", "you", "what", "is"]);
var words = /* @__PURE__ */ __name((s) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w)), "words");
function candidateProjects(utterance, projects, max = 24, current = null) {
  const u = new Set(words(utterance));
  const score = /* @__PURE__ */ __name((p) => {
    const n = words(p.name.replace(/[-_.]/g, " ")), d = words(p.description || "");
    let s = 0;
    for (const w of n) if (u.has(w) || [...u].some((x) => x.length > 3 && (w.startsWith(x) || x.startsWith(w)))) s += 3;
    for (const w of d) if (u.has(w)) s += 1;
    return s + (p.mine ? 0.5 : 0);
  }, "score");
  const ranked = projects.map((p) => ({ p, s: score(p) })).sort((a, b) => b.s - a.s);
  const hits = ranked.filter((x) => x.s >= 1).map((x) => x.p);
  const mine = projects.filter((p) => p.mine);
  const here = projects.filter((p) => p.slug === current);
  return [.../* @__PURE__ */ new Set([...here, ...hits, ...mine])].slice(0, max);
}
__name(candidateProjects, "candidateProjects");
var choice = /* @__PURE__ */ __name((instructions, criteria) => ({ type: "choice", instructions, criteria }), "choice");
var noul = /* @__PURE__ */ __name((instructions) => ({ type: "noul", instructions }), "noul");
function stateText(utterance, s, projects) {
  const lines = [`Sentence: "${utterance}"`, "", `The person is on qodebase (a git platform where every project runs as an app and has AI agents), page ${s.path} titled "${s.title}".`];
  if (s.me) lines.push(`They are signed in as ${s.me}.`);
  const by = /* @__PURE__ */ __name((k2) => s.items.filter((i) => i.kind === k2), "by");
  if (by("heading").length) lines.push("", "Headings on the page: " + by("heading").map((h) => `"${h.text}"`).join(", "));
  if (by("link").length) lines.push("", "Links (page and menu):", ...by("link").map((l) => `- ${l.id}: ${l.text}`));
  if (by("button").length) lines.push("", "Buttons: " + by("button").map((b) => `${b.id} "${b.text}"`).join(", "));
  if (by("field").length) lines.push("", "Fields: " + by("field").map((f) => `${f.id} "${f.text}"`).join(", "));
  const cur = currentSlug(s.path);
  if (projects.length) lines.push("", "Projects:", ...projects.map((p) => `- ${p.id}: ${p.owner}/${p.name}${p.slug === cur ? " (the project this page shows)" : ""}${p.mine ? " (theirs)" : ""}${p.description ? " \u2014 " + p.description.slice(0, 90) : ""}`));
  if (cur) lines.push("", `This page shows the project ${cur.replace(".", "/")}: "this", "it", "its", "the app" or "the code" without a project name mean that project.`);
  if (s.last) lines.push("", `The last thing opened was ${s.last}; "it", "that" or "this one" means it.`);
  return lines.join("\n");
}
__name(stateText, "stateText");
function buildQuestions(utterance, s, projects) {
  const cands = spans(utterance);
  const by = /* @__PURE__ */ __name((k2) => s.items.filter((i) => i.kind === k2), "by");
  const none = { none: "None of these" };
  const q = {
    mode: choice("Is the sentence a request to do something in the app, a question or conversation to answer, both, or not a request?", MODES),
    action: choice("If it asks to do something in the app, what kind of thing?", ACTIONS),
    complete: noul("The sentence is a finished request or question, not cut off in the middle."),
    risky: noul("Doing what the sentence asks would delete, merge, publish, make something public or private, sign out, revoke, uninstall, disconnect, or spend money.")
  };
  if (by("link").length) q.link = choice("Which link does it want to open? Pick the link whose words match what the sentence asks for.", { ...Object.fromEntries(by("link").map((l) => [l.id, l.text])), ...none });
  if (projects.length) {
    q.project = choice(
      'Which project does the sentence name or mean? Match by name or what it is (a "timer" is the Focus timer project). With no project name ("the app", "its history", "this"), it is the project the page shows. "My copy", "my version" or "mine" means their own project of the same name. Prefer their own project when they say "my" or names tie.',
      { ...Object.fromEntries(projects.map((p) => [p.id, `${p.owner}/${p.name}${p.mine ? " (theirs)" : ""}${p.description ? ": " + p.description.slice(0, 80) : ""}`])), ...none }
    );
    q.part = choice("Which part of the project does it want?", PARTS);
    q.names_part = noul("The sentence names or implies one part of a project: its app (try, play, use, run it), code, files, readme, license, history or agents.");
  }
  if (by("button").length) q.button = choice("Which button does it want to press?", { ...Object.fromEntries(by("button").map((b) => [b.id, b.text])), ...none });
  if (by("field").length) q.field = choice("Which field does it want to type into?", { ...Object.fromEntries(by("field").map((f) => [f.id, f.text])), ...none });
  if (by("heading").length) q.section = choice("Which section of the page does it want to see?", { ...Object.fromEntries(by("heading").map((h) => [h.id, h.text])), top: "The top of the page", bottom: "The bottom of the page", ...none });
  if (cands.length) q.text = choice("What exact words should be searched for or typed?", { ...Object.fromEntries(cands.map((c, i) => [`s${i}`, `"${c}"`])), ...none });
  return { questions: q, cands };
}
__name(buildQuestions, "buildQuestions");
var partOf = /* @__PURE__ */ __name((answers) => (answers.names_part?.noul ?? 1) >= 0.5 ? top(answers.part).choice : "page", "partOf");
var top = /* @__PURE__ */ __name((a) => a?.choice ? { choice: a.choice, p: a.probabilities?.[a.choice] ?? a.confidence ?? null } : { choice: "none", p: null }, "top");
var pick = /* @__PURE__ */ __name((a, min = 0) => {
  const t = top(a);
  return t.choice !== "none" && (t.p ?? 1) >= min ? t.choice : null;
}, "pick");
function resolve(answers, cands, s, projects, utterance) {
  const cmd = resolveAction(answers, cands, s, projects, utterance);
  const home = s.items.find((i) => i.kind === "link" && i.href === "/");
  if (home && cmd.mode !== "ask" && /\b(go|take me|back to the|bring me) home\b|\bhome ?page\b|^home$/i.test(utterance.trim())) return { ...cmd, mode: cmd.mode === "none" ? "act" : cmd.mode, op: "go", href: "/", label: home.text, target: home.id };
  if (cmd.op !== "none" || cmd.mode === "ask" || cmd.mode === "none") return cmd;
  const l = s.items.find((i) => i.id === pick(answers.link, 0.5));
  return l?.href ? { ...cmd, op: "go", href: l.href, label: l.text, target: l.id, why: `${cmd.why}; used the link` } : cmd;
}
__name(resolve, "resolve");
function resolveAction(answers, cands, s, projects, utterance) {
  const mode = top(answers.mode);
  const action = top(answers.action);
  const base = { mode: mode.choice, modeP: mode.p, op: "none", p: action.p, risky: answers.risky?.noul ?? null, complete: answers.complete?.noul ?? null };
  const item = /* @__PURE__ */ __name((id) => s.items.find((i) => i.id === id) || null, "item");
  const text = (() => {
    const c = pick(answers.text);
    return c && /^s\d+$/.test(c) ? cands[Number(c.slice(1))] : null;
  })();
  switch (action.choice) {
    case "link": {
      const l = item(pick(answers.link));
      if (l?.href) return { ...base, op: "go", href: l.href, label: l.text, target: l.id };
      const p = projects.find((x) => x.id === pick(answers.project, 0.3));
      if (p) return { ...base, op: "go", href: projectHref(p, partOf(answers)), label: `${p.owner}/${p.name}`, target: p.slug };
      return { ...base, why: "no link matched" };
    }
    case "project": {
      const p = projects.find((x) => x.id === pick(answers.project));
      if (!p) return { ...base, why: "no project matched" };
      return { ...base, op: "go", href: projectHref(p, partOf(answers)), label: `${p.owner}/${p.name}`, target: p.slug };
    }
    case "search": {
      const f = s.items.find((i) => i.kind === "field" && /search|go to file/i.test(i.text));
      if (f && text) return { ...base, op: "type", target: f.id, text, label: f.text };
      const p = projects.find((x) => x.id === pick(answers.project, 0.3));
      if (p) return { ...base, op: "go", href: projectHref(p, partOf(answers)), label: `${p.owner}/${p.name}`, target: p.slug };
      return { ...base, op: "search", text: text || utterance };
    }
    case "type": {
      const f = item(pick(answers.field)) || s.items.find((i) => i.kind === "field") || null;
      if (!f || !text) return { ...base, why: f ? "no words to type" : "no field on this page" };
      return { ...base, op: "type", target: f.id, text, label: f.text };
    }
    case "press": {
      const b = item(pick(answers.button));
      if (!b) return { ...base, why: "no button matched" };
      return { ...base, op: "press", target: b.id, label: b.text };
    }
    case "back":
      return { ...base, op: "back" };
    case "scroll": {
      const c = pick(answers.section);
      if (c === "top" || c === "bottom") return { ...base, op: "scroll", section: c };
      const h = item(c);
      return h ? { ...base, op: "scroll", target: h.id, label: h.text } : { ...base, why: "no section matched" };
    }
    case "explain":
      return { ...base, op: "explain" };
  }
  return base;
}
__name(resolveAction, "resolveAction");
function projectHref(p, part) {
  const root = `/p/${p.owner}/${p.name}`;
  return part === "app" ? `${root}/app` : part === "code" ? `${root}/code/` : part === "readme" ? `${root}/readme` : part === "history" ? `${root}/history` : part === "agents" ? `${root}/agents` : root;
}
__name(projectHref, "projectHref");

// ../src/talkscan.ts
var SCAN_JS = String.raw`function talkScan(root) {
  root = root || document;
  var out = [], seen = {}, n = { l: 0, b: 0, f: 0, h: 0 };
  var clean = function (s) { return String(s || '').replace(/\s+/g, ' ').trim(); };
  var lines = function (el) { var t = String(el.innerText || el.textContent || '').split('\n').map(clean).filter(Boolean); return t.length > 1 ? t[0] + ' (' + t.slice(1).join(', ') + ')' : (t[0] || ''); };
  var skip = function (el) { return el.closest('#talk-root') || el.closest('[aria-hidden="true"]'); };
  var add = function (el, kind, text, extra) {
    text = clean(text).slice(0, kind === 'link' ? 120 : 70);
    if (!text) return;
    var p = kind === 'link' ? 'l' : kind === 'button' ? 'b' : kind === 'field' ? 'f' : 'h';
    var id = el.getAttribute('data-talk') || (p + (++n[p]));
    if (!el.getAttribute('data-talk')) el.setAttribute('data-talk', id); else n[p] = Math.max(n[p], Number(id.slice(1)) || 0);
    var item = { id: id, kind: kind, text: text };
    for (var k in extra || {}) item[k] = extra[k];
    out.push(item);
  };
  root.querySelectorAll('h1, h2, h3').forEach(function (h) { if (!skip(h) && out.filter(function (i) { return i.kind === 'heading'; }).length < 20) add(h, 'heading', h.textContent); });
  var links = 0;
  root.querySelectorAll('a[href]').forEach(function (a) {
    if (skip(a) || links >= 60) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#' || /^(javascript|mailto):/.test(href)) return;
    // Menu links carry a second line ("Account" / "eyal: your name…"): first line names it.
    var text = a.getAttribute('aria-label') || lines(a);
    var key = href + '|' + clean(text).toLowerCase();
    if (seen[href] || seen[key]) return;
    seen[href] = seen[key] = 1; links++;
    if (href === '/' && !/home/i.test(text)) text = clean(text) + ' (home page)';
    add(a, 'link', text, { href: href });
  });
  var buttons = 0;
  root.querySelectorAll('button').forEach(function (b) {
    if (skip(b) || b.disabled || b.type === 'hidden' || buttons >= 40) return;
    var t = b.getAttribute('aria-label') || b.title || lines(b);
    if (/^(close|×|✕)$/i.test(clean(t))) return;
    buttons++;
    add(b, 'button', t);
  });
  root.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]), textarea, [contenteditable=true]').forEach(function (f) {
    if (skip(f)) return;
    var lab = f.id && root.querySelector('label[for="' + f.id + '"]');
    add(f, 'field', f.getAttribute('placeholder') || f.getAttribute('aria-label') || (lab && lab.textContent) || f.name || 'text field');
  });
  return out;
}`;

// ../src/talkclient.ts
var TALK_JS = String.raw`(function () {
'use strict';
if (window.top !== window || window.__talk) return;
window.__talk = 1;
if (/^\/(login|a\/|session)/.test(location.pathname)) return;
` + SCAN_JS + String.raw`
var KEY = 'qb-talk-', ss = window.sessionStorage, ls = window.localStorage;
function get(k, d) { try { var v = ls.getItem(KEY + k); return v == null ? d : v; } catch (e) { return d; } }
function set(k, v) { try { ls.setItem(KEY + k, v); } catch (e) {} }
function sget(k, d) { try { var v = ss.getItem(KEY + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function sset(k, v) { try { ss.setItem(KEY + k, JSON.stringify(v)); } catch (e) {} }
function logEv(event, data) { try { console.log(JSON.stringify(Object.assign({ ts: new Date().toISOString(), module: 'talk', event: event }, data || {}))); } catch (e) {} }

var S = {
  engine: get('engine', ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) ? 'native' : 'whisper'),
  lang: get('lang', 'en'),
  speak: get('speak', 'voice'),        // off | voice (only when I spoke) | always
};
var LANGS = { en: 'en-US', he: 'he-IL', auto: 'en-US' };
var me = null, busy = false, listening = false, lastSpoken = false;
var hist = sget('log', []);             // [{who:'you'|'app'|'ai'|'note', text}]
var chatHist = sget('chat', []);       // [{role, content}] for the chat lane

// ---- DOM -------------------------------------------------------------------
var css = [
  '#talk-root{--t-acc:var(--acc,#17695a);--t-accfg:var(--acc-fg,#fff);--t-bg:var(--bg,#fff);--t-card:var(--card,#f6f7f8);--t-chip:var(--chip,#eceef1);--t-line:var(--line,#e2e5e9);--t-fg:var(--fg,#15171a);--t-dim:var(--dim,#5f6670);font:16px/1.45 "Instrument Sans",system-ui,sans-serif;color:var(--t-fg);-webkit-tap-highlight-color:transparent}',
  '#talk-fab{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:2147483000;width:52px;height:52px;border-radius:12px;border:0;background:var(--t-acc);color:var(--t-accfg);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(0,0,0,.18);cursor:pointer;transition:background-color .12s}',
  '#talk-fab svg{width:24px;height:24px}',
  '#talk-fab.on{background:#b42d1f}',
  '#talk-root.open #talk-fab{display:none}',
  '#talk-sheet{position:fixed;left:0;right:0;bottom:0;z-index:2147483001;background:var(--t-bg);border-top:1px solid var(--t-line);border-radius:12px 12px 0 0;box-shadow:0 -4px 24px rgba(0,0,0,.14);transform:translateY(105%);transition:transform .22s ease;max-height:62dvh;display:flex;flex-direction:column;padding-bottom:env(safe-area-inset-bottom)}',
  '#talk-root.open #talk-sheet{transform:none}',
  '@media (min-width:720px){#talk-sheet{left:auto;right:16px;bottom:16px;width:420px;border:1px solid var(--t-line);border-radius:12px}}',
  '#talk-head{display:flex;align-items:center;gap:8px;padding:8px 8px 8px 16px;border-bottom:1px solid var(--t-line)}',
  '#talk-head b{font-weight:600;font-size:15px;flex:1}',
  '#talk-head .st{font-size:13px;color:var(--t-dim);font-variant-numeric:tabular-nums}',
  '.talk-ib{width:44px;height:44px;border:0;border-radius:8px;background:transparent;color:var(--t-fg);display:inline-flex;align-items:center;justify-content:center;cursor:pointer}',
  '.talk-ib svg{width:20px;height:20px}',
  '@media (hover:hover){.talk-ib:hover{background:var(--t-chip)}}',
  '#talk-log{overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:8px;min-height:64px;overscroll-behavior:contain}',
  '#talk-log .you{align-self:flex-end;background:var(--t-acc);color:var(--t-accfg);padding:8px 12px;border-radius:12px;max-width:85%;font-size:15px}',
  '#talk-log .ai{align-self:flex-start;font-size:15px;max-width:92%}',
  '#talk-log .app,#talk-log .note{align-self:flex-start;font-size:13px;color:var(--t-dim)}',
  '#talk-log .hint{font-size:13px;color:var(--t-dim)}',
  '#talk-live{padding:0 16px;min-height:0;font-size:15px;color:var(--t-dim)}',
  '#talk-live:not(:empty){padding:4px 16px 8px}',
  '#talk-offer{display:none;gap:8px;align-items:center;padding:0 16px 8px;font-size:15px;flex-wrap:wrap}',
  '#talk-offer.on{display:flex}',
  '.talk-chip{min-height:44px;padding:0 14px;border-radius:8px;border:0;background:var(--t-chip);color:var(--t-fg);font:500 15px "Instrument Sans",system-ui,sans-serif;cursor:pointer}',
  '.talk-chip.pri{background:var(--t-acc);color:var(--t-accfg)}',
  '#talk-form{display:flex;gap:8px;padding:8px 8px 8px 16px;border-top:1px solid var(--t-line);align-items:center}',
  '#talk-in{flex:1;min-width:0;height:44px;border-radius:8px;border:1px solid var(--t-line);background:var(--t-card);color:var(--t-fg);padding:0 12px;font:16px "Instrument Sans",system-ui,sans-serif;outline:none}',
  '#talk-in:focus{border-color:var(--t-acc)}',
  '#talk-mic{width:44px;height:44px;border-radius:8px;border:0;background:var(--t-acc);color:var(--t-accfg);display:flex;align-items:center;justify-content:center;cursor:pointer;flex:none}',
  '#talk-mic svg{width:22px;height:22px}',
  '#talk-mic.on{background:#b42d1f}',
  '#talk-set{display:none;padding:12px 16px;border-bottom:1px solid var(--t-line);gap:12px;flex-direction:column;font-size:15px}',
  '#talk-root.settings #talk-set{display:flex}',
  '#talk-set label{display:flex;flex-direction:column;gap:4px;color:var(--t-dim);font-size:13px}',
  '#talk-set select{height:44px;border-radius:8px;border:1px solid var(--t-line);background:var(--t-card);color:var(--t-fg);font:16px "Instrument Sans",system-ui,sans-serif;padding:0 8px}',
  '.talk-mark{outline:3px solid var(--acc,#17695a)!important;outline-offset:3px!important;border-radius:8px;transition:outline-color .12s}',
  '.talk-mark.dash{outline-style:dashed!important}',
].join('\n');

var ICON = {
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

var root, sheet, logEl, live, offer, inp, micBtn, fab, stEl;
function el(tag, attrs, html) { var e = document.createElement(tag); for (var k in attrs || {}) e.setAttribute(k, attrs[k]); if (html != null) e.innerHTML = html; return e; }

function build() {
  var st = el('style'); st.textContent = css; document.head.appendChild(st);
  root = el('div', { id: 'talk-root' });
  fab = el('button', { id: 'talk-fab', type: 'button', 'aria-label': 'Talk to qodebase' }, ICON.mic);
  sheet = el('section', { id: 'talk-sheet', 'aria-label': 'Talk' });
  var head = el('div', { id: 'talk-head' });
  head.innerHTML = '<b>Talk</b><span class="st" id="talk-st"></span>';
  var gear = el('button', { class: 'talk-ib', type: 'button', 'aria-label': 'Talk settings' }, ICON.gear);
  var close = el('button', { class: 'talk-ib', type: 'button', 'aria-label': 'Close' }, ICON.x);
  head.appendChild(gear); head.appendChild(close);
  var setp = el('div', { id: 'talk-set' });
  setp.innerHTML =
    '<label>Dictation<select id="talk-s-engine"><option value="native">Phone’s own (Chrome), free, live words</option><option value="whisper">Whisper on Cloudflare, steadier with names</option></select></label>' +
    '<label>Language<select id="talk-s-lang"><option value="en">English</option><option value="he">עברית (Hebrew)</option><option value="auto">Auto (Whisper detects)</option></select></label>' +
    '<label>Speak replies<select id="talk-s-speak"><option value="voice">When I talked</option><option value="always">Always</option><option value="off">Never</option></select></label>' +
    '<button type="button" class="talk-chip" id="talk-s-clear">Clear the conversation</button>';
  logEl = el('div', { id: 'talk-log', 'aria-live': 'polite' });
  live = el('div', { id: 'talk-live' });
  offer = el('div', { id: 'talk-offer' });
  var form = el('form', { id: 'talk-form' });
  inp = el('input', { id: 'talk-in', type: 'text', enterkeyhint: 'send', autocomplete: 'off', placeholder: 'Say or type: open my calculator', 'aria-label': 'Talk to qodebase' });
  micBtn = el('button', { id: 'talk-mic', type: 'button', 'aria-label': 'Speak' }, ICON.mic);
  form.appendChild(inp); form.appendChild(micBtn);
  sheet.appendChild(head); sheet.appendChild(setp); sheet.appendChild(logEl); sheet.appendChild(live); sheet.appendChild(offer); sheet.appendChild(form);
  root.appendChild(fab); root.appendChild(sheet);
  document.body.appendChild(root);
  stEl = document.getElementById('talk-st');

  fab.addEventListener('click', function () { open(true); if (S.engine === 'native' || S.engine === 'whisper') startListen(); });
  close.addEventListener('click', function () { stopListen(true); open(false); });
  gear.addEventListener('click', function () { root.classList.toggle('settings'); });
  micBtn.addEventListener('click', function () { if (listening) stopListen(false); else startListen(); });
  form.addEventListener('submit', function (e) { e.preventDefault(); var v = inp.value.trim(); if (!v) return; inp.value = ''; lastSpoken = false; submit(v); });
  var se = document.getElementById('talk-s-engine'), sl = document.getElementById('talk-s-lang'), sp = document.getElementById('talk-s-speak');
  se.value = S.engine; sl.value = S.lang; sp.value = S.speak;
  se.onchange = function () { S.engine = se.value; set('engine', S.engine); };
  sl.onchange = function () { S.lang = sl.value; set('lang', S.lang); };
  sp.onchange = function () { S.speak = sp.value; set('speak', S.speak); };
  document.getElementById('talk-s-clear').onclick = function () { hist = []; chatHist = []; sset('log', hist); sset('chat', chatHist); render(); root.classList.remove('settings'); };
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && root.classList.contains('open')) { stopListen(true); open(false); }
  });
  render();
}

function open(on) { root.classList.toggle('open', !!on); sset('open', !!on); if (on) setTimeout(function () { logEl.scrollTop = logEl.scrollHeight; }, 50); }
function status(t) { stEl.textContent = t || ''; }
function add(who, text) { hist.push({ who: who, text: String(text) }); if (hist.length > 40) hist = hist.slice(-40); sset('log', hist); render(); }
function render() {
  logEl.innerHTML = '';
  if (!hist.length) {
    var h = el('div', { class: 'hint' });
    h.textContent = 'Try: “open my calculator”, “show me the code of the timer”, “what is this page?”, “build a habit tracker”.';
    logEl.appendChild(h);
  }
  hist.forEach(function (m) { var d = el('div', { class: m.who }); d.textContent = m.text; logEl.appendChild(d); });
  logEl.scrollTop = logEl.scrollHeight;
}

// ---- Pointing ----------------------------------------------------------------
var marked = [];
function unmark() { marked.forEach(function (e) { e.classList.remove('talk-mark', 'dash'); }); marked = []; }
function mark(e, dashed) {
  if (!e) return;
  e.classList.add('talk-mark'); if (dashed) e.classList.add('dash'); marked.push(e);
  try { e.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (x) {}
}
function byId(id) { return id ? document.querySelector('[data-talk="' + id + '"]') : null; }
function showSeq(ids) {
  unmark();
  var i = 0;
  (function step() { unmark(); if (i >= ids.length) return; mark(byId(ids[i++])); setTimeout(step, 1700); })();
}

// ---- Screen ----------------------------------------------------------------
function screen() {
  var items = talkScan(document);
  return { path: location.pathname + location.search, title: document.title, items: items, last: sget('last', null) };
}
function pageText() {
  var main = document.querySelector('main') || document.body;
  var t = String(main.innerText || '').replace(/\n{3,}/g, '\n\n');
  var mine = root ? String(root.innerText || '') : '';
  if (mine) t = t.replace(mine, '');
  return t.slice(0, 5000);
}

// ---- Server ----------------------------------------------------------------
function api(path, body) {
  return fetch('/api/talk/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) })
    .then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); });
}

// ---- The one entry point: a sentence --------------------------------------
var preview = null;   // { text, cmd } from interim speech
function submit(text) {
  if (busy) return;
  busy = true; unmark(); offerOff();
  add('you', text);
  status('Thinking…');
  var t0 = Date.now();
  var reuse = preview && preview.text === text ? Promise.resolve({ cmd: preview.cmd, ms: { total: 0 } }) : api('decide', { utterance: text, screen: screen() });
  preview = null;
  reuse.then(function (r) {
    if (r.error) { add('note', r.why || 'Something went wrong.'); return done(); }
    var c = r.cmd;
    logEv('decide', { text: text, mode: c.mode, mode_p: c.modeP, op: c.op, p: c.p, risky: c.risky, ms: Date.now() - t0 });
    if ((c.risky || 0) >= 0.5) {
      add('ai', 'That would change or remove something, so I will leave the doing to you.');
      if (c.op === 'go' && c.href) offerOn('Take me to ' + (c.label || 'that page') + '?', function () { act(c); });
      return done();
    }
    if (c.mode === 'none') { add('note', (c.complete || 0) < 0.5 ? 'Sounds cut off. Say it again?' : 'I did not catch a request there.'); return done(); }
    var acts = (c.mode === 'act' || c.mode === 'both') && c.op !== 'none' && c.op !== 'explain';
    if (acts && (c.p == null || c.p >= 0.45)) {
      if (c.mode === 'both') sset('pending', { text: text, did: describe(c) });
      return act(c, true);
    }
    if (acts && c.p >= 0.2) {
      offerOn('Maybe: ' + describe(c) + '?', function () { if (c.mode === 'both') sset('pending', { text: text, did: describe(c) }); act(c); });
      if (c.mode === 'act') return done();
    }
    ask(text, '');
  }).catch(function (e) { add('note', 'Could not reach qodebase.'); logEv('error', { where: 'decide', err: String(e) }); done(); });
}
function done() { busy = false; status(''); }

function describe(c) {
  if (c.op === 'go') return 'open ' + (c.label || c.href);
  if (c.op === 'back') return 'go back';
  if (c.op === 'press') return 'press “' + c.label + '”';
  if (c.op === 'type') return 'type “' + c.text + '” into “' + c.label + '”';
  if (c.op === 'scroll') return 'scroll to ' + (c.label || c.section);
  if (c.op === 'search') return 'search for “' + c.text + '”';
  return c.op;
}

function act(c, withPreview) {
  var target = c.target && byId(c.target);
  var go = function () {
    unmark();
    if (c.op === 'go') {
      add('app', 'Opening ' + (c.label || c.href) + '…');
      sset('last', c.label || c.href);
      sset('open', true);
      busy = false;
      location.assign(c.href);
      return;
    }
    if (c.op === 'back') { add('app', 'Going back…'); busy = false; history.back(); return; }
    if (c.op === 'press' && target) { add('app', 'Pressed “' + c.label + '”.'); target.click(); }
    else if (c.op === 'type' && target) { typeInto(target, c.text); add('app', 'Typed “' + c.text + '”.'); offerSubmit(target); }
    else if (c.op === 'scroll') {
      if (c.section === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
      else if (c.section === 'bottom') window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      else if (target) { mark(target); setTimeout(unmark, 1800); }
      add('app', 'Scrolled to ' + (c.label || c.section) + '.');
    }
    else if (c.op === 'search') { add('note', 'There is no search box on this page.'); return ask('Find ' + c.text, ''); }
    else { add('note', 'Could not find that on the page any more.'); }
    var p = sget('pending', null);
    if (p) { sset('pending', null); return ask(p.text, p.did); }
    done();
  };
  if (withPreview && target) { mark(target, true); status(describe(c)); setTimeout(go, 450); }
  else go();
}

function typeInto(t, text) {
  t.focus();
  if (t.isContentEditable) { t.textContent = text; t.dispatchEvent(new InputEvent('input', { bubbles: true })); return; }
  var proto = t.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(t, text);
  t.dispatchEvent(new Event('input', { bubbles: true }));
  t.dispatchEvent(new Event('change', { bubbles: true }));
}
function offerSubmit(t) {
  var f = t.form; if (!f) return;
  var b = f.querySelector('button[type=submit], button:not([type])');
  if (!b) return;
  offerOn('Send it?', function () { if (f.requestSubmit) f.requestSubmit(b); else b.click(); }, (b.innerText || 'Send').trim());
}

function offerOn(text, yes, yesLabel) {
  offer.innerHTML = '';
  var s = el('span'); s.textContent = text;
  var y = el('button', { type: 'button', class: 'talk-chip pri' }); y.textContent = yesLabel || 'Go';
  var n = el('button', { type: 'button', class: 'talk-chip' }); n.textContent = 'No';
  y.onclick = function () { offerOff(); yes(); };
  n.onclick = function () { offerOff(); };
  offer.appendChild(s); offer.appendChild(y); offer.appendChild(n);
  offer.classList.add('on');
}
function offerOff() { offer.classList.remove('on'); offer.innerHTML = ''; }

function ask(text, did) {
  busy = true;
  status('Answering…');
  api('chat', { utterance: text, did: did, screen: screen(), pageText: pageText(), history: chatHist }).then(function (r) {
    if (r.error) { add('note', r.why || 'No answer.'); return done(); }
    var reply = r.reply || '';
    chatHist.push({ role: 'user', content: text });
    if (reply) chatHist.push({ role: 'assistant', content: reply });
    chatHist = chatHist.slice(-12); sset('chat', chatHist);
    if (reply) { add('ai', reply); say(reply); }
    var acts = r.actions || [];
    logEv('chat', { text: text, reply_len: reply.length, actions: acts.map(function (a) { return a.name; }), ms: r.ms && r.ms.model });
    var nav = null;
    acts.forEach(function (a) {
      if (a.name === 'show') showSeq((a.args && a.args.ids) || []);
      else if (a.name === 'press') { var b = byId(a.args.id); if (b) { add('app', 'Pressed “' + (b.innerText || b.getAttribute('aria-label') || '').trim() + '”.'); b.click(); } }
      else if (a.name === 'type_into') { var f = byId(a.args.id); if (f) { typeInto(f, String(a.args.text || '')); offerSubmit(f); } }
      else if (a.name === 'go') {
        var to = String(a.args.to || ''); var l = byId(to);
        var href = l ? l.getAttribute('href') : (to.charAt(0) === '/' ? to : null);
        if (href) nav = { href: href, label: l ? (l.innerText || href).split('\n')[0] : href };
      }
    });
    if (nav) { var c = { op: 'go', href: nav.href, label: nav.label }; setTimeout(function () { act(c); }, reply ? 900 : 0); return; }
    done();
  }).catch(function (e) { add('note', 'Could not reach qodebase.'); logEv('error', { where: 'chat', err: String(e) }); done(); });
}

function say(text) {
  if (S.speak === 'off' || (S.speak === 'voice' && !lastSpoken) || !window.speechSynthesis) return;
  try {
    speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = /[֐-׿]/.test(text) ? 'he-IL' : 'en-US';
    speechSynthesis.speak(u);
  } catch (e) {}
}

// ---- Listening ---------------------------------------------------------------
var rec = null, mr = null, chunks = [], stream = null, t0 = 0, tick = null, interimTimer = null, interimCalls = 0;
function setListening(on) {
  listening = on;
  micBtn.classList.toggle('on', on); micBtn.innerHTML = on ? ICON.stop : ICON.mic;
  micBtn.setAttribute('aria-label', on ? 'Stop' : 'Speak');
  clearInterval(tick);
  if (on) { t0 = Date.now(); tick = setInterval(function () { status('Listening ' + Math.floor((Date.now() - t0) / 1000) + 's'); }, 250); status('Listening'); }
  else if (!busy) status('');
}
function startListen() {
  if (listening || busy) return;
  if (window.speechSynthesis) speechSynthesis.cancel();
  offerOff(); live.textContent = '';
  if (S.engine === 'native') return startNative();
  return startWhisper();
}
function stopListen(cancel) {
  if (!listening) return;
  if (rec) { if (cancel) rec.abort(); else rec.stop(); }
  if (mr) { if (cancel) { chunks = []; mr.onstop = null; } try { mr.stop(); } catch (e) {} }
  if (cancel) { setListening(false); live.textContent = ''; unmark(); }
}

function startNative() {
  var R = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!R) { add('note', 'This browser has no built-in dictation. Switch to Whisper in Talk settings.'); return; }
  rec = new R();
  rec.lang = LANGS[S.lang] || 'en-US';
  rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
  var finalText = '';
  interimCalls = 0;
  rec.onresult = function (e) {
    var interim = '';
    for (var i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript; else interim += e.results[i][0].transcript;
    }
    live.textContent = (finalText + ' ' + interim).trim();
    // Preview while still talking: what it would do, the target outlined (dashed).
    clearTimeout(interimTimer);
    var said = (finalText + ' ' + interim).trim();
    if (said.split(/\s+/).length >= 3 && interimCalls < 2) interimTimer = setTimeout(function () { interimDecide(said); }, 450);
  };
  rec.onerror = function (e) {
    logEv('stt_error', { engine: 'native', err: e.error });
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') add('note', 'The microphone is blocked for this site. Allow it in the browser, or type instead.');
    else if (e.error !== 'no-speech' && e.error !== 'aborted') add('note', 'Dictation stopped (' + e.error + ').');
  };
  rec.onend = function () {
    clearTimeout(interimTimer);
    setListening(false); rec = null;
    var t = finalText.trim() || live.textContent.trim();
    live.textContent = '';
    if (t) { lastSpoken = true; submit(t); }
  };
  try { rec.start(); setListening(true); } catch (e) { add('note', 'Could not start dictation: ' + e.message); }
}
function interimDecide(text) {
  interimCalls++;
  api('decide', { utterance: text, screen: screen(), interim: true }).then(function (r) {
    if (!listening || !r.cmd) return;
    var c = r.cmd;
    if ((c.mode === 'act' || c.mode === 'both') && c.op !== 'none' && (c.risky || 0) < 0.5) {
      preview = { text: text, cmd: c };
      unmark(); if (c.target) mark(byId(c.target), true);
      status('→ ' + describe(c));
    }
  }).catch(function () {});
}

function startWhisper() {
  if (!navigator.mediaDevices || !window.MediaRecorder) { add('note', 'This browser cannot record audio. Switch to the phone’s own dictation in Talk settings.'); return; }
  setListening(true); status('Starting the microphone…');
  navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (s) {
    stream = s; chunks = [];
    var type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].filter(function (t) { return MediaRecorder.isTypeSupported(t); })[0] || '';
    mr = new MediaRecorder(s, type ? { mimeType: type } : {});
    mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    mr.onstop = function () {
      stream.getTracks().forEach(function (t) { t.stop(); });
      setListening(false);
      var blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
      mr = null;
      if (blob.size < 2000) { status(''); return; }
      status('Hearing…');
      fetch('/api/talk/transcribe?lang=' + encodeURIComponent(S.lang), { method: 'POST', credentials: 'same-origin', headers: { 'content-type': blob.type }, body: blob })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          status('');
          if (j.error) { add('note', j.why || 'Could not hear that.'); return; }
          if (!j.text) { add('note', 'I did not hear anything.'); return; }
          lastSpoken = true; submit(j.text);
        }).catch(function (e) { status(''); add('note', 'Could not reach qodebase.'); logEv('error', { where: 'stt', err: String(e) }); });
    };
    mr.start(250);
    t0 = Date.now();
    // Stop by itself after a pause in speech or 30 s, whichever comes first.
    silenceStop(s);
  }).catch(function (e) {
    setListening(false);
    logEv('stt_error', { engine: 'whisper', err: String(e) });
    add('note', /denied|allowed/i.test(String(e)) ? 'The microphone is blocked for this site. Allow it in the browser, or type instead.' : 'Could not start the microphone.');
  });
}
function silenceStop(s) {
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var src = ctx.createMediaStreamSource(s), an = ctx.createAnalyser();
    an.fftSize = 512; src.connect(an);
    var buf = new Uint8Array(an.fftSize), spoke = false, quietSince = 0;
    (function loop() {
      if (!mr) { ctx.close(); return; }
      an.getByteTimeDomainData(buf);
      var peak = 0; for (var i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
      var now = Date.now();
      if (peak > 12) { spoke = true; quietSince = 0; } else if (!quietSince) quietSince = now;
      if ((spoke && quietSince && now - quietSince > 1300) || now - t0 > 30000) { try { mr.stop(); } catch (e) {} ctx.close(); return; }
      requestAnimationFrame(loop);
    })();
  } catch (e) { setTimeout(function () { if (mr) mr.stop(); }, 8000); }
}

// ---- Boot ----------------------------------------------------------------
fetch('/api/talk/me', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
  if (!j.signedIn) return;
  me = j.handle;
  build();
  // Coming back from a navigation Talk made: show the sheet, finish any pending question.
  if (sget('open', false)) {
    open(true);
    var last = hist[hist.length - 1];
    if (last && last.who === 'app' && /^Opening /.test(last.text)) { hist[hist.length - 1] = { who: 'app', text: last.text.replace(/^Opening (.*)…$/, 'Opened $1.') }; sset('log', hist); render(); }
    var p = sget('pending', null);
    if (p) { sset('pending', null); setTimeout(function () { ask(p.text, p.did); }, 300); }
  }
}).catch(function () {});
})();`;

// ../src/talk.ts
var DECIDE_MODEL = "@cf/cloudflare/clef-flash";
var CHAT_MODEL = "@cf/zai-org/glm-4.7-flash";
var STT_MODEL = "@cf/openai/whisper-large-v3-turbo";
var CAPS = { decide: { me: 600, all: 5e3 }, chat: { me: 150, all: 1500 }, stt: { me: 300, all: 3e3 } };
var log4 = /* @__PURE__ */ __name((event, data = {}) => console.log(JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), module: "talk", event, ...data })), "log");
var json2 = /* @__PURE__ */ __name((data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } }), "json");
var day = /* @__PURE__ */ __name(() => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10), "day");
var TalkLog = class extends DurableObject6 {
  static {
    __name(this, "TalkLog");
  }
  async take(kind, who2) {
    const me = `${kind}:${who2}`, all = `${kind}:*`;
    const [a, b] = [await this.ctx.storage.get(me) || 0, await this.ctx.storage.get(all) || 0];
    if (a >= CAPS[kind].me || b >= CAPS[kind].all) return { ok: false, left: 0 };
    await this.ctx.storage.put({ [me]: a + 1, [all]: b + 1 });
    return { ok: true, left: Math.min(CAPS[kind].me - a - 1, CAPS[kind].all - b - 1) };
  }
  async counts(who2) {
    const out = {};
    for (const k2 of Object.keys(CAPS)) out[k2] = await this.ctx.storage.get(`${k2}:${who2}`) || 0;
    return out;
  }
};
var talkLog = /* @__PURE__ */ __name((env) => env.TalkLog.get(env.TalkLog.idFromName(day())), "talkLog");
var aiOpts = /* @__PURE__ */ __name((env) => env.TALK_GATEWAY ? { gateway: { id: env.TALK_GATEWAY } } : {}, "aiOpts");
var HEDGE_MS = [1200, 2500];
async function hedged(call, marks) {
  let fired = 1;
  const timers = [];
  const first = call().then((res) => ({ res, which: 0 }));
  const extra = marks.map((ms, i) => new Promise((ok, bad) => {
    timers.push(setTimeout(() => {
      fired++;
      call().then((res) => ok({ res, which: i + 1 }), bad);
    }, ms));
  }));
  try {
    const w = await Promise.any([first, ...extra]);
    return { res: w.res, fired, won: w.which };
  } finally {
    timers.forEach(clearTimeout);
  }
}
__name(hedged, "hedged");
function cleanScreen(b) {
  const items = (Array.isArray(b?.items) ? b.items : []).slice(0, 140).map((i) => ({
    id: String(i.id || "").slice(0, 8),
    kind: ["link", "button", "field", "heading"].includes(i.kind) ? i.kind : "link",
    text: String(i.text || "").slice(0, 140),
    href: i.href ? String(i.href).slice(0, 300) : void 0
  })).filter((i) => /^[lbfh]\d{1,4}$/.test(i.id) && i.text);
  return { path: String(b?.path || "/").slice(0, 200), title: String(b?.title || "").slice(0, 120), items, projects: [], last: b?.last ? String(b.last).slice(0, 120) : null };
}
__name(cleanScreen, "cleanScreen");
async function projectsFor(env, who2) {
  const list = await listFor(env, who2?.handle || "", !!who2?.admin);
  return list.slice(0, 400).map((e, i) => ({ id: `p${i + 1}`, slug: e.slug, name: e.name, owner: e.owner, description: String(e.description || "").slice(0, 120), mine: !!who2 && e.owner === who2.handle }));
}
__name(projectsFor, "projectsFor");
async function decide(request, env, who2) {
  const t0 = Date.now();
  const body = await request.json().catch(() => null);
  const utterance = String(body?.utterance || "").trim().slice(0, 300);
  if (!utterance) return json2({ error: "empty" }, 400);
  const budget = await talkLog(env).take("decide", who2.handle);
  if (!budget.ok) return json2({ error: "budget", why: "Talk has reached today's limit. It resets at midnight UTC." }, 429);
  const s = { ...cleanScreen(body.screen), me: who2.handle };
  const projects = candidateProjects(utterance, await projectsFor(env, who2), 24, currentSlug(s.path));
  const { questions, cands } = buildQuestions(utterance, s, projects);
  const state = stateText(utterance, s, projects);
  const tm = Date.now();
  let res, fired = 1, won = 0;
  try {
    ({ res, fired, won } = await hedged(() => env.AI.run(DECIDE_MODEL, { model: "clef-flash", state, questions }, aiOpts(env)), body.interim ? [] : HEDGE_MS));
  } catch (e) {
    log4("decide_error", { level: "error", err: String(e), stack: e?.stack, handle: who2.handle });
    return json2({ error: "model", why: "The model did not answer. Try again." }, 502);
  }
  const cmd = resolve(res.answers, cands, s, projects, utterance);
  log4("decide", {
    level: "info",
    handle: who2.handle,
    path: s.path,
    interim: !!body.interim,
    model_ms: Date.now() - tm,
    total_ms: Date.now() - t0,
    fired,
    won,
    n_items: s.items.length,
    n_projects: projects.length,
    n_questions: Object.keys(questions).length,
    mode: cmd.mode,
    mode_p: cmd.modeP,
    op: cmd.op,
    p: cmd.p,
    risky: cmd.risky,
    why: cmd.why,
    usage: res.usage
  });
  return json2({ cmd, ms: { model: Date.now() - tm, total: Date.now() - t0 }, left: budget.left, ...body.debug ? { answers: res.answers, state } : {} });
}
__name(decide, "decide");
var TOOLS = [
  { type: "function", function: { name: "go", description: "Open a page: a link id from the page (like l12) or a path on this site (like /p/forq/timer/app).", parameters: { type: "object", properties: { to: { type: "string" } }, required: ["to"] } } },
  { type: "function", function: { name: "press", description: "Press a button on the page by its id (like b3). Never for deleting, merging, publishing or signing out.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } } },
  { type: "function", function: { name: "type_into", description: "Type text into a field on the page by its id (like f1).", parameters: { type: "object", properties: { id: { type: "string" }, text: { type: "string" } }, required: ["id", "text"] } } },
  { type: "function", function: { name: "show", description: "Point at parts of the page while you explain them: heading, link, button or field ids, in the order you talk about them.", parameters: { type: "object", properties: { ids: { type: "array", items: { type: "string" } } }, required: ["ids"] } } }
];
async function chat(request, env, who2) {
  const t0 = Date.now();
  const body = await request.json().catch(() => null);
  const utterance = String(body?.utterance || "").trim().slice(0, 500);
  if (!utterance) return json2({ error: "empty" }, 400);
  const budget = await talkLog(env).take("chat", who2.handle);
  if (!budget.ok) return json2({ error: "budget", why: "Talk has reached today's chat limit. It resets at midnight UTC." }, 429);
  const s = cleanScreen(body.screen);
  const pageText = String(body.pageText || "").slice(0, 5e3);
  const did = body.did ? String(body.did).slice(0, 200) : "";
  const items = s.items.map((i) => `${i.id} ${i.kind}: ${i.text}${i.href ? " \u2192 " + i.href : ""}`).join("\n");
  const system = [
    "You are the voice of qodebase, a git platform made for the phone: every project runs as a live app, every fork gets its own AI agents, and people can install AI assistants into their own Cloudflare account.",
    `You talk with ${who2.handle}, who is on ${s.path} ("${s.title}"). Answer in plain words, short: two or three sentences unless they ask for more. Spoken aloud too, so no markdown, no lists, no code.`,
    "You can act with the tools: open pages, press buttons, type into fields, and point at parts of the page while you explain. Act when asked; explain what is on the page when asked; never press anything that deletes, merges, publishes or signs out.",
    did ? `The app already did this for their last sentence: ${did}.` : "",
    "",
    "What is on the page (id, kind, text):",
    items || "(nothing)",
    "",
    "The page text:",
    pageText || "(none)"
  ].filter((x) => x !== "").join("\n");
  const history = (Array.isArray(body.history) ? body.history : []).slice(-8).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "").slice(0, 800) }));
  const messages = [{ role: "system", content: system }, ...history, { role: "user", content: utterance }];
  const tm = Date.now();
  const run = /* @__PURE__ */ __name((msgs) => env.AI.run(CHAT_MODEL, { messages: msgs, tools: TOOLS, max_tokens: 700, temperature: 0.3, chat_template_kwargs: { enable_thinking: false } }, aiOpts(env)), "run");
  const parse = /* @__PURE__ */ __name((res2) => {
    const msg = res2?.choices?.[0]?.message || res2;
    const raw = msg?.tool_calls || res2?.tool_calls || [];
    const calls2 = raw.map((c) => {
      const f = c.function || c;
      let args = f.arguments;
      if (typeof args === "string") {
        try {
          args = JSON.parse(args);
        } catch {
          args = {};
        }
      }
      return { id: c.id, name: String(f.name || ""), args: args || {} };
    }).filter((c) => ["go", "press", "type_into", "show"].includes(c.name)).slice(0, 4);
    return { msg, raw, calls: calls2, reply: String(msg?.content ?? res2?.response ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim() };
  }, "parse");
  let res, out, rounds = 1;
  try {
    res = await run(messages);
    out = parse(res);
    if (!out.reply && out.raw.length) {
      rounds = 2;
      const res2 = await run([
        ...messages,
        { role: "assistant", content: "", tool_calls: out.raw },
        ...out.raw.map((c) => ({ role: "tool", tool_call_id: c.id, content: "done" }))
      ]);
      const out2 = parse(res2);
      out = { ...out, reply: out2.reply };
      res = { ...res, usage2: res2?.usage };
    }
  } catch (e) {
    log4("chat_error", { level: "error", err: String(e), stack: e?.stack, handle: who2.handle });
    return json2({ error: "model", why: "The model did not answer. Try again." }, 502);
  }
  const { calls, reply } = out;
  log4("chat", { level: "info", handle: who2.handle, path: s.path, rounds, model_ms: Date.now() - tm, total_ms: Date.now() - t0, tools: calls.map((c) => c.name), reply_len: reply.length, usage: res?.usage, usage2: res?.usage2 });
  return json2({ reply, actions: calls.map((c) => ({ name: c.name, args: c.args })), ms: { model: Date.now() - tm }, left: budget.left });
}
__name(chat, "chat");
async function transcribe(request, env, who2, url) {
  const t0 = Date.now();
  const buf = await request.arrayBuffer();
  if (buf.byteLength < 800) return json2({ text: "", why: "too short" });
  if (buf.byteLength > 8e6) return json2({ error: "too long" }, 413);
  const budget = await talkLog(env).take("stt", who2.handle);
  if (!budget.ok) return json2({ error: "budget", why: "Dictation has reached today's limit. Use the phone's own dictation in Talk settings." }, 429);
  const lang = url.searchParams.get("lang");
  let b642 = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 32768) b642 += String.fromCharCode(...bytes.subarray(i, i + 32768));
  try {
    const res = await env.AI.run(STT_MODEL, { audio: btoa(b642), ...lang === "en" || lang === "he" ? { language: lang } : {}, vad_filter: true }, aiOpts(env));
    const text = String(res?.text || "").trim();
    log4("stt", { level: "info", handle: who2.handle, bytes: buf.byteLength, lang, ms: Date.now() - t0, chars: text.length, detected: res?.transcription_info?.language });
    return json2({ text, ms: Date.now() - t0 });
  } catch (e) {
    log4("stt_error", { level: "error", err: String(e), stack: e?.stack, bytes: buf.byteLength, type: request.headers.get("content-type") });
    return json2({ error: "stt", why: "Could not hear that. Try again, or use the phone's own dictation in Talk settings." }, 502);
  }
}
__name(transcribe, "transcribe");
async function talkRoute(request, env, _ctx, url, who2) {
  if (url.pathname === "/talk.js") return new Response(TALK_JS, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=300" } });
  if (!url.pathname.startsWith("/api/talk/")) return null;
  if (!env.AI) return json2({ error: "off", why: "Talk is not set up on this copy (no AI binding)." }, 404);
  if (url.pathname === "/api/talk/me") {
    if (!who2) return json2({ signedIn: false });
    return json2({ signedIn: true, handle: who2.handle, used: await talkLog(env).counts(who2.handle), caps: CAPS });
  }
  if (!who2) return json2({ error: "signin", why: "Sign in to talk to qodebase." }, 401);
  if (request.method !== "POST") return json2({ error: "method" }, 405);
  if (url.pathname === "/api/talk/decide") return decide(request, env, who2);
  if (url.pathname === "/api/talk/chat") return chat(request, env, who2);
  if (url.pathname === "/api/talk/transcribe") return transcribe(request, env, who2, url);
  return json2({ error: "not found" }, 404);
}
__name(talkRoute, "talkRoute");

// ../src/index.ts
import MA_TGZ from "./8569221bf067334f0605d74e2f82bbaeea407027-mobile-agent.tgz";
import MA_REV from "./03797df4c2fa76c8d38f994f31f763c57b4be342-mobile-agent.rev";
var jwks = null;
var json3 = /* @__PURE__ */ __name((data, status = 200) => Response.json(data, { status }), "json");
var projectStub = /* @__PURE__ */ __name((env, slug) => env.Project.get(env.Project.idFromName(slug)), "projectStub");
var boxStub = /* @__PURE__ */ __name((env, agentId) => env.AgentBox.get(env.AgentBox.idFromName(agentId)), "boxStub");
var INLINE_BOOT_MS = 12e3;
async function hmac3(env, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.ADMIN_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig2 = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`agent:${msg}`));
  return [...new Uint8Array(sig2)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hmac3, "hmac");
var agentToken = /* @__PURE__ */ __name(async (env, agentId) => `${agentId}.${await hmac3(env, agentId)}`, "agentToken");
async function who(request, env) {
  const url = new URL(request.url);
  const handles = JSON.parse(env.HANDLES || "{}");
  if (url.hostname.endsWith(".workers.dev") && !isUiHost(env, url.hostname)) {
    const at = request.headers.get("x-forq-agent");
    if (at) {
      const i = at.lastIndexOf(".");
      const id = at.slice(0, i);
      if (i > 0 && AGENT_RE.test(id) && at.slice(i + 1) === await hmac3(env, id)) return { kind: "agent", agentId: id, role: roleOf(id) };
      return null;
    }
    if (env.ADMIN_SECRET && request.headers.get("x-forq-secret") === env.ADMIN_SECRET) {
      const asEmail = request.headers.get("x-forq-as-email");
      if (asEmail) {
        let u = await userByEmail(env, asEmail.toLowerCase());
        if (!u && request.headers.get("x-forq-create-handle")) u = (await claimHandle(env, asEmail.toLowerCase(), request.headers.get("x-forq-create-handle"))).user || null;
        return u ? { kind: "user", handle: u.handle, admin: false, email: u.email } : null;
      }
      return { kind: "user", handle: request.headers.get("x-forq-as") || "eyal", admin: true };
    }
    return null;
  }
  const bearer = await bearerEmail(env, request);
  if (bearer === null) return null;
  if (bearer) {
    const u = await userByEmail(env, bearer);
    return u ? { kind: "user", handle: u.handle, admin: false, email: u.email } : null;
  }
  const email = await sessionEmail(env, request) || await accessEmail(request, env);
  if (email) {
    let u = await userByEmail(env, email);
    if (!u && env.SELF_HOST) {
      const mapped = JSON.parse(env.HANDLES || "{}")[email];
      u = (await claimHandle(env, email, mapped || await suggestHandle(env, email))).user || null;
    }
    if (u) return { kind: "user", handle: u.handle, admin: false, email: u.email };
  }
  return { kind: "user", handle: "", admin: false, anon: true };
}
__name(who, "who");
async function accessEmail(request, env) {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return null;
  try {
    jwks ||= createRemoteJWKSet(new URL(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`));
    const { payload } = await jwtVerify(token, jwks, { issuer: `https://${env.ACCESS_TEAM_DOMAIN}`, audience: env.ACCESS_AUD });
    return String(payload.email || "").toLowerCase() || null;
  } catch (e) {
    log("auth", "jwt_rejected", { err: String(e) });
    return null;
  }
}
__name(accessEmail, "accessEmail");
var variantHosts = /* @__PURE__ */ __name((env) => (env.UI_VARIANT_HOSTS || "").split(",").map((h) => h.trim()).filter(Boolean), "variantHosts");
var safeNext = /* @__PURE__ */ __name((n) => n && /^\/[^/\\]/.test(n) ? n : null, "safeNext");
async function loginRoute(request, env, url) {
  const email = await accessEmail(request, env);
  if (!email) return new Response("Sign-in did not complete. Try again from the qodebase home page.", { status: 401 });
  let user = await userByEmail(env, email);
  let fresh = false;
  if (!user) {
    const mapped = JSON.parse(env.HANDLES || "{}")[email];
    const r = await claimHandle(env, email, mapped || await suggestHandle(env, email));
    if (!r.ok || !r.user) return new Response(`Could not create your account: ${r.error}`, { status: 500 });
    user = r.user;
    fresh = true;
  }
  const next = safeNext(url.searchParams.get("next")) || (fresh ? "/settings?welcome=1" : "/");
  const to = url.searchParams.get("to");
  if (to && (variantHosts(env).includes(to) || frontHosts(env).includes(to))) {
    log("auth", "handoff", { handle: user.handle, to });
    return new Response(null, { status: 302, headers: { location: `https://${to}/session?t=${encodeURIComponent(await handoffToken(env, email, to))}&next=${encodeURIComponent(next)}`, "cache-control": "no-store" } });
  }
  log("auth", "login", { handle: user.handle, fresh });
  return new Response(null, { status: 302, headers: { location: next, "set-cookie": await sessionCookie(env, email), "cache-control": "no-store" } });
}
__name(loginRoute, "loginRoute");
async function bootSpec(env, agentId, apiBase) {
  const slug = projectOf(agentId);
  const r = await projectStub(env, slug).boxRepo(agentId);
  const owner = slug.split(".")[0];
  let ccEnv, keyTail, billing;
  if (onSubscription(env, owner)) {
    ccEnv = `CLAUDE_CODE_OAUTH_TOKEN=${env.CLAUDE_CODE_OAUTH_TOKEN}`;
    keyTail = env.CLAUDE_CODE_OAUTH_TOKEN.slice(-20);
    billing = "sub";
  } else {
    const u = await userByHandle(env, owner);
    if (!u?.apiKeyEnc) throw new Error(`${owner} has not added an Anthropic API key yet (Settings)`);
    const key = await decryptKey(env, u.apiKeyEnc);
    if (isClaudeToken(key)) {
      ccEnv = `CLAUDE_CODE_OAUTH_TOKEN=${key}`;
      keyTail = key.slice(-20);
      billing = "sub";
    } else {
      ccEnv = `ANTHROPIC_API_KEY=${key} ANTHROPIC_MODEL=${u.model || DEFAULT_API_MODEL}`;
      keyTail = key.slice(-20);
      billing = "api";
    }
  }
  return {
    agentId,
    task: r.task,
    role: r.role,
    project: slug.replace(".", "/"),
    remote: r.remote,
    gitToken: r.token,
    agentToken: await agentToken(env, agentId),
    apiBase,
    uiHost: env.UI_HOST,
    maRev: MA_REV.trim(),
    bootEnv: [
      `SBX_NAME=${JSON.stringify(r.role === "agent" ? agentId : `${slug.replace(".", "/")} ${r.role}`)}`,
      "AGENT=claude",
      `CC_ENV=${JSON.stringify(ccEnv)}`,
      `CC_KEY_TAIL=${JSON.stringify(keyTail)}`,
      `BILLING=${billing}`,
      ""
    ].join("\n")
  };
}
__name(bootSpec, "bootSpec");
async function wake(env, agentId, apiBase) {
  const info = await projectStub(env, projectOf(agentId)).info();
  if (!info) throw new Error("no such project");
  const box = boxStub(env, agentId);
  if (await box.isAwake().catch(() => false)) return box.ensureUp(await bootSpec(env, agentId, apiBase));
  const refuse = /* @__PURE__ */ __name((why, data, error) => {
    log("wake", "refused", { agentId, why, ...data });
    return { ok: false, ms: 0, from: "none", error };
  }, "refuse");
  const entries = await registry(env).list();
  const infos = await Promise.all(entries.map((e) => e.slug === info.slug ? info : projectStub(env, e.slug).info().catch(() => null)));
  const awake = [];
  await Promise.all(infos.flatMap((pi) => (pi ? [...pi.agents.map((a) => a.id), `${pi.slug}--router`, `${pi.slug}--review`] : []).filter((id) => id !== agentId).map(async (id) => {
    if (await boxStub(env, id).isAwake().catch(() => false)) awake.push({ id, slug: projectOf(id), owner: id.split(".")[0], role: roleOf(id) });
  })));
  const total = Number(env.MAX_TOTAL_AWAKE || 20);
  if (awake.length >= total) return refuse("account cap", { total, awake: awake.length }, `qodebase is busy: ${total} boxes are awake across all projects. Try again in a few minutes`);
  const role = roleOf(agentId);
  const max = Number(env.MAX_AWAKE_BOXES || 5);
  if (role === "agent" && awake.filter((b) => b.slug === info.slug && b.role === "agent").length >= max) {
    return refuse("project cap", { max }, `${max} agents already awake in this project`);
  }
  if (!isOwner(env, info.owner)) {
    const cap = Number(env.OTHERS_MAX_AWAKE || 2);
    const n = awake.filter((b) => b.owner === info.owner && (b.role === "agent" || b.slug !== info.slug)).length;
    if (n >= cap) return refuse("person cap", { cap, n, role }, `${cap} of your boxes are already awake; they sleep after 5 idle minutes`);
  }
  return box.ensureUp(await bootSpec(env, agentId, apiBase));
}
__name(wake, "wake");
async function boxStatus(env, id, withReply = false) {
  const box = boxStub(env, id);
  const ph = await box.phase().catch(() => ({ awake: false, booting: false, taskSent: false }));
  if (!ph.awake) return { ...ph, cc: "asleep" };
  const [cc, said] = await Promise.all([box.ccStatus().catch(() => "unknown"), withReply ? box.lastReply().catch(() => void 0) : void 0]);
  return { ...ph, cc, said };
}
__name(boxStatus, "boxStatus");
async function docsOf(env, ctx, info, want) {
  const h = await head(env, ctx, info.repo).catch(() => null);
  if (!h) return { list: [], current: null, text: null };
  const root = await tree(env, ctx, info.repo, h.tree);
  const found = [];
  for (const e of root) if (e.type === "blob") {
    const r = docRank(e.name);
    if (r !== null) found.push({ path: e.name, hash: e.hash, rank: r });
  }
  const dd = root.find((e) => e.type === "tree" && /^docs?$/i.test(e.name));
  if (dd) {
    for (const e of (await tree(env, ctx, info.repo, dd.hash)).slice(0, 40)) if (e.type === "blob") {
      const p = `${dd.name}/${e.name}`;
      const r = docRank(p);
      if (r !== null) found.push({ path: p, hash: e.hash, rank: r });
    }
  }
  found.sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path));
  const list = found.slice(0, 16);
  const cur = want && list.find((d) => d.path === want) || list.find((d) => d.rank === 0) || null;
  const text = cur ? (await blob(env, ctx, info.repo, cur.hash, cur.path).catch(() => null))?.text ?? null : null;
  return { list: list.map((d) => ({ path: d.path, label: docLabel(d.path) })), current: cur?.path || null, text };
}
__name(docsOf, "docsOf");
var uiFor = /* @__PURE__ */ __name((request, env) => uiOf(request) ?? (isUiHost(env, new URL(request.url).hostname) ? "d" : null), "uiFor");
async function inboxOf(env, me, entries, runBase) {
  if (!me) return [];
  const out = await Promise.all(entries.filter((e) => e.owner === me).map(async (entry) => {
    const info = await projectStub(env, entry.slug).info().catch(() => null);
    return info ? { entry, info, open: changesOf(info, {}, runBase).open } : null;
  }));
  return out.filter((x) => !!x && x.open.length > 0);
}
__name(inboxOf, "inboxOf");
var inboxCount = /* @__PURE__ */ __name((items) => items.reduce((n, it) => n + needsOf(it.open).length, 0), "inboxCount");
async function statusesOf(env, info) {
  const status = {};
  const open = info.agents.filter((a) => a.state !== "merged" && a.state !== "stopped");
  await Promise.all(open.map(async (a) => {
    status[a.id] = await boxStatus(env, a.id);
  }));
  const [router, reviewer] = await Promise.all([boxStatus(env, `${info.slug}--router`, true), boxStatus(env, `${info.slug}--review`)]);
  return { status, router, reviewer };
}
__name(statusesOf, "statusesOf");
async function renderAgents(env, info, runBase, ui = null) {
  const status = {};
  const open = info.agents.filter((a) => a.state !== "merged" && a.state !== "stopped");
  await Promise.all(open.map(async (a) => {
    status[a.id] = await boxStatus(env, a.id);
  }));
  const [router, reviewer] = await Promise.all([boxStatus(env, `${info.slug}--router`, true), boxStatus(env, `${info.slug}--review`)]);
  return ui ? liveV2(ui, info, router, status, runBase) : agentsHtml(info, runBase, router, status, reviewer);
}
__name(renderAgents, "renderAgents");
async function sendTo(env, agentId, text, apiBase) {
  const box = boxStub(env, agentId);
  if (!await box.isAwake()) {
    const b = await wake(env, agentId, apiBase);
    if (!b.ok) return { ok: false, error: b.error || "the box did not start" };
  }
  await box.touch(agentId);
  return box.send(text);
}
__name(sendTo, "sendTo");
var app = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if ((url.hostname === env.RUN_HOST || url.hostname.endsWith(`.${env.RUN_HOST}`)) && !(env.SELF_HOST && url.pathname.startsWith("/api/"))) return serveRun(request, env, ctx);
    if (url.pathname === "/api/hooks/issues" && request.method === "POST") return issuesHook(request, env, ctx);
    if (isUiHost(env, url.hostname)) {
      const cf2 = request.cf || {};
      if (url.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /p/\nDisallow: /import\nDisallow: /api/\nDisallow: /a/\nDisallow: /login\n", { headers: { "content-type": "text/plain" } });
      if (url.pathname === "/icon.svg") return new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="48" fill="#17695a"/><circle cx="121" cy="110" r="48" fill="none" stroke="#fff" stroke-width="30"/><path d="M154 58h30v138h-30z" fill="#fff"/></svg>', { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" } });
      if (url.pathname === "/version.json") return json3({ name: "forq", version: env.CF_VERSION_METADATA?.id || null, at: env.CF_VERSION_METADATA?.timestamp || null });
      if (url.pathname === "/health.json") return health(env, ctx, url.origin);
      if (url.pathname === "/e") return kstatsForward(request, env, ctx);
      if (url.pathname === "/feedback") return feedback(request, env);
      if (url.pathname === "/about") return html3(aboutPage());
      if (url.pathname === "/privacy") return html3(privacyPage());
      if (url.pathname === "/personal-agents" && env.CF_OAUTH_CLIENT_ID) return html3(personalAgentsPage());
      if (url.pathname === "/own" && !env.SELF_HOST) return html3(ownPage(true));
      if (url.pathname.startsWith("/connect/cf/") || url.pathname.startsWith("/personal-agents/") || url.pathname === "/api/installs") {
        const r = await installRoute(request, env, ctx, url);
        if (r) return r;
      }
      if (url.pathname === "/talk.js" || url.pathname.startsWith("/api/talk/")) {
        const w = await who(request, env);
        const r = await talkRoute(request, env, ctx, url, w?.kind === "user" && !w.anon ? { handle: w.handle, admin: w.admin } : null);
        if (r) return r;
      }
      if (url.pathname.startsWith("/api/cli/") || url.pathname.startsWith("/cli") || url.pathname === "/llms.txt") {
        const r = await cliPublicRoute(request, env, url);
        if (r) return r;
      }
      if ((cf2.verifiedBotCategory || cf2.botManagement?.verifiedBot) && url.pathname !== "/") {
        return new Response("forq pages are for people; see /about.", { status: 403, headers: { "retry-after": "86400", "x-robots-tag": "noindex" } });
      }
    }
    const vhost = frontHosts(env).includes(url.hostname) ? url.hostname : request.headers.get("x-forq-host");
    if (vhost && (variantHosts(env).includes(vhost) || frontHosts(env).includes(vhost))) {
      if (url.pathname === "/login") {
        return new Response(null, { status: 302, headers: { location: `https://${env.UI_HOST}/login?to=${vhost}&next=${encodeURIComponent(safeNext(url.searchParams.get("next")) || "/")}` } });
      }
      if (url.pathname === "/session") {
        const email = await handoffEmail(env, url.searchParams.get("t") || "", vhost);
        if (!email) return new Response("That sign-in link has expired. Sign in again.", { status: 401 });
        return new Response(null, { status: 302, headers: { location: safeNext(url.searchParams.get("next")) || "/", "set-cookie": await sessionCookie(env, email), "cache-control": "no-store" } });
      }
    }
    if (url.pathname === "/login" && url.hostname === env.UI_HOST) return loginRoute(request, env, url);
    if (url.pathname === "/logout") return new Response(null, { status: 302, headers: { location: "/", "set-cookie": clearCookie() } });
    const me = await who(request, env);
    if (!me) return json3({ error: "unauthorized" }, 401);
    if (me.kind === "user" && me.anon) {
      const p0 = url.pathname;
      const needsUser = request.method !== "GET" && request.method !== "HEAD" || p0 === "/cli/login" || p0.startsWith("/api/cli/") || p0.startsWith("/a/") || p0.endsWith("/agents-html") || p0.startsWith("/api/github") || p0 === "/settings" || p0.startsWith("/api/me");
      if (needsUser) {
        const login = `/login?next=${encodeURIComponent(request.method === "GET" ? p0 + url.search : request.headers.get("referer") ? new URL(request.headers.get("referer")).pathname : "/")}`;
        return request.method === "GET" && (request.headers.get("accept") || "").includes("text/html") ? new Response(null, { status: 302, headers: { location: login } }) : json3({ error: "Sign in first", login }, 401);
      }
    }
    const path2 = url.pathname;
    if (me.kind === "user" && me.email && me.handle && (path2.startsWith("/cli/") || path2.startsWith("/api/cli/"))) {
      const r = await cliUserRoute(request, env, url, me.email, me.handle);
      if (r) return r;
    }
    const apiBase = url.hostname.endsWith(".workers.dev") ? `https://${url.hostname}` : env.API_BASE;
    const runBase = `https://${env.RUN_HOST}`;
    try {
      if (me.kind === "agent") return agentApi(request, env, ctx, me, url, apiBase);
      let m;
      if (m = path2.match(/^\/(?:api\/)?p\/([a-z0-9-]+)\/([a-z0-9-]+)(?:\/|$)/)) {
        const e = await registry(env).get(slugOf(m[1], m[2]));
        if (e && !canSee(e, me.handle, me.admin)) return path2.startsWith("/api/") ? json3({ error: "no such project" }, 404) : new Response("No such project", { status: 404 });
      }
      const ui = uiFor(request, env);
      const views = ui === "a" || ui === "b" || ui === "c" || ui === "d";
      const tabsNav = ui === "a" || ui === "b" || ui === "d";
      const globalOf = /* @__PURE__ */ __name(async (entries) => ({
        nav: ui || "c",
        inbox: tabsNav && me.handle ? inboxCount(await inboxOf(env, me.handle, entries || await listFor(env, me.handle, me.admin), runBase)) : 0
      }), "globalOf");
      if (views && uiOf(request) && (m = path2.match(/^\/design-fixture(?:\/([a-z]+))?\/?$/))) {
        return html3(fixtureV3(runBase, url.searchParams.get("state") || "full", VIEW_IDS.includes(m[1] || "") ? m[1] : null, url.searchParams.get("try") || void 0, await globalOf()));
      }
      if (ui === "d" && (path2 === "/" || path2 === "/mine" || path2 === "/inbox" || path2 === "/explore")) {
        if (path2 === "/" && ["s", "cat", "tag", "sort"].some((k2) => url.searchParams.has(k2))) return new Response(null, { status: 301, headers: { location: `/explore${url.search}` } });
        const entries = await listFor(env, me.handle, me.admin);
        const tab = path2 === "/mine" && me.handle ? "mine" : path2 === "/inbox" && me.handle ? "inbox" : path2 === "/explore" ? "explore" : "home";
        const s = url.searchParams.get("s");
        return html3(homeV3(
          "d",
          tab,
          entries,
          me.handle,
          await inboxOf(env, me.handle, entries, runBase),
          s === "people" ? s : "projects",
          { tag: url.searchParams.get("cat") || url.searchParams.get("tag") || void 0, sort: url.searchParams.get("sort") || void 0 },
          !!env.SELF_HOST
        ));
      }
      if (ui === "d" && path2 === "/build" && request.method === "GET") {
        const own = me.handle && !onSubscription(env, me.handle);
        const needsKey = !!own && !(await userByHandle(env, me.handle))?.apiKeyEnc;
        const inbox = me.handle ? inboxCount(await inboxOf(env, me.handle, await listFor(env, me.handle, me.admin), runBase)) : 0;
        return html3(buildV3("d", me.handle, inbox, needsKey, env.RUN_HOST));
      }
      if (ui === "d" && (m = path2.match(/^\/gh\/([\w.-]+)\/([\w.-]+?)(\/readme)?\/?$/))) {
        const full = `${m[1]}/${m[2]}`;
        if (m[3]) {
          const h = await catalogReadme(full, ctx);
          return h == null ? new Response("No README", { status: 404 }) : new Response(h, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" } });
        }
        const entries = await listFor(env, me.handle, me.admin);
        const pg = catalogV3("d", full, entries, me.handle, me.handle ? inboxCount(await inboxOf(env, me.handle, entries, runBase)) : 0);
        return pg ? html3(pg) : new Response("Not in the catalogue", { status: 404 });
      }
      if (tabsNav && (path2 === "/" || path2 === "/inbox" || path2 === "/explore")) {
        const entries = await listFor(env, me.handle, me.admin);
        const tab = !me.handle || path2 === "/explore" ? "explore" : path2 === "/inbox" ? "inbox" : "projects";
        return html3(homeV3(ui, tab, entries, me.handle, await inboxOf(env, me.handle, entries, runBase)));
      }
      if (uiOf(request) && path2 === "/design-fixture") return html3(fixtureV2(uiOf(request), runBase, url.searchParams.get("state") || "full"));
      if (path2 === "/") {
        const entries = await listFor(env, me.handle, me.admin);
        if (ui) {
          const status = {};
          await Promise.all(entries.filter((e) => me.handle && e.owner === me.handle).map(async (e) => {
            const pi = await projectStub(env, e.slug).info().catch(() => null);
            const ag = (pi?.agents || []).filter((a) => a.state !== "merged" && a.state !== "stopped");
            status[e.slug] = {
              ready: ag.filter((a) => a.state === "pushed" && a.review?.state !== "changes" && a.review?.state !== "queued" && a.review?.state !== "reviewing" && a.review?.state !== "sent").length,
              fix: ag.filter((a) => a.review?.state === "changes" || a.state === "blocked").length,
              working: ag.filter((a) => a.state === "working" || ["queued", "reviewing", "sent"].includes(a.review?.state || "")).length
            };
          }));
          return html3(homeV2(ui, entries, me.handle, status));
        }
        return html3(explorePage(entries, me.handle));
      }
      if (path2 === "/import") return html3(importPage(me.handle));
      if (path2 === "/settings") {
        const u = await userByEmail(env, me.email || "");
        if (!u) return new Response(null, { status: 302, headers: { location: "/login?next=/settings" } });
        const mine = (await listFor(env, me.handle, me.admin)).filter((e) => e.owner === u.handle).length;
        const page = settingsPage(u, onSubscription(env, u.handle), mine, url.searchParams.has("welcome"), await registry(env).cliTokens(u.email));
        return html3(tabsNav ? withGlobal(page, "account", (await globalOf()).inbox, u.handle, ui) : page);
      }
      if (path2.startsWith("/api/me/") && request.method !== "GET") {
        const u = await userByEmail(env, me.email || "");
        if (!u) return json3({ error: "Sign in first" }, 401);
        if (path2 === "/api/me/key" && request.method === "POST") {
          const { key } = await request.json();
          const k2 = String(key || "").trim();
          const c = await checkApiKey(k2);
          if (!c.ok) return json3({ error: c.error }, 400);
          await registry(env).putUser({ ...u, apiKeyEnc: await encryptKey(env, k2), apiKeyTail: k2.slice(-4), apiKeyCheckedAt: Date.now() });
          log("auth", "api_key_saved", { handle: u.handle });
          return json3({ ok: true, tail: k2.slice(-4) });
        }
        if (path2 === "/api/me/key" && request.method === "DELETE") {
          const { apiKeyEnc, apiKeyTail, apiKeyCheckedAt, ...rest } = u;
          await registry(env).putUser(rest);
          return json3({ ok: true });
        }
        if (path2 === "/api/me/handle" && request.method === "POST") {
          const { handle } = await request.json();
          if ((await listFor(env, me.handle, me.admin)).some((e) => e.owner === u.handle)) return json3({ error: "You already own projects under this name, so it cannot change." }, 400);
          const r = await claimHandle(env, u.email, String(handle || ""));
          if (!r.ok) return json3({ error: r.error }, 400);
          await registry(env).putUser({ ...u, handle: r.user.handle });
          return json3({ ok: true, handle: r.user.handle });
        }
      }
      if (path2 === "/api/projects" && request.method === "GET") {
        const owner = url.searchParams.get("owner") || (url.searchParams.has("mine") ? me.handle : "");
        const list = (await listFor(env, me.handle, me.admin)).filter((e) => !owner || e.owner === owner);
        return json3({ projects: list.slice(0, 500).map((e) => ({ ...e, path: `/p/${e.owner}/${e.name}`, live: runUrl(runBase, e.slug) })) });
      }
      if (path2 === "/api/github/search") {
        const q = url.searchParams.get("q") || "";
        const ref = parseRepoRef(q);
        if (ref) {
          const r2 = await getRepo(ref, ctx);
          return "error" in r2 ? json3(r2, r2.status) : json3({ repos: [r2], exact: true });
        }
        if (q.trim().length < 2) return json3({ repos: [] });
        const r = await searchRepos(q, ctx);
        return Array.isArray(r) ? json3({ repos: r }) : json3(r, r.status);
      }
      if (path2 === "/api/build" && request.method === "POST") {
        if (!me.handle) return json3({ error: "Sign in first" }, 401);
        const b = await request.json().catch(() => ({}));
        const prompt = String(b.prompt || "").trim().slice(0, 3e3);
        if (prompt.length < 4) return json3({ error: "Say what to build" }, 400);
        if (!onSubscription(env, me.handle) && !(await userByHandle(env, me.handle))?.apiKeyEnc) return json3({ error: "Add your Anthropic API key in Settings first" }, 400);
        const tooMany = await overProjectLimit(env, me.handle);
        if (tooMany) return json3({ error: tooMany }, 400);
        const starter = await projectStub(env, STARTER).info();
        const base = nameFor(String(b.name || "")) || "my-app";
        let name = base;
        for (let i = 2; await registry(env).get(slugOf(me.handle, name)); i++) name = `${base.slice(0, 35)}-${i}`;
        if (!NAME_RE.test(name)) return json3({ error: "That name does not work; use letters, digits and dashes" }, 400);
        const slug = slugOf(me.handle, name);
        const p = projectStub(env, slug);
        const desc = prompt.split("\n")[0].slice(0, 140);
        if (starter) await p.createFork(me.handle, name, starter, desc, true);
        else await p.create(me.handle, name, desc);
        if (b.private) await p.setPrivate(true);
        await askRouter(env, ctx, p, slug, buildPayload(prompt, !starter), apiBase, prompt);
        log("build", "started", { slug, chars: prompt.length });
        return json3({ ok: true, slug, path: `/p/${me.handle}/${name}/changes` });
      }
      if (path2 === "/api/import" && request.method === "POST") {
        const b = await request.json();
        const ref = parseRepoRef(String(b.repo || ""));
        if (!ref) return json3({ error: "give a GitHub URL or owner/repo" }, 400);
        const gh = await getRepo(ref, ctx);
        if ("error" in gh) return json3(gh, gh.status);
        if (gh.private) return json3({ error: "private repos cannot be imported" }, 400);
        if (gh.sizeKb > MAX_IMPORT_KB) return json3({ error: `${gh.fullName} is ${Math.round(gh.sizeKb / 1024)} MB; qodebase imports up to ${MAX_IMPORT_KB / 1024} MB` }, 400);
        const owner = me.admin && b.as ? b.as : me.handle;
        const tooMany = await overProjectLimit(env, owner);
        if (tooMany) return json3({ error: tooMany }, 400);
        let name = nameFor(gh.name);
        for (let i = 2; await registry(env).get(slugOf(owner, name)); i++) name = `${nameFor(gh.name).slice(0, 35)}-${i}`;
        const info = await projectStub(env, slugOf(owner, name)).createImported(
          owner,
          name,
          { url: `https://github.com/${gh.fullName}`, fullName: gh.fullName, stars: gh.stars, license: gh.license, branch: gh.branch },
          gh.description
        );
        if (b.private) await projectStub(env, info.slug).setPrivate(true);
        return json3({ ...info, private: !!b.private, path: `/p/${owner}/${name}` });
      }
      if (m = path2.match(/^\/p\/([a-z0-9-]+)\/([a-z0-9-]+)\/build-log$/)) {
        const info = await projectStub(env, slugOf(m[1], m[2])).info();
        if (!info) return new Response("No such project", { status: 404 });
        const ag = url.searchParams.get("agent");
        const a = ag ? info.agents.find((x) => x.id.split("--")[1] === ag) : void 0;
        return html3(buildLogPage(info, a ? `Preview of agent ${ag}` : "Live app (main)", a ? a.preview : info.app));
      }
      if (views && (m = path2.match(/^\/p\/([a-z0-9-]+)\/([a-z0-9-]+)(?:\/(readme|changes|app|history|more|agents|errors|about))?\/?$/))) {
        const slug = slugOf(m[1], m[2]);
        const p = projectStub(env, slug);
        const info = await p.info();
        if (!info) return new Response("No such project", { status: 404 });
        const all = await listFor(env, me.handle, me.admin);
        const own = info.owner === me.handle;
        const st = own ? await statusesOf(env, info) : { status: {}, router: { awake: false, cc: "asleep" }, reviewer: { awake: false, cc: "asleep" } };
        return html3(projectV3({
          info,
          entry: all.find((e) => e.slug === slug),
          forks: all.filter((e) => e.forkedFrom === slug),
          overview: await p.overview(),
          me: me.handle,
          runBase,
          liveHtml: "",
          view: m[3] === "about" ? "readme" : m[3] || null,
          tryAgent: url.searchParams.get("try") || void 0,
          ...st,
          docs: !m[3] || m[3] === "readme" || m[3] === "about" ? await docsOf(env, ctx, info, url.searchParams.get("doc")) : void 0,
          g: await globalOf(all),
          needsKey: own && !onSubscription(env, me.handle) && !(await userByHandle(env, me.handle))?.apiKeyEnc
        }));
      }
      if (m = path2.match(/^\/p\/([a-z0-9-]+)\/([a-z0-9-]+)\/(code|changes)(?:\/(.*))?$/)) {
        const info = await projectStub(env, slugOf(m[1], m[2])).info();
        if (!info) return new Response("No such project", { status: 404 });
        const r = m[3] === "changes" ? await changesRoute(env, ctx, info, decodeURIComponent(m[4] || ""), runBase) : await codeRoute(env, ctx, info, url.searchParams.get("v") || "", decodeURIComponent(m[4] || ""), runBase);
        if (views && (r.headers.get("content-type") || "").includes("text/html")) return html3(withTabs(await r.text(), info, me.handle, await globalOf()));
        return r;
      }
      if (m = path2.match(/^\/p\/([a-z0-9-]+)\/([a-z0-9-]+)\/?$/)) {
        const slug = slugOf(m[1], m[2]);
        const p = projectStub(env, slug);
        const info = await p.info();
        if (!info) return new Response("No such project", { status: 404 });
        const all = await listFor(env, me.handle, me.admin);
        const entry = all.find((e) => e.slug === slug);
        if (ui) return html3(projectV2(ui, {
          info,
          entry,
          forks: all.filter((e) => e.forkedFrom === slug),
          overview: await p.overview(),
          me: me.handle,
          runBase,
          liveHtml: info.owner === me.handle ? await renderAgents(env, info, runBase, ui) : "",
          needsKey: info.owner === me.handle && !onSubscription(env, me.handle) && !(await userByHandle(env, me.handle))?.apiKeyEnc
        }));
        return html3(projectPage({
          info,
          entry,
          forks: all.filter((e) => e.forkedFrom === slug),
          overview: await p.overview(),
          me: me.handle,
          runBase,
          agentsHtml: info.owner === me.handle ? await renderAgents(env, info, runBase) : "",
          needsKey: info.owner === me.handle && !onSubscription(env, me.handle) && !(await userByHandle(env, me.handle))?.apiKeyEnc
        }));
      }
      if (m = path2.match(/^\/a\/([a-z0-9.-]+--[a-z0-9]+)(\/.*)?$/)) {
        const id = m[1];
        const info = await projectStub(env, projectOf(id)).info();
        if (!info || info.owner !== me.handle && !me.admin) return json3({ error: "not your project" }, 403);
        return agentProxy(request, env, ctx, id, m[2] || "/", url, apiBase);
      }
      if (m = path2.match(/^\/api\/p\/([a-z0-9-]+)\/([a-z0-9-]+)(?:\/([a-z-]+))?$/)) {
        const [, owner, name, verb = ""] = m;
        const slug = slugOf(owner, name);
        const p = projectStub(env, slug);
        if (verb === "create" && request.method === "POST") {
          if (!me.admin) return json3({ error: "admin only" }, 403);
          const b = await request.json().catch(() => ({}));
          return json3(await p.create(owner, name, b.description || ""));
        }
        const info = await p.info();
        if (!info) return json3({ error: "no such project" }, 404);
        if (verb === "" && request.method === "GET") return json3(info);
        if (verb === "fork" && request.method === "POST") {
          if (info.owner === me.handle) return json3({ error: "this is already yours" }, 400);
          const tooMany = await overProjectLimit(env, me.handle);
          if (tooMany) return json3({ error: tooMany }, 400);
          let newName = info.name;
          for (let i = 2; await registry(env).get(slugOf(me.handle, newName)); i++) newName = `${info.name}-${i}`;
          if (!NAME_RE.test(newName)) return json3({ error: "name too long" }, 400);
          const fi = await projectStub(env, slugOf(me.handle, newName)).createFork(me.handle, newName, info);
          return json3({ ...fi, path: `/p/${fi.owner}/${fi.name}/changes` });
        }
        if (verb === "files") {
          const repo = versionRepo(info, url.searchParams.get("v") || "");
          if (!repo) return json3({ error: "unknown version" }, 404);
          const rev = await head(env, ctx, repo);
          if (!rev) return json3({ files: [] });
          const r = await allFiles(env, ctx, repo, rev.tree);
          return json3({ files: r.files.map((f) => f.path), truncated: r.truncated });
        }
        if (verb === "search") {
          const repo = versionRepo(info, url.searchParams.get("v") || "");
          if (!repo) return json3({ error: "unknown version" }, 404);
          const rev = await head(env, ctx, repo);
          if (!rev) return json3({ results: [] });
          return json3(await p.searchCode(repo, rev.tree, (url.searchParams.get("q") || "").slice(0, 200)));
        }
        if (verb === "git-token" && request.method === "POST") {
          if (!me.handle) return json3({ error: "Sign in first" }, 401);
          const mine = info.owner === me.handle;
          log("cli", "git_token", { slug, handle: me.handle, write: mine });
          return json3({ ...await p.gitToken(mine ? "write" : "read"), write: mine });
        }
        if (info.owner !== me.handle && !me.admin) return json3({ error: "not your project" }, 403);
        if (verb === "main-token" && request.method === "POST" && me.admin) return json3(await p.mainToken());
        if (verb === "visibility" && request.method === "POST") {
          const b = await request.json().catch(() => ({}));
          const ni = await p.setPrivate(!!b.private);
          return json3({ ok: true, private: !!ni.private });
        }
        if (verb === "entry" && request.method === "POST") {
          const b = await request.json();
          await p.setEntry(b.entry === null ? null : String(b.entry ?? ""));
          return json3({ ok: true, entry: (await p.info())?.entry });
        }
        if (verb === "touch" && request.method === "POST" && me.admin) {
          await registry(env).touch(slug);
          return json3({ ok: true });
        }
        if (verb === "agents-html") {
          ctx.waitUntil(startReview(env, p, slug, apiBase, () => p.requeueStale()));
        }
        if (verb === "agents-html" && ["a", "b", "c", "d"].includes(uiFor(request, env) || "")) {
          const st = await statusesOf(env, info);
          return json3({ html: liveV3(url.searchParams.get("view") || "changes", { info, me: me.handle, runBase, ...st, entry: void 0, forks: [], overview: { commits: [], files: [], readme: null }, liveHtml: "" }) });
        }
        if (verb === "agents-html") return json3({ html: await renderAgents(env, info, runBase, uiFor(request, env)), tabs: previewTabs(info, runBase) });
        if (verb === "agents" && request.method === "POST") {
          const b = await request.json();
          return json3(await spawn(env, ctx, slug, String(b.task || ""), apiBase));
        }
        if (verb === "router" && request.method === "POST") {
          const b = await request.json();
          const text = String(b.text || "").trim();
          if (!text || text.length > 8e3) return json3({ error: "say something (max 8000 chars)" }, 400);
          return json3(await askRouter(env, ctx, p, slug, text, apiBase));
        }
        if (verb === "deploy" && request.method === "POST") {
          const b = await request.json().catch(() => ({}));
          await p.requestBuild(b.agent ? "preview" : "deploy", b.agent);
          return json3({ ok: true });
        }
        if (verb === "build-state" && me.admin) return json3(await env.BuildBox.get(env.BuildBox.idFromName(`${slug}--build`)).state());
        if (verb === "reviewer-state" && request.method === "POST" && me.admin) {
          const rb = boxStub(env, `${slug}--review`);
          const awake = await rb.isAwake();
          const cc = awake ? await rb.ccStatus().catch(() => "unknown") : "asleep";
          return json3({ ok: true, awake, cc, idle: !awake || !/busy|thinking|working|running|tool|compact/i.test(cc) });
        }
        if (verb === "review-dispatch" && request.method === "POST" && me.admin) {
          const b = await request.json();
          const r = await dispatchReview(env, p, slug, apiBase, String(b.agent || ""));
          return json3(r, r.ok ? 200 : r.busy ? 409 : 502);
        }
        if (verb === "deliver" && request.method === "POST" && me.admin) {
          const b = await request.json();
          const r = await deliverToRouter(env, p, slug, Number(b.at), apiBase);
          return json3(r, r.ok ? 200 : 502);
        }
        if (verb === "review" && request.method === "POST") {
          const b = await request.json();
          if (!info.agents.some((x) => x.id === b.agent)) return json3({ error: "unknown agent" }, 404);
          await startReview(env, p, slug, apiBase, () => p.queueReview(b.agent));
          return json3({ ok: true });
        }
        if (verb === "fix" && request.method === "POST") {
          const b = await request.json();
          const a = info.agents.find((x) => x.id === b.agent);
          if (!a?.review?.notes) return json3({ error: "no review notes for that agent" }, 400);
          const r = await sendTo(env, a.id, `The reviewer asked for changes:

${a.review.notes}

Fix them, commit, push with \`git push origin HEAD\`, then run \`forq status pushed "<what you changed>"\`.`, apiBase);
          if (r.ok) {
            await p.markReviewSent(a.id);
            await p.setState(a.id, "working");
          }
          return json3(r, r.ok ? 200 : 502);
        }
        if (verb === "merge" && request.method === "POST") {
          const b = await request.json();
          const a = info.agents.find((x) => x.id === b.agent);
          if (!a) return json3({ error: "unknown agent" }, 404);
          return json3(await askRouter(env, ctx, p, slug, `Merge agent ${a.id} into the project's main line: run \`forq merge ${a.id}\` and tell me the result in one line.`, apiBase, `Merge ${a.id.split("--")[1]}`));
        }
      }
      if (m = path2.match(/^\/api\/agents\/([a-z0-9.-]+--[a-z0-9]+)\/([a-z]+)$/)) {
        const [, id, verb] = m;
        const info = await projectStub(env, projectOf(id)).info();
        if (!info || info.owner !== me.handle && !me.admin) return json3({ error: "not your project" }, 403);
        const box = boxStub(env, id);
        if (verb === "state") return json3({ ...await box.state(), ...await boxStatus(env, id, true) });
        if (verb === "conversation") {
          if (!await box.isAwake()) return json3({ asleep: true });
          ctx.waitUntil(box.touch(id).catch(() => {
          }));
          const [conv, cc] = await Promise.all([
            box.fetch(new Request("https://container/api/conversation?session=claude&tail=200", { headers: { "x-forq-port": "7681" } })),
            box.ccStatus().catch(() => "unknown")
          ]);
          if (conv.status === 404) return json3({ messages: [], status: cc });
          if (!conv.ok) return json3({ error: `conversation ${conv.status}` }, 502);
          const j = await conv.json();
          return json3({ messages: j.messages, status: cc });
        }
        if (request.method !== "POST") return json3({ error: "POST only" }, 405);
        if (verb === "wake") return json3(await wake(env, id, apiBase));
        if (verb === "stop") {
          await box.letGo("manual");
          return json3(await box.state());
        }
        if (verb === "send") {
          const { text } = await request.json();
          if (!text) return json3({ error: "text required" }, 400);
          return json3(await sendTo(env, id, text, apiBase));
        }
        if (verb === "exec" && me.admin) return json3(await box.adminExec(await request.text()));
        if (verb === "reset" && me.admin) {
          await box.destroy();
          return json3(await wake(env, id, apiBase));
        }
      }
      if (path2 === "/api/admin/delete" && request.method === "POST" && me.admin) {
        const b = await request.json();
        if (b.box) await boxStub(env, b.box).destroy();
        if (b.project) {
          const pi = await projectStub(env, b.project).info();
          const boxes = [...(pi?.agents || []).map((a) => a.id), `${b.project}--router`, `${b.project}--review`];
          await Promise.all(boxes.map((id) => boxStub(env, id).destroy().catch(() => {
          })));
          await projectStub(env, b.project).wipe();
        }
        const ok = b.repo ? await env.ARTIFACTS.delete(b.repo).catch((e) => String(e)) : null;
        return json3({ deleted: ok });
      }
      return json3({ error: "not found" }, 404);
    } catch (e) {
      log("api", "error", { path: path2, err: String(e), stack: e?.stack });
      return json3({ error: String(e?.message || e) }, 500);
    }
  }
};
var index_default = {
  async fetch(request, env, ctx) {
    request = fromFront(request, env);
    let res = await app.fetch(request, env, ctx);
    res = await withRunPasses(request, env, res);
    return isUiHost(env, new URL(request.url).hostname) ? withBaseline(request, env, res) : res;
  }
};
async function withRunPasses(request, env, res) {
  const url = new URL(request.url);
  const m = url.pathname.match(/^\/(?:api\/)?p\/([a-z0-9-]+)\/([a-z0-9-]+)(?:\/|$)/);
  const type = res.headers.get("content-type") || "";
  if (!m || res.status !== 200 || !(type.includes("text/html") || type.includes("json"))) return res;
  const slug = slugOf(m[1], m[2]);
  const e = await registry(env).get(slug);
  if (!e?.private) return res;
  const me = await who(request, env);
  if (!me || me.kind !== "user" || !canSee(e, me.handle, me.admin)) return res;
  const pass = await mintRunPass(env, slug);
  const run = env.RUN_HOST.replace(/\./g, "\\.");
  const host = `(?:(?:ag-[a-z0-9]+--)?${m[2]}--${m[1]}\\.${run}|${run}/${m[1]}\\.${m[2]}(?:--[a-z0-9]+)?)`;
  const re = new RegExp(`(https://${host}/[^"'\\\\\\s<>?#]*)(\\?[^"'\\\\\\s<>#]*)?`, "g");
  const text = (await res.text()).replace(re, (_x, base, q) => `${base}${q ? `${q}&` : "?"}__qb=${pass}`);
  const out = new Response(text, res);
  out.headers.delete("content-length");
  out.headers.set("cache-control", "private, no-store");
  return out;
}
__name(withRunPasses, "withRunPasses");
function fromFront(request, env) {
  const host = request.headers.get("x-qb-host");
  if (!host || !env.FRONT_SECRET || request.headers.get("x-qb-front") !== env.FRONT_SECRET || !frontHosts(env).includes(host)) return request;
  const url = new URL(request.url);
  url.hostname = host;
  const req = new Request(url, request);
  let cf2 = {};
  try {
    cf2 = JSON.parse(req.headers.get("x-qb-cf") || "{}");
  } catch {
  }
  const ip = req.headers.get("x-qb-ip");
  if (ip) req.headers.set("cf-connecting-ip", ip);
  for (const h of ["x-qb-front", "x-qb-host", "x-qb-cf", "x-qb-ip"]) req.headers.delete(h);
  Object.defineProperty(req, "cf", { value: cf2 });
  return req;
}
__name(fromFront, "fromFront");
function versionRepo(info, v) {
  if (!v) return info.repo;
  const a = info.agents.find((x) => x.id.split("--")[1] === v);
  return a ? a.fork : null;
}
__name(versionRepo, "versionRepo");
async function codeRoute(env, ctx, info, v, path2, runBase) {
  const repo = versionRepo(info, v);
  if (!repo) return new Response("No such version", { status: 404 });
  const rev = await head(env, ctx, repo).catch(() => null);
  if (!rev) return html3(dirPage({ info, v, path: "", entries: [], readme: null, rev: null }));
  const clean = path2.replace(/^\/+/, "");
  const e = await resolvePath(env, ctx, repo, rev.tree, clean);
  if (!e) return new Response(`${clean} is not in this version`, { status: 404 });
  if (e.type === "tree") {
    const dir = clean && !clean.endsWith("/") ? clean + "/" : clean;
    const entries = await tree(env, ctx, repo, e.hash);
    const rd = entries.find((x) => x.type === "blob" && /^readme(\.md|\.markdown)?$/i.test(x.name));
    const readme = rd ? (await blob(env, ctx, repo, rd.hash, rd.name)).text : null;
    return html3(dirPage({ info, v, path: dir, entries, readme, rev }));
  }
  const file = await blob(env, ctx, repo, e.hash, clean);
  return html3(filePage({ info, v, path: clean, file, rev, runUrl: runUrl(runBase, repo, clean) }));
}
__name(codeRoute, "codeRoute");
async function changesRoute(env, ctx, info, short, runBase) {
  const agent = info.agents.find((a) => a.id.split("--")[1] === short.replace(/\/$/, ""));
  if (!agent) return new Response("No such agent", { status: 404 });
  const base = agent.base || await forkBase(env, info.repo, agent.fork, agent.createdAt);
  const tip = await head(env, ctx, agent.fork);
  if (!base || !tip) return new Response("Could not find where this fork started", { status: 500 });
  const changes = await diffTrees(env, ctx, info.repo, base.tree, agent.fork, tip.tree);
  const CAP = 60;
  const withText = await Promise.all(changes.slice(0, CAP).map(async (c) => {
    const [a, b] = await Promise.all([
      c.oldHash ? blob(env, ctx, info.repo, c.oldHash, c.path) : null,
      c.newHash ? blob(env, ctx, agent.fork, c.newHash, c.path) : null
    ]);
    const odd = /* @__PURE__ */ __name((x) => x && (x.binary || x.tooBig), "odd");
    return {
      ...c,
      oldText: a?.text ?? null,
      newText: b?.text ?? null,
      note: odd(a) || odd(b) ? `${(a || b).binary ? "Binary" : "Large"} file, ${c.status}; not shown` : void 0
    };
  }));
  log("code", "changes", { agent: agent.id, files: changes.length, base: base.commit.slice(0, 8), tip: tip.commit.slice(0, 8) });
  return html3(changesPage({
    info,
    agent,
    changes: withText,
    baseNote: `Compared with main at ${base.commit.slice(0, 7)}, when it started${changes.length > CAP ? `; first ${CAP} of ${changes.length} files` : ""}`,
    previewUrl: runUrl(runBase, agent.fork, info.entry || "")
  }));
}
__name(changesRoute, "changesRoute");
var html3 = /* @__PURE__ */ __name((body) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }), "html");
async function askRouter(env, ctx, p, slug, text, apiBase, shown = text) {
  const at = Date.now();
  await p.setRequest({ text: shown, payload: text === shown ? void 0 : text, at, state: "waking", sentAt: void 0, error: void 0, attempts: 0 });
  await p.scheduleDelivery();
  return { ok: true, at };
}
__name(askRouter, "askRouter");
async function deliverToRouter(env, p, slug, at, apiBase) {
  const info = await p.info();
  const q = info?.lastRequest;
  if (!q || q.at !== at || q.state !== "waking") return { ok: true, skipped: "no pending request" };
  const r = await sendTo(env, `${slug}--router`, q.payload || q.text, apiBase);
  log("api", "router_send", { slug, ok: r.ok, ms: Date.now() - at, attempt: q.attempts, err: r.error });
  if (r.ok) await p.setRequest({ state: "sent", sentAt: Date.now() });
  return r;
}
__name(deliverToRouter, "deliverToRouter");
async function startReview(env, p, slug, apiBase, step, deferred = false) {
  try {
    const next = await step();
    if (!next) return;
    void deferred;
    await p.scheduleReviewDispatch(next);
  } catch (e) {
    log("review", "failed", { slug, err: String(e), stack: e?.stack });
  }
}
__name(startReview, "startReview");
async function dispatchReview(env, p, slug, apiBase, next) {
  try {
    const info = await p.info();
    const ag = info?.agents.find((x) => x.id === next);
    const tip = ag ? await head(env, { waitUntil() {
    }, passThroughOnException() {
    } }, ag.fork).catch(() => null) : null;
    const rbox = boxStub(env, `${slug}--review`);
    if (await rbox.isAwake()) {
      const cc = await rbox.ccStatus().catch(() => "unknown");
      if (/busy|thinking|working|running|tool|compact/i.test(cc)) return { ok: false, busy: true, error: `reviewer is ${cc}` };
    } else await wake(env, `${slug}--review`, apiBase).catch(() => null);
    await rbox.clearContext().catch(() => false);
    const text = [
      `Review agent ${next}${tip ? ` at commit ${tip.commit.slice(0, 7)} ("${tip.message}")` : ""}. This is a new review: ignore any earlier review of this agent.`,
      ag?.note ? `The agent reports: ${ag.note}` : "",
      `You are the reviewer agent of this project (${slug.replace(".", "/")}). The agent id is ${next}.`,
      ...REVIEW_STEPS.map((x) => x.replaceAll("<agent-id>", next))
    ].filter(Boolean).join("\n\n");
    let r = await sendTo(env, `${slug}--review`, text, apiBase);
    if (r.ok) {
      let started = false;
      for (let i = 0; i < 8 && !started; i++) {
        await new Promise((res) => setTimeout(res, 2e3));
        started = /busy|thinking|working|running|tool/i.test(await rbox.ccStatus().catch(() => ""));
      }
      if (!started) {
        log("review", "resend", { slug, agent: next });
        r = await sendTo(env, `${slug}--review`, text, apiBase);
      }
    }
    log("review", "dispatched", { slug, agent: next, ok: r.ok, err: r.error });
    if (!r.ok) await p.setVerdict(next, "changes", `The reviewer could not start: ${r.error}. Review it yourself, or push again to retry.`);
    return r;
  } catch (e) {
    log("review", "dispatch_failed", { slug, err: String(e), stack: e?.stack });
    return { ok: false, error: String(e) };
  }
}
__name(dispatchReview, "dispatchReview");
async function issuesHook(request, env, ctx) {
  if (!env.ISSUES_WEBHOOK_SECRET || request.headers.get("cf-webhook-auth") !== env.ISSUES_WEBHOOK_SECRET) {
    log("issues", "rejected", { hasHeader: request.headers.has("cf-webhook-auth") });
    return json3({ error: "unauthorized" }, 401);
  }
  const raw = await request.text();
  let body = {};
  try {
    body = JSON.parse(raw);
  } catch {
    body = { text: raw };
  }
  log("issues", "received", { bytes: raw.length, keys: Object.keys(body), payload: raw.slice(0, 4e3) });
  const worker = (raw.match(/forq-app-[a-z0-9-]+/) || [])[0];
  if (!worker) {
    log("issues", "no_worker", {});
    return json3({ ok: true, ignored: "no forq-app worker named (a test message?)" });
  }
  const entries = await registry(env).list();
  const e = entries.find((x) => appWorkerName(x.slug) === worker);
  if (!e) {
    log("issues", "unknown_worker", { worker });
    return json3({ ok: true, ignored: `no project deploys as ${worker}` });
  }
  const p = projectStub(env, e.slug);
  const text = String(body.text || body.data?.text || body.message || raw).slice(0, 3e3);
  const title = (text.split("\n").find((l) => l.trim()) || "an error").slice(0, 140);
  const issueId = (text.match(/Issue ID: ([0-9a-f-]{36})/) || [])[1];
  const occ = issueId ? await issueOccurrences(env, issueId) : null;
  const info = await p.info();
  const live = info?.app?.url || `(not deployed yet; Worker ${worker})`;
  const ask = [
    `Cloudflare Issues reported a production error in this project's live app (Worker ${worker}, live at ${live}):`,
    text.split("\n\nAI-assisted investigation")[0],
    occ ? `The failing requests, from the issue's occurrences (dynamic path parts are shown as REDACTED by Cloudflare):
${occ}` : "The occurrences could not be fetched.",
    `First reproduce it: send the SAME request to the live URL with curl (same method, path and headers as above; a plain GET is not a WebSocket upgrade), trying realistic values where the path says REDACTED, until you get the same status, and read the response body. Only then decide the cause from the code. If you cannot reproduce it, say so rather than picking a theory. Start one agent with \`forq spawn\` to fix it, giving it the exact failing request, what the response showed, and the cause. If an agent is already working on this error with a different theory, tell it with \`forq send\`. Reply with one line saying what you found and did.`
  ].join("\n\n");
  const r = await askRouter(env, ctx, p, e.slug, ask, env.API_BASE, `Production error from Cloudflare Issues: ${title}`);
  log("issues", "routed", { worker, slug: e.slug });
  return json3({ routed: e.slug, ...r });
}
__name(issuesHook, "issuesHook");
async function issueOccurrences(env, issueId) {
  if (!env.OBS_READ_TOKEN) return null;
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/workers/observability/issues/${issueId}/occurrences`, {
      headers: { authorization: `Bearer ${env.OBS_READ_TOKEN}` }
    });
    const j = await r.json();
    if (!r.ok || !j.result) {
      log("issues", "occurrences_failed", { issueId, status: r.status });
      return null;
    }
    const groups = /* @__PURE__ */ new Map();
    for (const o of j.result.slice(0, 50)) {
      const h = o.request?.headers || {};
      const how = [h["user-agent"] ? `user-agent ${h["user-agent"]}` : null, h.upgrade ? `Upgrade: ${h.upgrade}` : "no Upgrade header"].filter(Boolean).join(", ");
      const k2 = `${o.invocation?.method || "?"} ${o.invocation?.path || o.invocation?.url || "?"} \u2192 ${o.invocation?.statusCode ?? "?"} (${o.error?.name || "error"}: ${o.error?.message || ""}${o.error?.handled === false ? ", unhandled" : ""}; ${how})`;
      groups.set(k2, (groups.get(k2) || 0) + 1);
    }
    const trail = j.result.flatMap((o) => (o.trail || []).map((t) => typeof t === "string" ? t : JSON.stringify(t))).slice(0, 10);
    return [...groups].map(([k2, n]) => `- ${n}\xD7 ${k2}`).join("\n") + (trail.length ? `
Trail:
${trail.join("\n")}` : "");
  } catch (e) {
    log("issues", "occurrences_error", { issueId, err: String(e) });
    return null;
  }
}
__name(issueOccurrences, "issueOccurrences");
async function overProjectLimit(env, handle) {
  if (isOwner(env, handle)) return null;
  const n = (await registry(env).list()).filter((e) => e.owner === handle).length;
  return n >= 10 ? "You have 10 projects, the limit for now. Self-host qodebase for more." : null;
}
__name(overProjectLimit, "overProjectLimit");
async function spawn(env, ctx, slug, task, apiBase) {
  task = task.trim();
  if (!task || task.length > 4e3) throw new Error("task required (max 4000 chars)");
  const agent = await projectStub(env, slug).addAgent(task);
  ctx.waitUntil(wake(env, agent.id, apiBase).then((r) => log("api", "agent_boot", { id: agent.id, ...r })).catch((e) => log("api", "agent_boot_failed", { id: agent.id, err: String(e), stack: e?.stack })));
  return agent;
}
__name(spawn, "spawn");
async function agentApi(request, env, ctx, me, url, apiBase) {
  const slug = projectOf(me.agentId);
  const p = projectStub(env, slug);
  const verb = url.pathname.replace(/^\/api\/agent\//, "");
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
  if (verb === "mobile-agent.tgz") {
    return new Response(MA_TGZ, { headers: { "content-type": "application/gzip", "x-forq-ma-rev": MA_REV.trim() } });
  }
  log("agent_api", verb, { agentId: me.agentId });
  ctx.waitUntil(boxStub(env, me.agentId).touch(me.agentId).catch(() => {
  }));
  if (verb === "list") {
    const info = await p.info();
    return json3({ agents: (info?.agents || []).map(({ id, task, state, note }) => ({ id, task, state, note })) });
  }
  if (verb === "status" && me.role === "agent") {
    if (!["working", "pushed", "blocked"].includes(body.state)) return json3({ error: "state: working|pushed|blocked" }, 400);
    await p.setState(me.agentId, body.state, String(body.note || ""));
    if (body.state === "pushed") {
      const ownerDeploys = isOwner(env, slug.split(".")[0]);
      if (await p.kindOf() === "worker" && ownerDeploys) ctx.waitUntil(p.requestBuild("preview", me.agentId).catch((e) => log("build", "request_failed", { err: String(e) })));
      else await startReview(env, p, slug, apiBase, () => p.queueReview(me.agentId));
    }
    return json3({ ok: true });
  }
  if (me.role === "reviewer") {
    if (verb === "review-info") {
      const agent = url.searchParams.get("agent") || "";
      if (projectOf(agent) !== slug) return json3({ error: "not an agent of this project" }, 400);
      const r = await p.reviewInfo(agent);
      return json3({ ...r, preview: r.previewUrl || `https://${env.RUN_HOST}/${agent}/${r.entry}` });
    }
    if (verb === "verdict") {
      if (projectOf(body.agent || "") !== slug) return json3({ error: "not an agent of this project" }, 400);
      if (!["approve", "changes"].includes(body.verdict)) return json3({ error: "verdict: approve|changes" }, 400);
      const info = await p.info();
      const ag = info?.agents.find((x) => x.id === body.agent);
      const tip = ag ? await head(env, ctx, ag.fork).catch(() => null) : null;
      if (tip && body.commit && tip.commit !== body.commit) {
        log("review", "stale_verdict", { agent: body.agent, reviewed: String(body.commit).slice(0, 8), latest: tip.commit.slice(0, 8) });
        return json3({ error: `you reviewed ${String(body.commit).slice(0, 7)} but the agent's latest push is ${tip.commit.slice(0, 7)}: run \`forq fetch-agent ${body.agent}\` and review again` }, 409);
      }
      await startReview(env, p, slug, apiBase, () => p.setVerdict(body.agent, body.verdict === "approve" ? "approved" : "changes", String(body.notes || "")), true);
      return json3({ ok: true });
    }
    return json3({ error: "the reviewer can fetch-agent and verdict" }, 403);
  }
  if (me.role !== "router") return json3({ error: "only the router agent can do that" }, 403);
  if (verb === "spawn") {
    return json3(await spawn(env, ctx, slug, String(body.task || ""), apiBase));
  }
  if (verb === "send") {
    if (projectOf(body.agent || "") !== slug) return json3({ error: "not an agent of this project" }, 400);
    return json3(await sendTo(env, body.agent, String(body.text || ""), apiBase));
  }
  if (verb === "merge-info") {
    const agent = url.searchParams.get("agent") || "";
    if (projectOf(agent) !== slug) return json3({ error: "not an agent of this project" }, 400);
    return json3(await p.forkForMerge(agent));
  }
  if (verb === "merged") {
    if (projectOf(body.agent || "") !== slug) return json3({ error: "not an agent of this project" }, 400);
    await p.setState(body.agent, "merged");
    if (await p.kindOf() === "worker") ctx.waitUntil(p.requestBuild("deploy").catch((e) => log("build", "request_failed", { err: String(e) })));
    return json3({ ok: true });
  }
  return json3({ error: "unknown verb" }, 404);
}
__name(agentApi, "agentApi");
async function agentProxy(request, env, ctx, agentId, rest, url, apiBase) {
  if (rest === "/" || rest === "/agent") return Response.redirect(`${url.origin}/a/${agentId}/agent/${url.search}`, 302);
  if (!rest.startsWith("/agent/")) return json3({ error: "not found" }, 404);
  const sub = rest.slice("/agent".length);
  const box = boxStub(env, agentId);
  ctx.waitUntil(box.touch(agentId).catch(() => {
  }));
  const origin = request.headers.get("origin");
  const fwd = new Request(request);
  if (origin && isUiHost(env, new URL(origin).hostname)) fwd.headers.set("origin", `https://${env.UI_HOST}`);
  const proxy = /* @__PURE__ */ __name(() => box.fetch(new Request(`https://container${sub}${url.search}`, fwd)), "proxy");
  const isWs = (request.headers.get("upgrade") || "").toLowerCase() === "websocket";
  const isDoc = request.method === "GET" && !isWs && (request.headers.get("accept") || "").includes("text/html");
  if (await box.isAwake()) {
    try {
      const r = await proxy();
      if (r.status === 101 || r.status < 500) return r;
    } catch (e) {
      log("proxy", "failed", { agentId, sub, err: String(e) });
    }
  }
  if (!isDoc) return new Response("starting", { status: 503, headers: { "retry-after": "2" } });
  const booting = wake(env, agentId, apiBase);
  ctx.waitUntil(booting.then((b) => log("proxy", "boot", { agentId, ...b })).catch((e) => log("proxy", "boot_failed", { agentId, err: String(e) })));
  const done = await Promise.race([booting, new Promise((r) => setTimeout(() => r(null), INLINE_BOOT_MS))]);
  if (done?.ok) {
    const r = await proxy();
    if (r.status < 500) return r;
  }
  return startingPage(agentId, done && !done.ok ? done.error : void 0);
}
__name(agentProxy, "agentProxy");
export {
  AgentBox,
  BuildBox,
  Installs,
  Project,
  Registry,
  TalkLog,
  index_default as default
};
//# sourceMappingURL=index.js.map
