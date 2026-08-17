import * as THREE from 'three';
import { PALETTE, LIGHT_COLORS } from './config.js';
import { TAU } from './beat.js';

/** Soft radial dot, used for sparks, glints and light bloom sprites. */
export function makeGlowTexture(size = 128, inner = '#ffffff', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const grd = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.25, inner);
  grd.addColorStop(1, outer);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A Poké Ball, built in code so it can be tinted, scaled and blown up freely.
 * Origin is the centre of the sphere.
 */
export function makePokeball(radius = 0.34) {
  const ball = new THREE.Group();

  const shell = (color, phiStart, phiLength, extra = {}) =>
    new THREE.Mesh(
      new THREE.SphereGeometry(radius, 40, 24, 0, TAU, phiStart, phiLength),
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.22,
        metalness: 0.1,
        envMapIntensity: 1.4,
        ...extra,
      })
    );

  const top = shell(PALETTE.ballRed, 0, Math.PI * 0.5, {
    emissive: PALETTE.ballRed,
    emissiveIntensity: 0.22,
  });
  const bottom = shell(0xf2f2f5, Math.PI * 0.5, Math.PI * 0.5);
  ball.add(top, bottom);

  // black equator band
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.005, radius * 1.005, radius * 0.16, 40, 1, true),
    new THREE.MeshStandardMaterial({ color: PALETTE.ballDark, roughness: 0.35, metalness: 0.2 })
  );
  ball.add(band);

  // button: dark ring + glowing white centre (this is what the bloom catches)
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.3, radius * 0.075, 12, 28),
    new THREE.MeshStandardMaterial({ color: PALETTE.ballDark, roughness: 0.4 })
  );
  ring.position.z = radius * 0.95;
  const button = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.26, 20, 14),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 2.6,
      roughness: 0.1,
    })
  );
  button.position.z = radius * 0.97;
  ball.add(ring, button);
  ball.userData.button = button;

  ball.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return ball;
}

/**
 * Expanding shockwave ring used when a ball pops open. One mesh, one uniform,
 * driven entirely by the caller.
 */
export function makeShockwave(color = 0xffffff) {
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.72, 48), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.visible = false;
  return mesh;
}

/** Additive light shaft. Points along +Y, base at the origin. */
export function makeBeam(length = 15, spread = 0.62, color = 0xffffff) {
  const geo = new THREE.CylinderGeometry(0.015, spread, length, 12, 1, true);
  geo.translate(0, length / 2, 0); // so the narrow end sits on the origin
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 0.28 },
      uLength: { value: length },
    },
    vertexShader: /* glsl */ `
      uniform float uLength;
      varying float vT;
      void main() {
        vT = clamp(position.y / uLength, 0.0, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vT;
      void main() {
        // bright at the source, gone by the tip, with a soft shoulder
        float fade = pow(1.0 - vT, 2.2);
        gl_FragColor = vec4(uColor * (0.6 + fade), fade * uOpacity);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geo, mat);
}

export const pickLightColor = (i) => LIGHT_COLORS[i % LIGHT_COLORS.length];
