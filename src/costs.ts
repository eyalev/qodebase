// What qodebase costs each person (Eyal, 2026-10-07: "I really want users to be
// conscious of the cost"). One Ledger DO per handle, one row per day x kind x project:
//   boxes  agent containers: awake seconds (memory + disk, provisioned) and measured
//          CPU seconds, at Cloudflare's Workers Paid rates beyond the included usage
//   claude Claude Code tokens per model from the box's transcripts: dollars on an API
//          key, tokens only on a subscription (no per-use charge; never a made-up $)
//   voice  Talk / Jarvis Workers AI (recorded by src/talk*.ts)
// On the hosted qodebase the boxes and voice bill qodebase's account, not the user:
// those rows say covered. A self-hosted copy pays all of it.
// Prices checked 2026-10-07 (developers.cloudflare.com/containers/platform/pricing,
// platform.claude.com/docs/en/about-claude/pricing). An unknown model is null, never 0.

import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';

export const PRICES_CHECKED = '2026-10-07';
/** USD per second. CPU is charged on active use only (we measure it from the cgroup). */
export const CONTAINER = { gibSecond: 0.0000025, vcpuSecond: 0.00002, gbDiskSecond: 0.00000007 };
/** USD per million tokens: input, 5-minute cache write, cache read, output. */
export const CLAUDE: Record<string, { in: number; cw: number; cr: number; out: number }> = {
  opus: { in: 4, cw: 5, cr: 0.2, out: 20 },        // Claude Opus 5.5
  sonnet: { in: 2, cw: 2.5, cr: 0.2, out: 10 },    // Claude Sonnet 5.5
  haiku: { in: 1, cw: 1.25, cr: 0.1, out: 5 },     // Claude Haiku 4.5
  fable: { in: 10, cw: 12.5, cr: 0.25, out: 50 },  // Claude Fable 5.1
};
export const WORKERS_AI_PER_1K_NEURONS = 0.011;

export type Kind = 'boxes' | 'claude' | 'voice';
export type Tokens = { in: number; out: number; cw: number; cr: number };
export type CostRow = { usd: number | null; covered: boolean; tokens?: Tokens; seconds?: number; cpuSeconds?: number; billing?: 'api' | 'sub' };

const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const modelKey = (m: string) => Object.keys(CLAUDE).find((k) => m.toLowerCase().includes(k)) || null;

/** Dollars for one model's tokens, or null when the model's price is unknown. */
export function claudeUsd(model: string, t: Tokens): number | null {
  const k = modelKey(model);
  if (!k) return null;
  const p = CLAUDE[k];
  return (t.in * p.in + t.cw * p.cw + t.cr * p.cr + t.out * p.out) / 1e6;
}
/** Dollars for a box's awake time (memory and disk provisioned, CPU as measured). */
export const boxUsd = (seconds: number, cpuSeconds: number, gib: number, diskGb: number) =>
  seconds * (gib * CONTAINER.gibSecond + diskGb * CONTAINER.gbDiskSecond) + cpuSeconds * CONTAINER.vcpuSecond;

export class Ledger extends DurableObject<Env> {
  async add(kind: Kind, project: string, row: CostRow, at = Date.now()) {
    const key = `d:${day(at)}:${kind}:${project}`;
    const old = (await this.ctx.storage.get<CostRow>(key)) || { usd: 0, covered: row.covered };
    const sumT = (a?: Tokens, b?: Tokens) => (a || b ? { in: (a?.in || 0) + (b?.in || 0), out: (a?.out || 0) + (b?.out || 0), cw: (a?.cw || 0) + (b?.cw || 0), cr: (a?.cr || 0) + (b?.cr || 0) } : undefined);
    await this.ctx.storage.put(key, {
      usd: old.usd === null || row.usd === null ? null : old.usd + row.usd,
      covered: row.covered, billing: row.billing || old.billing,
      tokens: sumT(old.tokens, row.tokens), seconds: (old.seconds || 0) + (row.seconds || 0) || undefined,
      cpuSeconds: (old.cpuSeconds || 0) + (row.cpuSeconds || 0) || undefined,
    } satisfies CostRow);
  }
  /** Rows of the last `days` days, newest first: { date, kind, project, ...row }. */
  async rows(days = 30) {
    const from = day(Date.now() - (days - 1) * 86400_000);
    const m = await this.ctx.storage.list<CostRow>({ prefix: 'd:', start: `d:${from}` });
    return [...m].map(([k, v]) => { const [, date, kind, ...p] = k.split(':'); return { date, kind: kind as Kind, project: p.join(':'), ...v }; })
      .sort((a, b) => b.date.localeCompare(a.date));
  }
}

const ledger = (env: Env, handle: string) => env.Ledger.get(env.Ledger.idFromName(handle));

/** Record a cost for a person (never throws: cost tracking must not break the work). */
export async function recordCost(env: Env, handle: string, kind: Kind, project: string, row: CostRow) {
  try { if (handle) await ledger(env, handle).add(kind, project, row); } catch (e) { console.log(JSON.stringify({ module: 'costs', event: 'record_failed', handle, kind, err: String(e) })); }
}

/** today / last 7 days / 30-day estimate, split by kind; what the person pays vs what is covered. */
export async function costSummary(env: Env, handle: string) {
  const rows = await ledger(env, handle).rows(30);
  const today = day();
  const week = new Set([...Array(7)].map((_, i) => day(Date.now() - i * 86400_000)));
  const blank = () => ({ usd: 0, covered: 0, subTokens: 0, unknown: false });
  type Row = (typeof rows)[number];
  const sum = (pred: (r: Row) => boolean) => {
    const out = { total: blank(), byKind: {} as Record<string, ReturnType<typeof blank>> };
    for (const r of rows.filter(pred)) {
      for (const t of [out.total, (out.byKind[r.kind] ||= blank())]) {
        if (r.billing === 'sub') t.subTokens += (r.tokens?.in || 0) + (r.tokens?.out || 0) + (r.tokens?.cw || 0) + (r.tokens?.cr || 0);
        else if (r.usd === null) t.unknown = true;
        else if (r.covered) t.covered += r.usd;
        else t.usd += r.usd;
      }
    }
    return out;
  };
  const t = sum((r) => r.date === today), w = sum((r) => week.has(r.date));
  // 30-day estimate at the last 7 days' pace (fewer days of history: their average).
  const daysSeen = Math.max(1, Math.min(7, new Set(rows.filter((r: Row) => week.has(r.date)).map((r: Row) => r.date)).size));
  return { today: t, week: w, month: { usd: (w.total.usd / daysSeen) * 30, covered: (w.total.covered / daysSeen) * 30 }, rows, pricesChecked: PRICES_CHECKED };
}

// ---- the /costs page --------------------------------------------------------------
import { esc, shell } from './ui';
const usd = (n: number) => (n < 0.005 && n > 0 ? '<$0.01' : `$${n.toFixed(2)}`);
const KIND_LABEL: Record<string, string> = { boxes: 'Agent boxes', claude: 'Claude', voice: 'Talk and voice' };
const fmtTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n)) + ' tokens';

export function costsPage(s: Awaited<ReturnType<typeof costSummary>>, selfHost: boolean) {
  const cell = (t: { usd: number; covered: number; subTokens: number; unknown: boolean }) =>
    `${usd(t.usd)}${t.covered ? `<small>+ ${usd(t.covered)} covered by qodebase</small>` : ''}${t.subTokens ? `<small>+ ${fmtTok(t.subTokens)} on your Claude plan</small>` : ''}${t.unknown ? '<small>some not priced</small>' : ''}`;
  const kinds = Object.keys(KIND_LABEL).map((k) => `<tr><td>${KIND_LABEL[k]}</td><td>${cell(s.today.byKind[k] || { usd: 0, covered: 0, subTokens: 0, unknown: false })}</td><td>${cell(s.week.byKind[k] || { usd: 0, covered: 0, subTokens: 0, unknown: false })}</td></tr>`).join('');
  const days = [...new Set(s.rows.map((r) => r.date))].map((d) => {
    const rs = s.rows.filter((r) => r.date === d);
    return `<details class="cday"><summary><b>${d}</b><span>${usd(rs.reduce((a, r) => a + (!r.covered && r.usd ? r.usd : 0), 0))}</span></summary>
${rs.map((r) => `<div class="crow"><span>${esc(KIND_LABEL[r.kind] || r.kind)}${r.project ? `<i>${esc(r.project)}</i>` : ''}</span><span>${r.billing === 'sub' ? fmtTok((r.tokens?.in || 0) + (r.tokens?.out || 0) + (r.tokens?.cw || 0) + (r.tokens?.cr || 0)) : r.usd === null ? 'not priced' : usd(r.usd)}${r.covered ? '<i>covered</i>' : ''}${r.seconds ? `<i>${Math.round(r.seconds / 60)} min awake</i>` : ''}</span></div>`).join('')}</details>`;
  }).join('') || '<p class="desc">Nothing yet. Costs appear here once your agents run.</p>';
  return shell('Costs · qodebase', `<h1>Costs</h1>
<div class="csum"><div><span>Today</span><b>${usd(s.today.total.usd)}</b></div><div><span>Last 7 days</span><b>${usd(s.week.total.usd)}</b></div><div><span>Next 30 days</span><b>${usd(s.month.usd)}</b><small>estimate at this week's pace</small></div></div>
<p class="desc">What you pay. ${selfHost ? 'This copy runs in your Cloudflare account, so its boxes and voice bill you.' : 'On qodebase.app the agent boxes and voice bill qodebase, shown as covered, so you can still see them.'} On a Claude subscription there is no per-use charge: you see tokens against your plan instead.</p>
<table class="ctab"><tr><th></th><th>Today</th><th>7 days</th></tr>${kinds}</table>
<h2>By day</h2>${days}
<h2>How it is measured</h2>
<ul class="cnote"><li>Agent boxes: every second awake (memory $${(CONTAINER.gibSecond * 3600).toFixed(3)} per GiB-hour, disk $${(CONTAINER.gbDiskSecond * 3600).toFixed(5)} per GB-hour) plus the CPU they actually used ($${(CONTAINER.vcpuSecond * 3600).toFixed(3)} per vCPU-hour), Cloudflare Workers Paid rates beyond the plan's included usage.</li>
<li>Claude: tokens per model from Claude Code's own records, at Anthropic's API prices (Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 4.5 $1/$5 per million in/out).</li>
<li>Not measured: git storage and requests, a few cents a month.</li>
<li>Prices checked ${PRICES_CHECKED}. Updated every 10 minutes while agents run.</li></ul>
<style>.csum{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:16px 0}.csum div{border:1px solid var(--line);border-radius:14px;padding:12px}.csum span,.csum small{display:block;color:var(--dim);font-size:13px}.csum b{display:block;font-size:22px;font-weight:600;font-variant-numeric:tabular-nums;margin-top:2px}
.ctab{width:100%;border-collapse:collapse;margin:16px 0;font-variant-numeric:tabular-nums}.ctab th{text-align:left;color:var(--dim);font-weight:500;font-size:13px;padding:6px 4px}.ctab td{padding:10px 4px;border-top:1px solid var(--line);vertical-align:top}.ctab small{display:block;color:var(--dim);font-size:12px}
.cday{border-top:1px solid var(--line);padding:10px 0}.cday summary{display:flex;justify-content:space-between;cursor:pointer;font-variant-numeric:tabular-nums}.crow{display:flex;justify-content:space-between;gap:12px;font-size:14px;color:var(--dim);padding:4px 0}.crow i{font-style:normal;margin-left:10px}.cnote{color:var(--dim);font-size:14px;padding-left:18px}</style>`);
}
