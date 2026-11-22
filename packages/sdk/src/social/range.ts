import type { WorldConstants } from '../game-state/world-constants.ts';

const CHAR_RADIUS_M = 0.4;

export function nearbyChatRangeM(constants: Pick<WorldConstants, 'proximity'>): number {
  return 2 * CHAR_RADIUS_M + constants.proximity.outerRadius;
}
