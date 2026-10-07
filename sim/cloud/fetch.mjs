#!/usr/bin/env node
// Download the finished Cloudflare run into the viewer: public/sim/runs/cloud-<agents>.json + index.
//   node sim/cloud/fetch.mjs
import { writeFileSync, readFileSync } from 'node:fs';
const RUNS = new URL('../../public/sim/runs/', import.meta.url).pathname;
const b = await fetch('https://qbsim-cloud.forqdev.workers.dev/bundle', { headers: { 'user-agent': 'qbsim-cli/1' } }).then((r) => r.json());
if (b.error) { console.error(b.error); process.exit(1); }
const json = JSON.stringify(b);
writeFileSync(`${RUNS}${b.meta.name}.json`, json);
const index = JSON.parse(readFileSync(`${RUNS}index.json`, 'utf8'));
const entry = { name: b.meta.name, policy: 'cloud', label: b.meta.label, agents: b.meta.agents, hours: b.meta.hours, stats: b.stats, bytes: json.length };
const i = index.findIndex((x) => x.name === entry.name); if (i >= 0) index[i] = entry; else index.push(entry);
index.sort((a, c) => a.agents - c.agents || a.name.localeCompare(c.name));
writeFileSync(`${RUNS}index.json`, JSON.stringify(index, null, 1));
console.log(JSON.stringify({ name: entry.name, landed: b.stats.landed, ...b.stats.cloud, bytes: json.length }));
