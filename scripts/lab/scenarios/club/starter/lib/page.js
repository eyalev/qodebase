// HTML for every page: escaping, euros, and the layout (viewport, <h1>, navigation, the
// link to the other language). Modules add their links to the navigation with
// app.nav({ href: '/shop', en: 'Shop', pt: 'Loja', who: 'all' | 'member' | 'staff' }).
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const euro = (n) => '€' + Number(n).toFixed(2);

// page({ title, body, lang: 'en'|'pt', alt: path in the other language, nav, member })
export function page({ title, body, lang = 'en', alt, nav = [], member = null, staff = false }) {
  const links = nav.filter((l) => l.who === 'all' || (l.who === 'member' && member) || (l.who === 'staff' && staff))
    .map((l) => `<a href="${lang === 'pt' && l.who !== 'staff' ? (l.href === '/' ? '/pt' : '/pt' + l.href) : l.href}">${esc(lang === 'pt' ? l.pt : l.en)}</a>`).join(' ');
  const other = alt ? `<a href="${esc(alt)}" hreflang="${lang === 'pt' ? 'en' : 'pt'}">${lang === 'pt' ? 'English' : 'Português'}</a>` : '';
  return `<!doctype html>
<html lang="${lang}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Clube de Padel da Vila</title><link rel="stylesheet" href="/style.css"></head>
<body><header><nav>${links} ${other}</nav></header>
<main><h1>${esc(title)}</h1>
${body}
</main></body></html>`;
}
