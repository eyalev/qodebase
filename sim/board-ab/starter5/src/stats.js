import { dueBefore } from './filters.js';
export const completionRate = (items) => (items.length ? items.filter((i) => i.done).length / items.length : null);
export const overdueCount = (items, today) => dueBefore(items.filter((i) => !i.done), today).length;
