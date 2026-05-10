import {
  createStore,
  createActions,
  createBus,
  getCollisionWorld,
  resolveMovement,
  serializeOfficeState,
  SyncEngine,
  SnapshotHandshake,
  createInMemoryChannelHub,
  InMemoryChannel,
} from '@officexr/sdk';
import type { Vec3 } from '@officexr/sdk';
import type { Clock } from '@officexr/sdk/test-harness';

export interface BotDriverOptions {
  hub: ReturnType<typeof createInMemoryChannelHub>;
  localPlayerPosGetter: () => Vec3;
  botId?: string;
  speed?: number;
  startPos?: Vec3;
  clock?: Clock;
  /** Initial traversal mode. Defaults to 'idle'. */
  mode?: BotMode;
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

export class BotDriver {
  readonly botId: string;

  private hub: ReturnType<typeof createInMemoryChannelHub>;
  private localPlayerPosGetter: () => Vec3;
  private speed: number;
  private startPos: Vec3;
  private clock: Clock;

  private mode: BotMode;
  private stopped = false;
  private wasMoving = false;
  private modeState: ModeState = {
    wanderDir: { x: 1, z: 0 },
    wanderUntilMs: 0,
    patrolIdx: 0,
    patrolWaypoints: null,
    orbitAngle: 0,
  };

  private botStore: ReturnType<typeof createStore> | null = null;
  private botActions: ReturnType<typeof createActions> | null = null;
  private botChannel: InMemoryChannel | null = null;
  private botSync: SyncEngine | null = null;
  private botHandshake: SnapshotHandshake | null = null;

  constructor(opts: BotDriverOptions) {
    this.hub = opts.hub;
    this.localPlayerPosGetter = opts.localPlayerPosGetter;
    this.botId = opts.botId ?? 'bot-001';
    this.speed = opts.speed ?? 1.5;
    this.startPos = opts.startPos ?? { x: 10, y: 0, z: 0 };
    this.clock = opts.clock ?? { now: () => performance.now() };
    this.mode = opts.mode ?? 'idle';
  }

  async start(): Promise<void> {
    const botId = this.botId;
    const officeId = 'debug-office';

    const botStore = createStore({ selfId: botId, officeId });
    const botBus = createBus();
    const botActions = createActions(botStore, botBus);

    botActions.upsertPlayer({
      id: botId,
      name: this.botId,
      pos: { ...this.startPos },
      vel: { x: 0, y: 0, z: 0 },
      yaw: 0,
    });

    const botChannel = new InMemoryChannel(this.hub, botId);
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
    this.botChannel = botChannel;
    this.botSync = botSync;
    this.botHandshake = botHandshake;
  }

  stop(): void {
    this.stopped = true;
    this.botSync?.stop();
    this.botHandshake?.stop();
    this.botChannel?.close();
  }

  tick(dt: number): void {
    if (this.stopped || !this.botActions || !this.botSync || !this.botHandshake)
      return;

    const botPos = this.getBotPos();
    const botState = this.botStore!.getState();
    const { playerSpeed, charRadius, movementBlockThreshold } =
      botState.worldSettings;
    const speed = playerSpeed ?? this.speed;

    // 1) Decide a unit-length intent direction in XZ from the current mode.
    //    Idle returns null and we short-circuit to the rest-broadcast branch.
    const intent = this.computeIntent(botPos, botState, dt);
    if (!intent) {
      if (this.wasMoving) {
        const me = botState.players[this.botId];
        const yaw = me?.yaw ?? 0;
        this.botActions.setSelfPosition(botPos, { x: 0, y: 0, z: 0 }, yaw);
        this.botSync.flushPosition();
        this.wasMoving = false;
      }
      this.botHandshake.tickTimers();
      return;
    }

    const moveDX = intent.x * speed * (dt / 1000);
    const moveDZ = intent.z * speed * (dt / 1000);

    // 2) Run the same collision/bounds resolver the local player uses.
    const others: Array<{ id: string; pos: Vec3; radius: number }> = [];
    for (const [id, p] of Object.entries(botState.players)) {
      if (id === this.botId) continue;
      others.push({ id, pos: p.pos, radius: charRadius });
    }
    const intentTo: Vec3 = {
      x: botPos.x + moveDX,
      y: botPos.y,
      z: botPos.z + moveDZ,
    };
    const result = resolveMovement({
      from: botPos,
      to: intentTo,
      charRadius,
      world: getCollisionWorld(botState.worldMap),
      others,
    });

    // 3) Progress gating + write state, identical to SceneFrame's local path.
    const intentLenSq = moveDX * moveDX + moveDZ * moveDZ;
    let progress = 1;
    if (intentLenSq > 1e-12) {
      const actualDX = result.pos.x - botPos.x;
      const actualDZ = result.pos.z - botPos.z;
      const dot = actualDX * moveDX + actualDZ * moveDZ;
      progress = Math.max(0, Math.min(1, dot / intentLenSq));
    }
    const minProgress = 1 - movementBlockThreshold;

    // Wander pivots early when it hits a wall — otherwise it would lock
    // its current direction against an obstacle for the full hold window.
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
      newPos = result.pos;
      vel = {
        x: intent.x * speed * progress,
        y: 0,
        z: intent.z * speed * progress,
      };
      moved = true;
      yaw = Math.atan2(-intent.x, -intent.z);
    }
    this.botActions.setSelfPosition(newPos, vel, yaw);
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
      const local = this.localPlayerPosGetter();
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
    const local = this.localPlayerPosGetter();
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
    const local = this.localPlayerPosGetter();
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
