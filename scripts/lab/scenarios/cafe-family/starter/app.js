import { routes } from './src/routes.js';
import { site } from './src/site.js';

function show() {
  const path = location.hash.slice(1) || '/';
  const route = routes.find((r) => r.path === path) || routes[0];
  document.title = `${route.title} · ${site.name}`;
  document.getElementById('nav').innerHTML = routes
    .map((r) => `<a href="#${r.path}"${r === route ? ' aria-current="page"' : ''}>${r.title}</a>`).join('');
  document.getElementById('page').innerHTML = route.page(site);
}
addEventListener('hashchange', show);
show();
