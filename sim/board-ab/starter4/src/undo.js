export function snapshot(store) { (store.history ||= []).push(JSON.stringify({ items: store.items, nextId: store.nextId })); }
export function undo(store) { if (!store.history?.length) return false; const s = JSON.parse(store.history.pop()); store.items = s.items; store.nextId = s.nextId; return true; }
