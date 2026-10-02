// Public-site baseline (~/.claude/docs/public-project-baseline.md), 2026-10-02:
// share cards (og-cards), first-party analytics (kstats via a same-origin /e),
// the feedback form (remote-manage's central inbox), /health.json in the
// Health-view contract, and push alerts for what a person must act on.
// Everything here is outside the page templates: HTML responses are rewritten
// on the way out (withBaseline), so the UI files stay the UI tab's.
import type { Env } from './env';
import { shell } from './ui';
import { registry } from './registry';
import { pushAlert } from './alert';

export type BaselineEnv = Env & { OG_KEY?: string; KSTATS_KEY?: string; FEEDBACK_KEY?: string; PUSHOVER_TOKEN?: string; PUSHOVER_USER?: string };

const KSTATS_SITE = 'forq';
const KSTATS_COLLECTOR = 'https://stats.kapps.dev/e';
const INBOX = 'https://remote-manage.kapps.dev/api/agent/feedback';

const log = (event: string, data: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: /fail|error/.test(event) ? 'error' : 'info', module: 'baseline', event, ...data }));
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/* ---------------------------------------------------------------- head tags */

/** Adds the kstats tag and share-card tags to every forq HTML page on the UI
 *  host (and the design variants, which forward to it). Leaves pages that
 *  already carry og:image alone. */
export async function withBaseline(request: Request, env: BaselineEnv, res: Response): Promise<Response> {
  if (!(res.headers.get('content-type') || '').startsWith('text/html') || res.status !== 200) return res;
  const url = new URL(request.url);
  const host = request.headers.get('x-forq-host') || url.hostname;
  let title = '';
  let desc = '';
  let hasOg = false;
  // Pass 1 would need the body twice; instead read title/description as the
  // stream passes and write the tags at </head>, which comes after both.
  return new HTMLRewriter()
    .on('title', { text(t) { title += t.text; } })
    .on('meta[name="description"]', { element(e) { desc = e.getAttribute('content') || desc; } })
    .on('meta[property="og:image"]', { element() { hasOg = true; } })
    .on('head', {
      element(e) {
        e.onEndTag(async (end) => {
          const tags = [`<script defer src="https://stats.kapps.dev/k.js" data-site="${KSTATS_SITE}"></script>`];
          if (!hasOg) tags.push(...await shareTags(env, host, url.pathname, title, desc));
          end.before(tags.join(''), { html: true });
        });
      },
    })
    .transform(res);
}

async function shareTags(env: BaselineEnv, host: string, path: string, rawTitle: string, desc: string): Promise<string[]> {
  const title = rawTitle.replace(/\s*·\s*forq(\s*\([A-D]\))?\s*$/, '').trim() || 'forq';
  const page = `https://${host}${path}`;
  const tags = [
    `<meta property="og:site_name" content="forq">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:url" content="${esc(page)}">`,
    `<meta property="og:type" content="website">`,
  ];
  if (desc) tags.push(`<meta property="og:description" content="${esc(desc)}">`);
  if (env.OG_KEY) {
    const project = path.match(/^\/p\/([a-z0-9-]+)\/([a-z0-9.-]+)/);
    const spec = {
      v: 1, layout: 'text',
      ...(project ? { eyebrow: `${project[1]}/${project[2]}` } : {}),
      title: project && title.startsWith(`${project[1]}/`) ? (desc || title) : title,
      ...(desc && !(project && title.startsWith(`${project[1]}/`)) ? { subtitle: desc.slice(0, 400) } : {}),
      footer: env.UI_HOST,
    };
    const img = await signedCard(env.OG_KEY, spec);
    tags.push(`<meta property="og:image" content="${img}">`, `<meta property="og:image:width" content="1200">`, `<meta property="og:image:height" content="630">`, `<meta name="twitter:card" content="summary_large_image">`);
  }
  return tags;
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let ogKey: Promise<CryptoKey> | undefined;
/** og-cards contract: /forq/<b64url(spec JSON)>.<b64url(HMAC-SHA256(payload string))>.png */
async function signedCard(secret: string, spec: unknown): Promise<string> {
  ogKey ||= crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const payload = b64url(new TextEncoder().encode(JSON.stringify(spec)));
  const sig = b64url(new Uint8Array(await crypto.subtle.sign('HMAC', await ogKey, new TextEncoder().encode(payload))));
  return `https://og.kapps.dev/forq/${payload}.${sig}.png`;
}

/* ------------------------------------------------------------------ kstats */

/** Same-origin /e (kstats integrations/cloudflare-worker.js): GET ?self=1 marks
 *  this browser as ours, POST forwards the beacon with the visitor's network. */
export function kstatsForward(request: Request, env: BaselineEnv, ctx: ExecutionContext): Response {
  if (request.method === 'GET') {
    const on = new URL(request.url).searchParams.get('self') !== '0';
    return new Response(`<!doctype html><meta charset=utf-8><title>kstats</title><body style="font:15px system-ui;padding:2rem">
<script>try{${on ? "localStorage.setItem('k:self','1')" : "localStorage.removeItem('k:self')"};document.body.append('${on ? 'This browser is now excluded from stats on ' : 'This browser is counted again on '}'+location.hostname)}catch(e){document.body.append('localStorage unavailable')}</script>`,
      { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  }
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  const cf = (request as any).cf || {};
  ctx.waitUntil(fetch(KSTATS_COLLECTOR, {
    method: 'POST', body: request.body,
    headers: {
      'content-type': 'application/json', 'x-k-key': env.KSTATS_KEY || '',
      'x-k-ip': request.headers.get('cf-connecting-ip') || '', 'x-k-ua': request.headers.get('user-agent') || '',
      'x-k-cc': cf.country || '', 'x-k-vbot': cf.verifiedBotCategory || '',
      'x-k-asn': String(cf.asn || ''), 'x-k-asorg': cf.asOrganization || '',
    },
  }).then((r) => { if (!r.ok) log('kstats_forward_failed', { status: r.status }); })
    .catch((err) => log('kstats_forward_failed', { err: String(err) })));
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

/* ---------------------------------------------------------------- feedback */

const KINDS = [['problem', 'Something is wrong'], ['idea', 'An idea'], ['praise', 'I like it'], ['other', 'Something else']] as const;

/** Coarse device: os/browser, never the full user agent. */
function device(ua: string) {
  const os = /Android/.test(ua) ? 'android' : /iPhone|iPad/.test(ua) ? 'ios' : /Mac OS X/.test(ua) ? 'mac' : /Windows/.test(ua) ? 'windows' : /Linux/.test(ua) ? 'linux' : 'other';
  const br = /Edg\//.test(ua) ? 'edge' : /Firefox\//.test(ua) ? 'firefox' : /Chrome\//.test(ua) ? 'chrome' : /Safari\//.test(ua) ? 'safari' : 'other';
  return `${os}/${br}`;
}
const safeFrom = (s: string | null) => (s && s.startsWith('/') && !s.startsWith('//') ? s.slice(0, 300) : '/');

function feedbackPage(o: { from: string; kind?: string; msg?: string; email?: string; error?: string; done?: boolean }) {
  const body = o.done
    ? `<h1>Thank you</h1><p class="desc">It reached us. If you left an email, a person will answer.</p><div class="actions"><a class="btn" href="${esc(o.from)}">Back to where you were</a></div>`
    : `<h1>Feedback</h1>
<p class="desc">What is wrong, missing or good. A person reads every message.</p>
${o.error ? `<p class="fb-err" role="alert">${esc(o.error)}</p>` : ''}
<form method="post" action="/feedback" class="fb">
<input type="hidden" name="from" value="${esc(o.from)}"><input type="hidden" name="self" value="0" id="fbself">
<fieldset><legend>It is about</legend>${KINDS.map(([v, l]) => `<label><input type="radio" name="kind" value="${v}"${(o.kind || 'problem') === v ? ' checked' : ''}> ${l}</label>`).join('')}</fieldset>
<label for="fbmsg">Message</label><textarea id="fbmsg" name="msg" required maxlength="5000" rows="6">${esc(o.msg || '')}</textarea>
<label for="fbmail">Email, only to reply (optional)</label><input id="fbmail" class="field" type="email" name="email" value="${esc(o.email || '')}" autocomplete="email">
<div class="hp" aria-hidden="true"><label>Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label></div>
<div class="bar"><button class="btn">Send</button></div>
<p class="note">Sent from ${esc(o.from)}. We keep the message, the page, the kind of device and the email if you give one. See <a href="/privacy">Privacy</a>.</p>
</form>
<script>try{if(localStorage.getItem('k:self')==='1')document.getElementById('fbself').value='1'}catch(e){}</script>`;
  return shell('Feedback · forq', `<a class="back" href="${esc(o.from)}">Back</a>
${body}
<style>.fb{display:grid;gap:8px;margin-top:16px}.fb fieldset{border:0;padding:0;margin:0 0 8px;display:grid;gap:8px}.fb legend{font-weight:600;margin-bottom:4px}
.fb label{font-size:15px}.fb fieldset label{display:flex;align-items:center;gap:10px;min-height:44px;padding:0 12px;border:1px solid var(--line);border-radius:8px;background:var(--card)}
.fb textarea,.fb .field{width:100%;font:16px 'Instrument Sans',sans-serif;padding:12px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg)}
.fb .bar{margin-top:8px}.fb .note{color:var(--dim);font-size:14px}.hp{position:absolute;left:-9999px}.fb-err{color:var(--warn,#b45309);font-weight:500}</style>`);
}

export async function feedback(request: Request, env: BaselineEnv): Promise<Response> {
  const page = (o: Parameters<typeof feedbackPage>[0], status = 200) =>
    new Response(feedbackPage(o), { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  const url = new URL(request.url);
  if (request.method === 'GET') return page({ from: safeFrom(url.searchParams.get('from')) });
  if (request.method !== 'POST') return new Response(null, { status: 405 });

  const f = await request.formData().catch(() => null);
  const get = (k: string) => String(f?.get(k) ?? '').trim();
  const o = { from: safeFrom(get('from')), kind: KINDS.some(([v]) => v === get('kind')) ? get('kind') : 'other', msg: get('msg').slice(0, 5000), email: get('email').slice(0, 200) };
  // A bot that fills the honeypot gets the same thank-you a person gets.
  if (get('website')) { log('feedback_honeypot', { from: o.from }); return page({ from: o.from, done: true }); }
  if (!o.msg) return page({ ...o, error: 'Write a message first.' }, 400);

  const self = get('self') === '1';
  const body = { project: 'forq', kind: o.kind, msg: o.msg, email: o.email || undefined, page: `https://${request.headers.get('x-forq-host') || url.hostname}${o.from}`, loc: 'en', dev: device(request.headers.get('user-agent') || ''), self };
  let r: Response | null = null;
  try {
    r = await fetch(INBOX, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.FEEDBACK_KEY || ''}` }, body: JSON.stringify(body) });
  } catch (err) { log('feedback_store_failed', { err: String(err), stack: (err as Error)?.stack }); }
  if (r?.ok) { log('feedback_stored', { kind: o.kind, self }); return page({ from: o.from, done: true }); }
  // Not stored: this push is the only copy, so it carries the whole text.
  log('feedback_store_failed', { status: r?.status ?? 0, body: r ? (await r.text().catch(() => '')).slice(0, 200) : '' });
  await pushAlert(env, 'forq feedback NOT stored', `${o.kind} from ${o.email || 'no email'} on ${o.from}:\n${o.msg}`, body.page, 1);
  return page({ ...o, error: 'It did not go through on our side. Your text is still here: try again, or email hello@kapps.dev.' }, 502);
}

/* ------------------------------------------------------------------ health */

/** /health.json for remote-manage's Health view: {sha, built, checks}. The one
 *  check is a Worker app whose last deploy failed; memoised 5 min per colo. */
export async function health(env: BaselineEnv, ctx: ExecutionContext, origin: string): Promise<Response> {
  const cache = caches.default;
  // Keyed by version: a deploy must not answer with the previous version's memo
  // (the edge kept one for hours under its own browser-TTL default, 2026-10-02).
  const key = new Request(`${origin}/health.json?memo=${env.CF_VERSION_METADATA?.id || 'none'}`);
  const hit = await cache.match(key);
  if (hit) return new Response(hit.body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  const checks: { id: string; label: string; status: string; detail: string; at: string }[] = [];
  const at = new Date().toISOString();
  try {
    const entries = await registry(env).list();
    const infos = await Promise.all(entries.map((e) => env.Project.get(env.Project.idFromName(e.slug)).info().catch(() => null)));
    // Only deploys forq runs (owner's and showcase); others' are refused by design.
    const failed = infos.filter((i) => i?.kind === 'worker' && i.app?.status === 'failed' && (i.owner === env.OWNER_HANDLE || i.owner === 'forq')).map((i) => i!.slug);
    checks.push({ id: 'builds', label: 'Worker app deploys', status: failed.length ? 'bad' : 'ok', detail: failed.length ? `${failed.length} failed: ${failed.slice(0, 3).join(', ')}` : `${infos.filter((i) => i?.kind === 'worker').length} live`, at });
  } catch (err) {
    checks.push({ id: 'builds', label: 'Worker app deploys', status: 'unknown', detail: `could not read: ${String(err).slice(0, 80)}`, at });
  }
  const res = new Response(JSON.stringify({ sha: env.CF_VERSION_METADATA?.tag || null, version: env.CF_VERSION_METADATA?.id || null, built: env.CF_VERSION_METADATA?.timestamp || null, checks }),
    { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  const memo = new Response(res.clone().body, { headers: { 'content-type': 'application/json', 'cache-control': 's-maxage=300' } });
  ctx.waitUntil(cache.put(key, memo));
  return res;
}
