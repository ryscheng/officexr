import type { PlayerPose, Vec3 } from '@officexr/sdk';
import type { RideVehicle } from '../scenes/world-object-kinds-schema.ts';
import { newRide, rideDirection, stepRide, type RideState } from './ride.ts';
import { SWIM_STRATEGIES, swimStateForInput } from './swim.ts';
import type { WaterVolume } from './water.ts';

export interface SelfMotion {
  pose: PlayerPose | null;
  /** The rack the current ride started at, null otherwise. */
  rack: string | null;
  ride: RideState;
}

export const newSelfMotion = (): SelfMotion => ({ pose: null, rack: null, ride: newRide(0) });

/** What the self player's movement needs to know about the scene, kept apart from where it comes from. */
export interface MotionWorld {
  waterAt(x: number, z: number): WaterVolume | null;
  rideNear(feet: Vec3): { vehicle: RideVehicle; rackId: string } | null;
}

export interface SelfMotionInput {
  feet: Vec3;
  /** Camera-relative intent as a world direction; null without input. */
  dir: { x: number; z: number } | null;
  sprint: boolean;
  /** Mount/dismount pressed this frame. */
  mount: boolean;
  /** Heading the player faces, as `atan2(x, z)` of the world direction. */
  heading: number;
  dt: number;
}

export interface SelfMotionOutput {
  /** World direction to move in; null stands still. */
  dir: { x: number; z: number } | null;
  /** Speed override in m/s; null uses the normal walk/run speed. */
  speed: number | null;
  canJump: boolean;
}

type Mode = 'foot' | PlayerPose;

const FOOT: SelfMotionOutput = { dir: null, speed: null, canJump: true };

const SELF_MODES: Record<Mode, (sm: SelfMotion, i: SelfMotionInput) => SelfMotionOutput> = {
  foot: (_sm, i) => ({ ...FOOT, dir: i.dir }),
  swim: (_sm, i) => {
    const state = swimStateForInput(i.dir !== null, i.sprint);
    return { dir: i.dir, speed: SWIM_STRATEGIES[state].speed, canJump: false };
  },
  scooter: (sm, i) => rideOutput(sm, 'scooter', i),
  tricycle: (sm, i) => rideOutput(sm, 'tricycle', i),
};

function rideOutput(sm: SelfMotion, vehicle: RideVehicle, i: SelfMotionInput): SelfMotionOutput {
  sm.ride = stepRide(sm.ride, vehicle, { dir: i.dir, sprint: i.sprint }, i.dt);
  return { dir: sm.ride.speed > 0.05 ? rideDirection(sm.ride) : null, speed: sm.ride.speed, canJump: false };
}

/** Swims when in water, mounts or dismounts on the mount key, and returns this frame's movement. */
export function stepSelfMotion(sm: SelfMotion, input: SelfMotionInput, world: MotionWorld): SelfMotionOutput {
  const water = world.waterAt(input.feet.x, input.feet.z);
  const inWater = water !== null && input.feet.y <= water.surfaceY + 0.05;
  if (inWater && sm.pose !== 'swim') {
    sm.pose = 'swim';
  } else if (!inWater && sm.pose === 'swim') {
    sm.pose = null;
  }
  if (sm.pose === null) {
    sm.rack = null;
  }
  if (input.mount && sm.pose !== 'swim') {
    if (sm.pose !== null) {
      sm.pose = null;
      sm.rack = null;
    } else {
      const stand = world.rideNear(input.feet);
      if (stand) {
        sm.pose = stand.vehicle;
        sm.rack = stand.rackId;
        sm.ride = newRide(input.heading);
      }
    }
  }
  return SELF_MODES[sm.pose ?? 'foot'](sm, input);
}
