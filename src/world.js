import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { JUMBOTRON_VIDEO, LIGHT_COLORS, PALETTE, POSTERS, SEC_PER_BEAT } from './config.js';
import { TAU, clamp, elasticOut, lerp, smoothstep } from './beat.js';
import { makeBeam, makeGlowTexture } from './props.js';

const FLOOR_SPAN = 24;
const TILES = 20;
const BALL_Y = 5.6;
const CEIL_Y = 10.5;
const ROOM_R = 19; // wall radius — tight enough that the room reads as a room

/**
 * DJ booth. The console stands on the floor; the DJ is on a low riser behind it.
 * These numbers are set by reach, not by taste: measured shoulder-to-hand on
 * this rig is only 0.451 units, and the shoulder already sits 0.295 forward, so
 * a human-scale booth is physically unreachable and the hands float over it.
 * A compact controller at chest height keeps the platters inside the arc.
 */
export const RISER_H = 0.42;
export const DJ_Z = -5.62;
const DECK_Y = 0.97; // worktop; platters land at 1.10
const DECK_Z = -4.97;
const DECK_W = 1.62;
const DECK_D = 0.6;
const PLATTER_DX = 0.34;

export async function createWorld(scene, renderer) {
  const glow = makeGlowTexture(128);
  const parts = {};

  scene.background = new THREE.Color(PALETTE.night);
  scene.fog = new THREE.FogExp2(PALETTE.night, 0.028);

  // Additive volumetrics — light shafts and airborne sparks. Collected so they
  // can be pulled out of the mirror pass below.
  const haze = [];

  buildRoom(scene, parts);
  const tiles = buildTileFloor(scene);
  const lights = buildLights(scene, haze);
  const posters = buildPosters(scene);
  const jumbo = buildJumbotron(scene);
  const sparks = buildSparks(scene, glow, haze);
  const ball = await buildDiscoBall(scene, renderer, glow, haze);

  // Give the booth's metalwork something to reflect.
  for (const mat of parts.metalMats) {
    mat.envMap = ball.envMap;
    mat.needsUpdate = true;
  }

  /**
   * The Reflector re-renders the whole scene from a mirrored camera. Additive,
   * depth-write-free haze does not survive that second pass intact — it comes
   * back as opaque black patches across the floor. Hiding the haze while the
   * reflection renders fixes it, and is what you'd want anyway: a real light
   * shaft is not a solid object, so it has no business having a mirror image.
   */
  const mirrorBefore = parts.mirror.onBeforeRender;
  parts.mirror.onBeforeRender = function (...args) {
    for (const h of haze) h.visible = false;
    mirrorBefore.apply(this, args);
    for (const h of haze) h.visible = true;
  };

  let frame = 0;

  return {
    ...parts,
    ball,
    jumbotronPlay: () => jumbo.video.play().catch(() => {}),

    /**
     * `env` carries the intro dials — env.power (house lights) and env.ignite
     * (the floor wavefront), each 0→1 and each pinned at 1 well before the
     * intro ends, so by handover nothing here is still in motion.
     */
    update(t, g, dt, env) {
      frame++;
      // the decks actually turn, at a believable 33⅓-ish crawl
      for (const p of parts.platters) p.rotation.y = t * 3.5;
      tiles.update(g, env);
      lights.update(t, g, env);
      posters.update(g, env);
      jumbo.update(g, env);
      sparks.update(t, g, dt, env);
      ball.update(t, g, env, frame);
    },
  };
}

/* ------------------------------------------------------------------ room -- */

function buildRoom(scene, parts) {
  // Wet-looking mirror floor. This is what sells the club — every light, every
  // Pikachu and the ball itself get a second life in the reflection.
  const mirror = new Reflector(new THREE.PlaneGeometry(ROOM_R * 2, ROOM_R * 2), {
    textureWidth: 1024,
    textureHeight: 1024,
    color: 0x2b2848,
  });
  mirror.rotation.x = -Math.PI / 2;
  scene.add(mirror);
  parts.mirror = mirror;

  // Reflector uses its own shader, so shadows need a dedicated receiver.
  const shadowCatcher = new THREE.Mesh(
    new THREE.PlaneGeometry(FLOOR_SPAN, FLOOR_SPAN),
    new THREE.ShadowMaterial({ opacity: 0.45 })
  );
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.y = 0.006;
  shadowCatcher.receiveShadow = true;
  scene.add(shadowCatcher);

  // Enclosing shell so the void has a floor-to-ceiling gradient instead of
  // reading as flat black.
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(ROOM_R, ROOM_R, CEIL_Y + 8, 64, 1, true),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        uTop: { value: new THREE.Color(0x241546) },
        uBottom: { value: new THREE.Color(0x080418) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop; uniform vec3 uBottom;
        varying vec2 vUv;
        void main() {
          vec3 c = mix(uBottom, uTop, pow(vUv.y, 1.4));
          // faint vertical pilasters, just enough to give the walls a scale
          c += 0.022 * pow(abs(sin(vUv.x * 96.0)), 26.0);
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    })
  );
  wall.position.y = (CEIL_Y + 8) / 2 - 4;
  scene.add(wall);

  // ceiling truss the ball hangs from
  const truss = new THREE.Mesh(
    new THREE.TorusGeometry(7.2, 0.09, 8, 64),
    new THREE.MeshStandardMaterial({ color: 0x14121f, roughness: 0.7, metalness: 0.6 })
  );
  truss.rotation.x = Math.PI / 2;
  truss.position.y = CEIL_Y - 1.2;
  scene.add(truss);

  const cap = new THREE.Mesh(
    new THREE.CircleGeometry(ROOM_R, 48),
    new THREE.MeshBasicMaterial({ color: 0x0a0620 })
  );
  cap.rotation.x = Math.PI / 2;
  cap.position.y = CEIL_Y + 3;
  scene.add(cap);

  // DJ riser — lower now, so the booth in front of it can stand on the floor
  const riser = new THREE.Mesh(
    new THREE.CylinderGeometry(1.9, 2.15, RISER_H, 32),
    new THREE.MeshStandardMaterial({ color: 0x191430, roughness: 0.5, metalness: 0.35 })
  );
  riser.position.set(0, RISER_H / 2, DJ_Z);
  riser.receiveShadow = true;
  riser.castShadow = true;
  scene.add(riser);

  const riserGlow = new THREE.Mesh(
    new THREE.TorusGeometry(2.0, 0.05, 8, 48),
    new THREE.MeshBasicMaterial({ color: PALETTE.cyan })
  );
  riserGlow.rotation.x = Math.PI / 2;
  riserGlow.position.set(0, RISER_H + 0.01, DJ_Z);
  scene.add(riserGlow);
  parts.riserGlow = riserGlow;

  // decks: two platters that spin behind the DJ
  /**
   * The booth is a solid console standing ON THE FLOOR, not a floating slab.
   * Its body runs from y=0 up to the worktop, and the DJ stands behind it on
   * the (now lower) riser so his hands land naturally on the platters.
   */
  const decks = new THREE.Group();
  const platters = [];

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(DECK_W, DECK_Y, DECK_D),
    // Brushed dark metal. Metalness stays under 1 so the base colour still
    // contributes — a fully metallic surface in a dark room reflects nothing
    // and renders black.
    new THREE.MeshStandardMaterial({
      color: 0x3a3658,
      roughness: 0.38,
      metalness: 0.75,
      envMapIntensity: 2.0,
    })
  );
  body.position.set(0, DECK_Y / 2, DECK_Z); // centred, so it sits exactly on y=0
  body.castShadow = true;
  body.receiveShadow = true;
  decks.add(body);

  const top = new THREE.Mesh(
    new THREE.BoxGeometry(DECK_W + 0.12, 0.1, DECK_D + 0.12),
    // Polished chrome worktop. envMapIntensity is pushed hard because the only
    // thing there is to reflect is a dim club.
    new THREE.MeshStandardMaterial({
      color: 0xc8d0e2,
      roughness: 0.2,
      metalness: 0.85,
      envMapIntensity: 3.5,
    })
  );
  top.position.set(0, DECK_Y + 0.05, DECK_Z);
  top.castShadow = true;
  decks.add(top);

  for (const dx of [-PLATTER_DX, PLATTER_DX]) {
    const platter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 0.06, 28),
      new THREE.MeshStandardMaterial({ color: 0x0b0b12, roughness: 0.35, metalness: 0.85 })
    );
    platter.position.set(dx, DECK_Y + 0.13, DECK_Z);
    const label = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 0.075, 20),
      new THREE.MeshStandardMaterial({
        color: PALETTE.pikachu,
        emissive: PALETTE.pikachu,
        emissiveIntensity: 1.3,
        roughness: 0.4,
      })
    );
    label.position.copy(platter.position);
    decks.add(platter, label);
    platters.push(platter, label);
  }

  // glowing lip along the front face so the console reads from the floor
  const lip = new THREE.Mesh(
    new THREE.BoxGeometry(DECK_W + 0.02, 0.06, 0.06),
    new THREE.MeshBasicMaterial({ color: PALETTE.magenta, toneMapped: false })
  );
  lip.position.set(0, DECK_Y - 0.1, DECK_Z + DECK_D / 2 + 0.02);
  decks.add(lip);

  scene.add(decks);
  /** Where the DJ's hands need to land, in world space. */
  parts.deckAnchor = { y: DECK_Y + 0.16, z: DECK_Z, dx: PLATTER_DX };
  // Metal needs something to reflect; createWorld hands these the disco ball's
  // cube map once it exists, otherwise they render as flat black slabs.
  parts.metalMats = [body.material, top.material];
  parts.decks = decks;
  parts.platters = platters;
}

/* ------------------------------------------------------------ tile floor -- */

function buildTileFloor(scene) {
  const size = FLOOR_SPAN / TILES;
  const geo = new THREE.PlaneGeometry(size * 0.93, size * 0.93); // 7% grout gap
  geo.rotateX(-Math.PI / 2);

  const mesh = new THREE.InstancedMesh(
    geo,
    // NOT vertexColors: three enables USE_INSTANCING_COLOR from `instanceColor`
    // on its own. Setting vertexColors as well makes the shader also look for a
    // per-vertex `color` attribute, which this geometry doesn't have — WebGL
    // then feeds it (0,0,0) and every tile multiplies out to black.
    new THREE.MeshBasicMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
    TILES * TILES
  );
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

  const dummy = new THREE.Object3D();
  const cells = [];
  let n = 0;
  for (let ix = 0; ix < TILES; ix++) {
    for (let iz = 0; iz < TILES; iz++) {
      const x = (ix - (TILES - 1) / 2) * size;
      const z = (iz - (TILES - 1) / 2) * size;
      dummy.position.set(x, 0.014, z);
      dummy.updateMatrix();
      mesh.setMatrixAt(n, dummy.matrix);
      cells.push({ x, z, d: Math.hypot(x, z), checker: (ix + iz) % 2 });
      n++;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  scene.add(mesh);

  const palette = LIGHT_COLORS.map((c) => new THREE.Color(c));
  const col = new THREE.Color();

  return {
    update(g, env) {
      const beatHit = g.pulse(1, 0, 2.0);
      const bar = Math.floor(g.beats / 4);
      // Intro: a wavefront of light races out from under the ball. Tiles inside
      // radius R are lit, tiles outside are dark, with a soft 4-unit edge.
      const R = env.ignite * FLOOR_SPAN;

      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        // The checker splits the floor into two interleaved colours that hold
        // for a bar, so it reads as an actual tiled floor rather than noise.
        // The alternate square is both a different hue AND dimmer — hue alone
        // isn't enough, since neighbouring palette entries can wash together.
        const isA = c.checker === 1;
        const base = palette[(isA ? bar : bar + 2) % palette.length];
        // ripple travelling outward from under the ball, one cycle per bar
        const ring = 0.5 + 0.5 * Math.sin(c.d * 0.8 - (TAU * g.beats) / 4);
        // never drops to black — every tile stays lit, it just breathes
        let a = 0.42 + 0.58 * Math.pow(ring, 1.6);
        a *= isA ? 1 : 0.5;
        a *= 0.58 + 0.52 * beatHit;
        a *= smoothstep(R, R - 4, c.d);
        // fall off toward the walls so the dancefloor has an edge
        a *= 1 - smoothstep(8, FLOOR_SPAN * 0.55, c.d) * 0.6;
        col.copy(base).multiplyScalar(a * 2.3);
        mesh.instanceColor.setXYZ(i, col.r, col.g, col.b);
      }
      mesh.instanceColor.needsUpdate = true;
    },
  };
}

/* ---------------------------------------------------------------- lights -- */

function buildLights(scene, haze) {
  // Ambient/hemisphere are flat multipliers on albedo — at 1.0 they alone blow
  // the character out to white, so they stay low and the spots do the work.
  scene.add(new THREE.AmbientLight(0x4436a0, 0.18));
  const hemi = new THREE.HemisphereLight(0x5c49b8, 0x140f2e, 0.22);
  scene.add(hemi);

  // Front key so the crew always reads as Pikachu-yellow, never silhouettes.
  // Intensity is candela against 1/r^decay: ~10 units away at decay 1.1 costs
  // roughly 12x, so 22 lands a little over full exposure on the front row.
  const key = new THREE.SpotLight(0xfff1cf, 22, 42, 0.7, 0.6, 1.1);
  key.position.set(0.5, 8.5, 11);
  key.target.position.set(0, 1.2, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0015;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 30;
  scene.add(key, key.target);

  // Four colour movers on the truss, sweeping the floor.
  const movers = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 0.4;
    const light = new THREE.SpotLight(LIGHT_COLORS[i], 20, 36, 0.36, 0.85, 1.2);
    light.position.set(Math.cos(a) * 6.6, CEIL_Y - 1.4, Math.sin(a) * 6.6);
    light.target.position.set(0, 0, 0);
    scene.add(light, light.target);

    // Narrow shaft — a wide cone reads as a flat polygon, not as light.
    const beam = makeBeam(14, 0.5, LIGHT_COLORS[i]);
    beam.material.uniforms.uOpacity.value = 0.1;
    beam.position.copy(light.position);
    scene.add(beam);
    haze.push(beam);

    movers.push({ light, beam, a, base: light.intensity });
  }

  // The ball's own lamp — small, very bright, catches the bloom hard.
  const core = new THREE.PointLight(0xffffff, 14, 30, 1.6);
  core.position.set(0, BALL_Y, 0);
  scene.add(core);

  // A dedicated cool spot on the booth. Without it the DJ sits in the darkest
  // part of the room — the movers all sweep the dancefloor, not the back wall.
  const booth = new THREE.SpotLight(0xcfe4ff, 6, 16, 0.42, 0.7, 1.2);
  booth.position.set(0, 5.2, DJ_Z + 2.6);
  booth.target.position.set(0, 0.9, DJ_Z);
  scene.add(booth, booth.target);

  const _dir = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);

  return {
    update(t, g, env) {
      const hit = g.pulse(1, 0, 2.2);
      const p = env.power;
      key.intensity = lerp(6, 22, p) * (0.85 + 0.2 * hit);
      core.intensity = p * (9 + 7 * hit);
      // breathes with the beat, but never drops out — the booth stays readable
      booth.intensity = p * (5 + 2 * hit);

      movers.forEach((m, i) => {
        // Lissajous sweep, both periods divide the loop, so it repeats cleanly
        const tx = Math.sin((TAU * g.beats) / 8 + i * 1.7) * 7.5;
        const tz = Math.cos((TAU * g.beats) / 16 + i * 2.3) * 7.5;
        m.light.target.position.set(tx, 0, tz);
        m.light.target.updateMatrixWorld();

        // strobe: each mover takes a different beat of the bar
        const own = g.pulse(4, i, 3.2);
        m.light.intensity = p * m.base * (0.35 + 1.15 * own);

        // point the visible shaft at the same spot the light is aimed at
        _dir.set(tx, 0, tz).sub(m.beam.position).normalize();
        m.beam.quaternion.setFromUnitVectors(_up, _dir);
        m.beam.material.uniforms.uOpacity.value = p * (0.012 + 0.045 * own);
      });
    },
  };
}

/* ------------------------------------------------------------ disco ball -- */

async function buildDiscoBall(scene, renderer, glowTex, haze) {
  const gltf = await new GLTFLoader().loadAsync('/models/disco_ball.glb');
  const model = gltf.scene;

  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  const radius = 1.4;
  model.scale.setScalar((radius * 2) / size.y);
  model.position.y = 0;

  // Live reflections. A 128px cube map updated every few frames is plenty for
  // something this shiny and this busy — you read the colours, not the detail.
  const cubeRT = new THREE.WebGLCubeRenderTarget(128, { generateMipmaps: true });
  cubeRT.texture.minFilter = THREE.LinearMipmapLinearFilter;
  const cubeCam = new THREE.CubeCamera(0.3, 60, cubeRT);

  const ballMats = [];
  model.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    ballMats.push(m);
    if (/01_-_Default/.test(m.name)) {
      // the mirrored facets
      m.color = new THREE.Color(0xffffff);
      m.metalness = 1.0;
      m.roughness = 0.04;
      m.envMap = cubeRT.texture;
      m.envMapIntensity = 3.0;
      // never let a facet fall to pure black — a mirror ball should always be
      // catching *something*
      m.emissive = new THREE.Color(0x2a1f4a);
      m.emissiveIntensity = 1.0;
    } else {
      // the darker frame between them
      m.color = new THREE.Color(0x2a2a35);
      m.metalness = 0.95;
      m.roughness = 0.35;
      m.envMap = cubeRT.texture;
      m.envMapIntensity = 0.9;
    }
    m.needsUpdate = true;
  });

  const rig = new THREE.Group(); // spins
  rig.add(model);

  const ballGroup = new THREE.Group(); // positioned, doesn't spin
  ballGroup.position.set(0, BALL_Y, 0);
  ballGroup.add(rig);
  cubeCam.position.copy(ballGroup.position);
  scene.add(cubeCam);

  // Hanging chain. Geometry is anchored at its base (the ball centre) so the
  // drop-in can just scale it on Y and keep it pinned to the ceiling.
  const CHAIN_LEN = CEIL_Y - BALL_Y;
  const chainGeo = new THREE.CylinderGeometry(0.035, 0.035, CHAIN_LEN, 8);
  chainGeo.translate(0, CHAIN_LEN / 2, 0);
  const chain = new THREE.Mesh(
    chainGeo,
    new THREE.MeshStandardMaterial({ color: 0x2c2a3a, roughness: 0.5, metalness: 0.9 })
  );
  ballGroup.add(chain);

  // Shafts of light. They live on the spinning rig, so they sweep the room.
  const beams = new THREE.Group();
  const BEAM_COUNT = 34;
  for (let i = 0; i < BEAM_COUNT; i++) {
    // fibonacci sphere, biased downward — a real ball throws most light down
    const y = 0.5 - (i / (BEAM_COUNT - 1)) * 1.45;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * 2.399963;
    const dir = new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r).normalize();

    const beam = makeBeam(22, 0.2, LIGHT_COLORS[i % LIGHT_COLORS.length]);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    beam.userData.phase = i / BEAM_COUNT;
    beams.add(beam);
  }
  rig.add(beams);
  haze.push(beams);

  // sparkles on the surface of the ball
  const glints = new THREE.Group();
  for (let i = 0; i < 44; i++) {
    const y = 1 - (i / 43) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * 2.399963;
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: LIGHT_COLORS[i % LIGHT_COLORS.length],
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0,
      })
    );
    s.position.set(Math.cos(th) * r, y, Math.sin(th) * r).multiplyScalar(radius * 1.02);
    s.userData.phase = (i * 0.137) % 1;
    glints.add(s);
  }
  rig.add(glints);

  scene.add(ballGroup);

  return {
    group: ballGroup,
    rig,
    envMap: cubeRT.texture,
    update(t, g, env, frame) {
      // The ball drops in on its chain and overshoots once. elasticOut is
      // exactly 1 from t = 2.35s onward, so it is dead still long before the
      // loop takes over.
      const drop = elasticOut(clamp((t - 0.45) / 1.9, 0, 1), 1.4);
      ballGroup.position.y = lerp(CEIL_Y + 1.5, BALL_Y, drop);
      cubeCam.position.copy(ballGroup.position);
      chain.scale.y = Math.max(0.001, (CEIL_Y - ballGroup.position.y) / (CEIL_Y - BALL_Y));

      rig.rotation.y = t * 0.42; // continuous, so it never seams
      rig.rotation.z = Math.sin(t * 0.17) * 0.06;

      const p = env.power;
      // The ball must not glow before the house lights come up, or it reads as
      // a floating lamp during the drop-in.
      for (const m of ballMats) m.emissiveIntensity = p;
      const hit = g.pulse(1, 0, 2.0);
      for (const beam of beams.children) {
        const ph = beam.userData.phase;
        const flick = 0.55 + 0.45 * Math.sin(TAU * (g.beats / 8 + ph));
        // 34 additive shafts stack fast — each one has to be very faint
        beam.material.uniforms.uOpacity.value = p * (0.015 + 0.05 * flick * (0.5 + hit));
      }
      for (const s of glints.children) {
        const k = Math.pow(Math.max(0, Math.sin(TAU * (g.beats / 4 + s.userData.phase))), 6);
        s.material.opacity = p * k * 0.95;
        s.scale.setScalar(0.18 + k * 0.5);
      }

      // Refresh reflections a few times a second; hide the ball so it doesn't
      // photograph itself.
      if (frame % 3 === 0) {
        ballGroup.visible = false;
        cubeCam.update(renderer, scene);
        ballGroup.visible = true;
      }
    },
  };
}

/* --------------------------------------------------------------- posters -- */

function buildPosters(scene) {
  const loader = new THREE.TextureLoader();
  const textures = POSTERS.map((_, i) => {
    const tex = loader.load(`/posters/poster-${String(i).padStart(2, '0')}.webp`);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });

  const panels = [];
  const group = new THREE.Group();
  // two arcs flanking the jumbotron
  const angles = [-1.5, -1.15, -0.8, 0.8, 1.15, 1.5];
  angles.forEach((a, i) => {
    const R = 10.6;
    const x = Math.sin(a) * R;
    const z = -Math.cos(a) * R;

    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(3.1, 3.1),
      new THREE.MeshBasicMaterial({ map: textures[i % textures.length], toneMapped: false })
    );
    panel.position.set(x, 3.5, z);
    panel.lookAt(0, 3.0, 0);

    const frame = new THREE.Mesh(
      new THREE.PlaneGeometry(3.34, 3.34),
      new THREE.MeshBasicMaterial({
        color: LIGHT_COLORS[i % LIGHT_COLORS.length],
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
    );
    frame.position.copy(panel.position);
    frame.quaternion.copy(panel.quaternion);
    frame.translateZ(-0.02);

    group.add(frame, panel);
    panels.push({ panel, frame, i, shown: -1 });
  });
  scene.add(group);

  return {
    update(g, env) {
      // Posters cut on the bar. A cut is not a seam — it reads as part of the
      // rhythm — so this is allowed to run on a longer cycle than the loop.
      const slot = Math.floor(g.t / (4 * SEC_PER_BEAT));
      const hit = g.pulse(1, 0, 2.4);
      for (const p of panels) {
        const want = (slot + p.i * 2) % textures.length;
        if (want !== p.shown) {
          p.panel.material.map = textures[want];
          p.panel.material.needsUpdate = true;
          p.shown = want;
        }
        const k = env.power * (0.55 + 0.45 * hit);
        p.panel.material.color.setScalar(0.35 + 0.65 * k);
        p.frame.material.opacity = k * 0.75;
      }
    },
  };
}

/* ------------------------------------------------------------ jumbotron -- */

function buildJumbotron(scene) {
  const video = document.createElement('video');
  video.src = JUMBOTRON_VIDEO;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.crossOrigin = 'anonymous';
  video.play().catch(() => {
    /* a gesture will start it later */
  });

  const videoTex = new THREE.VideoTexture(video);
  videoTex.colorSpace = THREE.SRGBColorSpace;

  // Until the video has actually decoded a frame, show a still instead — an
  // un-started video texture is pure black, which is a big dead rectangle
  // hanging over the back of the room.
  const stillTex = new THREE.TextureLoader().load('/posters/poster-00.webp');
  stillTex.colorSpace = THREE.SRGBColorSpace;

  // Swap to the video only once a real frame has been presented. Anything
  // looser (readyState, !paused) can flip us to an undecoded texture, which
  // renders as a dead black slab on the back wall.
  let videoLive = false;
  if ('requestVideoFrameCallback' in video) {
    video.requestVideoFrameCallback(() => {
      videoLive = true;
    });
  }

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(7.4, 4.16),
    new THREE.MeshBasicMaterial({ map: stillTex, toneMapped: false })
  );
  screen.position.set(0, 4.5, -11.4);
  scene.add(screen);

  const bezel = new THREE.Mesh(
    new THREE.PlaneGeometry(7.8, 4.56),
    new THREE.MeshBasicMaterial({
      color: PALETTE.cyan,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      opacity: 0,
    })
  );
  bezel.position.set(0, 4.5, -11.45);
  scene.add(bezel);

  return {
    video,
    update(g, env) {
      const live =
        videoLive ||
        (!('requestVideoFrameCallback' in video) &&
          video.readyState >= 3 &&
          !video.paused &&
          video.currentTime > 0);
      if (screen.material.map !== videoTex && live) {
        screen.material.map = videoTex;
        screen.material.needsUpdate = true;
      }
      const hit = g.pulse(1, 0, 2.4);
      screen.material.color.setScalar(env.power * (0.6 + 0.5 * hit));
      bezel.material.opacity = env.power * (0.25 + 0.4 * hit);
    },
  };
}

/* ---------------------------------------------------------------- sparks -- */

function buildSparks(scene, glowTex, haze) {
  const COUNT = 700;
  const pos = new Float32Array(COUNT * 3);
  const col = new Float32Array(COUNT * 3);
  const vel = new Float32Array(COUNT);
  const seed = new Float32Array(COUNT);
  const c = new THREE.Color();

  for (let i = 0; i < COUNT; i++) {
    const a = Math.random() * TAU;
    const r = 1.5 + Math.random() * 10;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = Math.random() * 9;
    pos[i * 3 + 2] = Math.sin(a) * r;
    vel[i] = 0.25 + Math.random() * 0.75;
    seed[i] = Math.random();
    c.set(LIGHT_COLORS[i % LIGHT_COLORS.length]);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size: 0.11,
      map: glowTex,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
      toneMapped: false,
      opacity: 0,
    })
  );
  scene.add(points);
  haze.push(points);

  return {
    update(t, g, dt, env) {
      const hit = g.pulse(1, 0, 3.0);
      points.material.opacity = env.power * (0.18 + 0.28 * hit);
      points.material.size = 0.09 + 0.05 * hit;

      const arr = geo.attributes.position.array;
      for (let i = 0; i < COUNT; i++) {
        let y = arr[i * 3 + 1] + vel[i] * dt * (0.6 + hit * 1.4);
        if (y > 9.5) y -= 9.5;
        arr[i * 3 + 1] = y;
        arr[i * 3] += Math.sin(t * 0.6 + seed[i] * TAU) * dt * 0.22;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}
