// Theme preview (qb5, 2026-10-13; Eyal: "the app's colour feels a bit dull", reference aced.io): three colour directions
// tried on the REAL app, per device. `?theme=a|b|c` on any page sets the cookie qb-theme (30 days), `?theme=today`
// clears it; while it is set, every HTML page gets that direction's DESIGN.md tokens (light + dark) and its surface
// treatment, plus a small "Violet preview / Back to today" link. Nobody without the cookie sees any difference.
// Applied on the way out (like withBaseline), so no page template changes. Remove once a direction is chosen.
const COOKIE = 'qb-theme';
type Tokens = Record<string, string>;
export const THEMES: Record<string, { name: string; light: Tokens; dark: Tokens }> = {
  a: {
    name: 'Violet',
    light: { bg: '#f7f7fa', card: '#ffffff', chip: '#efeff4', line: '#e4e4ec', frame: '#d4d4de', fg: '#14121f', dim: '#646177', acc: '#6a2ff0', 'acc-fg': '#ffffff', 'acc-soft': '#f0ebfe', busy: '#b7791f', warn: '#c2321f' },
    dark: { bg: '#0d0c12', card: '#16151e', chip: '#211f2b', line: '#2a2836', frame: '#3b3849', fg: '#eeedf3', dim: '#a3a0b3', acc: '#a585ff', 'acc-fg': '#120c24', 'acc-soft': '#231b3d', busy: '#e0a948', warn: '#f08a7e' },
  },
  b: {
    name: 'Emerald',
    light: { bg: '#f6f8f8', card: '#ffffff', chip: '#edf1f1', line: '#e1e7e7', frame: '#cfd7d7', fg: '#0f1716', dim: '#5c6a68', acc: '#00875a', 'acc-fg': '#ffffff', 'acc-soft': '#e3f6ee', busy: '#b7791f', warn: '#c2321f' },
    dark: { bg: '#0a0f0e', card: '#121a18', chip: '#1a2421', line: '#22302c', frame: '#33443f', fg: '#e9f0ee', dim: '#97a7a3', acc: '#2fd39a', 'acc-fg': '#04140e', 'acc-soft': '#0f2a20', busy: '#e0a948', warn: '#f08a7e' },
  },
  c: {
    name: 'Cobalt',
    light: { bg: '#f5f7fb', card: '#ffffff', chip: '#ebeff6', line: '#dfe5ef', frame: '#cbd3e1', fg: '#0e1422', dim: '#59647a', acc: '#2754f5', 'acc-fg': '#ffffff', 'acc-soft': '#e8eeff', busy: '#b7791f', warn: '#c2321f' },
    dark: { bg: '#0a0d14', card: '#121722', chip: '#1a2130', line: '#232b3c', frame: '#344058', fg: '#e9edf5', dim: '#97a2b8', acc: '#7c9bff', 'acc-fg': '#0a1230', 'acc-soft': '#17224a', busy: '#e0a948', warn: '#f08a7e' },
  },
};
const vars = (t: Tokens) => Object.entries(t).map(([k, v]) => `--${k}:${v}`).join(';');
// html:root outranks the pages' own :root, wherever their <style> sits. The surface treatment uses tokens only: the
// page a step below the cards, hairlines on inputs and tiles, the accent on plain links and focus.
export function themeCss(k: string) {
  const t = THEMES[k];
  if (!t) return '';
  return `html:root{${vars(t.light)};color-scheme:light}
@media (prefers-color-scheme:dark){html:root{${vars(t.dark)};color-scheme:dark}}
html,body{background:var(--bg)!important}
textarea,input[type=text],input:not([type]){background-color:var(--card)!important}
.id-size,.bstoggle{background:var(--card)!important;box-shadow:inset 0 0 0 1px var(--line)}
#talk-bar{background:var(--card)!important}
a:not([class]){color:var(--acc)}
:focus-visible{outline-color:var(--acc)!important}
h1,h2{letter-spacing:-0.02em}
#qb-theme-pill{position:fixed;z-index:2147482999;top:calc(env(safe-area-inset-top,0px) + 64px);right:8px;display:flex;align-items:center;gap:8px;min-height:36px;padding:0 12px;border-radius:10px;background:var(--card);color:var(--fg);box-shadow:inset 0 0 0 1px var(--line),0 2px 8px rgba(0,0,0,.08);font:500 13px/1 Geist,ui-sans-serif,sans-serif;text-decoration:none;-webkit-tap-highlight-color:transparent}
#qb-theme-pill::after{content:"";position:absolute;inset:-4px}
#qb-theme-pill i{width:8px;height:8px;border-radius:4px;background:var(--acc)}
#qb-theme-pill span{color:var(--acc);text-decoration:underline;text-underline-offset:3px}`;
}

/** The direction this request asks for: ?theme= first (a|b|c, or today = none), else the cookie. */
export function themeOf(request: Request): { k: string | null; set: string | null } {
  const q = new URL(request.url).searchParams.get('theme');
  if (q === 'today') return { k: null, set: 'clear' };
  if (q && THEMES[q]) return { k: q, set: q };
  const m = /(?:^|;\s*)qb-theme=([abc])(?:;|$)/.exec(request.headers.get('cookie') || '');
  return { k: m ? m[1] : null, set: null };
}

export function withThemePreview(request: Request, res: Response): Response {
  const { k, set } = themeOf(request);
  if (!k && !set) return res;
  if (!(res.headers.get('content-type') || '').startsWith('text/html') || res.status !== 200) return res;
  let out = res;
  if (k) {
    const name = THEMES[k].name;
    out = new HTMLRewriter()
      .on('head', { element(e) { e.onEndTag((end) => { end.before(`<style id="qb-theme-preview">${themeCss(k)}</style>`, { html: true }); }); } })
      .on('body', { element(e) { e.onEndTag((end) => { end.before(`<a id="qb-theme-pill" href="?theme=today" aria-label="${name} colour preview. Back to today's colours"><i></i>${name} preview<span>Back to today</span></a>`, { html: true }); }); } })
      .transform(res);
  }
  if (set) {
    out = new Response(out.body, out);
    out.headers.append('set-cookie', set === 'clear' ? `${COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Lax` : `${COOKIE}=${set}; Path=/; Max-Age=2592000; Secure; SameSite=Lax`);
    out.headers.set('cache-control', 'private, no-store');
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', module: 'theme-preview', event: set === 'clear' ? 'cleared' : 'set', theme: set, path: new URL(request.url).pathname }));
  }
  return out;
}
