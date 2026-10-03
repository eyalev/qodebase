// FRESHBAR, the draining-tag form — copied from remote-manage's src/lib/fresh.js
// (itself podqast's freshTag()), the house default for dates in list rows.
// The caller supplies the horizon: four ages in hours, largest first.

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]!));

export const freshLevel = (ts: number, now: number, steps: number[]) => steps.filter((h) => Math.max(0, now - ts) < h * 3600000).length;

export const relShort = (ts: number, now: number) => {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 60) return `${Math.floor(s / 86400)}d ago`;
  if (s < 86400 * 730) return `${Math.floor(s / 86400 / 30)} mo ago`;
  return `${Math.floor(s / 86400 / 365)}y ago`;
};

export const freshTag = (ts: number, now: number, steps: number[]) => {
  const l = freshLevel(ts, now, steps);
  return `<button type="button" class="fresh${l === 4 ? ' is-new' : ''}" style="--l:${l}" popovertarget="fresh-help" aria-label="${esc(relShort(ts, now))}, how recent"><span class="fresh-t">${esc(relShort(ts, now))}</span></button>`;
};

const span = (h: number) => (h === 24 ? 'a day' : h > 48 && h % 24 === 0 ? `${h / 24} days` : h === 1 ? '1 hour' : `${h} hours`);

export const freshLegend = (steps: number[]) =>
  `<p class="fresh-legend">The shading behind a date shows how recent it is: full within ${span(steps[3])}, empty after ${span(steps[0])}.</p>`;

export const freshHelp = (steps: number[]) => `<div id="fresh-help" popover class="fresh-pop"><b>How recent</b>
  <p>The shading behind a date fills in quarters: under ${[...steps].reverse().map(span).join(', under ')}. Empty means older than ${span(steps[0])}.</p>
  <button type="button" class="chipbtn" popovertarget="fresh-help" popovertargetaction="hide">Close</button></div>`;

export const FRESH_CSS = `
:root{--fresh:color-mix(in srgb,var(--fg) 22%,var(--card))}
button.fresh{display:inline-block;font:inherit;font-size:12px;line-height:1.35;color:var(--dim);border:0;border-radius:4px;
 margin:-1px 0;padding:1px 6px;min-width:var(--fresh-w,6.4em);text-align:left;font-variant-numeric:tabular-nums;cursor:help;vertical-align:baseline;
 background:linear-gradient(to right,var(--fresh) calc(var(--l,0) * 25%),var(--chip) 0);box-shadow:inset 0 0 0 1px var(--line)}
button.fresh.is-new{color:var(--fg)}
.fresh-legend{color:var(--dim);font-size:12px;margin:0 0 8px}
.fresh-pop{max-width:min(340px,calc(100vw - 32px));border:1px solid var(--line);border-radius:12px;padding:14px;background:var(--card);color:var(--fg);font-size:14px}
.fresh-pop p{margin:6px 0 10px;color:var(--dim)}
.fresh-pop::backdrop{background:rgb(0 0 0 / .25)}
`;
