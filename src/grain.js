/**
 * Final look pass: vignette, a whisper of chromatic aberration at the edges,
 * and animated grain. Runs after OutputPass, so it works on tone-mapped sRGB.
 * Without this the bloom reads a bit "clean CG"; with it, it reads like a
 * camcorder in a dark room, which is the whole point.
 */
export const GrainShader = {
  name: 'GrainShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.055 },
    uVignette: { value: 1.05 },
    uAberration: { value: 0.0022 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uAberration;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);

      // split the channels slightly, and only away from the centre
      vec2 off = c * uAberration * (0.35 + r2 * 3.0);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;

      // vignette
      col *= 1.0 - uVignette * r2 * 0.85;

      // grain, animated so it never looks like a static overlay
      float n = hash(vUv * 900.0 + fract(uTime) * 100.0) - 0.5;
      col += n * uGrain;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
