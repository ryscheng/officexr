import type { PlayerId } from '../game-state/types.ts';

/** Player id of one browser tab's session for `login`. A bare login is
 * also a valid player id: a login with a single session. */
export const sessionPlayerId = (login: string, tabId: string): PlayerId => `${login}#${tabId}`;

export const loginOf = (playerId: PlayerId): string => playerId.split('#')[0];
