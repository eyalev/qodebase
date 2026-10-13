// Runs INSIDE an agent box (C-1): reads Claude Code's transcripts and prints one JSON line about its long-context calls.
// Per session: calls, Haiku calls whose prompt crossed 100k tokens (when: call index, minutes in), and what filled the
// context by then: tool results by tool (chars), the biggest single results (tool + command head), outside prompts
// (task, review notes, nudges, board context) by kind.
const fs = require('fs'), p = require('path');
const files = [];
(function walk(d) { let e; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const f of e) { const q = p.join(d, f.name); if (f.isDirectory()) walk(q); else if (f.name.endsWith('.jsonl')) files.push(q); } })('/root/.claude/projects');
const kindOf = (t) => /changes-suggested|review(er)?\b.*(asked|notes|suggest)|Reviewer/i.test(t) ? 'review' : /sync-main|redo your change|conflicts with main/i.test(t) ? 'sync' : /nudged|nothing pushed|are you still/i.test(t) ? 'nudge' : /Agent board|forq who|working on the same/i.test(t) ? 'board' : /skeleton landed|landed on main/i.test(t) ? 'landed-note' : 'other';
const out = [];
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const tools = new Map(); let calls = 0, t0 = null; const byTool = {}, big = [], prompts = {}; const long = []; let toolChars = 0, promptChars = 0;
  for (const o of lines) {
    const ts = Date.parse(o.timestamp || ''); if (ts && !t0) t0 = ts;
    const c = o.message?.content;
    if (o.type === 'assistant' && Array.isArray(c)) for (const b of c) if (b.type === 'tool_use') tools.set(b.id, { name: b.name, cmd: String(b.input?.command || b.input?.file_path || b.input?.pattern || '').slice(0, 80) });
    if (o.type === 'user') {
      if (typeof c === 'string') { const k = kindOf(c); prompts[k] = (prompts[k] || 0) + c.length; promptChars += c.length; }
      else if (Array.isArray(c)) for (const b of c) {
        if (b.type === 'tool_result') {
          const txt = typeof b.content === 'string' ? b.content : JSON.stringify(b.content || '');
          const tu = tools.get(b.tool_use_id) || { name: '?', cmd: '' };
          byTool[tu.name] = (byTool[tu.name] || 0) + txt.length; toolChars += txt.length;
          big.push([txt.length, tu.name, tu.cmd]);
        } else if (b.type === 'text') { const k = kindOf(b.text || ''); prompts[k] = (prompts[k] || 0) + (b.text || '').length; promptChars += (b.text || '').length; }
      }
    }
    const u = o.message?.usage;
    if (o.type === 'assistant' && u) {
      calls++;
      const pr = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      if (pr > 100000 && /haiku/.test(o.message.model || '')) long.push({ i: calls, min: t0 && ts ? Math.round((ts - t0) / 6000) / 10 : null, prompt: pr, toolChars, promptChars });
    }
  }
  big.sort((a, b) => b[0] - a[0]);
  out.push({ session: p.basename(f).slice(0, 8), calls, long: long.length, firstLong: long[0] || null, maxPrompt: long.reduce((m, x) => Math.max(m, x.prompt), 0),
    byTool, prompts, big: big.slice(0, 4) });
}
console.log('QB_LONG ' + JSON.stringify(out));
