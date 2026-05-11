import type { Actions } from '../game-state/actions.ts';
import type { Bus } from '../game-state/bus.ts';
import type { Store } from '../game-state/store.ts';
import type {
  ChatMessage,
  OfficeState,
  PlayerId,
  Vec3,
} from '../game-state/types.ts';
import type { Channel } from './channel.ts';
import {
  PROTOCOL,
  validateNetEvent,
  versionMismatch,
  type NetEvent,
} from './protocol.ts';
import type { Clock } from '../test-harness/time.ts';
import { InboundSeqTable } from './inbound-seq-table.ts';

export const POSITION_CONSTANTS = {
  deltaP: 0.05, // m
  deltaY: 0.05, // rad
  maxHz: 30,
  stopGraceMs: 100,
};

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

const ZERO_V: Vec3 = { x: 0, y: 0, z: 0 };

interface SyncEngineOpts {
  store: Store;
  actions: Actions;
  bus: Bus;
  channel: Channel;
  clock: Clock;
  /** Optional shared seq table so other modules (e.g. SnapshotHandshake) can read/seed it. */
  inboundSeqs?: InboundSeqTable;
}

export class SyncEngine {
  private store: Store;
  private actions: Actions;
  private bus: Bus;
  private channel: Channel;
  private clock: Clock;

  private started = false;
  private offStore: (() => void) | null = null;
  private offChannel: (() => void) | null = null;
  private offPresence: (() => void) | null = null;

  // outbound seq counter (per local actor)
  private nextSeq = 1;

  // position tracking
  private lastSentPos: Vec3 = { ...ZERO_V };
  private lastSentYaw = 0;
  private lastSentTMs = -Infinity;
  private wasMoving = false;
  private hasInitialPosition = false;
  private pendingStopCheckSinceMs: number | null = null;

  // outbound dedupe of state-driven events (chat, stroke). We hash the last
  // chat length / stroke count we've broadcast so subscribeAll diffs only
  // emit the new entries.
  private lastChatLen = 0;
  private lastStrokeCount = 0;
  /** Last broadcast worldSettings — kept as a JSON string for cheap equality. */
  private lastWorldSettingsJson = '';
  /** Last broadcast worldMap (JSON-string). Map mutations are infrequent
   * compared to position/chat, so the stringify cost is acceptable. */
  private lastWorldMapJson = '';

  // inbound dedupe (shared collaborator so SnapshotHandshake can seed it)
  private inboundSeqs: InboundSeqTable;
  private versionWarnedKinds = new Set<string>();

  // pause/buffer flag for the snapshot window
  private paused = false;
  private pausedQueue: NetEvent[] = [];

  constructor(opts: SyncEngineOpts) {
    this.store = opts.store;
    this.actions = opts.actions;
    this.bus = opts.bus;
    this.channel = opts.channel;
    this.clock = opts.clock;
    this.inboundSeqs = opts.inboundSeqs ?? new InboundSeqTable();
  }

  /** The shared inbound seq table (so SnapshotHandshake can read/seed it). */
  getInboundSeqTable(): InboundSeqTable {
    return this.inboundSeqs;
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
    this.paused = true;
  }

  /** Apply any buffered events (after snapshot has been applied + seqs seeded). */
  resumeInbound(): void {
    this.paused = false;
    const drain = this.pausedQueue;
    this.pausedQueue = [];
    for (const event of drain) this.dispatchInbound(event);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    // Record initial baselines from current state so the first real change
    // is treated as a delta against startup, not absorbed into the baseline.
    const initial = this.store.getState();
    this.lastChatLen = initial.chat.length;
    this.lastStrokeCount = initial.whiteboard.strokes.length;
    this.lastWorldSettingsJson = JSON.stringify(initial.worldSettings);
    this.lastWorldMapJson = JSON.stringify(initial.worldMap);
    const me = initial.players[initial.selfId];
    if (me) {
      this.lastSentPos = { ...me.pos };
      this.lastSentYaw = me.yaw;
      this.hasInitialPosition = true;
      // Announce ourselves to any peers already on the channel. Receivers
      // upsert-on-missing in applyRemotePosition, so this single broadcast
      // is what makes a stationary new peer visible to everyone else
      // without any extra membership protocol. Vel is zero — this is a
      // spawn pose, not a movement update.
      this.broadcast({
        kind: 'presence:position',
        v: 1,
        actorId: initial.selfId,
        seq: this.takeSeq(),
        t: this.clock.now(),
        pos: { ...me.pos },
        vel: { ...ZERO_V },
        yaw: me.yaw,
      });
      // Leave lastSentTMs at -Infinity so the next real movement isn't
      // rate-capped by `aboveCeiling`. The throttle protects against burst
      // *user* moves, not the one-time spawn announcement.
    }
    this.offStore = this.store.subscribeAll((next, prev) => this.onStoreChange(next, prev));
    this.offChannel = this.channel.on((event) => this.onInbound(event));
    // When a peer's channel disconnects, the hub fires presence-leave for
    // their id. We mirror that into a removePlayer so the local store
    // doesn't keep a ghost player record for someone who's gone.
    this.offPresence = this.channel.onPresenceChange((_joined, left) => {
      for (const id of left) {
        if (id === initial.selfId) continue; // never remove self
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

  // --- Outbound ----------------------------------------------------

  private onStoreChange(next: OfficeState, prev: OfficeState): void {
    // chat: send any newly-appended messages whose author is self
    if (next.chat.length > prev.chat.length) {
      const added = next.chat.slice(this.lastChatLen);
      for (const msg of added) {
        if (msg.authorId === next.selfId) {
          this.broadcast({
            kind: 'chat:message',
            v: 1,
            actorId: next.selfId,
            seq: this.takeSeq(),
            t: this.clock.now(),
            text: msg.text,
          });
        }
      }
      this.lastChatLen = next.chat.length;
    }

    // whiteboard strokes (only authored locally)
    const nextStrokes = next.whiteboard.strokes;
    if (nextStrokes.length > this.lastStrokeCount) {
      const added = nextStrokes.slice(this.lastStrokeCount);
      for (const stroke of added) {
        if (stroke.authorId === next.selfId) {
          this.broadcast({
            kind: 'whiteboard:stroke',
            v: 1,
            actorId: next.selfId,
            seq: this.takeSeq(),
            t: this.clock.now(),
            stroke,
          });
        }
      }
      this.lastStrokeCount = nextStrokes.length;
    }

    // worldSettings: broadcast on any change. Cheap shallow-JSON equality is
    // fine — the struct is tiny and rarely mutates.
    const nextWS = JSON.stringify(next.worldSettings);
    if (nextWS !== this.lastWorldSettingsJson) {
      this.lastWorldSettingsJson = nextWS;
      this.broadcast({
        kind: 'world:settings',
        v: 1,
        actorId: next.selfId,
        seq: this.takeSeq(),
        t: this.clock.now(),
        settings: { ...next.worldSettings },
      });
    }

    // worldMap: broadcast on any change. Same JSON-equality dedupe; the map
    // changes far less often than positions, so the stringify cost is
    // bounded.
    const nextWM = JSON.stringify(next.worldMap);
    if (nextWM !== this.lastWorldMapJson) {
      this.lastWorldMapJson = nextWM;
      this.broadcast({
        kind: 'world:map',
        v: 1,
        actorId: next.selfId,
        seq: this.takeSeq(),
        t: this.clock.now(),
        map: next.worldMap,
      });
    }

    // position: throttled
    this.flushPosition();
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
      this.hasInitialPosition = true;
      return;
    }

    const dPos = distance(me.pos, this.lastSentPos);
    const dYaw = angleDelta(me.yaw, this.lastSentYaw);
    const dt = now - this.lastSentTMs;
    const aboveCeiling = dt < 1000 / POSITION_CONSTANTS.maxHz;
    const movedEnough = dPos > POSITION_CONSTANTS.deltaP || dYaw > POSITION_CONSTANTS.deltaY;

    if (movedEnough && !aboveCeiling) {
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
      const event = {
        kind: 'presence:position' as const,
        v: 1 as const,
        actorId: state.selfId,
        seq: this.takeSeq(),
        t: now,
        pos: { ...me.pos },
        vel,
        yaw: me.yaw,
      };
      this.lastSentPos = { ...me.pos };
      this.lastSentYaw = me.yaw;
      this.lastSentTMs = now;
      this.wasMoving = true;
      this.pendingStopCheckSinceMs = null;
      this.broadcast(event);
      return;
    }

    // Stop detection: previously moving, now under threshold
    if (this.wasMoving && !movedEnough) {
      if (this.pendingStopCheckSinceMs === null) {
        this.pendingStopCheckSinceMs = now;
      }
      const sinceQuiet = now - this.pendingStopCheckSinceMs;
      if (sinceQuiet >= POSITION_CONSTANTS.stopGraceMs) {
        // Same ordering as above: update bookkeeping before broadcast
        // so re-entrant flushPosition sees the new lastSent state.
        const event = {
          kind: 'presence:position' as const,
          v: 1 as const,
          actorId: state.selfId,
          seq: this.takeSeq(),
          t: now,
          pos: { ...me.pos },
          vel: { ...ZERO_V },
          yaw: me.yaw,
        };
        this.lastSentPos = { ...me.pos };
        this.lastSentYaw = me.yaw;
        this.lastSentTMs = now;
        this.wasMoving = false;
        this.pendingStopCheckSinceMs = null;
        this.broadcast(event);
      }
    }
  }

  /** Manually broadcast a typed event (e.g. for screen-share signaling). */
  send(event: NetEvent): void {
    this.broadcast(event);
  }

  /**
   * Unconditionally broadcast the current `worldSettings` and `worldMap`
   * from this peer's store. The regular `onStoreChange` diff path only
   * broadcasts when the values *change* — but on first connect we want
   * to publish the canonical state even if it happens to equal the SDK
   * defaults, so a later-joining peer (e.g. a bot spawned in the
   * realtime-server's process) picks it up. Updates the anti-echo JSON
   * markers so the next `onStoreChange` doesn't re-broadcast the same
   * payload.
   *
   * Call this once after `start()` from the source-of-truth peer (the
   * debug-app browser, which owns the Leva-driven settings).
   */
  broadcastWorldState(): void {
    const state = this.store.getState();
    const wsJson = JSON.stringify(state.worldSettings);
    const wmJson = JSON.stringify(state.worldMap);
    this.lastWorldSettingsJson = wsJson;
    this.lastWorldMapJson = wmJson;
    this.broadcast({
      kind: 'world:settings',
      v: 1,
      actorId: state.selfId,
      seq: this.takeSeq(),
      t: this.clock.now(),
      settings: { ...state.worldSettings },
    });
    this.broadcast({
      kind: 'world:map',
      v: 1,
      actorId: state.selfId,
      seq: this.takeSeq(),
      t: this.clock.now(),
      map: state.worldMap,
    });
  }

  private broadcast(event: NetEvent): void {
    void this.channel.send(event);
  }

  private takeSeq(): number {
    return this.nextSeq++;
  }

  // --- Inbound ----------------------------------------------------
  //
  // Stage order (load-bearing):
  //   1. envelope + payload validation (drops malformed events)
  //   2. version mismatch (warns once per kind, drops the event)
  //   3. snapshot:* short-circuit (handshake owns those)
  //   4. pause check (snapshot window buffers everything else)
  //   5. dispatch → dedup → authority lint → apply
  //
  // Reordering any of these has subtle consequences (e.g. running pause
  // before validation buffers garbage; running dedup before pause makes
  // the snapshot's seqTable seeding race with the queue drain).

  private onInbound(raw: NetEvent | unknown): void {
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

    // snapshot:* are owned by SnapshotHandshake; the engine must not apply
    // or buffer them. They flow to handshake's own channel subscription.
    if (event.kind === 'snapshot:request' || event.kind === 'snapshot:offer') return;

    if (this.paused) {
      this.pausedQueue.push(event);
      return;
    }

    this.dispatchInbound(event);
  }

  /** Apply a (validated, non-snapshot) event subject to dedup. */
  private dispatchInbound(event: NetEvent): void {
    if (this.inboundSeqs.isDuplicate(event.actorId, event.seq)) return;
    this.inboundSeqs.markSeen(event.actorId, event.seq);
    this.maybeAuthorityWarn(event);
    this.applyToStore(event);
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

  private applyToStore(event: NetEvent): void {
    // Update anti-echo bookkeeping for fields we'd otherwise re-broadcast
    // on the next tick. Server-side consumers don't need this and use
    // `applyNetEventToStore` directly.
    if (event.kind === 'world:settings') {
      this.lastWorldSettingsJson = JSON.stringify(event.settings);
    } else if (event.kind === 'world:map') {
      this.lastWorldMapJson = JSON.stringify(event.map);
    }
    applyNetEventToStore(this.actions, event, this.clock);
  }
}

/**
 * Apply a single validated, non-snapshot NetEvent to a Store via its
 * Actions. The SyncEngine uses this internally; the realtime server uses
 * it to keep its authoritative store in sync with everything that flows
 * over the hub. Does *not* touch anti-echo state — callers that also
 * broadcast outbound events must track that separately.
 */
export function applyNetEventToStore(
  actions: Actions,
  event: NetEvent,
  clock: Clock,
): void {
  switch (event.kind) {
    case 'presence:position':
      actions.applyRemotePosition(
        event.actorId,
        event.pos,
        event.vel,
        event.yaw,
        clock.now(),
      );
      return;
    case 'chat:message': {
      const msg: ChatMessage = {
        id: `${event.actorId}:${event.seq}`,
        authorId: event.actorId,
        text: event.text,
        t: event.t,
      };
      actions.applyRemoteChat(msg);
      return;
    }
    case 'whiteboard:stroke':
      actions.applyRemoteStroke(event.stroke);
      return;
    case 'avatar:update':
      actions.upsertPlayer({ id: event.actorId, avatar: event.avatar });
      return;
    case 'shot:hit':
      actions.applyHit(event.targetId, event.dmg, event.actorId);
      return;
    case 'zombie:state':
      actions.applyZombieState(event.state);
      return;
    case 'world:settings':
      actions.applyRemoteWorldSettings(event.settings);
      return;
    case 'world:map':
      actions.applyRemoteWorldMap(event.map);
      return;
    case 'snapshot:request':
    case 'snapshot:offer':
      // owned by SnapshotHandshake; callers should filter these out.
      return;
  }
  // Exhaustiveness check — adding a new NetEvent kind without a case here
  // is a compile-time error.
  const _exhaustive: never = event;
  void _exhaustive;
}
