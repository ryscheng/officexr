import type { BotModeStrategy } from './types.ts';

/** Don't move; the driver short-circuits broadcast when intent is null. */
export const idleStrategy: BotModeStrategy = {
  computeIntent: () => null,
};
