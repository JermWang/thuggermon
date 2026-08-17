import { SEC_PER_BEAT, LOOP_BEATS } from './config.js';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Hermite smoothstep. */
export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Rises 0→1 over [a,b] then falls 1→0 over [c,d]. Used all over the intro. */
export function window4(t, a, b, c, d) {
  return smoothstep(a, b, t) * (1 - smoothstep(c, d, t));
}

/** Overshoot-and-settle. k>0 controls how much it blows past 1. */
export function elasticOut(t, k = 1.6) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.pow(1 - t, 3) * Math.cos(t * Math.PI * k);
}

/**
 * A "groove" is the musical position at time t, plus a set of oscillators
 * expressed in beats-per-cycle.
 *
 * SEAMLESSNESS RULE: any `per` passed to o/co/pulse must divide LOOP_BEATS
 * (so: 0.5, 1, 2, 4, 8, 16). Then every oscillator completes a whole number of
 * cycles per loop and returns to its exact value *and slope* at the wrap. Use
 * an odd number like 3 and you get a visible pop every 7.5 seconds.
 */
export function makeGroove(t) {
  const totalBeats = t / SEC_PER_BEAT;
  const b = ((totalBeats % LOOP_BEATS) + LOOP_BEATS) % LOOP_BEATS;

  return {
    t,
    /** Position inside the loop, in beats (0 … LOOP_BEATS). */
    beats: b,
    /** Position inside the loop, normalised 0…1. */
    phase: b / LOOP_BEATS,
    /** Monotonic beat/bar counters — for the HUD, not for animation. */
    beatIndex: Math.floor(totalBeats),
    barIndex: Math.floor(totalBeats / 4),

    /** sin wave, one cycle every `per` beats, shifted `off` beats later. */
    o: (per = 1, off = 0) => Math.sin((TAU * (b - off)) / per),
    /** cos wave, same contract. */
    co: (per = 1, off = 0) => Math.cos((TAU * (b - off)) / per),
    /** 0…1 spike that peaks on the beat and decays. `sharp` tightens it. */
    pulse: (per = 1, off = 0, sharp = 2.5) =>
      Math.pow(0.5 + 0.5 * Math.cos((TAU * (b - off)) / per), sharp),
    /** 0…1 ramp. Only safe on values where a wrap is invisible (e.g. yaw). */
    saw: (per = 1, off = 0) => ((((b - off) / per) % 1) + 1) % 1,
  };
}
