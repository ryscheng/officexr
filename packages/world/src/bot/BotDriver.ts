import RAPIER from '@dimforge/rapier3d-compat';
import {
  createStore,
  createActions,
  createBus,
  serializeOfficeState,
  SyncEngine,
  SnapshotHandshake,
} from '@officexr/sdk';
import type { Bus, Channel, PlayerId, Vec3, WorldMap, WorldSettings } from '@officexr/sdk';
import type { Clock } from '@officexr/sdk/test-harness';
import { routeContactEvent } from '../physics/bridge.ts';
import { pickRespawnPosition, respawnThreshold } from '../physics/rules.ts';
import { resolveCharacterTunables } from '../characters/resolve.ts';
import { BotPhysicsWorld } from './BotPhysicsWorld.ts';
import {
  ALL_MODES,
  BOT_MODE_STRATEGIES,
  type BotMode,
  type BotModeContext,
  type ModeState,
} from './modes/index.ts';

export type { BotMode } from './modes/index.ts';
export const BOT_MODES = ALL_MODES;

export interface BotDriverOptions {
  /** Factory that mints a fresh Channel for this bot's SDK client. The
   * pool injects this so the same BotDriver runs unchanged in both the
   * in-browser InMemoryChannel and the Node CLI's SupabaseChannel modes. */
  createChannel: (botId: PlayerId) => Channel;
  /** PlayerId of the local (human) player whose position the bot homes
   * toward in the `walk-to-local` / `orbit` modes. The bot reads this from
   * its own SDK store, which receives the local player's broadcasts via
   * the same channel. */
  localPlayerId: PlayerId;
  botId?: string;
  speed?: number;
  startPos?: Vec3;
  clock?: Clock;
  /** Initial traversal mode. Defaults to 'idle'. */
  mode?: BotMode;
  /** Per-bot phase offset for modes that would otherwise have every bot
   * doing exactly the same thing (patrol starts at the same waypoint;
   * orbit at the same angle). Pool typically passes the bot's index. */
  phaseIndex?: number;
  /** Optional snapshot of the authoritative world state to seed the
   * bot's SDK store before it subscribes. */
  initialWorld?: {
    worldSettings?: WorldSettings;
    worldMap?: WorldMap;
  };
  /** Optional external bus the bot can re-emit body-vs-body bump
   * events onto (in addition to its own private bus). Used in-browser
   * to forward bot→local-player bumps to the renderer's bus so the
   * visual bump animation fires on the local player when a bot walks
   * into them. */
  externalBus?: Bus;
  /** Optional canonical AABB lookup for placed-object colliders.
   * Threads through to `BotPhysicsWorld`. When omitted, bot colliders
   * fall back to the legacy one-voxel-cube path. */
  instanceAABB?: import('../physics/rules.ts').InstanceAABBLookup;
}

/**
 * Bot agent: one SDK client (`Store` + `SyncEngine` + `SnapshotHandshake`
 * + `Channel`) running an autonomous traversal strategy from
 * `./modes/`. Movement is resolved against a private Rapier world
 * encapsulated in {@link BotPhysicsWorld}; everything else is pure
 * SDK plumbing.
 *
 * The driver itself owns:
 *   - SDK plumbing (store, actions, bus, channel, sync, handshake);
 *   - the current {@link BotMode} + {@link ModeState} scratch;
 *   - the tick orchestration (ask strategy for intent → ask physics
 *     world to step → broadcast new pose → step world + drain
 *     sensor events → flush sync).
 */
export class BotDriver {
  readonly botId: string;

  private createChannel: (botId: PlayerId) => Channel;
  private localPlayerId: PlayerId;
  private speed: number;
  private startPos: Vec3;
  private clock: Clock;

  private mode: BotMode;
  private stopped = false;
  private wasMoving = false;
  private readonly phaseIndex: number;
  /** Last spawn list received via `setSpawnList` (called by
   * `BotPool.respawnAll` on every map switch). Used by the fall-
   * respawn check in `tick()` so the bot has somewhere to teleport
   * back to when it walks off the cube field. */
  private spawnList: readonly Vec3[] = [];
  private modeState: ModeState = {
    wanderDir: { x: 1, z: 0 },
    wanderUntilMs: 0,
    patrolIdx: 0,
    patrolWaypoints: null,
    orbitAngle: 0,
  };

  private botStore: ReturnType<typeof createStore> | null = null;
  private botActions: ReturnType<typeof createActions> | null = null;
  private botBus: ReturnType<typeof createBus> | null = null;
  private botChannel: Channel | null = null;
  private botSync: SyncEngine | null = null;
  private botHandshake: SnapshotHandshake | null = null;
  private readonly initialWorld: BotDriverOptions['initialWorld'];

  private physics: BotPhysicsWorld | null = null;
  private readonly externalBus?: Bus;
  private readonly instanceAABB?: import('../physics/rules.ts').InstanceAABBLookup;

  constructor(opts: BotDriverOptions) {
    this.createChannel = opts.createChannel;
    this.localPlayerId = opts.localPlayerId;
    this.botId = opts.botId ?? 'bot-001';
    this.speed = opts.speed ?? 1.5;
    this.startPos = opts.startPos ?? { x: 10, y: 0, z: 0 };
    this.clock = opts.clock ?? { now: () => performance.now() };
    this.mode = opts.mode ?? 'idle';
    this.phaseIndex = opts.phaseIndex ?? 0;
    this.initialWorld = opts.initialWorld;
    this.externalBus = opts.externalBus;
    this.instanceAABB = opts.instanceAABB;
    this.modeState.patrolIdx = this.phaseIndex;
    // Spread orbit angles so multiple bots don't sit on the same arc spot.
    this.modeState.orbitAngle = (this.phaseIndex * 0.71) * Math.PI;
  }

  async start(): Promise<void> {
    // Rapier's wasm has to be initialised before `new RAPIER.World(...)`.
    // In Node (bots-cli) we do this once at process start; in the
    // browser, `<Physics>` from `@react-three/rapier` may not have
    // resolved its init by the time the Leva bot count slider has
    // already kicked us off here. `RAPIER.init()` is idempotent and
    // cheap on second call, so awaiting it inside start() guarantees
    // the wasm is ready regardless of which path we came in through.
    await RAPIER.init();

    const botId = this.botId;
    const officeId = 'debug-office';

    const botStore = createStore({ selfId: botId, officeId });
    const botBus = createBus();
    const botActions = createActions(botStore, botBus);

    // Seed world state from the server snapshot if provided. Must happen
    // before SyncEngine.start so its baseline diffs use the right values.
    if (this.initialWorld?.worldSettings) {
      botActions.setWorldSettings(this.initialWorld.worldSettings);
    }
    if (this.initialWorld?.worldMap) {
      botActions.setWorldMap(this.initialWorld.worldMap);
    }

    botActions.upsertPlayer({
      id: botId,
      name: this.botId,
      pos: { ...this.startPos },
      vel: { x: 0, y: 0, z: 0 },
      yaw: 0,
    });

    const state = botStore.getState();
    this.physics = new BotPhysicsWorld({
      selfId: botId,
      startPos: this.startPos,
      worldSettings: state.worldSettings,
      instanceAABB: this.instanceAABB,
    });
    this.physics.syncCubes(state.worldObjects);

    const botChannel = this.createChannel(botId);
    const botSync = new SyncEngine({
      store: botStore,
      actions: botActions,
      bus: botBus,
      channel: botChannel,
      clock: this.clock,
    });

    await botChannel.subscribe();
    botChannel.trackPresence({});
    botSync.start();

    const botHandshake = new SnapshotHandshake({
      selfId: botId,
      store: botStore,
      actions: botActions,
      sync: botSync,
      channel: botChannel,
      clock: this.clock,
      serialize: () => serializeOfficeState(botStore.getState()),
    });
    botHandshake.start();

    this.botStore = botStore;
    this.botActions = botActions;
    this.botBus = botBus;
    this.botChannel = botChannel;
    this.botSync = botSync;
    this.botHandshake = botHandshake;

    // Run any onEnter hook the initial mode declared so timers /
    // angles are seeded before the first tick.
    this.invokeOnEnter();
  }

  stop(): void {
    this.stopped = true;
    this.botSync?.stop();
    this.botHandshake?.stop();
    this.botChannel?.close();
    this.physics?.dispose();
    this.physics = null;
  }

  tick(dt: number): void {
    if (
      this.stopped ||
      !this.botActions ||
      !this.botSync ||
      !this.botHandshake ||
      !this.botBus ||
      !this.physics ||
      !this.botStore
    )
      return;

    const botState = this.botStore.getState();
    const { movementBlockThreshold } = botState.worldSettings;
    // Resolve per-character tunables for this bot's model. Each bot can
    // move at a different speed / have a different collision radius if
    // CharacterMode has tuned that model. Falls back to the world's
    // playerSpeed when no per-character config exists.
    const botSelf = botState.players[botState.selfId];
    const botModel = botSelf?.avatar.model ?? 'default';
    const tunables = resolveCharacterTunables(
      botModel,
      botState.worldSettings,
      botState.characterConfigs,
    );
    const speed = tunables.playerSpeed ?? this.speed;

    // Keep cube colliders + peer mirrors in sync with the latest
    // state. `syncCubes` no-ops when the WorldObjects fingerprint is
    // unchanged, so this is cheap on idle ticks.
    this.physics.syncCubes(botState.worldObjects);
    this.physics.syncPeers(botState.players, this.clock.now(), tunables.charRadius);

    const botPos = this.getBotPos();
    const ctx: BotModeContext = {
      botPos,
      localPlayerPos: this.getLocalPlayerPos(),
      state: botState,
      clock: this.clock,
      modeState: this.modeState,
    };
    const strategy = BOT_MODE_STRATEGIES[this.mode];
    const intent = strategy.computeIntent(ctx);

    const dtSec = dt / 1000;

    // Always run the controller step, even when the mode is idle —
    // otherwise gravity wouldn't apply and an "idle" bot floats
    // wherever it last was instead of falling onto the cube field
    // (or off it). Horizontal intent is just zeroed when the mode
    // returns null.
    const moveDX = intent ? intent.x * speed * dtSec : 0;
    const moveDZ = intent ? intent.z * speed * dtSec : 0;

    const stepResult = this.physics.step({ x: moveDX, z: moveDZ, dtSec });
    this.emitControllerBumps(stepResult.bumps);

    const minProgress = 1 - movementBlockThreshold;

    // Wander pivots early on a hard block so the bot doesn't grind
    // into walls. Other modes are happy to stand still until
    // conditions change.
    if (intent && this.mode === 'wander' && stepResult.progress < minProgress) {
      strategy.onEnter?.(ctx);
    }

    const t = this.physics.translation();
    let newPos: Vec3;
    let vel: Vec3;
    let moved: boolean;
    let yaw: number;
    if (!intent || stepResult.progress < minProgress) {
      // Horizontal motion blocked or unintended — keep x/z, but
      // still apply the gravity-driven y delta.
      newPos = {
        x: t.x,
        y: t.y + stepResult.corrected.y,
        z: t.z,
      };
      vel = { x: 0, y: 0, z: 0 };
      moved = false;
      yaw = botState.players[this.botId]?.yaw ?? 0;
    } else {
      newPos = {
        x: t.x + stepResult.corrected.x,
        y: t.y + stepResult.corrected.y,
        z: t.z + stepResult.corrected.z,
      };
      vel = {
        x: intent.x * speed * stepResult.progress,
        y: 0,
        z: intent.z * speed * stepResult.progress,
      };
      moved = true;
      yaw = Math.atan2(-intent.x, -intent.z);
    }
    this.physics.applyTranslation(newPos);

    // Fall-respawn check. Bots obey the same below-the-lowest-cube
    // rule as the local player — they're simulations of remote
    // players, they don't get to defy game physics.
    const threshold = respawnThreshold(botState.worldObjects);
    if (newPos.y < threshold) {
      const respawnPos = pickRespawnPosition(this.spawnList);
      if (respawnPos) {
        this.physics.teleport(respawnPos);
        newPos = respawnPos;
        vel = { x: 0, y: 0, z: 0 };
        moved = false;
      }
    }

    this.botActions.setSelfPosition(newPos, vel, yaw, false);
    this.physics.stepWorld();
    this.flushEvents();
    this.botSync.flushPosition();
    this.botHandshake.tickTimers();
    this.wasMoving = moved;
  }

  setMode(mode: BotMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.invokeOnEnter();
  }

  /** Teleport the bot to a fresh position. Re-applies into the
   * physics body AND the SDK store + broadcast position so peers
   * observe a discrete jump rather than seeing the bot walk there
   * through any walls.
   *
   * Used by `BotPool.respawnAll` when the Debug Map picker loads a
   * new map — every bot warps to a chosen spawn point so the
   * cohort starts the new scene at known locations. */
  setPosition(pos: Vec3): void {
    if (this.stopped) return;
    if (!this.botActions || !this.physics) {
      // Not started yet — record the new start so when start()
      // runs later it places the bot here.
      this.startPos = { ...pos };
      return;
    }
    // `teleport` (not `applyTranslation`) — also zeroes the bot's
    // fall speed so an in-flight respawn doesn't keep accumulating
    // downward velocity through the warp.
    this.physics.teleport({ ...pos });
    const yaw = this.botStore?.getState().players[this.botId]?.yaw ?? 0;
    this.botActions.setSelfPosition({ ...pos }, { x: 0, y: 0, z: 0 }, yaw, false);
    // Reset any strategy-state that's stale w.r.t. the new location
    // (e.g. wander direction picked from the old position).
    this.wasMoving = false;
    this.invokeOnEnter();
  }

  /** Record the spawn list for fall-respawn. Called by
   * `BotPool.respawnAll` so every driver knows where to teleport
   * back to when the bot walks off the cube field and falls below
   * `respawnThreshold(worldObjects)`. The cohort all share the same
   * list — each bot picks one round-robin by phaseIndex. */
  setSpawnList(spawns: readonly Vec3[]): void {
    this.spawnList = spawns;
  }

  getBotPos(): Vec3 {
    if (!this.botStore) return { ...this.startPos };
    const state = this.botStore.getState();
    const player = state.players[this.botId];
    return player?.pos ?? { ...this.startPos };
  }

  /** Latest broadcast position of the local (human) player from this bot's
   * own SDK store. Returns origin if the local player hasn't broadcast yet
   * (e.g. CLI started before the browser connects) so mode strategies stay
   * defined; the bot will pivot once the local player broadcasts. */
  private getLocalPlayerPos(): Vec3 {
    if (!this.botStore) return { x: 0, y: 0, z: 0 };
    const state = this.botStore.getState();
    return state.players[this.localPlayerId]?.pos ?? { x: 0, y: 0, z: 0 };
  }

  /** Run the active strategy's onEnter hook with a freshly-built
   * context. Idempotent — modes use this to reset timers / angles. */
  private invokeOnEnter(): void {
    const strategy = BOT_MODE_STRATEGIES[this.mode];
    if (!strategy.onEnter || !this.botStore) return;
    const state = this.botStore.getState();
    const ctx: BotModeContext = {
      botPos: this.getBotPos(),
      localPlayerPos: this.getLocalPlayerPos(),
      state,
      clock: this.clock,
      modeState: this.modeState,
    };
    strategy.onEnter(ctx);
  }

  /** Edge-trigger bilateral `collision:char-bump` events for every peer
   * the controller pushed against this step. Mirrors `SceneFrame`'s
   * self-side detection inside the bot's own Rapier world. Emits on
   * the bot's private bus AND, when present, on the external bus so
   * the user's browser plays the bump on both characters when a bot
   * walks into the local player. */
  private emitControllerBumps(
    bumps: Array<{ otherId: PlayerId; normal: { x: number; z: number } }>,
  ): void {
    if (!this.botBus) return;
    for (const { otherId, normal } of bumps) {
      this.botBus.emit({
        kind: 'collision:char-bump',
        selfId: this.botId,
        otherId,
        normal,
      });
      if (this.externalBus) {
        this.externalBus.emit({
          kind: 'collision:char-bump',
          selfId: this.botId,
          otherId,
          normal,
        });
        this.externalBus.emit({
          kind: 'collision:char-bump',
          selfId: otherId,
          otherId: this.botId,
          normal: { x: -normal.x, z: -normal.z },
        });
      }
    }
  }

  /** Route every sensor / body contact edge the physics world
   * surfaced this step through the bridge so they land on the bot's
   * bus with the same event names the browser side emits. */
  private flushEvents(): void {
    if (!this.physics || !this.botBus) return;
    const emit = this.botBus.emit;
    for (const ev of this.physics.drainSensorEvents()) {
      routeContactEvent(emit, this.botId, ev.a, ev.b, ev.started);
    }
  }
}
