// "Look 2" preview (Eyal, 2026-10-07: "more gentle, sleek, modern", after Executor's
// look and feel, not its layout). Opt-in per browser: /?look=2 sets a cookie, /?look=1
// clears it. Layered over every HTML page on the UI host, after the page's own styles:
// Geist, a size step down, lighter greys and hairlines, softer corners, near-black
// primary buttons (green stays for links and live dots). If Eyal keeps it, these values
// move into DESIGN.md and the page CSS, and this file goes.

const COOKIE = 'qb_look';

const CSS = `
:root{--card:#fafafa;--chip:#f3f4f6;--line:#ececef;--dim:#6e737b;--fg:#111214;--btn:#111214;--btn-fg:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#0c0d0e;--card:#141517;--chip:#1c1d20;--line:#222428;--dim:#9a9fa6;--fg:#ececee;--btn:#f2f2f3;--btn-fg:#111214}}
body,button,input,textarea,select{font-family:'Geist',system-ui,sans-serif!important;-webkit-font-smoothing:antialiased}
body{letter-spacing:-.003em}
h1,h2,h3,.land h1{letter-spacing:-.02em}
h1{font-weight:600}
.land h1{font-size:28px;line-height:1.2}
@media (min-width:900px){.land h1{font-size:32px}}
.land .lede,.desc{font-size:16px;line-height:1.55}
.land .browse small,.trys,.gh-note,.note{font-size:14px}
.btn{background:var(--btn)!important;color:var(--btn-fg)!important;border-radius:10px!important;font-weight:500!important;box-shadow:none!important}
.chipbtn{border-radius:10px}
textarea,input[type=text],input[type=password],input:not([type]),.field,.landask textarea{border-radius:12px!important;border-color:var(--line)!important}
.prow,.tcard img,.gmenupop{border-radius:14px}
.gtop .g{font-size:14.5px;font-weight:500}
.gtop .mark{font-weight:600;letter-spacing:-.02em}
body:has(.tabbar) #look2chip{bottom:80px!important}
`;

/** The cookie to set or clear when the URL asks (?look=2 / ?look=1), else null. */
export function lookCookie(url: URL): string | null {
  const v = url.searchParams.get('look');
  if (v === '2') return `${COOKIE}=2; Path=/; Max-Age=${60 * 86400}; Secure; SameSite=Lax`;
  if (v === '1') return `${COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Lax`;
  return null;
}

/** Is look 2 on for this request (cookie, or this very URL turning it on)? */
export function lookOn(request: Request, url: URL): boolean {
  const v = url.searchParams.get('look');
  if (v === '1') return false;
  return v === '2' || /(?:^|;\s*)qb_look=2/.test(request.headers.get('cookie') || '');
}

/** Adds the font and the overrides at the end of <head>, and a small switch-back chip. */
export function withLook(res: Response): Response {
  if (!(res.headers.get('content-type') || '').startsWith('text/html')) return res;
  return new HTMLRewriter()
    .on('head', { element(e) { e.append(`<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet"><style id="look2">${CSS}</style>`, { html: true }); } })
    .on('body', { element(e) { e.append(`<a id="look2chip" href="?look=1" style="position:fixed;left:12px;bottom:12px;z-index:99;font:500 12px Geist,sans-serif;padding:6px 10px;border-radius:999px;background:var(--fg);color:var(--bg);opacity:.75;text-decoration:none">Look 2 · back</a>`, { html: true }); } })
    .transform(res);
}
