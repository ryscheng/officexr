export type SwimState = 'tread' | 'paddle' | 'stroke';

export interface SwimStrategy {
  /** Horizontal speed in m/s the player moves at in this state. */
  speed: number;
  /** Animation clip that plays; a running clip tilted face down reads as a front crawl, with alternating arms and kicking legs. */
  clip: string;
  /** Speed the clip plays at 1x, in m/s; the playback rate scales with speed / this. 0 plays at 1x. */
  refSpeed: number;
  /** Forward pitch of the body in radians: 0 upright, π/2 lying face down. */
  pitch: number;
  /** Metres the waterline sits below the body's axis: how deep the body rides. */
  sink: number;
}

/** Tilt of a swimmer in radians (about 86°): forward lies face down for the crawl, backward lies face up when floating. */
export const PRONE_PITCH = 1.5;

/** Seconds a pitch change takes to settle (about 95% of the way). */
export const PITCH_BLEND_S = 0.4;

/** Metres from the feet to the middle of the body, which the tilt swings sideways. */
export const BODY_CENTRE_M = 0.7;

/** Slow roll of a floating body in radians, from the time in seconds. */
export const floatSway = (time: number): number => Math.sin(time * 0.9) * 0.07;

/** One step of the body tilt toward `target`, so tread and swim blend instead of snapping. */
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
  /** Height of the body's lowest point above its resting level. */
  lift: number;
  velocity: number;
}

const SPRING = 60;
const DAMPING = 9;
const BOB_AMPLITUDE = 0.015;
const BOB_RATE = Math.PI;

/** Lowest the body goes below the player's feet; the floor under a shallow pool hides the legs. */
export const MIN_LIFT = -0.7;

/** Where the body floats relative to the player's feet: the waterline minus the state's waterline height, with a gentle bob. */
export function floatTarget(surfaceY: number, feetY: number, state: SwimState, time: number): number {
  const bob = Math.sin(time * BOB_RATE) * BOB_AMPLITUDE * (state === 'tread' ? 1.7 : 0.5);
  return Math.max(MIN_LIFT, surfaceY - feetY - SWIM_STRATEGIES[state].sink + bob);
}

/** One spring-damper step of the floating body toward `target`; semi-implicit so it stays stable at 60 Hz. */
export function stepBuoyancy(b: Buoyancy, target: number, dt: number): Buoyancy {
  const step = Math.min(dt, 1 / 30);
  const velocity = b.velocity + (SPRING * (target - b.lift) - DAMPING * b.velocity) * step;
  return { lift: b.lift + velocity * step, velocity };
}

export const AT_REST: Buoyancy = { lift: 0, velocity: 0 };
