/**
 * Renderer-tweaker bag accepted by `<Scene>`. Lives here (in the
 * world package) because Scene's prop interface needs it, but the
 * editing UI for these fields lives in the studio package
 * (`packages/studio/src/panels/world/`).
 *
 * The studio owns the React state for this bag (with localStorage
 * persistence) and passes the current value into Scene each render.
 * Scene reads from `viewConfig.proximity.discRadius` etc. instead
 * of calling a Leva hook internally — the renderer stays UI-free
 * (SOLID: world doesn't depend on a UI library).
 */
export type AuxLightType = 'none' | 'spot' | 'point';

export interface ProximityViewConfig {
  sensorRadius: number;
  outerRadius: number;
  enterDebounceMs: number;
  discRadius: number;
  pulseSpeed: number;
  intensity: number;
  enteringColor: string;
  enteredColor: string;
  exitingColor: string;
  meetingBorderInset: number;
  meetingBorderOutset: number;
  sparkleSpeed: number;
  sparkleFloatHeight: number;
  conversationDistance: number;
  conversationHeight: number;
  sparkleSize: number;
}

export interface LightingViewConfig {
  sunPosition: [number, number, number];
  sunColor: string;
  sunIntensity: number;
  /** Intensity of the hemisphere fill light (sky-tinted from above,
   * ground-tinted from below). Drives the natural-outdoor look. */
  ambientIntensity: number;
  castShadow: boolean;
  shadowRange: number;
  shadowMapSize: number;
  shadowBias: number;
  shadowNormalBias: number;
  auxLightType: AuxLightType;
  auxIntensity: number;
  auxDistance: number;
  auxAngle: number;
  auxPenumbra: number;
  auxDecay: number;
  showSunDisc: boolean;
  sunDiscRadius: number;
  sunDiscIntensity: number;
  /** Additive omnidirectional `<ambientLight>` intensity on top of
   * the sun + hemisphere. Distinct from `ambientIntensity` (which
   * drives the hemisphere) — this lifts shadowed faces uniformly
   * without changing sky/ground tint. Mugshot mode exposes this as
   * a slider so a capture session can crank visibility up without
   * touching the artistic lighting. Optional; undefined / 0 leaves
   * the scene unchanged. */
  ambientFillIntensity?: number;
}

export interface BackgroundViewConfig {
  topColor: string;
  bottomColor: string;
}

export interface FixedCameraViewConfig {
  azimuthDeg: number;
  pitchDeg: number;
  height: number;
  maxOnScreenFrac: number;
  minOnScreenFrac: number;
  lateralFrac: number;
  fov: number;
  movementYawOffsetDeg: number;
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
}

export interface ViewConfig {
  proximity: ProximityViewConfig;
  lighting: LightingViewConfig;
  background: BackgroundViewConfig;
  fixedCamera: FixedCameraViewConfig;
}
