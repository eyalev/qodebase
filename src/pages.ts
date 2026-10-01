// The box starting page (shown while an agent's container boots).


const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]!));

export const startingPage = (name: string, error?: string) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Starting ${esc(name)}</title>
<body style="margin:0;height:100dvh;display:flex;align-items:center;justify-content:center;background:#141516;color:#e8e8e6;font:15px system-ui;padding:0 16px">
<div style="text-align:center"><div style="font-weight:600">Starting ${esc(name)}…</div><div id="el" style="margin-top:8px;font-size:20px;font-variant-numeric:tabular-nums">0s</div>
<div id="sub" style="margin-top:6px;font-size:13px;color:#9a9da2">${error ? esc(error) : 'usually ready in a few seconds'}</div></div>
<script>const t0=Date.now(),el=document.getElementById('el'),sub=document.getElementById('sub');
setInterval(()=>{const s=Math.floor((Date.now()-t0)/1000);el.textContent=s+'s';if(s>20&&!${JSON.stringify(!!error)})sub.textContent='the first start on a new host downloads the image (a couple of minutes)';},500);
(async function poll(){try{const r=await fetch(location.href,{cache:'no-store',headers:{accept:'text/html'}});if(r.ok){location.replace(location.href);return;}}catch{}setTimeout(poll,2500);})();</script></body>`,
  { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': '2' } });
