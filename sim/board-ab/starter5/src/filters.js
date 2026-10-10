import { daysBetween } from './dates.js';
export const byTag = (items, tag) => items.filter((i) => (i.tags || []).includes(tag));
export const byDone = (items, done) => items.filter((i) => i.done === done);
export const dueBefore = (items, date) => items.filter((i) => i.due && daysBetween(i.due, date) > 0);
