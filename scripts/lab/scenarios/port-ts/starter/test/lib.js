// Loads the library from src/index.ts once it is ported, src/index.js before.
import { existsSync } from 'node:fs';
const ts = new URL('../src/index.ts', import.meta.url);
const lib = await import(existsSync(ts) ? ts : new URL('../src/index.js', import.meta.url));
export default lib.default;
