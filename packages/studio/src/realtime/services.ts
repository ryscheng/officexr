import {
  attachProximityReducer,
  createActions,
  createBus,
  createInMemoryChannelHub,
  createRuleRegistry,
  createStore,
  InMemoryChannel,
  serializeOfficeState,
  SnapshotHandshake,
  SyncEngine,
} from '@officexr/sdk';
import type {
  Actions,
  Bus,
  Channel,
  PlayerId,
  RuleRegistry,
  Store,
} from '@officexr/sdk';
import { createStack, Communication } from '@officexr/core-refactor';
import { WsChannel } from '@officexr/realtime-server';
import { BotPool } from '@officexr/world/bot';
import { createBotControlPublisher, type BotControlPublisher } from './bot-control.ts';

/**
 * One bundle of "everything that depends on the realtime channel" that
 * the debug-app's mode promotion swaps atomically. The local-player
 * `store/actions/bus/rules` live OUTSIDE this bundle so position and
 * world settings carry across promotion/demotion — only the network
 * surface and the bot pool get torn down on a mode flip.
 */
export interface ChannelStack {
  mode: 'in-memory' | 'ws';
  channel: Channel;
  sync: SyncEngine;
  handshake: SnapshotHandshake;
  comm: Communication;
  bots: BotPool;
  /** Browser publisher that pokes the Node bots CLI. Only populated in
   * ws mode; in-memory mode uses the in-browser bot pool directly. */
  botControl: BotControlPublisher | null;
  /** Stops + closes everything in the right order. Idempotent. */
  teardown: () => Promise<void>;
}

/** Fields preserved across mode flips. */
export interface PersistentLocalState {
  selfId: PlayerId;
  officeId: string;
  store: Store;
  actions: Actions;
  bus: Bus;
  rules: RuleRegistry;
}

/** Build the persistent local-player state bundle. Called once on mount;
 * survives every channel-stack swap. */
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

interface BuildStackCommonOpts {
  local: PersistentLocalState;
  audio: HTMLAudioElement;
}

/**
 * In-memory mode. One hub shared by the local player and at-most-one
 * in-browser bot. Zero infra, default. Per the "in-memory cap is 1 bot"
 * rule, the page only ever calls `bots.setCount(0|1)` here.
 */
export async function buildInMemoryStack(
  opts: BuildStackCommonOpts,
): Promise<ChannelStack> {
  const { local, audio } = opts;
  const hub = createInMemoryChannelHub();
  const { channel, voiceAdapter } = createStack({
    mode: 'local',
    hub,
    selfId: local.selfId,
    onRoomJoined: () => {
      audio.play().catch((err) => {
        console.warn('[debug-app] audio autoplay blocked:', err);
      });
    },
    onRoomLeft: () => {
      audio.pause();
      audio.currentTime = 0;
    },
  });

  const clock = { now: () => performance.now() };
  const sync = new SyncEngine({
    store: local.store,
    actions: local.actions,
    bus: local.bus,
    channel,
    clock,
  });
  const handshake = new SnapshotHandshake({
    selfId: local.selfId,
    store: local.store,
    actions: local.actions,
    sync,
    channel,
    clock,
    serialize: () => serializeOfficeState(local.store.getState()),
  });
  const comm = new Communication({
    selfId: local.selfId,
    store: local.store,
    actions: local.actions,
    bus: local.bus,
    voice: voiceAdapter,
  });
  const bots = new BotPool({
    createChannel: (botId) => new InMemoryChannel(hub, botId),
    localPlayerId: local.selfId,
    // Seed each new bot with the local-player store's current world
    // state so a bot spawned after Leva has pushed user values
    // doesn't fall back to SDK defaults. (Bots spawned *before* Leva
    // mounts still pick up changes via the regular `world:settings` /
    // `world:map` broadcast path.)
    getInitialWorld: () => {
      const state = local.store.getState();
      return {
        worldSettings: { ...state.worldSettings },
        worldMap: state.worldMap,
      };
    },
    // In-browser bots can forward their controller-detected
    // `collision:char-bump` events onto the local bus so the renderer
    // plays the bump animation when a bot walks into the local
    // player.
    localBus: local.bus,
  });

  await channel.subscribe();
  channel.trackPresence({});
  sync.start();
  handshake.start();
  comm.start();

  const teardown = async () => {
    comm.stop();
    sync.stop();
    handshake.stop();
    bots.stop();
    channel.close();
    audio.pause();
  };

  return {
    mode: 'in-memory',
    channel,
    sync,
    handshake,
    comm,
    bots,
    botControl: null,
    teardown,
  };
}

/**
 * Ws mode. Local-player talks to the custom realtime server (the
 * `bots:start` Node process). The in-browser bot pool stays at zero —
 * bots live in the server process. Browser keeps a `botControl`
 * publisher so Leva count/mode changes drive the server's pool via
 * custom frames over the same channel.
 */
export async function buildWsStack(opts: {
  local: PersistentLocalState;
  audio: HTMLAudioElement;
  url: string;
}): Promise<ChannelStack> {
  const { local, audio, url } = opts;
  const { channel, voiceAdapter } = createStack({
    mode: 'ws',
    url,
    selfId: local.selfId,
    onRoomJoined: () => {
      audio.play().catch((err) => {
        console.warn('[debug-app] audio autoplay blocked:', err);
      });
    },
    onRoomLeft: () => {
      audio.pause();
      audio.currentTime = 0;
    },
  });

  const clock = { now: () => performance.now() };
  const sync = new SyncEngine({
    store: local.store,
    actions: local.actions,
    bus: local.bus,
    channel,
    clock,
  });
  const handshake = new SnapshotHandshake({
    selfId: local.selfId,
    store: local.store,
    actions: local.actions,
    sync,
    channel,
    clock,
    serialize: () => serializeOfficeState(local.store.getState()),
  });
  const comm = new Communication({
    selfId: local.selfId,
    store: local.store,
    actions: local.actions,
    bus: local.bus,
    voice: voiceAdapter,
  });
  // In ws mode the in-browser pool stays empty — bots run in the
  // realtime-server process. We still construct one so the teardown
  // surface is uniform.
  const bots = new BotPool({
    createChannel: () => {
      throw new Error('ws-mode pool should never spawn in-browser bots');
    },
    localPlayerId: local.selfId,
  });

  await channel.subscribe();
  channel.trackPresence({});
  sync.start();
  handshake.start();
  comm.start();

  // channel is typed as Channel by createStack's return; we know it's a
  // WsChannel in this mode. Narrow for the bot-control publisher.
  const botControl = createBotControlPublisher({
    channel: channel as WsChannel,
  });

  const teardown = async () => {
    comm.stop();
    sync.stop();
    handshake.stop();
    bots.stop();
    botControl.close();
    channel.close();
    audio.pause();
  };

  return {
    mode: 'ws',
    channel,
    sync,
    handshake,
    comm,
    bots,
    botControl,
    teardown,
  };
}
