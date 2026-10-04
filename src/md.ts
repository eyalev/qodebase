// Just enough Markdown for READMEs: headings, paragraphs, lists, fenced code,
// inline code, bold, links (http/https only). Everything is escaped first.

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]!));

function inline(s: string) {
  // Code spans first, kept aside so nothing inside them is formatted.
  const codes: string[] = [];
  let t = esc(s).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(`<code>${c}</code>`) - 1}\u0000`);
  t = t.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a || b}</strong>`)
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,!?:;]|$)|(^|[\s(])_([^_\s][^_]*)_(?=[\s).,!?:;]|$)/g, (_, p1, a, p2, b) => `${p1 ?? p2 ?? ''}<em>${a || b}</em>`)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener nofollow">$1</a>')
    // A link to a file in the repo ([box/Dockerfile](box/Dockerfile)) keeps its words.
    .replace(/\[([^\]]+)\]\((?!https?:)[^)\s]+\)/g, '$1')
    // Bare URLs become links (not ones already inside an href).
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,!?:;'"])/g, '$1<a href="$2" rel="noopener nofollow">$2</a>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

/** READMEs often open with raw HTML (centered logos, badges). Keep the words:
 *  <br> becomes a line break, links keep their text, images and other tags go.
 *  (2048's and particles.js's READMEs showed their HTML as literal text.) */
function stripHtml(src: string) {
  // Only outside ``` fences: an HTML example inside a code block stays verbatim.
  return src.split(/(^```[\s\S]*?^```)/m).map((part, i) => (i % 2 ? part : stripTags(part))).join('');
}
/** Markdown images and badges add nothing here (images are not shown): drop linked
 *  images `[![a](img)](url)`, images `![a](img)` / `![a][ref]`, and reference
 *  definitions `[ref]: url`; a reference link `[text][ref]` keeps its text. */
function stripImages(src: string) {
  // Inline code is left exactly as written.
  return src.split(/(`[^`\n]*`)/).map((part, i) => (i % 2 ? part : stripImagesIn(part))).join('');
}
function stripImagesIn(src: string) {
  return src
    .replace(/\[!\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])\](?:\([^)]*\)|\[[^\]]*\])/g, '')
    .replace(/!\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])/g, '')
    .replace(/^\s{0,3}\[[^\]]+\]:\s*\S+.*$/gm, '')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1');
}
function stripTags(src: string) {
  return stripImages(src)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<\/?(?:a|p|div|span|h[1-6]|b|strong|i|em|center|sup|sub|picture|source|details|summary|table|tr|td|th|thead|tbody|kbd|code)\b[^>]*>/gi, '');
}

export function markdown(src: string): string {
  const out: string[] = [];
  const lines = stripHtml(src).replace(/\r/g, '').split('\n');
  let para: string[] = [], list: string[] = [], code: string[] | null = null, ordered = false, table: string[] = [];
  // GitHub tables: a header row, a |---| row, then body rows (forq's SELF_HOST.md showed them raw, 2026-10-04).
  const cells = (r: string) => r.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
  const flushTable = () => {
    if (!table.length) return;
    if (table.length >= 2 && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(table[1])) {
      const head = cells(table[0]), body = table.slice(2).map(cells);
      const th = head.some((c) => c) ? `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>` : '';
      out.push(`<div class="tbl"><table>${th}<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    } else out.push(`<p>${inline(table.join(' '))}</p>`);
    table = [];
  };
  const flush = () => {
    flushTable();
    if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; }
    if (list.length) { const tag = ordered ? 'ol' : 'ul'; out.push(`<${tag}>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</${tag}>`); list = []; }
  };
  for (const line of lines) {
    if (code) {
      if (line.startsWith('```')) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null; } else code.push(line);
      continue;
    }
    if (line.startsWith('```')) { flush(); code = []; continue; }
    if (line.trim().startsWith('|')) { if (!table.length) flush(); table.push(line); continue; }
    if (table.length) flush();
    // Underlined headings: a paragraph line followed by === or ---.
    if (para.length === 1 && /^(=+|-+)\s*$/.test(line)) { const n = line.trim()[0] === '=' ? 2 : 3; out.push(`<h${n}>${inline(para[0])}</h${n}>`); para = []; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<hr>'); continue; }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) { flush(); const n = Math.min(h[1].length + 1, 4); out.push(`<h${n}>${inline(h[2])}</h${n}>`); continue; }
    const li = line.match(/^\s*[-*+]\s+(.*)/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (li || ol) { if (para.length || (list.length && ordered !== !!ol)) flush(); ordered = !!ol; list.push((li || ol)![1]); continue; }
    if (!line.trim()) { flush(); continue; }
    if (list.length) flush();
    para.push(line.trim());
  }
  if (code) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
  flush();
  return out.join('\n');
}
