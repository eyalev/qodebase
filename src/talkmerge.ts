// The final dictation text from two transcripts of the same speech (manager's ask, 2026-10-13, after tmux-web's
// merge-dg-groq pass): the live words (Deepgram nova-3, which gets the person's project names as keyterms) and
// Whisper on the whole recording (better sentences, can miss names, clip the start or repeat itself). One small
// model call (glm-4.7-flash, thinking off) picks the words; anything odd falls back to Whisper's text.
// Used by src/talk.ts (POST /api/talk/merge) and scripts/talk-stt-bench.mjs, so erasable TypeScript only.

export const MERGE_MODEL = '@cf/zai-org/glm-4.7-flash';

export function mergeMessages(live: string, whisper: string, names: string[], lang: string) {
  const system = [
    'You merge two transcripts of the same short spoken message into the words the speaker actually said.',
    'A is the live transcript: it knows the speaker\'s names and terms (listed below) but can garble sentence structure.',
    'B is Whisper on the whole recording: better wording and punctuation, but it can misspell names, drop the first words, or repeat a phrase.',
    'Rules: keep the speaker\'s own words; never add, explain, answer, summarise or translate; prefer B\'s wording;',
    'use the name list or A where B misheard a name or term; keep words at the start that A has and B dropped;',
    'keep a phrase once when B repeats it and A does not; keep the language the speaker used' + (lang === 'he' ? ' (Hebrew)' : '') + '.',
    'Reply with the final text only: no quotes, no labels, no notes.',
  ].join(' ');
  const user = `Names and terms the speaker uses: ${names.slice(0, 40).join(', ') || '(none)'}\nA (live): ${live || '(nothing)'}\nB (whisper): ${whisper || '(nothing)'}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

/** The model's answer if it is a plausible merge of A and B, else null (the caller keeps Whisper's text). */
export function cleanMerge(out: unknown, live: string, whisper: string): string | null {
  let t = String(out ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim().replace(/^["“]|["”]$/g, '').trim();
  if (!t) return null;
  if (/^(here|the (final|merged)|final:|a:|b:|sure|i )/i.test(t)) return null;
  const longest = Math.max(live.length, whisper.length);
  if (t.length > longest * 1.4 + 20 || t.length < Math.min(live.length, whisper.length) * 0.5) return null;
  return t;
}
