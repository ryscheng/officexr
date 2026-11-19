import type { PlayerPose } from '@officexr/sdk';
import { RIDE_STRATEGIES } from './ride.ts';
import { SWIM_STRATEGIES, swimStateOf } from './swim.ts';
import type { RideVehicle } from '../scenes/world-object-kinds-schema.ts';

export interface PoseVisual {
  /** Animation clip that replaces the walk/idle one. */
  clip: string;
  timeScale: number;
  /** Forward pitch of the rider's body in radians. */
  pitch: number;
  /** Metres the model rides above the feet, before any swim buoyancy. */
  lift: number;
  vehicle: RideVehicle | null;
  /** Whether the body floats on water: its height comes from the buoyancy spring. */
  floats: boolean;
  /** Metres of the body below the waterline, when it floats. */
  sink: number;
}

/** What a peer's avatar looks like in a pose, from the speed its broadcast velocity implies. */
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
