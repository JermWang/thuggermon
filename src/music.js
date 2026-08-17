import { MUSIC, SEC_PER_BEAT } from './config.js';

/**
 * The soundtrack is the record itself, streamed through an <audio> element so
 * we don't hold 40MB of decoded PCM in memory. It is routed into Web Audio so
 * the click zap can share a compressor with it and so muting is a gain change
 * rather than a pause — pausing would break the beat lock.
 *
 * The visuals do NOT drive the music; the music drives the visuals. See
 * `beatPhaseError()`, which main.js uses to keep the dance on the record's grid.
 */
export function createMusic() {
  const el = new Audio();
  el.src = encodeURI(MUSIC.src.startsWith('/') ? MUSIC.src : '/' + MUSIC.src);
  el.preload = 'auto';
  el.crossOrigin = 'anonymous';
  el.loop = false; // handled manually so every pass starts on the same beat

  let ctx = null;
  let gain = null;
  let muted = false;
  let started = false;

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaElementSource(el);
    gain = ctx.createGain();
    gain.gain.value = 0.0001;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -8;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.12;

    src.connect(gain).connect(comp).connect(ctx.destination);
  }

  // Restart on the same beat the track began on, so the phase relationship
  // between record and dance is identical on every pass.
  el.addEventListener('ended', () => {
    el.currentTime = MUSIC.startAt;
    el.play().catch(() => {});
  });

  /** Seconds into the file, or null when playback isn't genuinely running. */
  function position() {
    if (!started || el.paused || el.readyState < 2) return null;
    return el.currentTime;
  }

  function stab() {
    if (!ctx || muted) return;
    const at = ctx.currentTime + 0.01;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(1900, at);
    o.frequency.exponentialRampToValueAtTime(190, at + 0.18);
    g.gain.setValueAtTime(0.22, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
    o.connect(g).connect(ctx.destination);
    o.start(at);
    o.stop(at + 0.22);
  }

  return {
    start() {
      if (started) return;
      if (!ctx) build();
      if (ctx.state === 'suspended') ctx.resume();
      started = true;
      el.currentTime = MUSIC.startAt;
      el.play().catch(() => {
        started = false;
      });
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(muted ? 0.0001 : MUSIC.volume, ctx.currentTime + 1.4);
    },

    /**
     * How far the visual clock has slipped from the record, in beats, wrapped
     * to [-0.5, +0.5]. Returns 0 when there's no audio to sync to, so the whole
     * thing degrades to a free-running clock if the file is missing or blocked.
     */
    beatPhaseError(t) {
      const pos = position();
      if (pos == null) return 0;
      const err = (pos - MUSIC.startAt) / SEC_PER_BEAT - t / SEC_PER_BEAT;
      return err - Math.round(err);
    },

    playing: () => position() != null,

    tick() {
      /* nothing to schedule — the record keeps its own time */
    },

    stab,

    toggle() {
      if (!ctx) return muted;
      muted = !muted;
      // gain, never pause: pausing would drop the beat lock
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setTargetAtTime(muted ? 0.0001 : MUSIC.volume, ctx.currentTime, 0.05);
      return muted;
    },

    get muted() {
      return muted;
    },
  };
}
