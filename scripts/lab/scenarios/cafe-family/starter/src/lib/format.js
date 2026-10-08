export const price = (n) => (Number.isInteger(n) ? `€${n}` : `€${n.toFixed(2)}`);
