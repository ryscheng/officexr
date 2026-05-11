import type { Bus, Channel, PlayerId, Vec3, WorldMap, WorldSettings } from '@officexr/sdk';
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

  /** Tick every bot. Called once per frame from SceneFrame. */
  tick(dt: number): void {
    for (const b of this.bots) b.tick(dt);
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
