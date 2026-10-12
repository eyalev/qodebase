// G2 History: the change record behind a landed commit, as History shows it. Pure (tested in landed.test.mjs).
import type { Change } from './landing';

/** What History shows under a landed commit (G2): the change record behind it. */
export type LandedEntry = { id: string; title: string; intent: string; agent: string; verdict: 'approved' | 'auto' | 'changes' | null;
  reviewer?: string; replayed: boolean; how: 'clean' | 'handler' | 'model' | null; stackedOn?: string; landedAt: number };
export function landedEntry(c: Change): LandedEntry {
  const h = c.landing?.how;
  const reviewer = [...c.events].reverse().find((e) => e.what === 'reviewing' && /^by \S+/.test(e.detail || ''))?.detail?.slice(3).split(' ')[0];
  return { id: c.id, title: c.title, intent: (c.intent || '').split('\n\nAsked:')[0].slice(0, 300), agent: c.agent, verdict: c.review?.verdict || null,
    ...(reviewer ? { reviewer } : {}), replayed: !!h && h !== 'merged', how: h === 'merged' ? 'clean' : h === 'replayed-handler' ? 'handler' : h ? 'model' : null,
    ...(c.stackedOn ? { stackedOn: c.stackedOn } : {}), landedAt: c.landedAt || 0 };
}

