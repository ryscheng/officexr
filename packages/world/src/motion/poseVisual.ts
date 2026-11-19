import type { PlayerPose } from '@officexr/sdk';
import { RIDE_STRATEGIES } from './ride.ts';
import { SWIM_STRATEGIES, swimStateOf } from './swim.ts';
import type { RideVehicle } from '../scenes/world-object-kinds-schema.ts';

export interface PoseVisual {
  clip: string;
  timeScale: number;
  pitch: number;
  lift: number;
  vehicle: RideVehicle | null;
  floats: boolean;
  sink: number;
}

type PoseStrategy = (horizontalSpeed: number) => PoseVisual;

const rideVisual =
  (vehicle: RideVehicle): PoseStrategy =>
  () => {
    const s = RIDE_STRATEGIES[vehicle];
    return { clip: s.clip, timeScale: 1, pitch: s.riderPitch, lift: s.deckHeight, vehicle, floats: false, sink: 0 };
  };

export const POSE_VISUALS: Record<PlayerPose, PoseStrategy> = {
  swim: (speed) => {
    const state = swimStateOf(speed);
    const s = SWIM_STRATEGIES[state];
    return {
      clip: s.clip,
      timeScale: s.refSpeed > 0 ? Math.max(0.6, Math.min(1.6, speed / s.refSpeed)) : 1,
      pitch: s.pitch,
      lift: 0,
      vehicle: null,
      floats: true,
      sink: s.sink,
    };
  },
  scooter: rideVisual('scooter'),
  tricycle: rideVisual('tricycle'),
};
