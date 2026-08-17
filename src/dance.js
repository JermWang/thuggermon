import * as THREE from 'three';
import { DEG, TAU, clamp, lerp, smoothstep } from './beat.js';

/**
 * The Pikachu GLB ships a 49-joint skin and *zero* animation clips, so every
 * pose here is authored procedurally against the bone names below.
 *
 * Rig convention: this is an FBX-derived skeleton, so each bone's local +X runs
 * down the length of the bone. That means:
 *   rotate about local X  -> twist / roll along the bone
 *   rotate about local Y  -> swing (yaw-ish)
 *   rotate about local Z  -> bend (pitch-ish)
 * Poses are applied as a delta on top of the captured bind rotation, so a bone
 * we never touch simply stays where the artist left it.
 */
const B = {
  waist: 'Waist_03',
  hips: 'Hips_04',
  spine1: 'Spine1_023',
  spine2: 'Spine2_024',
  head: 'Head_025',
  earL: ['LEar1_027', 'LEar2_028', 'LEar3_029'],
  earR: ['REar1_031', 'REar2_032', 'REar3_033'],
  armL: ['LShoulder_035', 'LArm_036', 'LForeArm_037', 'LHand_038'],
  armR: ['RShoulder_040', 'RArm_041', 'RForeArm_042', 'RHand_043'],
  legL: ['LThigh_07', 'LLeg_08', 'LFoot_09', 'LToe_011'],
  legR: ['RThigh_013', 'RLeg_014', 'RFoot_015', 'RToe_017'],
  tail: ['Tail1_019', 'Tail2_020', 'Tail3_021'],
};

/**
 * The skeleton is MIRRORED across the character's centre line, so a bone on the
 * right does not take the same local rotation as its partner on the left —
 * feeding it the same numbers swings it the wrong way and folds the arm into
 * the torso.
 *
 * Measured, not guessed: posing each left/right chain over 12 random rotations
 * and comparing the shoulder→hand (hip→toe, ear base→tip) vectors, the mirror
 * is (x, y, z) -> (-x, y, -z) for all three pairs. That convention scores below
 * the rig's own bind-pose asymmetry — i.e. it is as symmetric as this skeleton
 * gets — and every other sign combination is measurably worse.
 *
 * So: author every pose in LEFT-side terms and pass `mirror` for the right.
 */
const MIRROR_X = -1;
const MIRROR_Y = 1;
const MIRROR_Z = -1;

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();

/** Snapshot the bind pose so every frame can be authored as a delta from it. */
export function buildRig(model) {
  const bones = {};
  const rest = {};
  model.traverse((o) => {
    if (o.isBone) {
      bones[o.name] = o;
      rest[o.name] = o.quaternion.clone();
    }
  });
  return { bones, rest, names: Object.keys(bones) };
}

/** Return every bone to its bind rotation. Called once per frame, per dancer. */
function resetRig(rig) {
  for (let i = 0; i < rig.names.length; i++) {
    const n = rig.names[i];
    rig.bones[n].quaternion.copy(rig.rest[n]);
  }
}

/**
 * Rotate a bone by (x,y,z) DEGREES in its own local space, on top of bind.
 * Pass `mirror` for any bone on the character's right — see MIRROR_* above.
 */
function pose(rig, name, x, y, z, mirror = false) {
  const bone = rig.bones[name];
  if (!bone) return;
  if (mirror) {
    x *= MIRROR_X;
    y *= MIRROR_Y;
    z *= MIRROR_Z;
  }
  _euler.set(x * DEG, y * DEG, z * DEG);
  _quat.setFromEuler(_euler);
  bone.quaternion.copy(rig.rest[name]).multiply(_quat);
}

/** Pose a whole chain, scaling the amount down as it travels outward. */
function poseChain(rig, chain, x, y, z, falloff = 0.65, mirror = false) {
  let k = 1;
  for (let i = 0; i < chain.length; i++) {
    pose(rig, chain[i], x * k, y * k, z * k, mirror);
    k *= falloff;
  }
}

/* ------------------------------------------------------- arm self-collision */

/**
 * Raise and abduction are NOT independent on this rig. Swinging the shoulder up
 * (z) also sweeps the hand toward the centre line, and past roughly -60° the
 * hand ends up inside the torso — where it z-fights with the belly and the arm
 * appears to vanish.
 *
 * Measured on the model: the torso is ~0.23 half-widths across at belly height
 * (0.30–0.50). Note the shoulder joint itself sits at x=0.107 — i.e. *inside*
 * the torso — so the upper arm is meant to be buried and only the paw shows.
 * What must stay outside is the HAND. The old BOUNCE peak (z=-95, y=-20) put it
 * at x=0.11, well inside the belly, which is the vanishing the eye picks up.
 *
 * Sweeping abduction against raise, the sign of the useful direction FLIPS as
 * the arm comes up, and the mid band is the dangerous part:
 *
 *     z = -50  ->  y = +20  keeps hand x 0.39   (positive abducts)
 *     z = -70  ->  y = -80  keeps hand x 0.26   (negative now abducts; tightest)
 *     z = -95  ->  y = -80  keeps hand x 0.34
 *
 * The limit was measured against the ACTUAL SKINNED MESH, not a proxy: paw and
 * forearm vertices tested against the torso's real surface (nearest torso
 * vertex + its skinned normal), swept across the whole (raise x abduction)
 * space, and repeated under the torso poses every style produces — because the
 * arms hang off the spine while `hips` rotates independently, so the belly
 * swings relative to the arm.
 *
 * Two findings drove this:
 *   - Past about -35 deg of raise there is NO abduction that keeps the paw out.
 *     The shoulder joint sits *inside* the torso, so lifting sweeps the arm
 *     through the belly whichever way it is swung.
 *   - Testing the wrist JOINT is not enough. It stays clear while the paw mesh
 *     around it does not, which is why earlier attempts still glitched.
 *
 * So raise is capped hard and the expressive range lives in abduction, which
 * stays ~65-75 deg wide. Arms swing rather than lift.
 *
 * Measured safe window (margin 0.01), holding across all four styles:
 *     raise -30 -> abduction [ 10, 45]      raise -15 -> [-30, 45]
 *     raise -25 -> [-20, 45]                raise -10 -> [-35, 45]
 *     raise -20 -> [-25, 45]                raise   0 -> [-35, 45]
 *     raise -35 -> nothing is safe
 */
const ARM_Z_MIN = -30;
const ARM_Z_MAX = 5;

/** The table above as a curve, kept a few degrees inside the measured edge. */
function armYWindow(z) {
  return [Math.min(12, -35 + 2.5 * Math.max(0, -z - 12)), 40];
}

/**
 * Pose an arm. Both raise and abduction are clamped into the measured safe
 * region, so no style — present or future — can push the paw into the body.
 */
function poseArm(rig, chain, z, y, falloff = 0.7, mirror = false) {
  const zc = clamp(z, ARM_Z_MIN, ARM_Z_MAX);
  const [lo, hi] = armYWindow(zc);
  poseChain(rig, chain, 0, clamp(y, lo, hi), zc, falloff, mirror);
}

export const STYLES = ['BOUNCE', 'SHUFFLE', 'WAVE', 'SPIN'];

/**
 * Pose one dancer for this frame.
 *
 * @returns body-level transform the caller applies to the dancer's group —
 *          kept out of the skeleton so the feet can leave the floor cleanly.
 */
export function applyDance(rig, g, opts) {
  const {
    style = 0,
    offset = 0, // phase offset in WHOLE beats — fractional offsets still loop,
    //             but whole beats keep the crew locked to the same grid
    energy = 1, // 0..1 fade-in used by the intro
    hype = 0, // 0..1 transient boost from a click
    seed = 0,
    isDJ = false,
  } = opts;

  resetRig(rig);

  // Every oscillator below is read through these, which bake in the dancer's
  // personal offset. `per` must still divide LOOP_BEATS.
  const o = (per, off = 0) => g.o(per, off + offset);
  const co = (per, off = 0) => g.co(per, off + offset);
  const pulse = (per, off = 0, sharp = 2.5) => g.pulse(per, off + offset, sharp);

  const body = { y: 0, yaw: 0, pitch: 0, roll: 0, scale: 1 };
  const E = energy * (1 + hype * 0.85); // hype just cranks the amplitude
  const wob = 1 + 0.12 * Math.sin(seed * 12.9898); // per-dancer size of motion

  const hit = pulse(1, 0, 2.4); // 1 on every beat, decaying between
  const hit2 = pulse(0.5, 0, 3.0); // eighth notes
  const swing = o(2); // alternates each beat
  const sway = o(4); // one cycle per bar
  const drift = o(8); // one cycle per 2 bars

  if (isDJ) {
    // ---- DJ: planted behind the decks, all the motion is upper body -------
    const scratch = o(0.5);
    // kept small deliberately: his hands are resting on hardware, so the body
    // can groove but it must not wander or they slide off the platters
    body.y = 0.015 * hit * E;
    body.yaw = 3 * sway * E;
    body.pitch = 4 * hit * E;

    pose(rig, B.spine2, 0, 0, -8 * hit * E);
    pose(rig, B.head, 0, 10 * sway * E, -16 * hit * E);

    /**
     * Hands planted on the platters. These two angles are solved, not
     * eyeballed: searching shoulder (y, z) against the platter's actual world
     * position puts the hand 0.03 units from the platter centre at (-5, -5)
     * with falloff 0.7. Everything else is a small wobble around that, so the
     * hands stay on the decks instead of hovering beside them.
     */
    const DY = -5;
    const DZ = -5;
    poseChain(rig, B.armL, 0, DY + 3 * o(2) * E, DZ - 4 * hit * E, 0.7);
    poseChain(rig, B.armR, 0, DY + 7 * scratch * E, DZ - 7 * scratch * E, 0.7, true);

    earFlop(rig, hit, o, E * 1.4, 0.16);
    tailWhip(rig, o, E, 0.9);
    return body;
  }

  switch (style) {
    // ---------------------------------------------------------------- BOUNCE
    // The default rave two-step: drop on the beat, rise between, arms pumping
    // on alternate beats.
    case 0: {
      body.y = 0.13 * (1 - hit) * E * wob;
      body.yaw = 7 * sway * E;
      body.roll = 4 * swing * E;
      body.pitch = 3 * hit * E;

      pose(rig, B.hips, 0, 9 * sway * E, 6 * swing * E);
      pose(rig, B.spine1, 0, -5 * sway * E, -7 * hit * E);
      pose(rig, B.spine2, 0, -4 * sway * E, -5 * hit * E);
      pose(rig, B.head, 0, 12 * sway * E, -14 * hit * E);

      // arms pump in opposition — as a forward/back swing, since lift is capped
      const sw = 30 * swing;
      const rz = -10 - 6 * hit; // shallow, so the abduction window stays wide
      poseArm(rig, B.armL, rz * E, (6 + sw) * E, 0.7);
      poseArm(rig, B.armR, rz * E, (6 - sw) * E, 0.7, true);

      // knees absorb the landing
      const squat = 26 * hit * E;
      poseChain(rig, B.legL, 0, 0, squat, 0.9);
      poseChain(rig, B.legR, 0, 0, squat, 0.9, true);

      earFlop(rig, hit, o, E, 0.14);
      tailWhip(rig, o, E, 1);
      break;
    }

    // --------------------------------------------------------------- SHUFFLE
    // Feet skate side to side on eighths while the shoulders counter-rotate.
    case 1: {
      const slide = o(1);
      body.y = 0.05 * (1 - hit2) * E;
      body.yaw = 16 * o(2) * E;
      body.roll = 9 * slide * E;

      pose(rig, B.hips, 0, 14 * slide * E, 10 * co(2) * E);
      pose(rig, B.spine1, 0, -12 * slide * E, 0);
      pose(rig, B.spine2, 0, -8 * slide * E, -4 * hit2 * E);
      pose(rig, B.head, 0, 6 * o(4) * E, -8 * hit2 * E);

      // falloff stays at 0.7 — the safe window was measured at that value
      poseArm(rig, B.armL, -12 * E, (6 - 28 * slide) * E, 0.7);
      poseArm(rig, B.armR, -12 * E, (6 + 28 * slide) * E, 0.7, true);

      poseChain(rig, B.legL, 0, 0, 20 + 26 * Math.max(0, slide) * E, 0.85);
      poseChain(rig, B.legR, 0, 0, 20 + 26 * Math.max(0, -slide) * E, 0.85, true);

      earFlop(rig, hit2, o, E * 1.2, 0.1);
      tailWhip(rig, o, E, 1.3);
      break;
    }

    // ------------------------------------------------------------------ WAVE
    // A travelling wave: hips → spine → shoulder → hand, each link a beat
    // behind the last. Slow, hypnotic, very good in the mirror ball light.
    case 2: {
      body.y = 0.06 * (1 + o(4)) * E;
      body.yaw = 12 * o(8) * E;
      body.roll = 6 * o(4, 0.5) * E;

      pose(rig, B.hips, 0, 10 * o(4) * E, 8 * o(4, 0.25) * E);
      pose(rig, B.spine1, 0, 8 * o(4, 0.5) * E, 10 * o(4, 0.5) * E);
      pose(rig, B.spine2, 0, 6 * o(4, 0.75) * E, 9 * o(4, 0.75) * E);
      pose(rig, B.head, 0, 14 * o(4, 1) * E, -10 * o(4, 1) * E);

      // the ripple: each joint reads the same wave, one quarter-bar later
      // The ripple travels shoulder→hand through the spine chain above; the
      // arms carry it as a raise, one running a beat behind the other so it
      // reads as crossing the body rather than as a symmetric flap.
      const rip = (i) => Math.sin((TAU * (g.beats - offset - i * 0.5)) / 4);
      const a = rip(0) * E;
      const b = rip(2) * E;
      poseArm(rig, B.armL, (-14 - 10 * a) * E, (4 + 30 * a) * E, 0.7);
      poseArm(rig, B.armR, (-14 - 10 * b) * E, (4 + 30 * b) * E, 0.7, true);

      poseChain(rig, B.legL, 0, 0, 12 + 8 * o(4) * E, 0.9);
      poseChain(rig, B.legR, 0, 0, 12 - 8 * o(4) * E, 0.9, true);

      earFlop(rig, hit * 0.5, o, E * 1.6, 0.3);
      tailWhip(rig, o, E, 0.7);
      break;
    }

    // ------------------------------------------------------------------ SPIN
    // Two full revolutions per loop, so the yaw wraps exactly on the seam.
    default: {
      body.yaw = 720 * g.saw(8, offset) * energy;
      body.y = 0.16 * (1 - hit) * E;
      body.roll = 10 * E;
      body.pitch = -6 * E;

      pose(rig, B.hips, 0, 0, 10 * swing * E);
      pose(rig, B.spine2, 0, 0, -10 * hit * E);
      pose(rig, B.head, 0, -18 * o(8) * E, -8 * hit * E);

      // arms swept back and out, like a spinning skater
      poseArm(rig, B.armL, -26 * E, 34 * E, 0.7);
      poseArm(rig, B.armR, -26 * E, 34 * E, 0.7, true);

      poseChain(rig, B.legL, 0, 0, 16 * hit * E, 0.9);
      poseChain(rig, B.legR, 0, 0, 40 + 20 * hit * E, 0.9, true);

      earFlop(rig, hit, o, E * 1.8, 0.22);
      tailWhip(rig, o, E, 1.6);
      break;
    }
  }

  // A jump on top of everything when the dancer gets clicked.
  body.y += hype * 0.35 * Math.max(0, Math.sin(hype * Math.PI));
  return body;
}

/**
 * Ears are the best part of the character, so they get their own solver: they
 * lag the body, then overshoot, then settle — floppy secondary motion.
 */
function earFlop(rig, hit, o, amount, lag) {
  const a = amount;
  for (let i = 0; i < 3; i++) {
    const k = 1 - i * 0.22; // the tip moves most
    const late = lag * (i + 1);
    const flop = -22 * k * a * o(2, late);
    const snap = -14 * k * a * hit;
    pose(rig, B.earL[i], 0, flop, snap);
    pose(rig, B.earR[i], 0, flop, snap, true);
  }
}

/** Tail whip — each segment trails the one before it. */
function tailWhip(rig, o, amount, speed) {
  const per = speed > 1.2 ? 1 : 2; // still a divisor of LOOP_BEATS
  for (let i = 0; i < B.tail.length; i++) {
    const k = 1 + i * 0.35;
    pose(rig, B.tail[i], 0, 20 * k * amount * o(per, i * 0.18), 10 * amount * o(4, i * 0.2));
  }
}
