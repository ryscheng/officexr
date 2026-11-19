import type { ObjectInstance, Vec3 } from '@officexr/sdk';
import type { KindResolver } from '../app/geometry-service.ts';
import type { InstanceGeometryService } from '../app/types.ts';
import type { RideVehicle } from '../scenes/world-object-kinds-schema.ts';

export interface RideStrategy {
  /** m/s. */
  topSpeed: number;
  accel: number;
  brake: number;
  /** rad/s at standstill. */
  turnRate: number;
  turnAtSpeed: number;
  /** rad of roll per (rad/s turn x m/s speed). */
  leanGain: number;
  leanMax: number;
  /** Metres the rider's feet sit above the ground. */
  deckHeight: number;
  clip: string;
  riderPitch: number;
  boost: number;
  model: string;
}

export const RIDE_STRATEGIES: Record<RideVehicle, RideStrategy> = {
  scooter: {
    topSpeed: 8.5,
    accel: 5,
    brake: 7,
    turnRate: 2.6,
    turnAtSpeed: 0.45,
    leanGain: 0.07,
    leanMax: 0.38,
    deckHeight: 0.21,
    clip: 'Idle_A',
    riderPitch: 0.1,
    boost: 1.25,
    model: '/models/props/scooter.gltf',
  },
  tricycle: {
    topSpeed: 3.6,
    accel: 3,
    brake: 6,
    turnRate: 3.2,
    turnAtSpeed: 0.7,
    leanGain: 0,
    leanMax: 0,
    deckHeight: 0.544,
    clip: 'Sit_Chair_Idle',
    riderPitch: 0.05,
    boost: 1,
    model: '/models/props/tricycle.gltf',
  },
};

export interface RideState {
  heading: number;
  speed: number;
  yawRate: number;
}

export const newRide = (heading: number): RideState => ({ heading, speed: 0, yawRate: 0 });

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function stepRide(
  ride: RideState,
  vehicle: RideVehicle,
  intent: { dir: { x: number; z: number } | null; sprint: boolean },
  dt: number,
): RideState {
  const s = RIDE_STRATEGIES[vehicle];
  const top = s.topSpeed * (intent.sprint ? s.boost : 1);
  const target = intent.dir ? top : 0;
  const speed =
    target > ride.speed
      ? Math.min(target, ride.speed + s.accel * dt)
      : Math.max(target, ride.speed - s.brake * dt);
  let heading = ride.heading;
  if (intent.dir) {
    const wanted = Math.atan2(intent.dir.x, intent.dir.z);
    const rate = s.turnRate * (1 - (1 - s.turnAtSpeed) * Math.min(1, ride.speed / s.topSpeed));
    const turn = Math.max(-rate * dt, Math.min(rate * dt, wrap(wanted - heading)));
    heading = wrap(heading + turn);
  }
  return { heading, speed, yawRate: dt > 0 ? wrap(heading - ride.heading) / dt : 0 };
}

export const rideDirection = (ride: RideState) => ({ x: Math.sin(ride.heading), z: Math.cos(ride.heading) });

/** Positive leans toward the player's left. */
export function leanOf(vehicle: RideVehicle, yawRate: number, speed: number): number {
  const s = RIDE_STRATEGIES[vehicle];
  return Math.max(-s.leanMax, Math.min(s.leanMax, yawRate * speed * s.leanGain));
}

export interface RideStand {
  instance: ObjectInstance;
  vehicle: RideVehicle;
}

export const MOUNT_REACH_M = 1.3;
const NO_RACKS: ReadonlySet<string> = new Set();

export function nearestRideStand(
  instances: readonly ObjectInstance[],
  catalog: Pick<KindResolver, 'getKind'>,
  geometry: Pick<InstanceGeometryService, 'worldAABBOfInstance'>,
  feet: Vec3,
  reach: number = MOUNT_REACH_M,
  taken: ReadonlySet<string> = NO_RACKS,
): RideStand | null {
  let best: RideStand | null = null;
  let bestDistance = reach;
  for (const instance of instances) {
    const ride = catalog.getKind(instance.kindId)?.ride;
    if (!ride || taken.has(instance.id)) {
      continue;
    }
    const { min, max } = geometry.worldAABBOfInstance(instance);
    const dx = Math.max(min[0] - feet.x, 0, feet.x - max[0]);
    const dz = Math.max(min[2] - feet.z, 0, feet.z - max[2]);
    const dy = Math.max(min[1] - feet.y, 0, feet.y - max[1]);
    const distance = Math.hypot(dx, dy, dz);
    if (distance <= bestDistance) {
      best = { instance, vehicle: ride.vehicle };
      bestDistance = distance;
    }
  }
  return best;
}
