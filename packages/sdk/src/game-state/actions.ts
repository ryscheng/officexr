import type { Bus } from './bus.ts';
import type { Store } from './store.ts';
import type {
  AvatarData,
  CharacterConfig,
  CharacterConfigs,
  ChatMessage,
  CubeKindId,
  InventoryItem,
  MicState,
  PlayerId,
  PlayerState,
  PresenceStatus,
  RealtimeStatus,
  Stroke,
  Vec3,
  VoiceZone,
  WorldMap,
  WorldMapLayer,
  WorldObjects,
  ZombieState,
} from './types.ts';
import { DEPARTED_LINGER_MS } from './presence.ts';
import { worldSettingsFromConstants, type WorldConstants } from './world-constants.ts';
import { cloneWorldMap } from './world-map.ts';

export interface Actions {
  // local intents
  setSelfPosition(pos: Vec3, vel: Vec3, yaw: number, isAirborne: boolean): void;
  setMyJitsiRoom(roomId: string | null): void;
  /** Patch the local player's presence. Broadcast by the `StatusBroadcaster`. */
  setSelfPresence(patch: { status?: PresenceStatus; mic?: MicState }): void;
  appendChat(msg: ChatMessage): void;
  appendStroke(stroke: Stroke): void;
  applyHit(targetId: PlayerId, dmg: number, byId: PlayerId): void;
  addInventoryItem(item: InventoryItem): void;
  removeInventoryItem(itemId: string): void;
  /** Replace the world constants (and so the derived `worldSettings`).
   * Never broadcast: only the realtime server distributes constants. */
  setWorldConstants(next: WorldConstants): void;
  /** Replace the world map. Triggers a `world:map` broadcast. */
  setWorldMap(map: WorldMap): void;
  /** Patch a single (i, j) cell in the world map to the given `kindId`,
   * or remove it from all layers when `kindId` is null. Composes
   * `setWorldMap` under the hood — uses the existing `world:map`
   * broadcast path, no new NetEvent required. The kindId must already
   * exist in `worldMap.kinds`; unknown kinds are a no-op. */
  setWorldMapCell(i: number, j: number, kindId: CubeKindId | null): void;
  /** Patch per-character config for a single model id. Merges into any
   * existing entry and triggers a `world:characters` broadcast. */
  setCharacterConfig(modelId: string, patch: Partial<CharacterConfig>): void;
  /** Replace the entire characterConfigs map (used by snapshot apply
   * paths and bulk imports). */
  setCharacterConfigs(configs: CharacterConfigs): void;
  /** Replace the compiled scene-objects snapshot. The studio's Scenes
   * mode calls this whenever its command list re-compiles. Triggers
   * a `world:objects` broadcast. */
  setWorldObjects(objects: WorldObjects): void;
  /** Local-only: never broadcast. */
  setVoiceZones(zones: VoiceZone[]): void;

  // remote applications (called by sync engine)
  applyRemotePosition(
    playerId: PlayerId,
    pos: Vec3,
    vel: Vec3,
    yaw: number,
    tRecv: number,
    isAirborne: boolean,
  ): void;
  applyRemotePresence(playerId: PlayerId, status: PresenceStatus, mic: MicState, now: number): void;
  applyRemoteAvatar(playerId: PlayerId, avatar: AvatarData, name: string, now: number): void;
  applyRemoteChat(msg: ChatMessage): void;
  applyRemoteStroke(stroke: Stroke): void;
  applyZombieState(z: ZombieState): void;
  applyRemoteWorldMap(map: WorldMap): void;
  applyRemoteCharacterConfigs(configs: CharacterConfigs): void;
  applyRemoteWorldObjects(objects: WorldObjects): void;

  // membership
  upsertPlayer(p: Partial<PlayerState> & { id: PlayerId }): void;
  removePlayer(playerId: PlayerId): void;
  /** Remember a player who is about to be removed, for `DEPARTED_LINGER_MS`. */
  recordDeparted(playerId: PlayerId, now: number): void;
  clearDeparted(playerId: PlayerId): void;
  pruneDeparted(now: number): void;

  // realtime status helpers
  setRealtimeStatus(status: RealtimeStatus): void;
  recordVersionWarning(eventKind: string, t: number): boolean;

  /** Advance the runtime tick clock; called by the frame loop / harness. */
  tick(now: number): void;
}

const DEFAULT_PLAYER: Omit<PlayerState, 'id'> = {
  name: '',
  pos: { x: 0, y: 0, z: 0 },
  vel: { x: 0, y: 0, z: 0 },
  yaw: 0,
  hp: 100,
  isDead: false,
  isAirborne: false,
  avatar: { model: 'default' },
  jitsiRoom: null,
  status: 'available',
  mic: 'none',
};

/**
 * Optional Bus is supplied so actions that have a state-change-→-event
 * counterpart (combat:hit, inventory:added/removed) can emit on creation
 * without a separate rule. Pass `bus = createBus()` (or skip) if the caller
 * doesn't care about emissions (e.g. a unit test that asserts state only).
 */
export function createActions(store: Store, bus?: Bus): Actions {
  function patchSelf(patch: Partial<PlayerState>): void {
    store.setState((s) => {
      const me = s.players[s.selfId];
      if (!me) return {};
      return {
        players: { ...s.players, [s.selfId]: { ...me, ...patch } },
      };
    });
  }

  function patchPlayer(id: PlayerId, patch: Partial<PlayerState>): void {
    store.setState((s) => {
      const existing = s.players[id];
      if (!existing) return {};
      return {
        players: { ...s.players, [id]: { ...existing, ...patch } },
      };
    });
  }

  // Any remote event is an implicit "this peer is here": upsert-on-missing lets
  // peers that join without a snapshot handshake materialise, with
  // DEFAULT_PLAYER filling the fields not on the wire.
  function upsertRemote(id: PlayerId, patch: Partial<PlayerState>, now: number): void {
    store.setState((s) => {
      const existing = s.players[id];
      const next: PlayerState = {
        ...(existing ?? { ...DEFAULT_PLAYER, id }),
        ...patch,
        firstSeenAt: existing?.firstSeenAt ?? now,
      };
      return { players: { ...s.players, [id]: next } };
    });
  }

  return {
    setSelfPosition(pos, vel, yaw, isAirborne) {
      patchSelf({ pos, vel, yaw, isAirborne });
    },

    setMyJitsiRoom(roomId) {
      patchSelf({ jitsiRoom: roomId });
    },

    setSelfPresence({ status, mic }) {
      patchSelf({ ...(status && { status }), ...(mic && { mic }) });
    },

    setWorldConstants(next) {
      store.setState(() => ({
        worldConstants: next,
        worldSettings: worldSettingsFromConstants(next),
      }));
    },

    setWorldMap(map) {
      store.setState(() => ({ worldMap: cloneWorldMap(map) }));
    },

    setWorldMapCell(i, j, kindId) {
      store.setState((s) => {
        const map = s.worldMap;
        if (kindId !== null && !map.kinds[kindId]) return {};
        // Remove (i, j) from every existing layer first; then append it
        // to the target kind's layer (creating one if needed). Layers
        // with zero cells are dropped to keep the wire payload tight.
        const stripped: WorldMapLayer[] = [];
        for (const layer of map.layers) {
          const cells = layer.cells.filter((c) => c.i !== i || c.j !== j);
          if (cells.length > 0) stripped.push({ kind: layer.kind, cells });
        }
        let nextLayers = stripped;
        if (kindId !== null) {
          const idx = stripped.findIndex((l) => l.kind === kindId);
          if (idx === -1) {
            nextLayers = [...stripped, { kind: kindId, cells: [{ i, j }] }];
          } else {
            nextLayers = stripped.map((layer, k) =>
              k === idx
                ? { kind: layer.kind, cells: [...layer.cells, { i, j }] }
                : layer,
            );
          }
        }
        return { worldMap: { ...map, layers: nextLayers } };
      });
    },

    setCharacterConfig(modelId, patch) {
      store.setState((s) => {
        const existing = s.characterConfigs[modelId] ?? {};
        return {
          characterConfigs: {
            ...s.characterConfigs,
            [modelId]: { ...existing, ...patch },
          },
        };
      });
    },

    setCharacterConfigs(configs) {
      store.setState(() => ({ characterConfigs: { ...configs } }));
    },

    setVoiceZones(zones) {
      store.setState(() => ({ voiceZones: zones }));
    },

    setWorldObjects(objects) {
      // Defensive clone — instances are mutated by editors that may
      // share references with us. Snapshot ensures the store sees a
      // change-by-value, which the diff broadcaster relies on.
      store.setState(() => ({
        worldObjects: {
          cubeSize: objects.cubeSize,
          instances: objects.instances.map((i) => ({
            ...i,
            position: [...i.position] as [number, number, number],
          })),
        },
      }));
    },

    appendChat(msg) {
      store.setState((s) => ({ chat: [...s.chat, msg] }));
    },

    appendStroke(stroke) {
      store.setState((s) => ({
        whiteboard: { ...s.whiteboard, strokes: [...s.whiteboard.strokes, stroke] },
      }));
    },

    applyHit(targetId, dmg, byId) {
      let landed = false;
      let killed = false;
      store.setState((s) => {
        const target = s.players[targetId];
        if (!target) return {};
        landed = true;
        const hp = Math.max(0, target.hp - dmg);
        if (hp === 0 && !target.isDead) killed = true;
        return {
          players: {
            ...s.players,
            [targetId]: { ...target, hp, isDead: hp === 0 },
          },
        };
      });
      // Don't emit combat events if the target didn't exist — a hit on a
      // ghost is not an event observers should react to.
      if (!landed) return;
      bus?.emit({ kind: 'combat:hit', targetId, dmg, byId });
      if (killed) bus?.emit({ kind: 'combat:killed', targetId, byId });
    },

    addInventoryItem(item) {
      store.setState((s) => ({ inventory: [...s.inventory, item] }));
      bus?.emit({ kind: 'inventory:added', item });
    },

    removeInventoryItem(itemId) {
      let removed = false;
      store.setState((s) => {
        const before = s.inventory.length;
        const after = s.inventory.filter((i) => i.id !== itemId);
        if (after.length !== before) removed = true;
        return { inventory: after };
      });
      if (removed) bus?.emit({ kind: 'inventory:removed', itemId });
    },

    applyRemotePosition(playerId, pos, vel, yaw, tRecv, isAirborne) {
      upsertRemote(playerId, { pos, vel, yaw, tRecv, isAirborne }, tRecv);
    },

    applyRemotePresence(playerId, status, mic, now) {
      upsertRemote(playerId, { status, mic, lastStatusAt: now }, now);
    },

    applyRemoteAvatar(playerId, avatar, name, now) {
      upsertRemote(playerId, { avatar, name }, now);
    },

    applyRemoteChat(msg) {
      store.setState((s) => ({ chat: [...s.chat, msg] }));
    },

    applyRemoteStroke(stroke) {
      store.setState((s) => ({
        whiteboard: { ...s.whiteboard, strokes: [...s.whiteboard.strokes, stroke] },
      }));
    },

    applyZombieState(z) {
      store.setState(() => ({ zombies: z }));
    },

    applyRemoteWorldMap(map) {
      store.setState(() => ({ worldMap: cloneWorldMap(map) }));
    },

    applyRemoteCharacterConfigs(configs) {
      const cloned: CharacterConfigs = {};
      for (const [id, cfg] of Object.entries(configs)) {
        cloned[id] = { ...cfg };
      }
      store.setState(() => ({ characterConfigs: cloned }));
    },

    applyRemoteWorldObjects(objects) {
      store.setState(() => ({
        worldObjects: {
          cubeSize: objects.cubeSize,
          instances: objects.instances.map((i) => ({
            ...i,
            position: [...i.position] as [number, number, number],
          })),
        },
      }));
    },

    upsertPlayer(p) {
      store.setState((s) => {
        const existing = s.players[p.id];
        const next: PlayerState = existing
          ? { ...existing, ...p }
          : { ...DEFAULT_PLAYER, ...p, id: p.id };
        return { players: { ...s.players, [p.id]: next } };
      });
    },

    removePlayer(playerId) {
      store.setState((s) => {
        if (!s.players[playerId]) return {};
        const players = { ...s.players };
        delete players[playerId];
        return { players };
      });
    },

    recordDeparted(playerId, now) {
      store.setState((s) => ({
        departed: {
          ...s.departed,
          [playerId]: { name: s.players[playerId]?.name ?? '', leftAt: now },
        },
      }));
    },

    clearDeparted(playerId) {
      if (!store.getState().departed[playerId]) return;
      store.setState((s) => {
        const { [playerId]: _gone, ...departed } = s.departed;
        return { departed };
      });
    },

    pruneDeparted(now) {
      const stale = (d: { leftAt: number }) => now - d.leftAt > DEPARTED_LINGER_MS;
      if (!Object.values(store.getState().departed).some(stale)) return;
      store.setState((s) => ({
        departed: Object.fromEntries(Object.entries(s.departed).filter(([, d]) => !stale(d))),
      }));
    },

    setRealtimeStatus(status) {
      store.setState((s) => ({
        realtime: { ...s.realtime, status },
      }));
    },

    recordVersionWarning(eventKind, t) {
      let firstTime = false;
      store.setState((s) => {
        if (s.realtime.versionWarnings[eventKind] !== undefined) return {};
        firstTime = true;
        return {
          realtime: {
            ...s.realtime,
            versionWarnings: { ...s.realtime.versionWarnings, [eventKind]: t },
          },
        };
      });
      return firstTime;
    },

    tick(now) {
      store.setState((s) => ({
        runtime: { ...s.runtime, lastTick: now },
      }));
    },
  };
}
