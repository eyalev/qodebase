export function priorityRank(p) { return { high: 0, medium: 1, low: 2 }[p] ?? 3; }
export function sortByPriority(items) { return items.map((it, i) => [it, i]).sort((a, b) => priorityRank(a[0].priority) - priorityRank(b[0].priority) || a[1] - b[1]).map((x) => x[0]); }
