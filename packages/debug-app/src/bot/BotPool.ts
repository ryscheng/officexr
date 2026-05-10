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
  /** Latest target count; the serialised loop below converges to this. */
  private targetCount = 0;
  /** When non-null, a setCount loop is in flight. Subsequent setCount
   * calls just bump `targetCount` and chain onto the existing promise. */
  private resizeChain: Promise<void> | null = null;
  /** Once stopped, setCount and the in-flight resize loop are no-ops so
   * an unmount mid-`await bot.start()` doesn't leak a follow-up spawn. */
  private stopped = false;

  constructor(opts: BotPoolOptions) {
    this.hub = opts.hub;
    this.localPlayerPosGetter = opts.localPlayerPosGetter;
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
              hub: this.hub,
              localPlayerPosGetter: this.localPlayerPosGetter,
              botId: botIdFor(idx),
              startPos: spawnPosition(idx),
              mode: this.currentMode,
              phaseIndex: idx,
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
