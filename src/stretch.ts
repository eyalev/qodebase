// Speed up (or slow down) speech without changing its pitch: WSOLA (waveform-similarity
// overlap-add) on 16-bit mono PCM. Used for Talk's spoken replies in a conversation, where the
// voice kit plays decoded buffers (a faster buffer would also sound higher). Same idea as
// Android's PlaybackParams.setSpeed() that Ask uses for Jarvis's voice.
export function stretchPcm16(input: Int16Array, sampleRate: number, speed: number): Int16Array {
  if (!(speed > 0) || Math.abs(speed - 1) < 0.01 || input.length < sampleRate / 10) return input;
  const frame = Math.round(sampleRate * 0.03);        // 30 ms analysis frame
  const hop = Math.round(frame / 2);                  // output hop (50% overlap)
  const seek = Math.round(sampleRate * 0.012);        // search ±12 ms for the best-matching frame
  const inHop = hop * speed;                          // input advances faster (speed > 1) or slower
  const outLen = Math.ceil(input.length / speed) + frame;
  const out = new Float32Array(outLen);
  const norm = new Float32Array(outLen);
  const win = new Float32Array(frame);
  for (let i = 0; i < frame; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frame - 1));   // Hann
  let prev = 0;                                       // where the last copied frame started in the input
  for (let o = 0, k = 0; o + frame < outLen; o += hop, k++) {
    const nominal = Math.round(k * inHop);
    if (nominal + frame >= input.length) break;
    let best = nominal;
    if (k > 0) {
      // Pick the start near `nominal` whose first half best continues what was just written
      // (the natural continuation of the previous frame): cross-correlation over the overlap.
      const target = prev + hop;
      let bestScore = -Infinity;
      const lo = Math.max(0, nominal - seek), hi = Math.min(input.length - frame - 1, nominal + seek);
      for (let c = lo; c <= hi; c += 2) {
        let score = 0;
        for (let i = 0; i < hop; i += 4) score += input[c + i] * input[Math.min(input.length - 1, target + i)];
        if (score > bestScore) { bestScore = score; best = c; }
      }
    }
    for (let i = 0; i < frame; i++) { out[o + i] += input[best + i] * win[i]; norm[o + i] += win[i]; }
    prev = best;
  }
  let end = outLen;
  while (end > 0 && norm[end - 1] === 0) end--;
  const res = new Int16Array(end);
  for (let i = 0; i < end; i++) {
    const v = norm[i] > 1e-3 ? out[i] / norm[i] : 0;
    res[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
  }
  return res;
}
