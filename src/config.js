/**
 * Every number worth arguing about lives here.
 *
 * The whole show runs off one musical clock. `BPM` and `LOOP_BEATS` define a
 * loop of exactly LOOP_BEATS beats; every oscillator in the scene is expressed
 * as "one cycle per N beats" where N divides LOOP_BEATS. That is what makes the
 * loop seamless — at the end of the loop every sine is back at the same value
 * and the same slope, so there is no seam to see.
 */

/**
 * Tempo is dictated by the track, not chosen. "Waiting for Tonight" runs at a
 * machine-steady 125 BPM — measured by fitting an impulse train to the kick
 * onset envelope across the whole 4-minute file, where any error accumulates
 * into obvious drift, so the fit is sharp to ~0.02 BPM.
 */
export const BPM = 125;
export const SEC_PER_BEAT = 60 / BPM; // 0.48s exactly
export const LOOP_BEATS = 16; // 4 bars
export const LOOP_SECONDS = LOOP_BEATS * SEC_PER_BEAT; // 7.68s

export const MUSIC = {
  src: 'Waiting for Tonight.mp3',
  /**
   * Where the first beat lands in the file. Playback starts here so visual
   * t=0 sits exactly on a beat, and the dance is locked to the record from
   * the first frame. Nudge by ±SEC_PER_BEAT if you want a different downbeat.
   */
  startAt: 0.398,
  volume: 0.8,
};

/**
 * The intro does NOT have to end on a loop boundary. The loop clock runs from
 * t=0 and the intro is authored as a set of *offsets* on top of it that decay
 * to exactly zero by INTRO_SECONDS. So the handoff is continuous by
 * construction, whatever phase it lands on.
 */
/**
 * 20 beats — 5 bars. The handover doesn't *need* to land on a bar line (the
 * intro converges onto the loop at whatever phase it finishes), but now that
 * there's a record playing with real bar structure, landing it on a downbeat
 * is free and feels deliberate.
 */
export const INTRO_SECONDS = 20 * SEC_PER_BEAT; // 9.6s
export const UI_REVEAL_AT = INTRO_SECONDS - 2.0;

export const CREW_SIZE = 10; // dancers on the floor, plus one DJ

/** Pokémon-first palette. Reds/yellows/blues straight off a Gen-1 box. */
export const PALETTE = {
  pikachu: 0xffcb05,
  pikachuDeep: 0xf5a623,
  cheek: 0xff2d55,
  ballRed: 0xee1515,
  ballDark: 0x1b1b1f,
  blue: 0x3b4cca,
  cyan: 0x35e0ff,
  magenta: 0xff3dbe,
  green: 0x5cff8f,
  night: 0x05030d,
  floor: 0x0b0a18,
};

/** Beam / spotlight colours, cycled around the ceiling rig. */
export const LIGHT_COLORS = [0xffcb05, 0xee1515, 0x3b4cca, 0xff3dbe, 0x35e0ff];

/** Poster wall. Swap these for whatever you want on the club walls. */
export const POSTERS = [
  'Pikachu_holding_blocky_handgun_2K_202608151934.jpeg',
  'Raichu_holding_toy_blaster_rifle_202608152123.jpeg',
  'Mewtwo_smoking_a_blunt_2K_202608151251.jpeg',
  'Snorlax_holding_cash_in_alley_202608151927.jpeg',
  'Meowth_fanning_money_2K_202608152036.jpeg',
  'Gengar_and_Koffing_near_barrel_202608152044.jpeg',
  'Machamp_posing_near_lowrider_car_202608151927.jpeg',
  'Wobbuffet_sitting_at_executive_desk_202608152126.jpeg',
  'Creature_selling_CDs_from_trunk_202608151928.jpeg',
  'Jeweler_holding_chain_for_Garchomp_202608152035.jpeg',
  'its lit.jpeg',
  'kingpin.jpeg',
];

export const JUMBOTRON_VIDEO = '/videos/Purple_creature_performs_backflip_202608141724.mp4';

/** ---------------------------------------------------------------------
 *  The whole site. Two controls and a wordmark — the party is the page.
 *  ------------------------------------------------------------------ */
export const COPY = {
  wordmark: 'THUGGERMON',
  cta: 'ENTER THE PARTY',
};

export const TOKEN = {
  /**
   * Paste the contract / mint address here. While this is empty the button
   * shows a "coming soon" state and copying is disabled, so the page never
   * offers an address that isn't real.
   */
  contract: '5ZNcV7BEe5fvmCpXvLExGN4oCtGZzTeswaDbSuWJpump',
  /** Shown on the button; the full address is what actually gets copied. */
  label: 'CA',
};

export const SOCIAL = {
  x: 'https://x.com/Thuggermon',
  /** Handle, used for the twitter: card attribution tags in index.html. */
  xHandle: '@Thuggermon',
};
