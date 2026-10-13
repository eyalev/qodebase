// Talk traces for the admin (Eyal, 2026-10-13, "full traceability so we can improve it from evidence"):
// every utterance of the people who are traced (the owner; others only after "Help improve Talk"), as one row
// with what was heard, decided and done, plus the likely misses (said again within 10 s, answered no, went back,
// an error, not understood), and one utterance's whole trace with its recording (the owner's, 14 days).
//   GET /api/talk/admin                     the page (also /admin/talk through forq)
//   GET /api/talk/admin/utterances?days=2&miss=1&handle=&q=   JSON list, newest first
//   GET /api/talk/admin/utterance?u=<id>&day=YYYY-MM-DD       JSON: rows + recording key
//   GET /api/talk/admin/clip?key=<key>                         the recording
// Admin only: the owner signed in, or forq's admin secret (x-talk-who admin:true).
import type { Env } from './env';
import { isOwner } from './auth';
import type { Who } from './talk';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const days = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10));
const short = (s: unknown, n = 160) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

type Row = { ts: number; handle: string; sid: string; ev: string; d: any };
export type Utterance = {
  u: string; day: string; handle: string; sid: string; start: number; end: number; ms: number; path: string;
  said: string; engine: string; live: string; final: string; unrepeated?: string; decided?: string; label?: string;
  href?: string; p?: number | null; chat?: string; tools?: string[]; did: string[]; misses: string[]; errors: string[];
  clip?: boolean;
};

async function rowsFor(env: Env, day: string, handle: string): Promise<Row[]> {
  const raw = await env.TalkLog.get(env.TalkLog.idFromName(day)).readAll(0, 20000, handle).catch(() => []) as any[];
  return raw.map((r) => { let d: any = {}; try { d = JSON.parse(r.data || '{}'); } catch { /* keep {} */ } return { ts: r.ts, handle: r.handle, sid: r.sid, ev: r.ev, d }; });
}

/** Rows → utterances (rows tagged with the same u), with the misses worked out from what came next. */
export function group(rows: Row[], day: string): Utterance[] {
  const by = new Map<string, Row[]>();
  for (const r of rows) { const u = r.d?.u; if (!u) continue; (by.get(u) || by.set(u, []).get(u)!).push(r); }
  const out: Utterance[] = [];
  for (const [u, rs] of by) {
    rs.sort((a, b) => a.ts - b.ts);
    const f = (ev: string | RegExp) => rs.filter((r) => typeof ev === 'string' ? r.ev === ev : ev.test(r.ev));
    const said = f('said')[0]?.d?.text || '';
    const wh = f('dc_whisper').slice(-1)[0]?.d;
    const interim = f(/^dc_(interim|piece)$/).map((r) => r.d?.text).filter(Boolean).slice(-1)[0] || '';
    const dec = f('srv_decide').slice(-1)[0]?.d;
    const ch = f('srv_chat').slice(-1)[0]?.d;
    const st = f('srv_status').slice(-1)[0]?.d;
    const did = f(/^(act|nav_check|page_action|arrived|offer_tap|offer_voice|example|suggest|change|follow_confirm|gate)$/).map((r) => `${r.ev} ${short(JSON.stringify({ ...r.d, u: undefined }), 140)}`);
    const errors = f(/error|missing|fail/).map((r) => `${r.ev} ${short(JSON.stringify({ ...r.d, u: undefined }), 200)}`);
    const misses: string[] = [];
    if (f(/^offer_(voice|tap)$/).some((r) => r.d?.answer === 'no')) misses.push('answered no');
    if (f('listen_cancel').length) misses.push('cancelled');
    if (errors.length) misses.push('error');
    if (f('nav_check').some((r) => r.d?.ok === false)) misses.push('bad page');
    if (dec && (dec.cmd?.mode === 'none' || dec.cmd?.op === 'none') && !ch && !st) misses.push('not understood');
    const start = rs[0].ts, end = rs[rs.length - 1].ts;
    out.push({
      u, day, handle: rs[0].handle, sid: rs[0].sid, start, end, ms: end - start, path: rs[0].d?.path || rs.find((r) => r.d?.path)?.d?.path || '',
      said: short(said, 400), engine: f('said')[0]?.d?.engine || (wh ? 'live' : 'typed'), live: short(wh?.live || interim, 400), final: short(wh?.final || said, 400),
      unrepeated: wh?.unrepeated ? short(wh.unrepeated, 400) : undefined,
      decided: dec ? `${dec.cmd?.mode}/${dec.cmd?.op}` : undefined, label: dec?.cmd?.label, href: dec?.cmd?.href, p: dec?.cmd?.p ?? null,
      chat: ch ? short(ch.reply, 300) : st ? short(st.text, 300) : undefined, tools: ch?.tools?.map((t: any) => `${t.name} ${short(JSON.stringify(t.args), 60)}`),
      did, misses, errors,
    });
  }
  // Said again within 10 s in the same tab, or went back within 10 s of a page Talk opened: the first one likely missed.
  out.sort((a, b) => a.start - b.start);
  const bySid = new Map<string, Utterance[]>();
  for (const x of out) (bySid.get(x.sid) || bySid.set(x.sid, []).get(x.sid)!).push(x);
  for (const list of bySid.values()) for (let i = 0; i + 1 < list.length; i++) {
    const a = list[i], b = list[i + 1];
    const answer = /^(yes|yeah|yep|no|nope|ok|okay|sure|cancel)\b/i.test(b.said || '');
    if (!answer && b.start - a.end < 10_000) a.misses.push('said again');
  }
  const backs = rows.filter((r) => r.ev === 'page' && r.d?.nav === 'back_forward');
  for (const x of out) if (x.did.some((d) => /^arrived|^act .*"op":"go"/.test(d)) && backs.some((r) => r.sid === x.sid && r.ts > x.end && r.ts - x.end < 10_000)) x.misses.push('went back');
  return out.reverse();
}

export async function talkAdmin(request: Request, env: Env, url: URL, who: Who): Promise<Response> {
  if (!who || !(who.admin || isOwner(env, who.handle))) return json({ error: 'forbidden' }, 403);
  const sub = url.pathname.replace(/^\/api\/talk\/admin\/?/, '');
  if (sub === 'utterances') {
    const n = Math.min(14, Math.max(1, Number(url.searchParams.get('days')) || 2));
    const handle = (url.searchParams.get('handle') || '').slice(0, 40);
    const q = (url.searchParams.get('q') || '').toLowerCase();
    let list: Utterance[] = [];
    for (const d of days(n)) list = list.concat(group(await rowsFor(env, d, handle), d));
    if (url.searchParams.get('miss') === '1') list = list.filter((x) => x.misses.length);
    if (q) list = list.filter((x) => (x.said + ' ' + x.final + ' ' + x.path + ' ' + (x.chat || '')).toLowerCase().includes(q));
    const limit = Math.min(1000, Number(url.searchParams.get('limit')) || 300);
    const counts = { all: list.length, missed: list.filter((x) => x.misses.length).length };
    return json({ days: n, counts, utterances: list.slice(0, limit) });
  }
  if (sub === 'utterance') {
    const u = (url.searchParams.get('u') || '').slice(0, 24), day = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('day') || '') ? url.searchParams.get('day')! : days(1)[0];
    const all = await rowsFor(env, day, '');
    const rows = all.filter((r) => r.d?.u === u);
    if (!rows.length) return json({ error: 'not found' }, 404);
    // The tab's rows around it too (what came just before and after), for context.
    const t0 = rows[0].ts, t1 = rows[rows.length - 1].ts, sid = rows[0].sid;
    const around = all.filter((r) => r.sid === sid && r.d?.u !== u && r.ts > t0 - 15_000 && r.ts < t1 + 15_000);
    let clip: string | null = null;
    if (env.CLIPS) { const l = await env.CLIPS.list({ prefix: day + '/', limit: 1000 } as any); clip = (l.objects.find((o: any) => o.key.includes(`-${u}.`)) as any)?.key || null; }
    return json({ u, day, utterance: group(all.filter((r) => r.d?.u === u || r.sid === sid), day).find((x) => x.u === u), rows, around, clip });
  }
  // Latency per stage of spoken turns (the page's 'latency' rows, ms from the stop; manager 2026-10-13): p50 / p90.
  if (sub === 'latency') {
    const n = Math.min(14, Math.max(1, Number(url.searchParams.get('days')) || 2));
    const handle = (url.searchParams.get('handle') || '').slice(0, 40);
    const rows: any[] = [];
    for (const d of days(n)) for (const r of await rowsFor(env, d, handle)) if (r.ev === 'latency' && r.d) rows.push(r.d);
    return json({ days: n, ...latencyTable(rows) });
  }
  if (sub === 'clip') {
    const key = url.searchParams.get('key') || '';
    const o = env.CLIPS && key ? await env.CLIPS.get(key) : null;
    if (!o) return json({ error: 'gone', why: 'Recordings are deleted after 14 days.' }, 404);
    return new Response(o.body, { headers: { 'content-type': o.httpMetadata?.contentType || 'audio/webm', 'cache-control': 'private, no-store' } });
  }
  if (sub === '') return new Response(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
  return json({ error: 'not found' }, 404);
}

export const LAT_STAGES = ['end', 'final', 'decide', 'data', 'ack', 'audio', 'total'] as const;
const pct = (xs: number[], q: number) => { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(q * a.length))]; };
/** p50 / p90 per stage over latency rows; 'end' = last word heard -> stop, 'total' = last word -> first sound. */
export function latencyTable(rows: any[]) {
  const by = (list: any[]) => Object.fromEntries(LAT_STAGES.map((k) => { const xs = list.map((r) => r[k]).filter((v) => typeof v === 'number' && v >= 0 && v < 120_000); return [k, { n: xs.length, p50: pct(xs, 0.5), p90: pct(xs, 0.9) }]; }));
  const lanes: Record<string, any[]> = {};
  for (const r of rows) (lanes[r.lane || 'other'] ||= []).push(r);
  return { n: rows.length, all: by(rows), lanes: Object.fromEntries(Object.entries(lanes).map(([k, v]) => [k, { n: v.length, ...by(v) }])) };
}

// One page, phone first, the site's tokens (DESIGN.md). Plain DOM, no libraries.
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Talk traces · qodebase</title>
<style>
:root{--bg:#fff;--card:#fafafa;--chip:#f3f4f6;--line:#ececef;--fg:#111214;--dim:#6e737b;--acc:#17695a;--acc-fg:#fff;--warn:#b42d1f}
@media (prefers-color-scheme:dark){:root{--bg:#0c0d0e;--card:#141517;--chip:#1c1d20;--line:#222428;--fg:#ececee;--dim:#9a9fa6;--acc:#4fbf9f;--acc-fg:#0f1112;--warn:#f08a7e}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 Geist,ui-sans-serif,sans-serif;-webkit-tap-highlight-color:transparent}
main{max-width:760px;margin:0 auto;padding:16px}h1{font-size:22px;letter-spacing:-.02em;margin:4px 0 12px}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
.bar label{display:flex;gap:6px;align-items:center;min-height:44px;font-size:15px}
.bar input[type=search],.bar select{min-height:44px;font:16px inherit;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--fg);padding:0 12px}
.bar input[type=search]{flex:1;min-width:160px}
.n{font-size:13px;color:var(--dim);font-variant-numeric:tabular-nums}
ul{list-style:none;margin:0;padding:0}
li.u{position:relative;padding:12px 14px;margin:0 0 8px;border-radius:14px;background:var(--card);cursor:pointer}
li.u .t{font-size:13px;color:var(--dim);display:flex;gap:12px;flex-wrap:wrap;font-variant-numeric:tabular-nums}
li.u .s{font-size:15px;margin:4px 0}
li.u .r{font-size:13px;color:var(--dim)}
.tag{display:inline-block;font-size:12px;padding:1px 6px;border-radius:4px;background:var(--chip);margin-right:4px}
.tag.m{background:var(--warn);color:#fff}
#d{position:fixed;inset:0;background:var(--bg);overflow:auto;display:none;padding:16px}
#d.on{display:block}#d .in{max-width:760px;margin:0 auto}
button{min-height:44px;padding:0 14px;border:0;border-radius:10px;background:var(--chip);color:var(--fg);font:15px inherit;cursor:pointer}
dl{display:grid;grid-template-columns:110px 1fr;gap:4px 12px;font-size:15px;margin:12px 0}dt{color:var(--dim)}dd{margin:0;overflow-wrap:anywhere}
table{width:100%;border-collapse:collapse;font-size:13px}td{border-top:1px solid var(--line);padding:6px 4px;vertical-align:top;overflow-wrap:anywhere}
td:first-child{white-space:nowrap;color:var(--dim);font-variant-numeric:tabular-nums}
audio{width:100%;margin:8px 0}
</style></head><body><main>
<h1>Talk traces</h1>
<div class="bar"><input type="search" id="q" placeholder="Words, page" aria-label="Search the traces"><label><input type="checkbox" id="miss"> Misses only</label>
<select id="days" aria-label="How far back"><option value="1">Today</option><option value="2" selected>2 days</option><option value="7">7 days</option><option value="14">14 days</option></select></div>
<details id="lat"><summary>Latency of spoken turns (ms from the stop)</summary><div id="latt" class="n">Loading…</div></details>
<p class="n" id="n">Loading…</p><ul id="list"></ul></main>
<section id="d" aria-label="One utterance"><div class="in"><button type="button" id="back">Back to the list</button><div id="dd"></div></div></section>
<script>
var $=function(i){return document.getElementById(i)},esc=function(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})};
var clock=function(t){var d=new Date(t);return d.toLocaleDateString([], {month:'short',day:'numeric'})+' '+d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})};
function load(){var u='/api/talk/admin/utterances?days='+$('days').value+($('miss').checked?'&miss=1':'')+($('q').value?'&q='+encodeURIComponent($('q').value):'');
 fetch(u,{credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){
  if(j.error){$('n').textContent='Not allowed.';return}
  $('n').textContent=j.counts.all+' utterances, '+j.counts.missed+' likely misses';
  $('list').innerHTML=j.utterances.map(function(x){return '<li class="u" data-u="'+esc(x.u)+'" data-day="'+esc(x.day)+'"><div class="t"><span>'+clock(x.start)+'</span><span>'+esc(x.path)+'</span><span>'+esc(x.engine)+'</span><span>'+(x.ms/1000).toFixed(1)+' s</span>'+(x.handle!=='eyal'?'<span>'+esc(x.handle)+'</span>':'')+'</div>'
   +'<div class="s">'+esc(x.final||x.said)+'</div><div class="r">'+(x.misses||[]).map(function(m){return '<span class="tag m">'+esc(m)+'</span>'}).join('')+(x.decided?'<span class="tag">'+esc(x.decided)+'</span>':'')+esc(x.label||'')+(x.chat?' · '+esc(x.chat):'')+'</div></li>'}).join('')||'<li class="n">Nothing yet.</li>';
 })}
$('list').addEventListener('click',function(e){var li=e.target.closest('li.u');if(!li)return;open1(li.dataset.u,li.dataset.day)});
function open1(u,day){$('dd').innerHTML='<p class="n">Loading…</p>';$('d').classList.add('on');history.replaceState(null,'','#'+u+'/'+day);
 fetch('/api/talk/admin/utterance?u='+encodeURIComponent(u)+'&day='+day,{credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){
  var x=j.utterance||{},t0=(j.rows[0]||{}).ts||0;
  var rows=j.rows.concat(j.around.map(function(r){r.near=1;return r})).sort(function(a,b){return a.ts-b.ts});
  $('dd').innerHTML='<h1>'+esc(x.final||x.said)+'</h1>'+(j.clip?'<audio controls preload="none" src="/api/talk/admin/clip?key='+encodeURIComponent(j.clip)+'"></audio>':'<p class="n">No recording kept.</p>')
   +'<dl><dt>When</dt><dd>'+clock(x.start)+' · '+esc(x.path)+'</dd><dt>Heard live</dt><dd>'+esc(x.live)+'</dd><dt>Final</dt><dd>'+esc(x.final)+'</dd>'+(x.unrepeated?'<dt>Before the repeat guard</dt><dd>'+esc(x.unrepeated)+'</dd>':'')
   +'<dt>Decided</dt><dd>'+esc(x.decided||'–')+' '+esc(x.label||'')+' '+esc(x.href||'')+(x.p!=null?' (p '+x.p+')':'')+'</dd>'+(x.chat?'<dt>Answer</dt><dd>'+esc(x.chat)+'</dd>':'')+(x.tools&&x.tools.length?'<dt>Tools</dt><dd>'+esc(x.tools.join(', '))+'</dd>':'')
   +'<dt>Misses</dt><dd>'+esc((x.misses||[]).join(', ')||'none')+'</dd></dl><table>'+rows.map(function(r){return '<tr'+(r.near?' style="opacity:.55"':'')+'><td>+'+((r.ts-t0)/1000).toFixed(2)+'s</td><td><b>'+esc(r.ev)+'</b> '+esc(JSON.stringify(r.d))+'</td></tr>'}).join('')+'</table>';
 })}
$('back').onclick=function(){$('d').classList.remove('on');history.replaceState(null,'',location.pathname)};
['days','miss'].forEach(function(i){$(i).onchange=load});var qt;$('q').oninput=function(){clearTimeout(qt);qt=setTimeout(load,300)};
function lat(){fetch('/api/talk/admin/latency?days='+$('days').value,{credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){
 if(!j.all){$('latt').textContent='Not allowed.';return}
 var st=['end','final','decide','data','ack','audio','total'],nm={end:'last word to stop',final:'words ready',decide:'decided',data:'answer ready',ack:'first ack',audio:'first sound',total:'last word to first sound'};
 var tb=function(o){return '<table><tr><td></td><td>p50</td><td>p90</td><td>n</td></tr>'+st.map(function(k){var v=o[k]||{};return v.n?'<tr><td>'+nm[k]+'</td><td>'+v.p50+'</td><td>'+v.p90+'</td><td>'+v.n+'</td></tr>':''}).join('')+'</table>'};
 $('latt').innerHTML=j.n+' turns'+tb(j.all)+Object.keys(j.lanes).map(function(l){return '<p><b>'+esc(l)+'</b> ('+j.lanes[l].n+')</p>'+tb(j.lanes[l])}).join('');
})}
$('days').addEventListener('change',lat);lat();
load();var h=/^#([\\w-]+)\\/(\\d{4}-\\d{2}-\\d{2})$/.exec(location.hash);if(h)open1(h[1],h[2]);
</script></body></html>`;
