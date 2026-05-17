/**
 * Renderer constants. Map Editor maps are the only source of visible
 * cubes; there is no longer a default-floor or playable-area concept
 * here — `<MapColliders>` drives physics from `state.worldObjects`.
 */
// 0.5 m grid — four voxels per KayKit 2×2×2 block (was 2 before v4 migration)
export const VOXEL_SIZE = 0.5;

/** @deprecated Use VOXEL_SIZE */
export const CUBE_SIZE = VOXEL_SIZE;

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

// CHARACTERS lives in `../characters/registry.ts` now (it's the canonical
// model registry — studio's CharacterMode and the per-character config
// resolver both read it). Re-exported here so the renderer's existing
// imports keep working.
export { CHARACTERS, type CharacterName } from '../characters/registry.ts';

export type CameraMode =
  | 'first-person'
  | 'third-person'
  | 'fixed'
  | 'top-down'
  | 'free-fly';
export const CAMERA_MODES: readonly CameraMode[] = [
  'first-person',
  'third-person',
  'fixed',
  'top-down',
  'free-fly',
];

/** Defaults for the top-down editor camera (studio's Scene mode).
 * Extends the FIXED_CAMERA_DEFAULTS pattern: pitch is straight down,
 * altitude is high enough to see a 20×20 grid by default. */
export const TOP_DOWN_CAMERA_DEFAULTS = {
  pitchDeg: -89.9,
  azimuthDeg: 0,
  height: 60,
  fov: 45,
};

/** Free-fly camera defaults — starting pose for the Scenes editor.
 * Pitched down ~30° so the user starts looking at the build platform
 * from a comfortable elevated angle. */
export const FREE_FLY_DEFAULTS = {
  position: [0, 25, 25] as [number, number, number],
  yaw: 0,
  pitch: -0.7,
  fov: 60,
  /** WASD speed in metres/sec at base; Shift multiplies. */
  moveSpeed: 12,
  shiftMultiplier: 3,
  /** Mouse drag → radians; tuned to feel like a comfortable orbit. */
  rotateSensitivity: 0.005,
  /** Wheel delta → world units per notch. */
  dollySensitivity: 1.5,
};
