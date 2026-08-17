import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { applyDance, buildRig } from './dance.js';
import { makeGlowTexture, makePokeball, makeShockwave } from './props.js';
import { DEG, clamp, elasticOut, smoothstep } from './beat.js';
import { CREW_SIZE } from './config.js';
import { DJ_Z, RISER_H } from './world.js';

const TARGET_HEIGHT = 1.55; // metres, roughly Pikachu-if-Pikachu-were-real
const MODEL_YAW = 0; // set once we know which way the mesh faces

// Spawn choreography, in seconds relative to each dancer's own cue.
const FALL = 0.5;
const OPEN_AT = 0.62;
const MATERIALISE_AT = 0.66;
const MATERIALISE_DUR = 0.55;

/**
 * Load the GLB once, normalise it, and hand back a template to clone from.
 * Normalising here (rather than per-dancer) means the fix-ups are paid once.
 */
async function loadTemplate() {
  const gltf = await new GLTFLoader().loadAsync('models/pikachu.glb');
  const raw = gltf.scene;

  raw.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(raw);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const scale = TARGET_HEIGHT / size.y;
  raw.scale.setScalar(scale);
  // drop the feet onto y=0 and centre the silhouette over the origin
  raw.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);

  const template = new THREE.Group();
  template.rotation.y = MODEL_YAW * DEG;
  template.add(raw);

  template.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    // skinned bounds go stale as bones move; culling them causes pop-outs
    o.frustumCulled = false;

    const m = o.material;
    m.roughness = 0.58;
    m.metalness = 0.0;
    // A touch of self-illumination so the character still reads as *Pikachu
    // yellow* in a room lit only by coloured club lights, and so the bloom
    // pass gives him a faint electric halo.
    m.emissiveMap = m.map;
    m.emissive = new THREE.Color(0xffffff);
    m.emissiveIntensity = 0.08;
  });

  return template;
}

/** Two loose rows on the floor, plus the DJ up on the riser at the back. */
function layout(count) {
  const spots = [];
  const rows = [
    { z: 2.55, n: Math.ceil(count / 2), spacing: 2.5 },
    { z: -0.5, n: Math.floor(count / 2), spacing: 2.75 },
  ];
  let i = 0;
  for (const row of rows) {
    const width = (row.n - 1) * row.spacing;
    for (let k = 0; k < row.n; k++, i++) {
      // deterministic jitter so the rows never look like a spreadsheet
      const j = Math.sin(i * 78.233) * 0.5;
      spots.push({
        x: -width / 2 + k * row.spacing + j * 0.45,
        z: row.z + Math.cos(i * 41.7) * 0.42,
        yaw: j * 26, // everyone roughly faces camera, nobody exactly
        isDJ: false,
      });
    }
  }
  spots.push({ x: 0, z: DJ_Z, yaw: 0, y: RISER_H, isDJ: true });
  return spots;
}

export async function createCrew(scene) {
  const template = await loadTemplate();
  const flashTex = makeGlowTexture(128);
  const spots = layout(CREW_SIZE);
  const members = [];
  const pickable = [];

  spots.forEach((spot, i) => {
    const group = new THREE.Group();
    group.position.set(spot.x, spot.y || 0, spot.z);
    group.rotation.y = spot.yaw * DEG;

    // Separate pivot so dance bob/lean never fights the floor placement.
    const pivot = new THREE.Group();
    const model = cloneSkinned(template);
    pivot.add(model);
    group.add(pivot);

    const ball = makePokeball(0.3);
    group.add(ball);

    const wave = makeShockwave(0xfff3c4);
    group.add(wave);

    const flash = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: flashTex,
        color: 0xfff0b0,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0,
      })
    );
    flash.position.y = 0.7;
    group.add(flash);

    scene.add(group);

    const member = {
      i,
      group,
      pivot,
      model,
      ball,
      wave,
      flash,
      rig: buildRig(model),
      isDJ: !!spot.isDJ,
      // whole-beat offsets keep the crew on the same grid but out of lockstep
      offset: [0, 2, 1, 3, 0.5, 2.5, 1.5, 3.5, 1, 3][i % 10],
      style: i % 4,
      seed: i * 1.618,
      hype: 0,
      cue: spot.isDJ ? 1.7 : 2.0 + i * 0.2,
      baseY: spot.y || 0,
      spawnFrom: new THREE.Vector3(
        Math.sin(i * 33.7) * 1.6,
        8.5 + (i % 3) * 0.8,
        Math.cos(i * 21.3) * 1.6
      ),
    };

    model.traverse((o) => {
      if (o.isMesh) {
        o.userData.member = member;
        pickable.push(o);
      }
    });
    members.push(member);
  });

  return {
    members,
    pickable,

    /** Cycle every non-DJ dancer to a new style. */
    setStyle(style) {
      for (const m of members) if (!m.isDJ) m.style = style;
    },

    hype(member) {
      member.hype = 1;
    },

    update(t, g, dt, introDone) {
      for (const m of members) {
        m.hype = Math.max(0, m.hype - dt * 0.85);

        // ---- spawn choreography -------------------------------------------
        const ts = t - m.cue;
        let energy = 1;
        let modelScale = 1;

        if (!introDone) {
          if (ts < 0) {
            m.pivot.visible = false;
            m.ball.visible = false;
            m.wave.visible = false;
            m.flash.material.opacity = 0;
            continue;
          }

          // Poké Ball arcs down and lands on the dancer's mark.
          if (ts < OPEN_AT) {
            m.ball.visible = true;
            const k = clamp(ts / FALL, 0, 1);
            const fall = k * k; // accelerate under gravity
            m.ball.position.lerpVectors(
              m.spawnFrom,
              new THREE.Vector3(0, 0.3, 0),
              Math.min(1, fall)
            );
            if (ts > FALL) {
              // one small hop off the floor before it opens
              const h = (ts - FALL) / (OPEN_AT - FALL);
              m.ball.position.y = 0.3 + Math.sin(h * Math.PI) * 0.22;
            }
            m.ball.rotation.x = ts * 9;
            m.ball.rotation.z = ts * 5;
            m.ball.scale.setScalar(1);
          } else {
            // ...and snaps shut to nothing as the light comes out of it.
            const k = clamp((ts - OPEN_AT) / 0.14, 0, 1);
            m.ball.scale.setScalar(1 - k);
            m.ball.visible = k < 1;
          }

          // shockwave on the floor
          const wk = clamp((ts - OPEN_AT) / 0.5, 0, 1);
          if (wk > 0 && wk < 1) {
            m.wave.visible = true;
            m.wave.position.y = 0.03;
            m.wave.scale.setScalar(0.4 + wk * 3.4);
            m.wave.material.opacity = (1 - wk) * 0.9;
          } else {
            m.wave.visible = false;
          }

          // white pop of light at the moment of release
          const fk = clamp((ts - OPEN_AT) / 0.34, 0, 1);
          m.flash.material.opacity = fk < 1 ? (1 - fk) * 0.95 : 0;
          m.flash.scale.setScalar(1.2 + fk * 5.5);

          const mk = clamp((ts - MATERIALISE_AT) / MATERIALISE_DUR, 0, 1);
          m.pivot.visible = mk > 0;
          modelScale = elasticOut(mk, 1.7);
          energy = smoothstep(0, 1, mk);
        } else {
          m.ball.visible = false;
          m.wave.visible = false;
          m.flash.material.opacity = 0;
          m.pivot.visible = true;
        }

        // ---- the loop itself ----------------------------------------------
        const body = applyDance(m.rig, g, {
          style: m.style,
          offset: m.offset,
          energy,
          hype: m.hype,
          seed: m.seed,
          isDJ: m.isDJ,
        });

        m.pivot.position.y = body.y;
        m.pivot.rotation.set(body.pitch * DEG, body.yaw * DEG, body.roll * DEG);
        m.pivot.scale.setScalar(modelScale);

        // hype ring, reused after the intro is over
        if (m.hype > 0.02) {
          const hk = 1 - m.hype;
          m.wave.visible = true;
          m.wave.position.y = 0.03;
          m.wave.scale.setScalar(0.4 + hk * 3.0);
          m.wave.material.opacity = m.hype * 0.7;
        }
      }
    },
  };
}
