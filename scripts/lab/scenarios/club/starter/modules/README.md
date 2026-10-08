One file per feature, each exporting `register(app)` (see lib/app.js for what `app` offers).
A module keeps its data in its own store collections, adds its slots to `app.slots` if it
takes courts, adds its links with `app.nav`, and renders its pages in English and in
Portuguese (`/pt/...`, `lang: 'pt'`, `alt` = the other language's path).
