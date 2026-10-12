// COPIED by src/landingui/build.mjs from src/landingui/attach.js. Do not edit.
// Visual context in a project's composer (qb7, docs/board/TASKS.md S1/S2; server: qb6). Eyal, 2026-10-12: give
// agents what he sees, like a screenshot + prompt in tmux-web.
// S1: an image button in every form.ask: pick or shoot photos (several), each shrunk on the phone to <= 1600 px,
//     uploaded to POST /api/p/<o>/<n>/attach, shown as a removable chip; Send carries attachments:[id…].
// S2: picks from the App view (window.qbAddPick({selector, tag, text, html, url})) become chips too and ride as
//     context:[{kind:'pick', …}].
// v2's ask() asks window.forqAskExtra() for {attachments, context} and calls window.forqAskSent() after a send.
(() => {
  if (window.__qbAttach) return; window.__qbAttach = 1;
  const m = /^\/p\/([^/]+)\/([^/]+)/.exec(location.pathname);
  if (!m) return;
  const API = `/api/p/${m[1]}/${m[2]}`;
  const MAX_SIDE = 1600, MAX_FILES = 6, MAX_BYTES = 8e6;
  const log = (event, extra) => { try { console.log(JSON.stringify({ ts: new Date().toISOString(), module: 'attach', event, ...extra })); } catch {} };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  // One list for the page: every composer shows the same chips (the App view and Changes share a session).
  const items = [];   // { key, kind:'image'|'pick', state:'up'|'ok'|'err', id?, thumb?, name?, pick? }
  let seq = 0;
  const PEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l4-1 10-10-3-3L5 16z"/></svg>';
  const IMG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/></svg>';

  async function shrink(file) {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Only photos and screenshots (PNG, JPEG, WebP, GIF).');
    if (file.type === 'image/gif') return file;   // keep animation
    const bmp = await createImageBitmap(file).catch(() => null);
    if (!bmp) return file;
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.size < 1.5e6) return file;
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    return out ? new File([out], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  }
  async function upload(file, into) {
    const it = into || { key: ++seq, kind: 'image', state: 'up', name: file.name, thumb: URL.createObjectURL(file) };
    if (into) { if (it.thumb?.startsWith('blob:')) URL.revokeObjectURL(it.thumb); Object.assign(it, { state: 'up', thumb: URL.createObjectURL(file), id: undefined }); } else items.push(it);
    paint();
    try {
      const f = await shrink(file);
      if (f.size > MAX_BYTES) throw new Error('That image is too big (over 8 MB).');
      const r = await fetch(`${API}/attach`, { method: 'POST', headers: { 'content-type': f.type, 'x-file-name': encodeURIComponent(f.name).slice(0, 120) }, body: f });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.id) throw new Error(d.error || `Upload failed (${r.status}).`);
      Object.assign(it, { state: 'ok', id: d.id });
      log('uploaded', { id: d.id, size: f.size, type: f.type, from: file.size });
    } catch (e) { Object.assign(it, { state: 'err', error: String(e.message || e) }); log('upload_failed', { error: String(e) }); }
    paint();
  }
  function remove(key) {
    const i = items.findIndex((x) => x.key === key); if (i < 0) return;
    if (items[i].thumb) URL.revokeObjectURL(items[i].thumb);
    items.splice(i, 1); paint();
  }
  window.qbAddPick = (p) => {
    if (items.filter((x) => x.kind === 'pick').some((x) => x.pick.selector === p.selector)) return;
    items.push({ key: ++seq, kind: 'pick', state: 'ok', pick: { kind: 'pick', selector: String(p.selector || '').slice(0, 300), tag: String(p.tag || ''), text: String(p.text || '').slice(0, 200), html: String(p.html || '').slice(0, 600), url: String(p.url || '') } });
    log('pick', { selector: p.selector }); paint();
    document.querySelector('form.ask textarea')?.focus({ preventScroll: true });
  };
  // A chip that waits for something slow (a screenshot takes ~20 s): spinner now, the image when it arrives.
  window.qbPendingAttachment = (label) => {
    const it = { key: ++seq, kind: 'image', state: 'up', name: label || 'Working\u2026', thumb: '' }; items.push(it); paint();
    return { done: (d) => { Object.assign(it, { state: 'ok', id: d.id, name: d.name || 'screenshot.png', thumb: d.thumb || `${API}/attach/${d.id}` }); paint(); },
      fail: (msg) => { Object.assign(it, { state: 'err', error: msg }); paint(); } };
  };
  window.qbAddAttachment = (d) => { items.push({ key: ++seq, kind: 'image', state: 'ok', id: d.id, name: d.name || 'screenshot', thumb: d.thumb || `${API}/attach/${d.id}` }); paint(); };
  // What v2's ask() sends with the text; null while an upload is still running (Send waits).
  window.forqAskExtra = () => {
    if (items.some((x) => x.state === 'up')) return { wait: true };
    const attachments = items.filter((x) => x.kind === 'image' && x.state === 'ok').map((x) => x.id).slice(0, MAX_FILES);
    const context = items.filter((x) => x.kind === 'pick').map((x) => x.pick);
    return { ...(attachments.length ? { attachments } : {}), ...(context.length ? { context } : {}) };
  };
  // Images or picks with an empty box still send: the words say what to look at.
  window.forqAskDefault = () => {
    const n = items.filter((x) => x.kind === 'image' && x.state === 'ok').length, p = items.filter((x) => x.kind === 'pick').length;
    return n && p ? 'Look at what I attached and the element I picked.' : n ? `Look at the image${n > 1 ? 's' : ''} I attached.` : p ? `Look at the element${p > 1 ? 's' : ''} I picked.` : '';
  };
  window.forqAskSent = () => { items.splice(0).forEach((x) => x.thumb && x.thumb.startsWith('blob:') && URL.revokeObjectURL(x.thumb)); paint(); };

  function chip(it) {
    if (it.kind === 'pick') return `<span class="qa-chip qa-pick" title="${esc(it.pick.selector)}"><span class="qa-tag">&lt;${esc(it.pick.tag)}&gt;</span><span class="qa-t">${esc(it.pick.text || it.pick.selector)}</span><button type="button" class="qa-x" data-qa-rm="${it.key}" aria-label="Remove this element">&times;</button></span>`;
    const img = it.state === 'up' ? `<span class="qa-spin" role="img" aria-label="Working">${it.thumb ? `<img src="${esc(it.thumb)}" alt="">` : ''}<i></i></span>` : it.state === 'ok' ? `<button type="button" class="qa-edit" data-qa-edit="${it.key}" aria-label="Draw on this image"><img src="${esc(it.thumb)}" alt=""><i aria-hidden="true">${PEN}</i></button>` : `<img src="${esc(it.thumb)}" alt="">`;
    return `<span class="qa-chip qa-img${it.state === 'err' ? ' qa-err' : ''}"${it.state === 'err' ? ` title="${esc(it.error)}"` : ''}>${img}<span class="qa-t">${it.state === 'up' ? (it.thumb ? 'Uploading\u2026' : esc(it.name)) : it.state === 'err' ? esc(it.error) : esc(it.name || 'image')}</span><button type="button" class="qa-x" data-qa-rm="${it.key}" aria-label="Remove this image">&times;</button></span>`;
  }
  function paint() {
    document.querySelectorAll('form.ask').forEach((f) => {
      const row = f.querySelector('.qa-chips');
      if (row) { row.innerHTML = items.map(chip).join(''); row.hidden = !items.length; }
      const full = items.filter((x) => x.kind === 'image').length >= MAX_FILES;
      const b = f.querySelector('.qa-add'); if (b) { b.disabled = full; b.title = full ? `Up to ${MAX_FILES} images` : 'Add photos or screenshots'; }
      // Talk shows its mic instead of Send while the box is empty; with chips there is something to send (qb2).
      const had = f.dataset.talkHas === '1';
      if (items.length) f.dataset.talkHas = '1'; else delete f.dataset.talkHas;
      const ta = f.querySelector('textarea'), sb = f.querySelector('.send');
      if (ta && had !== !!items.length) ta.dispatchEvent(new Event('input', { bubbles: true }));
      if (sb && ta && !ta.value.trim()) sb.className = `send ${items.some((x) => x.state === 'ok') ? 'btn' : 'chipbtn'}`;
    });
  }
  // S4: draw a circle or an arrow on an attached image before sending. Full screen; the drawing is flattened into
  // a new image at the original size, uploaded, and replaces the chip's attachment.
  async function draw(it) {
    if (!it) return;
    const src = new Image(); src.crossOrigin = 'use-credentials'; src.src = it.thumb;
    try { await src.decode(); } catch (e) { log('draw_load_failed', { error: String(e) }); return; }
    const W = src.naturalWidth, H = src.naturalHeight, lw = Math.max(4, Math.round(Math.max(W, H) / 160));
    // The marks belong to the image, not the theme: the light theme's --warn red, with a white edge so they read on
    // dark and light screenshots alike.
    const RED = '#b42d1f', EDGE = 'rgba(255,255,255,.9)';
    const shapes = []; let tool = 'circle', cur = null;
    const ov = document.createElement('div'); ov.className = 'qa-draw'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Draw on the image');
    ov.innerHTML = `<div class="qa-dbar"><button type="button" class="qa-db" data-d="cancel">Cancel</button><span class="qa-tools" role="radiogroup" aria-label="Tool"><button type="button" class="qa-db" role="radio" data-t="circle" aria-checked="true">Circle</button><button type="button" class="qa-db" role="radio" data-t="arrow" aria-checked="false">Arrow</button></span><button type="button" class="qa-db" data-d="undo" disabled>Undo</button><button type="button" class="qa-db qa-done" data-d="done">Done</button></div><div class="qa-dwrap"><canvas></canvas></div><p class="qa-dhint">Drag on the image to draw.</p>`;
    document.body.appendChild(ov); document.body.classList.add('qa-drawing');
    const cv = ov.querySelector('canvas'), wrap = ov.querySelector('.qa-dwrap'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const fit = () => { const k = Math.min(wrap.clientWidth / W, wrap.clientHeight / H); cv.style.width = `${Math.floor(W * k)}px`; cv.style.height = `${Math.floor(H * k)}px`; };
    fit(); addEventListener('resize', fit);
    const paintShape = (c, sh) => { stroke(c, sh, EDGE, lw * 1.8); stroke(c, sh, RED, lw); };
    const stroke = (c, sh, col, lw) => {
      c.strokeStyle = col; c.fillStyle = col; c.lineWidth = lw; c.lineCap = 'round'; c.lineJoin = 'round';
      if (sh.t === 'circle') { c.beginPath(); c.ellipse((sh.x0 + sh.x1) / 2, (sh.y0 + sh.y1) / 2, Math.max(4, Math.abs(sh.x1 - sh.x0) / 2), Math.max(4, Math.abs(sh.y1 - sh.y0) / 2), 0, 0, Math.PI * 2); c.stroke(); return; }
      const a = Math.atan2(sh.y1 - sh.y0, sh.x1 - sh.x0), hl = lw * 4;
      c.beginPath(); c.moveTo(sh.x0, sh.y0); c.lineTo(sh.x1, sh.y1); c.stroke();
      c.beginPath(); c.moveTo(sh.x1, sh.y1); c.lineTo(sh.x1 - hl * Math.cos(a - 0.45), sh.y1 - hl * Math.sin(a - 0.45)); c.lineTo(sh.x1 - hl * Math.cos(a + 0.45), sh.y1 - hl * Math.sin(a + 0.45)); c.closePath(); c.fill();
    };
    const redraw = () => { g.drawImage(src, 0, 0, W, H); shapes.concat(cur ? [cur] : []).forEach((sh) => paintShape(g, sh)); ov.querySelector('[data-d="undo"]').disabled = !shapes.length; };
    redraw();
    const at = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) }; };
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); const p = at(e); cur = { t: tool, x0: p.x, y0: p.y, x1: p.x, y1: p.y }; });
    cv.addEventListener('pointermove', (e) => { if (!cur) return; const p = at(e); cur.x1 = p.x; cur.y1 = p.y; redraw(); });
    const end = () => { if (!cur) return; if (Math.hypot(cur.x1 - cur.x0, cur.y1 - cur.y0) > lw * 2) shapes.push(cur); cur = null; redraw(); };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', () => { cur = null; redraw(); });
    const close = () => { removeEventListener('resize', fit); ov.remove(); document.body.classList.remove('qa-drawing'); };
    ov.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-t]'); if (t) { tool = t.dataset.t; ov.querySelectorAll('[data-t]').forEach((b) => b.setAttribute('aria-checked', String(b === t))); return; }
      const d = e.target.closest('[data-d]')?.dataset.d;
      if (d === 'cancel') return close();
      if (d === 'undo') { shapes.pop(); return redraw(); }
      if (d === 'done') {
        if (!shapes.length) return close();
        const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.9));
        close(); log('drawn', { shapes: shapes.length, w: W, h: H });
        if (blob) upload(new File([blob], (it.name || 'image').replace(/\.\w+$/, '') + '-marked.jpg', { type: 'image/jpeg' }), it);
      }
    });
    document.addEventListener('keydown', function k(e) { if (e.key === 'Escape' && ov.isConnected) { close(); document.removeEventListener('keydown', k); } });
    ov.querySelector('[data-t="circle"]').focus();
  }
  function mount(f) {
    if (f.dataset.qa) return; f.dataset.qa = '1';
    const ta = f.querySelector('textarea'); if (!ta) return;
    const row = document.createElement('div'); row.className = 'qa-chips'; row.hidden = true; row.setAttribute('aria-live', 'polite');
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'qa-add'; btn.innerHTML = IMG; btn.setAttribute('aria-label', 'Add photos or screenshots');
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/webp,image/gif'; inp.multiple = true; inp.hidden = true;
    f.insertBefore(row, f.firstChild); f.insertBefore(btn, ta); f.appendChild(inp);
    f.classList.add('qa-on');
    btn.addEventListener('click', () => inp.click());
    inp.addEventListener('change', () => { const fs = [...inp.files].slice(0, MAX_FILES - items.filter((x) => x.kind === 'image').length); inp.value = ''; fs.forEach(upload); });
    // A screenshot pasted into the box attaches too (desktop).
    ta.addEventListener('paste', (e) => { const fs = [...(e.clipboardData?.files || [])].filter((x) => x.type.startsWith('image/')); if (fs.length) { e.preventDefault(); fs.forEach(upload); } });
    row.addEventListener('click', (e) => { const x = e.target.closest('[data-qa-rm]'); if (x) return remove(+x.dataset.qaRm); const ed = e.target.closest('[data-qa-edit]'); if (ed) draw(items.find((i) => i.key === +ed.dataset.qaEdit)); });
  }
  const css = document.createElement('style');
  css.textContent = `form.ask.qa-on{flex-wrap:wrap}
form.ask .qa-chips{flex:0 0 100%;display:flex;gap:6px;overflow-x:auto;padding:0 0 6px;scrollbar-width:none}
form.ask .qa-chips[hidden]{display:none}
.qa-chip{flex:none;display:inline-flex;align-items:center;gap:6px;max-width:220px;min-height:44px;padding:4px 4px 4px 4px;border-radius:10px;background:var(--chip);color:var(--fg);font-size:13px}
.qa-chip img{width:36px;height:36px;border-radius:6px;object-fit:cover;flex:none;background:var(--line)}
.qa-pick{padding-left:10px}.qa-tag{font-family:ui-monospace,monospace;color:var(--dim);font-size:12px}
.qa-t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.qa-err{box-shadow:inset 0 0 0 1px var(--warn)}.qa-err .qa-t{color:var(--warn)}
.qa-x{flex:none;width:36px;height:36px;border:0;border-radius:8px;background:none;color:var(--dim);font-size:20px;line-height:1;cursor:pointer}
.qa-add{flex:none;align-self:flex-end;width:44px;height:44px;border:0;border-radius:10px;background:var(--chip);color:var(--fg);display:flex;align-items:center;justify-content:center;cursor:pointer;margin-right:6px}
.qa-add svg{width:22px;height:22px}.qa-add:disabled{opacity:.4}
.qa-add:focus-visible,.qa-x:focus-visible,.qa-edit:focus-visible,.qa-db:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.qa-spin{position:relative;flex:none;width:36px;height:36px;border-radius:6px;background:var(--line);overflow:hidden}
.qa-spin img{opacity:.5}.qa-spin i{position:absolute;inset:8px;border-radius:50%;border:2.5px solid var(--dim);border-top-color:transparent;animation:qa-r .8s linear infinite}
@keyframes qa-r{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.qa-spin i{animation-duration:2.4s}}
.qa-edit{position:relative;flex:none;border:0;padding:0;background:none;cursor:pointer;border-radius:6px}
.qa-edit i{position:absolute;right:-4px;bottom:-4px;width:18px;height:18px;border-radius:50%;background:var(--fg);color:var(--bg);display:flex;align-items:center;justify-content:center}
.qa-edit i svg{width:11px;height:11px}
body.qa-drawing{overflow:hidden}
.qa-draw{position:fixed;inset:0;z-index:2147483600;background:var(--bg);color:var(--fg);display:flex;flex-direction:column;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)}
.qa-dbar{display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid var(--line)}
.qa-tools{display:flex;gap:4px;margin:0 auto}
.qa-db{min-height:44px;min-width:44px;padding:0 12px;border:0;border-radius:10px;background:var(--chip);color:var(--fg);font:inherit;font-size:14px;cursor:pointer}
.qa-db[aria-checked="true"]{background:var(--fg);color:var(--bg)}.qa-db:disabled{opacity:.4}
.qa-done{background:var(--acc);color:var(--acc-fg,#fff)}
.qa-dwrap{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:12px}
.qa-dwrap canvas{touch-action:none;border-radius:8px;box-shadow:0 0 0 1px var(--line)}
.qa-dhint{margin:0;padding:8px 12px 12px;text-align:center;font-size:13px;color:var(--dim)}`;
  document.head.appendChild(css);
  const all = () => document.querySelectorAll('form.ask').forEach(mount);
  all(); new MutationObserver(all).observe(document.body, { childList: true, subtree: true });
})();
