import type { Vec3 } from '@officexr/sdk';
import type { createInMemoryChannelHub } from '@officexr/sdk';
import { BotDriver, type BotMode } from './BotDriver.ts';

interface BotPoolOptions {
  hub: ReturnType<typeof createInMemoryChannelHub>;
  localPlayerPosGetter: () => Vec3;
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
  private readonly hub: BotPoolOptions['hub'];
  private readonly localPlayerPosGetter: () => Vec3;
  private bots: BotDriver[] = [];
  private currentMode: BotMode = 'idle';

  constructor(opts: BotPoolOptions) {
    this.hub = opts.hub;
    this.localPlayerPosGetter = opts.localPlayerPosGetter;
  }

  /** Reach `n` active bots. New bots inherit the pool's current mode and
   * spawn at perimeter positions distributed around the origin so they
   * don't all stack on top of each other. */
  async setCount(n: number): Promise<void> {
    while (this.bots.length < n) {
      const idx = this.bots.length;
      const bot = new BotDriver({
        hub: this.hub,
        localPlayerPosGetter: this.localPlayerPosGetter,
        botId: botIdFor(idx),
        startPos: spawnPosition(idx),
        mode: this.currentMode,
      });
      this.bots.push(bot);
      await bot.start();
    }
    while (this.bots.length > n) {
      const bot = this.bots.pop();
      bot?.stop();
    }
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

  /** Stop and clear every bot. Called on unmount. */
  stop(): void {
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
