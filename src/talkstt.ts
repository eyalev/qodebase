// What Whisper heard, from whatever the Workers AI binding hands back (shared by src/talk.ts and its test, so erasable
// TypeScript only). 2026-10-13: the binding sometimes returned a raw Response instead of the parsed result; the old
// String(res.text) turned its text() METHOD into "function text() { [native code] }", which Talk then quoted to Eyal as
// "Did you say …?". Only real words come out of here.
export async function sttText(res: any): Promise<{ text: string; shape: string }> {
  let r = res, shape = 'object';
  if (r && typeof r === 'object' && typeof r.text === 'function' && typeof r.json === 'function') {
    shape = 'response';
    const body = await r.text().catch(() => '');
    try { r = JSON.parse(body); } catch { r = { text: body }; }
  }
  if (r && typeof r === 'object' && r.result && typeof r.result === 'object') { r = r.result; shape += '+result'; }
  const raw = r && typeof r.text === 'string' ? r.text : typeof r === 'string' ? r : '';
  return { text: wordsOnly(raw), shape };
}
/** '' unless it reads as words someone said: no code, no markup, at least one letter. */
export function wordsOnly(s: unknown): string {
  const t = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
  if (!t || !/\p{L}/u.test(t)) return '';
  if (/\bfunction\s*\w*\s*\(|\[native code\]|=>|^\s*[{[<]|\bundefined\b|\[object \w+\]/.test(t)) return '';
  return t;
}
