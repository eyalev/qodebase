# todokit

A small to-do list library with a command interface: `runCommand(store, "add Buy milk #home")`.
`npm test` runs the tests (Node's built-in runner, no dependencies). The work to do is in BACKLOG.md.

## Modules

One line per module, alphabetical: `- src/<name>.js: <what it does>`.

- src/commands.js: the command registry and runCommand
- src/dates.js: date helpers (parseDate, formatDate, addDays, daysBetween)
- src/store.js: the in-memory store
