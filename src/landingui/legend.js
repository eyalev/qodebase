// The Board's legend (qb5, 2026-10-14, Eyal via the manager: explain the concepts on the page). A small "?" button on
// the Board opens a short sheet: each concept drawn with the SAME mark the Board uses (its own classes: .pc chips in the
// column colours, .rp replay dot, .bad ring), one plain line each, and a link to /how#connects ("How it connects").
// Prepended to WORK_JS by build.mjs; the host calls window.qbLegendMount(root) after every render. The "?" button is
// the Board's own ([data-legend], qb7's markup by the Board title); this module only opens the sheet on its click.
(() => {
  const ICON = {
    q: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 0 1 5 .8c0 1.8-2.5 2.2-2.5 3.8M12 17h.01"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
    quote: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 11h11M4 16h7"/><path d="M17 15l3 3-3 3"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
    braces: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4c-2 0-2 1.5-2 3v2c0 1.5-1 3-2 3 1 0 2 1.5 2 3v2c0 1.5 0 3 2 3M16 4c2 0 2 1.5 2 3v2c0 1.5 1 3 2 3-1 0-2 1.5-2 3v2c0 1.5 0 3-2 3"/></svg>',
    frame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/></svg>',
    route: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="12" r="2"/><path d="M7 12h4M11 12l4-6h4M11 12l4 6h4M11 12h8"/></svg>',
  };
  // The Board's own marks (work.css classes), so the legend shows exactly what the page shows.
  const chip = (cls, n, col) => `<span class="pcol ${col || ''} lg-col"><span class="pc ${cls}">${n}</span></span>`;
  const icon = (k) => `<span class="lg-ic">${ICON[k]}</span>`;
  const ITEMS = [
    ['On the Board', [
      [chip('', 3), 'Agent', 'An AI that writes code. Each one works on its own copy of the project, so no two type into the same file.'],
      [chip('', 3, 'work'), 'Working', 'Writing its change on its own copy.'],
      [chip('', 3, 'review'), 'Review', 'Another agent reads the change and approves it or asks for fixes.'],
      [chip('', 3, 'line'), 'In line', 'Approved, waiting in the line to be tested with the newest main.'],
      [chip('', 3, 'done'), 'Landed', 'Tested and on main: the app runs it.'],
      [chip('rp', 3, 'done'), 'Redone (replay)', 'Its change collided with code that landed first, so qodebase redid what it was asked on the newest main instead of sending it back.'],
      [chip('bad', 3), 'Sent back', 'A test failed, or no rule could redo it: it goes back to its agent or to a lead.'],
      [chip('st', 3, 'work'), 'Stacked change', 'Built on another change that has not landed yet (the small square). They land in that order; the chip says which agent it is stacked on.'],
    ]],
    ['How work moves', [
      [icon('route'), 'Router', 'The agent you talk to: it splits your request into tasks and starts one agent per task.'],
      [icon('frame'), 'Skeleton', 'The first agent of a team build: it makes the app shell that opens, with empty views and the contract.'],
      [icon('braces'), 'Contract', 'One shared file the skeleton writes first: the data shapes and the functions modules call in each other. Every agent codes against it.'],
      [icon('quote'), 'Intent', 'What an agent was asked to do. It stays with the change, so the change can be redone on newer code.'],
      [`<span class="lg-train"><i class="pc mini"></i><i class="pc mini"></i><i class="pc mini"></i></span>`, 'Train', 'A few changes from the line tested together. If the tests pass, they land at once.'],
      [`<span class="lg-lanes"><i></i><i></i></span>`, 'Lane', 'A separate line for one part of the code, so changes to different parts do not wait for each other.'],
      [icon('doc'), 'Change record', 'Everything about one change, kept in git: what it was asked, its diff, the review, the tests, how it landed.'],
    ]],
  ];
  const LG_CSS = `
.lg-x:focus-visible,.lg-sheet a:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.lg-back{position:fixed;inset:0;z-index:2147483003;background:rgba(0,0,0,.32);display:flex;align-items:flex-end;justify-content:center}
.lg-back[hidden]{display:none}
.lg-sheet{width:100%;max-width:560px;max-height:86dvh;overflow-y:auto;overscroll-behavior:contain;background:var(--bg);color:var(--fg);border-radius:14px 14px 0 0;box-shadow:inset 0 0 0 1px var(--line);padding:0 16px calc(16px + env(safe-area-inset-bottom))}
@media (min-width:720px){.lg-back{align-items:center}.lg-sheet{border-radius:14px;max-height:82dvh}}
.lg-head{position:sticky;top:0;display:flex;align-items:center;gap:8px;padding:12px 0 8px;background:var(--bg);z-index:1}
.lg-head h2{flex:1;margin:0;font-size:18px;font-weight:600}
.lg-x{width:44px;height:44px;border:0;border-radius:10px;background:transparent;color:var(--fg);display:flex;align-items:center;justify-content:center;cursor:pointer}
.lg-x svg{width:20px;height:20px}
.lg-sheet h3{margin:16px 0 4px;font-size:13px;font-weight:600;color:var(--dim)}
.lg-list{list-style:none;margin:0;padding:0}
.lg-list li{display:grid;grid-template-columns:76px minmax(0,1fr);gap:12px;align-items:start;padding:10px 0;border-top:1px solid var(--line)}
.lg-list li:first-child{border-top:0}
.lg-mark{display:flex;align-items:center;min-height:28px}
.lg-list b{display:block;font-weight:600;font-size:15px}
.lg-list p{margin:2px 0 0;color:var(--dim);font-size:14px;line-height:1.45}
.lw .lg-sheet .pcol.lg-col{display:inline-flex;overflow:visible;padding:4px;background:none;box-shadow:none;border:0;margin:0;min-height:0;height:auto;width:auto;min-width:0;border-radius:0}
.lg-ic{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:var(--acc-soft,var(--chip));color:var(--acc)}
.lg-ic svg{width:18px;height:18px}
.lg-on{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--dim);white-space:nowrap}
.lg-on svg{width:14px;height:14px;color:var(--acc)}
.lg-train{display:inline-flex;align-items:center;gap:2px;padding:4px 6px;border-radius:999px;box-shadow:inset 0 0 0 1px var(--line)}
.lg-train .pc.mini{background:var(--fg)}
.lg-lanes{display:inline-grid;gap:5px;width:40px}
.lg-lanes i{display:block;height:3px;border-radius:2px;background:var(--fg)}
.lg-lanes i+i{margin-left:10px;background:var(--dim)}
.lg-more{margin:16px 0 0;font-size:15px}
.lg-more a{display:inline-flex;align-items:center;min-height:44px;color:var(--acc);text-underline-offset:3px}
`;
  const log = (event, data) => { try { console.log(JSON.stringify({ ts: new Date().toISOString(), module: 'legend', event, ...(data || {}) })); } catch (e) { /* none */ } };
  let back = null, lastFocus = null;
  function sheet(host) {
    if (back && document.contains(back)) return back;
    back = document.createElement('div');
    back.className = 'lg-back'; back.hidden = true;
    back.innerHTML = `<div class="lg-sheet" role="dialog" aria-modal="true" aria-labelledby="lg-h"><div class="lg-head"><h2 id="lg-h">What the Board shows</h2><button type="button" class="lg-x" aria-label="Close">${ICON.x}</button></div>${
      ITEMS.map(([h, xs]) => `<h3>${h}</h3><ul class="lg-list">${xs.map(([mark, name, line]) => `<li><span class="lg-mark">${mark}</span><span><b>${name}</b><p>${line}</p></span></li>`).join('')}</ul>`).join('')
    }<p class="lg-more"><a href="/how#connects">How it all connects, from your request to main</a></p></div>`;
    host.appendChild(back);   // inside the Board (.lw), so the marks take the Board's own styles
    back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('.lg-x')) close('tap'); });
    back.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close('escape'); return; }
      if (e.key !== 'Tab') return;   // keep the keyboard inside the sheet
      const f = [...back.querySelectorAll('button, a[href]')]; const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    });
    return back;
  }
  function open(host) {
    const b = sheet(host); lastFocus = document.activeElement; b.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    b.querySelector('.lg-x').focus(); log('open', {});
  }
  function close(how) {
    if (!back || back.hidden) return;
    back.hidden = true; document.documentElement.style.overflow = '';
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
    log('close', { how });
  }
  let css = false, wired = false;
  window.qbLegendMount = (root) => {
    if (!css) { const s = document.createElement('style'); s.textContent = LG_CSS; document.head.appendChild(s); css = true; }
    if (wired) return;
    wired = true;
    // One listener for every redraw: the Board's [data-legend] button opens the sheet inside the Board (.lw).
    document.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('[data-legend]'); if (!b) return;
      const host = b.closest('.lw') || document.querySelector('.lw'); if (!host) return;
      e.preventDefault(); b.setAttribute('aria-haspopup', 'dialog'); open(host);
    });
  };
  window.qbLegendOpen = () => { const host = document.querySelector('.lw'); if (host) open(host); };
})();
