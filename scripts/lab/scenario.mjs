#!/usr/bin/env node
// Variants lab: materialise a scenario's starter as a git repo with ONE commit made with a
// fixed author, committer and date, so its sha is the same on every machine: that sha is
// runs.jsonl's scenarioCommit. Also writes public/lab/scenarios.json for the lab page.
//
//   node scripts/lab/scenario.mjs <id> --out <dir>     # prints {id, scenarioCommit, prompt, promptVersion, check}
//   node scripts/lab/scenario.mjs --index              # public/lab/scenarios.json
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, 'scenarios');
const args = process.argv.slice(2);
const load = (id) => JSON.parse(readFileSync(join(DIR, id, 'scenario.json'), 'utf8'));

if (args.includes('--index')) {
  const list = readdirSync(DIR).filter((d) => existsSync(join(DIR, d, 'scenario.json'))).map(load)
    .map(({ id, title, prompt, promptVersion, scenarioVersion, starter, hiddenTotal, about, profile, anchors }) =>
      ({ id, title, prompt, promptVersion, scenarioVersion, starter, hiddenTotal, about, profile, anchors }));
  writeFileSync(join(HERE, '../../public/lab/scenarios.json'), JSON.stringify(list, null, 1) + '\n');
  console.log(`public/lab/scenarios.json: ${list.map((s) => s.id).join(', ')}`);
} else {
  const id = args[0], i = args.indexOf('--out'), out = i >= 0 ? args[i + 1] : null;
  if (!id || !out) { console.error('usage: scenario.mjs <id> --out <dir> | --index'); process.exit(2); }
  const s = load(id);
  if (existsSync(out)) rmSync(out, { recursive: true });
  cpSync(join(DIR, id, 'starter'), out, { recursive: true });
  const env = { ...process.env, GIT_AUTHOR_NAME: 'qodebase lab', GIT_AUTHOR_EMAIL: 'lab@qodebase.app',
    GIT_COMMITTER_NAME: 'qodebase lab', GIT_COMMITTER_EMAIL: 'lab@qodebase.app',
    GIT_AUTHOR_DATE: '2026-10-08T00:00:00Z', GIT_COMMITTER_DATE: '2026-10-08T00:00:00Z' };
  const git = (...a) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', '-c', 'core.autocrlf=false', ...a],
    { cwd: out, env, encoding: 'utf8' }).trim();
  git('init', '-q'); git('add', '-A'); git('commit', '-qm', `${s.title} (scenario ${id} v${s.scenarioVersion})`);
  console.log(JSON.stringify({ id, scenarioCommit: git('rev-parse', 'HEAD'), prompt: s.prompt, promptVersion: s.promptVersion,
    scenarioVersion: s.scenarioVersion, check: s.check }));
}
