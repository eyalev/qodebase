// Talk to qodebase: one sentence (spoken or typed) -> what the app does, decided
// by a System One model (clef-flash, Jev-compatible) in ONE call. The model never
// writes text: every answer is a pick from lists built here from the page the
// person is looking at (its links, buttons, fields, headings), their projects,
// and phrases cut out of the sentence itself (spans()). Same rules as talkui
// (an earlier talk-to-UI prototype): vocabulary in code, the model picks.
//
// Also used by scripts/talk-eval.mjs (node --experimental-strip-types), so this
// file only uses erasable TypeScript and imports nothing.

export type Item = { id: string; kind: 'link' | 'button' | 'field' | 'heading'; text: string; href?: string };
export type Proj = { id: string; slug: string; name: string; owner: string; description?: string; mine?: boolean; updatedAt?: number };
export type Screen = { path: string; title: string; items: Item[]; projects: Proj[]; me?: string | null; last?: string | null };

/** The project a /p/<owner>/<name>/… page shows, if any. */
export const currentSlug = (path: string) => { const m = /^\/p\/([^/]+)\/([^/]+)/.exec(path || ''); return m ? `${m[1]}.${m[2]}` : null; };

// Mode first: is this something to DO, something to ANSWER, or both?
const MODES = {
  act: 'A request to do something in the app: go to a page, open a project or one of its parts, search, type, press something, go back, scroll. No answer needed beyond doing it.',
  ask: 'A question or conversation for the assistant to answer in words: what is this, how does it work, why, should I, explain, tell me about, chit-chat.',
  both: 'Both: do something in the app AND answer or explain something ("open the calculator and tell me what it does", "show me the agents, which one is stuck?").',
  none: 'Not a request at all: a fragment cut off mid-sentence, noise, or filler words.',
};

const ACTIONS = {
  link: 'Go to a page or open something listed on the screen or in the menu: the home page, Explore, Yours, Inbox, Build, Account, Import, Command line, About, Feedback, Get your own qodebase, Your own AI assistant, a document or file shown on the page (README, LICENSE), or any other link shown',
  project: 'Open a project by its name, or one part of it (its app, code, readme, history, agents), just to look at it or use it. A sentence that also says what the project should do differently is a change, not this.',
  search: 'Search or look for something by words: find a project, find text in the code',
  type: 'Type words into a field on the page (an idea to build, a search box, a message to an agent), or set a slider or a choice to a value ("set the agents to 6", "use Sonnet")',
  press: 'Press a button, tab, switch or toggle that is on the screen: a preset, a size, a tab, Next, Pause, Build it, open more, or turn a setting on or off',
  back: 'Go back to the previous page (only when they say back or previous; "go home" is the home page link)',
  scroll: 'Scroll to or show a section of this page (by its heading), or scroll to the top or bottom',
  explain: 'Explain, describe or show around the page the person is looking at',
  change: 'Ask for a change in one of the projects: add, fix, change, improve or remove a feature in an app or its code ("in my todo app add due dates", "make the timer chime louder", "fix the dark mode"). Not a setting, switch or slider on this qodebase page.',
  list: 'List or name their projects ("list my projects", "what projects do I have", "show me some of my projects")',
  code: 'Answer a question about a project\'s CODE that needs reading it: how something works or is stored, where something is, why it is built a certain way, or a plan for how to change it ("how are tasks stored in my todo app", "why does the timer use a worker", "plan how to add accounts")',
  status: 'Say what is going on across their projects: what their agents are doing, builds and scale runs going, questions the agents asked them, what is ready to merge or review, what changed today or this week, what needs them',
  none: 'No action in the app',
};

const PARTS = {
  page: 'The project page itself (its main page)',
  app: 'Its live app, running (try it, use it, play it, run it)',
  code: 'Its code, files, source',
  readme: 'Its readme, its description document',
  history: 'Its history, commits, changes',
  agents: 'Its agents, the AI agents working on it',
};

// Words after which a search query or typed text usually starts.
const MARKERS = new Set(['for', 'find', 'search', 'called', 'named', 'type', 'write', 'saying', 'say', 'build', 'make', 'create',
  'about', 'with', 'containing', 'contains', 'that', 'idea', 'is', 'to', 'mentions']);

/** Every phrase of the sentence that could be a query or typed text. */
export function spans(utterance: string): string[] {
  const quoted = [...utterance.matchAll(/["“]([^"”]{1,120})["”]/g)].map((m) => m[1].trim());
  const words = utterance.trim().replace(/[.?!]+$/, '').split(/\s+/).filter(Boolean);
  const lw = words.map((w) => w.toLowerCase().replace(/[^a-z0-9']/g, ''));
  const starts = new Set<number>(), ends = new Set<number>([words.length]);
  lw.forEach((w, i) => {
    if (MARKERS.has(w) && i + 1 < words.length) starts.add(i + 1);
    if (w === 'and' || w === 'please' || w === 'then') ends.add(i);
    if (/[,;]$/.test(words[i])) ends.add(i + 1);
  });
  const out = [...quoted];
  for (const s of [...starts].sort((a, b) => a - b)) {
    for (const e of [...ends].sort((a, b) => a - b)) {
      if (e <= s || e - s > 16) continue;
      const phrase = words.slice(s, e).join(' ').replace(/[,;"“”]+$/g, '').replace(/^["“]/, '').trim();
      if (phrase && !/^(the|a|an|to|it|this|that|and|me|my)$/i.test(phrase)) out.push(phrase);
    }
  }
  return [...new Set(out)].slice(0, 24);
}

/** Edit distance, for one-letter slips in spoken project names. */
function lev(a: string, b: string): number {
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

const STOP = new Set(['the', 'a', 'an', 'my', 'me', 'open', 'show', 'go', 'to', 'app', 'project', 'please', 'and', 'of', 'in', 'on', 'for', 'it', 'one', 'that', 'this', 'i', 'can', 'you', 'what', 'is']);
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));

/** The projects worth offering: theirs first, then any whose name or description shares a word with the sentence. */
export function candidateProjects(utterance: string, projects: Proj[], max = 24, current: string | null = null): Proj[] {
  const u = new Set(words(utterance));
  // Spoken names: "todo" for to-do, "tip split" for tipsplit, one letter off ("calculater").
  const joined = utterance.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const near = (a: string, b: string) => a.length >= 4 && b.length >= 4 && Math.abs(a.length - b.length) <= 1 && lev(a, b) <= (a.length >= 7 ? 2 : 1);
  const score = (p: Proj) => {
    const n = words(p.name.replace(/[-_.]/g, ' ')), d = words(p.description || '');
    let s = 0;
    const flat = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (flat.length >= 3 && joined.includes(flat)) s += 4;
    for (const w of n) if (u.has(w) || [...u].some((x) => (x.length > 3 && (w.startsWith(x) || x.startsWith(w))) || near(x, w))) s += 3;
    for (const w of d) if (u.has(w)) s += 1;
    return s + (p.mine ? 0.5 : 0);
  };
  const ranked = projects.map((p) => ({ p, s: score(p) })).sort((a, b) => b.s - a.s);
  const hits = ranked.filter((x) => x.s >= 1).map((x) => x.p);
  const mine = projects.filter((p) => p.mine);
  const here = projects.filter((p) => p.slug === current);
  return [...new Set([...here, ...hits, ...mine])].slice(0, max);
}

const choice = (instructions: string, criteria: Record<string, string>) => ({ type: 'choice', instructions, criteria });
const noul = (instructions: string) => ({ type: 'noul', instructions });

/** The state string the model reads. */
export function stateText(utterance: string, s: Screen, projects: Proj[]): string {
  const lines = [`Sentence: "${utterance}"`, '', `The person is on qodebase (a git platform where every project runs as an app and has AI agents), page ${s.path} titled "${s.title}".`];
  if (s.me) lines.push(`They are signed in as ${s.me}.`);
  const by = (k: Item['kind']) => s.items.filter((i) => i.kind === k);
  if (by('heading').length) lines.push('', 'Headings on the page: ' + by('heading').map((h) => `"${h.text}"`).join(', '));
  if (by('link').length) lines.push('', 'Links (page and menu):', ...by('link').map((l) => `- ${l.id}: ${l.text}`));
  if (by('button').length) lines.push('', 'Buttons: ' + by('button').map((b) => `${b.id} "${b.text}"`).join(', '));
  if (by('field').length) lines.push('', 'Fields: ' + by('field').map((f) => `${f.id} "${f.text}"`).join(', '));
  const cur = currentSlug(s.path);
  if (projects.length) lines.push('', 'Projects:', ...projects.map((p) => `- ${p.id}: ${p.owner}/${p.name}${p.slug === cur ? ' (the project this page shows)' : ''}${p.mine ? ' (theirs)' : ''}${p.description ? ' — ' + p.description.slice(0, 90) : ''}`));
  if (cur) lines.push('', `This page shows the project ${cur.replace('.', '/')}: "this", "it", "its", "the app" or "the code" without a project name mean that project.`);
  if (s.last) lines.push('', `The last thing opened was ${s.last}; "it", "that" or "this one" means it.`);
  return lines.join('\n');
}

export function buildQuestions(utterance: string, s: Screen, projects: Proj[]) {
  const cands = spans(utterance);
  const by = (k: Item['kind']) => s.items.filter((i) => i.kind === k);
  const none = { none: 'None of these' };
  const q: Record<string, unknown> = {
    mode: choice('Is the sentence a request to do something in the app, a question or conversation to answer, both, or not a request?', MODES),
    action: choice('If it asks to do something in the app, what kind of thing?', ACTIONS),
    complete: noul('The sentence is a finished request or question, not cut off in the middle.'),
    greeting: noul('The sentence is a greeting, thanks, goodbye or small talk to the assistant ("hi", "hello there", "thanks", "how are you", "good morning"), not a request.'),
    wants_change: noul('The sentence asks for something in an app or project to be different: a feature added, fixed, changed, improved or removed (not just opening or looking at it).'),
    risky: noul('Doing what the sentence asks would delete a project or an account, merge, publish, make something public or private, sign out, revoke, uninstall, disconnect, spend money, start a build or a run, or pause, resume or stop one. Asking the agents to change, add or remove something inside an app is NOT risky (it only proposes a change).'),
    destroys: noul('Doing what the sentence asks would delete or remove something for good, sign out, revoke access, uninstall, disconnect an account, or make a project public or private. Starting, pausing, resuming or stopping a run, merging, building something, or asking the agents to change, add or remove something inside an app does NOT count.'),
  };
  q.on_page = noul('The sentence asks to use something on this very page: one of its buttons, tabs, switches, sliders or fields, a slide, a moment on a timeline, or a run or list shown here. Not opening a project, and not a change to an app.');
  if (by('link').length) q.link = choice('Which link does it want to open? Pick the link whose words match what the sentence asks for.', { ...Object.fromEntries(by('link').map((l) => [l.id, l.text])), ...none });
  if (projects.length) {
    q.project = choice('Which project does the sentence name or mean? Match by name or what it is (a "timer" is the Focus timer project). With no project name ("the app", "its history", "this"), it is the project the page shows. "My copy", "my version" or "mine" means their own project of the same name. Prefer their own project when they say "my" or names tie.',
      { ...Object.fromEntries(projects.map((p) => [p.id, `${p.owner}/${p.name}${p.mine ? ' (theirs)' : ''}${p.description ? ': ' + p.description.slice(0, 80) : ''}`])), ...none });
    q.part = choice('Which part of the project does it want?', PARTS);
    q.depth = choice('If it is a question about a project\'s code, how deep is it?', { fact: 'A quick fact: where something is, what it uses, how something is stored', explain: 'An explanation of how something works', plan: 'A plan, a design question, or why it was built this way' });
    q.names_part = noul('The sentence names or implies one part of a project: its app (try, play, use, run it), code, files, readme, license, history or agents.');
  }
  if (by('button').length) q.button = choice('Which button does it want to press?', { ...Object.fromEntries(by('button').map((b) => [b.id, b.text])), ...none });
  if (by('field').length) q.field = choice('Which field does it want to type into?', { ...Object.fromEntries(by('field').map((f) => [f.id, f.text])), ...none });
  if (by('heading').length) q.section = choice('Which section of the page does it want to see?', { ...Object.fromEntries(by('heading').map((h) => [h.id, h.text])), top: 'The top of the page', bottom: 'The bottom of the page', ...none });
  if (cands.length) q.text = choice('What exact words should be searched for or typed?', { ...Object.fromEntries(cands.map((c, i) => [`s${i}`, `"${c}"`])), ...none });
  return { questions: q, cands };
}

/** The part to open: only one the sentence names, else the project page. */
const partOf = (answers: Record<string, Ans>) => ((answers.names_part?.noul ?? 1) >= 0.5 ? top(answers.part).choice : 'page');

type Ans = { choice?: string; probabilities?: Record<string, number>; confidence?: number; noul?: number };
const top = (a?: Ans) => (a?.choice ? { choice: a.choice, p: a.probabilities?.[a.choice] ?? a.confidence ?? null } : { choice: 'none', p: null });
const pick = (a: Ans | undefined, min = 0) => { const t = top(a); return t.choice !== 'none' && (t.p ?? 1) >= min ? t.choice : null; };

export type Cmd = {
  mode: string; modeP: number | null; op: string; p: number | null; risky: number | null; complete: number | null;
  destroys?: number | null;        // the part of risky that Talk never does (delete, sign out, revoke…)
  href?: string; label?: string; target?: string; text?: string; section?: string; why?: string;
  slug?: string; mine?: boolean;   // change / code: the project, and whether it is theirs
  greet?: boolean; example?: string;   // a greeting / small talk, and one of their projects to suggest
  depth?: string;                  // code: fact | explain | plan (haiku | sonnet | opus in the ask box)
  then?: string;                   // go: say this again on the page it opens (an action that lives there)
  updatedAt?: number;              // latest: when the project last changed
  name?: string;                   // build: the project's name said in the sentence ('called Home Ledger')
  preset?: string;                 // type into the idea box: the Build preset to pick too (Fastest | Balanced | Cheapest)
};

/** Answers -> one command the page carries out (or hands to the chat lane). */
// Sentences that need no model at all (manager, 2026-10-13, latency: the decide call was 1.5-2.8 s of a spoken turn):
// fixed phrases only, the same answers resolve() gives them. The page mirrors STATUS_RX to skip the round trip too.
export const STATUS_RX = /^\s*((ok(ay)?|so|hey|hi|and)[,\s]+)?(what'?s|what is|whats)\s+(going on|happening)(\s+(with|in|across)\s+(all\s+)?(my|the)\s+(projects?|builds?|work|apps?))?(\s+(today|right now|now|at the moment))?\s*[?.!]*\s*$|^\s*(status|status update|any updates?|give me (a|the) status( update)?)\s*[?.!]*\s*$/i;
export function quickCmd(utterance: string, s: Screen, projects: Proj[]): Cmd | null {
  const u = utterance.trim();
  if (!u) return null;
  const base: Cmd = { mode: 'act', modeP: 1, op: 'none', p: 0.95, risky: 0, destroys: 0, complete: 1 };
  // A fleet sentence on /runs: the page's own fleet-job action at once (the model took 2.5 s of a filmed turn).
  const fj = s.items.find((i) => i.id === 'xfleet-job');
  if (fj && /^\/runs/.test(s.path) && (/\b(document|comment) (every|all|each)\b.*\b(function|class|file|export)/i.test(u) || /\b(fleet job|doc comments|api index)\b/i.test(u))) return { ...base, op: 'press', target: fj.id, label: fj.text, why: 'fleet words on /runs (no model)' };
  if (u.split(/\s+/).length > 12) return null;
  if (STATUS_RX.test(u)) return { ...base, mode: 'ask', op: 'status', why: 'status words (no model)' };
  // 'Use the cheapest team.' / 'pick the balanced preset' / 'go with fastest': the preset tile, no model (qb3's take:
  // p 0.43 gave only 'Maybe…?').
  const pm = /^\s*(please\s+)?(use|pick|choose|select|go with|switch to|take|i want|let'?s (use|go with))\s+(the\s+)?(?<preset>cheapest|fastest|balanced)(\s+(one|team|preset|option|setting|settings|plan))?\s*[.!]*\s*$/i.exec(u);
  if (pm) {
    const pn = pm.groups!.preset, name = pn.charAt(0).toUpperCase() + pn.slice(1).toLowerCase();
    const tile = s.items.find((i) => i.kind === 'button' && new RegExp('^' + name + '\\b').test(i.text));
    if (tile) return { ...base, op: 'press', target: tile.id, label: tile.text, why: 'a preset by name (no model)' };
  }
  if (/^\s*(please\s+)?((take me|go|bring me|get me) to|open|show( me)?)\s+(my\s+|the\s+)?(settings|account( settings)?|preferences|profile)( page)?\s*[.!]*\s*$/i.test(u)) return { ...base, op: 'go', href: '/settings', label: 'Settings', why: 'settings words (no model)' };
  if (/\bimport\b.{0,40}\b(from\s+)?github\b|^\s*(take me to|go to|open)\s+(the\s+)?import( page)?\s*[.!]*\s*$/i.test(u) && !/\b(how|what|why)\b/i.test(u)) return { ...base, op: 'go', href: '/import', label: 'Import from GitHub', why: 'import words (no model)' };
  // The turns Eyal says most (traces, 2026-10-13): counts, greetings, ideas, how-it-works questions. Same answers resolve() gives.
  if (/^\s*how many (of my )?(projects|apps)( do i have| have i got)?( now| so far)?\s*[?.!]*\s*$/i.test(u)) {
    const mine = projects.filter((p) => p.mine).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map((p) => p.name.replace(/-/g, ' '));
    return { ...base, mode: 'ask', op: 'list', text: mine.slice(0, 6).join(', '), href: '/mine', label: 'your projects', target: String(mine.length), why: 'count words (no model)' };
  }
  if (/^\s*(hi|hello|hey|hiya|good (morning|afternoon|evening))( there)?(,?\s*(my )?(friend|qodebase|talk))?\s*[.!?]*\s*$/i.test(u)) {
    const own = projects.filter((p) => p.mine && !isScaffold(p.name)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    return { ...base, mode: 'none', op: 'none', greet: true, example: own ? own.name.replace(/-/g, ' ') : undefined, why: 'greeting (no model)' } as Cmd;
  }
  const sz = /^\s*(please\s+)?(give me|show me|suggest|get me|i want|i need)\s+(an?|another|one)\s+(small|tiny|quick|medium|large|big|huge)?\s*(app\s+)?idea(\s+for\s+(a|an|my)\s+(new\s+)?(app|project|thing))?\s*[.!?]*\s*$/i.exec(u);
  if (sz) {
    const size = /small|tiny|quick/i.test(sz[4] || '') ? 'Small' : /huge/i.test(sz[4] || '') ? 'Huge' : /large|big/i.test(sz[4] || '') ? 'Large' : 'Medium';
    const btn = s.items.find((i) => i.kind === 'button' && new RegExp('^' + size + '\\b').test(i.text));
    if (btn) return { ...base, op: 'idea', target: btn.id, label: btn.text, text: size, why: 'idea words (no model)' };
    return { ...base, op: 'go', href: '/', label: 'home', then: u, why: 'ideas live on home (no model)' };
  }
  if (/^\s*(how does (a |the )?(build|qodebase|code ?base|this|it|talk) work|what (can|does) (qodebase|code ?base|cold ?base|codebase|this( site| app)?|talk) do( for me)?|what is (qodebase|code ?base|cold ?base)|explain qodebase)\s*[?.!]*\s*$/i.test(u))
    return { ...base, mode: 'ask', op: 'none', why: 'a question about qodebase (no model)' };
  const home = s.items.find((i) => i.kind === 'link' && i.href === '/');
  if (home && /^\s*((please\s+)?(go|take me|bring me|get me)\s+(back\s+)?home|(open\s+|go to\s+)?(the\s+)?home ?page|home)\s*[.!]*\s*$/i.test(u)) return { ...base, op: 'go', href: '/', label: home.text, target: home.id, why: 'home words (no model)' };
  if (/^\s*((please\s+)?(take me to|go to|open|show( me)?|bring me to|back to)\s+(all\s+)?(my|your) projects|(my|your) projects)\s*[.!]*\s*$/i.test(u)) return { ...base, op: 'go', href: '/mine', label: 'your projects', why: 'my projects = /mine (no model)' };
  if (/^\s*(what|which)('s| is| was)?\s+(is\s+)?my\s+(latest|newest|last|most recent)\s+(project|app|build)\s*[?.!]*\s*$/i.test(u)) {
    const p = projects.filter((x) => x.mine && !HARNESS_RX.test(x.name)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    if (p) return { ...base, mode: 'ask', op: 'latest', href: projectHref(p, 'page'), label: projLabel(p, 'page'), target: p.slug, text: p.description || '', updatedAt: p.updatedAt, why: 'latest project (no model)' } as Cmd;
  }
  return null;
}
const INTENT_RX = /\bwhy (does|do|is|are|did) .+? (exist|exists|there|here|happen)\b|\bwhat('s| is| are) .+? waiting (on|for)\b|\b(blocked|stuck) on\b|\bwhy (does|do|is|are) .+? (needed|asked for)\b/i;
export function resolve(answers: Record<string, Ans>, cands: string[], s: Screen, projects: Proj[], utterance: string): Cmd {
  const cmd = resolveAction(answers, cands, s, projects, utterance);
  // A question a page action answers ("what is the packing list waiting on" → qb5's intent finder, "what happened at
  // 1:20" → a run's moment): the page's own action, even when the model heard a question. Only actions the page
  // registered (x… ids), only when the model is sure it is this page's thing.
  const tbx = top(answers.button);
  // The intent tree's own question words, when its finder is on the page (registered only while the tree is open): never
  // the code reader. Live 2026-10-14 (qb7's e2e): "why does photo upload exist" went to the code lane at p 0.24.
  const finder = s.items.find((i) => /^x/.test(i.id) && /^Find an intent\b/.test(i.text));
  if (finder && INTENT_RX.test(utterance)) return { ...cmd, mode: 'act', op: 'press', target: finder.id, label: finder.text, p: 0.9, why: 'intent words on the intent tree (no model)' };
  // Already pressing that very action, but sure of it only by the action's own pick ("…with 1,000 agents" on /runs:
  // press xfleet-job at p 0.29 → only a "Maybe…?"): the action's confidence is the command's.
  if (cmd.op === 'press' && /^x/.test(String(cmd.target || '')) && cmd.target === tbx.choice && (tbx.p ?? 0) >= 0.85 && (cmd.p ?? 0) < (tbx.p ?? 0)) cmd.p = tbx.p;
  // (A very sure pick needs no "this page" yes: live, the intent finder was 0.93 with on_page 0.22.)
  if (/^x/.test(tbx.choice) && ((tbx.p ?? 0) >= 0.85 || ((tbx.p ?? 0) >= 0.6 && (answers.on_page?.noul ?? 0) >= 0.5)) && cmd.op !== 'press' && !['change', 'code', 'list'].includes(cmd.op)) {
    const it = s.items.find((i) => i.id === tbx.choice);
    if (it) return { ...cmd, mode: 'act', op: 'press', target: it.id, label: it.text, p: tbx.p, why: `${cmd.why || ''}; the page's own action answers it` };
  }
  // "Opening" the project this page already shows is never the answer when a button here is a sure pick
  // ("show the intent tree" on its work page went to the project itself at p 0.28, live 2026-10-13).
  const curS = currentSlug(s.path), tbp = top(answers.button);
  if (cmd.op === 'go' && curS && cmd.target === curS && cmd.href === `/p/${curS.replace('.', '/')}` && (cmd.p ?? 0) < 0.5 && tbp.choice !== 'none' && (tbp.p ?? 0) >= 0.6) {
    const it = s.items.find((i) => i.id === tbp.choice);
    if (it) return { ...cmd, mode: 'act', op: 'press', target: it.id, label: it.text, p: tbp.p, why: `${cmd.why || ''}; a button here, not the page itself` };
  }
  // A sentence that names the button it presses ("show the timeline tab" → Timeline) is sure enough to act, not to ask
  // "Maybe…?" (live, 2026-10-13: p 0.39). Vocabulary from the page itself.
  if ((cmd.op === 'press' || cmd.op === 'go') && (cmd.p ?? 0) < 0.45 && cmd.label) {   // links too ('show me its history' → History, p 0.40: qb7's e2e)
    const stem = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean).map((w) => w.replace(/(es|s)$/, '')).join(' ');
    const bare = stem(cmd.label.replace(/\s*\(.*\)$/, '')), part = stem((/\(([^)]*)\)$/.exec(cmd.label) || [, ''])[1]);
    const said = ` ${stem(utterance)} `;
    // the name, or the part named in brackets ('forq/calculator (history)' for 'show me its history': qb7's e2e, p 0.444)
    if ((bare.length >= 4 && said.includes(` ${bare} `)) || (part.length >= 4 && !/\d/.test(part) && said.includes(` ${part} `))) cmd.p = Math.max(cmd.p ?? 0, 0.6);
  }
  // Greetings and small talk get a friendly reply with examples, never "say it again" (Eyal's phone, 2026-10-07:
  // "hi there" and "hello" got "Sounds cut off"). Fixed words in code; the model's yes/no for the rest.
  const hello = /^\s*(hi|hello|hey|hiya|yo|howdy|good (morning|afternoon|evening|night)|thanks|thank you|cheers|how are you|what'?s up|bye|goodbye)\b/i.test(utterance) || (answers.greeting?.noul ?? 0) >= 0.6;
  if (hello && cmd.op === 'none') {
    const own = projects.filter((p) => p.mine && !isScaffold(p.name)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];   // the one they touched last, not a harness's
    return { ...cmd, mode: 'none', greet: true, example: own ? own.name.replace(/-/g, ' ') : undefined };
  }
  // "Go home" / "home page" is a fixed phrase: vocabulary in code, not the model (talkui's rule).
  const home = s.items.find((i) => i.kind === 'link' && i.href === '/');
  if (home && cmd.mode !== 'ask' && /\b(go|take me|back to the|bring me) home\b|\bhome ?page\b|^home$/i.test(utterance.trim())) return { ...cmd, mode: cmd.mode === 'none' ? 'act' : cmd.mode, op: 'go', href: '/', label: home.text, target: home.id };
  // "Build me a home inventory app with a team, …" on a page with the idea box (home): the idea goes in the box, the
  // team words pick the preset, and Build it is offered (qb3's shot 2a). Vocabulary in code.
  const ideaBox = s.items.find((i) => i.kind === 'field' && /what do you want to build/i.test(i.text));
  // Something new ("build me a…", "make an…"), not a change to an existing thing ("make the timer chime louder").
  const bm = /^\s*(please\s+)?(build|make|create)\s+(me\s+|us\s+)?((?:a|an|some|my own)\s+.{4,})$/i.exec(utterance.trim());
  if (ideaBox && bm && cmd.mode !== 'ask') {
    // The preset words choose the settings and come out of the idea (qb3's rehearsal: 'with the cheapest team' stayed
    // in the idea and named the project home-inventory-cheapest). Cheapest/Fastest words win over 'team'.
    const preset = /\bcheap(est|ly|er)?\b/i.test(utterance) ? 'Cheapest'
      : /\b(one|a single|single) agent\b|\bon its own\b|\bfast(est)?\b|\bquick(est|ly)?\b/i.test(utterance) ? 'Fastest'
      : /\bteam\b|\bseveral agents\b|\bmany agents\b|\bbalanced\b/i.test(utterance) ? 'Balanced' : '';
    const SETTINGS_RX = /,?\s*\b(with|using|on|as|by|in)\s+(a|an|the|one|my)?\s*(cheapest|cheap|cheaper|fastest|fast|quickest|quick|balanced|small|big|whole|single|best)?\s*(team|agents?|preset|settings?|way|mode)( of agents)?\b|,?\s*\b(cheaply|quickly|the cheapest way|the fast way|on its own)\b/gi;
    // '… called Home Ledger' / 'named house helper': the project's name, not part of the idea (qb3's redo: the name became
    // 'called-home-ledger').
    const named = /,?\s*\b(called|named)\s+["\u201c]?([\p{L}\p{N}][\p{L}\p{N} '-]{1,38}?)["\u201d]?(?=\s*(,|\.|$|\bwith\b|\band\b|\bthat\b|\bwhich\b|\bfor\b))/iu.exec(bm[4]);
    const projName = named ? named[2].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : '';
    const idea = (named ? bm[4].replace(named[0], '') : bm[4]).replace(SETTINGS_RX, '').replace(/\s+(and|,)\s*(and\s+)?(?=[,.]|$)/gi, '').replace(/\s{2,}/g, ' ').replace(/\s+,/g, ',').replace(/^[\s,]+|[\s,.]+$/g, '');
    return { ...cmd, mode: 'act', op: 'type', target: ideaBox.id, label: ideaBox.text, text: idea.charAt(0).toUpperCase() + idea.slice(1), preset: preset || undefined, name: projName || undefined, p: 0.9, why: 'build words on the idea box' } as Cmd;
  }
  // The 1,000-agent job (qb3's shot 3a) said without the words 'fleet job'.
  const docJob = /\b(document|comment) (every|all|each)\b.*\b(function|class|file|export)/i.test(utterance) || /\bapi index\b/i.test(utterance);
  // On /runs, a fleet job sentence is that page's own fleet-job action (the model picked it at only 0.67 for
  // "…with 1,000 agents"). Vocabulary in code.
  const fleetWords = docJob || /\b(fleet job|start a fleet|run a fleet|doc comments)\b/i.test(utterance);
  const fj = s.items.find((i) => i.id === 'xfleet-job');
  if (/^\/runs/.test(s.path) && fj && fleetWords && cmd.mode !== 'ask') return { ...cmd, mode: 'act', op: 'press', target: fj.id, label: fj.text, p: 0.9, why: 'fleet words on /runs' };
  // A fleet job (qb7's /runs action, owner only) asked for from another page: open /runs, then say it again there.
  if (!/^\/runs/.test(s.path) && (docJob || /\b(fleet job|start a fleet|run a fleet|document (the )?(api|code|comments)|doc comments)\b/i.test(utterance)) && cmd.mode !== 'ask')
    return { ...cmd, mode: 'act', op: 'go', href: '/runs', label: 'Runs', p: 0.9, then: utterance, why: 'fleet jobs start on /runs' };
  // "Take me to my projects", "show my projects", "open yours": the Yours page (Eyal's phone, 2026-10-13: no confident
  // pick, and the chat lane made up /p/forq, a page that does not exist). Vocabulary in code.
  if (cmd.mode !== 'ask' && /\b(take me to|go to|open|show( me)?|bring me to|back to)\s+(all\s+)?(my|your) projects\b|^\s*(my|your) projects\s*[.!?]?$/i.test(utterance.trim()))
    return { ...cmd, mode: 'act', op: 'go', href: '/mine', label: 'your projects', p: 0.9, why: 'my projects = /mine' };
  // "Give me an idea for a new app" (Eyal, 2026-10-13: it typed "a new app" into the build box and offered Build it):
  // the page's own idea generator ("Need an idea?" sizes), Medium unless a size is said; elsewhere, go home and ask there.
  const wantsIdea = (/\bideas?\b/i.test(utterance) && /\b(give|suggest|get|need|want|have|any|come up|think of|tell|show|surprise)\b/i.test(utterance))
    || /\b(suggest|recommend|give me|think of)\b.*\b(something|an app|a project|a thing|what)\b.*\bto (build|make)\b/i.test(utterance);
  if (wantsIdea && !/\b(my|this|the) idea (is|was)\b|\bsettings\b|\bfrom my idea\b/i.test(utterance)) {
    const size = (/\b(small|tiny|quick|little)\b/i.exec(utterance) ? 'Small' : /\b(huge|giant|massive|ambitious)\b/i.test(utterance) ? 'Huge' : /\b(large|big|bigger)\b/i.test(utterance) ? 'Large' : 'Medium');
    const btn = s.items.find((i) => i.kind === 'button' && new RegExp('^' + size + '\\b').test(i.text));
    if (btn) return { ...cmd, mode: 'act', op: 'idea', target: btn.id, label: btn.text, text: size, p: 0.9, why: 'the idea generator' };
    return { ...cmd, mode: 'act', op: 'go', href: '/', label: 'home', p: 0.9, then: utterance, why: 'ideas live on home' };
  }
  // "What is my latest project?": answer it (name, what it is, when), offer to open it; never navigate unasked.
  if (/\b(what|which)('s| is| was| are)?\s+(is\s+)?my\s+(latest|newest|last|most recent)\s+(project|app|build)\b|\bwhich project did i (work on|change|touch) last\b/i.test(utterance)) {
    const p = projects.filter((x) => x.mine && !HARNESS_RX.test(x.name)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    if (p) return { ...cmd, mode: 'ask', op: 'latest', href: projectHref(p, 'page'), label: projLabel(p, 'page'), target: p.slug, text: p.description || '', updatedAt: p.updatedAt, p: 0.9, why: 'latest project' } as Cmd;
  }
  // A request for content ("give me…", "suggest…", "tell me…", "what is…", "explain…") picked as typing into or pressing
  // something on the page goes to the answering model (with tools) instead (Eyal, 2026-10-13). Not the page's own
  // actions (x…: a timeline moment, an intent), which answer questions themselves.
  if ((cmd.op === 'type' || cmd.op === 'press') && !/^x/.test(String(cmd.target || '')) && /^\s*(please\s+)?(give me|suggest|tell me|what('s| is| are| was)|explain|describe|recommend|can you (tell|suggest|give|recommend)|any (ideas|suggestions))\b/i.test(utterance) && !/\b(type|write|enter|fill|press|tap|click|put)\b/i.test(utterance))
    return { ...cmd, mode: 'ask', op: 'none', why: `${cmd.why || ''}; a request for content goes to the answering model` };
  // Everything by voice for the video (manager + qb3, 2026-10-14). The page's own tabs by name ('show me the app' went
  // to a similarly named project's app): App, Code, Changes, Agents at work, More, All asks.
  const tabm = /^\s*(please\s+)?(show( me)?|open|go to|take me to|switch to)\s+(the\s+)?(app|code|changes|asks|agents at work|more)( tab| page)?\s*[.!]*\s*$/i.exec(utterance);
  if (tabm) {
    const want = tabm[5].toLowerCase();
    const tab = s.items.find((i) => i.kind === 'link' && (i.text.toLowerCase() === want || (want === 'asks' && /^all asks$/i.test(i.text))) && /^\/p\//.test(i.href || ''));
    if (tab) return { ...cmd, mode: 'act', op: 'go', href: tab.href, label: tab.text, target: tab.id, p: 0.9, why: 'the page\'s own tab by name (word rule)' };
  }
  // The work page's views from anywhere in a project (qb3's take: 'show the timeline' on a change record answered with a
  // status list, 'open the dark mode change' on the App page offered to send it as a request).
  const proj = /^\/p\/([^/]+)\/([^/#?]+)/.exec(s.path || '');
  if (proj) {
    const work = `/p/${proj[1]}/${proj[2]}/work`;
    const view = /^\s*(please\s+)?(show( me)?|open|go to|take me to|switch to)\s+(the\s+)?(timeline|agents|collisions|intent tree|intents|changes list)( tab| view)?\s*[.!]*\s*$/i.exec(utterance);
    if (view) {
      const want = view[5].toLowerCase(), word = want === 'agents' ? 'Agents' : want === 'timeline' ? 'Timeline' : want === 'collisions' ? 'collided' : /intent/.test(want) ? 'Intents' : '';
      const btn = word && s.items.find((i) => i.kind === 'button' && new RegExp('^' + word + '\\b', 'i').test(i.text));
      if (btn) return { ...cmd, mode: 'act', op: 'press', target: btn.id, label: btn.text, p: 0.9, why: 'a view of the work page (word rule)' };
      const hash = want === 'timeline' ? '#/timeline' : /intent/.test(want) ? '#/intents' : '#/';
      return { ...cmd, mode: 'act', op: 'go', href: work + hash, label: `${proj[2]}: ${view[5]}`, p: 0.9, then: want === 'collisions' ? utterance : undefined, why: 'a view of the work page (word rule)' };
    }
    if (/\b(open|show( me)?)\b.*\bchange\b/i.test(utterance) && !s.items.some((i) => i.kind === 'link' && /#\/change\//.test(i.href || '')) && !/^\/p\/[^/]+\/[^/]+\/work/.test(s.path))
      return { ...cmd, mode: 'act', op: 'go', href: work, label: `${proj[2]}: Agents at work`, then: utterance, p: 0.9, why: 'changes are listed on the work page (word rule)' };
  }
  // 'open the dark mode change' on the work page: the change links (#/change/…) by their words; 'that change (record)'
  // with no words of its own = the newest one listed. Never another project with a similar name.
  if (/\b(open|show( me)?|go to)\b.*\bchanges?\b/i.test(utterance) && !/\ball (the )?changes\b/i.test(utterance)) {
    const changes = s.items.filter((i) => i.kind === 'link' && /#\/change\//.test(i.href || ''));
    if (changes.length) {
      const SYN: Record<string, string> = { mode: 'theme', theme: 'mode', colour: 'color', color: 'colour', night: 'dark' };
      const STOP = /^(open|show|me|the|that|this|a|an|change|changes|record|please|go|to|of|for|its|it|on|in|new)$/;
      const words = utterance.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter((w) => w && !STOP.test(w));
      const score = (t: string) => { const tw = t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/); return words.filter((w) => tw.includes(w) || (SYN[w] && tw.includes(SYN[w]))).length; };
      const best = changes.map((c) => ({ c, n: score(c.text) })).sort((x, y) => y.n - x.n)[0];
      if (best && best.n > 0) return { ...cmd, mode: 'act', op: 'go', href: best.c.href, label: best.c.text, target: best.c.id, p: 0.9, why: 'a change on this page by its words (word rule)' };
      if (!words.length) return { ...cmd, mode: 'act', op: 'go', href: changes[0].href, label: changes[0].text, target: changes[0].id, p: 0.8, why: 'the newest change listed (word rule)' };
    }
  }
  // 'call it home things 2' / 'name it …' on the brief: the Project name box (qb3's scene 2).
  const nm = /^\s*(please\s+)?(call (it|at|that|this)|cool it|cold it|name it|rename it( to)?|name the project|call the project|the name is|its name is)\s+(?<name>.{2,60}?)\s*[.!]*\s*$/i.exec(utterance);   // 'Call at homekeeper' (qb3's take)
  const nameBox = s.items.find((i) => i.kind === 'field' && /project name|^name\b/i.test(i.text));
  // A spoken number at the end of a name comes out as a homophone ('home things too' for 'home things 2', qb3's take).
  const nameText = (t: string) => t.trim().toLowerCase().replace(/\b(to|too|two)\s*$/, '2').replace(/\b(for|four)\s*$/, '4').replace(/\b(one|won)\s*$/, '1').replace(/\bthree\s*$/, '3')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (nm && nameBox) return { ...cmd, mode: 'act', op: 'type', target: nameBox.id, label: nameBox.text, text: nameText(nm.groups!.name), p: 0.9, why: 'the project name (word rule)' };
  // On a project's page a change request goes to THIS project unless another project is named by its words
  // ('switch to dark mode' on corner-cafe went to cafe-crew).
  const here = currentSlug(s.path);
  if (here && cmd.op === 'change' && cmd.slug && cmd.slug !== here) {
    const other = projects.find((p) => p.slug === cmd.slug);
    const named = other && other.name.toLowerCase().split(/[-_\s]+/).filter((w) => w.length >= 4).some((w) => utterance.toLowerCase().includes(w));
    if (!named) { const cur = projects.find((p) => p.slug === here); return { ...cmd, slug: here, label: cur ? projLabel(cur, 'changes') : cmd.label, href: cur ? projectHref(cur, 'changes') : cmd.href, why: `${cmd.why || ''}; this page's project (no other named)` }; }
  }
  // On a run's page: 'show me minute 1' / 'at 1:20' is the timeline's moment action, 'back to all runs' the run list
  // (qb7's e2e: the model scrolled to Timeline at p 0.65, and offered 'go back' at p 0.44).
  if (/^\/runs/.test(s.path)) {
    const moment = s.items.find((i) => /^x/.test(i.id) && /moment/i.test(i.text));
    if (moment && /\b(minute|min|second|sec)s?\s+\d+|\bat\s+\d{1,2}:\d{2}\b|\b\d{1,2}:\d{2}\b/i.test(utterance)) return { ...cmd, mode: 'act', op: 'press', target: moment.id, label: moment.text, p: 0.9, why: 'a moment on the timeline (word rule)' };
    const all = s.items.find((i) => i.kind === 'link' && (/^all runs\b/i.test(i.text) || i.href === '#/' || i.href === '/runs'));
    if (all && /\b(back to|show( me)?|open|go to)\s+(all\s+)?(the\s+)?runs\b|^\s*all runs\s*[.!]*\s*$/i.test(utterance)) return { ...cmd, mode: 'act', op: 'go', href: all.href, label: all.text, target: all.id, p: 0.9, why: 'the run list (word rule)' };
  }
  // On /runs, "open the last run" / "the first VS Code run": the run list is newest first (vocabulary in code).
  if (/^\/runs/.test(s.path) && /\b(open|show( me)?|go to)\b.*\b(last|latest|newest|most recent|first|top)\b.*\brun\b/i.test(utterance)) {
    const runs = s.items.filter((i) => i.kind === 'link' && /^#\/(run|step)\//.test(i.href || ''));
    const named = runs.filter((i) => utterance.toLowerCase().split(/\W+/).filter((w) => w.length > 3 && !/^(open|show|last|latest|newest|first|timeline|the)$/.test(w)).some((w) => i.text.toLowerCase().includes(w)));
    const r = named[0] || runs[0];
    if (r) return { ...cmd, mode: 'act', op: 'go', href: r.href, label: r.text, target: r.id, p: 0.9, why: 'newest run first' };
  }
  // "Open my newest project": the one they touched last, never one a harness made (vocabulary in code).
  if (/\b(open|show( me)?|take me to|go to)\s+my\s+(newest|latest|last|most recent|newest real)\s+project\b/i.test(utterance)) {
    const p = projects.filter((x) => x.mine && !HARNESS_RX.test(x.name)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    if (p) return { ...cmd, mode: 'act', op: 'go', href: projectHref(p, 'page'), label: projLabel(p, 'page'), target: p.slug, p: 0.9, why: 'newest project' };
  }
  // "Take me to my project" / "open the project" with no name, off a project page: ask which one, never guess.
  if (!currentSlug(s.path) && /^\s*(please\s+)?(take me to|go to|open|show( me)?|bring me to)\s+(my|the|a|one of my)\s+projects?\s*[.!?]?\s*$/i.test(utterance) && !/projects\s*[.!?]?\s*$/i.test(utterance))
    return { ...cmd, mode: 'act', op: 'which', p: 0.9, why: 'no project named' };
  // A bare name of a place ("the code.", "changes", "agents"): saying it means open it. Eyal's phone, 2026-10-07:
  // "show me the code" arrived clipped as "the code." and the model picked the Code link but chose mode none.
  const words = utterance.trim().replace(/[.!?,]+$/g, '').split(/\s+/).filter(Boolean);
  if (cmd.mode === 'none' && cmd.op === 'go' && cmd.href && words.length <= 3 && (cmd.p ?? 0) >= 0.3 && !hello) return { ...cmd, mode: 'act', why: `${cmd.why || ''}; a bare place name opens it` };
  if (cmd.op !== 'none' || cmd.mode === 'ask' || cmd.mode === 'none') return cmd;
  // The action kind could not be done (no field, no words, no project on this page): the most confident pick among
  // the page's own links, buttons and fields still can ("give me a medium sized idea" came out as "type" with
  // nothing to type; "turn off the build notification" as a change with no project, 2026-10-13).
  const cands2: { p: number; cmd: Cmd }[] = [];
  const tl = top(answers.link), l = s.items.find((i) => i.id === tl.choice);
  if (l?.href) cands2.push({ p: tl.p ?? 0, cmd: { ...cmd, op: 'go', href: l.href, label: l.text, target: l.id, why: `${cmd.why}; used the link` } });
  const tb = top(answers.button), b = s.items.find((i) => i.id === tb.choice);
  if (b) cands2.push({ p: tb.p ?? 0, cmd: { ...cmd, op: 'press', label: b.text, target: b.id, why: `${cmd.why}; used the button` } });
  const tf = top(answers.field), f = s.items.find((i) => i.id === tf.choice);
  const typed = (() => { const c = pick(answers.text); return c && /^s\d+$/.test(c) ? cands[Number(c.slice(1))] : null; })();
  if (f && typed) cands2.push({ p: tf.p ?? 0, cmd: { ...cmd, op: "type", label: f.text, target: f.id, text: typed, why: `${cmd.why}; used the field` } });
  const best = cands2.filter((x) => x.p >= 0.35).sort((x, y) => y.p - x.p)[0];
  return best ? best.cmd : cmd;
}

function resolveAction(answers: Record<string, Ans>, cands: string[], s: Screen, projects: Proj[], utterance: string): Cmd {
  const mode = top(answers.mode);
  let action = top(answers.action);
  // The many-way action spreads thin on "in my X app, let it do Y" (it opens X); a direct yes/no on just that is sharper (talkui's rewords rule).
  const wc = answers.wants_change?.noul ?? 0;
  const changeP = answers.action?.probabilities?.change ?? 0;
  if (action.choice !== 'change' && !['status', 'explain', 'type', 'code', 'press'].includes(action.choice) && (wc >= 0.75 || (wc >= 0.55 && changeP >= 0.15))) action = { choice: 'change', p: wc };
  // On a project page, an order that starts with a build verb is a change to this project (vocabulary in code):
  // qb8's "Build these 12 café features at once, …" on /p/eyal/cafe-crew came out as "open a page" (p 0.42), and
  // its Go tap navigated instead of sending. "Opening" the project the page already shows is never the answer
  // when the sentence asks for something different either. A build verb is never a status question: on the
  // Agents-at-work view the model ranked "status" first for the same order (live, 2026-10-08).
  const onProject = currentSlug(s.path);
  const order = /^\s*(please\s+|can you\s+|could you\s+|i want you to\s+|let'?s\s+)?(build|add|make|create|implement|fix|change|remove|delete|rename|give|put|update|improve|redesign|replace|write|refactor|start|turn|suggest|request|propose|ask the owner|tell the owner)\b/i.test(utterance);
  if (onProject && action.choice !== 'change' && ((order && wc >= 0.4 && !['explain', 'code', 'list'].includes(action.choice)) || (action.choice === 'project' && wc >= 0.5))) action = { choice: 'change', p: Math.max(wc, action.p ?? 0) };
  // "Plan how to…", "how would we…", "why does…" ask for an answer about the code, not an edit (vocabulary in code).
  if (action.choice === 'change' && /^\s*(plan|how (would|should|could|do) (we|i|you)|why\b|what would it take|should (we|i))/i.test(utterance)) action = { choice: 'code', p: action.p };
  // "Watch a run", "go to slide 5", "show me minute 3": the page's own control, even when a project's name sounds
  // close (the many-way action picked a project called reveal-js for "go to slide 5", 2026-10-13). A direct
  // yes/no on "this page" plus a confident pick among its buttons, fields and links decides.
  const onPage = answers.on_page?.noul ?? 0;
  if (onPage >= 0.5 && wc < 0.5 && ['project', 'link', 'change', 'scroll', 'none', 'search'].includes(action.choice)) {
    const tb = top(answers.button), tf = top(answers.field), tl = top(answers.link);
    const typedW = (() => { const c = pick(answers.text); return c && /^s\d+$/.test(c) ? cands[Number(c.slice(1))] : null; })();
    const opts = [
      { k: 'press', p: tb.choice !== 'none' ? tb.p ?? 0 : 0 },
      { k: 'type', p: tf.choice !== 'none' && typedW ? tf.p ?? 0 : 0 },
      { k: 'link', p: action.choice !== 'link' && tl.choice !== 'none' && !String(s.items.find((i) => i.id === tl.choice)?.href || '').startsWith('/p/') ? tl.p ?? 0 : 0 },
    ].sort((a, b) => b.p - a.p);
    if (opts[0].p >= 0.3) action = { choice: opts[0].k, p: opts[0].p };
  }
  const base: Cmd = { mode: mode.choice, modeP: mode.p, op: 'none', p: action.p, risky: answers.risky?.noul ?? null, destroys: answers.destroys?.noul ?? null, complete: answers.complete?.noul ?? null };
  const item = (id: string | null) => s.items.find((i) => i.id === id) || null;
  const text = (() => { const c = pick(answers.text); return c && /^s\d+$/.test(c) ? cands[Number(c.slice(1))] : null; })();
  switch (action.choice) {
    case 'link': {
      const l = item(pick(answers.link));
      if (l?.href) return { ...base, op: 'go', href: l.href, label: l.text, target: l.id };
      // A link the page does not show may still be a project ("open my calculator").
      const p = projects.find((x) => x.id === pick(answers.project, 0.3));
      if (p) return { ...base, op: 'go', href: projectHref(p, partOf(answers)), label: projLabel(p, partOf(answers)), target: p.slug };
      return { ...base, why: 'no link matched' };
    }
    case 'project': {
      // A weak project guess loses to a sure link on the page ("open all the asks" on Agents at work: link "All asks"
      // 0.83, project cafe-crew 0.49 with the action itself at 0.24).
      const tl = top(answers.link), tp = top(answers.project), ll = s.items.find((i) => i.id === tl.choice);
      if (ll?.href && (tl.p ?? 0) >= 0.7 && (tp.p ?? 0) < 0.6 && (action.p ?? 0) < 0.5) return { ...base, op: 'go', href: ll.href, label: ll.text, target: ll.id, why: 'a sure link over a weak project' };
      // …and to a sure button or tab here ("show the intent tree": Intents 0.83, project 0.30, action 0.21).
      const tb2 = top(answers.button), bb = s.items.find((i) => i.id === tb2.choice);
      if (bb && (tb2.p ?? 0) >= 0.7 && (tp.p ?? 0) < 0.6 && (action.p ?? 0) < 0.5) return { ...base, op: 'press', target: bb.id, label: bb.text, p: tb2.p, why: 'a sure button over a weak project' };
      const p = projects.find((x) => x.id === pick(answers.project));
      if (!p) return { ...base, why: 'no project matched' };
      return { ...base, op: 'go', href: projectHref(p, partOf(answers)), label: projLabel(p, partOf(answers)), target: p.slug };
    }
    case 'search': {
      // In a project's code: its own search box. Elsewhere: projects by name.
      const f = s.items.find((i) => i.kind === 'field' && /search|go to file/i.test(i.text));
      if (f && text) return { ...base, op: 'type', target: f.id, text, label: f.text };
      const p = projects.find((x) => x.id === pick(answers.project, 0.3));
      if (p) return { ...base, op: 'go', href: projectHref(p, partOf(answers)), label: projLabel(p, partOf(answers)), target: p.slug };
      return { ...base, op: 'search', text: text || utterance };
    }
    case 'type': {
      const f = item(pick(answers.field)) || s.items.find((i) => i.kind === 'field') || null;
      if (!f || !text) return { ...base, why: f ? 'no words to type' : 'no field on this page' };
      return { ...base, op: 'type', target: f.id, text, label: f.text };
    }
    case 'press': {
      const b = item(pick(answers.button));
      if (!b) return { ...base, why: 'no button matched' };
      return { ...base, op: 'press', target: b.id, label: b.text };
    }
    case 'back': return { ...base, op: 'back' };
    case 'scroll': {
      const c = pick(answers.section);
      if (c === 'top' || c === 'bottom') return { ...base, op: 'scroll', section: c };
      const h = item(c);
      return h ? { ...base, op: 'scroll', target: h.id, label: h.text } : { ...base, why: 'no section matched' };
    }
    case 'explain': return { ...base, op: 'explain' };
    case 'status': return { ...base, op: 'status' };
    case 'list': {
      // Their projects, the ones touched most recently first: named in the answer, and the Yours page opened.
      const mine = projects.filter((p) => p.mine).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      const all = (s.projects?.length ? s.projects : mine).filter((p: Proj) => p.mine);
      const names = (mine.length ? mine : all).map((p) => p.name.replace(/-/g, ' '));
      return { ...base, op: 'list', text: names.slice(0, 6).join(', '), href: '/mine', label: 'your projects', target: String(names.length) };
    }
    case 'code': {
      const cur = currentSlug(s.path);
      const p = projects.find((x) => x.id === pick(answers.project, 0.3)) || projects.find((x) => x.slug === cur);
      if (!p) return { ...base, why: 'which project? say its name' };
      const depth = /^\s*(plan|why\b|how (would|should|could)|what would it take|should (we|i))/i.test(utterance) ? 'plan' : top(answers.depth).choice;
      return { ...base, op: 'code', slug: p.slug, mine: !!p.mine, label: `${p.owner}/${p.name}`, text: utterance, depth, target: p.slug };
    }
    case 'change': {
      // The named project, else the one this page shows.
      const cur = currentSlug(s.path);
      const p = projects.find((x) => x.id === pick(answers.project, 0.3)) || projects.find((x) => x.slug === cur);
      if (!p) return { ...base, why: 'which project? say its name' };
      return { ...base, op: 'change', slug: p.slug, mine: !!p.mine, label: `${p.owner}/${p.name}`, text: utterance, href: `/p/${p.owner}/${p.name}/changes`, target: p.slug };
    }
  }
  return base;
}

/** "eyal/calculator", or "eyal/calculator (code)" when a part of it opens. */
const projLabel = (p: Proj, part: string) => `${p.owner}/${p.name}${part && part !== 'page' ? ` (${part})` : ''}`;

function projectHref(p: Proj, part: string): string {
  const root = `/p/${p.owner}/${p.name}`;
  return part === 'app' ? `${root}/app` : part === 'code' ? `${root}/code/` : part === 'readme' ? `${root}/readme` : part === 'history' ? `${root}/history` : root;   // agents: the cards on the project page (/agents is not a page)
}

// What a voice command may do without a tap (2026-10-13, voice everywhere): most things at once; things that spend
// money, start or stop work, or merge, after a yes (spoken or tapped); things that delete, sign out or revoke, never
// (Talk takes you to them instead). The model's yes/no plus the button's own words, so a "Stop" on a page is gated
// even when the sentence did not sound risky. Vocabulary in code.
export const CONFIRM_WORDS = /^(stop|pause|resume|merge|build it|build|send back|start|watch a run|run for real|replay|replace|connect my plan|save the key|shot|fork|import)\b/i;
export const DESTROY_WORDS = /^(remove|delete|revoke|sign out|log out|uninstall|disconnect|make (it )?(private|public)|clear)\b/i;
export const PRESET_RX = /^(Fastest|Balanced|Cheapest|Suggest from my idea|Small|Medium|Large|Huge)\b/;
export function gate(c: Cmd): 'refuse' | 'confirm' | null {
  // Anything else (a change request, a question): as before, refused only when the sentence itself is risky
  // ("delete the particles project" must not become a request to the agents).
  if (!['press', 'go', 'type'].includes(c.op)) return (c.risky ?? 0) >= 0.5 && !['status', 'list', 'code', 'none', 'latest', 'idea', 'which'].includes(c.op) ? 'refuse' : null;   // nothing to do is never 'that would remove something' (qb7's e2e: 'open the last run' before the cards loaded)
  const label = String(c.label || '').trim();
  if ((c.destroys ?? 0) >= 0.5 || DESTROY_WORDS.test(label)) return 'refuse';
  // A page's own action (window.__talkActions) is the page's promise to be safe: its UI asks for the real step
  // (qb7's fleet-job fills the form; the person taps Start). Opening a page is only a navigation.
  if (c.op === 'press' && /^x/.test(String(c.target || ''))) return null;
  if (c.op === 'press' && PRESET_RX.test(label)) return null;   // choosing a preset only changes the settings (qb7's e2e)
  if (c.op === 'go' && (c.then || c.href === '/runs' || /^\/p\//.test(String(c.href || '')))) return null;
  // Typing only fills a box (its Send or Build it is the step that needs a yes): "build a habit tracker" types at once.
  if (c.op === 'type') return null;
  if ((c.risky ?? 0) >= 0.5 || (c.op === 'press' && CONFIRM_WORDS.test(label))) return 'confirm';
  return null;
}

// Projects a harness made (Eyal, 2026-10-13: the bar's example said "open my kata d0b"): never offered as examples,
// "which project?" chips, keyterms or name hints. Lab/fleet/dial copies, experiment copies, numbered copies, tests.
export const SCAFFOLD_RX = /^(kata|fleet|lab|real|selftest|self-test|test|tmp|smoke|bench|dial|sim)[-_]|[-_][0-9a-f]{5}([-_]|$)|[-_]r\d+[a-z]?$|[-_]\d+$|(^|[-_])(test|lab|crew|busy|team|demo|copy|fixture|real)([-_]|$)/i;
export const isScaffold = (name: string) => SCAFFOLD_RX.test(String(name || ''));
// Narrower, for answers about their own work ('my latest project', status): only what a test harness made; real builds count.
export const HARNESS_RX = /^(lab|kata|fleet|selftest)-/i;
