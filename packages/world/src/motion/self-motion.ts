import type { PlayerPose, Vec3 } from '@officexr/sdk';
import type { RideVehicle } from '../scenes/world-object-kinds-schema.ts';
import { newRide, rideDirection, stepRide, type RideState } from './ride.ts';
import { SWIM_STRATEGIES, swimStateForInput } from './swim.ts';
import type { WaterVolume } from './water.ts';

export interface SelfMotion {
  pose: PlayerPose | null;
  rack: string | null;
  ride: RideState;
}

export const newSelfMotion = (): SelfMotion => ({ pose: null, rack: null, ride: newRide(0) });

export interface MotionWorld {
  waterAt(x: number, z: number): WaterVolume | null;
  rideNear(feet: Vec3): { vehicle: RideVehicle; rackId: string } | null;
}

export interface SelfMotionInput {
  feet: Vec3;
  dir: { x: number; z: number } | null;
  sprint: boolean;
  mount: boolean;
  /** atan2(x, z) of the world direction the player faces. */
  heading: number;
  dt: number;
}

export interface SelfMotionOutput {
  dir: { x: number; z: number } | null;
  /** m/s; null uses the normal walk/run speed. */
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

export function stepSelfMotion(sm: SelfMotion, input: SelfMotionInput, world: MotionWorld): SelfMotionOutput {
  const water = world.waterAt(input.feet.x, input.feet.z);
  const inWater = water !== null && input.feet.y <= water.surfaceY + 0.05;
  if (inWater && sm.pose !== 'swim') {
    sm.pose = 'swim';
  } else if (!inWater && sm.pose === 'swim') {
    sm.pose = null;
  }
  if (sm.pose !== 'scooter' && sm.pose !== 'tricycle') {
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
