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
import { FakeClock } from '@officexr/sdk/test-harness';
import type { Clock } from '@officexr/sdk/test-harness';

export interface BotDriverOptions {
  hub: ReturnType<typeof createInMemoryChannelHub>;
  localPlayerPosGetter: () => Vec3;
  botId?: string;
  speed?: number;
  startPos?: Vec3;
  clock?: Clock;
}

type BotMode = 'idle' | 'walk-to-local' | 'walk-away';

export class BotDriver {
  readonly botId: string;

  private hub: ReturnType<typeof createInMemoryChannelHub>;
  private localPlayerPosGetter: () => Vec3;
  private speed: number;
  private startPos: Vec3;
  private clock: Clock;

  private mode: BotMode = 'idle';
  private stopped = false;
  /** Tracks the moving → idle transition so we clear `vel` exactly once
   * when the bot stops. */
  private wasMoving = false;

  // Bot client internals — set during start()
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
  }

  async start(): Promise<void> {
    const botId = this.botId;
    const officeId = 'debug-office';

    const botStore = createStore({ selfId: botId, officeId });
    const botBus = createBus();
    const botActions = createActions(botStore, botBus);

    // Seed bot player at startPos
    botActions.upsertPlayer({
      id: botId,
      name: 'Bot',
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

    if (this.mode === 'idle') {
      // On the moving → idle transition, broadcast a single zero-velocity
      // update so the local-player renderer and remote peers see the stop.
      if (this.wasMoving) {
        const me = this.botStore!.getState().players[this.botId];
        const yaw = me?.yaw ?? 0;
        this.botActions.setSelfPosition(botPos, { x: 0, y: 0, z: 0 }, yaw);
        this.botSync.flushPosition();
        this.wasMoving = false;
      }
      this.botHandshake.tickTimers();
      return;
    }

    const localPos = this.localPlayerPosGetter();
    const dx = localPos.x - botPos.x;
    const dz = localPos.z - botPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.001) return;

    const dirX = dx / dist;
    const dirZ = dz / dist;
    const sign = this.mode === 'walk-to-local' ? 1 : -1;
    const botState = this.botStore!.getState();
    const { playerSpeed, charRadius, movementBlockThreshold } =
      botState.worldSettings;
    const speed = playerSpeed ?? this.speed;
    const moveDX = dirX * speed * sign * (dt / 1000);
    const moveDZ = dirZ * speed * sign * (dt / 1000);

    // Other characters come from the bot's own store — the SDK upserts
    // peers via applyRemotePosition the moment their first presence:position
    // arrives, so the local player materialises here without any
    // debug-side workaround.
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

    // Progress along the intent vector. Same gating as SceneFrame: snap to
    // zero when blocked beyond threshold so the bot doesn't slide while its
    // walk anim has already settled to idle; otherwise scale vel by progress.
    const intentDX = intentTo.x - botPos.x;
    const intentDZ = intentTo.z - botPos.z;
    const intentLenSq = intentDX * intentDX + intentDZ * intentDZ;
    let progress = 1;
    if (intentLenSq > 1e-12) {
      const actualDX = result.pos.x - botPos.x;
      const actualDZ = result.pos.z - botPos.z;
      const dot = actualDX * intentDX + actualDZ * intentDZ;
      progress = Math.max(0, Math.min(1, dot / intentLenSq));
    }
    const minProgress = 1 - movementBlockThreshold;

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
      // Walk-direction unit vector × speed × progress. The renderer reads
      // |vel| to decide idle/walk and to scale the walk-animation rate.
      vel = {
        x: dirX * sign * speed * progress,
        y: 0,
        z: dirZ * sign * speed * progress,
      };
      moved = true;
      yaw = Math.atan2(-dirX * sign, -dirZ * sign);
    }
    this.botActions.setSelfPosition(newPos, vel, yaw);
    this.botSync.flushPosition();
    this.botHandshake.tickTimers();
    this.wasMoving = moved;
  }

  setMode(mode: BotMode): void {
    this.mode = mode;
  }

  getBotPos(): Vec3 {
    if (!this.botStore) return { ...this.startPos };
    const state = this.botStore.getState();
    const player = state.players[this.botId];
    return player?.pos ?? { ...this.startPos };
  }
}
