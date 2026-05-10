import type { Bus } from './bus.ts';
import type { Store } from './store.ts';
import type {
  ChatMessage,
  InventoryItem,
  PlayerId,
  PlayerState,
  RealtimeStatus,
  Stroke,
  Vec3,
  WorldSettings,
  ZombieState,
} from './types.ts';

export interface Actions {
  // local intents
  setSelfPosition(pos: Vec3, vel: Vec3, yaw: number): void;
  setMyJitsiRoom(roomId: string | null): void;
  appendChat(msg: ChatMessage): void;
  appendStroke(stroke: Stroke): void;
  applyHit(targetId: PlayerId, dmg: number, byId: PlayerId): void;
  addInventoryItem(item: InventoryItem): void;
  removeInventoryItem(itemId: string): void;
  /** Update one or more world-level settings. Triggers a `world:settings`
   * broadcast for peers to mirror. */
  setWorldSettings(patch: Partial<WorldSettings>): void;

  // remote applications (called by sync engine)
  applyRemotePosition(
    playerId: PlayerId,
    pos: Vec3,
    vel: Vec3,
    yaw: number,
    tRecv: number,
  ): void;
  applyRemoteChat(msg: ChatMessage): void;
  applyRemoteStroke(stroke: Stroke): void;
  applyZombieState(z: ZombieState): void;
  applyRemoteWorldSettings(settings: WorldSettings): void;

  // membership
  upsertPlayer(p: Partial<PlayerState> & { id: PlayerId }): void;
  removePlayer(playerId: PlayerId): void;

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
  avatar: { model: 'default' },
  jitsiRoom: null,
  status: 'active',
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

  return {
    setSelfPosition(pos, vel, yaw) {
      patchSelf({ pos, vel, yaw });
    },

    setMyJitsiRoom(roomId) {
      patchSelf({ jitsiRoom: roomId });
    },

    setWorldSettings(patch) {
      store.setState((s) => ({
        worldSettings: { ...s.worldSettings, ...patch },
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

    applyRemotePosition(playerId, pos, vel, yaw, tRecv) {
      patchPlayer(playerId, { pos, vel, yaw, tRecv });
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

    applyRemoteWorldSettings(settings) {
      store.setState(() => ({ worldSettings: { ...settings } }));
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
