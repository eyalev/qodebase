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
    `How to work: you have ${plan.coders} agents; use them. Split this into at least ${plan.coders} tasks along file and area lines (one page, view, module or feature area per task) and start one agent per task, never more than ${plan.coders} at once (start the rest as agents finish). Tasks may touch shared files (layout, routes, data, styles): the merge queue replays collisions, so do not merge work into fewer, bigger tasks to avoid them. Avoid stacking tasks on each other unless one truly cannot start without the other; an agent can build on a placeholder and push.`,
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
"kind":"build"|"port"|"sweep" (port: rewrite existing code into another language or framework; sweep: one kind of change applied across many files, like a rename or an upgrade; build: anything else),
"confidence":<0-1>}`;

export type Job = { tasks: number; overlap: 'low' | 'some' | 'high'; difficulty: 'easy' | 'normal' | 'hard'; vague: boolean; summary: string; confidence: number; name?: string;
  /** qb4's jobType (predict.js): port = rewrite into another language/framework, sweep = one change across many files. Model-given, default build. */
  kind?: 'build' | 'port' | 'sweep' };

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
  const kind = j.kind === 'port' || j.kind === 'sweep' ? j.kind : 'build';
  return { tasks, overlap: j.overlap, difficulty: j.difficulty, vague: j.vague === true, summary: String(j.summary || '').replace(/\s+/g, ' ').trim().slice(0, 120), confidence, ...(name ? { name } : {}), kind };
}


// ---- the estimate shown at Build, and what the build really took (estimate vs elapsed bar) ----
export type BuildEstimate = { startedAt: number; wallS: [number, number]; apiUsd: [number, number]; preset: string | null;
  v: { coders?: number; coderModel?: string; reviewers?: number; board?: boolean } | null; basis: 'typical' | 'idea'; basedOn: number | null; simVersion: string | null; realBuilds?: number };

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
    simVersion: typeof o.simVersion === 'string' ? o.simVersion.slice(0, 40) : null,
    // How many real builds the estimate was fitted to (qb4's refit, 0a2362c): the bar says 'from 25 lab runs and N real builds'.
    realBuilds: Number.isFinite(Number(o.realBuilds)) && Number(o.realBuilds) >= 0 ? Math.min(10_000, Math.floor(Number(o.realBuilds))) : 0 };
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
    const long = /haiku-5-5@long/.test(m) ? 5 : 1;   // a call above 100k prompt tokens (box.ts files it under <model>@long)
    const [i, o, cr, cw, cw1h] = RATES[k].map((x) => x * long) as typeof RATES[string], t = r.tokens;
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
  ({ tasks, overlap, difficulty, vague: false, summary, confidence: 0.8, name, kind: 'build' });
/** Hand-written ideas per size: the instant first paint, and the fallback when the model fails or misses the size.
 *  GENERATED from docs/board/static-ideas.json (qb4, fc71712: static, single-user, data in the browser); edit that file and
 *  regenerate, don't edit here. */
export const CURATED_IDEAS: Record<IdeaSize, Idea[]> = {
  small: [
    { title: "Tip splitter", prompt: "A tip and bill splitter for a restaurant table. Enter the bill and pick a tip of 10, 15 or 20 percent or type your own; set how many people; show what each person pays, rounded up to whole euros if I tick a box.", job: J(3, "some", "easy", "A bill and tip splitter for a table.", "tip-splitter") },
    { title: "Dice and coin", prompt: "A dice roller and coin flipper for board game nights. Roll one to six dice with a shake animation, flip a coin, and keep a short history of the last ten results.", job: J(3, "some", "easy", "Dice roller and coin flip with history.", "dice-and-coin") },
    { title: "Focus timer", prompt: "A focus timer: 25 minutes of work, then a 5 minute break, with a long break after four rounds. Big start and pause buttons, a sound when time is up, a count of rounds done today, and settings for the three lengths.", job: J(4, "some", "normal", "A work/break focus timer with rounds.", "focus-timer") },
    { title: "Water tracker", prompt: "A water tracker: tap a glass to add 250 ml, see progress toward a daily goal I can set, and see the last seven days as small bars. It resets at midnight.", job: J(3, "some", "easy", "Daily water goal with a 7-day view.", "water-tracker") },
    { title: "Kitchen converter", prompt: "A kitchen unit converter: cups, spoons, grams and millilitres for common ingredients like flour, sugar and butter; oven temperatures between Celsius, Fahrenheit and gas mark; and a recipe scaler that multiplies amounts.", job: J(3, "low", "easy", "Cooking units, oven temperatures and scaling.", "kitchen-converter") },
    { title: "Breathing guide", prompt: "A breathing exercise guide: a circle that grows and shrinks to show when to breathe in, hold and breathe out, with box breathing and 4-7-8 patterns to pick from, and a session length of one to ten minutes.", job: J(3, "some", "normal", "Animated breathing patterns with a session length.", "breathing-guide") },
    { title: "Days until", prompt: "A countdown page: add events with a name and a date, and see the days left until each one, soonest first. Past events move to a list at the bottom.", job: J(2, "some", "easy", "Countdowns to my events, soonest first.", "days-until") },
    { title: "Team picker", prompt: "A random team picker for a kids' football game: type the players' names once and keep them, pick who is playing today, then split them into two or more fair random teams with a reshuffle button.", job: J(3, "some", "easy", "Fair random teams from a saved player list.", "team-picker") },
  ],
  medium: [
    { title: "Habit streaks", prompt: "A habit tracker. Add habits with an emoji and a colour; tick them off each day on a home list; show each habit's current and best streak; a month calendar per habit; a weekly summary; a list of what is left today; and export and import of my data as a file.", job: J(7, "some", "normal", "Habits with streaks, calendars and export.", "habit-streaks") },
    { title: "Trip packing list", prompt: "A packing list for trips. Start a trip from templates (beach, city, ski, business); tick items as I pack; add my own items and categories; show how much is packed; copy a past trip; and a dark mode.", job: J(6, "some", "normal", "Packing lists from templates with progress.", "packing-list") },
    { title: "Plant care", prompt: "A plant care app. A list of my plants with a photo from the phone; how often each needs water and feeding; a today screen with what to water; a log of when I watered; snooze a plant for a day; and a care-tips page per plant type.", job: J(6, "low", "normal", "Plant watering schedule with a log.", "plant-care") },
    { title: "Score keeper", prompt: "A score keeper for board and card games. Set up players with colours; add points per round with big buttons; show a running total and a round-by-round table; undo the last entry; declare a winner at a target score; keep a history of past games; and per-player win counts.", job: J(7, "some", "normal", "Board game scores with history and win counts.", "score-keeper") },
    { title: "Flashcards", prompt: "A flashcard app with spaced repetition. Make decks; add cards with a front and back; study with a flip animation; rate each card as again, hard or easy and schedule it accordingly; show cards due today; deck stats; import cards from pasted text; and swipe gestures on the phone.", job: J(8, "some", "normal", "Flashcard decks with spaced repetition.", "flashcards") },
    { title: "Trip expenses", prompt: "An expense splitter for a group trip, kept on my phone. Add people; add an expense with who paid and who shared it; split equally or by amounts; show each person's balance; work out the fewest transfers to settle up; filter by category; totals per day; and copy a summary as text to send to the group.", job: J(8, "some", "normal", "Group trip expenses and who owes whom.", "trip-expenses") },
    { title: "Workout log", prompt: "A gym workout log. A list of exercises; start a workout and log sets with weight and reps; a rest timer between sets; repeat my last workout; personal bests per exercise; a chart of one exercise over time; and a calendar of workout days.", job: J(7, "some", "normal", "Gym sets, rest timer, bests and charts.", "workout-log") },
    { title: "Chore chart", prompt: "A chore chart for kids on the family tablet. Add children and chores with points; each child ticks off their chores for the day; points add up toward rewards a parent sets; a parent screen behind a simple PIN to approve; a weekly board of who did what; and a reset each week.", job: J(6, "some", "easy", "Kids chores with points and rewards.", "chore-chart") },
  ],
  large: [
    { title: "Recipes and meal plan", prompt: "A recipe book with a meal planner. Recipes with ingredients, steps, photo, tags and servings; scale servings; a cook mode with big text, step by step, screen kept awake and timers per step; search and filter by tag; favourites; a week planner where I drag recipes onto days; a shopping list built from the week, grouped by aisle, with tick-off; pantry items to skip; notes per recipe; import a recipe from pasted text; export and import everything; and a dark mode.", job: J(18, "some", "normal", "Recipe book, cook mode, week plan and shopping list.", "meal-planner") },
    { title: "Monthly budget", prompt: "A personal budget app. Wallets for cash and cards; income and expenses with categories; a budget per category per month; quick add from the home screen; recurring items like rent; a month view with what is left per category; charts of spending by category and over months; search; savings goals with progress; warnings when a category runs over; CSV import from my bank; CSV export; and a currency setting.", job: J(16, "some", "normal", "Budget per category with charts and CSV import.", "monthly-budget") },
    { title: "Reading tracker", prompt: "A reading tracker. Add books with title, author, cover photo and page count; shelves for want to read, reading and done; log pages read per day; a yearly goal with progress; notes and quotes per book; star ratings; stats like pages per month and favourite authors; a reading streak; search; and export to a file.", job: J(14, "low", "normal", "Books, shelves, goals, quotes and stats.", "reading-tracker") },
    { title: "Vocabulary trainer", prompt: "A vocabulary trainer for learning Portuguese. Word lists by topic; add words with translation and an example sentence; four quiz modes (multiple choice, type the answer, listen and pick with the phone's speech voice, match pairs); spaced repetition; a daily goal and streak; mistakes reviewed at the end; progress per list; a word of the day; and import of a list from pasted text.", job: J(16, "some", "normal", "Portuguese word lists with four quiz modes.", "vocab-trainer") },
    { title: "Garden planner", prompt: "A vegetable garden planner. Draw beds as a grid; drag plants into squares; a plant library with spacing, sowing months and companions; warnings for bad neighbours; a sowing calendar for the year; a to-do list of what to sow or harvest this week; a harvest log with weights; notes with photos; and a season archive.", job: J(15, "some", "normal", "Garden bed grid, sowing calendar and harvest log.", "garden-planner") },
    { title: "Party planner", prompt: "A birthday party planner for the host. The event with date, place and theme; a guest list where I mark who said yes and their food needs; a budget with expected and actual costs; a shopping list; a timeline of tasks counting down to the day; a menu planner; a playlist list; a printable invitation page; a day-of schedule; and a thank-you tracker after.", job: J(14, "some", "normal", "Party guests, budget, timeline and day-of plan.", "party-planner") },
    { title: "Running plan", prompt: "A training plan for a first 10 km run. Pick a race date and get a week-by-week plan; today's session on the home screen; log runs with distance, time and how it felt; pace worked out for me; a weekly total; move a session to another day; rest-day tips; charts of distance and pace; and a countdown to the race.", job: J(14, "some", "normal", "10 km plan, run log, pace and charts.", "running-plan") },
    { title: "Home inventory", prompt: "A home inventory. Rooms and boxes; items with a photo, price, purchase date and where they are; warranty end dates with a list of what expires soon; search across everything; move items between rooms; a value total per room for insurance; tags; a lent-out list with who has what; a printable list per room; and export to a file.", job: J(15, "some", "normal", "Rooms, items, warranties and insurance lists.", "home-inventory") },
  ],
  huge: [
    { title: "Family organiser", prompt: "A family organiser for one household on one shared phone or tablet. A calendar with day, week and month views and a colour per person; recurring events; chores with rotation and points; a meal planner; a shopping list fed by the meal plan; a to-do list per person; birthdays with a list of what is coming up; school timetables; a notes board; emergency contacts; a packing list for trips; pocket money tracking; a screen-time log; a home screen with today for everyone; per-person profiles with avatars; search across everything; works offline; dark mode; and export and import of all data as a file.", job: J(36, "high", "normal", "A one-phone family hub: calendar, chores, meals, lists.", "family-hub") },
    { title: "Café website", prompt: "A website for a small neighbourhood café. Home page with hours and a map link; a menu with categories, photos, prices and allergens; filters for vegan and gluten-free; a cart that turns a pickup order into a WhatsApp message to the café; specials of the day; an events page; a gallery; an about page; a stamp card for regulars kept on their phone; an edit mode behind a PIN where the owner changes the menu, prices, specials, hours and events on this device and exports them as a file to publish; English and Portuguese; and a print-friendly menu.", job: J(32, "some", "normal", "A café site with menu, cart-to-WhatsApp and a PIN edit mode.", "cafe-site") },
    { title: "Course builder", prompt: "A small course app for teaching kids basic coding ideas. Courses made of lessons; lessons with text, images and mini exercises; quizzes with several question types; progress per course; badges; a learner profile with avatar; a teacher mode behind a PIN to write and reorder lessons and quizzes; a lesson editor with preview; certificates to print at the end of a course; search; bookmarks; notes per lesson; streaks; works offline; and export and import of courses as files.", job: J(34, "some", "normal", "Lessons, quizzes, badges and a lesson editor, all local.", "course-builder") },
    { title: "Keep in touch", prompt: "A personal keep-in-touch journal. People with photo, how we met, tags and notes; a log of calls, messages and meetings; how often I want to be in touch with each and who is overdue; birthdays coming up; gift ideas; groups; a timeline per person; search and filters; a weekly review screen; quick add from the home screen; import from a contacts CSV; charts of who I see most; and export to a file.", job: J(30, "some", "normal", "A personal contacts journal with reminders to reach out.", "keep-in-touch") },
    { title: "Travel planner", prompt: "A travel planner and journal. Trips with dates and places; a day-by-day itinerary with drag to reorder; bookings for flights, trains and hotels with confirmation numbers I type in; a budget in several currencies with rates I enter; a packing list; a documents checklist; places to see with notes and a map link; a journal with photos per day; a shared-cost splitter; a countdown; works offline; a printable itinerary; and a past-trips archive with stats.", job: J(32, "some", "normal", "Trips, itinerary, bookings, budget and a photo journal.", "travel-planner") },
    { title: "Mini arcade", prompt: "A mini arcade of six phone games: snake, a breakout clone, 2048, memory pairs, a simple platform jumper and minesweeper. Each with touch controls, levels or difficulty, sound effects with a mute switch, a pause screen and a high-score table. Plus an arcade home screen with game cards, a player name, total play time, achievements across games, settings for sound and vibration, and it works offline.", job: J(36, "low", "hard", "Six touch games with scores and achievements.", "mini-arcade") },
    { title: "Fitness diary", prompt: "A complete fitness diary. Workout plans by goal; an exercise library with how-to steps; workout logging with sets, reps, weight and a rest timer; running logs; body measurements and weight over time with charts; a water and sleep log; a calories and protein diary with saved foods; weekly goals; streaks and achievements; a calendar; progress photos; personal bests; a home dashboard; and export and import as a file.", job: J(32, "some", "normal", "Workouts, runs, body, food and sleep with charts.", "fitness-diary") },
    { title: "Classroom kit", prompt: "A toolkit for a primary school teacher, on the classroom tablet. Classes and pupils; a drag-and-drop seating chart; attendance with a monthly report; a random pupil picker and group maker; a noise meter using the microphone; timers and a visual countdown; a points board for teams; a homework tracker; a gradebook with averages and charts; a quick quiz with scores; a lesson planner by week; behaviour notes; birthdays; and export of reports as files.", job: J(34, "low", "normal", "A teacher's toolkit: seating, attendance, timers, grades.", "classroom-kit") },
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
Something ordinary people want (a household, a club, a small business, a hobby), not developer tools.
It must be buildable as what Build makes today: a static web app (HTML, CSS and JavaScript) whose data stays in the browser (localStorage or IndexedDB), used by one person on a phone. No server, no accounts or sign-in, no payments or checkout, no email, no push notifications, nothing shared between people. A big size means many real features of that kind: several views, editors, search and filters, import/export of files, charts, offline use, printing.${avoid.length ? ` Not any of: ${avoid.slice(0, 12).join('; ')}.` : ''}`;

/** Things a static, single-user app cannot really do (the agents would fake them and the build would look broken). */
export const NEEDS_SERVER = /sign[- ]?(up|in)|log ?in|accounts?\b|payments?|checkout|e-?mail|notifications?|push alerts?|backend|server|shared (with|between)|multi-?user|real-?time chat|sms\b|text messages?/i;

/** The model's idea, or null: a valid job in the requested bucket, a title and a prompt, nothing that needs a server. */
export function parseIdea(text: string, size: IdeaSize): Idea | null {
  const job = parseJob(text);
  if (!job) return null;
  const { lo, hi } = IDEA_SIZES[size];
  if (job.tasks < lo || job.tasks > hi) return null;
  job.kind = 'build';   // ideas are new apps (curated ideas too)
  let j: any; try { j = JSON.parse(String(text).match(/\{[\s\S]*\}/)![0]); } catch { return null; }
  const title = String(j.title || '').replace(/\s+/g, ' ').trim().slice(0, 40), prompt = String(j.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  if (NEEDS_SERVER.test(prompt) || NEEDS_SERVER.test(title)) return null;
  return title.length >= 3 && prompt.length >= 20 ? { title, prompt, job } : null;
}
