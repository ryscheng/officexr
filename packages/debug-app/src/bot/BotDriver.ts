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
import {
  BODY_GROUPS,
  WALL_GROUPS,
  INNER_SENSOR_GROUPS,
  OUTER_SENSOR_GROUPS,
  type ColliderTag,
} from '../physics/groups.ts';
import { worldMapToWalls } from '../physics/worldMapToWalls.ts';
import { routeContactEvent } from '../physics/bridge.ts';

export interface BotDriverOptions {
  /** Factory that mints a fresh Channel for this bot's SDK client. The
   * pool injects this so the same BotDriver runs unchanged in both the
   * in-browser InMemoryChannel and the Node CLI's SupabaseChannel modes. */
  createChannel: (botId: PlayerId) => Channel;
  /** PlayerId of the local (human) player whose position the bot homes
   * toward in the `walk-to-local` / `orbit` modes. The bot reads this from
   * its own SDK store, which receives the local player's broadcasts via
   * the same channel — this is what removes the renderer-side closure
   * dependency the previous `localPlayerPosGetter` had. */
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
}

export type BotMode =
  | 'idle'
  | 'walk-to-local'
  | 'walk-away'
  /** Random walk: pick a unit direction, hold for ~1–3 s, repeat. Pivots
   * early on a hard block so wandering bots don't grind against walls. */
  | 'wander'
  /** Patrol four corners of an inset square in a fixed loop. */
  | 'patrol'
  /** Orbit the local player at a fixed radius. */
  | 'orbit';

const ALL_MODES: readonly BotMode[] = [
  'idle',
  'walk-to-local',
  'walk-away',
  'wander',
  'patrol',
  'orbit',
];

/** Match the renderer's extrapolation cap so the resolver and the visible
 * avatar agree on where a peer "is" right now. */
const EXTRAPOLATION_CAP_S = 0.1;

function extrapolatePeerPos(
  player: { pos: Vec3; vel: Vec3; tRecv?: number },
  nowMs: number,
): Vec3 {
  if (player.tRecv === undefined) return { ...player.pos };
  const elapsed = Math.min(EXTRAPOLATION_CAP_S, (nowMs - player.tRecv) / 1000);
  return {
    x: player.pos.x + player.vel.x * elapsed,
    y: player.pos.y + player.vel.y * elapsed,
    z: player.pos.z + player.vel.z * elapsed,
  };
}

interface ModeState {
  /** Current direction the wander mode is heading (unit vector). */
  wanderDir: { x: number; z: number };
  /** Wall-clock time at which wander picks a new direction. */
  wanderUntilMs: number;
  /** Index into the patrol waypoint loop. */
  patrolIdx: number;
  /** Cached waypoints (computed lazily from world map size). */
  patrolWaypoints: Array<{ x: number; z: number }> | null;
  /** Current angle around the local player for orbit mode (radians). */
  orbitAngle: number;
}

/** Local-y the bot collider sits at (matches the browser-side BODY_Y in
 * Players.tsx so all bodies are at the same elevation). */
const BODY_Y = 0.9;

/** Per-peer kinematic mirror body the bot maintains in its own Rapier
 * world. Their positions are kept in sync with the SDK store's last
 * extrapolated peer positions every tick. */
interface PeerMirror {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

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

  // Per-bot Rapier world — replaces the previous SDK `resolveMovement`.
  // Each bot's world contains: static walls around the floor edge, its
  // own kinematic body + body/inner/outer-sensor colliders, a
  // KinematicCharacterController for movement resolution, and a set of
  // kinematic mirror bodies for every peer the bot knows about (kept
  // in sync from the SDK store each tick).
  private world: RAPIER.World | null = null;
  private body: RAPIER.RigidBody | null = null;
  private bodyCollider: RAPIER.Collider | null = null;
  private controller: RAPIER.KinematicCharacterController | null = null;
  private wallBodies: RAPIER.RigidBody[] = [];
  private wallsForGridSize: number | null = null;
  private peerMirrors = new Map<PlayerId, PeerMirror>();
  private tagByHandle = new Map<number, ColliderTag>();
  /** Pairs of (selfCollider.handle, otherCollider.handle) that were
   * intersecting at the end of the previous step. Diff against the
   * current step's pairs to emit started/ended sensor events. */
  private prevIntersections = new Set<string>();
  /** Player IDs whose bodies the bot's character controller was bumping
   * into on the previous frame, for edge-triggering `collision:char-bump`. */
  private bumpingPeers = new Set<PlayerId>();
  private readonly externalBus?: Bus;
  /** Mapping from peer-mirror collider handle → playerId, so the
   * character controller's collision list can be translated into a
   * peer ID for the bump event. The body collider handle for `this`
   * bot is filtered out separately. */
  private peerByColliderHandle = new Map<number, PlayerId>();

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

    // --- Rapier world ----------------------------------------------
    // Gravity is zero — characters are kinematic and Y-locked, identical
    // to the browser-side `<Physics gravity={[0,0,0]}>`. The world is
    // disposed (with RAPIER.World.free) in `stop()` to release the
    // associated wasm memory.
    const state = botStore.getState();
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.world = world;
    this.syncWalls(state.worldMap);

    // The bot's own body — kinematic, ball-shaped at torso height,
    // tagged for the bridge.
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      this.startPos.x,
      this.startPos.y,
      this.startPos.z,
    );
    const body = world.createRigidBody(bodyDesc);
    const charRadius = state.worldSettings.charRadius;
    // `ActiveCollisionTypes.ALL` — without this, Rapier's default
    // (DEFAULT = 15) skips kinematic↔kinematic contact / intersection
    // detection. Every character body in this scene is kinematic, so
    // bot-vs-bot and bot-vs-(local player mirror) intersections would
    // never fire and the bridge would emit no proximity events.
    const ACTIVE_TYPES = RAPIER.ActiveCollisionTypes.ALL;
    const colDesc = RAPIER.ColliderDesc.ball(charRadius)
      .setTranslation(0, BODY_Y, 0)
      .setCollisionGroups(BODY_GROUPS)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      .setActiveCollisionTypes(ACTIVE_TYPES);
    const bodyCol = world.createCollider(colDesc, body);
    this.tagByHandle.set(bodyCol.handle, { kind: 'body', ownerId: botId });

    const innerDesc = RAPIER.ColliderDesc.ball(state.worldSettings.proximityRadius)
      .setTranslation(0, BODY_Y, 0)
      .setSensor(true)
      .setCollisionGroups(INNER_SENSOR_GROUPS)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      .setActiveCollisionTypes(ACTIVE_TYPES);
    const innerCol = world.createCollider(innerDesc, body);
    this.tagByHandle.set(innerCol.handle, {
      kind: 'inner-sensor',
      ownerId: botId,
    });

    const outerDesc = RAPIER.ColliderDesc.ball(
      state.worldSettings.proximityOuterRadius,
    )
      .setTranslation(0, BODY_Y, 0)
      .setSensor(true)
      .setCollisionGroups(OUTER_SENSOR_GROUPS)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      .setActiveCollisionTypes(ACTIVE_TYPES);
    const outerCol = world.createCollider(outerDesc, body);
    this.tagByHandle.set(outerCol.handle, {
      kind: 'outer-sensor',
      ownerId: botId,
    });

    this.body = body;
    this.bodyCollider = bodyCol;
    this.controller = world.createCharacterController(0.01);
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.controller.setSlideEnabled(true);

    // --- SDK plumbing (unchanged) ----------------------------------
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
  }

  stop(): void {
    this.stopped = true;
    this.botSync?.stop();
    this.botHandshake?.stop();
    this.botChannel?.close();
    if (this.world) {
      this.world.free();
      this.world = null;
    }
    this.body = null;
    this.bodyCollider = null;
    this.controller = null;
    this.wallBodies = [];
    this.peerMirrors.clear();
    this.tagByHandle.clear();
    this.prevIntersections.clear();
  }

  tick(dt: number): void {
    if (
      this.stopped ||
      !this.botActions ||
      !this.botSync ||
      !this.botHandshake ||
      !this.world ||
      !this.body ||
      !this.bodyCollider ||
      !this.controller ||
      !this.botBus
    )
      return;

    const botState = this.botStore!.getState();
    const { playerSpeed, movementBlockThreshold } = botState.worldSettings;
    const speed = playerSpeed ?? this.speed;

    // Keep static walls in sync with the (rarely-changing) gridSize.
    this.syncWalls(botState.worldMap);
    // Keep peer mirror bodies in sync with their last-known positions.
    this.syncPeers(botState.players);

    const botPos = this.getBotPos();
    const intent = this.computeIntent(botPos, botState, dt);
    if (!intent) {
      if (this.wasMoving) {
        const me = botState.players[this.botId];
        const yaw = me?.yaw ?? 0;
        this.botActions.setSelfPosition(botPos, { x: 0, y: 0, z: 0 }, yaw);
        this.wasMoving = false;
      }
      // Still step the world + drain events so sensor enter/exit edges
      // fire while the bot stands still (e.g. a peer walking into the
      // bot's proximity ring).
      this.world.step();
      this.drainSensorEvents();
      this.botSync.flushPosition();
      this.botHandshake.tickTimers();
      return;
    }

    const moveDX = intent.x * speed * (dt / 1000);
    const moveDZ = intent.z * speed * (dt / 1000);

    // Rapier's character controller — replaces the old resolveMovement.
    // It walks the body's collider against the world (walls + peer
    // mirrors) and returns the corrected delta, sliding along contacts.
    // EXCLUDE_SENSORS keeps the bot from physically bumping into other
    // characters' invisible proximity spheres (the sensor=true flag
    // only suppresses the dynamics solver, not the query pipeline that
    // the character controller uses).
    this.controller.computeColliderMovement(
      this.bodyCollider,
      { x: moveDX, y: 0, z: moveDZ },
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    );
    const corrected = this.controller.computedMovement();
    this.emitControllerBumps();

    // Progress = how much of the intent survived. Same gating as the
    // old code — below `minProgress`, snap to zero so wander pivots.
    const intentLenSq = moveDX * moveDX + moveDZ * moveDZ;
    const correctedLenSq = corrected.x * corrected.x + corrected.z * corrected.z;
    let progress = 1;
    if (intentLenSq > 1e-12) {
      progress = Math.max(0, Math.min(1, Math.sqrt(correctedLenSq / intentLenSq)));
    }
    const minProgress = 1 - movementBlockThreshold;

    if (this.mode === 'wander' && progress < minProgress) {
      this.pickWanderDirection(0);
    }

    let newPos: Vec3;
    let vel: Vec3;
    let moved: boolean;
    let yaw: number;
    if (progress < minProgress) {
      newPos = botPos;
      vel = { x: 0, y: 0, z: 0 };
      moved = false;
      yaw = botState.players[this.botId]?.yaw ?? 0;
    } else {
      const t = this.body.translation();
      newPos = { x: t.x + corrected.x, y: botPos.y, z: t.z + corrected.z };
      this.body.setNextKinematicTranslation({
        x: newPos.x,
        y: t.y, // keep y stable; collider local y handles torso height
        z: newPos.z,
      });
      vel = {
        x: intent.x * speed * progress,
        y: 0,
        z: intent.z * speed * progress,
      };
      moved = true;
      yaw = Math.atan2(-intent.x, -intent.z);
    }

    this.botActions.setSelfPosition(newPos, vel, yaw);
    this.world.step();
    this.drainSensorEvents();
    this.botSync.flushPosition();
    this.botHandshake.tickTimers();
    this.wasMoving = moved;
  }

  setMode(mode: BotMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    // Reset per-mode timers so the new mode picks up immediately.
    if (mode === 'wander') this.pickWanderDirection(0);
    if (mode === 'patrol') this.modeState.patrolWaypoints = null;
    if (mode === 'orbit') {
      // Seed orbit angle from the current bot→local heading so we don't
      // teleport along the orbit circle on mode entry.
      const local = this.getLocalPlayerPos();
      const botPos = this.getBotPos();
      this.modeState.orbitAngle = Math.atan2(
        botPos.z - local.z,
        botPos.x - local.x,
      );
    }
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

  // --- Rapier world maintenance -----------------------------------

  /** Rebuild perimeter wall colliders when `worldMap.gridSize`
   * changes. No-op on subsequent ticks if the size is the same. */
  private syncWalls(worldMap: WorldMap): void {
    if (!this.world) return;
    if (this.wallsForGridSize === worldMap.gridSize) return;
    // Drop old wall bodies (also drops their colliders).
    for (const b of this.wallBodies) this.world.removeRigidBody(b);
    this.wallBodies = [];
    const walls = worldMapToWalls(worldMap);
    for (const w of walls) {
      const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(
        w.center.x,
        w.center.y,
        w.center.z,
      );
      const body = this.world.createRigidBody(desc);
      const cdesc = RAPIER.ColliderDesc.cuboid(
        w.halfExtents.x,
        w.halfExtents.y,
        w.halfExtents.z,
      ).setCollisionGroups(WALL_GROUPS);
      this.world.createCollider(cdesc, body);
      this.wallBodies.push(body);
    }
    this.wallsForGridSize = worldMap.gridSize;
  }

  /** Create / update / remove per-peer kinematic mirror bodies so the
   * character controller can resolve bot-vs-bot and bot-vs-local
   * collisions inside the bot's own Rapier world. */
  private syncPeers(players: Record<PlayerId, { pos: Vec3; vel: Vec3; tRecv?: number }>): void {
    if (!this.world || !this.botStore) return;
    const nowMs = this.clock.now();
    const charRadius = this.botStore.getState().worldSettings.charRadius;
    const seen = new Set<PlayerId>();

    for (const [id, p] of Object.entries(players)) {
      if (id === this.botId) continue;
      seen.add(id as PlayerId);
      const ePos = extrapolatePeerPos(p, nowMs);
      let mirror = this.peerMirrors.get(id as PlayerId);
      if (!mirror) {
        const bdesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
          ePos.x,
          ePos.y,
          ePos.z,
        );
        const mb = this.world.createRigidBody(bdesc);
        const cdesc = RAPIER.ColliderDesc.ball(charRadius)
          .setTranslation(0, BODY_Y, 0)
          .setCollisionGroups(BODY_GROUPS)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
          .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL);
        const mc = this.world.createCollider(cdesc, mb);
        this.tagByHandle.set(mc.handle, { kind: 'body', ownerId: id });
        this.peerByColliderHandle.set(mc.handle, id as PlayerId);
        mirror = { body: mb, collider: mc };
        this.peerMirrors.set(id as PlayerId, mirror);
      } else {
        mirror.body.setNextKinematicTranslation({
          x: ePos.x,
          y: ePos.y,
          z: ePos.z,
        });
      }
    }

    // Remove mirrors for peers that left.
    for (const [id, mirror] of this.peerMirrors) {
      if (seen.has(id)) continue;
      this.tagByHandle.delete(mirror.collider.handle);
      this.peerByColliderHandle.delete(mirror.collider.handle);
      this.world.removeRigidBody(mirror.body);
      this.peerMirrors.delete(id);
      // Forget any bump-state for a peer that left so a new
      // same-named peer would re-trigger the bump on first contact.
      this.bumpingPeers.delete(id);
    }
  }

  /** Edge-trigger `collision:char-bump` events for every peer the
   * character controller's last `computeColliderMovement` reported a
   * collision against. Mirrors `SceneFrame`'s self-side detection
   * inside the bot's own Rapier world: the controller slides the bot
   * around obstacles using the query pipeline, so the contact pipeline
   * never fires `onCollisionEnter` for these slides — we have to read
   * the controller's collision list and synthesise the bus event
   * ourselves. Emits bilaterally so both the bot's avatar (on the
   * private bot bus) and the OTHER character's avatar (on the
   * `externalBus` — typically the local renderer's bus, when present)
   * play their bump animation. */
  private emitControllerBumps(): void {
    if (!this.controller || !this.botBus) return;
    const next = new Set<PlayerId>();
    const n = this.controller.numComputedCollisions();
    for (let i = 0; i < n; i++) {
      const coll = this.controller.computedCollision(i);
      if (!coll || !coll.collider) continue;
      const otherId = this.peerByColliderHandle.get(coll.collider.handle);
      if (!otherId) continue; // wall or unknown
      next.add(otherId);
      if (this.bumpingPeers.has(otherId)) continue;
      const nrm = coll.normal1;
      // Bump on the bot's own bus — for the bot's local-state
      // bookkeeping (e.g. any future bot-side bump animation).
      this.botBus.emit({
        kind: 'collision:char-bump',
        selfId: this.botId,
        otherId,
        normal: { x: nrm.x, z: nrm.z },
      });
      // Bump on the external (local renderer's) bus so the user's
      // browser plays the bump on both characters.
      if (this.externalBus) {
        this.externalBus.emit({
          kind: 'collision:char-bump',
          selfId: this.botId,
          otherId,
          normal: { x: nrm.x, z: nrm.z },
        });
        this.externalBus.emit({
          kind: 'collision:char-bump',
          selfId: otherId,
          otherId: this.botId,
          normal: { x: -nrm.x, z: -nrm.z },
        });
      }
    }
    this.bumpingPeers = next;
  }

  /** Walk the world's intersection / contact state and emit any
   * started / ended pair events into the bot's bus. Mirrors the
   * browser-side `Players` onCollisionEnter / onIntersectionEnter
   * handlers — same event names so any downstream listener works for
   * both sides. */
  private drainSensorEvents(): void {
    if (!this.world || !this.botBus || !this.bodyCollider) return;
    const selfId = this.botId;
    const emit = this.botBus.emit;

    // Body-vs-body contact events (entered only — Rapier exposes the
    // current contact pairs, we diff against last frame). We don't
    // emit "exited" body events because the bus event we bridge to
    // (`collision:char-bump`) is start-only.
    this.world.contactPairsWith(this.bodyCollider, (other) => {
      const a = this.tagByHandle.get(this.bodyCollider!.handle);
      const b = this.tagByHandle.get(other.handle);
      if (a && b) routeContactEvent(emit, selfId, a, b, true);
    });

    // Sensor pairs (inner + outer). Diff against the previous-step
    // set to emit started/ended.
    const next = new Set<string>();
    const checkSensor = (sensorCollider: RAPIER.Collider) => {
      this.world!.intersectionPairsWith(sensorCollider, (other) => {
        const key = `${sensorCollider.handle}:${other.handle}`;
        next.add(key);
        if (!this.prevIntersections.has(key)) {
          const a = this.tagByHandle.get(sensorCollider.handle);
          const b = this.tagByHandle.get(other.handle);
          if (a && b) routeContactEvent(emit, selfId, a, b, true);
        }
      });
    };
    // Iterate the bot's own sensors only.
    if (this.body) {
      for (let i = 0; i < this.body.numColliders(); i++) {
        const c = this.body.collider(i);
        if (c.isSensor()) checkSensor(c);
      }
    }
    // Emit ended events for pairs that disappeared.
    for (const key of this.prevIntersections) {
      if (next.has(key)) continue;
      const [hA, hB] = key.split(':').map(Number);
      const a = this.tagByHandle.get(hA);
      const b = this.tagByHandle.get(hB);
      if (a && b) routeContactEvent(emit, selfId, a, b, false);
    }
    this.prevIntersections = next;
  }

  // --- Mode strategies --------------------------------------------------
  //
  // Each one returns a unit-length intent vector in XZ — or null to mean
  // "no movement, settle to idle". Modes never write state directly; the
  // common resolver+broadcast block at the bottom of tick() does that.

  private computeIntent(
    botPos: Vec3,
    state: ReturnType<NonNullable<typeof this.botStore>['getState']>,
    _dt: number,
  ): { x: number; z: number } | null {
    switch (this.mode) {
      case 'idle':
        return null;
      case 'walk-to-local':
      case 'walk-away':
        return this.intentTowardLocal(
          botPos,
          this.mode === 'walk-to-local' ? 1 : -1,
        );
      case 'wander':
        return this.intentWander();
      case 'patrol':
        return this.intentPatrol(botPos, state);
      case 'orbit':
        return this.intentOrbit(botPos);
      default:
        return null;
    }
  }

  private intentTowardLocal(
    botPos: Vec3,
    sign: 1 | -1,
  ): { x: number; z: number } | null {
    const local = this.getLocalPlayerPos();
    const dx = local.x - botPos.x;
    const dz = local.z - botPos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-3) return null;
    return { x: (dx / dist) * sign, z: (dz / dist) * sign };
  }

  private intentWander(): { x: number; z: number } {
    if (this.clock.now() >= this.modeState.wanderUntilMs) {
      this.pickWanderDirection(0);
    }
    return this.modeState.wanderDir;
  }

  /** Pick a fresh random wander direction and a hold window. `bias` rotates
   * away from the current direction so a re-pick after a wall hit doesn't
   * pick the same direction. */
  private pickWanderDirection(bias: number): void {
    const angle = Math.random() * Math.PI * 2 + bias;
    this.modeState.wanderDir = { x: Math.cos(angle), z: Math.sin(angle) };
    // 1.0–3.0 s hold window before the next direction change.
    this.modeState.wanderUntilMs = this.clock.now() + 1000 + Math.random() * 2000;
  }

  private intentPatrol(
    botPos: Vec3,
    state: ReturnType<NonNullable<typeof this.botStore>['getState']>,
  ): { x: number; z: number } | null {
    if (!this.modeState.patrolWaypoints) {
      // Inset square from the map's half-extent. Bot loops these.
      const half = (state.worldMap.gridSize * state.worldMap.cubeSize) / 2;
      const inset = Math.max(2, half * 0.6);
      this.modeState.patrolWaypoints = [
        { x: +inset, z: +inset },
        { x: +inset, z: -inset },
        { x: -inset, z: -inset },
        { x: -inset, z: +inset },
      ];
      this.modeState.patrolIdx = 0;
    }
    const waypoints = this.modeState.patrolWaypoints!;
    const target = waypoints[this.modeState.patrolIdx]!;
    const dx = target.x - botPos.x;
    const dz = target.z - botPos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.6) {
      this.modeState.patrolIdx =
        (this.modeState.patrolIdx + 1) % waypoints.length;
      return this.intentPatrol(botPos, state); // tail-call to next leg
    }
    return { x: dx / dist, z: dz / dist };
  }

  /** Walk along the tangent of a circle around the local player. The
   * circle's radius is the current bot↔local distance, so the bot doesn't
   * snap to a fixed orbit radius — it just keeps that distance and circles. */
  private intentOrbit(botPos: Vec3): { x: number; z: number } {
    const local = this.getLocalPlayerPos();
    const dx = botPos.x - local.x;
    const dz = botPos.z - local.z;
    const r = Math.hypot(dx, dz);
    if (r < 1e-3) {
      // On top of the player — kick out in +X.
      return { x: 1, z: 0 };
    }
    // Tangent direction (90° CCW from the radius vector, normalised).
    return { x: -dz / r, z: dx / r };
  }
}

export const BOT_MODES = ALL_MODES;
