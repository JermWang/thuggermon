import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { INTRO_SECONDS, LOOP_SECONDS, SEC_PER_BEAT, UI_REVEAL_AT } from './config.js';
import { TAU, clamp, makeGroove, smoothstep } from './beat.js';
import { createWorld } from './world.js';
import { createCrew } from './crew.js';
import { createMusic } from './music.js';
import { createUI } from './ui.js';
import { GrainShader } from './grain.js';

const canvas = document.getElementById('stage');

/* ------------------------------------------------------------- renderer -- */

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 2.8, 11);

/* ---------------------------------------------------------- post stack --- */

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(
  new THREE.Vector2(innerWidth, innerHeight),
  0.85, // strength
  0.66, // radius
  0.72 // threshold — only the genuinely bright stuff blooms
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const grain = new ShaderPass(GrainShader);
composer.addPass(grain);

/* -------------------------------------------------------------- camera --- */

const _loopPos = new THREE.Vector3();
const _loopTarget = new THREE.Vector3();
const _introPos = new THREE.Vector3();
const _introTarget = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _target = new THREE.Vector3();

/**
 * The camera's resting behaviour: a slow drift built only from sines whose
 * period divides a 30s master cycle, so it never needs a cut.
 */
function loopCamera(t, g, out, outTarget) {
  const s = t / (LOOP_SECONDS * 4);
  const punch = g.pulse(1, 0, 3.0) * 0.09; // tiny shove on every kick
  out.set(
    Math.sin(TAU * s) * 2.6,
    3.3 + Math.sin(TAU * 2 * s) * 0.32,
    13.5 + Math.cos(TAU * s) * 0.9 - punch * 4
  );
  outTarget.set(
    Math.sin(TAU * s + 1.1) * 0.55,
    2.0 + Math.sin(TAU * 3 * s) * 0.14 + punch * 0.4,
    -1.4
  );
}

/** Where the camera comes *from*: wide, low and off to the side. */
function introCamera(t, out, outTarget) {
  const a = -1.2 + t * 0.085;
  out.set(Math.sin(a) * 17.5, 0.75 + t * 0.2, Math.cos(a) * 17.5);
  // start by watching the ball come down, then find the floor
  const toFloor = smoothstep(1.8, 5.2, t);
  outTarget.set(0, 6.4 - toFloor * 4.7, -toFloor * 0.7);
}

const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/* ---------------------------------------------------------------- boot --- */

const ui = createUI();
const music = createMusic();

let world;
let crew;
let started = false;
let t = 0;
let last = performance.now();

async function boot() {
  world = await createWorld(scene, renderer);
  crew = await createCrew(scene);
  ui.onSoundToggle(() => music.toggle());
  ui.ready(() => {
    started = true;
    t = 0;
    last = performance.now();
    music.start();
    world.jumbotronPlay?.();
  });
}

/* --------------------------------------------------------------- input --- */

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

addEventListener('pointerdown', (e) => {
  if (!started || !crew) return;
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(crew.pickable, false);
  if (hits.length) {
    crew.hype(hits[0].object.userData.member);
    music.stab();
  }
});

addEventListener('keydown', (e) => {
  if (!crew) return;
  if (e.key >= '1' && e.key <= '4') crew.setStyle(Number(e.key) - 1);
  if (e.key.toLowerCase() === 'm') ui.setMuted(music.toggle());
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.setSize(innerWidth, innerHeight);
});

/* ---------------------------------------------------------------- loop --- */

function simulate(dt) {
  const g = makeGroove(t);

  // Intro state, expressed as a handful of 0→1 dials the world reads. Each one
  // reaches exactly 1 before INTRO_SECONDS, so nothing is still moving when the
  // loop takes over.
  const env = {
    power: smoothstep(0.8, 3.4, t), // house lights coming up
    ignite: smoothstep(1.1, 3.6, t), // floor lighting up from the centre
    intro: t < INTRO_SECONDS,
  };

  if (world) world.update(t, g, dt, env);
  if (crew) crew.update(t, g, dt, !env.intro);

  // camera: blend the intro path onto the loop path with an ease that lands
  // flat at t = INTRO_SECONDS, so the handover has no kink in it
  loopCamera(t, g, _loopPos, _loopTarget);
  if (env.intro) {
    introCamera(t, _introPos, _introTarget);
    const b = easeInOutCubic(clamp(t / INTRO_SECONDS, 0, 1));
    _pos.lerpVectors(_introPos, _loopPos, b);
    _target.lerpVectors(_introTarget, _loopTarget, b);
  } else {
    _pos.copy(_loopPos);
    _target.copy(_loopTarget);
  }
  if (import.meta.env.DEV && window.__camOverride) {
    camera.position.fromArray(window.__camOverride.pos);
    camera.lookAt(...window.__camOverride.target);
  } else {
    camera.position.copy(_pos);
    camera.lookAt(_target);
  }

  grain.uniforms.uTime.value = t;
  music.tick(t);
  ui.tick(t, g);

  composer.render();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  if (started) {
    t += dt;
    /**
     * Phase-lock the visual clock to the record. `beatPhaseError` reports the
     * slip in beats wrapped to ±half a beat, and we close a small fraction of
     * it per frame — a software PLL. Correcting *phase* rather than absolute
     * position means the clock stays monotonic and survives the track looping,
     * and `audio.currentTime` is quantised enough that pulling hard on it would
     * visibly judder the dance. With no audio the error is 0 and this is a
     * no-op, so the scene still runs free.
     */
    t += music.beatPhaseError(t) * SEC_PER_BEAT * Math.min(1, dt * 2.5);
  }

  simulate(dt);
}

boot();
requestAnimationFrame(frame);

// Dev-only hook: lets tooling scrub to an exact moment on the timeline and
// grab that frame, which is the only sane way to tune a 9-second intro.
if (import.meta.env.DEV) {
  window.__party = {
    renderer,
    scene,
    camera,
    music,
    get t() {
      return t;
    },
    get crew() {
      return crew;
    },
    get world() {
      return world;
    },
    /** Scrub to `at` seconds, render that frame, and POST it to /__shot/<name>. */
    async shoot(name, at, width = 1100, quality = 0.72) {
      started = true;
      t = at;
      // let the cube camera and any dt-integrated motion settle
      for (let k = 0; k < 4; k++) simulate(1 / 60);
      const src = renderer.domElement;
      const c = document.createElement('canvas');
      c.width = width;
      c.height = Math.round((width * src.height) / src.width);
      c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      const url = c.toDataURL('image/jpeg', quality);
      await fetch('/__shot/' + name, { method: 'POST', body: url });
      return name;
    },
  };
}
