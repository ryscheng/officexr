import { z } from 'zod';
import type { CollisionSettings, JumpSettings, WorldSettings } from './types.ts';

export type AuxLightType = 'none' | 'spot' | 'point';

export type AnimationConstants = {
  idleSpeed: number;
  walkSpeed: number;
  runSpeed: number;
  turnSpeed: number;
  playerSpeed: number;
  runMultiplier: number;
  movementBlockThreshold: number;
};

export type ProximityConstants = {
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
};

export type LightingConstants = {
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
};

export type BackgroundConstants = {
  topColor: string;
  /** Sky colour at the horizon; omitted, the sky is the original two-stop
   * top-to-bottom gradient. Optional so documents saved before it existed
   * still parse and look the same. */
  horizonColor?: string;
  bottomColor: string;
};

export type FixedCameraConstants = {
  azimuthDeg: number;
  pitchDeg: number;
  height: number;
  maxOnScreenFrac: number;
  minOnScreenFrac: number;
  lateralFrac: number;
  fov: number;
  movementYawOffsetDeg: number;
};

/** The world's tunable constants, owned by the realtime server. Every
 * client's `worldSettings` is derived from this document. */
export type WorldConstants = {
  schemaVersion: 1;
  animation: AnimationConstants;
  jump: JumpSettings;
  proximity: ProximityConstants;
  lighting: LightingConstants;
  background: BackgroundConstants;
  fixedCamera: FixedCameraConstants;
};

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

/** Collision tunables aren't part of `WorldConstants`; every client uses these. */
const COLLISION_DEFAULTS: Pick<CollisionSettings, 'charRadius' | 'bumpEasingMs'> = {
  charRadius: 0.4,
  bumpEasingMs: 180,
};

export const DEFAULT_WORLD_CONSTANTS: WorldConstants = {
  schemaVersion: 1,
  animation: {
    idleSpeed: 1,
    walkSpeed: 1,
    runSpeed: 1,
    turnSpeed: 16,
    playerSpeed: 3,
    runMultiplier: 2,
    movementBlockThreshold: 0.9,
  },
  jump: {
    jumpVelocity: 8,
    airControl: 0.2,
    maxJumps: 2,
    landingEaseMs: 120,
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
  },
  background: {
    topColor: '#02030a',
    bottomColor: '#1a1238',
  },
  fixedCamera: {
    ...FIXED_CAMERA_DEFAULTS,
    movementYawOffsetDeg: 0,
  },
};

const ZColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const nonNegative = z.number().min(0);
const positive = z.number().positive();

export const ZWorldConstants: z.ZodType<WorldConstants> = z.object({
  schemaVersion: z.literal(1),
  animation: z.object({
    idleSpeed: positive,
    walkSpeed: positive,
    runSpeed: positive,
    turnSpeed: positive,
    playerSpeed: positive,
    runMultiplier: z.number().min(1),
    movementBlockThreshold: z.number().min(0).max(1),
  }),
  jump: z.object({
    jumpVelocity: positive,
    airControl: z.number().min(0).max(1),
    maxJumps: z.number().int().min(1).max(10),
    landingEaseMs: nonNegative,
  }),
  proximity: z.object({
    sensorRadius: positive,
    outerRadius: positive,
    enterDebounceMs: nonNegative,
    discRadius: positive,
    pulseSpeed: nonNegative,
    intensity: nonNegative,
    enteringColor: ZColor,
    enteredColor: ZColor,
    exitingColor: ZColor,
    meetingBorderInset: nonNegative,
    meetingBorderOutset: nonNegative,
    sparkleSpeed: nonNegative,
    sparkleFloatHeight: nonNegative,
    conversationDistance: positive,
    conversationHeight: positive,
    sparkleSize: positive,
  }),
  lighting: z.object({
    sunPosition: z.tuple([z.number(), z.number(), z.number()]),
    sunColor: ZColor,
    sunIntensity: nonNegative,
    ambientIntensity: nonNegative,
    castShadow: z.boolean(),
    shadowRange: positive,
    shadowMapSize: z.number().int().min(256).max(8192),
    shadowBias: z.number().min(-0.01).max(0.01),
    shadowNormalBias: z.number().min(0).max(1),
    auxLightType: z.enum(['none', 'spot', 'point']),
    auxIntensity: nonNegative,
    auxDistance: nonNegative,
    auxAngle: z.number().min(0).max(Math.PI / 2),
    auxPenumbra: z.number().min(0).max(1),
    auxDecay: nonNegative,
    showSunDisc: z.boolean(),
    sunDiscRadius: positive,
    sunDiscIntensity: nonNegative,
  }),
  background: z.object({
    topColor: ZColor,
    horizonColor: ZColor.optional(),
    bottomColor: ZColor,
  }),
  fixedCamera: z.object({
    azimuthDeg: z.number().min(0).max(360),
    pitchDeg: z.number().min(-90).max(90),
    height: nonNegative,
    maxOnScreenFrac: z.number().gt(0).max(1),
    minOnScreenFrac: z.number().gt(0).max(1),
    lateralFrac: z.number().min(0).max(1),
    fov: z.number().min(1).max(179),
    movementYawOffsetDeg: z.number().min(-180).max(180),
  }),
});

/** Validates an untrusted constants document; throws a `ZodError` when it
 * is malformed or out of range. */
export function parseWorldConstants(input: unknown): WorldConstants {
  return ZWorldConstants.parse(input);
}

export function worldSettingsFromConstants(c: WorldConstants): WorldSettings {
  return {
    playerSpeed: c.animation.playerSpeed,
    runSpeedMultiplier: c.animation.runMultiplier,
    walkAnimSpeed: c.animation.walkSpeed,
    runAnimSpeed: c.animation.runSpeed,
    idleAnimSpeed: c.animation.idleSpeed,
    turnSpeed: c.animation.turnSpeed,
    movementBlockThreshold: c.animation.movementBlockThreshold,
    ...c.jump,
    proximityRadius: c.proximity.sensorRadius,
    proximityOuterRadius: c.proximity.outerRadius,
    proximityEnterDebounceMs: c.proximity.enterDebounceMs,
    ...COLLISION_DEFAULTS,
  };
}
