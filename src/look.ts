// The site's look (2026-10-07, Eyal: "more gentle, sleek, modern", after Executor's look
// and feel). Font (Geist) and colour tokens live in each page's own CSS; this layer adds
// what spans every page: a size step down, tighter headings, softer corners. Green stays
// the one accent (Build button, links, live dots): Eyal did not want a black button.
// Added after each page's own styles on every HTML page of the UI host (index.ts).

const CSS = `
body,button,input,textarea,select{-webkit-font-smoothing:antialiased}
body{letter-spacing:-.003em}
h1,h2,h3,.land h1{letter-spacing:-.02em}
h1{font-weight:600}
.land h1{font-size:28px;line-height:1.2}
@media (min-width:900px){.land h1{font-size:32px}}
.land .lede,.desc{font-size:16px;line-height:1.55}
.land .browse small,.trys,.gh-note,.note{font-size:14px}
.btn{border-radius:10px!important;font-weight:500!important;box-shadow:none!important}
.chipbtn{border-radius:10px}
textarea,input[type=text],input[type=password],input:not([type]),.field,.landask textarea{border-radius:12px!important;border-color:var(--line)!important}
.prow,.tcard img,.gmenupop{border-radius:14px}
.gtop .g{font-size:14.5px;font-weight:500}
.gtop .mark{font-weight:600;letter-spacing:-.02em}
`;

/** Adds the layer at the end of <head>. */
export function withLook(res: Response): Response {
  if (!(res.headers.get('content-type') || '').startsWith('text/html')) return res;
  return new HTMLRewriter().on('head', { element(e) { e.append(`<style id="look">${CSS}</style>`, { html: true }); } }).transform(res);
}
