// Build settings (B3): presets and custom knobs -> a plan -> landing flags. node --experimental-strip-types --test src/buildsettings.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSettingsOn, resolveBuildPlan, planFlags, crewRules, singleTask, parseJob, SUGGEST_SYSTEM, cleanName } from './buildsettings.ts';

const O = { maxCoders: 12 };

test('the flag: off, owner only, all; never for anonymous', () => {
  assert.equal(buildSettingsOn(undefined, 'eyal', 'eyal'), false);
  assert.equal(buildSettingsOn('off', 'eyal', 'eyal'), false);
  assert.equal(buildSettingsOn('owner', 'eyal', 'eyal'), true);
  assert.equal(buildSettingsOn('owner', 'bob', 'eyal'), false);
  assert.equal(buildSettingsOn('all', 'bob', 'eyal'), true);
  assert.equal(buildSettingsOn('all', null, 'eyal'), false);
});

test('no settings or unknown input: today\'s default (null)', () => {
  for (const s of [undefined, null, 'balanced', {}, { preset: 'nope' }, { preset: 'custom' }, { preset: 'custom', v: 'x' }]) assert.equal(resolveBuildPlan(s, O), null, JSON.stringify(s));
});

test('presets: fastest = one Opus agent; balanced and cheapest = crews as in the lab', () => {
  assert.deepEqual(resolveBuildPlan({ preset: 'fastest' }, O), { kind: 'single', model: 'opus', preset: 'fastest' });
  const b = resolveBuildPlan({ preset: 'balanced' }, O);
  assert.deepEqual([b.kind, b.planner, b.coders, b.coderModel, b.reviewers, b.board], ['crew', 'opus', 12, 'haiku', 3, false]);
  const c = resolveBuildPlan({ preset: 'cheapest' }, O);
  assert.deepEqual([c.coders, c.reviewers], [6, 0]);
  assert.equal(resolveBuildPlan({ preset: 'balanced' }, { maxCoders: 6 }).coders, 6, 'others are capped at the instance limit');
});

test('custom knobs are validated and clamped', () => {
  const p = resolveBuildPlan({ preset: 'custom', v: { planner: 'gpt', coders: 99, coderModel: 'sonnet', reviewers: -2, board: true, trainMax: 'x' } }, O);
  assert.deepEqual([p.planner, p.coders, p.coderModel, p.reviewers, p.board, p.trainMax], ['opus', 12, 'sonnet', 0, true, 4]);
  assert.equal(resolveBuildPlan({ preset: 'custom', v: { board: 'yes' } }, O).board, false, 'board only when exactly true');
  assert.equal(resolveBuildPlan({ preset: 'custom', v: { planner: 'none', coderModel: 'sonnet' } }, O).kind, 'single');
});

test('flags as the lab runner sets them; the router and single-agent texts', () => {
  const f = planFlags(resolveBuildPlan({ preset: 'balanced' }, O));
  assert.deepEqual([f.autoMerge, f.reviewers, f.policy, f.plannerModel, f.coderModel, f.caps.agents, f.board], [true, 3, 'intent', 'opus', 'haiku', 12, false]);
  const s = planFlags(resolveBuildPlan({ preset: 'fastest' }, O));
  assert.deepEqual([s.reviewers, s.coderModel, s.caps.agents], [0, 'opus', 1]);
  assert.match(crewRules(resolveBuildPlan({ preset: 'cheapest' }, O)), /at most 6 tasks/);
  assert.match(singleTask('a todo app', true), /EMPTY project[\s\S]*only agent[\s\S]*a todo app[\s\S]*forq push/);
});

test('the sheet contract (qb7): v as a URL JSON string; 1 opus coder with 0 reviewers = one agent; reviewers use the coders\' model', () => {
  const fast = resolveBuildPlan({ preset: 'custom', v: JSON.stringify({ planner: 'opus', coders: 1, coderModel: 'opus', reviewers: 0, board: false }) }, O);
  assert.deepEqual(fast, { kind: 'single', model: 'opus', preset: 'custom' });
  const c = resolveBuildPlan({ preset: 'custom', v: '{"planner":"opus","coders":4,"coderModel":"sonnet","reviewers":2,"board":true}' }, O);
  assert.deepEqual([c.kind, c.coders, c.coderModel, c.reviewerModel, c.reviewers, c.board], ['crew', 4, 'sonnet', 'sonnet', 2, true]);
  assert.equal(resolveBuildPlan({ preset: 'custom', v: '{not json' }, O), null);
});

test('B4: the model\'s job answer is parsed strictly; anything off is null (the page falls back to a small app)', () => {
  const ok = parseJob('Here: {"v":1,"tasks":14.4,"overlap":"some","difficulty":"normal","vague":false,"summary":"  A bakery   site ","confidence":0.7}');
  assert.deepEqual(ok, { tasks: 14, overlap: 'some', difficulty: 'normal', vague: false, summary: 'A bakery site', confidence: 0.7, kind: 'build' });
  for (const bad of ['no json', '{"tasks":0,"overlap":"some","difficulty":"normal","confidence":0.5}', '{"tasks":5,"overlap":"lots","difficulty":"normal","confidence":0.5}',
    '{"tasks":5,"overlap":"low","difficulty":"normal","confidence":2}', '{"tasks":5,"overlap":"low","difficulty":"normal"}']) assert.equal(parseJob(bad), null, bad);
  assert.match(SUGGEST_SYSTEM, /ONE JSON object only/);
});

test('job.name: kebab-case, 2-3 words, no word twice; a bad name is left out', () => {
  assert.equal(cleanName('Family Trip Planner'), 'family-trip-planner');
  assert.equal(cleanName('help-help-trips planner app'), 'help-trips-planner');
  assert.equal(cleanName('!!'), undefined);
  assert.equal(parseJob('{"tasks":5,"overlap":"low","difficulty":"easy","confidence":0.8,"name":"Family_Trip planner"}').name, 'family-trip-planner');
  assert.equal('name' in parseJob('{"tasks":5,"overlap":"low","difficulty":"easy","confidence":0.8}'), false);
  assert.match(SUGGEST_SYSTEM, /"name"/);
});

test('estimate vs elapsed: the shown estimate is checked and stamped; spend is priced at the lab rates per row model', async () => {
  const { cleanEstimate, apiUsdOf } = await import('./buildsettings.ts');
  const plan = resolveBuildPlan({ preset: 'cheapest' }, O);
  const e = cleanEstimate({ wallS: [300, 720], apiUsd: [0.6, 0.9], basis: 'idea', basedOn: 25, simVersion: 'lab-0.12', extra: 'x' }, plan, 1000);
  assert.deepEqual(e, { startedAt: 1000, wallS: [300, 720], apiUsd: [0.6, 0.9], preset: 'cheapest', v: { coders: 6, coderModel: 'haiku', reviewers: 0, board: false }, basis: 'idea', basedOn: 25, simVersion: 'lab-0.12' });
  for (const bad of [null, {}, { wallS: [5, 1], apiUsd: [0, 1] }, { wallS: [1, 2], apiUsd: [-1, 1] }, { wallS: [1, 2, 3], apiUsd: [0, 1] }]) assert.equal(cleanEstimate(bad, plan), null);
  assert.equal(cleanEstimate({ wallS: [1, 2], apiUsd: [0, 1] }, null).preset, null, 'a default build (no plan) still keeps its estimate');
  const rows = [{ kind: 'claude', project: 'eyal/app:claude-haiku-5-5', tokens: { in: 1e6, out: 1e6 } }, { kind: 'claude', project: 'eyal/app', tokens: { out: 1e5 } },
    { kind: 'boxes', project: 'eyal/app', tokens: { in: 1e9 } }, { kind: 'claude', project: 'eyal/other', tokens: { in: 1e6 } }];
  assert.equal(apiUsdOf(rows, 'eyal/app'), 0.6 + 2, 'haiku 1M in + 1M out = $0.60; the unnamed row at opus: 100k out = $2');
  assert.equal(apiUsdOf([], 'eyal/app'), null, 'no token rows yet: unknown, not $0');
});

test('default Build (no Adjust): one Opus agent, the merge queue on, landing by itself with its checks', async () => {
  const { DEFAULT_PLAN } = await import('./buildsettings.ts');
  assert.deepEqual(DEFAULT_PLAN, { kind: 'single', model: 'opus', preset: 'default' });
  const f = planFlags(DEFAULT_PLAN);
  assert.deepEqual([f.autoMerge, f.reviewers, f.policy, f.coderModel, f.caps.agents], [true, 0, 'intent', 'opus', 1], 'intent policy: tests run before landing (ffa would skip them)');
});

test('I2 ideas: 8 curated per size, each in its bucket; picks avoid recent titles; the model\'s idea must land in the bucket', async () => {
  const { CURATED_IDEAS, IDEA_SIZES, pickCurated, parseIdea, IDEA_SYSTEM } = await import('./buildsettings.ts');
  for (const [size, list] of Object.entries(CURATED_IDEAS)) {
    assert.equal(list.length, 8, size);
    for (const i of list) { assert.ok(i.job.tasks >= IDEA_SIZES[size].lo && i.job.tasks <= IDEA_SIZES[size].hi, `${size}: ${i.title}`); assert.ok(i.job.name && i.prompt.length > 20); }
  }
  const avoid = CURATED_IDEAS.small.slice(0, 7).map((i) => i.title);
  assert.equal(pickCurated('small', avoid, () => 0).title, CURATED_IDEAS.small[7].title);
  assert.ok(pickCurated('small', CURATED_IDEAS.small.map((i) => i.title)), 'all avoided: still one');
  const ok = '{"title":"Garden planner","prompt":"Plan a vegetable garden: beds, what grows where, watering reminders.","tasks":7,"overlap":"some","difficulty":"normal","vague":false,"summary":"A garden planner.","confidence":0.8,"name":"garden-planner"}';
  assert.equal(parseIdea(ok, 'medium').title, 'Garden planner');
  assert.equal(parseIdea(ok, 'small'), null, '7 pieces is not small');
  assert.equal(parseIdea(ok.replace('"title":"Garden planner",', ''), 'medium'), null, 'no title');
  assert.match(IDEA_SYSTEM('large', ['Bakery website']), /between 12 and 29[\s\S]*Not any of: Bakery website/);
});

test('ideas are static, single-user apps: the rule is in the prompt, and server-needing ideas are refused', async () => {
  const { IDEA_SYSTEM, parseIdea, NEEDS_SERVER, CURATED_IDEAS } = await import('./buildsettings.ts');
  assert.match(IDEA_SYSTEM('huge', []), /static web app[\s\S]*No server, no accounts[\s\S]*import\/export/);
  const base = (prompt) => JSON.stringify({ title: 'Shop', prompt, tasks: 40, overlap: 'some', difficulty: 'normal', vague: false, summary: 's', confidence: 0.8, name: 'shop' });
  assert.equal(parseIdea(base('An online shop with accounts, checkout and email receipts.'), 'huge'), null);
  assert.ok(parseIdea(base('A shop catalogue kept on the phone: products, stock, sales charts, CSV import and export, printable price lists.'), 'huge'));
  for (const [size, list] of Object.entries(CURATED_IDEAS)) for (const i of list) assert.ok(!NEEDS_SERVER.test(i.prompt), `${size}: ${i.title} needs a server: ${i.prompt}`);
});

test('job.kind for qb4\'s jobType: port | sweep only when the model says so, else build; ideas are builds', async () => {
  const { parseJob, parseIdea, CURATED_IDEAS, SUGGEST_SYSTEM } = await import('./buildsettings.ts');
  const j = (kind) => JSON.stringify({ tasks: 6, overlap: 'some', difficulty: 'normal', vague: false, summary: 's', confidence: 0.8, name: 'x-y', ...(kind ? { kind } : {}) });
  assert.equal(parseJob(j('port')).kind, 'port');
  assert.equal(parseJob(j('sweep')).kind, 'sweep');
  assert.equal(parseJob(j('refactor')).kind, 'build');
  assert.equal(parseJob(j()).kind, 'build');
  assert.match(SUGGEST_SYSTEM, /"kind":"build"\|"port"\|"sweep"/);
  assert.equal(parseIdea(JSON.stringify({ title: 'Garden planner', prompt: 'Plan a garden with beds and watering reminders kept on the phone.', tasks: 7, overlap: 'some', difficulty: 'normal', confidence: 0.8, name: 'garden-planner', kind: 'port' }), 'medium').job.kind, 'build');
  for (const list of Object.values(CURATED_IDEAS)) for (const i of list) assert.equal(i.job.kind, 'build');
});
