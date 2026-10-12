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
  async function upload(file) {
    const it = { key: ++seq, kind: 'image', state: 'up', name: file.name, thumb: URL.createObjectURL(file) };
    items.push(it); paint();
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
    return `<span class="qa-chip qa-img${it.state === 'err' ? ' qa-err' : ''}"${it.state === 'err' ? ` title="${esc(it.error)}"` : ''}><img src="${esc(it.thumb)}" alt=""><span class="qa-t">${it.state === 'up' ? 'Uploading\u2026' : it.state === 'err' ? esc(it.error) : esc(it.name || 'image')}</span><button type="button" class="qa-x" data-qa-rm="${it.key}" aria-label="Remove this image">&times;</button></span>`;
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
    row.addEventListener('click', (e) => { const x = e.target.closest('[data-qa-rm]'); if (x) remove(+x.dataset.qaRm); });
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
.qa-add:focus-visible,.qa-x:focus-visible{outline:2px solid var(--acc);outline-offset:2px}`;
  document.head.appendChild(css);
  const all = () => document.querySelectorAll('form.ask').forEach(mount);
  all(); new MutationObserver(all).observe(document.body, { childList: true, subtree: true });
})();
