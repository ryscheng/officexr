import type { Bus, Channel, PlayerId, Vec3, WorldMap, WorldObjects, WorldSettings } from '@officexr/sdk';
import { BotDriver, type BotMode } from './BotDriver.ts';

interface BotPoolOptions {
  /** Channel factory passed through to each new BotDriver. The pool
   * doesn't care whether channels are InMemory (one shared hub) or
   * Supabase (separate realtime subscriptions) — only the factory does. */
  createChannel: (botId: PlayerId) => Channel;
  /** PlayerId of the local human player. Bots use it to home toward the
   * player in `walk-to-local` / `orbit` modes. */
  localPlayerId: PlayerId;
  /** Optional getter for the authoritative world state to seed each
   * new bot's SDK store with. Called at bot-spawn time so bots that
   * join *after* the human player has tweaked Leva inherit the
   * current values instead of SDK defaults. */
  getInitialWorld?: () => {
    worldSettings?: WorldSettings;
    worldMap?: WorldMap;
    worldObjects?: WorldObjects;
  };
  /** When a bot's character controller detects a body-vs-body contact
   * inside its own Rapier world (e.g. bot walked into the local player),
   * the resulting `collision:char-bump` event only fires on the bot's
   * private bus — the local renderer's `Players.tsx` subscribes to a
   * *different* bus and would never see it, so the visual bump
   * animation wouldn't play. If a `localBus` is provided, each bot
   * will forward bump events involving the local player onto it,
   * giving us symmetric visuals regardless of which character
   * initiates the collision. Only relevant for in-browser bots; the
   * Node CLI's BotPool doesn't have a local bus to plumb. */
  localBus?: Bus;
  /** Optional canonical AABB lookup. Threaded into every bot's
   * Rapier world so static colliders match the visible-mesh AABB of
   * each placed object. Studio production wiring passes
   * `api.geometry.worldAABB`. Headless / Node-CLI bots omit it and
   * fall back to the legacy one-voxel-cube collider. */
  instanceAABB?: import('../physics/rules.ts').InstanceAABBLookup;
  /** Optional collider-shape override lookup. Threaded into every bot's
   * Rapier world so compound-step staircase colliders mirror what
   * `MapColliders` emits on the browser side. Production wiring passes
   * `(id) => api.catalog.getKind(id)?.colliderShape`. */
  colliderShape?: import('../physics/rules.ts').ColliderShapeLookup;
}

/**
 * Manages a dynamic, ordered list of {@link BotDriver}s. The Leva panel
 * drives `setCount` / `setMode`; SceneFrame ticks the whole pool every
 * frame. Each bot has its own SDK client, so adding or removing one is
 * isolated — the local-player store learns about new bots via their
 * spawn-position broadcast and forgets removed bots when they
 * `channel.close()`.
 */
export class BotPool {
  private readonly createChannel: (botId: PlayerId) => Channel;
  private readonly localPlayerId: PlayerId;
  private readonly getInitialWorld?: BotPoolOptions['getInitialWorld'];
  private readonly localBus?: Bus;
  private readonly instanceAABB?: import('../physics/rules.ts').InstanceAABBLookup;
  private readonly colliderShape?: import('../physics/rules.ts').ColliderShapeLookup;
  private bots: BotDriver[] = [];
  private currentMode: BotMode = 'idle';
  /** Latest target count; the serialised loop below converges to this. */
  private targetCount = 0;
  /** When non-null, a setCount loop is in flight. Subsequent setCount
   * calls just bump `targetCount` and chain onto the existing promise. */
  private resizeChain: Promise<void> | null = null;
  /** Once stopped, setCount and the in-flight resize loop are no-ops so
   * an unmount mid-`await bot.start()` doesn't leak a follow-up spawn. */
  private stopped = false;

  constructor(opts: BotPoolOptions) {
    this.createChannel = opts.createChannel;
    this.localPlayerId = opts.localPlayerId;
    this.getInitialWorld = opts.getInitialWorld;
    this.localBus = opts.localBus;
    this.instanceAABB = opts.instanceAABB;
    this.colliderShape = opts.colliderShape;
  }

  /** Reach `n` active bots. New bots inherit the pool's current mode and
   * spawn at perimeter positions distributed around the origin so they
   * don't stack on top of each other.
   *
   * Concurrent calls (e.g. rapid Leva slider drags) are serialised — each
   * call updates the latest `targetCount` and the in-flight loop converges
   * to whatever the most recent target is. Without this, two overlapping
   * `await bot.start()` calls would each read `this.bots.length` at the
   * start and both append, overshooting. */
  async setCount(n: number): Promise<void> {
    if (this.stopped) return;
    this.targetCount = Math.max(0, Math.floor(n));
    if (this.resizeChain) return this.resizeChain;
    this.resizeChain = (async () => {
      try {
        // Drive the array toward the latest targetCount. If the target
        // shifts mid-loop (because setCount was called again while we
        // awaited bot.start), the loop continues until they match.
        while (!this.stopped && this.bots.length !== this.targetCount) {
          if (this.bots.length < this.targetCount) {
            const idx = this.bots.length;
            const bot = new BotDriver({
              createChannel: this.createChannel,
              localPlayerId: this.localPlayerId,
              botId: botIdFor(idx),
              startPos: spawnPosition(idx),
              mode: this.currentMode,
              phaseIndex: idx,
              initialWorld: this.getInitialWorld?.(),
              externalBus: this.localBus,
              instanceAABB: this.instanceAABB,
              colliderShape: this.colliderShape,
            });
            this.bots.push(bot);
            await bot.start();
            // If stop() fired while we awaited, our bot was already evicted
            // from `this.bots` (stop reassigns the array) — kill it directly
            // so it doesn't leak as an orphaned SDK client.
            if (this.stopped) {
              bot.stop();
              break;
            }
          } else {
            const bot = this.bots.pop();
            bot?.stop();
          }
        }
      } finally {
        this.resizeChain = null;
      }
    })();
    return this.resizeChain;
  }

  /** Apply the same mode to every bot. New bots spawned later inherit it
   * via the constructor `mode` option. */
  setMode(mode: BotMode): void {
    this.currentMode = mode;
    for (const b of this.bots) b.setMode(mode);
  }

  /**
   * Set the linear-walk direction for a specific bot by index and switch it
   * to `linear-walk` mode. Exposed on `__OFFICE_BOTS__` for Playwright tests
   * (tasks 10–12) to configure bot direction before a scenario starts.
   *
   * Usage from Playwright:
   *   await page.evaluate(() =>
   *     window.__OFFICE_BOTS__.setLinearWalkDir(0, { x: 0, z: 1 })
   *   );
   */
  setLinearWalkDir(botIndex: number, direction: { x: number; z: number }): void {
    const bot = this.bots[botIndex];
    if (!bot) return;
    bot.setModeWithConfig('linear-walk', { direction });
  }

  /** Tick every bot. Called once per frame from SceneFrame.
   *
   * Two-phase position collection: before each bot ticks, the
   * rolling `directPeers` map holds every OTHER bot's latest
   * known position (from the store, reflecting setSelfPosition
   * from the prior or current frame). This bypasses the 30Hz
   * broadcast cap for bot-to-bot peer mirror placement, reducing
   * per-frame position lag from ~0.1 m (2-frame broadcast lag
   * at 3 m/s) to at most ~0.05 m (1-frame store lag) so Rapier's
   * KCC never starts inside a peer mirror's collider at contact.
   *
   * Sequential order is preserved: bot-0 ticks first with prior-
   * tick positions for all peers; after its tick the map is updated
   * so bot-1 uses bot-0's fresh post-tick position as its mirror.
   */
  tick(dt: number): void {
    // Seed the map with every bot's store position BEFORE any tick
    // runs this frame (prior-tick positions for all).
    const directPeers = new Map<string, Vec3>();
    for (const b of this.bots) {
      directPeers.set(b.botId, b.getBotPos());
    }

    for (const b of this.bots) {
      b.tick(dt, directPeers);
      // After this bot ticks, update the map with its fresh post-tick
      // store position so subsequent bots see a zero-lag mirror.
      directPeers.set(b.botId, b.getBotPos());
    }
  }

  /** Stop and clear every bot. Called on unmount. Also flips the stopped
   * flag so any in-flight resize loop bails on its next iteration. */
  stop(): void {
    this.stopped = true;
    this.targetCount = 0;
    for (const b of this.bots) b.stop();
    this.bots = [];
  }

  count(): number {
    return this.bots.length;
  }

  /** For test / debug introspection. */
  list(): readonly BotDriver[] {
    return this.bots;
  }

  /**
   * Teleport every bot to a position from `spawns`. Bots cycle through
   * the spawn array modulo its length so N bots and M spawn points (any
   * N, M) always have an answer. With zero spawns, falls back to the
   * default perimeter ring so the cohort still scatters instead of
   * stacking at origin.
   *
   * Used by the Debug Map picker (`useMapPicker`) when the author
   * switches maps or clicks "Reset & respawn" — every bot warps to a
   * known location on the new map so playtesting starts from a
   * defined state.
   */
  respawnAll(spawns: readonly Vec3[]): void {
    if (this.stopped) return;
    if (this.bots.length === 0) return;
    // Materialise the fallback ring once and push the same list to
    // every driver so they all share the same fall-respawn answers
    // — keeps the cohort from rebuilding the ring on every fall.
    const effective: Vec3[] =
      spawns.length > 0
        ? spawns.map((s) => ({ ...s }))
        : this.bots.map((_, i) => spawnPosition(i));
    for (let i = 0; i < this.bots.length; i++) {
      this.bots[i].setSpawnList(effective);
      this.bots[i].setPosition({ ...effective[i % effective.length] });
    }
  }
}

function botIdFor(idx: number): string {
  return `bot-${String(idx + 1).padStart(3, '0')}`;
}

/** Spread bots evenly on a circle of radius 8m around the origin. */
function spawnPosition(idx: number): Vec3 {
  const ringRadius = 8;
  // Stagger angle so successive bots aren't immediately adjacent.
  const angle = (idx * Math.PI * 2 * 0.41) % (Math.PI * 2);
  return {
    x: Math.cos(angle) * ringRadius,
    y: 0,
    z: Math.sin(angle) * ringRadius,
  };
}
