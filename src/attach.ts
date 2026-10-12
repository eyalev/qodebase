// Visual context from the phone (docs/board/TASKS.md S1-S3): images attached to a request, and elements picked in
// the running app, sent to the router or an agent like a screenshot in tmux-web.
//   POST /api/p/<o>/<n>/attach      raw image bytes (png|jpeg|webp|gif, <= 8 MB), owner -> {id, name, type, size, url}
//   GET  /api/p/<o>/<n>/attach/<id> the image, owner only
//   GET  /api/agent/attachment?id=  the box's own project's image (agent token): the box downloads it
// R2 bucket qodebase-attachments (binding ATTACH), lifecycle rule: deleted after 30 days.
// A message keeps its attachments as a marker line; sendTo (index.ts) has the box fetch the files into
// /workspace/attachments and replaces the marker with the paths, so delayed delivery (the router) works too.

export const ATTACH_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
export const ATTACH_MAX = 8 * 1024 * 1024;
export const ATTACH_PER_MESSAGE = 6;
const ID_RE = /^[a-z0-9]{12}\.(png|jpg|webp|gif)$/;
export const isAttachId = (id: string) => ID_RE.test(id);
export const attachKey = (slug: string, id: string) => `a/${slug}/${id}`;
export const BOX_DIR = '/workspace/attachments';

export function newAttachId(type: string) {
  const ext = ATTACH_TYPES[type];
  if (!ext) return null;
  const r = crypto.getRandomValues(new Uint8Array(12));
  return [...r].map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('') + '.' + ext;
}

export type Pick = { kind: 'pick'; selector?: string; tag?: string; text?: string; html?: string; url?: string };
const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** The text a request carries: the person's words, then the picked elements as a short block, then (if any) the
 *  attachment marker that sendTo turns into file paths. Unknown ids are dropped. */
export function composeMessage(text: string, slug: string, attachments: unknown, context: unknown) {
  const ids = (Array.isArray(attachments) ? attachments : []).map(String).filter(isAttachId).slice(0, ATTACH_PER_MESSAGE);
  const picks = (Array.isArray(context) ? context : []).filter((c) => c && typeof c === 'object' && (c as Pick).kind === 'pick').slice(0, 8) as Pick[];
  let out = text.trim();
  if (picks.length) {
    out += '\n\nThe person pointed at ' + (picks.length === 1 ? 'this element' : 'these elements') + ' in the running app:\n' + picks.map((p, i) =>
      `${picks.length > 1 ? `${i + 1}. ` : '- '}${clip(p.tag, 20) || 'element'}${p.selector ? ` \`${clip(p.selector, 200)}\`` : ''}${p.text ? `, text "${clip(p.text, 200)}"` : ''}${p.url ? ` on ${clip(p.url, 200)}` : ''}${p.html ? `\n   ${clip(p.html, 600)}` : ''}`).join('\n');
  }
  if (ids.length) out += `\n\n${marker(slug, ids)}`;
  return { text: out, ids, picks: picks.length };
}

const MARK_RE = /\n*\[\[qb-attach slug=([a-z0-9.-]+) ids=([a-z0-9.,]+)\]\]\s*$/;
export const marker = (slug: string, ids: string[]) => `[[qb-attach slug=${slug} ids=${ids.join(',')}]]`;
/** A message's attachment marker, if any: {slug, ids, rest (the text without it)}. */
export function parseMarker(text: string) {
  const m = text.match(MARK_RE);
  if (!m) return null;
  return { slug: m[1], ids: m[2].split(',').filter(isAttachId), rest: text.slice(0, m.index).trimEnd() };
}
/** What Claude Code reads instead of the marker: where each file is (or that some could not be copied). */
export function attachedLines(rest: string, fetched: string[], failed: string[]) {
  const lines = [rest];
  if (fetched.length) lines.push(`Attached ${fetched.length === 1 ? 'image' : 'images'} from the person (open ${fetched.length === 1 ? 'it' : 'each'} with your Read tool and look before you act):\n${fetched.map((id) => `- ${BOX_DIR}/${id}`).join('\n')}`);
  if (failed.length) lines.push(`(${failed.length} attached image${failed.length === 1 ? '' : 's'} could not be copied into your box.)`);
  return lines.join('\n\n');
}
