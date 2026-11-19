import type { CityLayout } from './generate.ts';
import type { Rng } from './rng.ts';
import {
  approachPiece,
  availableHeadings,
  axisOf,
  samplePiece,
  turnPiece,
  type Heading,
  type PathPose,
  type Piece,
} from './lanePath.ts';

export type SignalColour = 'green' | 'yellow' | 'red';
export type TrafficMode = 'cruise' | 'yield' | 'nudge' | 'stunned';

export interface TrafficAgent {
  carId: number;
  ni: number;
  nj: number;
  heading: Heading;
  out: Heading;
  phase: 'approach' | 'turn';
  piece: Piece;
  s: number;
  speed: number;
  pace: number;
  mode: TrafficMode;
  modeTimer: number;
  waited: number;
}

export interface TrafficContext {
  time: number;
  signal(ni: number, nj: number, axis: 'x' | 'z'): SignalColour;
  gapAhead(agent: TrafficAgent, pose: PathPose): number;
}

interface Decision {
  target: number;
  next: TrafficMode;
}

type Behaviour = (agent: TrafficAgent, ctx: TrafficContext, dt: number) => Decision;

const SIGNAL_CYCLE = 20;
export const SPEED_LIMIT = 13.5;
const ACCEL = 4.5;
const DECEL = 9;
const PLAN_DECEL = 6;
const CAR_LENGTH = 4.6;

export function signalColour(time: number, intersection: { i: number; j: number }, axis: 'x' | 'z'): SignalColour {
  const phase = (time + ((intersection.i * 3 + intersection.j * 7) % SIGNAL_CYCLE)) % SIGNAL_CYCLE;
  const local = axis === 'x' ? phase : (phase + SIGNAL_CYCLE / 2) % SIGNAL_CYCLE;
  if (local < 7) return 'green';
  if (local < 8.5) return 'yellow';
  return 'red';
}

const speedForGap = (gap: number) => Math.sqrt(2 * PLAN_DECEL * Math.max(0, gap - 1));

function signalLimit(agent: TrafficAgent, ctx: TrafficContext): number {
  if (agent.phase !== 'approach') return Infinity;
  const colour = ctx.signal(agent.ni, agent.nj, axisOf(agent.heading));
  if (colour === 'green') return Infinity;
  const remaining = agent.piece.len - agent.s;
  if (colour === 'yellow' && (agent.speed * agent.speed) / (2 * DECEL) > remaining) return Infinity;
  return speedForGap(remaining);
}

function limitFor(agent: TrafficAgent, ctx: TrafficContext, ignoreCars: boolean): number {
  let limit = agent.pace * SPEED_LIMIT;
  limit = Math.min(limit, signalLimit(agent, ctx));
  if (!ignoreCars) {
    const gap = ctx.gapAhead(agent, samplePiece(agent.piece, agent.s)) - CAR_LENGTH;
    limit = Math.min(limit, speedForGap(gap));
  }
  return limit;
}

export const TRAFFIC_BEHAVIOURS: Record<TrafficMode, Behaviour> = {
  cruise: (agent, ctx) => {
    const target = limitFor(agent, ctx, false);
    return { target, next: target < agent.pace * SPEED_LIMIT * 0.4 && agent.speed < 2 ? 'yield' : 'cruise' };
  },
  yield: (agent, ctx, dt) => {
    const target = limitFor(agent, ctx, false);
    agent.waited = agent.speed < 0.5 ? agent.waited + dt : 0;
    if (target > 3) return { target, next: 'cruise' };
    if (agent.waited > 9) {
      agent.modeTimer = 2.5;
      agent.waited = 0;
      return { target, next: 'nudge' };
    }
    return { target, next: 'yield' };
  },
  nudge: (agent, ctx, dt) => {
    agent.modeTimer -= dt;
    return { target: limitFor(agent, ctx, true), next: agent.modeTimer <= 0 ? 'cruise' : 'nudge' };
  },
  stunned: (agent, _ctx, dt) => {
    agent.modeTimer -= dt;
    return { target: 0, next: agent.modeTimer <= 0 ? 'cruise' : 'stunned' };
  },
};

export function createTrafficAgent(city: CityLayout, rng: Rng, carId: number): TrafficAgent {
  const node = rng.pick(city.intersections);
  const heading = rng.pick(availableHeadings(city, node.i, node.j));
  const piece = approachPiece(city, node.i, node.j, heading);
  return {
    carId,
    ni: node.i + heading[0],
    nj: node.j + heading[1],
    heading,
    out: heading,
    phase: 'approach',
    piece,
    s: rng.range(0, piece.len),
    speed: 0,
    pace: rng.range(0.72, 1),
    mode: 'cruise',
    modeTimer: 0,
    waited: 0,
  };
}

function startTurn(city: CityLayout, agent: TrafficAgent, rng: Rng) {
  const options = availableHeadings(city, agent.ni, agent.nj);
  const forward = options.filter((h) => h[0] === agent.heading[0] && h[1] === agent.heading[1]);
  const sideways = options.filter((h) => h[0] !== -agent.heading[0] || h[1] !== -agent.heading[1]);
  const pool = forward.length > 0 && rng.chance(0.55) ? forward : sideways.length > 0 ? sideways : options;
  agent.out = rng.pick(pool);
  agent.piece = turnPiece(city, agent.ni, agent.nj, agent.heading, agent.out);
  agent.phase = 'turn';
  agent.s = 0;
}

function finishTurn(city: CityLayout, agent: TrafficAgent) {
  agent.heading = agent.out;
  agent.piece = approachPiece(city, agent.ni, agent.nj, agent.out);
  agent.ni += agent.out[0];
  agent.nj += agent.out[1];
  agent.phase = 'approach';
  agent.s = 0;
}

export function stepTrafficAgent(
  city: CityLayout,
  agent: TrafficAgent,
  ctx: TrafficContext,
  rng: Rng,
  dt: number,
): PathPose {
  const decision = TRAFFIC_BEHAVIOURS[agent.mode](agent, ctx, dt);
  agent.mode = decision.next;
  agent.speed =
    decision.target > agent.speed
      ? Math.min(decision.target, agent.speed + ACCEL * dt)
      : Math.max(decision.target, agent.speed - DECEL * dt);
  agent.s += agent.speed * dt;
  while (agent.s >= agent.piece.len) {
    const overflow = agent.s - agent.piece.len;
    if (agent.phase === 'approach') {
      startTurn(city, agent, rng);
    } else {
      finishTurn(city, agent);
    }
    agent.s = overflow;
  }
  return samplePiece(agent.piece, agent.s);
}

export function stunTrafficAgent(agent: TrafficAgent, seconds = 2.5) {
  agent.mode = 'stunned';
  agent.modeTimer = seconds;
  agent.speed = 0;
}
