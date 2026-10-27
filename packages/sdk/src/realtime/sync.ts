import type { Actions } from '../game-state/actions.ts';
import type { Bus } from '../game-state/bus.ts';
import type { Store } from '../game-state/store.ts';
import type { OfficeState } from '../game-state/types.ts';
import type { Channel, ChannelStatus } from './channel.ts';
import type { NetEvent } from './protocol.ts';
import type { Clock } from '../test-harness/time.ts';
import { applyNetEventToStore } from './apply-net-event.ts';
import { InboundSeqTable } from './inbound-seq-table.ts';
import { createSeqCounter, type SeqCounter } from './seq-counter.ts';
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
  /**
   * Wall-clock source for the initial outbound seq. Deliberately separate from
   * `clock`, which may restart near 0 on reload.
   */
  seqSeed?: () => number;
  /** Start without announcing the self player until {@link SyncEngine.releaseSelf}. */
  holdSelf?: boolean;
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
  private heldSelf: boolean;
  private offStore: (() => void) | null = null;
  private offChannel: (() => void) | null = null;
  private offPresence: (() => void) | null = null;
  private offStatus: (() => void) | null = null;

  // outbound seq counter (per local actor); shared between collaborators
  private seqs: SeqCounter;

  constructor(opts: SyncEngineOpts) {
    this.store = opts.store;
    this.actions = opts.actions;
    this.channel = opts.channel;
    this.seqs = createSeqCounter(opts.seqSeed);
    this.heldSelf = opts.holdSelf ?? false;

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

  /** Highest outbound seq emitted from self (the clock-derived seed if none yet). */
  lastOutboundSeq(): number {
    return this.seqs.last();
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
    if (this.heldSelf) return;
    this.position.flushPosition();
  }

  isSelfHeld(): boolean {
    return this.heldSelf;
  }

  /** Ends a `holdSelf` hold, announcing the current self pose and name once. No-op if not held. */
  releaseSelf(): void {
    if (!this.heldSelf) return;
    this.heldSelf = false;
    this.announceSelf();
  }

  /**
   * Unconditionally broadcast the current `worldMap`, `characterConfigs`
   * and `worldObjects` from this peer's store. The regular `onStoreChange` diff path only
   * broadcasts when the values *change* — but on first connect we want
   * to publish the canonical state even if it happens to equal the SDK
   * defaults, so a later-joining peer (e.g. a bot spawned in the
   * realtime-server's process) picks it up.
   *
   * Call this once after `start()` from the source-of-truth peer (the
   * studio browser, which owns the map and scene edits).
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
    if (!this.heldSelf) this.position.announceSelf();

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
        // A returning peer's join snapshot restarts its seqs at 1.
        // ponytail: peers present across a client-only blip keep their seqs, so their re-sent snapshot is dropped until they next send.
        this.inbound.getInboundSeqTable().forget(id);
      }
    });
    // A restarted server, or a peer that forgot us while we were away,
    // only learns our pose and name from a fresh announce.
    let prevStatus: ChannelStatus | null = null;
    this.offStatus = this.channel.onStatusChange((status) => {
      if (prevStatus === 'reconnecting' && status === 'live') {
        if (!this.heldSelf) this.announceSelf();
      }
      prevStatus = status;
    });
  }

  stop(): void {
    if (!this.started) return;
    this.offStore?.();
    this.offChannel?.();
    this.offPresence?.();
    this.offStatus?.();
    this.started = false;
  }

  // --- Internal -------------------------------------------------------

  private announceSelf(): void {
    this.position.announceSelf();
    this.stateDiff.announceAvatar();
  }

  private onStoreChange(next: OfficeState, prev: OfficeState): void {
    this.stateDiff.onStoreChange(next, prev, !this.heldSelf);
    this.flushPosition();
  }

  /**
   * Anti-echo: after the InboundRouter applies a remote
   * `world:map` / `world:characters` / `world:objects`, tell the
   * outbound StateDiff collaborator that this value was just received
   * so its next `onStoreChange` diff doesn't re-broadcast it.
   */
  private onInboundApplied(event: NetEvent): void {
    if (event.kind === 'world:map') {
      this.stateDiff.markWorldMap(event.map);
    } else if (event.kind === 'world:characters') {
      this.stateDiff.markCharacterConfigs(event.configs);
    } else if (event.kind === 'world:objects') {
      this.stateDiff.markWorldObjects(event.objects);
    }
  }

  private broadcast(event: NetEvent): void {
    void this.channel.send(event);
  }

  private takeSeq(): number {
    return this.seqs.next();
  }
}
