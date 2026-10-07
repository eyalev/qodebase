// The "Agents at work" project view (qb7, docs/contest/ui.md): one mount point; the client
// (work.js) polls GET /api/p/<o>/<n>/landing (qb6's contract, docs/contest/PLAN.md) and
// draws the overview and the drill-downs. ?mock=1 plays public/landing-mock.json instead.
import { WORK_CSS, WORK_JS } from './assets.gen';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function workBody(o: { owner: string; name: string; own: boolean; mock?: boolean }) {
  const api = `/api/p/${encodeURIComponent(o.owner)}/${encodeURIComponent(o.name)}`;
  return `<style>${WORK_CSS}</style><div id="lw" data-src="${o.mock ? '/landing-mock.json' : `${api}/landing`}" data-api="${esc(api)}" data-name="${esc(o.name)}"${o.own ? ' data-own' : ''}${o.mock ? ' data-mock' : ''}></div>`;
}
export const workJs = () => WORK_JS;
