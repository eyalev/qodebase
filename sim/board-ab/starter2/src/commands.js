// The command registry: one entry per command, kept in alphabetical order by name.
// runCommand(store, line) splits off the first word as the command name; the command gets the rest
// of the line as one string and returns a string. Every command is also listed in docs/COMMANDS.md.

export const commands = [
  { name: 'count', run: (store) => String(store.items.length) },
];

export function runCommand(store, line) {
  const text = String(line).trim();
  const i = text.indexOf(' ');
  const name = i < 0 ? text : text.slice(0, i);
  const rest = i < 0 ? '' : text.slice(i + 1).trim();
  const cmd = commands.find((c) => c.name === name);
  if (!cmd) return `unknown command: ${name}`;
  return cmd.run(store, rest);
}
