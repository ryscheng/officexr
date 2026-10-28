import type { Store } from '../../game-state/store.ts';
import type { Clock } from '../../test-harness/time.ts';
import type { NetEvent } from '../protocol.ts';

export const HEARTBEAT_MS = 5_000;

interface StatusBroadcasterOpts {
  store: Store;
  clock: Clock;
  broadcast: (event: NetEvent) => void;
  takeSeq: () => number;
  /** While true (`holdSelf`) nothing is sent. */
  isHeld: () => boolean;
}

/**
 * Owns the local player's outbound `presence:status`: sent on every self
 * `status`/`mic` change and re-sent by {@link tick} every {@link HEARTBEAT_MS},
 * so peers can tell a quiet player from a vanished one.
 */
export class StatusBroadcaster {
  private store: Store;
  private clock: Clock;
  private broadcast: (event: NetEvent) => void;
  private takeSeq: () => number;
  private isHeld: () => boolean;
  private lastSentAt = -Infinity;
  private off: (() => void) | null = null;

  constructor(opts: StatusBroadcasterOpts) {
    this.store = opts.store;
    this.clock = opts.clock;
    this.broadcast = opts.broadcast;
    this.takeSeq = opts.takeSeq;
    this.isHeld = opts.isHeld;
  }

  start(): void {
    this.off = this.store.subscribe(
      (s) => s.players[s.selfId],
      () => {
        if (!this.isHeld()) this.announceSelf();
      },
      (a, b) => a?.status === b?.status && a?.mic === b?.mic,
    );
  }

  stop(): void {
    this.off?.();
    this.off = null;
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
    if (this.isHeld() || this.clock.now() - this.lastSentAt < HEARTBEAT_MS) return;
    this.announceSelf();
  }
}
