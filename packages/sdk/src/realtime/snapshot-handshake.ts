import type { Actions } from '../game-state/actions.ts';
import type { Store } from '../game-state/store.ts';
import type { PlayerId } from '../game-state/types.ts';
import { applySnapshot, type SerializedOfficeState } from '../game-state/snapshot.ts';
import type { Channel } from './channel.ts';
import type { NetEvent } from './protocol.ts';
import type { SyncEngine } from './sync.ts';
import type { Clock } from '../test-harness/time.ts';

export const SNAPSHOT_TIMEOUT_MS = 3000;
export const SNAPSHOT_MAX_RETRIES = 3;

export function electLeader(
  presentActors: readonly PlayerId[],
  requesterId: PlayerId,
): PlayerId | null {
  const candidates = presentActors.filter((id) => id !== requesterId).slice().sort();
  return candidates.length > 0 ? candidates[0] : null;
}

interface HandshakeOpts {
  selfId: PlayerId;
  store: Store;
  actions: Actions;
  sync: SyncEngine;
  channel: Channel;
  clock: Clock;
  /** Returns the current serialized state of THIS client (used when self is the leader). */
  serialize: () => SerializedOfficeState;
}

interface PendingRequest {
  attempt: number;
  startedAtMs: number;
  resolvers: Array<() => void>;
}

export class SnapshotHandshake {
  private readonly selfId: PlayerId;
  private readonly store: Store;
  private readonly actions: Actions;
  private readonly sync: SyncEngine;
  private readonly channel: Channel;
  private readonly clock: Clock;
  private readonly serialize: () => SerializedOfficeState;

  private started = false;
  private offChannel: (() => void) | null = null;

  private pending: PendingRequest | null = null;
  private snapshotApplied = false;
  /** Per-actor next-seq counter for our own snapshot:* envelope traffic. */
  private nextSnapshotSeq = 1;

  constructor(opts: HandshakeOpts) {
    this.selfId = opts.selfId;
    this.store = opts.store;
    this.actions = opts.actions;
    this.sync = opts.sync;
    this.channel = opts.channel;
    this.clock = opts.clock;
    this.serialize = opts.serialize;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.offChannel = this.channel.on((event) => this.onEvent(event));
  }

  stop(): void {
    if (!this.started) return;
    this.offChannel?.();
    this.started = false;
  }

  /**
   * Issued by a newly-joined client to request a snapshot from the
   * lex-min leader. Resolves once the snapshot is applied (or after
   * SNAPSHOT_MAX_RETRIES timeouts have elapsed).
   *
   * During the window, the SyncEngine is paused so that live broadcasts
   * arriving mid-handshake are buffered and applied (subject to dedup
   * against the snapshot's seqTable) only after the snapshot lands.
   *
   * tickTimers() must be called by the harness/clock owner to drive
   * timeouts under FakeClock.
   */
  requestSnapshot(): Promise<void> {
    if (this.pending) {
      return new Promise<void>((resolve) => {
        this.pending!.resolvers.push(resolve);
      });
    }
    this.actions.setRealtimeStatus('snapshot-pending');
    this.snapshotApplied = false;
    this.sync.pauseInbound();
    return new Promise<void>((resolve) => {
      this.pending = {
        attempt: 1,
        startedAtMs: this.clock.now(),
        resolvers: [resolve],
      };
      this.broadcastRequest();
    });
  }

  /**
   * Drives timeout-based retries. Tests call this after FakeClock.advance().
   * In production a setInterval would call it on a tick.
   */
  tickTimers(): void {
    const p = this.pending;
    if (!p) return;
    const elapsed = this.clock.now() - p.startedAtMs;
    if (elapsed >= SNAPSHOT_TIMEOUT_MS) {
      if (p.attempt > SNAPSHOT_MAX_RETRIES) {
        // surrender: proceed live with whatever we have
        this.finish();
        return;
      }
      p.attempt++;
      p.startedAtMs = this.clock.now();
      this.broadcastRequest();
    }
  }

  private broadcastRequest(): void {
    void this.channel.send({
      kind: 'snapshot:request',
      v: 1,
      actorId: this.selfId,
      seq: this.nextSnapshotSeq++,
      t: this.clock.now(),
    });
  }

  private onEvent(event: NetEvent): void {
    switch (event.kind) {
      case 'snapshot:request':
        this.maybeRespondToRequest(event);
        return;
      case 'snapshot:offer':
        this.maybeApplyOffer(event);
        return;
      default:
        // SyncEngine handles (and during the snapshot window, buffers) all
        // other inbound events.
        return;
    }
  }

  private maybeRespondToRequest(event: NetEvent & { kind: 'snapshot:request' }): void {
    const present = this.channel.listPresent();
    const leader = electLeader(present, event.actorId);
    if (leader !== this.selfId) return;

    // The seqTable is "what's already covered by this snapshot". For:
    //   - self: the highest seq of any NetEvent we've broadcast
    //     (sync.lastOutboundSeq()) — anything ≤ that is in our state and
    //     therefore in the snapshot we're shipping.
    //   - every other actor: the highest seq of theirs we've applied
    //     (read from the shared inbound seq table).
    const inboundSnapshot = this.sync.getInboundSeqTable().snapshot();
    const seqTable: Record<PlayerId, number> = {
      ...inboundSnapshot,
      [this.selfId]: this.sync.lastOutboundSeq(),
    };

    void this.channel.send({
      kind: 'snapshot:offer',
      v: 1,
      actorId: this.selfId,
      seq: this.nextSnapshotSeq++,
      t: this.clock.now(),
      target: event.actorId,
      state: this.serialize(),
      seqTable,
    });
  }

  private maybeApplyOffer(event: NetEvent & { kind: 'snapshot:offer' }): void {
    if (event.target !== this.selfId) return;
    if (this.snapshotApplied) return;
    if (!this.pending) return;

    // Apply snapshot (preserving selfId/officeId).
    this.store.setState((s) => {
      const target = { ...s };
      applySnapshot(target, event.state);
      return target;
    });

    // Seed the shared inbound seq table so already-known events from the
    // snapshot window are deduped on drain.
    this.sync.getInboundSeqTable().seed(event.seqTable);

    this.snapshotApplied = true;
    this.finish();
  }

  private finish(): void {
    const p = this.pending;
    this.pending = null;
    this.actions.setRealtimeStatus('live');
    // Resume inbound: any events buffered during the window now flow into
    // the engine and are deduped against the seeded seqTable.
    this.sync.resumeInbound();
    if (!p) return;
    for (const resolve of p.resolvers) resolve();
  }
}
