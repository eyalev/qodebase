// hello@qodebase.app, read as it arrives (Email Routing rule -> this Worker's email handler).
// Copied from qonttent's src/email.js (itself modelled on globalradio's worker/email-in.js, without the AI
// reading): qodebase is paused and has no intake
// queue to fill, so a mail only has to reach Gmail and, if a person wrote it, Eyal's phone.
//
//   * THE MAIL ALWAYS REACHES GMAIL. Forwarding comes first and nothing after it can undo it. If the
//     forward fails we still push (as an alarm), then rethrow so the sender gets a bounce instead of
//     silence.
//   * Only the headers are read. No body is parsed or stored; nothing about the mail is kept here
//     beyond the log line (sender's domain, not the address).
//   * Pushes are capped by EMAIL_PUSH_LIMIT (per location per minute), so a flood cannot ring the
//     phone all night; the mail is in Gmail either way.

export const FORWARD_TO = 'eyalev@gmail.com';
const log = (event, o = {}) => console.log(JSON.stringify({ module: 'email-in', event, ...o }));

const addressOf = (from) => (/<([^<>\s]+@[^<>\s]+)>/.exec(from || '') || /([^\s<>"]+@[^\s<>"]+)/.exec(from || ''))?.[1]?.toLowerCase() || null;

/** Cloudflare prepends its own Authentication-Results; the first dmarc= after mx.cloudflare.net is its. */
export function dmarcOf(header) {
  if (!/^\s*mx\.cloudflare\.net\b/i.test(header || '')) return null;
  return /\bdmarc=([a-z]+)/i.exec(header)?.[1]?.toLowerCase() || null;
}

/** 'automated' (no push) or 'person', from the headers alone. */
export function triage(h, addr) {
  addr = addr || '';
  if (addr.endsWith('@qodebase.app')) return { action: 'automated', why: 'our own address' };
  if (/^(no-?reply|.*-no-?reply|mailer-daemon|postmaster|bounces?)[@+.-]/i.test(addr)
    || (h.get('auto-submitted') && !/^no\b/i.test(h.get('auto-submitted')))
    || /^(bulk|list|junk|auto_reply)$/i.test(h.get('precedence') || '')
    || h.get('list-id') || h.get('list-unsubscribe')) return { action: 'automated', why: 'automated mail' };
  return { action: 'person', why: null };
}

export async function handleEmail(message, env, ctx, { alert } = {}) {
  const h = message.headers;
  const subject = String(h.get('subject') || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 200);
  const addr = addressOf(h.get('from')) || addressOf(message.from);
  const dmarc = dmarcOf(h.get('authentication-results'));
  const messageId = h.get('message-id') || null;
  const domain = addr ? addr.split('@')[1] : null;

  let forwardError = null;
  try { await message.forward(FORWARD_TO); }
  catch (e) { forwardError = e; console.error(JSON.stringify({ module: 'email-in', event: 'forward_failed', to: message.to, domain, error: String(e), stack: e?.stack })); }

  const t = triage(h, addr);
  let pushed = false, capped = false;
  if (forwardError || t.action === 'person') {
    const ok = env.EMAIL_PUSH_LIMIT ? (await env.EMAIL_PUSH_LIMIT.limit({ key: 'email' }).catch(() => ({ success: true }))).success : true;
    if (!ok && !forwardError) capped = true;
    else if (alert) {
      const gmail = messageId ? 'https://mail.google.com/mail/u/0/#search/' + encodeURIComponent('rfc822msgid:' + messageId.replace(/^<|>$/g, '')) : 'https://mail.google.com/';
      await alert(env, {
        topic: 'email', level: forwardError ? 'alarm' : 'decide',
        title: forwardError ? 'qodebase: email to ' + message.to + ' NOT in Gmail' : 'qodebase: email to ' + message.to,
        body: [subject ? 'subject: ' + subject : '(no subject)', 'from: ' + (addr || 'unknown') + (dmarc === 'pass' ? '' : ' (unverified)'), forwardError ? 'forward failed: ' + String(forwardError).slice(0, 160) : null].filter(Boolean).join('\n'),
        url: gmail, priority: forwardError ? 'high' : 'normal',
        subject: messageId ? 'mail:' + messageId : undefined,
      });
      pushed = true;
    }
  }
  log('done', { to: message.to, domain, dmarc, action: t.action, why: t.why, forwarded: !forwardError, pushed, capped, size: message.rawSize });
  if (forwardError) throw forwardError;
}