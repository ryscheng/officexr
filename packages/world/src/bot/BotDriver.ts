import RAPIER from '@dimforge/rapier3d-compat';
import {
  createStore,
  createActions,
  createBus,
  serializeOfficeState,
  SyncEngine,
  SnapshotHandshake,
} from '@officexr/sdk';
import type { Bus, Channel, PlayerId, Vec3, WorldMap, WorldObjects, WorldSettings } from '@officexr/sdk';
import type { Clock } from '@officexr/sdk/test-harness';
import { routeContactEvent } from '../physics/bridge.ts';
import {
  pickRespawnPosition,
  respawnThreshold,
  shouldRespawnFalling,
} from '../physics/rules.ts';
import { BotCharacterMovement } from '../physics/bot-character-movement.ts';
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
   * bot's SDK store before it subscribes. Including worldObjects here
   * ensures the bot's Rapier world has floor colliders from the first
   * tick, regardless of whether it receives the world:objects broadcast
   * (bots spawned after the initial broadcast miss it via the in-memory
   * channel since there is no replay mechanism). */
  initialWorld?: {
    worldSettings?: WorldSettings;
    worldMap?: WorldMap;
    worldObjects?: WorldObjects;
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
  /** Optional collider-shape override lookup (typically
   * `(id) => api.catalog.getKind(id)?.colliderShape`). Threads through
   * to `BotPhysicsWorld` so compound-step staircase colliders mirror
   * what `MapColliders` emits on the browser side. */
  colliderShape?: import('../physics/rules.ts').ColliderShapeLookup;
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
    linearWalkDir: { x: 0, z: 1 },
  };

  private botStore: ReturnType<typeof createStore> | null = null;
  private botActions: ReturnType<typeof createActions> | null = null;
  private botBus: ReturnType<typeof createBus> | null = null;
  private botChannel: Channel | null = null;
  private botSync: SyncEngine | null = null;
  private botHandshake: SnapshotHandshake | null = null;
  private readonly initialWorld: BotDriverOptions['initialWorld'];

  private physics: BotPhysicsWorld | null = null;
  private movement: BotCharacterMovement | null = null;
  private readonly externalBus?: Bus;
  private readonly instanceAABB?: import('../physics/rules.ts').InstanceAABBLookup;
  private readonly colliderShape?: import('../physics/rules.ts').ColliderShapeLookup;

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
    this.colliderShape = opts.colliderShape;
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
    if (this.initialWorld?.worldObjects) {
      botActions.setWorldObjects(this.initialWorld.worldObjects);
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
      colliderShape: this.colliderShape,
    });
    this.physics.syncCubes(state.worldObjects);

    // Initialize the CharacterMovement adapter so tick() can express
    // intent as walk/stop verbs rather than raw physics deltas.
    // tunables will be updated each tick via movement.updateTunables().
    const tunablesForInit = resolveCharacterTunables(
      state.players[botId]?.avatar.model ?? 'default',
      state.worldSettings,
      state.characterConfigs,
    );
    this.movement = new BotCharacterMovement(this.physics, {
      walkSpeed: tunablesForInit.playerSpeed,
      runSpeed: tunablesForInit.playerSpeed * tunablesForInit.runSpeedMultiplier,
      movementBlockThreshold: state.worldSettings.movementBlockThreshold,
    });

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
    this.movement = null;
  }

  /**
   * Tick the bot for one frame.
   *
   * @param dt - Frame delta in milliseconds.
   * @param directPeers - Optional map of peer bot-id → current physics
   *   position, collected by BotPool immediately before/after each bot
   *   ticks. When provided, these positions override the broadcast-lagged
   *   store positions for peer mirror placement, eliminating the ~33ms
   *   lag (≈0.1 m at 3 m/s) that causes start-inside-collider overlaps
   *   and KCC pass-through at head-on contact. Without this, the 30Hz
   *   broadcast cap means a mirror can be 0.1 m behind the actual peer
   *   position at the moment of contact, producing an overlap that Rapier's
   *   KCC resolves by pushing the bot FORWARD (tunneling) instead of
   *   blocking it.
   *   BotPool passes a rolling map: each earlier bot in the tick order
   *   contributes its post-tick store position so later bots see a
   *   zero-lag mirror, while earlier bots see the prior-tick position of
   *   later bots (at most 1-frame lag ≈ 0.05 m — within the safe range).
   */
  tick(dt: number, directPeers?: ReadonlyMap<string, Vec3>): void {
    if (
      this.stopped ||
      !this.botActions ||
      !this.botSync ||
      !this.botHandshake ||
      !this.botBus ||
      !this.physics ||
      !this.movement ||
      !this.botStore
    )
      return;

    const botState = this.botStore.getState();
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

    // Keep cube colliders + peer mirrors in sync with the latest
    // state. `syncCubes` no-ops when the WorldObjects fingerprint is
    // unchanged, so this is cheap on idle ticks.
    this.physics.syncCubes(botState.worldObjects);
    // Merge direct peer positions (if provided by BotPool) into the
    // players map before syncPeers. Direct positions are the fresh
    // post-tick store positions collected by BotPool this frame,
    // bypassing the 30Hz broadcast cap for bot-to-bot synchronisation.
    let playersForSync = botState.players;
    if (directPeers && directPeers.size > 0) {
      const merged: typeof botState.players = { ...botState.players };
      for (const [id, pos] of directPeers) {
        if (id !== this.botId && merged[id]) {
          merged[id] = { ...merged[id], pos };
        }
      }
      playersForSync = merged;
    }
    this.physics.syncPeers(playersForSync, this.clock.now(), tunables.charRadius);
    // Advance the simulation BEFORE the KCC so peer mirrors reach the
    // broadphase at their current positions. In Rapier 0.19 the KCC
    // (computeColliderMovement) queries the broadphase AABB tree, which is
    // only rebuilt during world.step(). Without stepping first, the KCC
    // sees mirrors at their previous-tick committed positions — a 1-tick
    // lag that lets bots walk into the mirror's stale AABB at an angle
    // that causes the KCC to resolve the overlap by pushing the bot
    // FORWARD (pass-through) rather than backward (block). Stepping here
    // commits the peer setNextKinematicTranslation values set by syncPeers
    // (and the bot's own body from the previous tick's applyTranslation)
    // into the broadphase so the KCC sees fresh peer positions.
    //
    // Floor-settling is unaffected: bots teleported to y=0 (inside the
    // floor block) fall through as before, trigger the dual-gate
    // fall-respawn rule, and drop from y=4 to settle on the platform —
    // the same path as the original ordering. The ordering change only
    // affects WHEN the broadphase is refreshed, not the physics outcomes.
    this.physics.stepWorld();

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
    const currentYaw = botState.players[this.botId]?.yaw ?? 0;

    // Update tunables each tick so speed / collision changes propagate
    // immediately (e.g. after a CharacterConfig hot-reload).
    this.movement.updateTunables({
      walkSpeed: tunables.playerSpeed,
      runSpeed: tunables.playerSpeed * tunables.runSpeedMultiplier,
      movementBlockThreshold: botState.worldSettings.movementBlockThreshold,
    });

    // Intent verb: bots always walk (no run/crouch input source yet).
    // stop() is issued when the mode returns null intent so gravity
    // still integrates each tick — an "idle" bot must fall onto the
    // cube field, not float at its spawn height.
    const result = intent
      ? this.movement.walk(intent, currentYaw, dtSec)
      : this.movement.stop(currentYaw, dtSec);

    this.emitControllerBumps(result.bumps);

    // Wander pivots early on a hard block so the bot doesn't grind
    // into walls. Other modes are happy to stand still until
    // conditions change.
    if (intent && this.mode === 'wander' && !result.moved) {
      strategy.onEnter?.(ctx);
    }

    // Dual-gate fall-respawn check (single call site for all characters).
    // Primary gate: both (a) no floor found within FLOOR_PROBE_RANGE and
    // (b) falling at >= MAX_FALL_VELOCITY (from BotPhysicsWorld.getVerticalVel()).
    // Backstop: Y-floor threshold (respawnThreshold) remains as a last-resort
    // safety net in case the primary gate misses (e.g. floor probe briefly
    // inconclusive or map geometry extremely sparse).
    let newPos = result.newPos;
    let vel = result.broadcastVel;
    let moved = result.moved;
    // Pass `this.spawnList` so the backstop has a finite floor
    // reference even for baked-layout maps whose platforms live in
    // the GLB rather than in `worldObjects.instances` (otherwise the
    // threshold collapses to -Infinity and never fires).
    const fallsBackstop =
      newPos.y < respawnThreshold(botState.worldObjects, this.spawnList);
    if (shouldRespawnFalling(result.velY, result.hasFloorUnderneath) || fallsBackstop) {
      // Use phaseIndex so each bot in a cohort respawns to a DIFFERENT spawn
      // point when the list has multiple entries — prevents the whole cohort
      // from stacking at spawnList[0] and passing through each other.
      const respawnPos = pickRespawnPosition(this.spawnList, this.phaseIndex);
      if (respawnPos) {
        this.movement.teleport(respawnPos);
        newPos = respawnPos;
        vel = { x: 0, y: 0, z: 0 };
        moved = false;
      }
    }

    this.botActions.setSelfPosition(newPos, vel, result.broadcastYaw, false);
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

  /**
   * Switch to a mode and supply mode-specific config before the onEnter hook
   * fires. For linear-walk: `{ direction: { x, z } }`.
   *
   * OCP: this is the only call site that needs to know about per-mode config;
   * BotDriver.tick() and BOT_MODE_STRATEGIES remain unaffected by new modes.
   */
  setModeWithConfig(
    mode: BotMode,
    config?: { direction?: { x: number; z: number } },
  ): void {
    // Set config fields on modeState BEFORE calling setMode() so that
    // onEnter fires with the correct values already in place.
    if (config?.direction) {
      this.modeState.linearWalkDir = config.direction;
    }
    // setMode skips onEnter if the mode is unchanged; force a re-enter
    // so the direction config is applied even when staying in linear-walk.
    if (mode === this.mode) {
      this.invokeOnEnter();
    } else {
      this.setMode(mode);
    }
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
   * `respawnThreshold(worldObjects, spawnList)`. The spawn list also
   * feeds the backstop so baked-layout maps (empty `worldObjects`)
   * still get a finite threshold. The cohort all share the same
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
