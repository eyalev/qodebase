// Push alerts for what a person must act on (baseline section 8): Pushover to
// Eyal, from the forq secrets PUSHOVER_TOKEN / PUSHOVER_USER. Own module so
// auth.ts and build.ts can import it without pulling in the UI.
import type { Env } from './env';

type AlertEnv = Env & { PUSHOVER_TOKEN?: string; PUSHOVER_USER?: string };
const log = (event: string, data: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: event === 'alert_failed' ? 'error' : 'info', module: 'alert', event, ...data }));


/** Pushover to Eyal. Never throws: an alert failing must not fail the caller. */
export async function pushAlert(env: AlertEnv, title: string, message: string, url?: string, priority = 0) {
  if (!env.PUSHOVER_TOKEN || !env.PUSHOVER_USER) { log('alert_unconfigured', { title }); return; }
  const form = new FormData();
  form.set('token', env.PUSHOVER_TOKEN); form.set('user', env.PUSHOVER_USER);
  form.set('title', title.slice(0, 250)); form.set('message', message.slice(0, 1024)); form.set('priority', String(priority));
  if (url) form.set('url', url);
  try {
    const r = await fetch('https://api.pushover.net/1/messages.json', { method: 'POST', body: form });
    log(r.ok ? 'alert_sent' : 'alert_failed', { title, status: r.status });
  } catch (err) { log('alert_failed', { title, err: String(err) }); }
}

