#!/usr/bin/env node
// L2 (docs/board/TASKS.md "Lanes"): one landing queue vs many lanes on real code, real git,
// real tests, scripted agents. Each cell runs in its own process (memory), one after another
// (CPU: never alongside other timing runs), and appends one line to sim/real/out/lanes.jsonl.
//
//   node sim/real/lanes.mjs --agents 500,2000 --lanes 1,8,32 --hot shared,split --controller off,on --hours 2
//
// The project grows with the agents (modules = agents / 10: 50 folders x 8 files at 500 agents,
// 200 at 2,000), so files per agent stay the same; --modules N fixes it instead.
// Policy: land by intent (the best single-queue policy of the 500-agent run).
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => { if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]); return acc; }, []));
const list = (k, d) => String(args[k] ?? d).split(',');
const out = args.out || join(HERE, 'out/lanes.jsonl');
const hours = args.hours || 2, seeds = list('seed', '1'), policy = args.policy || 'intents';

for (const agents of list('agents', '500')) for (const hot of list('hot', 'shared')) for (const ctl of list('controller', 'off')) for (const lanes of list('lanes', '1,8,32')) for (const seed of seeds) {
  const modules = args.modules || Math.max(50, Math.round(agents / 10));
  const name = `lanes-${policy}-a${agents}-l${lanes}-${hot}${ctl === 'on' ? '-ctl' : ''}-s${seed}`;
  const r = spawnSync(process.execPath, ['--max-old-space-size=8192', join(HERE, 'run.mjs'), '--policy', policy, '--agents', agents, '--hours', String(hours), '--seed', seed,
    '--lanes', lanes, '--modules', String(modules), '--no-bundle', '--name', name, '--out', out, ...(hot === 'split' ? ['--split-hot'] : []), ...(ctl === 'on' ? ['--controller'] : [])],
  { stdio: ['ignore', 'inherit', 'pipe'], encoding: 'utf8' });
  if (r.status !== 0) { console.error(`${name} failed (${r.status}):\n${r.stderr.split('\n').filter((l) => !l.includes('simulated min')).join('\n')}`); process.exitCode = 1; }
  if (!args.keep) rmSync(join(HERE, 'out', `${name}.git`), { recursive: true, force: true });
}
