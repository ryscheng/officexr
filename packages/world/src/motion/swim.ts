export type SwimState = 'tread' | 'paddle' | 'stroke';

export interface SwimStrategy {
  /** Horizontal speed in m/s the player moves at in this state. */
  speed: number;
  /** Animation clip that plays; `Crawling` is the prone rig pose. */
  clip: string;
  /** Speed the clip is authored for, in m/s; the playback rate scales with speed / this. 0 plays at 1x. */
  refSpeed: number;
  /** Forward pitch of the body in radians: 0 upright, π/2 lying face down. */
  pitch: number;
  /** Metres the body sinks below the surface: the waterline sits this far above the feet. */
  sink: number;
}

export const SWIM_STRATEGIES: Record<SwimState, SwimStrategy> = {
  tread: { speed: 0, clip: 'Idle_A', refSpeed: 0, pitch: 0.12, sink: 0.35 },
  paddle: { speed: 2.2, clip: 'Crawling', refSpeed: 2.2, pitch: 1.2, sink: 0.22 },
  stroke: { speed: 3.4, clip: 'Crawling', refSpeed: 2.2, pitch: 1.35, sink: 0.2 },
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
const BOB_AMPLITUDE = 0.02;
const BOB_RATE = 2.4;

/** Where the body floats above the player's feet: the waterline minus how far the state sinks, with a gentle bob. */
export function floatTarget(surfaceY: number, feetY: number, state: SwimState, time: number): number {
  const bob = Math.sin(time * BOB_RATE) * BOB_AMPLITUDE * (state === 'tread' ? 1.6 : 0.6);
  return Math.max(0, surfaceY - feetY - SWIM_STRATEGIES[state].sink + bob);
}

/** One spring-damper step of the floating body toward `target`; semi-implicit so it stays stable at 60 Hz. */
export function stepBuoyancy(b: Buoyancy, target: number, dt: number): Buoyancy {
  const step = Math.min(dt, 1 / 30);
  const velocity = b.velocity + (SPRING * (target - b.lift) - DAMPING * b.velocity) * step;
  return { lift: b.lift + velocity * step, velocity };
}

export const AT_REST: Buoyancy = { lift: 0, velocity: 0 };
