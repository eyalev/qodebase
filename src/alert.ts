// Push alerts for what a person must act on (baseline section 8). Own module so
// auth.ts and build.ts can import it without pulling in the UI.
//
// Through notify-hub since 2026-11-16 (Eyal: "move rest of notifications from
// pushover to beacon"): app `forq`, secret NOTIFY_HUB_TOKEN. A state alert
// carries a subject, so a repeat replaces it on the phone and resolveAlert()
// takes it back once the cause is gone. Pushover (PUSHOVER_TOKEN /
// PUSHOVER_USER) is only the fallback when the notify-hub POST fails.
import type { Env } from './env';

type AlertEnv = Env & { PUSHOVER_TOKEN?: string; PUSHOVER_USER?: string; NOTIFY_HUB_TOKEN?: string };
type AlertOpts = { topic?: string; subject?: string; level?: 'alarm' | 'decide' | 'fyi' };
const HUB = 'https://notify.kapps.dev';
const log = (event: string, data: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: event.endsWith('_failed') ? 'error' : 'info', module: 'alert', event, ...data }));

async function hub(env: AlertEnv, path: string, body: Record<string, unknown>): Promise<boolean> {
  if (!env.NOTIFY_HUB_TOKEN) return false;
  try {
    const r = await fetch(HUB + path, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.NOTIFY_HUB_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    log(r.ok ? 'hub_ok' : 'hub_failed', { path, status: r.status, topic: body.topic, subject: body.subject });
    return r.ok;
  } catch (err) { log('hub_failed', { path, err: String(err) }); return false; }
}

/** notify-hub, else Pushover to Eyal. Never throws: an alert failing must not fail the caller. */
export async function pushAlert(env: AlertEnv, title: string, message: string, url?: string, priority = 0, opts: AlertOpts = {}) {
  const sent = await hub(env, '/api/events', {
    topic: opts.topic || 'alert', subject: opts.subject, level: opts.level,
    title: title.slice(0, 250), body: message.slice(0, 2000), url,
    priority: priority > 0 ? 'high' : priority < 0 ? 'low' : 'normal',
  });
  if (sent) return;
  if (!env.PUSHOVER_TOKEN || !env.PUSHOVER_USER) { log('alert_unconfigured', { title }); return; }
  const form = new FormData();
  form.set('token', env.PUSHOVER_TOKEN); form.set('user', env.PUSHOVER_USER);
  form.set('title', title.slice(0, 250)); form.set('message', message.slice(0, 1024)); form.set('priority', String(priority));
  if (url) form.set('url', url);
  try {
    const r = await fetch('https://api.pushover.net/1/messages.json', { method: 'POST', body: form });
    log(r.ok ? 'alert_sent' : 'alert_failed', { title, status: r.status, via: 'pushover' });
  } catch (err) { log('alert_failed', { title, err: String(err) }); }
}

/** The cause behind a state alert is gone: notify-hub closes it and Beacon takes it back. */
export async function resolveAlert(env: AlertEnv, topic: string, subject: string, why: string): Promise<boolean> {
  return hub(env, '/api/events/resolve', { topic, subject, why });
}
