export type SwimState = 'tread' | 'paddle' | 'stroke';

export interface SwimStrategy {
  /** m/s. */
  speed: number;
  clip: string;
  /** m/s at which the clip plays at 1x; 0 always plays at 1x. */
  refSpeed: number;
  /** Radians: positive lies face down, negative face up. */
  pitch: number;
  /** Metres the waterline sits below the body's axis. */
  sink: number;
}

export const PRONE_PITCH = 1.5;

export const PITCH_BLEND_S = 0.4;

export const BODY_CENTRE_M = 0.7;

export const floatSway = (time: number): number => Math.sin(time * 0.9) * 0.07;

export function stepPitch(current: number, target: number, dt: number): number {
  return target + (current - target) * Math.exp((-3 * dt) / PITCH_BLEND_S);
}

export const SWIM_STRATEGIES: Record<SwimState, SwimStrategy> = {
  tread: { speed: 0, clip: 'T-Pose', refSpeed: 0, pitch: -PRONE_PITCH, sink: 0.1 },
  paddle: { speed: 2.2, clip: 'Running_B', refSpeed: 3.2, pitch: PRONE_PITCH, sink: -0.3 },
  stroke: { speed: 3.4, clip: 'Running_A', refSpeed: 3.2, pitch: PRONE_PITCH, sink: -0.3 },
};

const MOVING_SPEED = 0.15;
const STROKE_SPEED = 2.8;

export function swimStateOf(speed: number): SwimState {
  return speed < MOVING_SPEED ? 'tread' : speed < STROKE_SPEED ? 'paddle' : 'stroke';
}

export function swimStateForInput(moving: boolean, sprint: boolean): SwimState {
  return !moving ? 'tread' : sprint ? 'stroke' : 'paddle';
}

export interface Buoyancy {
  lift: number;
  velocity: number;
}

const SPRING = 60;
const DAMPING = 9;
const BOB_AMPLITUDE = 0.015;
const BOB_RATE = Math.PI;

/** The floor under a shallow pool hides the legs, so the body may sink below the feet. */
export const MIN_LIFT = -0.7;

export function floatTarget(surfaceY: number, feetY: number, state: SwimState, time: number): number {
  const bob = Math.sin(time * BOB_RATE) * BOB_AMPLITUDE * (state === 'tread' ? 1.7 : 0.5);
  return Math.max(MIN_LIFT, surfaceY - feetY - SWIM_STRATEGIES[state].sink + bob);
}

export function stepBuoyancy(b: Buoyancy, target: number, dt: number): Buoyancy {
  const step = Math.min(dt, 1 / 30);
  const velocity = b.velocity + (SPRING * (target - b.lift) - DAMPING * b.velocity) * step;
  return { lift: b.lift + velocity * step, velocity };
}

export const AT_REST: Buoyancy = { lift: 0, velocity: 0 };
