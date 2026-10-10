// Text helpers. Every exported helper is also re-exported from src/index.js.

export function shout(text) {
  return String(text).toUpperCase() + '!';
}
