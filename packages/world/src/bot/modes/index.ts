import { idleStrategy } from './idle.ts';
import { orbitStrategy } from './orbit.ts';
import { patrolStrategy } from './patrol.ts';
import { walkAwayStrategy, walkToLocalStrategy } from './walkToLocal.ts';
import { wanderStrategy, pickWanderDirection } from './wander.ts';
import type { BotMode, BotModeStrategy } from './types.ts';

export type { BotMode, BotModeContext, BotModeStrategy, ModeState } from './types.ts';
export { ALL_MODES } from './types.ts';
export { pickWanderDirection };

/** Strategy lookup table — adding a new mode is a `BotMode` union edit
 * + a new file + an entry here. The BotDriver never branches on the
 * mode name itself. */
export const BOT_MODE_STRATEGIES: Record<BotMode, BotModeStrategy> = {
  idle: idleStrategy,
  'walk-to-local': walkToLocalStrategy,
  'walk-away': walkAwayStrategy,
  wander: wanderStrategy,
  patrol: patrolStrategy,
  orbit: orbitStrategy,
};
