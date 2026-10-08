#!/usr/bin/env node
// OpenClaw phase-1 charts (owner qb5; data and findings by qb9: docs/openclaw/FINDINGS.md).
// Reads docs/openclaw/data/{flow,replay}.json directly, nothing copied by hand.
//
//   node docs/openclaw/charts/build.mjs [--png]
//
// Neutral about OpenClaw (contest rule): their no-queue flow is the cheapest and fastest
// of the policies replayed, and the charts say so.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { n, text, lines, rect, track, hbars, split, writeCharts } from '../../../scripts/charts/kit.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const flow = JSON.parse(readFileSync(join(DIR, '../data/flow.json'), 'utf8'));
const replay = JSON.parse(readFileSync(join(DIR, '../data/replay.json'), 'utf8'));
const breaks = JSON.parse(readFileSync(join(DIR, '../data/breaks-summary.json'), 'utf8'));
const triage = JSON.parse(readFileSync(join(DIR, '../data/triage-score.json'), 'utf8'));
// Wilson 95% interval, for the break sample (triage-score.json carries its own)
const wilson = (k, nn) => { const z = 1.96, p = k / nn, d = 1 + z * z / nn, c = p + z * z / (2 * nn), m = z * Math.sqrt(p * (1 - p) / nn + z * z / (4 * nn * nn)); return [(c - m) / d, (c + m) / d]; };
const SRC = 'docs/openclaw/data (qb9, read-only GitHub data, 2026-09-08 to 10-08)';
const L = (f) => f.tag === '1920x1080';
const hrs = (h) => (h >= 48 ? `${(h / 24).toFixed(1)} days` : `${h < 10 ? h.toFixed(1) : Math.round(h)} h`);
const C = [];

// 1. who lands the work
{
  const p = flow.prs, m = p.hours_to_merge_by_mergers, o = p.hours_to_merge_others;
  C.push({ name: 'openclaw-who-lands',
    title: { L: [`${Math.round(p.merged_share_by_mergers)}% of merged PRs come from the ${p.mergers} people`, `who can merge; theirs land in ${hrs(m.p50)}`],
      P: [`${Math.round(p.merged_share_by_mergers)}% of merged PRs`, `come from the ${p.mergers} people`, 'who can merge; theirs', `land in ${hrs(m.p50)}`] },
    sub: { L: ['OpenClaw, last 30 days: median time from opening a PR to merging it'], P: ['OpenClaw, last 30 days: median', 'time from opening a PR to merge'] },
    source: SRC, dataSource: 'docs/openclaw/data/flow.json: prs',
    table: [['', 'PRs merged', 'median to merge', 'p90', 'decided PRs that merge'],
      [`by the ${p.mergers} who can merge`, n(m.n), hrs(m.p50), hrs(m.p90), '—'],
      ['by everyone else', n(o.n), hrs(o.p50), hrs(o.p90), `${p.pct_merged_others}%`]],
    body: (f, box) => hbars(f, { ...box, h: Math.min(box.h, L(f) ? 240 : 380) }, [
      { label: L(f) ? `By the ${p.mergers} who can merge` : `By the ${p.mergers} who merge`, v: m.p50, valueText: hrs(m.p50), extra: `p90 ${hrs(m.p90)}`, extraColor: 'bar' },
      { label: 'By everyone else', v: o.p50, valueText: hrs(o.p50), extra: `p90 ${hrs(o.p90)}`, extraColor: 'bar' },
    ], { labelW: 560, valW: 470 }),
  });
}

// 2. where CI time goes
{
  const e = flow.ci.runner_hours_per_day_est.by_event;
  const rows = [
    ['Pull-request checks', e.pull_request], ['Release gates (dispatch)', e.workflow_dispatch, true],
    ['Hourly full suite on main', e.schedule], ['Push to main', e.push],
  ];
  const known = e.pull_request.runner_hours_per_day + e.schedule.runner_hours_per_day + e.push.runner_hours_per_day;
  C.push({ name: 'openclaw-ci-hours',
    title: { L: [`Pull-request checks use about ${n(Math.round(e.pull_request.runner_hours_per_day / 100) * 100)}`, `of OpenClaw's ~${n(Math.round(known / 100) * 100)} CI runner-hours a day`],
      P: ['Pull-request checks use', `about ${n(Math.round(e.pull_request.runner_hours_per_day / 100) * 100)} of ~${n(Math.round(known / 100) * 100)}`, 'CI runner-hours a day'] },
    sub: { L: ['Runner-hours per day by what started the run, last 7 days'], P: ['Runner-hours per day by what', 'started the run, last 7 days'] },
    source: SRC, dataSource: 'docs/openclaw/data/flow.json: ci.runner_hours_per_day_est (job durations x runs)',
    table: [['run kind', 'runs a day', 'runner-hours a day', 'runs sampled'], ...rows.map(([l, r]) => [l, n(r.runs_per_day), n(r.runner_hours_per_day), String(r.sampled)])],
    body: (f, box) => hbars(f, { ...box, h: Math.min(box.h, L(f) ? 400 : 620) }, rows.map(([label, r, rough]) => ({
      label, v: r.runner_hours_per_day, valueText: n(r.runner_hours_per_day), color: rough ? 'busy' : 'bar',
      ...(rough ? { extra: `rough: ${r.sampled} runs sampled`, extraColor: 'busy' } : {}),
    })), { labelW: 560, valW: 520 }),
  });
}

// 3. where same-hour collisions land
{
  const c = flow.main.same_hour_collisions_by_kind;
  const kinds = Object.entries(c.kinds).sort((a, b) => b[1].pct - a[1].pct);
  const mergeable = ['i18n', 'list/baseline'];
  const share = Math.round(mergeable.reduce((s, k) => s + c.kinds[k].pct, 0));
  const label = { i18n: 'Translation catalogs', 'list/baseline': 'Lists and baselines', code: 'Code', 'tests/scripts': 'Tests and scripts', docs: 'Docs', 'ci config': 'CI config', 'manifest/changelog': 'Manifests, changelog' };
  C.push({ name: 'openclaw-collisions',
    title: { L: [`${share}% of OpenClaw's same-hour file collisions are`, 'translation catalogs and lists'], P: [`${share}% of same-hour file`, 'collisions are translation', 'catalogs and lists'] },
    sub: { L: [`A file on main touched again within an hour: ${n(c.total)} times in 30 days`], P: ['A file on main touched again', `within an hour: ${n(c.total)} times`] },
    source: SRC, dataSource: `docs/openclaw/data/flow.json: main.same_hour_collisions_by_kind (${c.unit})`,
    table: [['kind of file', 'collisions', 'share'], ...kinds.map(([k, v]) => [label[k] || k, n(v.collisions), `${v.pct}%`])],
    body: (f, box) => hbars(f, { ...box, h: Math.min(box.h, L(f) ? 460 : 760) }, kinds.map(([k, v]) => ({ label: label[k] || k, v: v.pct, valueText: `${v.pct}%`, hi: mergeable.includes(k) })), { labelW: 520, valW: 200, max: 35 }),
  });
}

// 4. the replay: cost, wait, red main per landing policy (small multiples, one scale each)
{
  const g = replay.results.find((x) => x.bad === 0.025);
  const pick = [['theirs (measured)', 'No queue (theirs)', 'No queue'], ['queue N32 K4 full', 'Queue, full suite', 'Queue, full'],
    ['queue N16 K4 pr-scope', 'Queue, scoped tests', 'Queue, scoped'], ['land+verify every 60m full', 'Land, verify hourly', 'Verify 1 h'],
    ['land+verify every 20m full', 'Land, verify every 20 min', 'Verify 20 min']]
    .map(([key, long, short]) => ({ ...g.policies.find((p) => p.policy === key), long, short }));
  const theirs = pick[0], scoped = pick[2];
  const x = (scoped.landing_runner_hours_per_day / theirs.landing_runner_hours_per_day).toFixed(1);
  const METRICS = [
    { title: 'CI runner-h a day', v: (p) => p.landing_runner_hours_per_day, fmt: (v) => n(Math.round(v)) },
    { title: 'Median wait', v: (p) => p.wait_min_p50, fmt: (v) => (v ? `${Math.round(v)} min` : '0') },
    { title: 'Main red, h a day', v: (p) => p.red_main_h_per_day ?? 0, fmt: (v) => (v ? v.toFixed(1) : '0') },
  ];
  C.push({ name: 'openclaw-replay',
    title: { L: ['No queue is the cheapest and fastest; a queue running each', `change's own tests keeps main green for ${x}x the landing CI`],
      P: ['No queue is cheapest;', 'scoped tests in a queue', `keep main green for ${x}x CI`] },
    sub: { L: [`OpenClaw's 30 days of main, ${n(replay.changes)} changes, replayed with their CI times`],
      P: [`OpenClaw's main, ${n(replay.changes)} changes, replayed`] },
    source: `sim/openclaw/replay.mjs (qb9). ~${Math.round(100 * breaks.verdicts['same-area-change-landed'] / breaks.sampled)}% of sampled breaks sit next to a same-area change: an upper bound for scoped tests`,
    dataSource: 'docs/openclaw/data/replay.json (bad 2.5%, flake 0.8% per shard); queue N8 K2 full falls behind by days and is left out',
    table: [['policy', 'landing CI runner-h a day', 'wait p50 / p90', 'breaks reaching main a day', 'main red h a day'],
      ...pick.map((p) => [p.long, n(Math.round(p.landing_runner_hours_per_day)), `${Math.round(p.wait_min_p50)} / ${Math.round(p.wait_min_p90)} min`,
        String(Math.round(p.bad_reaching_main / replay.days)), p.red_main_h_per_day === null ? '?' : `${p.red_main_h_per_day}${p.red_main_measured ? ' (measured)' : ''}`])],
    body: (f, box) => {
      let out = '';
      if (L(f)) { // label column + three panels side by side
        const labelW = 500, gap = 50, pw = (box.w - labelW - 2 * gap) / 3, rh = Math.min(84, (box.h - 80) / pick.length), barH = 40;
        METRICS.forEach((m, mi) => {
          const px = box.x + labelW + mi * (pw + gap), max = Math.max(...pick.map(m.v)) || 1;
          out += text(px, box.y + 30, m.title, { size: f.txt - 8, weight: 600 });
          pick.forEach((p, i) => {
            const y = box.y + 70 + i * rh, tw = pw - 160, w = (m.v(p) / max) * tw;
            if (mi === 0) out += text(box.x, y + barH / 2 + 13, p.long, { size: f.txt - 8, c: 'dim' });
            out += track(px, y, tw, barH) + rect(px, y, w, barH, 'bar', { title: `${p.long}: ${m.fmt(m.v(p))}` });
            out += text(px + tw + 14, y + barH / 2 + 14, m.fmt(m.v(p)), { size: f.val - 6, weight: 600, c: 'fg' });
          });
        });
      } else { // phone: the three panels stacked, short labels
        const ph = box.h / 3;
        METRICS.forEach((m, mi) => {
          const py = box.y + mi * ph, max = Math.max(...pick.map(m.v)) || 1, rh = (ph - 60) / pick.length;
          out += text(box.x, py + 30, m.title, { size: f.txt - 10, weight: 600 });
          pick.forEach((p, i) => {
            const y = py + 48 + i * rh, bx = box.x + 300, tw = 420, w = (m.v(p) / max) * tw, barH = Math.min(26, rh - 12), fs = Math.min(f.txt - 14, rh - 6);
            out += text(box.x, y + barH / 2 + fs * 0.36, p.short, { size: fs, c: 'dim' });
            out += track(bx, y, tw, barH) + rect(bx, y, w, barH, 'bar') + text(bx + tw + 14, y + barH / 2 + fs * 0.36, m.fmt(m.v(p)), { size: fs, weight: 600 });
          });
        });
      }
      return out;
    },
  });
}

// 5. the breaks: what landed in the hour a break appeared (sample)
{
  const v = breaks.verdicts, k = v['same-area-change-landed'], [lo, hi] = wilson(k, breaks.sampled);
  C.push({ name: 'openclaw-breaks',
    title: { L: [`${k} of ${breaks.sampled} sampled breaks on OpenClaw's main sit`, 'next to a same-area change from that hour'],
      P: [`${k} of ${breaks.sampled} sampled breaks`, 'sit next to a same-area', 'change from that hour'] },
    sub: { L: [`New failures of the hourly full suite, ${breaks.sampled} of ${breaks.breaks_total} sampled: what landed that hour`], P: [`${breaks.sampled} of ${breaks.breaks_total} breaks sampled:`, 'what landed that hour'] },
    source: `qb9, read-only. ${Math.round(100 * lo)}-${Math.round(100 * hi)}% for all breaks (95%); same area, not the import graph: an upper bound`,
    dataSource: 'docs/openclaw/data/breaks-summary.json',
    table: [['what landed that hour', 'breaks'], ['a change in the same area', String(k)], ['no test file (infra, timeout, build?)', String(v['no-test-file (infra/timeout/build?)'])],
      ['the test runs only on another platform', String(v['platform-only'])], ['no change in that area', String(v['no-change-in-area'])]],
    body: (f, box) => split(f, box.x, box.y + (L(f) ? 60 : 70), box.w, L(f) ? 56 : 60, [
      { v: k, c: 'acc', label: L(f) ? ['a change in the same area'] : ['same-area change'] },
      { v: v['no-test-file (infra/timeout/build?)'], c: 'bar', label: L(f) ? ['no test file (infra, timeout, build?)'] : ['no test file'] },
      { v: v['platform-only'], c: 'busy', label: L(f) ? ['the test runs only on another platform'] : ['other platform'] },
      { v: v['no-change-in-area'], c: 'bad', label: L(f) ? ['no change in that area'] : ['no change there'] }], breaks.sampled, `${breaks.sampled} breaks`, { list: true }),
  });
}

// 6. triage, like for like: the 100 issues the triage agent also did (qb9: use on_agent_subset)
{
  const sub = triage.on_agent_subset, perKind = sub.n / Object.keys(triage.outcome_mix).length;
  const names = { 'haiku-agent': 'Haiku 5.5 agent (searches)', haiku: 'Haiku 5.5, text only', jev: 'Jev, text only', 'clef-flash': 'Clef-flash, text only' };
  const short = { 'haiku-agent': 'Haiku agent', haiku: 'Haiku, text', jev: 'Jev, text', 'clef-flash': 'Clef-flash' };
  const rows = ['haiku-agent', 'haiku', 'jev', 'clef-flash'].map((key) => {
    const r = sub[key], dk = Math.round(r.recall.duplicate * perKind), [dlo, dhi] = wilson(dk, perKind);
    return { key, label: names[key], short: short[key], acc: r.accuracy, dup: { k: dk, n: perKind, p: dk / perKind, lo: dlo, hi: dhi }, hi: key === 'haiku-agent' };
  });
  const agent = rows[0], textBest = Math.max(...rows.slice(1).map((r) => r.dup.p));
  const chance = 1 / Object.keys(triage.outcome_mix).length;
  const pct = (v) => `${Math.round(100 * v)}%`;
  const paired = sub.paired_vs_haiku, clear = paired && paired.p < 0.05;
  const pTxt = paired ? `p = ${paired.p < 0.01 ? paired.p.toFixed(3) : paired.p.toFixed(2)}` : 'p unknown';
  const v2 = triage.agent_rounds?.round2_v2_vs_v1_on_new_100;
  C.push({ name: 'openclaw-triage',
    title: { L: [`A triage agent that can search found ${pct(agent.dup.p)} of duplicates;`, `text-only triage found ${pct(textBest)} at most`],
      P: ['A triage agent that', `can search found ${pct(agent.dup.p)}`, 'of duplicates; text-only', `${pct(textBest)} at most`] },
    sub: { L: [`${sub.n} OpenClaw issues, ${perKind} of each kind. Overall it was right ${pct(agent.acc.p)} vs ${pct(rows[1].acc.p)}${clear ? ` (${pTxt})` : ': not a clear difference'}`],
      P: [`${sub.n} OpenClaw issues, ${perKind} of each`, `kind. Overall ${pct(agent.acc.p)} vs ${pct(rows[1].acc.p)}${clear ? ` (${pTxt})` : ', not clear'}`] },
    source: `sim/openclaw/triage.mjs (qb9), ${triage.question_version}; bars = 95% intervals; agent vs text-only Haiku, paired (${(paired?.test || '').split(' (')[0]}): ${pTxt}`,
    dataSource: 'docs/openclaw/data/triage-score.json: on_agent_subset (+ agent_detail)',
    table: [['classifier', 'right overall', '95% interval', 'duplicates found', 'closes', 'fixes', 'decisions'],
      ...rows.map((r) => { const rc = sub[r.key].recall; return [r.label, pct(r.acc.p), `${pct(r.acc.lo)}-${pct(r.acc.hi)}`, `${r.dup.k} of ${r.dup.n}`, pct(rc.close), pct(rc.fix), pct(rc.decision)]; }),
      [`agent cost for ${sub.n}`, `$${triage.agent_detail.cost_usd_api_equiv} API-equivalent`, `${triage.agent_detail.turns_p50} turns (median)`, '', '', '', ''],
      ...(paired ? [['agent vs text-only Haiku, paired', `only the agent right: ${paired.only_agent_right}`, `only text right: ${paired.only_text_right}`, pTxt, '', '', '']] : []),
      ...(v2 ? [[`agent prompt v2 vs v1, ${v2.n} new issues`, `${pct(v2.a_accuracy.p)} vs ${pct(v2.b_accuracy.p)}`, `p = ${v2.mcnemar_exact_p.toFixed(2)}`, `duplicates ${pct(v2.recall_v2.duplicate.p)} vs ${pct(v2.recall_v1.duplicate.p)}`, '', '', '']] : [])],
    body: (f, box) => {
      // two panels, one scale each (0-100%): right overall (guessing marked) and duplicates found
      const panels = [{ title: 'Right overall', v: (r) => r.acc, mark: chance }, { title: 'Duplicates found', v: (r) => r.dup }];
      let out = '';
      const dot = (x, cy, hiRow) => `<circle cx="${x}" cy="${cy}" r="12" fill="var(--${hiRow ? 'acc' : 'dim'})" stroke="var(--bg)" stroke-width="3"/>`;
      if (L(f)) {
        const labelW = 510, gap = 60, pw = (box.w - labelW - gap) / 2, tw = pw - 120, rh = 86, th = 30;
        panels.forEach((pn, k) => {
          const px = box.x + labelW + k * (pw + gap);
          out += text(px, box.y + 26, pn.title, { size: f.txt - 8, weight: 600 });
          rows.forEach((r, i) => {
            const y = box.y + 56 + i * rh, cy = y + th / 2, a = pn.v(r), X = (p) => px + p * tw;
            if (k === 0) out += text(box.x, cy + (f.txt - 8) * 0.35, r.label, { size: f.txt - 8, c: r.hi ? 'fg' : 'dim', weight: r.hi ? 600 : 400 });
            out += track(px, y, tw, th);
            if (pn.mark) out += `<line x1="${X(pn.mark)}" x2="${X(pn.mark)}" y1="${y - 6}" y2="${y + th + 6}" stroke="var(--dim)" stroke-width="2" stroke-dasharray="4 4"/>`;
            out += rect(X(a.lo), y + 4, (a.hi - a.lo) * tw, th - 8, 'bar', { title: `${r.label}, ${pn.title.toLowerCase()}: ${pct(a.p)} (${pct(a.lo)}-${pct(a.hi)})` }) + dot(X(a.p), cy, r.hi);
            out += text(px + tw + 16, cy + (f.val - 8) * 0.35, pct(a.p), { size: f.val - 8, weight: 600, c: r.hi ? 'fg' : 'dim' });
          });
        });
        out += text(box.x + labelW, box.y + 56 + rows.length * 86 + 20, 'dashed: guessing (one in four)', { size: f.src, c: 'dim' });
      } else {
        const ph = (box.h - 40) / 2;
        panels.forEach((pn, k) => {
          const py = box.y + k * (ph + 20), tw = box.w - 330, th = 26, rh = (ph - 50) / rows.length;
          out += text(box.x, py + 30, pn.title, { size: f.txt - 8, weight: 600 });
          rows.forEach((r, i) => {
            const y = py + 52 + i * rh, cy = y + th / 2, a = pn.v(r), bx = box.x + 220, X = (p) => bx + p * tw;
            out += text(box.x, cy + 10, r.short, { size: f.txt - 14, c: r.hi ? 'fg' : 'dim', weight: r.hi ? 600 : 400 });
            out += track(bx, y, tw, th);
            if (pn.mark) out += `<line x1="${X(pn.mark)}" x2="${X(pn.mark)}" y1="${y - 4}" y2="${y + th + 4}" stroke="var(--dim)" stroke-width="2" stroke-dasharray="4 4"/>`;
            out += rect(X(a.lo), y + 3, (a.hi - a.lo) * tw, th - 6, 'bar') + dot(X(a.p), cy, r.hi);
            out += text(bx + tw + 14, cy + 11, pct(a.p), { size: f.txt - 12, weight: 600, c: r.hi ? 'fg' : 'dim' });
          });
        });
      }
      return out;
    },
  });
}

writeCharts({ dir: DIR, charts: C, png: process.argv.includes('--png'),
  title: 'OpenClaw flow', heading: "How OpenClaw lands its work, and other ways it could",
  description: "OpenClaw's last 30 days on GitHub (read-only): who merges, where CI time goes, where changes collide, and landing policies replayed on its real stream.",
  intro: "Phase 1 of qodebase's OpenClaw study: read-only GitHub data (qb9) and a replay of the real main stream under different landing policies. No model calls.",
  footer: 'Built by docs/openclaw/charts/build.mjs from docs/openclaw/data, 2026-10-08.' });
