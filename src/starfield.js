/**
 * Star field for the entry screen.
 *
 * Three depth layers, each a SINGLE element whose `box-shadow` carries every
 * star in that layer — a few hundred stars for three DOM nodes instead of three
 * hundred. Each layer is stacked twice and drifts by exactly one field height,
 * so the motion loops with no seam (same trick as the ticker marquee).
 *
 * Depth comes from two things at once: nearer layers drift faster, and nearer
 * layers move further under the pointer. That difference is the parallax — the
 * field reads as volume rather than as a flat sheet of dots.
 */

const FIELD = 1400; // px of vertical travel before the loop repeats

const LAYERS = [
  { n: 180, size: 1, dur: 210, depth: 0.22, alpha: 0.5 }, // far
  { n: 95, size: 2, dur: 140, depth: 0.55, alpha: 0.72 }, // mid
  { n: 40, size: 3, dur: 90, depth: 1, alpha: 0.95 }, // near
];

/** A few stars take a brand tint so the field isn't clinically white. */
const TINTS = ['255,255,255', '255,255,255', '255,255,255', '255,203,5', '53,224,255', '255,61,190'];

export function createStarfield(host) {
  const sky = document.createElement('div');
  sky.className = 'sky';

  const nebula = document.createElement('div');
  nebula.className = 'nebula';
  sky.appendChild(nebula);

  for (const L of LAYERS) {
    const shadows = [];
    for (let i = 0; i < L.n; i++) {
      const x = (Math.random() * 100).toFixed(2);
      const y = Math.round(Math.random() * FIELD);
      const tint = TINTS[(Math.random() * TINTS.length) | 0];
      const a = (L.alpha * (0.35 + Math.random() * 0.65)).toFixed(2);
      shadows.push(`${x}vw ${y}px 0 rgba(${tint},${a})`);
    }

    const layer = document.createElement('div');
    layer.className = 'sky-layer';
    layer.style.setProperty('--depth', String(L.depth));

    const drift = document.createElement('div');
    drift.className = 'sky-drift';
    drift.style.animationDuration = `${L.dur}s`;

    const star = document.createElement('i');
    star.style.width = `${L.size}px`;
    star.style.height = `${L.size}px`;
    star.style.boxShadow = shadows.join(',');

    // second copy sits exactly one field below, so the wrap is invisible
    const echo = star.cloneNode();
    echo.style.top = `${FIELD}px`;

    drift.append(star, echo);
    layer.appendChild(drift);
    sky.appendChild(layer);
  }

  host.prepend(sky);

  // Pointer parallax. Written to CSS custom properties and eased by a CSS
  // transition, so the browser interpolates it off the main thread rather than
  // us running a rAF loop next to a WebGL scene that is already busy.
  const MAX = 16; // px of travel at the nearest layer
  let raf = 0;
  const onMove = (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const x = (e.clientX / window.innerWidth - 0.5) * -2;
      const y = (e.clientY / window.innerHeight - 0.5) * -2;
      sky.style.setProperty('--px', `${(x * MAX).toFixed(2)}px`);
      sky.style.setProperty('--py', `${(y * MAX).toFixed(2)}px`);
    });
  };
  window.addEventListener('pointermove', onMove, { passive: true });

  return {
    /** Called once the party starts — stop paying for animation we can't see. */
    destroy() {
      window.removeEventListener('pointermove', onMove);
      if (raf) cancelAnimationFrame(raf);
      sky.remove();
    },
  };
}
