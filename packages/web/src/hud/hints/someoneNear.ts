import type { OfficeState } from '@officexr/sdk';
import { planarDistance } from '@officexr/world/top-down';

export const NEAR_RANGE_M = 8;

export const selectSomeoneNear = (s: OfficeState): boolean => {
  const me = s.players[s.selfId];
  return !!me && Object.values(s.players).some((p) => p.id !== s.selfId && p.name.trim() !== '' && planarDistance(me.pos, p.pos) <= NEAR_RANGE_M);
};
