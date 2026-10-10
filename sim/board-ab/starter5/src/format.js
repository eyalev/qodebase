export function formatItem(i) { return `[${i.done ? 'x' : ' '}] #${i.id} ${i.title}` + (i.due ? ` (due ${i.due})` : '') + (i.priority ? ` !${i.priority}` : '') + (i.tags || []).map((t) => ` #${t}`).join(''); }
export const formatList = (items) => (items.length ? items.map(formatItem).join('\n') : '(empty)');
