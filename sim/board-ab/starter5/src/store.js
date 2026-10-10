// The in-memory store. An item: { id, title, done, due, priority, tags }.
// due is 'YYYY-MM-DD' or null; priority is 'high' | 'medium' | 'low' | null; tags is an array of
// lower-case strings without '#'. Ids start at 1 and are never reused.

export function createStore() {
  return { items: [], nextId: 1 };
}

export function addItem(store, fields) {
  const item = { id: store.nextId++, title: fields.title, done: false, due: fields.due ?? null, priority: fields.priority ?? null, tags: fields.tags ?? [] };
  store.items.push(item);
  return item;
}

export function getItem(store, id) {
  return store.items.find((i) => i.id === Number(id)) ?? null;
}
