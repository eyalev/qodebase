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

/** A Build with no Adjust settings (Eyal, 2026-10-12: "Everything should be automated by default… like the Claude
 *  Code experience on this laptop"): one Opus agent, the merge queue on, approved changes land on their own. */
export const DEFAULT_PLAN: BuildPlan = { kind: 'single', model: 'opus', preset: 'default' };

/** Landing flags for a plan (as the lab runner sets them; POST …/landing/flags shape). */
export function planFlags(plan: BuildPlan) {
  if (plan.kind === 'single') return { autoMerge: true, reviewers: 0, coderModel: plan.model, agentModel: plan.model, policy: 'intent' as const, llmReplay: true, trainMax: 1, caps: { agents: 1, awake: 1 } };
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


// ---- the estimate shown at Build, and what the build really took (estimate vs elapsed bar) ----
export type BuildEstimate = { startedAt: number; wallS: [number, number]; apiUsd: [number, number]; preset: string | null;
  v: { coders?: number; coderModel?: string; reviewers?: number; board?: boolean } | null; basis: 'typical' | 'idea'; basedOn: number | null; simVersion: string | null };

/** The estimate the page showed, as sent with the build: numbers checked, nothing else kept. Null when absent or bad. */
export function cleanEstimate(e: unknown, plan: BuildPlan | null, now = Date.now()): BuildEstimate | null {
  if (!e || typeof e !== 'object') return null;
  const o = e as Record<string, unknown>;
  const pair = (x: unknown, max: number): [number, number] | null => {
    if (!Array.isArray(x) || x.length !== 2) return null;
    const [a, b] = x.map(Number);
    return Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b >= a && b <= max ? [a, b] : null;
  };
  const wallS = pair(o.wallS, 7 * 86400), apiUsd = pair(o.apiUsd, 1000);
  if (!wallS || !apiUsd) return null;
  return { startedAt: now, wallS, apiUsd, preset: plan?.preset || null,
    v: plan ? (plan.kind === 'single' ? { coders: 1, coderModel: plan.model, reviewers: 0, board: false } : { coders: plan.coders, coderModel: plan.coderModel, reviewers: plan.reviewers, board: plan.board }) : null,
    basis: o.basis === 'idea' ? 'idea' : 'typical', basedOn: Number.isFinite(Number(o.basedOn)) ? Math.round(Number(o.basedOn)) : null,
    simVersion: typeof o.simVersion === 'string' ? o.simVersion.slice(0, 40) : null };
}

/** API-price cost of a project's Claude token rows (the Ledger), at the lab's standard rates, so it compares with
 *  the estimate (predict.js prices the same way). A row names its model (`owner/name:model`); else `fallback`. */
const RATES: Record<string, [number, number, number, number, number]> = {   // per MTok: in, out, cache read, 5-min write, 1-h write
  haiku: [0.10, 0.50, 0.01, 0.125, 0.20], sonnet: [2, 10, 0.10, 2.5, 4], opus: [4, 20, 0.20, 5, 8] };
export function apiUsdOf(rows: { kind: string; project: string; tokens?: { in?: number; out?: number; cr?: number; cw?: number; cw1h?: number } }[], project: string, fallback = 'opus') {
  let usd = 0, n = 0;
  for (const r of rows) {
    if (r.kind !== 'claude' || !r.tokens || !(r.project === project || r.project.startsWith(project + ':'))) continue;
    const m = r.project.includes(':') ? r.project.slice(r.project.lastIndexOf(':') + 1) : fallback;
    const k = /opus/.test(m) ? 'opus' : /sonnet/.test(m) ? 'sonnet' : 'haiku';
    const [i, o, cr, cw, cw1h] = RATES[k], t = r.tokens;
    usd += ((t.in || 0) * i + (t.out || 0) * o + (t.cr || 0) * cr + (t.cw || 0) * cw + (t.cw1h || 0) * cw1h) / 1e6; n++;
  }
  return n ? Math.round(usd * 1000) / 1000 : null;
}

// ---- I2: "Need an idea?" by size (docs/board/TASKS.md I1-I3). Sizes = the predictor's buckets. ----
export type IdeaSize = 'small' | 'medium' | 'large' | 'huge';
export const IDEA_SIZES: Record<IdeaSize, { lo: number; hi: number; words: string }> = {
  small: { lo: 1, hi: 4, words: 'a one-screen tool or a small change: 1-4 pieces of work' },
  medium: { lo: 5, hi: 11, words: 'a small app with a few screens: 5-11 pieces of work' },
  large: { lo: 12, hi: 29, words: 'a full app or site with many features: 12-29 pieces of work' },
  huge: { lo: 30, hi: 80, words: 'a big product with many parts: 30 or more pieces of work' },
};
export type Idea = { title: string; prompt: string; job: Job };
const J = (tasks: number, overlap: Job['overlap'], difficulty: Job['difficulty'], summary: string, name: string): Job =>
  ({ tasks, overlap, difficulty, vague: false, summary, confidence: 0.8, name });
/** Hand-written ideas per size: the instant first paint, and the fallback when the model fails or misses the size. */
export const CURATED_IDEAS: Record<IdeaSize, Idea[]> = {
  small: [
    { title: 'Tip splitter', prompt: 'A page that splits a restaurant bill: enter the total, the tip percent and how many people, and see what each person pays.', job: J(2, 'low', 'easy', 'A bill and tip splitter on one page.', 'tip-splitter') },
    { title: 'Click counter', prompt: 'A single page with a big button that counts taps, a reset button, and the count kept after a reload.', job: J(1, 'low', 'easy', 'A tap counter that remembers its count.', 'tap-counter') },
    { title: 'Pomodoro timer', prompt: 'A 25-minute focus timer with a 5-minute break, start/pause/reset, and a sound when time is up.', job: J(3, 'low', 'easy', 'A focus timer with breaks and a sound.', 'pomodoro-timer') },
    { title: 'Dice roller', prompt: 'Roll one to six dice with a tap, show the faces and the total, and keep the last ten rolls.', job: J(2, 'low', 'easy', 'A dice roller with a short history.', 'dice-roller') },
    { title: 'Unit converter', prompt: 'Convert between kilometres and miles, kilograms and pounds, and Celsius and Fahrenheit as you type.', job: J(3, 'low', 'easy', 'A live unit converter for three kinds of units.', 'unit-converter') },
    { title: 'Password maker', prompt: 'Make a random password with a length slider and switches for digits and symbols, with a copy button.', job: J(2, 'low', 'easy', 'A random password generator with options.', 'password-maker') },
    { title: 'Water tracker', prompt: 'Tap to add a glass of water, see today against a goal of eight, and start fresh each day.', job: J(3, 'low', 'easy', 'A daily water counter with a goal.', 'water-tracker') },
    { title: 'Countdown', prompt: 'Count down the days, hours and minutes to a date I pick, with the event name on top.', job: J(2, 'low', 'easy', 'A countdown to a chosen date.', 'event-countdown') },
  ],
  medium: [
    { title: 'Shopping list', prompt: 'A shared shopping list: add items with a quantity, tick them off, group them by aisle, and clear the ticked ones.', job: J(6, 'some', 'normal', 'A shopping list with aisles and ticking.', 'shopping-list') },
    { title: 'Habit tracker', prompt: 'Track three daily habits: tick each day, see a streak and a month calendar per habit, and add or rename habits.', job: J(7, 'some', 'normal', 'A habit tracker with streaks and a calendar.', 'habit-tracker') },
    { title: 'Recipe box', prompt: 'Save recipes with ingredients and steps, scale the servings, search by name, and mark favourites.', job: J(8, 'some', 'normal', 'A recipe box with scaling and search.', 'recipe-box') },
    { title: 'Quiz game', prompt: 'A quiz with ten multiple-choice questions, a score at the end, a timer per question, and a way to add my own questions.', job: J(7, 'some', 'normal', 'A timed quiz with custom questions.', 'quiz-game') },
    { title: 'Expense notes', prompt: 'Note expenses with an amount, a category and a date, see totals per category this month, and export a CSV.', job: J(8, 'some', 'normal', 'An expense log with monthly totals and CSV.', 'expense-notes') },
    { title: 'Reading list', prompt: 'Keep a list of books to read, reading and done, with notes and a star rating, and sort by date or rating.', job: J(6, 'some', 'easy', 'A reading list with states, notes and ratings.', 'reading-list') },
    { title: 'Workout log', prompt: 'Log workouts as exercises with sets and reps, see past sessions, and a chart of one exercise over time.', job: J(8, 'some', 'normal', 'A workout log with history and a chart.', 'workout-log') },
    { title: 'Flashcards', prompt: 'Make decks of flashcards, study them with flip and know/don\'t-know, and repeat the ones I missed.', job: J(7, 'some', 'normal', 'Flashcard decks with spaced repeats.', 'flashcards') },
  ],
  large: [
    { title: 'Bakery website', prompt: 'A bakery website: menu with photos, a cart, checkout, an order admin page, opening hours, and email confirmations.', job: J(16, 'some', 'normal', 'A bakery site with cart, checkout and admin.', 'bakery-shop') },
    { title: 'Family trip planner', prompt: 'Plan family trips: destinations, a day-by-day plan, a packing list per person, a shared budget, and a map of the stops.', job: J(18, 'some', 'normal', 'A trip planner with days, packing, budget and map.', 'family-trip-planner') },
    { title: 'Club manager', prompt: 'A sports club app: members, teams, a training calendar, attendance, fees paid or due, and news posts.', job: J(20, 'some', 'normal', 'A club app for members, training and fees.', 'club-manager') },
    { title: 'Event booking', prompt: 'List events, book seats with a seat map, see my bookings, cancel, and an organiser view with sales per event.', job: J(16, 'some', 'hard', 'Event listings with seat booking and sales.', 'event-booking') },
    { title: 'Home inventory', prompt: 'Keep track of things at home: rooms, items with photos and value, warranties with reminders, and a printable list for insurance.', job: J(14, 'some', 'normal', 'A home inventory with warranties and reports.', 'home-inventory') },
    { title: 'Class dashboard', prompt: 'A teacher\'s dashboard: classes, students, assignments with due dates, grades, and a progress chart per student.', job: J(18, 'some', 'normal', 'A class dashboard for assignments and grades.', 'class-dashboard') },
    { title: 'Plant care', prompt: 'Track house plants: watering and feeding schedules, reminders, photos over time, and care notes per species.', job: J(12, 'some', 'normal', 'A plant care tracker with schedules and photos.', 'plant-care') },
    { title: 'Job tracker', prompt: 'Track job applications: companies, stages from applied to offer, interview dates, notes, and a weekly summary.', job: J(13, 'some', 'normal', 'A job application tracker with stages.', 'job-tracker') },
  ],
  huge: [
    { title: 'Small online shop', prompt: 'An online shop: catalogue with categories and search, product pages, cart, checkout, accounts, order history, stock admin, discounts, and sales reports.', job: J(36, 'high', 'hard', 'A full online shop with admin and reports.', 'online-shop') },
    { title: 'Clinic booking system', prompt: 'A clinic system: doctors and their hours, patient booking and reminders, patient records, a waiting room screen, invoices, and an admin dashboard.', job: J(40, 'high', 'hard', 'A clinic booking and records system.', 'clinic-booking') },
    { title: 'Learning platform', prompt: 'A course platform: courses with lessons and videos, quizzes, progress per learner, certificates, a teacher area for building courses, and discussions.', job: J(45, 'high', 'hard', 'A course platform with quizzes and certificates.', 'learning-platform') },
    { title: 'Restaurant system', prompt: 'A restaurant system: menu, table orders from the phone, a kitchen screen, payments, reservations, stock, and daily reports.', job: J(38, 'high', 'hard', 'A restaurant ordering and kitchen system.', 'restaurant-system') },
    { title: 'Community forum', prompt: 'A community forum: categories, threads and replies, accounts with profiles, mentions and notifications, moderation tools, and search.', job: J(34, 'high', 'normal', 'A forum with profiles, notifications and moderation.', 'community-forum') },
    { title: 'Project tracker', prompt: 'A team project tracker: projects, tasks on a board, assignees, due dates, comments, files, a calendar, and weekly reports.', job: J(36, 'high', 'normal', 'A team project tracker with board and reports.', 'project-tracker') },
    { title: 'Fitness studio app', prompt: 'A fitness studio app: class schedule, booking with waitlists, memberships and payments, trainer pages, check-in, and member stats.', job: J(32, 'high', 'normal', 'A studio app for classes, members and payments.', 'fitness-studio') },
    { title: 'Event festival app', prompt: 'A festival app: lineup and stages, a personal schedule, a map, tickets with QR codes, news alerts, and an organiser back office.', job: J(34, 'high', 'normal', 'A festival app with lineup, tickets and back office.', 'festival-app') },
  ],
};

/** A curated idea of this size, not one of `avoid` (titles) when possible. */
export function pickCurated(size: IdeaSize, avoid: string[] = [], rnd = Math.random): Idea {
  const all = CURATED_IDEAS[size], fresh = all.filter((i) => !avoid.includes(i.title));
  const pool = fresh.length ? fresh : all;
  return pool[Math.floor(rnd() * pool.length) % pool.length];
}

export const IDEA_SYSTEM = (size: IdeaSize, avoid: string[]) => `You invent one thing a person could build with a team of coding agents, of a given size. Answer with ONE JSON object only, no prose:
{"title":"<2-4 words>","prompt":"<what to build, 1-3 plain sentences a non-programmer would write, phone-friendly, concrete features>",
"tasks":<integer: pieces of work a careful planner would split it into, one page / one feature / one module each>,
"overlap":"low"|"some"|"high","difficulty":"easy"|"normal"|"hard","vague":false,"summary":"<one sentence, <=120 chars>","confidence":<0-1>,
"name":"<2-3 lowercase words joined by hyphens>"}
The size must be: ${IDEA_SIZES[size].words}, so "tasks" must be between ${IDEA_SIZES[size].lo} and ${IDEA_SIZES[size].hi}.
Something ordinary people want (a household, a club, a small business, a hobby), not developer tools.${avoid.length ? ` Not any of: ${avoid.slice(0, 12).join('; ')}.` : ''}`;

/** The model's idea, or null: a valid job in the requested bucket, a title and a prompt. */
export function parseIdea(text: string, size: IdeaSize): Idea | null {
  const job = parseJob(text);
  if (!job) return null;
  const { lo, hi } = IDEA_SIZES[size];
  if (job.tasks < lo || job.tasks > hi) return null;
  let j: any; try { j = JSON.parse(String(text).match(/\{[\s\S]*\}/)![0]); } catch { return null; }
  const title = String(j.title || '').replace(/\s+/g, ' ').trim().slice(0, 40), prompt = String(j.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  return title.length >= 3 && prompt.length >= 20 ? { title, prompt, job } : null;
}
