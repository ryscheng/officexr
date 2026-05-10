/**
 * World/scene defaults for the debug-app.
 *
 * Tweak `WORLD.gridSize` to change the floor footprint. The renderer rebuilds
 * its instanced cube buffers when this changes.
 */
export const CUBE_SIZE = 2; // KayKit BlockBits cubes are 2×2×2 units

export const WORLD = {
  /** Floor side length in cubes (square grid). */
  gridSize: 50,
  /** Number of stone layers placed beneath the surface. */
  stoneLayers: 2,
};

export const PLAYER_HEIGHT = 1.7;
export const EYE_HEIGHT = 1.6;

/** Default fixed-camera tweakables, exposed via the debug panel (Leva). */
export const FIXED_CAMERA_DEFAULTS = {
  /** Compass heading FROM character TO camera. 0 = N, 180 = S; 202.5 = SSW. */
  azimuthDeg: 202.5,
  /** Camera pitch (degrees). Negative = looking down. The camera's
   * orientation is set entirely from azimuth + pitch and never tracks the
   * character — moving the player does NOT rotate the camera. */
  pitchDeg: -35,
  /** Constant vertical offset (world units) of the camera above the character. */
  height: 25,
  /** Largest fraction of screen height the character may occupy before the
   * camera retreats (sets the *near* leash). */
  maxOnScreenFrac: 0.25,
  /** Smallest fraction of screen height the character may shrink to before
   * the camera follows (sets the *far* leash). */
  minOnScreenFrac: 0.08,
  /** Lateral leash as a fraction of the view's half-width at the far depth.
   * 0.4 ≈ character may drift up to 40 % of the way to the screen edge. */
  lateralFrac: 0.4,
  fov: 50,
};

/** Used by the screen-fraction → distance formula. */
export const CHAR_HEIGHT_M = 1.8;

export const CHARACTERS = [
  'Barbarian',
  'Knight',
  'Mage',
  'Ranger',
  'Rogue',
  'Rogue_Hooded',
] as const;
export type CharacterName = (typeof CHARACTERS)[number];

export type CameraMode = 'first-person' | 'third-person' | 'fixed';
export const CAMERA_MODES: readonly CameraMode[] = [
  'first-person',
  'third-person',
  'fixed',
];
