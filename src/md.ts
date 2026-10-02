// Just enough Markdown for READMEs: headings, paragraphs, lists, fenced code,
// inline code, bold, links (http/https only). Everything is escaped first.

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]!));

function inline(s: string) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener nofollow">$1</a>');
}

/** READMEs often open with raw HTML (centered logos, badges). Keep the words:
 *  <br> becomes a line break, links keep their text, images and other tags go.
 *  (2048's and particles.js's READMEs showed their HTML as literal text.) */
function stripHtml(src: string) {
  // Only outside ``` fences: an HTML example inside a code block stays verbatim.
  return src.split(/(^```[\s\S]*?^```)/m).map((part, i) => (i % 2 ? part : stripTags(part))).join('');
}
function stripTags(src: string) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<\/?(?:a|p|div|span|h[1-6]|b|strong|i|em|center|sup|sub|picture|source|details|summary|table|tr|td|th|thead|tbody|kbd|code)\b[^>]*>/gi, '');
}

export function markdown(src: string): string {
  const out: string[] = [];
  const lines = stripHtml(src).replace(/\r/g, '').split('\n');
  let para: string[] = [], list: string[] = [], code: string[] | null = null;
  const flush = () => {
    if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; }
    if (list.length) { out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`); list = []; }
  };
  for (const line of lines) {
    if (code) {
      if (line.startsWith('```')) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null; } else code.push(line);
      continue;
    }
    if (line.startsWith('```')) { flush(); code = []; continue; }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) { flush(); const n = Math.min(h[1].length + 1, 4); out.push(`<h${n}>${inline(h[2])}</h${n}>`); continue; }
    const li = line.match(/^\s*[-*]\s+(.*)/);
    if (li) { if (para.length) flush(); list.push(li[1]); continue; }
    if (!line.trim()) { flush(); continue; }
    if (list.length) flush();
    para.push(line.trim());
  }
  if (code) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
  flush();
  return out.join('\n');
}
