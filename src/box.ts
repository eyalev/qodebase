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

const MA_PORT = 7901;
const TW_PORT = 7681;
const IDLE_MS = 5 * 60_000;
const BUSY_MAX_MS = 4 * 60 * 60_000;
const ALARM_EVERY_MS = 60_000;
const SNAPSHOT_EVERY_MS = 15 * 60_000;
const INACTIVITY_BACKSTOP_MS = 45 * 60_000;
const INSTANCE = { vcpu: 1, memoryMib: 3072, diskMb: 8000 };
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
export type BootSpec = {
  agentId: string;
  task: string;         // '' for the router and the reviewer
  role: 'agent' | 'router' | 'reviewer';  // router: main, merges; reviewer: main read-only, reviews pushes
  project: string;      // owner/name, for prompts
  remote: string;       // fork's (or main's) git remote
  gitToken: string;     // write token for that repo (art_v2_…?expires=…)
  agentToken: string;   // signs this box's /api/agent/* calls
  apiBase: string;      // where the forq CLI calls
  uiHost: string;       // the public UI host (mobile-agent's allowed origin)
  maRev: string;        // mobile-agent version to unpack over the image's copy
  bootEnv: string;      // boot.sh env (SBX_NAME, CC_ENV, …)
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
      from = snap ? 'snapshot' : 'image';
      try {
        this.c.start({
          instance: INSTANCE, enableInternet: true, entrypoint: ENTRYPOINT,
          ...(snap ? { containerSnapshot: snap } : { image: this.c.images.computer }),
        });
        await this.#sh('true');
      } catch (e) {
        log('box', 'start_failed', { agentId: spec.agentId, from, snapshot: snap?.id, err: String(e), stack: (e as Error)?.stack });
        if (!snap) return { ok: false, ms: Date.now() - t0, from, error: String(e) };
        const lost = (await this.ctx.storage.get<Snap[]>('failedSnapshots')) || [];
        lost.push(snap);
        await this.ctx.storage.put('failedSnapshots', lost);
        await this.ctx.storage.delete('snapshot');
        try { if (this.c.running) await this.c.destroy(); } catch {}
        from = 'image-after-failed-restore';
        this.c.start({ instance: INSTANCE, enableInternet: true, entrypoint: ENTRYPOINT, image: this.c.images.computer });
        await this.#sh('true');
      }
      await this.c.setInactivityTimeout(INACTIVITY_BACKSTOP_MS);
      this.#watchExit(spec.agentId, from);
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
      git -C ${REPO_DIR} log --oneline -1`, { GIT_TOKEN: spec.gitToken, REMOTE: spec.remote, AGENT_ID: spec.agentId, UI_HOST: spec.uiHost,
        AGENT_TOKEN: spec.agentToken, API_BASE: spec.apiBase, FORQ_CLI });
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
    if (!(await this.ctx.storage.get<boolean>('taskSent'))) {
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
    for (let i = 0; i < 15; i++) {
      if (/busy|thinking|working|running|tool|compact/i.test(await this.ccStatus())) return { ok: true };
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
   *  capitalised word ending in "…", then "(" and a running time. */
  async ccStatus(): Promise<string> {
    if (!this.c.running) return 'asleep';
    let st = 'unknown';
    try {
      const r = await this.c.getTcpPort(TW_PORT).fetch('http://container/api/sessions/claude/cc-status', { signal: AbortSignal.timeout(3000) });
      st = ((await r.json()) as { status?: string }).status || 'unknown';
    } catch {}
    if (/busy|thinking|working|running|tool|compact/i.test(st)) return st;
    const pane = await this.#sh(`tmux capture-pane -p -t claude 2>/dev/null | grep -cE '^\\S [A-Z][a-z]+(ing)?… \\([0-9]+(m|s)'`).catch(() => null);
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
      `\`forq list\` shows the agents and their notes. When asked to merge an agent: \`forq merge <agent-id>\`; if it reports a conflict, resolve it in ${REPO_DIR}, commit, \`git push origin HEAD\`, then \`forq merged <agent-id>\`. \`forq send <agent-id> "text"\` messages an agent. \`forq help\` for the rest.`,
      `Keep replies short; the person reads them on a phone. Reply now with one line saying you are ready.`,
    ].join('\n\n');
  }
  return [
    `You are a forq agent (${spec.agentId}) on the project ${spec.project}. You work in ${REPO_DIR}, a clone of your own fork; no other agent touches it.`,
    `Your task: ${spec.task}`,
    `Check your change works before you push (run it locally where you can). When the task is done: commit with a clear message, push with \`git push origin HEAD\` (your clone is on the default branch), and run \`forq status pushed "<one-line summary>"\` right away: that is what builds your preview and starts the review, so never wait for a deploy yourself. Then reply with a 2-3 line summary. If you are blocked or the task is unclear, run \`forq status blocked "<why>"\` and say so instead of guessing.`,
  ].join('\n\n');
}
