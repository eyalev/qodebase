// Runs the sim off the main thread and plays it at a chosen speed.
import { createSim, runHeadless, POLICIES } from './engine.js';

let sim = null, cfg = null, speed = 60, playing = false, timer = null;
const TICK_MS = 100, MAX_EVENTS_PER_TICK = 250000;

function start(c) {
  cfg = c; sim = createSim(c);
  post();
}

function tick() {
  if (!sim || !playing) return;
  const t0 = performance.now(), before = sim.t;
  sim.runUntil(sim.t + speed * TICK_MS / 1000, MAX_EVENTS_PER_TICK);
  const wall = performance.now() - t0;
  post({ achieved: (sim.t - before) / (TICK_MS / 1000), wallMs: wall });
}

function post(extra = {}) {
  const s = sim.snapshot();
  // The chart needs the run's history: one point a simulated minute, thinned to ≤ 600.
  const ser = sim.series, step = Math.max(1, Math.ceil(ser.length / 600));
  const series = [];
  for (let i = 0; i < ser.length; i += step) series.push(ser[i]);
  if (ser.length && series[series.length - 1] !== ser[ser.length - 1]) series.push(ser[ser.length - 1]);
  const transfer = s.files ? [s.files.inFlight.buffer, s.files.conflictAge.buffer, s.files.mergeAge.buffer, s.files.claimed.buffer] : [];
  postMessage({ type: 'snap', snap: s, series, rate: rate(ser), playing, speed, ...extra }, transfer);
}

// Merged per hour and conflicts per hour over the last 10 simulated minutes.
function rate(ser) {
  if (ser.length < 2) return null;
  const last = ser[ser.length - 1];
  let i = ser.length - 1;
  while (i > 0 && last.t - ser[i].t < 600) i--;
  const a = ser[i], dt = (last.t - a.t) / 3600;
  if (dt <= 0) return null;
  return {
    mergedPerH: (last.merged - a.merged) / dt,
    conflictsPerH: (last.conflicts - a.conflicts) / dt,
    costPerH: (last.cost - a.cost) / dt,
  };
}

onmessage = ({ data }) => {
  switch (data.cmd) {
    case 'start': start(data.cfg); break;
    case 'play':
      playing = true;
      clearInterval(timer); timer = setInterval(tick, TICK_MS);
      post(); break;
    case 'pause': playing = false; clearInterval(timer); post(); break;
    case 'speed': speed = data.speed; post(); break;
    case 'follow': sim.follow(); post(); break;
    case 'compare': {
      const out = [];
      for (const policy of Object.keys(POLICIES)) {
        const t0 = performance.now();
        const r = runHeadless({ ...data.cfg, policy }, data.hours);
        const m = r.snapshot.metrics;
        out.push({
          policy, merged: m.merged, conflicts: m.conflicts, cost: m.cost,
          p50: r.snapshot.p50, p90: r.snapshot.p90, redShare: r.snapshot.redShare,
          stuck: Object.fromEntries(r.snapshot.groups), mergeWait: r.snapshot.mergeWait,
          reworkShare: (m.workS + m.reworkS) ? m.reworkS / (m.workS + m.reworkS) : 0,
          series: r.series.map((p) => [p.t, p.merged]),
          wallMs: performance.now() - t0,
        });
        postMessage({ type: 'compareProgress', done: out.length, of: Object.keys(POLICIES).length });
      }
      postMessage({ type: 'compare', hours: data.hours, rows: out });
      break;
    }
  }
};
