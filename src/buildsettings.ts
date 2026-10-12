// Build settings (docs/board/TASKS.md "Build settings", B3): the Adjust sheet on Build picks a preset or
// custom knobs, and the Build path applies them the way the lab runner does (scripts/lab/run.mjs): the landing
// system on, its flags, the models per role, reviewers, the board. No settings, or the flag off for this
// person: today's default Build, untouched.
//
// Flag: Worker var BUILD_SETTINGS = off | owner | all ('owner' = only the instance owner sees and can use it).
// Presets come from the lab (public/lab/predict.js BUILD_PRESETS, qb4): the single source of their knobs.

// @ts-ignore: plain JS module shared with the lab page (no types)
import { BUILD_PRESETS } from '../public/lab/predict.js';

export type BuildModel = 'haiku' | 'sonnet' | 'opus';
export type BuildPlan =
  | { kind: 'single'; model: BuildModel; preset: string }   // one agent does the whole job, no router (lab: opus-alone)
  | { kind: 'crew'; preset: string; planner: BuildModel; coders: number; coderModel: BuildModel; reviewers: number;
      reviewerModel: BuildModel; board: boolean; trainMax: number };

const MODELS = new Set(['haiku', 'sonnet', 'opus']);
const model = (v: unknown, d: BuildModel): BuildModel => (MODELS.has(String(v)) ? String(v) as BuildModel : d);
const int = (v: unknown, lo: number, hi: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

export function buildSettingsOn(flag: string | undefined, handle: string | null | undefined, owner: string | undefined) {
  if (!handle) return false;
  return flag === 'all' || (flag === 'owner' && !!owner && handle === owner);
}

/** The settings a Build request carries ({preset, v}) as a plan, or null for today's default.
 *  Every knob is validated and clamped; anything unknown falls back to the default (null). */
export function resolveBuildPlan(s: unknown, o: { maxCoders: number }): BuildPlan | null {
  if (!s || typeof s !== 'object') return null;
  const { preset, v } = s as { preset?: unknown; v?: unknown };
  const p = String(preset || '');
  let knobs: Record<string, unknown>;
  if (p === 'custom') {
    let vv: unknown = v;
    if (typeof vv === 'string') { try { vv = JSON.parse(vv); } catch { return null; } }   // the page's ?v=<JSON>
    if (!vv || typeof vv !== 'object') return null;
    knobs = vv as Record<string, unknown>;
  } else if (p in BUILD_PRESETS) knobs = (BUILD_PRESETS as Record<string, { variant: Record<string, unknown> }>)[p].variant;
  else return null;
  // One agent, no router: the lab's opus-alone, a planner of 'none', or the sheet's 1 coder with no reviewers.
  if (knobs.baseline === 'opus-alone' || knobs.planner === 'none' || (Number(knobs.coders) === 1 && Number(knobs.reviewers || 0) === 0))
    return { kind: 'single', model: model(knobs.coderModel, 'opus'), preset: p };
  return {
    kind: 'crew', preset: p,
    planner: model(knobs.planner, 'opus'),
    coders: int(knobs.coders, 1, o.maxCoders, Math.min(6, o.maxCoders)),
    coderModel: model(knobs.coderModel, 'haiku'),
    reviewers: int(knobs.reviewers, 0, 3, 1),
    reviewerModel: model(knobs.reviewerModel, model(knobs.coderModel, 'haiku')),   // the sheet: reviewers use the coders' model
    board: knobs.board === true,
    trainMax: int(knobs.trainMax, 1, 8, 4),
  };
}

/** Landing flags for a plan (as the lab runner sets them; POST …/landing/flags shape). */
export function planFlags(plan: BuildPlan) {
  if (plan.kind === 'single') return { autoMerge: true, reviewers: 0, coderModel: plan.model, agentModel: plan.model, policy: 'ffa' as const, trainMax: 1, caps: { agents: 1, awake: 1 } };
  return {
    autoMerge: true, reviewers: plan.reviewers, reviewStyle: 'read' as const, policy: 'intent' as const, llmReplay: true,
    plannerModel: plan.planner, coderModel: plan.coderModel, reviewerModel: plan.reviewerModel, trainMax: plan.trainMax,
    caps: { agents: plan.coders, awake: plan.coders }, board: plan.board, dedupe: true,
  };
}

/** The extra rules the router gets for a crew (the lab runner's router text, minus the lab-only parts). */
export function crewRules(plan: Extract<BuildPlan, { kind: 'crew' }>) {
  return [
    `How to work: split this into at most ${plan.coders} tasks and start one agent per task (never more than ${plan.coders} at once).`,
    'Begin every task text with a short title line (under 60 characters) saying what it does; details after it.',
    'Merging is automatic: approved changes go to the merge queue, which replays collisions on the latest code. Do not merge anything yourself.',
  ].join('\n');
}

/** The task for the single agent (Fastest): the whole job, no router. */
export function singleTask(prompt: string, empty: boolean) {
  return `${empty ? 'This is a brand-new, EMPTY project (no commits yet). ' : 'This is a brand-new project with a placeholder index.html and README.md. '}`
    + `You are the only agent on it: build the whole thing yourself, in small commits.\n\nThe person wants:\n\n${prompt}\n\n`
    + 'If people will use it in a browser, prefer plain static files (index.html at the root, no build step). Replace the README. '
    + 'When it works, push with `forq push` and run `forq status pushed "<what you built>"`.';
}

// ---- B4: the prompt analysis (src/buildsuggest.ts calls the model) ----
export const SUGGEST_SYSTEM = `You size software jobs for a team of coding agents. Read the request and answer with ONE JSON object only, no prose:
{"v":1,"tasks":<integer 1-80: pieces of work a careful planner would split this into, at the grain of one page / one feature / one module; a one-page tweak is 1-3, a small app 6-10, a full site 20-30>,
"overlap":"low"|"some"|"high" (low: separate modules; some: a shared layout, index or nav; high: many pieces edit the same few files, or the request lists near-duplicate features),
"difficulty":"easy"|"normal"|"hard" (easy: copy, styling, CRUD; hard: algorithms, auth, payments, concurrency, migrations),
"vague":true|false (true if key requirements are left to guesswork),
"summary":"<one plain sentence, at most 120 characters>",
"name":"<a project name: 2-3 lowercase words joined by hyphens, from the core noun phrase of what is built, e.g. family-trip-planner; no verbs like want/build/help, no word twice>",
"confidence":<0-1>}`;

export type Job = { tasks: number; overlap: 'low' | 'some' | 'high'; difficulty: 'easy' | 'normal' | 'hard'; vague: boolean; summary: string; confidence: number; name?: string };

/** The model's project name, cleaned: lowercase kebab, 2-3 words, no word twice, <= 30 chars; else undefined. */
export function cleanName(v: unknown): string | undefined {
  const words = String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const out: string[] = [];
  for (const w of words) if (!out.includes(w) && out.length < 3) out.push(w);
  const name = out.join('-').slice(0, 30).replace(/-+$/, '');
  return out.length >= 1 && name.length >= 3 ? name : undefined;
}

/** The model's answer as a job, or null (any field missing or out of range). */
export function parseJob(text: string): Job | null {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j: any; try { j = JSON.parse(m[0]); } catch { return null; }
  const tasks = Math.round(Number(j.tasks));
  if (!(tasks >= 1 && tasks <= 80)) return null;
  if (!['low', 'some', 'high'].includes(j.overlap) || !['easy', 'normal', 'hard'].includes(j.difficulty)) return null;
  const confidence = Number(j.confidence);
  if (!(confidence >= 0 && confidence <= 1)) return null;
  const name = cleanName(j.name);
  return { tasks, overlap: j.overlap, difficulty: j.difficulty, vague: j.vague === true, summary: String(j.summary || '').replace(/\s+/g, ' ').trim().slice(0, 120), confidence, ...(name ? { name } : {}) };
}

