// The command registry: one entry per command, kept in alphabetical order by name.
// A command takes the rest of the input line as one string and returns a string.
import { shout } from './strings.js';

export const commands = [
  { name: 'shout', description: 'Upper-case the text and add "!"', run: (input) => shout(input) },
];

export function runCommand(line) {
  const [name, ...rest] = String(line).trim().split(' ');
  const cmd = commands.find((c) => c.name === name);
  if (!cmd) return `unknown command: ${name}`;
  return cmd.run(rest.join(' '));
}
