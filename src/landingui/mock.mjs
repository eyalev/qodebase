// Writes public/landing-mock.json: a Hono-shaped demo project in the qb6/qb7 contract
// (docs/contest/PLAN.md "Contract"), with every state the UI has to draw. Times are ms
// epoch around NOW; events after NOW let the UI's mock mode play the next ~2 minutes.
// Run: node src/landingui/mock.mjs
import { writeFileSync } from 'node:fs';

const NOW = Date.UTC(2026, 9, 9, 14, 30, 0);
const at = (s) => NOW + s * 1000;

const STATE = { asked: 'working', claimed: 'working', working: 'working', stacked: 'working', 'changes-suggested': 'working', pushed: 'pushed', approved: 'pushed', reviewing: 'reviewing', queued: 'queued', replayed: 'queued', testing: 'testing', landed: 'landed', bounced: 'bounced', replaying: 'replaying', 'with-lead': 'with-lead' };

const D = {
  timing: [{ path: 'src/middleware/timing/index.ts', lines: ['+import type { MiddlewareHandler } from \'../../types\'', '+', '+export const timing = (): MiddlewareHandler => async (c, next) => {', '+  const start = performance.now()', '+  await next()', '+  c.header(\'Server-Timing\', `total;dur=${performance.now() - start}`)', '+}'] },
    { path: 'package.json', lines: ['   "exports": {', '     "./ip-restriction": "./dist/middleware/ip-restriction/index.js",', '+    "./timing": "./dist/middleware/timing/index.js",', '     "./jwt": "./dist/middleware/jwt/index.js",'] },
    { path: 'jsr.json', lines: ['     "./ip-restriction": "./src/middleware/ip-restriction/index.ts",', '+    "./timing": "./src/middleware/timing/index.ts",'] }],
  ip: [{ path: 'src/middleware/ip-restriction/index.ts', lines: ['+export const ipRestriction = (getIP, { denyList = [], allowList = [] }) =>', '+  async (c, next) => {', '+    const ip = getIP(c)', '+    if (denyList.includes(ip) || (allowList.length && !allowList.includes(ip))) return c.text(\'Forbidden\', 403)', '+    await next()', '+  }'] },
    { path: 'package.json', lines: ['   "exports": {', '+    "./ip-restriction": "./dist/middleware/ip-restriction/index.js",', '     "./jwt": "./dist/middleware/jwt/index.js",'] },
    { path: 'jsr.json', lines: ['+    "./ip-restriction": "./src/middleware/ip-restriction/index.ts",'] }],
  static: [{ path: 'src/router/reg-exp-router/router.ts', lines: ['   match(method, path) {', '+    const hit = this.#static[method]?.[path]', '+    if (hit) return hit', '     const [re, handlers] = this.#matchers[method]', '…', '-    // every path goes through the big regexp', '+    // static paths skip the regexp entirely'] }],
  cookie: [{ path: 'src/utils/cookie.ts', lines: ['   if (opt.secure) cookie += \'; Secure\'', '+  if (opt.partitioned) {', '+    if (!opt.secure) throw new Error(\'Partitioned cookies need Secure\')', '+    cookie += \'; Partitioned\'', '+  }'] }],
  cors: [{ path: 'src/middleware/cors/index.ts', lines: ['   if (c.req.method === \'OPTIONS\') {', '-    if (opts.origin === \'*\') set(\'Access-Control-Allow-Origin\', \'*\')', '+    const origin = findAllowOrigin(c.req.header(\'origin\') || \'\', c)', '+    if (origin) set(\'Access-Control-Allow-Origin\', origin)', '+    if (opts.origin !== \'*\') set(\'Vary\', \'Origin\')'] }],
  sse: [{ path: 'src/helper/streaming/sse.ts', lines: ['   async writeSSE(message: SSEMessage) {', '+    if (message.retry != null) data.push(`retry: ${message.retry}`)', '     data.push(`data: ${message.data}`)'] }],
  trie: [{ path: 'src/router/trie-router/node.ts', lines: ['   for (const part of parts) {', '+    if (part.endsWith(\'?\')) {', '+      optional.push(part.slice(0, -1))', '+      continue', '+    }', '     const [key, pattern] = getPattern(part)'] }],
  jwt: [{ path: 'src/middleware/jwt/index.ts', lines: ['+  jwks_uri?: string', '…', '+  const keys = options.jwks_uri ? await fetchJwks(options.jwks_uri) : [options.secret]'] }],
  ctx: [{ path: 'src/context.ts', lines: ['   redirect = (location: string, status = 302) => {', '+    if (this.#keepQuery) location += new URL(this.req.url).search', '     this.header(\'Location\', location)'] }],
  validator: [{ path: 'src/validator/validator.ts', lines: ['     case \'query\':', '-      value = c.req.queries()', '+      value = coerce(c.req.queries(), opts.coerce)'] },
    { path: 'src/context.ts', lines: ['   get var() {', '-    return this.#var', '+    return Object.freeze({ ...this.#var, query: this.#coerced })'] }],
  cvar: [{ path: 'src/context.ts', lines: ['-  get var(): Readonly<ContextVariableMap> {', '+  get var(): Readonly<ContextVariableMap & E[\'Variables\']> {', '     return Object.fromEntries(this.#var)'] }],
  zstd: [{ path: 'src/middleware/compress/index.ts', lines: ['-const ENCODING_TYPES = [\'gzip\', \'deflate\'] as const', '+const ENCODING_TYPES = [\'zstd\', \'gzip\', \'deflate\'] as const'] }],
  zstdTests: [{ path: 'src/middleware/compress/index.test.ts', lines: ['+  it(\'prefers zstd when the client accepts it\', async () => {', '+    const res = await app.request(\'/\', { headers: { \'Accept-Encoding\': \'zstd, gzip\' } })', '+    expect(res.headers.get(\'Content-Encoding\')).toBe(\'zstd\')', '+  })'] }],
  reqid: [{ path: 'src/middleware/request-id/index.ts', lines: ['+export const requestId = ({ header = \'X-Request-Id\' } = {}) => async (c, next) => {', '+  const id = c.req.header(header) ?? crypto.randomUUID()', '+  c.set(\'requestId\', id)', '+  c.header(header, id)', '+  await next()', '+}'] },
    { path: 'package.json', lines: ['     "./ip-restriction": "./dist/middleware/ip-restriction/index.js",', '+    "./request-id": "./dist/middleware/request-id/index.js",', '     "./timing": "./dist/middleware/timing/index.js",'] }],
  jsx: [{ path: 'src/jsx/dom/render.ts', lines: ['-  container.replaceChildren(...nodes)', '+  reconcileKeyed(container, nodes, (n) => n.key)'] }],
  etag: [{ path: 'src/adapter/cloudflare-workers/serve-static.ts', lines: ['   const object = await bucket.get(key)', '+  if (object?.httpEtag) c.header(\'ETag\', object.httpEtag)'] }],
};

const changes = [];
let seq = 0;
function change(id, o) {
  const events = o.ev.map(([s, what, detail]) => ({ t: at(s), what, ...(detail ? { detail } : {}) }));
  const past = events.filter((e) => e.t <= NOW);
  const state = past.reduce((s, e) => STATE[e.what] || s, 'working');
  const landed = past.find((e) => e.what === 'landed');
  changes.push({
    id: String(id), title: o.title, intent: o.intent, agent: o.agent, kind: 'demo', fork: `hono--${o.agent}-${++seq}`, base: o.base || '3f9c2e1',
    state, files: o.files, claims: o.claims || o.files, needs: o.needs || [], provides: o.provides || [], stackedOn: o.stackedOn || null,
    lead: state === 'with-lead' ? o.lead : null, createdAt: events[0].t, landedAt: landed ? landed.t : null,
    events: past, // the snapshot only carries what has happened…
    future: events.filter((e) => e.t > NOW), // …mock-only: what the playback reveals next
    review: o.review && past.some((e) => ['approved', 'changes-suggested'].includes(e.what)) ? o.review : null,
    landing: o.diff && ['queued', 'testing', 'landed', 'replaying', 'with-lead', 'bounced'].includes(state) || (o.diff && o.diffEarly)
      ? { how: landed ? (o.how || 'merged') : null, conflicts: o.conflicts || [], diff: o.diff, commit: o.commit || null, mainCommit: landed ? o.mainCommit : null }
      : null,
  });
}
const R = { verdict: 'auto', notes: 'Scripted review: the change does what it says, tests added.' };

change(101, { title: 'Add a timing middleware', intent: 'Add a middleware that measures how long each request takes and reports it in a Server-Timing header, exported as hono/timing.', agent: 'agent-1',
  files: ['src/middleware/timing/index.ts', 'src/middleware/timing/index.test.ts', 'package.json', 'jsr.json'], provides: ['hono/timing'], review: R, diff: D.timing, how: 'replayed-handler', conflicts: ['package.json', 'jsr.json'], commit: 'a41c09e', mainCommit: 'e7d2b10',
  ev: [[-640, 'asked'], [-636, 'claimed', 'src/middleware/timing/, package.json, jsr.json'], [-634, 'working'], [-420, 'pushed'], [-410, 'reviewing'], [-352, 'approved', 'Scripted review: looks right, has tests.'], [-340, 'queued'],
    [-326, 'conflict', 'package.json, jsr.json: #103 added its export on the same lines'], [-325, 'replaying', 'Rule for package.json exports: add the line again on the newest main'], [-319, 'replayed', 'Same intent, re-applied on e2a1f04; diff unchanged'], [-315, 'testing', 'train T2'], [-270, 'landed', 'e7d2b10']] });
change(102, { title: 'Faster route matching for static paths', intent: 'Static paths like /about should skip the big regular expression in RegExpRouter and match from a lookup table.', agent: 'agent-2',
  files: ['src/router/reg-exp-router/router.ts'], review: R, diff: D.static, commit: '5be8d21', mainCommit: 'e2a1f04',
  ev: [[-900, 'asked'], [-896, 'claimed', 'src/router/reg-exp-router/router.ts'], [-895, 'working'], [-560, 'pushed'], [-550, 'reviewing'], [-500, 'approved'], [-495, 'queued'], [-480, 'testing', 'train T1'], [-440, 'landed', 'e2a1f04']] });
change(103, { title: 'Add an IP restriction middleware', intent: 'Allow or deny requests by client IP address with allow and deny lists, exported as hono/ip-restriction.', agent: 'agent-3',
  files: ['src/middleware/ip-restriction/index.ts', 'package.json', 'jsr.json'], provides: ['hono/ip-restriction'], review: R, diff: D.ip, commit: '0c77a3f', mainCommit: 'e2a1f04',
  ev: [[-860, 'asked'], [-858, 'claimed', 'src/middleware/ip-restriction/, package.json, jsr.json'], [-857, 'overlap', 'package.json: #101 claimed it too. Fine: export lists are merged by a rule'], [-856, 'working'], [-530, 'pushed'], [-520, 'reviewing'], [-498, 'approved'], [-492, 'queued'], [-480, 'testing', 'train T1'], [-440, 'landed', 'e2a1f04']] });
change(104, { title: 'Cookies: support Partitioned', intent: 'setCookie should accept partitioned: true and refuse it without Secure, as browsers do.', agent: 'agent-4',
  files: ['src/utils/cookie.ts', 'src/helper/cookie/index.test.ts'], review: R, diff: D.cookie, commit: '9a0e4c2', mainCommit: 'b5f0e93',
  ev: [[-520, 'asked'], [-517, 'working'], [-180, 'pushed'], [-170, 'reviewing'], [-110, 'approved'], [-100, 'queued'], [-25, 'testing', 'train T4'], [20, 'landed', 'b5f0e93']] });
change(105, { title: 'Fix CORS preflight for listed origins', intent: 'When origin is a list, a preflight request should echo the caller\'s origin if it is listed, and add Vary: Origin.', agent: 'agent-5',
  files: ['src/middleware/cors/index.ts', 'src/middleware/cors/index.test.ts'], review: R, diff: D.cors, commit: '1d4b7e8', mainCommit: 'b5f0e93',
  ev: [[-480, 'asked'], [-478, 'working'], [-150, 'pushed'], [-140, 'reviewing'], [-95, 'approved'], [-90, 'queued'], [-25, 'testing', 'train T4'], [20, 'landed', 'b5f0e93']] });
change(106, { title: 'Server-sent events: retry field', intent: 'writeSSE should send the retry field so clients know how long to wait before reconnecting.', agent: 'agent-6',
  files: ['src/helper/streaming/sse.ts'], review: R, diff: D.sse, commit: 'c3e81aa', mainCommit: '6ad94f1',
  ev: [[-400, 'asked'], [-398, 'working'], [-120, 'pushed'], [-112, 'reviewing'], [-60, 'approved'], [-55, 'queued'], [25, 'testing', 'train T5'], [70, 'landed', '6ad94f1']] });
change(107, { title: 'Trie router: optional parameters', intent: 'Routes like /docs/:page? should match both /docs and /docs/intro in TrieRouter, as they do in RegExpRouter.', agent: 'agent-7',
  files: ['src/router/trie-router/node.ts'], review: R, diff: D.trie, commit: '7f2c5d0',
  ev: [[-700, 'asked'], [-698, 'claimed', 'src/router/trie-router/node.ts'], [-697, 'working'], [-300, 'pushed'], [-290, 'reviewing'], [-250, 'approved'], [-245, 'queued'], [-240, 'testing', 'train T3'],
    [-200, 'bounced', 'Test failed: trie-router matches /docs/:page? when page is empty'], [40, 'working', 'Fixing the failed test']] });
change(108, { title: 'JWT middleware: verify with JWKS', intent: 'Let the JWT middleware fetch signing keys from a JWKS URL instead of a fixed secret.', agent: 'agent-8',
  files: ['src/middleware/jwt/index.ts', 'src/utils/jwt/jws.ts'], review: { verdict: 'changes', notes: 'Cache the JWKS response: fetching keys on every request is slow and can be rate limited.' }, diff: D.jwt,
  ev: [[-600, 'asked'], [-598, 'working'], [-60, 'pushed'], [-50, 'reviewing'], [15, 'changes-suggested', 'Cache the JWKS response: fetching keys on every request is slow'], [16, 'working', 'Adding a cache'], [90, 'pushed']] });
change(109, { title: 'Redirects keep the query string', intent: 'c.redirect() should be able to keep the current query string (option keepQuery).', agent: 'agent-9',
  files: ['src/context.ts'], review: R, diff: D.ctx,
  ev: [[-88, 'asked'], [-86, 'claimed', 'src/context.ts'], [-85, 'working']] });
change(110, { title: 'Validator: turn query numbers into numbers', intent: 'The query validator should optionally coerce "42" to 42 and "true" to true before validating.', agent: 'agent-10',
  files: ['src/validator/validator.ts', 'src/context.ts'], review: R, diff: D.validator, conflicts: ['src/context.ts'], lead: 'agent-2 (lead for src/)',
  ev: [[-560, 'asked'], [-558, 'claimed', 'src/validator/validator.ts, src/context.ts'], [-557, 'working'], [-230, 'pushed'], [-220, 'reviewing'], [-160, 'approved'], [-150, 'queued'],
    [-92, 'conflict', 'src/context.ts: #116 changed the same getter'], [-91, 'replaying', 'No rule for this kind of edit'], [-88, 'with-lead', 'No rule fits and AI replay is off for this project: agent-2, the lead for src/, decides']] });
change(111, { title: 'JSX: keep keyed list items when reordering', intent: 'When a keyed list is reordered, move the DOM nodes instead of re-creating them, so inputs keep focus.', agent: 'agent-11',
  files: ['src/jsx/dom/render.ts'], diff: D.jsx,
  ev: [[-330, 'asked'], [-328, 'claimed', 'src/jsx/dom/render.ts'], [-327, 'working']] });
change(112, { title: 'Serve static files from R2 with ETags', intent: 'serveStatic on Workers should send the object\'s ETag so browsers can cache files from R2.', agent: 'agent-12',
  files: ['src/adapter/cloudflare-workers/serve-static.ts'], review: R, diff: D.etag, diffEarly: false,
  ev: [[-280, 'asked'], [-278, 'working'], [-10, 'pushed'], [5, 'reviewing'], [35, 'approved'], [40, 'queued']] });
change(113, { title: 'Compress middleware: zstd', intent: 'Prefer zstd when the client accepts it; keep gzip and deflate as fallbacks.', agent: 'agent-1',
  files: ['src/middleware/compress/index.ts'], provides: ['zstd encoding'], review: R, diff: D.zstd, commit: 'f0a2b6c', mainCommit: '6ad94f1',
  ev: [[-262, 'asked'], [-260, 'claimed', 'src/middleware/compress/index.ts'], [-259, 'working'], [-130, 'pushed'], [-122, 'reviewing'], [-80, 'approved'], [-75, 'queued'], [25, 'testing', 'train T5'], [70, 'landed', '6ad94f1']] });
change(114, { title: 'Tests for zstd compression', intent: 'Add tests that zstd is chosen when accepted and gzip otherwise. Builds on #113 before it has landed.', agent: 'agent-3',
  files: ['src/middleware/compress/index.test.ts'], needs: ['113'], stackedOn: '113', review: R, diff: D.zstdTests, commit: '2b9d4e7', mainCommit: '6ad94f1',
  ev: [[-240, 'asked'], [-239, 'stacked', 'On #113 (Compress middleware: zstd), not yet landed'], [-238, 'working'], [-100, 'pushed'], [-94, 'reviewing'], [-70, 'approved'], [-66, 'queued', 'Lands right after #113'], [25, 'testing', 'train T5'], [70, 'landed', '6ad94f1']] });
change(115, { title: 'Add a request ID middleware', intent: 'Give every request an ID (from X-Request-Id or a new UUID), set it on the context and the response, exported as hono/request-id.', agent: 'agent-2',
  files: ['src/middleware/request-id/index.ts', 'package.json', 'jsr.json'], provides: ['hono/request-id'], review: R, diff: D.reqid, how: 'replayed-handler', conflicts: ['package.json'], commit: '8e1f3a9', mainCommit: '6ad94f1',
  ev: [[-420, 'asked'], [-418, 'claimed', 'src/middleware/request-id/, package.json, jsr.json'], [-417, 'overlap', 'package.json: #101 claimed it too'], [-416, 'working'], [-140, 'pushed'], [-132, 'reviewing'], [-40, 'approved'], [-35, 'queued'],
    [-8, 'conflict', 'package.json: #101 added hono/timing on the next line'], [-7, 'replaying', 'Rule for package.json exports: add the line again on the newest main'], [6, 'replayed', 'Same intent, re-applied; diff unchanged'], [25, 'testing', 'train T5'], [70, 'landed', '6ad94f1']] });
change(116, { title: 'Context: typed c.var', intent: 'c.var should be typed with the app\'s Variables so c.var.user needs no cast.', agent: 'agent-9',
  files: ['src/context.ts'], review: R, diff: D.cvar, commit: 'd6c0f12', mainCommit: '4c1e8b7',
  ev: [[-760, 'asked'], [-758, 'claimed', 'src/context.ts'], [-757, 'working'], [-180, 'pushed'], [-172, 'reviewing'], [-140, 'approved'], [-135, 'queued'], [-130, 'testing', 'train T6'], [-90, 'landed', '4c1e8b7']] });

const trains = [
  { id: 'T1', changes: ['103', '102'], startedAt: at(-480), endedAt: at(-440), mainBefore: '3f9c2e1', mainAfter: 'e2a1f04', checks: { ok: true, ms: 38200, failures: [] } },
  { id: 'T2', changes: ['101'], startedAt: at(-315), endedAt: at(-270), mainBefore: 'e2a1f04', mainAfter: 'e7d2b10', checks: { ok: true, ms: 41800, failures: [] } },
  { id: 'T3', changes: ['107'], startedAt: at(-240), endedAt: at(-200), mainBefore: 'e7d2b10', checks: { ok: false, ms: 36500, failures: ['src/router/trie-router/router.test.ts › optional params › matches /docs when :page? is empty'] } },
  { id: 'T6', changes: ['116'], startedAt: at(-130), endedAt: at(-90), mainBefore: 'e7d2b10', mainAfter: '4c1e8b7', checks: { ok: true, ms: 37100, failures: [] } },
  { id: 'T4', changes: ['104', '105'], startedAt: at(-25), endedAt: at(20), mainBefore: '4c1e8b7', mainAfter: 'b5f0e93', checks: { ok: true, ms: 44000, failures: [] } },
  { id: 'T5', changes: ['113', '114', '106', '115'], startedAt: at(25), endedAt: at(70), mainBefore: 'b5f0e93', mainAfter: '6ad94f1', checks: { ok: true, ms: 45500, failures: [] } },
];
const trainState = (tr, T) => (T < tr.startedAt ? null : T < tr.endedAt ? 'testing' : tr.checks.ok ? 'landed' : 'bounced');
const snapTrains = trains.map((tr) => ({ ...tr, state: trainState(tr, NOW) }));

const AREAS = [['src/router', 14], ['src/middleware', 61], ['src/helper', 27], ['src/adapter', 22], ['src/jsx', 31], ['src/utils', 24], ['src/validator', 4], ['src', 12], ['.', 9]];
const areaOf = (p) => { const s = p.split('/'); return s.length <= 1 ? '.' : s[0] === 'src' && s.length > 2 ? `src/${s[1]}` : s[0]; };
const DAY = 24 * 3600e3;
const areas = AREAS.map(([path, files]) => {
  const mine = changes.filter((c) => c.files.some((f) => areaOf(f) === path));
  return { path, files, working: mine.filter((c) => c.state === 'working').length,
    claimed: new Set(changes.filter((c) => !['landed', 'bounced'].includes(c.state)).flatMap((c) => c.claims).filter((f) => areaOf(f) === path)).size,
    recentConflicts: mine.filter((c) => c.events.some((e) => e.what === 'conflict' && e.t > NOW - DAY)).length + (path === 'src/middleware' ? 3 : path === '.' ? 4 : 0),
    recentLandings: mine.filter((c) => c.state === 'landed').length + ({ 'src/middleware': 6, 'src/router': 2, 'src/helper': 3, src: 2, '.': 5, 'src/utils': 2 }[path] || 0) };
});

const out = {
  now: NOW, mode: 'demo', demo: { running: true, agents: 12, speed: 1, startedAt: at(-900) }, flags: { llmReplay: false },
  queue: { trains: snapTrains.filter((t) => t.state), waiting: ['113', '114', '106'] },
  changes, areas,
  stats: { landedToday: 23, inQueue: 5, bounced: 2, replayed: 7, medianAskToLandS: 412 },
  mock: { note: 'Mock only: changes[].future and mock.trains let the UI play the next two minutes.', trains, playS: [-20, 110] },
};
writeFileSync(new URL('../../public/landing-mock.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(`wrote ${changes.length} changes, ${out.queue.trains.length} trains; states:`, Object.entries(changes.reduce((a, c) => ((a[c.state] = (a[c.state] || 0) + 1), a), {})).map((x) => x.join('=')).join(' '));
