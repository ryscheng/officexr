import type { BotMode } from '@officexr/world/bot';

export type AuxLightType = 'none' | 'spot' | 'point';

/**
 * Single canonical shape for every renderer-tweaker value previously
 * scattered across 8 Leva panels. The studio's `useStudioSettings`
 * hook owns this in React state (with localStorage persistence);
 * `<Scene>` takes it as a `viewConfig` prop.
 *
 * Two flavours of value live here:
 *
 *   - Renderer-local: visuals only (sun-disc, fog colours, fixed-
 *     camera angles). Not synced to peers.
 *   - Server-relevant: gameplay knobs (animation speeds, proximity
 *     radii) — the panel components also push these into
 *     `actions.setWorldSettings(...)` so peers / bots stay in sync.
 *     They live here in addition so the panel UI can stay fully
 *     controlled even when no SDK store is mounted yet.
 */
export interface ViewConfig {
  animation: AnimationSettings;
  proximity: ProximitySettings;
  lighting: LightingSettings;
  background: BackgroundSettings;
  fixedCamera: FixedCameraSettings;
  bot: BotSettings;
}

export interface AnimationSettings {
  idleSpeed: number;
  walkSpeed: number;
  runSpeed: number;
  turnSpeed: number;
  playerSpeed: number;
  runMultiplier: number;
  movementBlockThreshold: number;
}

export interface ProximitySettings {
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

export interface LightingSettings {
  sunPosition: [number, number, number];
  sunColor: string;
  sunIntensity: number;
  /** Intensity of the hemisphere fill light (sky-tinted from above,
   * ground-tinted from below). */
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
  /** Additive omnidirectional ambient on top of sun + hemisphere.
   * Mugshot exposes this so a capture session can crank visibility
   * without affecting the artistic lighting. Optional. */
  ambientFillIntensity?: number;
}

export interface BackgroundSettings {
  topColor: string;
  bottomColor: string;
}

export interface FixedCameraSettings {
  azimuthDeg: number;
  pitchDeg: number;
  height: number;
  maxOnScreenFrac: number;
  minOnScreenFrac: number;
  lateralFrac: number;
  fov: number;
  movementYawOffsetDeg: number;
  /** Optional direct XZ distance (m) from character to camera. Set
   * by Mugshot mode for deterministic framing; absent in normal
   * gameplay (the screen-fraction derivation handles it). */
  distanceM?: number;
  /** Optional world-space anchor for the fixed camera. When set,
   * the camera orbits AND looks at this point instead of the
   * local player. Used by Mugshot mode (set to `[0, 0, 0]`) so
   * framing is character-independent. */
  lookAt?: readonly [number, number, number];
}

export interface BotSettings {
  count: number;
  mode: BotMode;
}

import { FIXED_CAMERA_DEFAULTS } from '@officexr/world/renderer';

/** Bundled defaults — match the previous Leva hook initial values exactly. */
export const DEFAULT_VIEW_CONFIG: ViewConfig = {
  animation: {
    idleSpeed: 1,
    walkSpeed: 1,
    runSpeed: 1,
    turnSpeed: 16,
    playerSpeed: 3,
    runMultiplier: 2,
    movementBlockThreshold: 0.9,
  },
  proximity: {
    sensorRadius: 3,
    outerRadius: 6,
    enterDebounceMs: 500,
    discRadius: 1.6,
    pulseSpeed: 0.8,
    intensity: 1,
    enteringColor: '#ffd24a',
    enteredColor: '#7be67b',
    exitingColor: '#ff8c42',
    meetingBorderInset: 0.05,
    meetingBorderOutset: 0.05,
    sparkleSpeed: 1.5,
    sparkleFloatHeight: 1.5,
    conversationDistance: 7,
    conversationHeight: 5,
    sparkleSize: 1,
  },
  lighting: {
    sunPosition: [20, 40, 20],
    sunColor: '#ffffff',
    sunIntensity: 1.4,
    ambientIntensity: 0.15,
    castShadow: true,
    shadowRange: 40,
    shadowMapSize: 2048,
    shadowBias: -0.0005,
    shadowNormalBias: 0.02,
    auxLightType: 'none',
    auxIntensity: 1,
    auxDistance: 0,
    auxAngle: Math.PI / 6,
    auxPenumbra: 0.2,
    auxDecay: 2,
    showSunDisc: true,
    sunDiscRadius: 3,
    sunDiscIntensity: 2,
    ambientFillIntensity: 0,
  },
  background: {
    topColor: '#02030a',
    bottomColor: '#1a1238',
  },
  fixedCamera: {
    azimuthDeg: FIXED_CAMERA_DEFAULTS.azimuthDeg,
    pitchDeg: FIXED_CAMERA_DEFAULTS.pitchDeg,
    height: FIXED_CAMERA_DEFAULTS.height,
    maxOnScreenFrac: FIXED_CAMERA_DEFAULTS.maxOnScreenFrac,
    minOnScreenFrac: FIXED_CAMERA_DEFAULTS.minOnScreenFrac,
    lateralFrac: FIXED_CAMERA_DEFAULTS.lateralFrac,
    fov: FIXED_CAMERA_DEFAULTS.fov,
    movementYawOffsetDeg: 0,
  },
  bot: {
    count: 1,
    mode: 'idle',
  },
};
