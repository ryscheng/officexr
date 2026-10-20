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
export interface JumpSettings {
  jumpVelocity: number;
  airControl: number;
  maxJumps: number;
  landingEaseMs: number;
}

export interface ViewConfig {
  animation: AnimationSettings;
  proximity: ProximitySettings;
  lighting: LightingSettings;
  background: BackgroundSettings;
  fixedCamera: FixedCameraSettings;
  bot: BotSettings;
  jump: JumpSettings;
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

import { DEFAULT_VIEW_CONFIG as RENDERER_VIEW_DEFAULTS } from '@officexr/world/renderer';

/** Bundled defaults — match the previous Leva hook initial values exactly. */
export const DEFAULT_VIEW_CONFIG: ViewConfig = {
  ...structuredClone(RENDERER_VIEW_DEFAULTS),
  animation: {
    idleSpeed: 1,
    walkSpeed: 1,
    runSpeed: 1,
    turnSpeed: 16,
    playerSpeed: 3,
    runMultiplier: 2,
    movementBlockThreshold: 0.9,
  },
  bot: {
    count: 1,
    mode: 'idle',
  },
  jump: {
    jumpVelocity: 8,
    airControl: 0.2,
    maxJumps: 2,
    landingEaseMs: 120,
  },
};
