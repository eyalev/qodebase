// box-api: the small HTTP API forq calls inside an agent box, on :7681.
// An open stand-in for the three tmux-web endpoints the hosted image uses
// (src/box.ts, src/index.ts):
//   GET  /api/conversation?session=claude&tail=N   Claude Code's transcript as messages
//   POST /api/conversation/send {session,text,delay}  type text into the session, then Enter
//   GET  /api/sessions/<session>/cc-status          {status: busy|waiting|idle|unknown}
//   GET  /api/build-info                            readiness probe
// No dependencies; Node 20+.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const PORT = Number(process.env.PORT || 7681);
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME || '/root', '.claude');
const log = (event, data = {}) => process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), module: 'box-api', event, ...data }) + '\n');

const run = (cmd, args, input) => new Promise((resolve, reject) => {
  const p = execFile(cmd, args, { maxBuffer: 8 << 20 }, (err, stdout, stderr) => err ? reject(Object.assign(err, { stderr })) : resolve(stdout));
  if (input !== undefined) { p.stdin.end(input); }
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const okSession = (s) => /^[A-Za-z0-9_.-]{1,64}$/.test(s || '');

/** The session's working directory → Claude Code's newest transcript there. */
async function transcriptFor(session) {
  const cwd = (await run('tmux', ['display-message', '-p', '-t', session, '#{pane_current_path}'])).trim();
  const candidates = [cwd];
  try { candidates.unshift(fs.readFileSync('/workspace/.sbx-cwd', 'utf8').trim()); } catch {}
  for (const dir of candidates) {
    const tdir = path.join(CLAUDE_DIR, 'projects', dir.replace(/[^A-Za-z0-9]/g, '-'));
    let files = [];
    try { files = fs.readdirSync(tdir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(tdir, f)); } catch { continue; }
    if (files.length) return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  }
  return null;
}

/** Transcript lines → the message shapes forq's Chat tab reads:
 *  {type:'user'|'assistant_text'|'tool_use', text, toolName?}. */
function toMessages(lines) {
  const out = [];
  for (const line of lines) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.isSidechain || e.isMeta) continue;
    const content = e.message?.content;
    if (e.type === 'user') {
      if (typeof content === 'string') { if (!content.startsWith('<')) out.push({ type: 'user', text: content, at: e.timestamp }); continue; }
      for (const b of content || []) if (b.type === 'text' && !b.text.startsWith('<')) out.push({ type: 'user', text: b.text, at: e.timestamp });
    } else if (e.type === 'assistant') {
      for (const b of content || []) {
        if (b.type === 'text') out.push({ type: 'assistant_text', text: b.text, at: e.timestamp });
        else if (b.type === 'tool_use') out.push({ type: 'tool_use', toolName: b.name, text: summarise(b.input), at: e.timestamp });
      }
    }
  }
  return out;
}
const summarise = (input) => String(input?.command || input?.file_path || input?.pattern || input?.description || input?.url || '').slice(0, 200);

/** Claude Code's state, read from the pane. */
async function ccStatus(session) {
  const pane = await run('tmux', ['capture-pane', '-p', '-t', session]);
  if (/esc to interrupt/i.test(pane)) return 'busy';
  if (/Do you want to|❯ 1\. /.test(pane)) return 'waiting';
  if (/^❯/m.test(pane)) return 'idle';
  return 'unknown';
}

async function send(session, text, delay) {
  if (text.includes('\n')) {
    // Multi-line text goes in as one bracketed paste, so newlines don't submit.
    await run('tmux', ['load-buffer', '-b', 'box-api', '-'], text);
    await run('tmux', ['paste-buffer', '-p', '-d', '-b', 'box-api', '-t', session]);
  } else {
    await run('tmux', ['send-keys', '-t', session, '-l', text]);
  }
  await sleep(Math.min(Math.max(Number(delay) || 500, 0), 5000));
  await run('tmux', ['send-keys', '-t', session, 'Enter']);
}

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1 << 20) req.destroy(); }); req.on('end', () => resolve(b)); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://box');
  try {
    if (url.pathname === '/api/build-info') return json(res, 200, { name: 'box-api' });
    if (url.pathname === '/api/conversation' && req.method === 'GET') {
      const session = url.searchParams.get('session') || 'claude';
      if (!okSession(session)) return json(res, 400, { error: 'bad session' });
      const file = await transcriptFor(session).catch(() => null);
      if (!file) return json(res, 404, { error: 'no transcript yet' });
      const tail = Math.min(Number(url.searchParams.get('tail')) || 200, 2000);
      const messages = toMessages(fs.readFileSync(file, 'utf8').split('\n')).slice(-tail);
      return json(res, 200, { messages });
    }
    if (url.pathname === '/api/conversation/send' && req.method === 'POST') {
      const { session = 'claude', text, delay } = JSON.parse(await readBody(req) || '{}');
      if (!okSession(session) || typeof text !== 'string' || !text) return json(res, 400, { error: 'session and text required' });
      await send(session, text, delay);
      log('sent', { session, chars: text.length });
      return json(res, 200, { ok: true });
    }
    const m = url.pathname.match(/^\/api\/sessions\/([^/]+)\/cc-status$/);
    if (m && okSession(m[1])) return json(res, 200, { status: await ccStatus(m[1]) });
    json(res, 404, { error: 'not found' });
  } catch (e) {
    log('error', { path: url.pathname, err: String(e), stderr: e.stderr, stack: e.stack });
    json(res, 500, { error: String(e.message || e) });
  }
}).listen(PORT, '0.0.0.0', () => log('listening', { port: PORT }));
