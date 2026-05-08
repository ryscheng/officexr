import type { Actions } from '../game-state/actions.ts';
import type { Bus } from '../game-state/bus.ts';
import type { Store } from '../game-state/store.ts';
import type { ChatMessage, OfficeState, PlayerId, Vec3 } from '../game-state/types.ts';
import type { Channel } from './channel.ts';
import {
  PROTOCOL,
  validateNetEvent,
  versionMismatch,
  type NetEvent,
} from './protocol.ts';
import type { Clock } from '../test-harness/time.ts';

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

  // inbound dedupe
  private inboundSeq = new Map<PlayerId, number>();
  private versionWarnedKinds = new Set<string>();

  constructor(opts: SyncEngineOpts) {
    this.store = opts.store;
    this.actions = opts.actions;
    this.bus = opts.bus;
    this.channel = opts.channel;
    this.clock = opts.clock;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    // Record initial baselines from current state so the first real change
    // is treated as a delta against startup, not absorbed into the baseline.
    const initial = this.store.getState();
    this.lastChatLen = initial.chat.length;
    this.lastStrokeCount = initial.whiteboard.strokes.length;
    const me = initial.players[initial.selfId];
    if (me) {
      this.lastSentPos = { ...me.pos };
      this.lastSentYaw = me.yaw;
      this.hasInitialPosition = true;
    }
    this.offStore = this.store.subscribeAll((next, prev) => this.onStoreChange(next, prev));
    this.offChannel = this.channel.on((event) => this.onInbound(event));
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
      this.broadcast({
        kind: 'presence:position',
        v: 1,
        actorId: state.selfId,
        seq: this.takeSeq(),
        t: now,
        pos: { ...me.pos },
        vel,
        yaw: me.yaw,
      });
      this.lastSentPos = { ...me.pos };
      this.lastSentYaw = me.yaw;
      this.lastSentTMs = now;
      this.wasMoving = true;
      this.pendingStopCheckSinceMs = null;
      return;
    }

    // Stop detection: previously moving, now under threshold
    if (this.wasMoving && !movedEnough) {
      if (this.pendingStopCheckSinceMs === null) {
        this.pendingStopCheckSinceMs = now;
      }
      const sinceQuiet = now - this.pendingStopCheckSinceMs;
      if (sinceQuiet >= POSITION_CONSTANTS.stopGraceMs) {
        this.broadcast({
          kind: 'presence:position',
          v: 1,
          actorId: state.selfId,
          seq: this.takeSeq(),
          t: now,
          pos: { ...me.pos },
          vel: { ...ZERO_V },
          yaw: me.yaw,
        });
        this.lastSentPos = { ...me.pos };
        this.lastSentYaw = me.yaw;
        this.lastSentTMs = now;
        this.wasMoving = false;
        this.pendingStopCheckSinceMs = null;
      }
    }
  }

  /** Manually broadcast a typed event (e.g. for screen-share signaling). */
  send(event: NetEvent): void {
    this.broadcast(event);
  }

  private broadcast(event: NetEvent): void {
    void this.channel.send(event);
  }

  private takeSeq(): number {
    return this.nextSeq++;
  }

  // --- Inbound ----------------------------------------------------

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

    if (this.isDuplicate(event.actorId, event.seq)) return;
    this.markSeen(event.actorId, event.seq);

    this.applyToStore(event);
  }

  /** Public for the snapshot-handshake module to apply queued events. */
  applyInbound(event: NetEvent): void {
    this.onInbound(event);
  }

  /** Snapshot apply needs to seed the seq table without re-applying. */
  seedSeqTable(table: Record<PlayerId, number>): void {
    for (const [actorId, seq] of Object.entries(table)) {
      const current = this.inboundSeq.get(actorId) ?? 0;
      if (seq > current) this.inboundSeq.set(actorId, seq);
    }
  }

  private isDuplicate(actorId: PlayerId, seq: number): boolean {
    const last = this.inboundSeq.get(actorId);
    if (last === undefined) return false;
    return seq <= last;
  }

  private markSeen(actorId: PlayerId, seq: number): void {
    const last = this.inboundSeq.get(actorId) ?? 0;
    if (seq > last) this.inboundSeq.set(actorId, seq);
  }

  private applyToStore(event: NetEvent): void {
    switch (event.kind) {
      case 'presence:position':
        this.actions.applyRemotePosition(
          event.actorId,
          event.pos,
          event.vel,
          event.yaw,
          this.clock.now(),
        );
        break;
      case 'chat:message': {
        const msg: ChatMessage = {
          id: `${event.actorId}:${event.seq}`,
          authorId: event.actorId,
          text: event.text,
          t: event.t,
        };
        this.actions.applyRemoteChat(msg);
        break;
      }
      case 'whiteboard:stroke':
        this.actions.applyRemoteStroke(event.stroke);
        // bump our own count so we don't echo it back
        this.lastStrokeCount = this.store.getState().whiteboard.strokes.length;
        break;
      case 'avatar:update':
        this.actions.upsertPlayer({ id: event.actorId, avatar: event.avatar });
        break;
      case 'shot:hit':
        this.actions.applyHit(event.targetId, event.dmg, event.actorId);
        this.bus.emit({
          kind: 'combat:hit',
          targetId: event.targetId,
          dmg: event.dmg,
          byId: event.actorId,
        });
        break;
      case 'zombie:state':
        this.actions.applyZombieState(event.state);
        break;
      case 'screen:offer':
      case 'screen:answer':
      case 'screen:ice':
      case 'screen:stop':
        // Screen-share signaling is forwarded to the bus for the
        // Communication subsystem to handle. The store's screenShares slice
        // is updated by Communication after the WebRTC peer is set up.
        break;
      case 'bubble:prefs':
      case 'net:ping':
      case 'net:pong':
      case 'whiteboard:clear':
      case 'whiteboard:undo':
      case 'loot:open':
      case 'snapshot:request':
      case 'snapshot:offer':
        // These are handled by other modules (snapshot-handshake) or are
        // intentionally observed but not yet applied to the store.
        break;
    }
  }
}
