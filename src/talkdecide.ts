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
  type: 'Type words into a field on the page (an idea to build, a search box, a message to an agent)',
  press: 'Press a button that is on the screen',
  back: 'Go back to the previous page (only when they say back or previous; "go home" is the home page link)',
  scroll: 'Scroll to or show a section of this page (by its heading), or scroll to the top or bottom',
  explain: 'Explain, describe or show around the page the person is looking at',
  change: 'Ask for a change in one of the projects: add, fix, change, improve or remove a feature in an app or its code ("in my todo app add due dates", "make the timer chime louder", "fix the dark mode")',
  list: 'List or name their projects ("list my projects", "what projects do I have", "show me some of my projects")',
  code: 'Answer a question about a project\'s CODE that needs reading it: how something works or is stored, where something is, why it is built a certain way, or a plan for how to change it ("how are tasks stored in my todo app", "why does the timer use a worker", "plan how to add accounts")',
  status: 'Say what is going on across their projects: what their agents are doing, what is ready to merge or review, what changed today or this week, what needs them',
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
    risky: noul('Doing what the sentence asks would delete a project or an account, merge, publish, make something public or private, sign out, revoke, uninstall, disconnect, or spend money. Asking the agents to change, add or remove something inside an app is NOT risky (it only proposes a change).'),
  };
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
  href?: string; label?: string; target?: string; text?: string; section?: string; why?: string;
  slug?: string; mine?: boolean;   // change / code: the project, and whether it is theirs
  greet?: boolean; example?: string;   // a greeting / small talk, and one of their projects to suggest
  depth?: string;                  // code: fact | explain | plan (haiku | sonnet | opus in the ask box)
};

/** Answers -> one command the page carries out (or hands to the chat lane). */
export function resolve(answers: Record<string, Ans>, cands: string[], s: Screen, projects: Proj[], utterance: string): Cmd {
  const cmd = resolveAction(answers, cands, s, projects, utterance);
  // Greetings and small talk get a friendly reply with examples, never "say it again" (Eyal's phone, 2026-10-07:
  // "hi there" and "hello" got "Sounds cut off"). Fixed words in code; the model's yes/no for the rest.
  const hello = /^\s*(hi|hello|hey|hiya|yo|howdy|good (morning|afternoon|evening|night)|thanks|thank you|cheers|how are you|what'?s up|bye|goodbye)\b/i.test(utterance) || (answers.greeting?.noul ?? 0) >= 0.6;
  if (hello && cmd.op === 'none') {
    const own = projects.filter((p) => p.mine).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];   // the one they touched last
    return { ...cmd, mode: 'none', greet: true, example: own ? own.name.replace(/-/g, ' ') : undefined };
  }
  // "Go home" / "home page" is a fixed phrase: vocabulary in code, not the model (talkui's rule).
  const home = s.items.find((i) => i.kind === 'link' && i.href === '/');
  if (home && cmd.mode !== 'ask' && /\b(go|take me|back to the|bring me) home\b|\bhome ?page\b|^home$/i.test(utterance.trim())) return { ...cmd, mode: cmd.mode === 'none' ? 'act' : cmd.mode, op: 'go', href: '/', label: home.text, target: home.id };
  // A bare name of a place ("the code.", "changes", "agents"): saying it means open it. Eyal's phone, 2026-10-07:
  // "show me the code" arrived clipped as "the code." and the model picked the Code link but chose mode none.
  const words = utterance.trim().replace(/[.!?,]+$/g, '').split(/\s+/).filter(Boolean);
  if (cmd.mode === 'none' && cmd.op === 'go' && cmd.href && words.length <= 3 && (cmd.p ?? 0) >= 0.3 && !hello) return { ...cmd, mode: 'act', why: `${cmd.why || ''}; a bare place name opens it` };
  if (cmd.op !== 'none' || cmd.mode === 'ask' || cmd.mode === 'none') return cmd;
  // The action kind could not be done (no field, no words): a confident link pick still can.
  const l = s.items.find((i) => i.id === pick(answers.link, 0.5));
  return l?.href ? { ...cmd, op: 'go', href: l.href, label: l.text, target: l.id, why: `${cmd.why}; used the link` } : cmd;
}

function resolveAction(answers: Record<string, Ans>, cands: string[], s: Screen, projects: Proj[], utterance: string): Cmd {
  const mode = top(answers.mode);
  let action = top(answers.action);
  // The many-way action spreads thin on "in my X app, let it do Y" (it opens X); a direct yes/no on just that is sharper (talkui's rewords rule).
  const wc = answers.wants_change?.noul ?? 0;
  const changeP = answers.action?.probabilities?.change ?? 0;
  if (action.choice !== 'change' && !['status', 'explain', 'type', 'code'].includes(action.choice) && (wc >= 0.75 || (wc >= 0.55 && changeP >= 0.15))) action = { choice: 'change', p: wc };
  // "Plan how to…", "how would we…", "why does…" ask for an answer about the code, not an edit (vocabulary in code).
  if (action.choice === 'change' && /^\s*(plan|how (would|should|could|do) (we|i|you)|why\b|what would it take|should (we|i))/i.test(utterance)) action = { choice: 'code', p: action.p };
  const base: Cmd = { mode: mode.choice, modeP: mode.p, op: 'none', p: action.p, risky: answers.risky?.noul ?? null, complete: answers.complete?.noul ?? null };
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
