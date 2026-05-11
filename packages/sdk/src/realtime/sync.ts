import type { Actions } from '../game-state/actions.ts';
import type { Bus } from '../game-state/bus.ts';
import type { Store } from '../game-state/store.ts';
import type { OfficeState } from '../game-state/types.ts';
import type { Channel } from './channel.ts';
import type { NetEvent } from './protocol.ts';
import type { Clock } from '../test-harness/time.ts';
import { applyNetEventToStore } from './apply-net-event.ts';
import { InboundSeqTable } from './inbound-seq-table.ts';
import { InboundRouter } from './inbound/router.ts';
import {
  PositionBroadcaster,
  POSITION_CONSTANTS,
} from './outbound/position-broadcaster.ts';
import { StateDiffBroadcaster } from './outbound/state-diff-broadcaster.ts';

// Re-export so existing consumers keep working without their import paths
// changing.
export { applyNetEventToStore, POSITION_CONSTANTS };

interface SyncEngineOpts {
  store: Store;
  actions: Actions;
  bus: Bus;
  channel: Channel;
  clock: Clock;
  /** Optional shared seq table so other modules (e.g. SnapshotHandshake) can read/seed it. */
  inboundSeqs?: InboundSeqTable;
}

/**
 * Thin coordinator over three collaborators:
 *   - {@link PositionBroadcaster} — self-position cadence + stop-grace.
 *   - {@link StateDiffBroadcaster} — chat / whiteboard / world diff broadcasts.
 *   - {@link InboundRouter} — validate → version → snapshot-shortcircuit →
 *     pause-buffer → dedup → authority-warn → apply.
 *
 * Owns lifecycle (`start` / `stop`), the channel + store subscriptions,
 * and a single outbound seq counter. Delegates everything else.
 */
export class SyncEngine {
  private store: Store;
  private actions: Actions;
  private channel: Channel;

  private position: PositionBroadcaster;
  private stateDiff: StateDiffBroadcaster;
  private inbound: InboundRouter;

  private started = false;
  private offStore: (() => void) | null = null;
  private offChannel: (() => void) | null = null;
  private offPresence: (() => void) | null = null;

  // outbound seq counter (per local actor); shared between collaborators
  private nextSeq = 1;

  constructor(opts: SyncEngineOpts) {
    this.store = opts.store;
    this.actions = opts.actions;
    this.channel = opts.channel;

    const broadcast = (event: NetEvent) => this.broadcast(event);
    const takeSeq = () => this.takeSeq();

    this.position = new PositionBroadcaster({
      store: opts.store,
      clock: opts.clock,
      broadcast,
      takeSeq,
    });
    this.stateDiff = new StateDiffBroadcaster({
      store: opts.store,
      clock: opts.clock,
      broadcast,
      takeSeq,
    });
    this.inbound = new InboundRouter({
      store: opts.store,
      actions: opts.actions,
      bus: opts.bus,
      clock: opts.clock,
      inboundSeqs: opts.inboundSeqs,
      onApplied: (event) => this.onInboundApplied(event),
    });
  }

  // --- Public API (preserved for SnapshotHandshake + tests + BotDriver) ---

  /** The shared inbound seq table (so SnapshotHandshake can read/seed it). */
  getInboundSeqTable(): InboundSeqTable {
    return this.inbound.getInboundSeqTable();
  }

  /** Highest outbound seq we've emitted from self. 0 if we've sent nothing. */
  lastOutboundSeq(): number {
    return this.nextSeq - 1;
  }

  /**
   * Buffer inbound events instead of applying them. Used by SnapshotHandshake
   * during the snapshot window so that live broadcasts arriving mid-handshake
   * are not applied before the snapshot has been laid down.
   */
  pauseInbound(): void {
    this.inbound.pause();
  }

  /** Apply any buffered events (after snapshot has been applied + seqs seeded). */
  resumeInbound(): void {
    this.inbound.resume();
  }

  /** Re-check the local player's position throttle; used by harnesses
   * and the per-frame ticker so a stop-packet can fire even when no
   * store mutation happened this frame. */
  flushPosition(): void {
    this.position.flushPosition();
  }

  /**
   * Unconditionally broadcast the current `worldSettings` and `worldMap`
   * from this peer's store. The regular `onStoreChange` diff path only
   * broadcasts when the values *change* — but on first connect we want
   * to publish the canonical state even if it happens to equal the SDK
   * defaults, so a later-joining peer (e.g. a bot spawned in the
   * realtime-server's process) picks it up.
   *
   * Call this once after `start()` from the source-of-truth peer (the
   * debug-app browser, which owns the Leva-driven settings).
   */
  broadcastWorldState(): void {
    this.stateDiff.broadcastWorldState();
  }

  /** Manually broadcast a typed event (e.g. for screen-share signaling). */
  send(event: NetEvent): void {
    this.broadcast(event);
  }

  // --- Lifecycle ------------------------------------------------------

  start(): void {
    if (this.started) return;
    this.started = true;
    // Anchor outbound diffs against the current state so the first
    // real change is treated as a delta, not absorbed into the
    // baseline.
    this.stateDiff.captureBaseline();
    // Announce ourselves to peers already on the channel.
    this.position.announceSelf();

    this.offStore = this.store.subscribeAll((next, prev) =>
      this.onStoreChange(next, prev),
    );
    this.offChannel = this.channel.on((event) => this.inbound.onInbound(event));
    // When a peer's channel disconnects, the hub fires presence-leave for
    // their id. We mirror that into a removePlayer so the local store
    // doesn't keep a ghost player record for someone who's gone.
    const selfId = this.store.getState().selfId;
    this.offPresence = this.channel.onPresenceChange((_joined, left) => {
      for (const id of left) {
        if (id === selfId) continue; // never remove self
        this.actions.removePlayer(id);
      }
    });
  }

  stop(): void {
    if (!this.started) return;
    this.offStore?.();
    this.offChannel?.();
    this.offPresence?.();
    this.started = false;
  }

  // --- Internal -------------------------------------------------------

  private onStoreChange(next: OfficeState, prev: OfficeState): void {
    this.stateDiff.onStoreChange(next, prev);
    this.position.flushPosition();
  }

  /**
   * Anti-echo: after the InboundRouter applies a remote
   * `world:settings` or `world:map`, tell the outbound StateDiff
   * collaborator that this value was just received so its next
   * `onStoreChange` diff doesn't re-broadcast it.
   */
  private onInboundApplied(event: NetEvent): void {
    if (event.kind === 'world:settings') {
      this.stateDiff.markWorldSettings(event.settings);
    } else if (event.kind === 'world:map') {
      this.stateDiff.markWorldMap(event.map);
    }
  }

  private broadcast(event: NetEvent): void {
    void this.channel.send(event);
  }

  private takeSeq(): number {
    return this.nextSeq++;
  }
}
