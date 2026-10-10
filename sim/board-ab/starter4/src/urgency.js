import { priorityRank, sortByPriority } from './priority.js';
export const urgencyScore = (item) => priorityRank(item.priority);
export const orderByUrgency = sortByPriority;
