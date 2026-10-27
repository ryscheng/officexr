// Public bot surface. The studio's renderer + Leva BotPanel consume
// this. `BotServer` is **deliberately excluded** — it pulls Node's
// `http` module via @officexr/realtime-server, which would taint the
// browser bundle. CLI consumers import it directly from
// `./bot-server.ts` (see `bots-cli.ts`).

export { BotPool } from './BotPool.ts';
export {
  BotDriver,
  BOT_MODES,
  type BotMode,
  type BotDriverOptions,
} from './BotDriver.ts';
export {
  BotPhysicsWorld,
  BODY_Y,
  type StepResult,
  type SensorEvent,
} from './BotPhysicsWorld.ts';
export {
  BOT_MODE_STRATEGIES,
  ALL_MODES,
  type BotModeContext,
  type BotModeStrategy,
  type ModeState,
} from './modes/index.ts';
