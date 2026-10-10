// Number helpers. Every exported helper is also re-exported from src/index.js.

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}
