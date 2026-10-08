// Storage: one JSON file per collection under DATA_DIR, loaded on first use, written
// atomically after every change. Every module keeps its data here.
//   const bookings = store.list('bookings');   // the live array
//   store.save('bookings');                    // after changing it
//   store.id('b')                              // a new id like "b-3f9k2a"
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export function createStore(dir) {
  mkdirSync(dir, { recursive: true });
  const cache = new Map();
  const file = (name) => join(dir, `${name}.json`);
  return {
    list(name) {
      if (!cache.has(name)) cache.set(name, existsSync(file(name)) ? JSON.parse(readFileSync(file(name), 'utf8')) : []);
      return cache.get(name);
    },
    save(name) {
      const tmp = file(name) + '.tmp';
      writeFileSync(tmp, JSON.stringify(this.list(name), null, 1));
      renameSync(tmp, file(name));
    },
    id(prefix) { return `${prefix}-${randomBytes(4).toString('hex')}`; },
  };
}
