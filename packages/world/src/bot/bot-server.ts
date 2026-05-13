import { InMemoryChannel, type PlayerId } from '@officexr/sdk';
import {
  RealtimeServer,
  type RealtimeServerOptions,
  type WsClient,
} from '@officexr/realtime-server/server';
import { BotPool } from './BotPool.ts';
import type { BotMode } from './BotDriver.ts';

const LOCAL_PLAYER_ID: PlayerId = 'local-player';
const TICK_INTERVAL_MS = 1000 / 60;

/** Frame kinds the browser uses to drive this server's bot pool. */
const FRAME_SET_COUNT = 'bots:set-count';
const FRAME_SET_MODE = 'bots:set-mode';
const FRAME_BOTS_STATE = 'bots:state';

export interface BotServerOptions extends RealtimeServerOptions {
  /** Initial number of bots. Default 0 — the CLI sits idle until the
   * browser publishes a `bots:set-count` custom frame. */
  initialCount?: number;
  /** Initial mode for the pool. Default `'wander'`. */
  initialMode?: BotMode;
  /** PlayerId of the human player whose position bots home toward in
   * `walk-to-local` / `orbit` modes. Default `'local-player'`. */
  localPlayerId?: PlayerId;
}

/**
 * A {@link RealtimeServer} that also runs a {@link BotPool} in-process.
 * Each bot attaches to the server's hub as a plain
 * {@link InMemoryChannel}, so it participates as a real peer without
 * any extra websocket overhead — broadcasts ride the same hub fan-out
 * as the WS clients.
 *
 * The browser controls bot count / mode via two custom frames:
 *   - `bots:set-count` payload `{ count: number }`
 *   - `bots:set-mode` payload `{ mode: BotMode }`
 */
export class BotServer extends RealtimeServer {
  readonly pool: BotPool;
  private readonly initialCount: number;
  private readonly initialMode: BotMode;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private lastTickMs = 0;
  private offCustom: (() => void) | null = null;

  constructor(opts: BotServerOptions = {}) {
    super(opts);
    this.initialCount = opts.initialCount ?? 0;
    this.initialMode = opts.initialMode ?? 'wander';
    const localId = opts.localPlayerId ?? LOCAL_PLAYER_ID;
    this.pool = new BotPool({
      createChannel: (botId) => new InMemoryChannel(this.hub, botId),
      localPlayerId: localId,
      // Each new bot inherits the server's *current* authoritative
      // world state — which the browser's `broadcastWorldState()`
      // updates on connect. Without this, a bot spawned mid-session
      // would use SDK defaults and collide against a different floor
      // extent than the renderer is showing.
      getInitialWorld: () => {
        const state = this.store.getState();
        return {
          worldSettings: { ...state.worldSettings },
          worldMap: state.worldMap,
        };
      },
    });
  }

  override async start(): Promise<void> {
    await super.start();
    this.pool.setMode(this.initialMode);
    if (this.initialCount > 0) await this.pool.setCount(this.initialCount);

    this.offCustom = this.onCustomFrame((_client, kind, payload) => {
      if (kind === FRAME_SET_COUNT) {
        const n = Number((payload as { count?: unknown })?.count);
        if (Number.isFinite(n)) {
          void this.pool.setCount(n).then(() => this.broadcastState());
          console.log(`[bot-server] set-count → ${n}`);
        }
        return true;
      }
      if (kind === FRAME_SET_MODE) {
        const mode = (payload as { mode?: unknown })?.mode as BotMode;
        if (typeof mode === 'string') {
          this.pool.setMode(mode);
          this.broadcastState();
          console.log(`[bot-server] set-mode → ${mode}`);
        }
        return true;
      }
      return false;
    });

    this.lastTickMs = performance.now();
    this.ticker = setInterval(() => {
      const now = performance.now();
      const dt = now - this.lastTickMs;
      this.lastTickMs = now;
      this.pool.tick(dt);
    }, TICK_INTERVAL_MS);
  }

  override async stop(): Promise<void> {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
    if (this.offCustom) {
      this.offCustom();
      this.offCustom = null;
    }
    this.pool.stop();
    await super.stop();
  }

  /** Broadcast current pool state to all connected clients so the
   * browser's Leva controls can reflect what the server actually has. */
  private broadcastState(): void {
    this.sendCustom(FRAME_BOTS_STATE, { count: this.pool.count() });
  }
}

// Reference WsClient in a way that's preserved by tree shaking even
// though we don't use the type directly here — keeps the import alive
// for callers that subclass BotServer further.
export type { WsClient };
