// Asks view (G4 + X5), qb3: split out of v3.ts on 2026-10-13 so the Asks UI can change without touching v3.ts.
export type AsksCtx = { info: { owner: string; name: string }; base: string };
/** Asks (github-parity G4): the agent-age issues list. The page fetches GET …/asks (qb6; anonymous on watch
 *  projects like /landing) and draws one row per ask: a state dot, the text, who asked, how many changes it became,
 *  duplicates folded under the ask they repeat. Tap a row for its changes (each opens its record in Agents at work). */
export function asksView(c: AsksCtx) {
  const api = `/api/p/${encodeURIComponent(c.info.owner)}/${encodeURIComponent(c.info.name)}`;
  return { body: `<div class="pad asks"><h2 class="ah">Asks</h2><p class="lede">Every request the agents got, from a person, from Talk or from Cloudflare Issues, and every task on the list they share.<span id="adec" hidden> Under each ask: what the agents decided for you, and anything they had to ask you.</span><span id="arep" hidden> Repeats are folded under the first ask, so the same thing is not built twice.</span></p>
<div class="afil" role="group" aria-label="Show"></div><ul class="alist" id="alist"><li class="aempty">Loading the asks…</li></ul></div>
<style>${ASKS_CSS}</style><script>${ASKS_JS.replace('%API%', api).replace('%BASE%', c.base)}</script>` };
}
const ASKS_CSS = `.asks .ah{font-size:22px;font-weight:600;letter-spacing:-.02em;margin:4px 0 6px}
.afil{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}
.afil button{min-height:44px;padding:0 12px;border:0;border-radius:10px;background:var(--chip);color:var(--fg);font:500 14px 'Geist',sans-serif;cursor:pointer}
.afil button[aria-pressed="true"]{background:var(--fg);color:var(--bg)}
.afil b{font-variant-numeric:tabular-nums;margin-left:4px;font-weight:600}
.alist{list-style:none;margin:0;padding:0}
.alist>li{box-shadow:inset 0 -1px 0 var(--line)}
.alist>li:last-child{box-shadow:none}
.arow{display:grid;grid-template-columns:auto 1fr auto auto;gap:2px 10px;align-items:baseline;width:100%;padding:12px 0;min-height:44px;border:0;background:none;color:var(--fg);font:inherit;text-align:left;cursor:pointer}
.arow .t{font-size:15px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.arow .w{font-size:13px;color:var(--dim);white-space:nowrap}
.arow .chev{width:16px;height:16px;color:var(--dim);transition:transform 120ms;align-self:center}
.arow[aria-expanded="true"] .chev{transform:rotate(180deg)}
.arow[aria-expanded="true"] .t{-webkit-line-clamp:8}
.achg .acag{color:var(--fg);font-weight:600;min-width:64px;flex:none}
.arow .m{grid-column:2/-1;display:flex;flex-wrap:wrap;gap:4px 12px;font-size:13px;color:var(--dim)}
.adot{width:9px;height:9px;border-radius:50%;background:var(--dim);transform:translateY(-1px)}
.adot.working{background:var(--busy)}.adot.in-line{background:var(--fg)}.adot.landed{background:var(--acc)}.adot.bounced{background:var(--warn)}.adot.planning{background:transparent;box-shadow:inset 0 0 0 1.5px var(--dim)}
.adup{font-size:13px;color:var(--dim);margin:-4px 0 10px 19px}
.adup b{font-weight:500;color:var(--fg)}
.achg{list-style:none;margin:0 0 12px 19px;padding:0}
.achg a{display:flex;gap:8px;align-items:center;min-height:44px;color:var(--acc);text-decoration:none;font-size:14px}
.achg .w{color:var(--dim);font-size:13px;margin-left:auto}
.adet{margin:0 0 6px 19px}
.adet+.achg{margin-top:-4px}
.adet h3{font-size:13px;font-weight:600;color:var(--dim);margin:4px 0 2px}
.adec{list-style:none;margin:0 0 8px;padding:0}
.adec li{padding:7px 0;display:grid;gap:1px}
.adec .dw{font-size:14px;line-height:1.4;color:var(--fg)}
.adec .dy{font-size:13px;line-height:1.4;color:var(--dim)}
.adec .db{font-size:12px;color:var(--dim)}
.adec .db a{color:var(--dim)}
.amore{min-height:44px;padding:0;border:0;background:none;color:var(--acc);font:500 14px 'Geist',sans-serif;cursor:pointer}
.aq{margin:0 0 10px;padding:10px 12px;border-radius:10px;background:color-mix(in srgb,var(--warn) 9%,transparent);display:grid;gap:3px}
.aq.done{background:var(--chip)}
.aq .qk{font-size:12px;font-weight:600;color:var(--warn)}
.aq.done .qk{color:var(--dim)}
.aq .qt{font-size:14px;line-height:1.4;color:var(--fg)}
.aq .qa{display:inline-flex;align-items:center;min-height:44px;margin:-6px 0 -10px;color:var(--acc);font-size:14px;font-weight:500;text-decoration:none}
.aq .db{font-size:12px;color:var(--dim)}
.arow .m .nd{color:var(--warn);font-weight:500}
.aempty{padding:16px 0;color:var(--dim);font-size:15px}
@media (hover:hover){.arow:hover{background:color-mix(in srgb,var(--chip) 60%,transparent)}}`;
const ASKS_JS = `(function(){
var API='%API%',BASE='%BASE%',list=document.getElementById('alist'),fil=document.querySelector('.afil'),data=null,show='all',open={},more={},titles=null,agents={};
var FROM={person:'A person',talk:'Talk',issues:'Cloudflare Issues',board:'The task list',script:'The demo script'};
var WHY={secret:'Needs a secret from you',money:'About money',failing:'A change keeps failing',other:'A question for you'};
var WORD={planning:'Planning',working:'Working','in-line':'In line',landed:'Landed',bounced:'Sent back',mixed:'In progress',pushed:'In review',reviewing:'In review',queued:'In line',testing:'Being tested',replaying:'Replaying','with-lead':'With its lead'};
// Change titles come from the landing view, fetched once, the first time a row is opened.
function loadTitles(){if(titles)return;titles={};fetch(API+'/landing',{cache:'no-store'}).then(function(r){return r.ok?r.json():null}).then(function(j){(j&&j.changes||[]).forEach(function(c){titles[c.id]=String(c.title||c.intent||'').split('. ')[0];agents[c.id]=c.agent});
 var all=(j&&j.changes||[]).slice().sort(function(a,b){return(a.createdAt||0)-(b.createdAt||0)}),num={},used={},n=1;
 // Same numbering as Agents at work (agentNums in work.js): 'agent-3' keeps 3, others get the next free number by first change.
 all.forEach(function(c){var k=/^(?:scripted )?agent[- ](\\d+)$/i.exec(c.agent||'');if(k&&!(c.agent in num)){num[c.agent]=+k[1];used[+k[1]]=1}});
 all.forEach(function(c){if(!(c.agent in num)){while(used[n])n++;num[c.agent]=n;used[n]=1}});
 Object.keys(agents).forEach(function(id){agents[id]=num[agents[id]]||''});render()}).catch(function(){})}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function ago(t){if(!t)return'';var s=Math.max(0,Math.round((Date.now()-t)/1000));return s<60?'just now':s<3600?Math.floor(s/60)+' min ago':s<86400?Math.floor(s/3600)+' h ago':Math.floor(s/86400)+' d ago'}
function open_(a){return a.state!=='landed'}
function needs(a){return(a.asked||[]).filter(function(q){return q.state==='open'}).length}
function who(by){if(by==='router')return'The planner';var n=agents[by];return n?'Agent '+n:'An agent'}
function link(by,href){return href||(by&&by!=='router'?BASE+'/work#/change/'+encodeURIComponent(by):BASE)}
// X5: questions the agents asked the person (owner only: the server leaves them out for anyone else), then decisions.
function details(a,more_){
 var q=(a.asked||[]).slice().sort(function(x,y){return(x.state==='open'?0:1)-(y.state==='open'?0:1)||(y.at||0)-(x.at||0)});
 var d=(a.decided||[]).slice().sort(function(x,y){return(x.at||0)-(y.at||0)});
 if(!q.length&&!d.length)return'';
 var qs=q.map(function(x){var o=x.state==='open';return'<div class="aq'+(o?'':' done')+'"><span class="qk">'+esc(o?(WHY[x.why]||WHY.other):'Answered: '+(WHY[x.why]||WHY.other).toLowerCase())+'</span><span class="qt">'+esc(x.question)+'</span><span class="db">'+esc(who(x.by))+', '+esc(ago(x.at))+'</span>'+(o?'<a class="qa" href="'+esc(link(x.by,x.href))+'">Answer in its chat</a>':'')+'</div>'}).join('');
 var all=!!more[a.id],shown=all?d:d.slice(0,4);
 var ds=d.length?'<h3>Decided for you</h3><ul class="adec">'+shown.map(function(x){return'<li><span class="dw">'+esc(x.what)+'</span>'+(x.why?'<span class="dy">'+esc(x.why)+'</span>':'')+'<span class="db"><a href="'+esc(link(x.by))+'">'+esc(who(x.by))+'</a>, '+esc(ago(x.at))+'</span></li>'}).join('')+'</ul>'+(d.length>4&&!all?'<button type="button" class="amore" data-more="'+esc(a.id)+'">Show all '+d.length+' decisions</button>':''):'';
 return'<div class="adet">'+qs+ds+(more_?'<h3>Changes</h3>':'')+'</div>'}
function render(){
 if(!data){return}
 var asks=data.asks||[],byId={};asks.forEach(function(a){byId[a.id]=a});
 var dups=asks.filter(function(a){return a.duplicateOf});
 var main=asks.filter(function(a){return!a.duplicateOf});
 var rep=document.getElementById('arep');if(rep)rep.hidden=!dups.length;
 var dec=document.getElementById('adec');if(dec)dec.hidden=!asks.some(function(a){return(a.decided||[]).length||(a.asked||[]).length});
 var n={needs:main.filter(needs).length,all:main.length,open:main.filter(open_).length,landed:main.filter(function(a){return a.state==='landed'}).length,dups:dups.length};
 if(show==='needs'&&!n.needs)show='all';
 fil.innerHTML=[['needs','Needs you'],['all','All'],['open','Open'],['landed','Landed'],['dups','Repeats']].filter(function(x){return(x[0]!=='dups'&&x[0]!=='needs')||n[x[0]]}).map(function(x){return'<button type="button" data-f="'+x[0]+'" aria-pressed="'+(show===x[0])+'">'+x[1]+'<b>'+n[x[0]]+'</b></button>'}).join('');
 var rows=show==='dups'?dups:main.filter(function(a){return show==='all'||(show==='needs'?needs(a):show==='open'?open_(a):a.state==='landed')});
 if(!rows.length){list.innerHTML='<li class="aempty">'+(asks.length?'Nothing here.':'No asks recorded yet. Requests to the router and tasks on the list show up here.')+'</li>';return}
 list.innerHTML=rows.sort(function(a,b){return(b.at||0)-(a.at||0)}).map(function(a){
  var ch=a.changes||[],reps=asks.filter(function(d){return d.duplicateOf===a.id});
  var nd=needs(a),dn=(a.decided||[]).length;
  var meta=(nd?'<span class="nd">'+(nd===1?'Asks you something':'Asks you '+nd+' things')+'</span>':'')+[FROM[a.from]||a.from||'',ch.length?ch.length+' change'+(ch.length===1?'':'s'):'',dn?dn+' decided for you':'',ago(a.at)].filter(Boolean).map(function(x){return'<span>'+esc(x)+'</span>'}).join('');
  var dupOf=a.duplicateOf&&byId[a.duplicateOf]?'<p class="adup">Same as <b>'+esc(byId[a.duplicateOf].text)+'</b></p>':'';
  var repl=reps.length&&!(a.aliases||[]).length?'<p class="adup">Asked again '+reps.length+'×'+(reps[0].text&&reps[0].text!==a.text?' as <b>'+esc(reps[0].text)+'</b>':'')+'</p>':'';
  var al=(a.aliases||[]).length?'<p class="adup">Also called <b>'+(a.aliases||[]).map(esc).join('</b>, <b>')+'</b></p>':'';
  var cs=a.changeStates||{};var chl=open[a.id]&&ch.length?'<ul class="achg">'+ch.map(function(c){var id=typeof c==='string'?c:c.id,t=(titles&&titles[id])||'',w=WORD[cs[id]]||cs[id]||'';var an=agents[id]||'';return'<li><a href="'+BASE+'/work#/change/'+encodeURIComponent(id)+'">'+(an?'<span class="acag">Agent '+esc(an)+'</span>':'')+esc(t||('#'+String(id).split('--').pop()))+'<span class="w">'+esc(w)+'</span></a></li>'}).join('')+'</ul>':'';
  return'<li><button type="button" class="arow" data-a="'+esc(a.id)+'" aria-expanded="'+!!open[a.id]+'"><i class="adot '+esc(a.state||'')+'"></i><span class="t">'+esc(a.text)+'</span><span class="w">'+esc(a.delivery==='failed'?'Not delivered':a.delivery==='waking'?'Waking the router':(WORD[a.state]||''))+'</span><svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2"/></svg><span class="m">'+meta+'</span></button>'+dupOf+repl+al+(open[a.id]?details(a,!!chl):'')+chl+'</li>'}).join('');
}
fil.addEventListener('click',function(e){var b=e.target.closest('[data-f]');if(b){show=b.dataset.f;render()}});
list.addEventListener('click',function(e){var m=e.target.closest('[data-more]');if(m){more[m.dataset.more]=1;render();return}var b=e.target.closest('[data-a]');if(b){open[b.dataset.a]=!open[b.dataset.a];loadTitles();render()}});
function load(){fetch(API+'/asks',{cache:'no-store'}).then(function(r){if(r.status===404)return{asks:[],missing:true};return r.ok?r.json():null}).then(function(j){if(!j){list.innerHTML='<li class="aempty">Could not load the asks. Pull to refresh.</li>';return}data=j;render()}).catch(function(e){console.log(JSON.stringify({event:'asks_load_failed',error:String(e)}))})}
load();setInterval(function(){if(!document.hidden)load()},15000);
})();`;

