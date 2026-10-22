import { createInMemoryChannelHub, InMemoryChannel } from '@officexr/sdk';
import type { Channel, SnapshotHandshake, Store, SyncEngine, WorldConstants } from '@officexr/sdk';
import {
  createStack,
  startOfficeSync,
  type Communication,
  type PersistentLocalState,
} from '@officexr/core-refactor';
import { SERVER_SELF_ID, WsChannel } from '@officexr/realtime-server';
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

interface BuildStackCommonOpts {
  local: PersistentLocalState;
  audio: HTMLAudioElement;
  /** Optional canonical AABB lookup. Threaded into the in-browser
   * BotPool so bot Rapier colliders match the visible-mesh AABB of
   * each placed object. Studio's DebugApp passes
   * `api.geometry.worldAABB`. Tests / harnesses omit it and fall
   * back to the legacy one-voxel-cube collider path. */
  instanceAABB?: import('@officexr/world').InstanceAABBLookup;
  /** Optional collider-shape override lookup. Threaded into the in-browser
   * BotPool so compound-step staircase colliders mirror what MapColliders
   * emits on the browser side. Studio's DebugApp passes
   * `(id) => api.catalog.getKind(id)?.colliderShape`. */
  colliderShape?: import('@officexr/world').ColliderShapeLookup;
}

/**
 * In-memory mode. One hub shared by the local player and at-most-one
 * in-browser bot. Zero infra, default. Per the "in-memory cap is 1 bot"
 * rule, the page only ever calls `bots.setCount(0|1)` here.
 */
export async function buildInMemoryStack(
  opts: BuildStackCommonOpts,
): Promise<ChannelStack> {
  const { local, audio, instanceAABB, colliderShape } = opts;
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

  const bots = new BotPool({
    createChannel: (botId) => new InMemoryChannel(hub, botId),
    localPlayerId: local.selfId,
    instanceAABB,
    colliderShape,
    // Seed each new bot with the local-player store's current world
    // state so it doesn't fall back to SDK defaults. (Bots spawned
    // earlier still pick up map changes via the regular `world:map`
    // broadcast path.)
    getInitialWorld: () => {
      const state = local.store.getState();
      return {
        worldConstants: state.worldConstants,
        worldMap: state.worldMap,
        // Seed worldObjects so bots spawned after the initial world:objects
        // broadcast (which in-memory channels do not replay) still get floor
        // colliders from their first tick. Without this, bots spawned after
        // the map has already loaded have an empty Rapier world and fall
        // through the floor, entering a respawn loop.
        worldObjects: { ...state.worldObjects },
      };
    },
    // In-browser bots can forward their controller-detected
    // `collision:char-bump` events onto the local bus so the renderer
    // plays the bump animation when a bot walks into the local
    // player.
    localBus: local.bus,
  });

  const { sync, handshake, comm, stop } = await startOfficeSync({
    local,
    channel,
    voice: voiceAdapter,
  });
  const stopAuthority = await startWorldConstantsAuthority(hub, local.store);

  const teardown = async () => {
    stopAuthority();
    stop();
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
 * Stands in for the realtime server on an in-memory hub: emits the local
 * store's world constants as the server actor now and whenever they
 * change, so in-browser bots take them through the same inbound
 * `world:constants` path as over ws.
 */
async function startWorldConstantsAuthority(
  hub: ReturnType<typeof createInMemoryChannelHub>,
  store: Store,
): Promise<() => void> {
  const channel = new InMemoryChannel(hub, SERVER_SELF_ID);
  await channel.subscribe();
  // Same seq scheme as the realtime server's own events.
  let seq = Date.now();
  const emit = (constants: WorldConstants) =>
    void channel.send({
      kind: 'world:constants',
      v: 1,
      actorId: SERVER_SELF_ID,
      seq: ++seq,
      t: Date.now(),
      constants,
    });
  emit(store.getState().worldConstants);
  const off = store.subscribe((s) => s.worldConstants, emit);
  return () => {
    off();
    channel.close();
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

  // In ws mode the in-browser pool stays empty — bots run in the
  // realtime-server process. We still construct one so the teardown
  // surface is uniform.
  const bots = new BotPool({
    createChannel: () => {
      throw new Error('ws-mode pool should never spawn in-browser bots');
    },
    localPlayerId: local.selfId,
  });

  const { sync, handshake, comm, stop } = await startOfficeSync({
    local,
    channel,
    voice: voiceAdapter,
  });

  // channel is typed as Channel by createStack's return; we know it's a
  // WsChannel in this mode. Narrow for the bot-control publisher.
  const botControl = createBotControlPublisher({
    channel: channel as WsChannel,
  });

  const teardown = async () => {
    stop();
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
