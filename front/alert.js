// A push to Eyal's phone, through notify-hub (app "forq", the same app forq's src/alert.ts uses;
// secret NOTIFY_TOKEN on this Worker). Never gets in the way: an alert that fails is logged and dropped.
export async function alert(env, event) {
  if (!env.NOTIFY_TOKEN) { console.log(JSON.stringify({ module: 'alert', event: 'alert_unconfigured', topic: event.topic })); return; }
  try {
    const res = await fetch('https://notify.kapps.dev/api/events', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.NOTIFY_TOKEN}` }, body: JSON.stringify(event), signal: AbortSignal.timeout(3000) });
    if (!res.ok) console.log(JSON.stringify({ module: 'alert', event: 'alert_failed', status: res.status, topic: event.topic }));
  } catch (err) {
    console.log(JSON.stringify({ module: 'alert', event: 'alert_failed', topic: event.topic, error: String(err) }));
  }
}
