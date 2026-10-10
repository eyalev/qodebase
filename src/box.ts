// AgentBox — one agent's container: Claude Code working in a clone of its own
// Artifacts fork. A slim copy of opendev's Computer2 (computer-next/src/
// computer2.ts): same image, same boot.sh, snapshot on stop, idle stop.
// Read that file's comments for the why behind each lifecycle detail.
//
// Secrets (Claude token, Artifacts token) live in /run/forq (tmpfs; snapshots
// skip mounts). git reads the Artifacts token through a credential helper, so
// .git/config never holds it.

import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';
import { FORQ_CLI } from './cli';
import { registry } from './registry';
import { boxUsd, claudeUsd, recordCost, type Tokens } from './costs';
// The image's own files, for boxes that set themselves up (BOX_IMAGE=managed).
import BOOT_SH from '../box/boot.sh';
import BOX_API from '../box/box-api.mjs';

const MA_PORT = 7901;
const TW_PORT = 7681;
const IDLE_MS = 5 * 60_000;
const BUSY_MAX_MS = 4 * 60 * 60_000;
const ALARM_EVERY_MS = 60_000;
const SNAPSHOT_EVERY_MS = 15 * 60_000;
const INACTIVITY_BACKSTOP_MS = 45 * 60_000;
const INSTANCE = { vcpu: 1, memoryMib: 3072, diskMb: 6144 };   // disk <= 2x memory: Cloudflare refuses more (seen 2026-10-08 16:53)
/** Shell: exit 0 if Claude Code's input box is empty. The line just above the
 *  pane's last horizontal rule is the input's last line: a bare "❯" when empty.
 *  (A tall input pushes its top rule off screen, so do not look for two rules.) */
const INPUT_EMPTY_SH = String.raw`tmux capture-pane -p -t claude | python3 -c "
import sys
L=[l.rstrip() for l in sys.stdin.read().splitlines()]
r=[i for i,l in enumerate(L) if l.startswith(chr(0x2500)*10)]
above=[l for l in (L[:r[-1]] if r else []) if l.strip()]
last=above[-1].strip() if above else ''
sys.exit(0 if last in (chr(0x276f), '') else 1)
"`;

const ENTRYPOINT = ['/bin/bash', '-c', 'chown 0:0 / 2>/dev/null; mkdir -p /workspace /run/opendev /run/forq && chmod 700 /run/opendev /run/forq && exec sleep infinity'];
export const REPO_DIR = '/workspace/repo';

export function log(module: string, event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), module, event, ...fields }));
}

type Snap = { id: string; size: number; name?: string };

// ---- managed boxes (a self-hosted copy: no registry image in its account) ----------------
// The box starts from Cloudflare's cloudflare/debian-trixie (Node 24) and installs what
// box/Dockerfile bakes in: apt tools, Claude Code, mobile-agent (public repo, pinned),
// /opt/boot.sh and /opt/box-api.mjs. The first box to finish snapshots that as the
// instance's base (Registry 'baseSnap'); every later box starts from it. Bump SETUP_V
// when the script changes: old bases are then ignored. Chromium (the reviewer's phone
// screenshots) is left out of v1: 300 MB more per base.
const MANAGED_IMAGE = 'cloudflare/debian-trixie';
const SETUP_V = 1;
const MA_BASE_REF = '9aa1a4d82a79';
const MANAGED_SETUP = String.raw`set -e
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
export type BootSpec = {
  agentId: string;
  task: string;         // '' for the router and the reviewer
  role: 'agent' | 'router' | 'reviewer' | 'ask';  // router: main, merges; reviewer: main read-only, reviews pushes; ask: main read-only, answers questions
  project: string;      // owner/name, for prompts
  remote: string;       // fork's (or main's) git remote
  gitToken: string;     // write token for that repo (art_v2_…?expires=…)
  agentToken: string;   // signs this box's /api/agent/* calls
  apiBase: string;      // where the forq CLI calls
  uiHost: string;       // the public UI host (mobile-agent's allowed origin)
  maRev: string;        // mobile-agent version to unpack over the image's copy
  bootEnv: string;      // boot.sh env (SBX_NAME, CC_ENV, …)
  billing?: 'sub' | 'api';   // whose Claude: a subscription (tokens only) or an API key (dollars)
  costCovered?: boolean;     // the boxes bill this instance's owner, not the person (hosted qodebase)
  board?: boolean;           // the agent board is on (landing flag): Claude Code hooks call `forq hook`
};
export type BootResult = { ok: boolean; ms: number; from: string; error?: string };

export class AgentBox extends DurableObject<Env> {
  #booting: Promise<BootResult> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const c = ctx.container as any;
    if (c?.running) {
      void ctx.blockConcurrencyWhile(async () => {
        await c.setInactivityTimeout(INACTIVITY_BACKSTOP_MS);
        if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now() + ALARM_EVERY_MS);
        log('box', 'rearmed_after_restart');
      });
    }
  }

  private get c() {
    const c = this.ctx.container;
    if (!c) throw new Error('DO is not container-enabled (check wrangler.jsonc)');
    return c as any;
  }

  /** The image a fresh box starts from: forq's registry image, or Cloudflare's managed one. */
  #image(): string {
    return this.env.BOX_IMAGE === 'managed' ? MANAGED_IMAGE : this.c.images.computer;
  }

  /** Managed boxes: install what the image would have (MANAGED_SETUP), in the background,
   *  polled with short execs; then make it the instance's base snapshot if there is none. */
  async #setup(agentId: string): Promise<{ ok: boolean; error?: string }> {
    const t0 = Date.now();
    const have = await this.#sh('cat /opt/forq-ready 2>/dev/null');
    if (have.stdout.trim() === String(SETUP_V)) return { ok: true };
    await this.#sh('(setsid bash -c "$SETUP" > /tmp/forq-setup.log 2>&1 < /dev/null &)', { SETUP: MANAGED_SETUP, BOOT_SH, BOX_API, MA_BASE_REF, SETUP_V: String(SETUP_V) });
    log('box', 'setup_started', { agentId });
    for (let i = 0; i < 200; i++) {   // up to ~10 min
      await new Promise((r) => setTimeout(r, 3000));
      const st = await this.#sh('if [ -f /opt/forq-ready ]; then echo ready; elif [ -f /opt/forq-setup-failed ]; then echo failed; tail -15 /tmp/forq-setup.log /tmp/forq-npm.log /tmp/forq-ma-npm.log 2>/dev/null; else echo working; fi');
      const out = st.stdout.trim();
      if (out.startsWith('ready')) {
        log('box', 'setup_done', { agentId, ms: Date.now() - t0 });
        if (!(await registry(this.env).getBaseSnap(SETUP_V))) {
          try {
            const snap = await this.c.snapshotContainer({ name: `base-v${SETUP_V}` }) as Snap;
            await registry(this.env).setBaseSnap({ snap, v: SETUP_V });
            log('box', 'base_snapshot', { agentId, id: snap.id, sizeMB: Math.round(snap.size / 1e6) });
          } catch (e) { log('box', 'base_snapshot_failed', { agentId, err: String(e) }); }
        }
        return { ok: true };
      }
      if (out.startsWith('failed')) {
        log('box', 'setup_failed', { agentId, ms: Date.now() - t0, tail: out.slice(-1500) });
        return { ok: false, error: `box setup failed: ${out.slice(6, 400).trim()}` };
      }
    }
    log('box', 'setup_timeout', { agentId });
    return { ok: false, error: 'box setup took over 10 minutes' };
  }

  async #sh(cmd: string, env: Record<string, string> = {}) {
    const p = await this.c.exec(['bash', '-c', cmd], { env });
    const o = await p.output();
    const dec = new TextDecoder();
    return { exitCode: o.exitCode as number, stdout: dec.decode(o.stdout), stderr: dec.decode(o.stderr) };
  }

  async #maUp(): Promise<boolean> {
    if (!this.c.running) return false;
    try {
      const r = await this.c.getTcpPort(MA_PORT).fetch('http://container/', { signal: AbortSignal.timeout(3000) });
      return r.status < 500;
    } catch { return false; }
  }

  async isAwake(): Promise<boolean> { return !!this.ctx.container?.running; }

  /** For the page's progress line: is it booting, and has its task gone in yet? */
  async phase(): Promise<{ awake: boolean; booting: boolean; taskSent: boolean }> {
    return { awake: !!this.ctx.container?.running, booting: !!this.#booting, taskSent: !!(await this.ctx.storage.get<boolean>('taskSent')) };
  }

  async touch(agentId: string): Promise<void> {
    await this.ctx.storage.put('lastActive', Date.now());
    await this.ctx.storage.put('agentId', agentId);
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + ALARM_EVERY_MS);
  }

  ensureUp(spec: BootSpec) {
    if (!this.#booting) this.#booting = this.#boot(spec).finally(() => { this.#booting = null; });
    return this.#booting;
  }

  async #boot(spec: BootSpec): Promise<BootResult> {
    const t0 = Date.now();
    await this.touch(spec.agentId);
    if (await this.#maUp()) return { ok: true, ms: 0, from: 'running' };

    let from = 'running';
    if (!this.c.running) {
      const snap = await this.ctx.storage.get<Snap>('snapshot');
      const managed = this.env.BOX_IMAGE === 'managed';
      // A managed box with no snapshot of its own starts from the instance's base.
      const base = !snap && managed ? await registry(this.env).getBaseSnap(SETUP_V) : null;
      from = snap ? 'snapshot' : base ? 'base' : 'image';
      try {
        this.c.start({
          instance: INSTANCE, enableInternet: true, entrypoint: ENTRYPOINT,
          ...(snap ? { containerSnapshot: snap } : base ? { containerSnapshot: base } : { image: this.#image() }),
        });
        await this.#sh('true');
      } catch (e) {
        if (base) await registry(this.env).setBaseSnap(null);   // expired (30 days unused) or gone: set up from the image
        log('box', 'start_failed', { agentId: spec.agentId, from, snapshot: snap?.id, err: String(e), stack: (e as Error)?.stack });
        if (!snap && !base) return { ok: false, ms: Date.now() - t0, from, error: String(e) };
        if (snap) {
          const lost = (await this.ctx.storage.get<Snap[]>('failedSnapshots')) || [];
          lost.push(snap);
          await this.ctx.storage.put('failedSnapshots', lost);
          await this.ctx.storage.delete('snapshot');
        }
        try { if (this.c.running) await this.c.destroy(); } catch {}
        from = 'image-after-failed-restore';
        this.c.start({ instance: INSTANCE, enableInternet: true, entrypoint: ENTRYPOINT, image: this.#image() });
        await this.#sh('true');
      }
      await this.c.setInactivityTimeout(INACTIVITY_BACKSTOP_MS);
      this.#watchExit(spec.agentId, from);
      // Costs (src/costs.ts): a container that died without letGo (a forq deploy kills it)
      // still bills its awake time, up to the last minute the alarm saw it alive.
      const st = await this.ctx.storage.get(['costFrom', 'aliveAt', 'costOwner', 'costProject', 'costCovered']);
      const lostFrom = st.get('costFrom') as number | undefined, aliveAt = st.get('aliveAt') as number | undefined;
      if (lostFrom && aliveAt && aliveAt > lostFrom && st.get('costOwner')) {
        const sec = (aliveAt - lostFrom) / 1000;
        await recordCost(this.env, st.get('costOwner') as string, 'boxes', (st.get('costProject') as string) || '', { usd: boxUsd(sec, 0, INSTANCE.memoryMib / 1024, INSTANCE.diskMb / 1000), covered: !!st.get('costCovered'), seconds: sec });
        log('box', 'costs_recovered', { agentId: spec.agentId, seconds: Math.round(sec) });
      }
      // Awake time and CPU from now; Claude tokens since the last read (cursor kept).
      await this.ctx.storage.put({ costFrom: Date.now(), aliveAt: Date.now(), cpuLast: 0, costOwner: spec.project.split('/')[0], costProject: spec.project, costBilling: spec.billing || 'api', costCovered: !!spec.costCovered });
    }

    // 0. Managed boxes set themselves up once (a restored snapshot or base already is).
    if (this.env.BOX_IMAGE === 'managed') {
      const st = await this.#setup(spec.agentId);
      if (!st.ok) return { ok: false, ms: Date.now() - t0, from, error: st.error };
    }

    // 1. Repo: credential helper reads the token from tmpfs; clone once (a
    //    restored snapshot already has the clone and its commits).
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
      # The agent board (src/landing/board.ts): Claude Code hooks post edits and commits and read the
      # board into the context. Only while the project's board flag is on; removed again when it is off.
      mkdir -p /workspace/.claude
      python3 - "$BOARD" <<'PY'
import json, sys
p = '/workspace/.claude/settings.json'
try: d = json.load(open(p))
except Exception: d = {}
h = {'type': 'command', 'command': 'forq hook', 'timeout': 6}
hooks = {'UserPromptSubmit': [{'hooks': [h]}], 'PreToolUse': [{'matcher': 'Edit|Write|MultiEdit', 'hooks': [h]}], 'PostToolUse': [{'matcher': 'Bash', 'hooks': [h]}]}
if sys.argv[1] == '1': d['hooks'] = hooks
elif 'forq hook' in json.dumps(d.get('hooks', {})): d.pop('hooks', None)
json.dump(d, open(p, 'w'))
PY
      # An empty repo (a self-hosted copy's Build starts empty) has no commit to show yet.
      git -C ${REPO_DIR} log --oneline -1 2>/dev/null || echo '(empty repository)'`, { GIT_TOKEN: spec.gitToken, REMOTE: spec.remote, AGENT_ID: spec.agentId, UI_HOST: spec.uiHost,
        AGENT_TOKEN: spec.agentToken, API_BASE: spec.apiBase, FORQ_CLI, BOARD: spec.board && (spec.role === 'agent' || spec.role === 'router') ? '1' : '0' });
    log('box', 'repo_ready', { agentId: spec.agentId, exit: repo.exitCode, head: repo.stdout.trim().slice(-80), err: repo.stderr.slice(-300) });
    if (repo.exitCode !== 0) return { ok: false, ms: Date.now() - t0, from, error: `clone failed: ${repo.stderr.slice(-200)}` };

    // 1b. mobile-agent newer than the image's: unpack forq's copy over
    //     /opt/mobile-agent (the image's node_modules stay; pack-mobile-agent.sh
    //     refuses a dependency change), once per version. It brings ?ui=minimal,
    //     which the sheet's Terminal tab uses. A failure keeps the image's copy.
    const ma = await this.#sh(`set -e
      [ "$(cat /opt/mobile-agent/.forq-rev 2>/dev/null)" = "$MA_REV" ] && { echo current; exit 0; }
      curl -sfS --max-time 30 -A forq-cli/1 -H "x-forq-agent: $(cat /run/forq/agent-token)" "$(cat /run/forq/api)/api/agent/mobile-agent.tgz" -o /tmp/ma.tgz
      tar xzf /tmp/ma.tgz -C /opt/mobile-agent && rm -f /tmp/ma.tgz
      printf '%s' "$MA_REV" > /opt/mobile-agent/.forq-rev && echo updated`, { MA_REV: spec.maRev });
    log('box', 'mobile_agent', { agentId: spec.agentId, rev: spec.maRev, exit: ma.exitCode, out: ma.stdout.trim().slice(-40), err: ma.stderr.slice(-200) });

    // 2. The image's boot.sh, with mobile-agent's allowed origin pointed at
    //    forq instead of opendev.page. Polled through its log (sidecars keep
    //    its stdout open).
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
    const ok = boot.stdout.trim().endsWith('1');
    log('box', 'booted', { agentId: spec.agentId, from, ok, ms: Date.now() - t0, tail: ok ? undefined : boot.stdout.slice(-300) + boot.stderr.slice(-300) });
    if (!ok) return { ok, ms: Date.now() - t0, from, error: 'boot.sh did not report MA_READY' };

    // 3. First boot only: hand Claude Code its task.
    // The ask box (role 'ask', src/box.ts askQueue) has no task: it only answers questions.
    if (spec.role !== 'ask' && !(await this.ctx.storage.get<boolean>('taskSent'))) {
      const sent = await this.send(taskPrompt(spec));
      log('box', 'task_sent', { agentId: spec.agentId, ok: sent.ok, err: sent.error });
      if (sent.ok) await this.ctx.storage.put('taskSent', true);
    }
    return { ok: true, ms: Date.now() - t0, from };
  }

  /** Type a message into the box's Claude Code (via the in-box tmux-web). */
  async send(text: string): Promise<{ ok: boolean; error?: string }> {
    // Never type into a bare shell: if Claude Code has exited, the pane is
    // bash and the text would run as commands (it did once, 2026-10-01).
    // boot.sh runs claude inside a subshell, so tmux's pane_current_command
    // says "bash" either way; look for the claude process itself.
    const alive = await this.#sh(`pgrep -x claude >/dev/null`);
    if (alive.exitCode !== 0) {
      log('box', 'send_refused', { why: 'no claude process' });
      return { ok: false, error: 'Claude Code is not running in the pane' };
    }
    const status = await this.ccStatus();
    if (status === 'untrusted') return { ok: false, error: 'Claude Code is waiting on its folder-trust prompt' };
    // Wait for Claude Code's ready prompt: text typed while it is still starting
    // (a box booted from a snapshot one second earlier) is silently lost, and the
    // empty input then looks like a submitted message (tipsplit's router, 2026-10-02).
    const ready = await this.#sh(`for i in $(seq 1 30); do tmux capture-pane -p -t claude | grep -q '^❯' && tmux capture-pane -p -t claude | grep -qE 'for shortcuts|auto mode|shift\\+tab' && exit 0; sleep 0.5; done; exit 1`);
    if (ready.exitCode !== 0) log('box', 'send_not_ready', { agentId: await this.ctx.storage.get<string>('agentId') });
    const REPLIES = `tmux capture-pane -p -S - -t claude | grep -c '^● '`;
    const before = Number((await this.#sh(REPLIES).catch(() => null))?.stdout.trim() || 0);
    const r = await this.c.getTcpPort(TW_PORT).fetch('http://container/api/conversation/send', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: 'claude', text, delay: text.includes('\n') ? 1500 : 500 }),
    });
    if (!r.ok) return { ok: false, error: `${r.status} ${(await r.text()).slice(0, 200)}` };
    // Confirm it was submitted, not left in the input box: an Enter landing
    // while Claude Code was still settling (after /clear) left a review request
    // typed but unsent (2026-10-01). If the prompt still holds text and Claude
    // Code is not working, press Enter again (twice at most).
    const check = await this.#sh(`set +e
      for i in 1 2 3 4 5 6; do
        sleep 1
        ${INPUT_EMPTY_SH} && { echo submitted; exit 0; }
        if [ $i -eq 3 ] || [ $i -eq 5 ]; then tmux send-keys -t claude Enter; echo enter; fi
      done
      echo unsent`);
    const outcome = check.stdout.trim().split('\n');
    if (outcome.includes('enter')) log('box', 'send_extra_enter', { agentId: await this.ctx.storage.get<string>('agentId'), outcome: outcome.join(',') });
    if (outcome.includes('unsent')) {
      // The input check has misread a working pane as unsent (xfcio's review,
      // 2026-10-02). If Claude Code is working, the message went in.
      const st = await this.ccStatus();
      const pane = await this.#sh(`tmux capture-pane -p -t claude | tail -14`).catch(() => null);
      log('box', 'send_unsent', { agentId: await this.ctx.storage.get<string>('agentId'), cc: st, pane: pane?.stdout });
      if (/busy|thinking|working|running|tool|compact/i.test(st)) return { ok: true };
      return { ok: false, error: 'typed but not submitted (still in the input box)' };
    }
    // An empty input is not proof: the text may never have arrived. Delivered
    // means Claude Code started working on it.
    // A short message can be answered within a second, between two samples, so
    // a new reply bullet (●) counts as started too.
    for (let i = 0; i < 15; i++) {
      if (/busy|thinking|working|running|tool|compact/i.test(await this.ccStatus())) return { ok: true };
      if (Number((await this.#sh(REPLIES).catch(() => null))?.stdout.trim() || 0) > before) return { ok: true };
      await new Promise((res) => setTimeout(res, 1000));
    }
    const pane = await this.#sh(`tmux capture-pane -p -t claude | tail -14`).catch(() => null);
    log('box', 'send_not_started', { agentId: await this.ctx.storage.get<string>('agentId'), pane: pane?.stdout });
    return { ok: false, error: 'Claude Code did not start working on the message' };
  }

  /** Start Claude Code on a fresh conversation (/clear). Typing "/clear" opens
   *  the slash-command menu and the first Enter only picks the entry, so this
   *  presses Enter again while the input still holds the command. */
  async clearContext(): Promise<boolean> {
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
        if ! tmux capture-pane -p -t claude | grep -q '^❯ /clear'; then
          # Settle: text typed while Claude Code is still finishing /clear is
          # lost (a review request vanished this way, 2026-10-01). Wait for the
          # empty prompt and its hint line before anyone types.
          for j in $(seq 1 20); do
            tmux capture-pane -p -t claude | grep -q '^❯ *$' && tmux capture-pane -p -t claude | grep -qE 'for shortcuts|auto mode|shift\\+tab' && { sleep 1; exit 0; }
            sleep 0.5
          done
          exit 0
        fi
      done
      exit 4`);
    log('box', 'clear_context', { agentId: await this.ctx.storage.get<string>('agentId'), exit: r.exitCode });
    return r.exitCode === 0;
  }

  /** Claude Code's state (busy/idle/…). tmux-web's cc-status misses spinner
   *  words it does not know ("Flowing…" read as idle while the reviewer worked,
   *  2026-10-02), so a spinner line on screen always means busy: a glyph, a
   *  capitalised word ending in "…", then "(" and a running time. The glyph is
   *  matched as "not a space": the box's shell is in the C locale, where \S is
   *  one byte and never matches a 3-byte glyph like ✢. */
  async ccStatus(): Promise<string> {
    if (!this.c.running) return 'asleep';
    let st = 'unknown';
    try {
      const r = await this.c.getTcpPort(TW_PORT).fetch('http://container/api/sessions/claude/cc-status', { signal: AbortSignal.timeout(3000) });
      st = ((await r.json()) as { status?: string }).status || 'unknown';
    } catch {}
    if (/busy|thinking|working|running|tool|compact/i.test(st)) return st;
    const pane = await this.#sh(`tmux capture-pane -p -t claude 2>/dev/null | grep -cE '^[^ ]+ [A-Z][a-z]+… \\([0-9]+(m|s)'`).catch(() => null);
    return pane && Number(pane.stdout.trim()) > 0 ? 'busy' : st;
  }

  /** The router's (or an agent's) latest reply, for the project page. */
  async lastReply(): Promise<string | undefined> {
    if (!this.c.running) return undefined;
    try {
      const r = await this.c.getTcpPort(TW_PORT).fetch('http://container/api/conversation?session=claude&tail=80', { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return undefined;
      const { messages } = await r.json() as { messages: { type: string; text?: string }[] };
      const last = messages.filter((m) => m.type === 'assistant_text' && (m.text || '').trim()).pop();
      return last?.text?.trim().slice(0, 600);
    } catch { return undefined; }
  }

  #watchExit(agentId: string, from: string) {
    const started = Date.now();
    this.c.monitor().then(
      () => log('box', 'container_exit', { agentId, from, clean: true, ranMs: Date.now() - started }),
      (e: any) => log('box', 'container_exit', { agentId, from, clean: false, ranMs: Date.now() - started, exitCode: e?.exitCode, err: String(e) }),
    );
  }

  async #agentBusy(): Promise<boolean> {
    try {
      const r = await this.c.getTcpPort(MA_PORT).fetch('http://container/api/p/terminal/states', { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return false;
      return !!((await r.json()) as { busy?: boolean }).busy;
    } catch { return false; }
  }

  async snapshot(why: string): Promise<Snap | null> {
    if (!this.c.running) return null;
    const t0 = Date.now();
    try {
      await this.#sh(`[ -L /tmp/boot.env ] || rm -f /tmp/boot.env; sync`);
      const agentId = await this.ctx.storage.get<string>('agentId');
      const snap = await this.c.snapshotContainer({ name: `${agentId || 'agent'}-${why}` }) as Snap;
      await this.ctx.storage.put('snapshot', snap);
      await this.ctx.storage.put('lastSnapshot', Date.now());
      log('box', 'snapshot', { agentId, why, ms: Date.now() - t0, id: snap.id, sizeMB: Math.round(snap.size / 1e6) });
      return snap;
    } catch (e) {
      log('box', 'snapshot_failed', { why, ms: Date.now() - t0, err: String(e), stack: (e as Error)?.stack });
      return null;
    }
  }

  async letGo(why: string): Promise<void> {
    if (!this.c.running) return;
    await this.#collectCosts();
    await this.ctx.storage.delete('costFrom');
    const snap = await this.snapshot(why);
    if (!snap) { await this.ctx.storage.setAlarm(Date.now() + ALARM_EVERY_MS); return; }
    await this.c.destroy();
    log('box', 'let_go', { why, agentId: await this.ctx.storage.get<string>('agentId') });
  }

  /** Delete the agent: stop without a snapshot and forget everything. */
  async destroy(): Promise<void> {
    try { if (this.c.running) await this.c.destroy(); } catch {}
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  async alarm(): Promise<void> {
    if (((await this.ctx.storage.get<string[]>('askQueue')) || []).length) await this.#runAsks();
    if (this.c.running) await this.ctx.storage.put('aliveAt', Date.now());
    if (this.c.running && Date.now() - ((await this.ctx.storage.get<number>('costFrom')) || Date.now()) > 10 * 60_000) await this.#collectCosts();
    const agentId = await this.ctx.storage.get<string>('agentId');
    if (!this.c.running) { log('box', 'alarm_not_running', { agentId }); return; }
    const idle = Date.now() - ((await this.ctx.storage.get<number>('lastActive')) || 0);
    let keep = idle < IDLE_MS;
    let busy = false;
    // Busy = mobile-agent says so OR Claude Code's own status does. mobile-agent
    // alone read "not busy" during a long tool call (Chromium screenshots), and
    // the reviewer was stopped mid-review (2026-10-01).
    if (!keep && idle < BUSY_MAX_MS) {
      const [ma, cc] = await Promise.all([this.#agentBusy(), this.ccStatus().catch(() => 'unknown')]);
      busy = ma || /busy|thinking|working|running|tool|compact/i.test(cc);
      keep = busy;
      if (busy !== ma) log('box', 'busy_by_cc_status', { agentId, ma, cc });
    }
    log('box', 'alarm', { agentId, idleS: Math.round(idle / 1000), busy, keep });
    if (keep) {
      const last = (await this.ctx.storage.get<number>('lastSnapshot')) || 0;
      if (Date.now() - last > SNAPSHOT_EVERY_MS) await this.snapshot('periodic');
      await this.ctx.storage.setAlarm(Date.now() + ALARM_EVERY_MS);
      return;
    }
    log('box', 'idle_stop', { agentId, idleMin: Math.round(idle / 60000) });
    await this.letGo('idle');
  }

  /** Proxy to mobile-agent (default) or the in-box tmux-web (x-forq-port: 7681).
   *  A fetch handler, not RPC: a WebSocket 101 cannot come back over RPC. */
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const port = request.headers.get('x-forq-port') === '7681' ? TW_PORT : MA_PORT;
    const headers = new Headers(request.headers);
    headers.delete('x-forq-port');
    return this.c.getTcpPort(port).fetch(new Request(`http://container${url.pathname}${url.search}`, new Request(request, { headers })));
  }

  // ---- the ask box (<slug>--ask): Claude Code answers questions about the project ----
  // Read-only clone (a read token), `claude -p` with the edit tools disallowed (plan mode
  // ignored --model and ran Sonnet for every question, 2026-10-07), on
  // the owner's own Claude (subscription token or API key, from the box's tmux env).
  // Runs from the alarm so a long answer outlives the request that asked.
  async startAsk(id: string, question: string, spec: BootSpec, model = 'opus') {
    const q = (await this.ctx.storage.get<string[]>('askQueue')) || [];
    await this.ctx.storage.put({ [`ask:${id}`]: { state: 'queued', question, model, at: Date.now() }, askQueue: [...q, id], askSpec: spec });
    await this.ctx.storage.setAlarm(Date.now() + 50);
    log('box', 'ask_queued', { agentId: spec.agentId, id, chars: question.length });
  }
  async askResult(id: string) {
    return (await this.ctx.storage.get<Record<string, unknown>>(`ask:${id}`)) || null;
  }
  async #runAsks() {
    const spec = await this.ctx.storage.get<BootSpec>('askSpec');
    const ids = (await this.ctx.storage.get<string[]>('askQueue')) || [];
    if (!spec || !ids.length) return;
    // A question leaves the queue only once answered: a forq deploy restarts this object
    // mid-answer, and the next alarm must pick it up again (a test question was lost that
    // way, 2026-10-07). Re-arm first so a restart before the end still comes back.
    await this.ctx.storage.setAlarm(Date.now() + 60_000);
    const up = await this.ensureUp(spec);
    for (const id of ids) {
      const a = await this.ctx.storage.get<{ question: string; model?: string; at: number }>(`ask:${id}`);
      if (!a) continue;
      if (!up.ok) {
        await this.ctx.storage.put(`ask:${id}`, { ...a, state: 'failed', error: up.error || 'the box did not start' });
        await this.ctx.storage.put('askQueue', ((await this.ctx.storage.get<string[]>('askQueue')) || []).filter((x) => x !== id));
        continue;
      }
      await this.ctx.storage.put(`ask:${id}`, { ...a, state: 'running', startedAt: Date.now() });
      await this.touch(spec.agentId);
      const t0 = Date.now();
      const prompt = `You are answering a question about this repository for its owner, who is reading on a phone. Read the code and git history as needed. Do not modify any files. Answer in plain words, at most about 150 words unless asked for more, with file paths where they help.\n\nQuestion: ${a.question}`;
      const r = await this.#sh(`cd ${REPO_DIR} 2>/dev/null || cd /workspace
git pull -q --ff-only 2>/dev/null
eval "$(tmux show-environment -g 2>/dev/null | grep -E '^(CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY|ANTHROPIC_MODEL)=' | sed 's/^/export /')"
IS_SANDBOX=1 timeout 300 claude -p "$Q" --model "$MODEL" --disallowedTools Edit Write NotebookEdit --output-format text 2>&1 | tail -c 20000`, { Q: prompt, MODEL: ['opus', 'sonnet', 'haiku'].includes(a.model || '') ? a.model! : 'opus' }).catch((e) => ({ exitCode: 1, stdout: '', stderr: String(e) }));
      const answer = r.stdout.trim();
      const ok = r.exitCode === 0 && !!answer;
      await this.ctx.storage.put(`ask:${id}`, { ...a, state: ok ? 'done' : 'failed', answer: ok ? answer : undefined, error: ok ? undefined : (answer || r.stderr || 'no answer').slice(-400), ms: Date.now() - t0 });
      log('box', 'ask_done', { agentId: spec.agentId, id, ok, ms: Date.now() - t0, chars: answer.length });
      await this.touch(spec.agentId);
      await this.ctx.storage.put('askQueue', ((await this.ctx.storage.get<string[]>('askQueue')) || []).filter((x) => x !== id));
    }
  }

  /** Adds this box's costs since the last call to its owner's ledger: awake seconds and
   *  measured CPU (cgroup usage_usec), and Claude Code tokens per model read from the
   *  transcripts written after the last cursor. Never throws. */
  async #collectCosts() {
    try {
      const st = await this.ctx.storage.get(['costFrom', 'cpuLast', 'costOwner', 'costProject', 'costBilling', 'costCovered', 'costCursor']);
      const from = st.get('costFrom') as number | undefined, owner = st.get('costOwner') as string | undefined;
      if (!from || !owner || !this.c.running) return;
      const now = Date.now();
      const r = await this.#sh(String.raw`cpu=$(awk '/usage_usec/{print $2}' /sys/fs/cgroup/cpu.stat 2>/dev/null); echo "CPU=$cpu"
node -e '
const fs=require("fs"),p=require("path");const since=process.argv[1]||"";let last=since;const m={};
function walk(d){let e;try{e=fs.readdirSync(d,{withFileTypes:true})}catch{return}for(const f of e){const q=p.join(d,f.name);if(f.isDirectory())walk(q);else if(f.name.endsWith(".jsonl")){
for(const line of fs.readFileSync(q,"utf8").split("\n")){if(!line.includes("\"usage\""))continue;let o;try{o=JSON.parse(line)}catch{continue}
const ts=o.timestamp||"";if(!ts||ts<=since)continue;const u=o.message&&o.message.usage;if(!u)continue;const k=o.message.model||"unknown";
const t=m[k]||(m[k]={in:0,out:0,cw:0,cw1h:0,cr:0});const cc=u.cache_creation||{};const h1=cc.ephemeral_1h_input_tokens||0;t.in+=u.input_tokens||0;t.out+=u.output_tokens||0;t.cw1h+=h1;t.cw+=Math.max(0,(u.cache_creation_input_tokens||0)-h1);t.cr+=u.cache_read_input_tokens||0;if(ts>last)last=ts}}}}
walk("/workspace/.claude/projects");console.log("USAGE="+JSON.stringify({m,last}))' "$CURSOR"`, { CURSOR: (st.get('costCursor') as string) || '' });
      const cpuNow = Number((r.stdout.match(/CPU=(\d+)/) || [])[1] || 0) / 1e6;
      const usage = JSON.parse((r.stdout.match(/USAGE=(.*)/) || [])[1] || '{"m":{},"last":""}') as { m: Record<string, Tokens>; last: string };
      const seconds = (now - from) / 1000, cpuSeconds = Math.max(0, cpuNow - ((st.get('cpuLast') as number) || 0));
      const covered = !!st.get('costCovered'), billing = (st.get('costBilling') as 'sub' | 'api') || 'api', project = (st.get('costProject') as string) || '';
      await recordCost(this.env, owner, 'boxes', project, { usd: boxUsd(seconds, cpuSeconds, INSTANCE.memoryMib / 1024, INSTANCE.diskMb / 1000), covered, seconds, cpuSeconds });
      for (const [model, t] of Object.entries(usage.m)) {
        // Variants lab projects keep tokens per model in the ledger (`<project>:<model>`), so their
        // budget guard prices each model at its own rate (src/landing/landing.ts #budgetTick).
        const proj = /\/lab-/.test(project) ? `${project}:${model}` : project;
        await recordCost(this.env, owner, 'claude', proj, { usd: billing === 'sub' ? null : claudeUsd(model, t), covered: false, tokens: t, billing });
      }
      await this.ctx.storage.put({ costFrom: now, cpuLast: cpuNow, ...(usage.last ? { costCursor: usage.last } : {}) });
      // tokens per model: the variants lab prices each role at its own model (scripts/lab/run.mjs reads these lines).
      log('box', 'costs', { agentId: await this.ctx.storage.get<string>('agentId'), seconds: Math.round(seconds), cpuSeconds: Math.round(cpuSeconds), models: Object.keys(usage.m), tokens: usage.m });
    } catch (e) { log('box', 'costs_failed', { err: String(e) }); }
  }

  async adminExec(cmd: string) {
    if (!this.c.running) return { error: 'not running' };
    return this.#sh(cmd);
  }

  async state() {
    const keys = ['agentId', 'lastActive', 'lastSnapshot', 'snapshot', 'failedSnapshots', 'taskSent'];
    const m = await this.ctx.storage.get(keys);
    return { running: !!this.ctx.container?.running, alarm: await this.ctx.storage.getAlarm(), ...Object.fromEntries(m) };
  }
}

/** How to review one agent. Sent with every review request as well as at boot:
 *  each review starts with /clear, which drops the boot prompt (the reviewer
 *  went back to judging an agent against the whole request, 2026-10-02). */
export const REVIEW_STEPS = [
      `For each review: run \`forq fetch-agent <agent-id>\` (it fetches the agent's work into refs/agents/<agent-id> and prints its task, where it started and its preview URL). Read the change with \`git diff <base> refs/agents/<agent-id>\`. If the project has a web page, look at the agent's preview at phone size: \`chromium --headless=new --hide-scrollbars --window-size=390,844 --screenshot=/tmp/<agent-id>.png <preview-url>\`, then open that PNG with your Read tool and look at it.`,
      `Judge the change against the agent's own task (the "task:" line). The person's request ("asked:") may have been split across several agents, so parts of it that belong to other tasks are not missing from this one. Check: does it do what its task asked, does anything look broken or out of place, any obvious bug. Be brief and concrete. Then give your verdict with exactly one of: \`forq verdict <agent-id> approve "<one or two lines>"\` or \`forq verdict <agent-id> changes "<what to fix, specific>"\`. Never edit or push code yourself.`,
];

/** The agent board's words in the prompts (board on). The hook already shows the board with each message
 *  and warns on shared files; these say what to do with it (FINDINGS.md: intent + finished work + one rule). */
export const BOARD_AGENT = `This project has an agent board: who works on what right now, and what was finished in the last 30 minutes (\`forq who --recent\`; it is also shown to you with each message). If you choose your own task (from a backlog or list), first run \`forq who --recent\`, then announce the one you take with \`forq intent "<task id + title>" --files <files you expect to change>\` before writing code. If a task someone else is doing or has finished means the same as yours, even under another name or id, or the board lists it as the same work, do not build it again: make yours a thin alias of theirs once theirs is on main, or pick another task.`;
export const BOARD_ROUTER = `This project has an agent board (\`forq who --recent\`): every agent's task and files, live, and what finished in the last 30 minutes. When you hand out a task list or a backlog file, first run \`forq dedupe <file>\` (or \`forq dedupe "task" "task" ...\`) once: it finds tasks that are the same work under different names and shows those pairs to every agent on the board.`;

function taskPrompt(spec: BootSpec) {
  if (spec.role === 'reviewer') {
    return [
      `You are the reviewer agent of the forq project ${spec.project}. ${REPO_DIR} is a read-only clone of the project's main line. Agents work on their own forks; when one pushes, you are asked to review it before the person merges.`,
      ...REVIEW_STEPS,
      `Reply now with one line saying you are ready, then wait for review requests.`,
    ].join('\n\n');
  }
  if (spec.role === 'router') {
    return [
      `You are the router agent of the forq project ${spec.project}. ${REPO_DIR} is a clone of the project's main line (its default branch). You coordinate; agents do the work.`,
      `The person will message you from their phone. For each request: split it into independent tasks that touch different parts of the code where possible, and start one agent per task with \`forq spawn "<task>"\` (each agent gets its own fork and box; give it a complete, self-contained task). Small questions about the code you may answer yourself. Do not edit main yourself unless asked.`,
      ...(spec.board ? [BOARD_ROUTER] : []),
      `\`forq list\` shows the agents and their notes. When asked to merge an agent: \`forq merge <agent-id>\`; if it reports a conflict, resolve it in ${REPO_DIR}, commit, \`git push origin HEAD\`, then \`forq merged <agent-id>\`. \`forq send <agent-id> "text"\` messages an agent. \`forq help\` for the rest.`,
      `Keep replies short; the person reads them on a phone. Reply now with one line saying you are ready.`,
    ].join('\n\n');
  }
  return [
    `You are a forq agent (${spec.agentId}) on the project ${spec.project}. You work in ${REPO_DIR}, a clone of your own fork; no other agent touches it.`,
    `Your task: ${spec.task}`,
    ...(spec.board ? [BOARD_AGENT] : []),
    `Check your change works before you push (run it locally where you can). When the task is done: commit with a clear message, push with \`git push origin HEAD\` (your clone is on the default branch), and run \`forq status pushed "<one-line summary>"\` right away: that is what builds your preview and starts the review, so never wait for a deploy yourself. Then reply with a 2-3 line summary. If you are blocked or the task is unclear, run \`forq status blocked "<why>"\` and say so instead of guessing.`,
  ].join('\n\n');
}
