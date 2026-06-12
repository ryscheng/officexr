import type { OfficeState, Vec3 } from '@officexr/sdk';
import type { Clock } from '@officexr/sdk/test-harness';

export type BotMode =
  | 'idle'
  | 'walk-to-local'
  | 'walk-away'
  /** Random walk: pick a unit direction, hold for ~1–3 s, repeat. Pivots
   * early on a hard block so wandering bots don't grind against walls. */
  | 'wander'
  /** Patrol four corners of an inset square in a fixed loop. */
  | 'patrol'
  /** Orbit the local player at a fixed radius. */
  | 'orbit'
  /** Walk in a fixed XZ direction indefinitely. Pure intent source: calls
   * walk(dir) on CharacterMovement; direction is set via ModeState or the
   * __OFFICE_BOTS__ window hook before onEnter fires. */
  | 'linear-walk';

export const ALL_MODES: readonly BotMode[] = [
  'idle',
  'walk-to-local',
  'walk-away',
  'wander',
  'patrol',
  'orbit',
  'linear-walk',
];

/** Per-bot mutable scratch the modes mutate. Held on the driver so a
 * bot keeps its state across `setMode` toggles (wander direction,
 * patrol leg, orbit angle). */
export interface ModeState {
  /** Current direction the wander mode is heading (unit vector). */
  wanderDir: { x: number; z: number };
  /** Wall-clock time at which wander picks a new direction. */
  wanderUntilMs: number;
  /** Index into the patrol waypoint loop. */
  patrolIdx: number;
  /** Cached waypoints (computed lazily from world map size). */
  patrolWaypoints: Array<{ x: number; z: number }> | null;
  /** Current angle around the local player for orbit mode (radians). */
  orbitAngle: number;
  /** Direction for linear-walk mode. Set by BotDriver.setModeWithConfig
   * before onEnter fires, or by linearWalkStrategy.onEnter as a default.
   * Defaults to {x:0, z:1} if not provided. */
  linearWalkDir: { x: number; z: number };
}

export interface BotModeContext {
  botPos: Vec3;
  /** Latest broadcast position of the local (human) player from the
   * bot's SDK store. */
  localPlayerPos: Vec3;
  state: OfficeState;
  clock: Clock;
  modeState: ModeState;
}

/**
 * Strategy interface for one bot traversal behaviour. Implementations
 * return a unit-length XZ intent vector, or null to mean "no movement
 * this tick — settle to idle".
 */
export interface BotModeStrategy {
  /** Called when the driver switches into this mode. Reset / seed any
   * `modeState` fields the strategy owns. */
  onEnter?(ctx: BotModeContext): void;
  computeIntent(ctx: BotModeContext): { x: number; z: number } | null;
}
