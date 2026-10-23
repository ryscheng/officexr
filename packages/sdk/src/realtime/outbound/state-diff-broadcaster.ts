import type { Store } from '../../game-state/store.ts';
import type {
  CharacterConfigs,
  OfficeState,
  WorldMap,
  WorldObjects,
} from '../../game-state/types.ts';
import type { Clock } from '../../test-harness/time.ts';
import type { NetEvent } from '../protocol.ts';

type BroadcastFn = (event: NetEvent) => void;
type SeqFn = () => number;

interface StateDiffBroadcasterOpts {
  store: Store;
  clock: Clock;
  broadcast: BroadcastFn;
  takeSeq: SeqFn;
}

/**
 * Owns broadcast of store mutations that are *append-only* (chat,
 * whiteboard strokes) or *snapshot-on-change* (worldMap,
 * characterConfigs, worldObjects, the local player's name + avatar).
 * `worldConstants` is deliberately absent: only the realtime server
 * distributes it. Each
 * receives a diff via `onStoreChange(next, prev)` and issues a single
 * broadcast for each newly-added record / changed struct, authored by
 * self only.
 *
 * Anti-echo: when the InboundRouter applies a remote
 * `world:map` / `world:characters` / `world:objects`, the SyncEngine
 * calls `markWorldMap` / `markCharacterConfigs` / `markWorldObjects`
 * so the next `onStoreChange` doesn't re-broadcast the same payload.
 */
export class StateDiffBroadcaster {
  private store: Store;
  private clock: Clock;
  private broadcast: BroadcastFn;
  private takeSeq: SeqFn;

  // Outbound dedupe of state-driven events (chat, stroke). We hash the
  // last chat length / stroke count we've broadcast so subscribeAll
  // diffs only emit the new entries.
  private lastChatLen = 0;
  private lastStrokeCount = 0;
  /** Last broadcast worldMap (JSON-string). Map mutations are infrequent
   * compared to position/chat, so the stringify cost is acceptable. */
  private lastWorldMapJson = '';
  /** Last broadcast characterConfigs (JSON-string). Same diff shape as
   * worldMap — broadcast on any change. */
  private lastCharacterConfigsJson = '';
  /** Last broadcast worldObjects (JSON-string). Compiled scene
   * snapshots can be larger than worldMap, but the
   * editor only re-emits when commands change so the stringify cost
   * still dominates well below the position-broadcast budget. */
  private lastWorldObjectsJson = '';

  constructor(opts: StateDiffBroadcasterOpts) {
    this.store = opts.store;
    this.clock = opts.clock;
    this.broadcast = opts.broadcast;
    this.takeSeq = opts.takeSeq;
  }

  /** Record current state as the baseline so the first real mutation
   * is treated as a delta against startup, not absorbed into it. */
  captureBaseline(): void {
    const initial = this.store.getState();
    this.lastChatLen = initial.chat.length;
    this.lastStrokeCount = initial.whiteboard.strokes.length;
    this.lastWorldMapJson = JSON.stringify(initial.worldMap);
    this.lastCharacterConfigsJson = JSON.stringify(initial.characterConfigs);
    this.lastWorldObjectsJson = JSON.stringify(initial.worldObjects);
  }

  onStoreChange(next: OfficeState, prev: OfficeState, announceSelfAvatar = true): void {
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

    const me = next.players[next.selfId];
    const prevMe = prev.players[prev.selfId];
    if (announceSelfAvatar && (me?.name !== prevMe?.name || me?.avatar !== prevMe?.avatar)) {
      this.announceAvatar(next);
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

    // characterConfigs: broadcast on any change. Same diff/anti-echo
    // pattern as worldMap — the source of truth is the studio
    // browser; bots and other peers mirror.
    const nextCC = JSON.stringify(next.characterConfigs);
    if (nextCC !== this.lastCharacterConfigsJson) {
      this.lastCharacterConfigsJson = nextCC;
      this.broadcast({
        kind: 'world:characters',
        v: 1,
        actorId: next.selfId,
        seq: this.takeSeq(),
        t: this.clock.now(),
        configs: { ...next.characterConfigs },
      });
    }

    // worldObjects: same diff/anti-echo pattern. The studio's Scenes
    // mode pushes a new compiled snapshot only when the command list
    // changes, so this fires at edit-time, not per-frame.
    const nextWO = JSON.stringify(next.worldObjects);
    if (nextWO !== this.lastWorldObjectsJson) {
      this.lastWorldObjectsJson = nextWO;
      this.broadcast({
        kind: 'world:objects',
        v: 1,
        actorId: next.selfId,
        seq: this.takeSeq(),
        t: this.clock.now(),
        objects: next.worldObjects,
      });
    }
  }

  /**
   * Unconditionally broadcast the current worldMap + characterConfigs +
   * worldObjects. Called once after start() from the
   * source-of-truth peer (studio browser, which owns map and scene
   * edits) so a later-joining peer (e.g. a bot in the
   * realtime-server process) sees the canonical state even if it
   * happens to equal the SDK defaults. Updates the anti-echo JSON
   * markers so the next onStoreChange doesn't re-broadcast.
   */
  broadcastWorldState(): void {
    const state = this.store.getState();
    this.lastWorldMapJson = JSON.stringify(state.worldMap);
    this.lastCharacterConfigsJson = JSON.stringify(state.characterConfigs);
    this.lastWorldObjectsJson = JSON.stringify(state.worldObjects);
    this.broadcast({
      kind: 'world:map',
      v: 1,
      actorId: state.selfId,
      seq: this.takeSeq(),
      t: this.clock.now(),
      map: state.worldMap,
    });
    this.broadcast({
      kind: 'world:characters',
      v: 1,
      actorId: state.selfId,
      seq: this.takeSeq(),
      t: this.clock.now(),
      configs: { ...state.characterConfigs },
    });
    this.broadcast({
      kind: 'world:objects',
      v: 1,
      actorId: state.selfId,
      seq: this.takeSeq(),
      t: this.clock.now(),
      objects: state.worldObjects,
    });
  }

  /** Broadcast the local player's name + avatar, if it has a name. */
  announceAvatar(state: OfficeState = this.store.getState()): void {
    const me = state.players[state.selfId];
    // Peers only learn names from avatar:update, which requires one.
    if (!me?.name) return;
    this.broadcast({
      kind: 'avatar:update',
      v: 1,
      actorId: state.selfId,
      seq: this.takeSeq(),
      t: this.clock.now(),
      avatar: me.avatar,
      name: me.name,
    });
  }

  /** Anti-echo: called by the SyncEngine when a remote world:map is
   * applied so the next onStoreChange doesn't re-broadcast the same
   * payload. */
  markWorldMap(map: WorldMap): void {
    this.lastWorldMapJson = JSON.stringify(map);
  }

  /** Anti-echo: see {@link markWorldMap}. */
  markCharacterConfigs(configs: CharacterConfigs): void {
    this.lastCharacterConfigsJson = JSON.stringify(configs);
  }

  /** Anti-echo: see {@link markWorldMap}. */
  markWorldObjects(objects: WorldObjects): void {
    this.lastWorldObjectsJson = JSON.stringify(objects);
  }
}
