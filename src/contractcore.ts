// Pure parts of the contract view (src/contract.ts), no imports, so the tests run in plain Node.
export type Change = { id: string; title?: string; intent?: string; agent?: string | null; state?: string; files?: string[]; claims?: string[];
  createdAt?: number | null; landedAt?: number | null; events?: { t: number; what: string }[]; landing?: { mainCommit?: string | null } | null };
export type View = { changes?: Change[] };

export const CONTRACT_RX = /(^|\/)[^/]*contracts?[^/]*\.(js|mjs|cjs|ts|mts|d\.ts|json|md|py|go|rs)$/i;
const isSkeleton = (c: Change) => /^\s*skeleton\b/i.test(c.title || '') || /^\s*skeleton\b/i.test(c.intent || '');
// "contracts.js" beats "user-contract.ts" beats "docs/contract-notes.md": the name the skeleton is told to write.
const rank = (p: string) => (/(^|\/)contracts?\.(js|mjs|ts|d\.ts|json)$/i.test(p) ? 0 : /\.(md)$/i.test(p) ? 2 : 1) * 100 + p.split('/').length;
export const best = (ps: string[]) => ps.filter((p) => CONTRACT_RX.test(p)).sort((a, b) => rank(a) - rank(b))[0] || null;

/** The contract's path and how it was found, from the change records alone (no repo reads). */
export function contractFromChanges(changes: Change[]): { path: string; via: 'skeleton' | 'change' } | null {
  const sk = changes.filter(isSkeleton);
  for (const c of sk) { const p = best([...(c.files || []), ...(c.claims || [])]); if (p) return { path: p, via: 'skeleton' }; }
  const p = best(changes.flatMap((c) => c.files || []));
  return p ? { path: p, via: 'change' } : null;
}

/** Agents numbered like the work page (first change first). */
function agentNumbers(changes: Change[]) {
  const m = new Map<string, number>(); let n = 1;
  for (const c of [...changes].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))) if (c.agent && !m.has(c.agent)) m.set(c.agent, n++);
  return m;
}
/** Who created the contract and which later changes edited it, from the change records. */
export function contractHistory(changes: Change[], path: string) {
  const num = agentNumbers(changes);
  const touched = changes.filter((c) => (c.files || []).includes(path))
    .map((c) => ({ id: c.id, title: (c.title || c.intent || c.id).split('\n')[0].slice(0, 140), agent: c.agent ? `Agent ${num.get(c.agent)}` : null, state: c.state || null,
      skeleton: isSkeleton(c), at: c.landedAt ?? c.createdAt ?? null, landed: !!c.landedAt, commit: c.landing?.mainCommit || null }))
    .sort((a, b) => (b.skeleton ? 1 : 0) - (a.skeleton ? 1 : 0) || (a.at || 0) - (b.at || 0));
  return { created: touched[0] || null, edits: touched.slice(1) };
}
export const langOf = (p: string) => /\.(ts|mts|d\.ts)$/i.test(p) ? 'ts' : /\.(js|mjs|cjs)$/i.test(p) ? 'js' : /\.json$/i.test(p) ? 'json' : /\.md$/i.test(p) ? 'md' : 'text';

