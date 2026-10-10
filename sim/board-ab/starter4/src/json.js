export const exportJson = (store) => JSON.stringify({ items: store.items, nextId: store.nextId });
export function importJson(text) { const o = JSON.parse(text); return { items: o.items, nextId: o.nextId }; }
