import type { Bus } from '../game-state/bus.ts';
import type { PlayerId, PlayerState, ProximitySettings } from '../game-state/types.ts';
import type { PairTracker, TrackerOutput } from './pair-tracker.ts';

export interface ProximityTickInput {
  players: Record<PlayerId, PlayerState>;
  selfId: PlayerId;
  bus: Bus;
  settings: ProximitySettings & { charRadius: number };
  nowMs: number;
  dtSec: number;
}

/** Advances the tracker one frame; it emits the `proximity:*` bus events itself. */
export function tickProximity(
  tracker: PairTracker,
  { players, selfId, bus, settings, nowMs, dtSec }: ProximityTickInput,
): TrackerOutput {
  return tracker.tick(players, {
    selfId,
    bus,
    charRadius: settings.charRadius,
    proximityRadius: settings.proximityRadius,
    proximityOuterRadius: settings.proximityOuterRadius,
    enterDebounceMs: settings.proximityEnterDebounceMs,
    nowMs,
    dtSec,
  });
}
