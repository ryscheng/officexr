/**
 * Renderer-tweaker bag accepted by `<Scene>`: the renderer's sections of
 * the SDK's `WorldConstants`, plus optional mugshot-only overrides that
 * are never part of the world's constants.
 */
import {
  DEFAULT_WORLD_CONSTANTS,
  type BackgroundConstants,
  type FixedCameraConstants,
  type LightingConstants,
  type ProximityConstants,
} from '@officexr/sdk';

export type { AuxLightType } from '@officexr/sdk';
export type ProximityViewConfig = ProximityConstants;
export type BackgroundViewConfig = BackgroundConstants;

export type LightingViewConfig = LightingConstants & {
  /** Additive omnidirectional `<ambientLight>` intensity on top of
   * the sun + hemisphere. Distinct from `ambientIntensity` (which
   * drives the hemisphere) — this lifts shadowed faces uniformly
   * without changing sky/ground tint. Mugshot mode exposes this as
   * a slider so a capture session can crank visibility up without
   * touching the artistic lighting. Optional; undefined / 0 leaves
   * the scene unchanged. */
  ambientFillIntensity?: number;
};

export type FixedCameraViewConfig = FixedCameraConstants & {
  /** Optional direct XZ distance (m) from character to camera. When
   * present, overrides the screen-fraction derivation in
   * `CameraRig` and pins the camera at exactly this distance with
   * zero lateral leash. */
  distanceM?: number;
  /** Optional world-space point the fixed camera orbits AND looks
   * at. When undefined, the camera tracks the local player's
   * render position (gameplay default). Set to `[0, 0, 0]` by
   * Mugshot so framing is independent of where the character
   * happens to stand — two characters at different y heights
   * frame identically. */
  lookAt?: readonly [number, number, number];
};

export interface ViewConfig {
  proximity: ProximityViewConfig;
  lighting: LightingViewConfig;
  background: BackgroundViewConfig;
  fixedCamera: FixedCameraViewConfig;
}

export const DEFAULT_VIEW_CONFIG: ViewConfig = {
  proximity: DEFAULT_WORLD_CONSTANTS.proximity,
  lighting: DEFAULT_WORLD_CONSTANTS.lighting,
  background: DEFAULT_WORLD_CONSTANTS.background,
  fixedCamera: DEFAULT_WORLD_CONSTANTS.fixedCamera,
};
