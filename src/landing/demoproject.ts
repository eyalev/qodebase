// The demo project for the landing system: a tiny café website (static, so its live app on
// ttyview.dev changes as changes land) with real tests (`node --test`). Small enough to
// follow on camera. Scripted agents (demo.ts) work through TASKS: each task is an intent
// written as edits that find their place by anchors, so the same task can be done on any
// version of the code (that is what the scripted lead's "redo on the latest code" uses).
//
// The order is chosen so that the agents collide where the story needs it:
//   hours + contact      both add a page: same lines of src/routes.js   -> replayed by handler
//   cakes + teas         both add to the menu list                       -> replayed by handler
//   rounder              breaks a test                                   -> bounced, fixed, lands
//   rename + tagline     same line of src/site.js, compatible intents    -> the lead redoes one
//   reservations + form  the form is stacked on the unlanded page        -> lands after it
// Pure data + string edits: no Workers APIs here (tested with node, demoproject.test.mjs).

export type Edit =
  | { path: string; create: string }
  | { path: string; after: string; insert: string }      // insert lines after the first line containing `after`
  | { path: string; before: string; insert: string }
  | { path: string; append: string }
  | { path: string; re: string; to: string };            // regex (one match) -> replacement
export type Task = { key: string; title: string; intent: string; claims: string[]; edits: Edit[];
  stackOn?: string; fix?: Edit[]; fixNote?: string; workS?: number };

export const SEED: Record<string, string> = {
  'README.md': `# Corner Café

A tiny website for a café, built by agents on qodebase. Pages live in \`src/pages\`,
the list of pages in \`src/routes.js\`, the menu in \`src/data/menu.js\`.
Tests: \`node --test\`.
`,
  'package.json': JSON.stringify({ name: 'corner-cafe', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2) + '\n',
  '.qodebase/landing.json': JSON.stringify({ check: 'node --test', list: ['src/routes.js', 'src/data/menu.js', 'style.css'] }, null, 2) + '\n',
  'index.html': `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Corner Café</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header><nav id="nav"></nav></header>
  <main id="page"></main>
  <script type="module" src="app.js"></script>
</body>
</html>
`,
  'app.js': `import { routes } from './src/routes.js';
import { site } from './src/site.js';

function show() {
  const path = location.hash.slice(1) || '/';
  const route = routes.find((r) => r.path === path) || routes[0];
  document.title = \`\${route.title} · \${site.name}\`;
  document.getElementById('nav').innerHTML = routes
    .map((r) => \`<a href="#\${r.path}"\${r === route ? ' aria-current="page"' : ''}>\${r.title}</a>\`).join('');
  document.getElementById('page').innerHTML = route.page(site);
}
addEventListener('hashchange', show);
show();
`,
  'style.css': `body { font: 17px/1.5 Georgia, serif; margin: 0; color: #2b2118; background: #fbf6ef; }
header { background: #6b3e26; padding: 12px 16px; }
nav a { color: #fbf6ef; margin-right: 16px; text-decoration: none; }
nav a[aria-current] { text-decoration: underline; }
main { padding: 16px; max-width: 640px; }
h1 { margin: 8px 0; }
.price { float: right; }
`,
  'src/site.js': `export const site = { name: 'Corner Café', tagline: 'Coffee and cake since 1998' };
`,
  'src/routes.js': `import home from './pages/home.js';
import menu from './pages/menu.js';

export const routes = [
  { path: '/', title: 'Home', page: home },
  { path: '/menu', title: 'Menu', page: menu },
];
`,
  'src/pages/home.js': `export default (site) => \`
  <h1>\${site.name}</h1>
  <p>\${site.tagline}</p>
\`;
`,
  'src/pages/menu.js': `import { menu } from '../data/menu.js';
import { price } from '../lib/format.js';

export default () => \`
  <h1>Menu</h1>
  <ul>
    \${menu.map((item) => \`<li>\${item.name} <span class="price">\${price(item.price)}</span></li>\`).join('')}
  </ul>
\`;
`,
  'src/data/menu.js': `export const menu = [
  { name: 'Espresso', price: 1.2 },
  { name: 'Cappuccino', price: 2.5 },
  { name: 'Croissant', price: 1.8 },
];
`,
  'src/lib/format.js': `export const price = (n) => \`€\${n.toFixed(2)}\`;
`,
  'test/site.test.js': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routes } from '../src/routes.js';
import { site } from '../src/site.js';
import { price } from '../src/lib/format.js';

test('every page renders a heading', () => {
  for (const r of routes) assert.match(r.page(site), /<h1>/, r.path);
});
test('every page has its own path', () => {
  assert.equal(new Set(routes.map((r) => r.path)).size, routes.length);
});
test('prices show euros and cents', () => {
  assert.equal(price(1.2), '€1.20');
  assert.equal(price(3), '€3.00');
});
`,
};

const page = (name: string, title: string, body: string) => ({ path: `src/pages/${name}.js`, create: `export default () => \`\n  <h1>${title}</h1>\n${body}\`;\n` });
const route = (name: string, title: string): Edit[] => [
  { path: 'src/routes.js', after: "import menu from './pages/menu.js';", insert: `import ${name} from './pages/${name}.js';` },
  { path: 'src/routes.js', after: "{ path: '/menu', title: 'Menu', page: menu },", insert: `  { path: '/${name}', title: '${title}', page: ${name} },` },
];

export const TASKS: Task[] = [
  { key: 'hours', title: 'Add an Opening hours page', intent: 'Add a page with the opening hours (Mon-Fri 7-19, Sat-Sun 8-17) and link it in the menu bar.',
    claims: ['src/pages/hours.js', 'src/routes.js'],
    edits: [page('hours', 'Opening hours', '  <p>Monday to Friday: 7:00 to 19:00</p>\n  <p>Saturday and Sunday: 8:00 to 17:00</p>\n'), ...route('hours', 'Hours')] },
  { key: 'contact', title: 'Add a Contact page', intent: 'Add a Contact page with the address and phone number, linked in the menu bar.',
    claims: ['src/pages/contact.js', 'src/routes.js'],
    edits: [page('contact', 'Find us', '  <p>12 Rua das Flores, Lisbon</p>\n  <p>+351 21 000 0000</p>\n'), ...route('contact', 'Contact')] },
  { key: 'cakes', title: 'Add three cakes to the menu', intent: 'Add carrot cake, pastel de nata and brownie to the menu.',
    claims: ['src/data/menu.js'],
    edits: [{ path: 'src/data/menu.js', before: '];', insert: "  { name: 'Carrot cake', price: 3.2 },\n  { name: 'Pastel de nata', price: 1.4 },\n  { name: 'Brownie', price: 2.9 }," }] },
  { key: 'teas', title: 'Add teas to the menu', intent: 'Add green tea and chai latte to the menu.',
    claims: ['src/data/menu.js'],
    edits: [{ path: 'src/data/menu.js', before: '];', insert: "  { name: 'Green tea', price: 1.9 },\n  { name: 'Chai latte', price: 3.1 }," }] },
  { key: 'rounder', title: 'Show round prices without cents', intent: 'Show €3 instead of €3.00 when a price is a whole number.',
    claims: ['src/lib/format.js'],
    // The first try drops the cents everywhere and breaks a test; the fix keeps them when needed.
    edits: [{ path: 'src/lib/format.js', re: 'export const price = .*', to: 'export const price = (n) => `€${Math.round(n)}`;' }],
    fix: [{ path: 'src/lib/format.js', re: 'export const price = .*', to: 'export const price = (n) => (Number.isInteger(n) ? `€${n}` : `€${n.toFixed(2)}`);' },
      { path: 'test/site.test.js', re: "assert.equal\\(price\\(3\\), '€3.00'\\);", to: "assert.equal(price(3), '€3');" }],
    fixNote: 'keep cents unless the price is whole; update the test' },
  { key: 'dark', title: 'Add a dark theme', intent: 'Follow the phone\'s dark mode: dark background, light text.',
    claims: ['style.css'],
    edits: [{ path: 'style.css', append: '@media (prefers-color-scheme: dark) {\n  body { color: #f3e9dc; background: #1d1612; }\n  header { background: #3a2216; }\n}\n' }] },
  { key: 'rename', title: 'Rename to Corner Café & Books', intent: 'The café now sells books: rename it to "Corner Café & Books".',
    claims: ['src/site.js'],
    edits: [{ path: 'src/site.js', re: "name: '[^']*'", to: "name: 'Corner Café & Books'" }] },
  { key: 'tagline', title: 'New tagline with books', intent: 'Change the tagline to "Coffee, cake and good books since 1998".',
    claims: ['src/site.js'],
    edits: [{ path: 'src/site.js', re: "tagline: '[^']*'", to: "tagline: 'Coffee, cake and good books since 1998'" }] },
  { key: 'badges', title: 'Mark vegan items on the menu', intent: 'Show a small "vegan" badge next to vegan items.',
    claims: ['src/pages/menu.js', 'style.css'],
    edits: [{ path: 'src/pages/menu.js', re: '\\$\\{item\\.name\\} <span', to: '${item.name}${item.vegan ? \' <small class="badge">vegan</small>\' : \'\'} <span' },
      { path: 'style.css', append: '.badge { background: #d9ead3; color: #274e13; padding: 0 6px; border-radius: 4px; }\n' }] },
  { key: 'reservations', title: 'Add a Reservations page', intent: 'Add a Reservations page explaining how to book a table.',
    claims: ['src/pages/reservations.js', 'src/routes.js'],
    edits: [page('reservations', 'Book a table', '  <p>Tables for up to 8 people. Call us or write below.</p>\n'), ...route('reservations', 'Book')] },
  { key: 'resform', title: 'Add a booking form', intent: 'Add a booking form (name, day, people) to the Reservations page.', stackOn: 'reservations',
    claims: ['src/pages/reservations.js'],
    edits: [{ path: 'src/pages/reservations.js', after: 'Tables for up to 8 people', insert: '  <form><label>Name <input name="name"></label> <label>Day <input type="date" name="day"></label> <label>People <input type="number" min="1" max="8" name="people"></label> <button>Book</button></form>' }] },
  { key: 'specials', title: "Today's specials on the home page", intent: "Show today's specials on the home page.",
    claims: ['src/pages/home.js'],
    edits: [{ path: 'src/pages/home.js', after: '<p>${site.tagline}</p>', insert: "  <h2>Today's specials</h2>\n  <p>Pumpkin soup, and lemon tart with every coffee.</p>" }] },
  { key: 'footer', title: 'Add a footer', intent: 'Add a footer with the address and a note that the site was built by agents.',
    claims: ['index.html', 'style.css'],
    edits: [{ path: 'index.html', after: '<main id="page"></main>', insert: '  <footer>12 Rua das Flores, Lisbon · built by agents on qodebase</footer>' },
      { path: 'style.css', append: 'footer { padding: 16px; font-size: 14px; opacity: .7; }\n' }] },
  { key: 'vegan-data', title: 'Mark the vegan items', intent: 'Mark the vegan items in the menu data so the badge shows.',
    claims: ['src/data/menu.js'],
    edits: [{ path: 'src/data/menu.js', re: "\\{ name: 'Espresso', price: 1.2 \\}", to: "{ name: 'Espresso', price: 1.2, vegan: true }" }] },
];

/** Apply edits to a file map (path -> text). Returns the changed paths; throws on a missing anchor. */
export function applyEdits(files: Map<string, string>, edits: Edit[]): string[] {
  const changed = new Set<string>();
  for (const e of edits) {
    if ('create' in e) { files.set(e.path, e.create); changed.add(e.path); continue; }
    const text = files.get(e.path);
    if (text == null) throw new Error(`${e.path} does not exist`);
    let out: string;
    if ('append' in e) out = text + (text.endsWith('\n') ? '' : '\n') + e.append;
    else if ('re' in e) {
      const re = new RegExp(e.re);
      if (!re.test(text)) throw new Error(`${e.path}: nothing matches ${e.re}`);
      out = text.replace(re, () => e.to);
    } else {
      const lines = text.split('\n');
      const anchor = 'after' in e ? e.after : e.before;
      let i = -1;
      if ('after' in e) i = lines.findIndex((l) => l.includes(anchor));
      else for (let k = lines.length - 1; k >= 0 && i < 0; k--) if (lines[k].includes(anchor)) i = k;
      if (i < 0) throw new Error(`${e.path}: no line with ${anchor}`);
      lines.splice('after' in e ? i + 1 : i, 0, ...e.insert.split('\n'));
      out = lines.join('\n');
    }
    if (out !== text) { files.set(e.path, out); changed.add(e.path); }
  }
  return [...changed];
}
