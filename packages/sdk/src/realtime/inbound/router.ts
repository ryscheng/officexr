import type { Actions } from '../../game-state/actions.ts';
import type { Bus } from '../../game-state/bus.ts';
import type { Store } from '../../game-state/store.ts';
import type { Clock } from '../../test-harness/time.ts';
import { applyNetEventToStore } from '../apply-net-event.ts';
import { InboundSeqTable } from '../inbound-seq-table.ts';
import {
  PROTOCOL,
  validateNetEvent,
  versionMismatch,
  type NetEvent,
} from '../protocol.ts';

interface InboundRouterOpts {
  store: Store;
  actions: Actions;
  bus: Bus;
  clock: Clock;
  /** Optional shared seq table so other modules (e.g. SnapshotHandshake)
   * can read/seed it. */
  inboundSeqs?: InboundSeqTable;
  /** Hook invoked AFTER a validated, non-snapshot, non-duplicate event
   * has been applied. SyncEngine wires this to its outbound-side
   * StateDiffBroadcaster to update anti-echo markers for events that
   * would otherwise be re-broadcast on the next tick. */
  onApplied?: (event: NetEvent) => void;
}

/**
 * Owns the inbound side of `SyncEngine` — validation, version
 * gating, snapshot short-circuit, pause-buffer, dedup, authority
 * lint, and apply.
 *
 * Stage order (load-bearing — this is the public contract):
 *   1. envelope + payload validation (drops malformed events)
 *   2. version mismatch (warns once per kind, drops the event)
 *   3. snapshot:* short-circuit (handshake owns those)
 *   4. pause check (snapshot window buffers everything else)
 *   5. dispatch → dedup → authority lint → apply
 *
 * Reordering any of these has subtle consequences (e.g. running pause
 * before validation buffers garbage; running dedup before pause makes
 * the snapshot's seqTable seeding race with the queue drain).
 */
export class InboundRouter {
  private store: Store;
  private actions: Actions;
  private bus: Bus;
  private clock: Clock;
  private onApplied?: (event: NetEvent) => void;

  private inboundSeqs: InboundSeqTable;
  private versionWarnedKinds = new Set<string>();

  private paused = false;
  private pausedQueue: NetEvent[] = [];

  constructor(opts: InboundRouterOpts) {
    this.store = opts.store;
    this.actions = opts.actions;
    this.bus = opts.bus;
    this.clock = opts.clock;
    this.onApplied = opts.onApplied;
    this.inboundSeqs = opts.inboundSeqs ?? new InboundSeqTable();
  }

  /** The shared inbound seq table (so SnapshotHandshake can read/seed it). */
  getInboundSeqTable(): InboundSeqTable {
    return this.inboundSeqs;
  }

  /**
   * Buffer inbound events instead of applying them. Used by
   * SnapshotHandshake during the snapshot window so that live
   * broadcasts arriving mid-handshake are not applied before the
   * snapshot has been laid down.
   */
  pause(): void {
    this.paused = true;
  }

  /** Apply any buffered events (after snapshot has been applied + seqs seeded). */
  resume(): void {
    this.paused = false;
    const drain = this.pausedQueue;
    this.pausedQueue = [];
    for (const event of drain) this.dispatchInbound(event);
  }

  onInbound(raw: NetEvent | unknown): void {
    const validation = validateNetEvent(raw);
    if (!validation.ok) return;
    const event = validation.event;

    if (versionMismatch(event)) {
      if (!this.versionWarnedKinds.has(event.kind)) {
        this.versionWarnedKinds.add(event.kind);
        const firstTime = this.actions.recordVersionWarning(event.kind, this.clock.now());
        if (firstTime) {
          this.bus.emit({ kind: 'realtime:version-warning', eventKind: event.kind });
        }
      }
      return;
    }

    // snapshot:* are owned by SnapshotHandshake; the router must not
    // apply or buffer them. They flow to handshake's own channel
    // subscription.
    if (event.kind === 'snapshot:request' || event.kind === 'snapshot:offer') return;

    if (this.paused) {
      this.pausedQueue.push(event);
      return;
    }

    this.dispatchInbound(event);
  }

  /** Apply a (validated, non-snapshot) event subject to dedup.
   *
   * Ordering is load-bearing: `onApplied` runs BEFORE
   * `applyNetEventToStore`. The hook updates the SyncEngine's outbound
   * anti-echo markers (e.g. `lastWorldSettingsJson`), and
   * `applyNetEventToStore` calls `store.setState`, which synchronously
   * fires `subscribeAll → StateDiffBroadcaster.onStoreChange`. If the
   * marker hasn't been updated yet, that diff comparison finds the new
   * value vs the stale marker and re-broadcasts the just-received
   * event — a cascade in a multi-peer mesh. Setting the marker first
   * makes the synchronous diff see "no change" and stay quiet.
   */
  private dispatchInbound(event: NetEvent): void {
    if (this.inboundSeqs.isDuplicate(event.actorId, event.seq)) return;
    this.inboundSeqs.markSeen(event.actorId, event.seq);
    this.maybeAuthorityWarn(event);
    this.onApplied?.(event);
    applyNetEventToStore(this.actions, event, this.clock);
  }

  /**
   * Authority lint per refactor-plan/03 §"Authority and host handover":
   * a `zombie:state` arriving from a non-host actor is logged but still
   * applied (dropping it amplifies partition disagreement; visibility
   * is enough).
   */
  private maybeAuthorityWarn(event: NetEvent): void {
    const def = PROTOCOL[event.kind];
    if (!def || def.authority !== 'host') return;
    const expectedHost = this.store.getState().zombies.hostId;
    if (expectedHost && event.actorId !== expectedHost) {
      console.warn(
        `[sync] ${event.kind} from non-host actor ${event.actorId}; current host is ${expectedHost}`,
      );
    }
  }
}
