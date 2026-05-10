import {
  createStore,
  createActions,
  createBus,
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

const MAX_DISTANCE = 20;

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
    // Sign chooses approach vs retreat; magnitude is the broadcast world
    // speed — the bot reads its own store's worldSettings, which the
    // SyncEngine keeps in sync with peers via `world:settings` events.
    const sign = this.mode === 'walk-to-local' ? 1 : -1;
    const speed =
      this.botStore?.getState().worldSettings.playerSpeed ?? this.speed;
    const moveDX = dirX * speed * sign * (dt / 1000);
    const moveDZ = dirZ * speed * sign * (dt / 1000);

    let newX = botPos.x + moveDX;
    let newZ = botPos.z + moveDZ;

    if (this.mode === 'walk-away') {
      const distFromOrigin = Math.sqrt(newX * newX + newZ * newZ);
      if (distFromOrigin > MAX_DISTANCE) {
        const scale = MAX_DISTANCE / distFromOrigin;
        newX *= scale;
        newZ *= scale;
      }
    }

    const newPos: Vec3 = { x: newX, y: botPos.y, z: newZ };
    // Authoritative vel = direction × speed. The wire protocol re-derives
    // vel from position deltas anyway, but writing it here makes the local
    // store match remote stores so the renderer can read player.vel as a
    // single source of truth for "is this player moving".
    const actualDX = newX - botPos.x;
    const actualDZ = newZ - botPos.z;
    const stepLen = Math.hypot(actualDX, actualDZ);
    const vel: Vec3 =
      stepLen > 0
        ? {
            x: (actualDX / stepLen) * speed,
            y: 0,
            z: (actualDZ / stepLen) * speed,
          }
        : { x: 0, y: 0, z: 0 };
    // Bot faces its movement direction. Same yaw convention as SceneFrame.
    const yaw = Math.atan2(-actualDX, -actualDZ);
    this.botActions.setSelfPosition(newPos, vel, yaw);
    this.botSync.flushPosition();
    this.botHandshake.tickTimers();
    this.wasMoving = true;
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
