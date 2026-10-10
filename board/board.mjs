#!/usr/bin/env node
// board post <kind> [--intent T] [--files a,b] [--status S]
// board who [--files a,b] [--area X] [--recent 30m] [--json]  live agents (last 10 min), not yourself;
//   --recent also lists what others finished (done/committed/landed) in that window, marked FINISHED
// board tail [-n N] [--json]
// Env: BOARD_AGENT (who you are), BOARD_FILE=<jsonl> or BOARD_URL=<…/b/<name>> + BOARD_TOKEN.
import { backend, makeEvent, fmtRow, readState, writeState, parseDur } from './lib.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const opt = (k, d = null) => { const i = rest.indexOf(k); return i >= 0 && i + 1 < rest.length ? rest[i + 1] : d; };
const has = (k) => rest.includes(k);
const usage = () => { console.error('usage: board post <kind> [--intent T] [--files a,b] [--status S] | who [--files a,b] [--area X] [--recent 30m] [--json] | tail [-n N] [--json]\nenv: BOARD_AGENT, BOARD_FILE or BOARD_URL+BOARD_TOKEN'); process.exit(2); };

const b = backend();
if (!b || !cmd) usage();
const me = process.env.BOARD_AGENT || null;
try {
  if (cmd === 'post') {
    const kind = rest[0]?.startsWith('--') ? null : rest[0];
    const e = await b.post(makeEvent({ agent: me, kind, intent: opt('--intent'), files: opt('--files', ''), status: opt('--status') }));
    // The agent said what it is doing: the hook's later editing/done posts use that, not the harness prompt.
    if (kind === 'started' && e.intent) { const st = readState(me); st.explicit = e.intent; writeState(me, st); }
    console.log(has('--json') ? JSON.stringify(e) : 'posted');
  } else if (cmd === 'who') {
    const rows = await b.who({ me, files: opt('--files', ''), area: opt('--area'), recent: has('--recent') ? parseDur(opt('--recent'), 30 * 60_000) : 0 });
    if (has('--json')) console.log(JSON.stringify(rows));
    else console.log(rows.length ? rows.map(fmtRow).join('\n') : 'nobody else is live');
  } else if (cmd === 'tail') {
    const rows = await b.tail(Number(opt('-n', '20')));
    console.log(has('--json') ? rows.map((r) => JSON.stringify(r)).join('\n') : rows.map((r) => `${new Date(r.ts).toISOString().slice(11, 19)} ${fmtRow(r)}`).join('\n'));
  } else usage();
} catch (e) { console.error(String(e.message || e)); process.exit(1); }
