import type { PlayerId, PlayerState } from '@officexr/sdk';

/** How a character is animating this frame. */
export interface MotionSample {
  moving: boolean;
  /** Walk-cycle angle in radians; advances with distance walked, so faster walking steps faster. */
  phase: number;
}

export const STILL: MotionSample = { moving: false, phase: 0 };

/** Below this planar speed a character stands still, so network jitter doesn't twitch the legs. */
const MOVING_SPEED_MPS = 0.25;
/** Walk-cycle radians per metre walked. */
const STRIDE_RAD_PER_M = 5.5;
/** Seconds of smoothing on the measured speed. */
const SPEED_SMOOTHING_SEC = 0.12;

type Track = { x: number; z: number; speed: number; phase: number };

/**
 * Measures each player's walking from frame-to-frame position, for remote players as
 * well as you (their synced `vel` is not always populated). Headless.
 */
export class PlayerMotion {
  private readonly tracks = new Map<PlayerId, Track>();

  update(players: Readonly<Record<PlayerId, Pick<PlayerState, 'pos'>>>, dtSec: number): void {
    for (const id of this.tracks.keys()) {
      if (!players[id]) {
        this.tracks.delete(id);
      }
    }
    for (const [id, { pos }] of Object.entries(players)) {
      const track = this.tracks.get(id);
      if (!track) {
        this.tracks.set(id, { x: pos.x, z: pos.z, speed: 0, phase: 0 });
        continue;
      }
      const dist = Math.hypot(pos.x - track.x, pos.z - track.z);
      const instant = dtSec > 0 ? dist / dtSec : 0;
      const k = dtSec > 0 ? 1 - Math.exp(-dtSec / SPEED_SMOOTHING_SEC) : 0;
      track.speed += (instant - track.speed) * k;
      track.phase = (track.phase + dist * STRIDE_RAD_PER_M) % (Math.PI * 2);
      track.x = pos.x;
      track.z = pos.z;
    }
  }

  sample(id: PlayerId): MotionSample {
    const track = this.tracks.get(id);
    return track ? { moving: track.speed > MOVING_SPEED_MPS, phase: track.phase } : STILL;
  }
}
