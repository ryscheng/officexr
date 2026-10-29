import type { Store } from '../../game-state/store.ts';
import type { Clock } from '../../test-harness/time.ts';
import type { NetEvent } from '../protocol.ts';

const HEARTBEAT_MS = 5_000;

type BroadcastFn = (event: NetEvent) => void;
type SeqFn = () => number;

interface StatusBroadcasterOpts {
  store: Store;
  clock: Clock;
  broadcast: BroadcastFn;
  takeSeq: SeqFn;
}

/**
 * Owns the local player's outbound `presence:status`: {@link announceSelf}
 * sends it, and {@link tick} re-sends it every {@link HEARTBEAT_MS} so peers
 * can tell a quiet player from a vanished one. Hold-gating and change
 * detection are the SyncEngine's.
 */
export class StatusBroadcaster {
  private store: Store;
  private clock: Clock;
  private broadcast: BroadcastFn;
  private takeSeq: SeqFn;
  private lastSentAt = -Infinity;

  constructor(opts: StatusBroadcasterOpts) {
    this.store = opts.store;
    this.clock = opts.clock;
    this.broadcast = opts.broadcast;
    this.takeSeq = opts.takeSeq;
  }

  announceSelf(): void {
    const state = this.store.getState();
    const me = state.players[state.selfId];
    if (!me) return;
    const now = this.clock.now();
    // Bookkeeping before broadcast: an in-memory hub delivers synchronously.
    this.lastSentAt = now;
    this.broadcast({
      kind: 'presence:status',
      v: 1,
      actorId: state.selfId,
      seq: this.takeSeq(),
      t: now,
      status: me.status,
      mic: me.mic,
    });
  }

  tick(): void {
    if (this.clock.now() - this.lastSentAt >= HEARTBEAT_MS) this.announceSelf();
  }
}
