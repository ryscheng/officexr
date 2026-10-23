import {
  attachProximityReducer,
  createActions,
  createBus,
  createRuleRegistry,
  createStore,
  serializeOfficeState,
  SnapshotHandshake,
  SyncEngine,
} from '@officexr/sdk';
import type { Actions, Bus, Channel, PlayerId, RuleRegistry, Store } from '@officexr/sdk';
import { Communication } from '../communication/communication.ts';
import type { VoiceAdapter } from '../communication/types.ts';

/** The local player's store bundle; outlives any one channel connection. */
export interface PersistentLocalState {
  selfId: PlayerId;
  officeId: string;
  store: Store;
  actions: Actions;
  bus: Bus;
  rules: RuleRegistry;
}

export function createPersistentLocalState(opts: {
  selfId: PlayerId;
  officeId: string;
  startPos?: { x: number; y: number; z: number };
}): PersistentLocalState {
  const store = createStore({ selfId: opts.selfId, officeId: opts.officeId });
  const bus = createBus();
  const actions = createActions(store, bus);
  actions.upsertPlayer({
    id: opts.selfId,
    name: 'You',
    pos: opts.startPos ?? { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
  });
  const rules = createRuleRegistry();
  // Proximity + bump events are emitted directly by the Rapier
  // collision/sensor bridges (`packages/world/src/physics/bridge.ts`)
  // — no SDK collision-pass rules needed any more.
  attachProximityReducer(store, bus);
  return { selfId: opts.selfId, officeId: opts.officeId, store, actions, bus, rules };
}

export interface OfficeSync {
  sync: SyncEngine;
  handshake: SnapshotHandshake;
  comm: Communication;
  /** Stops sync, handshake and communication; the caller closes the channel. */
  stop: () => void;
}

/** Subscribes `channel` and starts syncing `local` over it. */
export async function startOfficeSync({
  local,
  channel,
  voice,
  holdSelf,
}: {
  local: PersistentLocalState;
  channel: Channel;
  voice: VoiceAdapter;
  holdSelf?: boolean;
}): Promise<OfficeSync> {
  const clock = { now: () => performance.now() };
  const sync = new SyncEngine({
    store: local.store,
    actions: local.actions,
    bus: local.bus,
    channel,
    clock,
    holdSelf,
  });
  const handshake = new SnapshotHandshake({
    selfId: local.selfId,
    store: local.store,
    actions: local.actions,
    sync,
    channel,
    clock,
    serialize: () => {
      const state = local.store.getState();
      if (!sync.isSelfHeld()) return serializeOfficeState(state);
      const { [local.selfId]: _self, ...players } = state.players;
      return serializeOfficeState({ ...state, players });
    },
  });
  const comm = new Communication({
    officeId: local.officeId,
    selfId: local.selfId,
    store: local.store,
    actions: local.actions,
    bus: local.bus,
    voice,
  });

  // `closed` only follows our own close() on unmount; there is nothing left to show.
  const offStatus = channel.onStatusChange((status) => {
    if (status !== 'closed') {
      local.actions.setRealtimeStatus(status);
    }
  });
  await channel.subscribe();
  channel.trackPresence({});
  sync.start();
  handshake.start();
  comm.start();

  return {
    sync,
    handshake,
    comm,
    stop: () => {
      offStatus();
      comm.stop();
      sync.stop();
      handshake.stop();
    },
  };
}
