import type { Store } from '../../game-state/store.ts';
import type { Vec3 } from '../../game-state/types.ts';
import type { Clock } from '../../test-harness/time.ts';
import type { NetEvent } from '../protocol.ts';

/**
 * Position throttling constants. Exposed publicly because integration
 * tests + the position-throttling acceptance criteria from
 * `refactor-plan/05-migration-plan §Step 7` reference these values
 * (deltaP / stopGraceMs in particular).
 */
export const POSITION_CONSTANTS = {
  deltaP: 0.05, // m
  deltaY: 0.05, // rad
  maxHz: 30,
  stopGraceMs: 100,
};

const ZERO_V: Vec3 = { x: 0, y: 0, z: 0 };

function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function angleDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
}

type BroadcastFn = (event: NetEvent) => void;
type SeqFn = () => number;

interface PositionBroadcasterOpts {
  store: Store;
  clock: Clock;
  broadcast: BroadcastFn;
  takeSeq: SeqFn;
}

/**
 * Owns the local player's outbound `presence:position` cadence:
 *  - initial spawn announce (one packet, zero velocity);
 *  - delta-triggered + rate-capped position updates;
 *  - estimated velocity computed from the dt between consecutive sends;
 *  - "stop packet" with `vel = 0` after `stopGraceMs` of inactivity.
 *
 * The collaborator is re-entrant-safe: bookkeeping is updated BEFORE
 * the broadcast call so an in-memory hub that synchronously delivers
 * to other peers (whose flushPosition may re-enter this one) doesn't
 * see stale `lastSent*` state.
 */
export class PositionBroadcaster {
  private store: Store;
  private clock: Clock;
  private broadcast: BroadcastFn;
  private takeSeq: SeqFn;

  private lastSentPos: Vec3 = { ...ZERO_V };
  private lastSentYaw = 0;
  private lastSentTMs = -Infinity;
  private lastSentIsAirborne = false;
  private wasMoving = false;
  private hasInitialPosition = false;
  private pendingStopCheckSinceMs: number | null = null;

  constructor(opts: PositionBroadcasterOpts) {
    this.store = opts.store;
    this.clock = opts.clock;
    this.broadcast = opts.broadcast;
    this.takeSeq = opts.takeSeq;
  }

  /**
   * Latch the current self pose as the baseline AND emit one
   * `presence:position` so any peer already on the channel sees us.
   * Receivers upsert-on-missing, so this single broadcast is what
   * makes a stationary new peer visible without any membership
   * protocol. Vel is zero — spawn pose, not a movement update.
   *
   * `lastSentTMs` stays at -Infinity so the first real movement isn't
   * rate-capped by `aboveCeiling`. The throttle protects against burst
   * *user* moves, not the spawn announcement.
   */
  announceSelf(): void {
    const initial = this.store.getState();
    const me = initial.players[initial.selfId];
    if (!me) return;
    this.lastSentPos = { ...me.pos };
    this.lastSentYaw = me.yaw;
    this.lastSentIsAirborne = me.isAirborne;
    this.hasInitialPosition = true;
    this.broadcast({
      kind: 'presence:position',
      v: 1,
      actorId: initial.selfId,
      seq: this.takeSeq(),
      t: this.clock.now(),
      pos: { ...me.pos },
      vel: { ...ZERO_V },
      yaw: me.yaw,
      isAirborne: me.isAirborne,
    });
  }

  // Position is checked on every store change (movement) and may also be
  // re-checked by the harness via flushPosition() after time advances.
  flushPosition(): void {
    const state = this.store.getState();
    const me = state.players[state.selfId];
    if (!me) return;
    const now = this.clock.now();

    if (!this.hasInitialPosition) {
      // record initial baseline without sending. Leave lastSentTMs at
      // -Infinity so the first real movement is not rate-capped.
      this.lastSentPos = { ...me.pos };
      this.lastSentYaw = me.yaw;
      this.lastSentIsAirborne = me.isAirborne;
      this.hasInitialPosition = true;
      return;
    }

    const dPos = distance(me.pos, this.lastSentPos);
    const dYaw = angleDelta(me.yaw, this.lastSentYaw);
    const dt = now - this.lastSentTMs;
    const aboveCeiling = dt < 1000 / POSITION_CONSTANTS.maxHz;
    const movedEnough = dPos > POSITION_CONSTANTS.deltaP || dYaw > POSITION_CONSTANTS.deltaY;
    // Force a broadcast when the airborne flag flips so peers can flip
    // the jump animation immediately, without waiting for the stop-grace
    // packet (which would lag by up to `stopGraceMs` for a stationary
    // jump). Bypasses the `movedEnough` gate but still honours the rate
    // ceiling — at 30 Hz that's at most ~33 ms latency on a flip.
    const airborneChanged = me.isAirborne !== this.lastSentIsAirborne;

    if ((movedEnough || airborneChanged) && !aboveCeiling) {
      // estimated velocity since last send. On the first send (dt non-finite)
      // fall back to the player's own velocity vector.
      const vel = dt > 0 && Number.isFinite(dt)
        ? {
            x: ((me.pos.x - this.lastSentPos.x) * 1000) / dt,
            y: ((me.pos.y - this.lastSentPos.y) * 1000) / dt,
            z: ((me.pos.z - this.lastSentPos.z) * 1000) / dt,
          }
        : { ...me.vel };
      // Snapshot the event payload + update outbound bookkeeping BEFORE
      // broadcasting. With an in-memory hub, broadcast() synchronously
      // delivers to other peers, which triggers their onInbound →
      // applyRemotePosition → onStoreChange → flushPosition chain. If
      // that other peer has been moving autonomously (e.g. another bot
      // in the same Node process), its flushPosition broadcasts back,
      // which re-enters *this* flushPosition synchronously. If we
      // hadn't updated lastSentPos yet, the re-entrant call would see
      // the same `dPos` and broadcast again — infinite recursion.
      const event: NetEvent = {
        kind: 'presence:position',
        v: 1,
        actorId: state.selfId,
        seq: this.takeSeq(),
        t: now,
        pos: { ...me.pos },
        vel,
        yaw: me.yaw,
        isAirborne: me.isAirborne,
      };
      this.lastSentPos = { ...me.pos };
      this.lastSentYaw = me.yaw;
      this.lastSentIsAirborne = me.isAirborne;
      this.lastSentTMs = now;
      this.wasMoving = true;
      this.pendingStopCheckSinceMs = null;
      this.broadcast(event);
      return;
    }

    // Stop detection: previously moving, now under threshold.
    if (this.wasMoving && !movedEnough) {
      if (this.pendingStopCheckSinceMs === null) {
        this.pendingStopCheckSinceMs = now;
      }
      const sinceQuiet = now - this.pendingStopCheckSinceMs;
      if (sinceQuiet >= POSITION_CONSTANTS.stopGraceMs) {
        // Same ordering as above: update bookkeeping before broadcast
        // so re-entrant flushPosition sees the new lastSent state.
        const event: NetEvent = {
          kind: 'presence:position',
          v: 1,
          actorId: state.selfId,
          seq: this.takeSeq(),
          t: now,
          pos: { ...me.pos },
          vel: { ...ZERO_V },
          yaw: me.yaw,
          isAirborne: me.isAirborne,
        };
        this.lastSentPos = { ...me.pos };
        this.lastSentYaw = me.yaw;
        this.lastSentIsAirborne = me.isAirborne;
        this.lastSentTMs = now;
        this.wasMoving = false;
        this.pendingStopCheckSinceMs = null;
        this.broadcast(event);
      }
    }
  }
}
