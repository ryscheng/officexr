import { describe, expect, it } from 'vitest';
import {
  AWAY_UNRESPONSIVE_MS,
  UNRESPONSIVE_MS,
  presenceIndicator,
} from '../../game-state/presence.ts';
import type { PlayerState } from '../../game-state/types.ts';

function player(patch: Partial<PlayerState>): PlayerState {
  return {
    id: 'p',
    name: 'P',
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    hp: 100,
    isDead: false,
    isAirborne: false,
    avatar: { model: 'default' },
    jitsiRoom: null,
    status: 'available',
    mic: 'none',
    ...patch,
  };
}

describe('presenceIndicator', () => {
  it('shows the status of a recently heard player', () => {
    expect(presenceIndicator(player({ lastStatusAt: 0 }), UNRESPONSIVE_MS)).toBe('available');
    expect(presenceIndicator(player({ status: 'away', lastStatusAt: 0 }), UNRESPONSIVE_MS + 1)).toBe('away');
  });

  it('flags an available player silent for more than 15 s', () => {
    expect(presenceIndicator(player({ lastStatusAt: 0 }), UNRESPONSIVE_MS + 1)).toBe('unresponsive');
  });

  it('gives an away player 150 s', () => {
    const away = player({ status: 'away', lastStatusAt: 0 });
    expect(presenceIndicator(away, AWAY_UNRESPONSIVE_MS)).toBe('away');
    expect(presenceIndicator(away, AWAY_UNRESPONSIVE_MS + 1)).toBe('unresponsive');
  });

  it('ages a never-heard player from firstSeenAt', () => {
    const p = player({ firstSeenAt: 1000 });
    expect(presenceIndicator(p, 1000 + UNRESPONSIVE_MS)).toBe('available');
    expect(presenceIndicator(p, 1000 + UNRESPONSIVE_MS + 1)).toBe('unresponsive');
  });

  it('prefers lastStatusAt over firstSeenAt', () => {
    const p = player({ firstSeenAt: 0, lastStatusAt: 20_000 });
    expect(presenceIndicator(p, 30_000)).toBe('available');
  });

  it('shows the status of a player with no timestamps', () => {
    expect(presenceIndicator(player({}), 10 * AWAY_UNRESPONSIVE_MS)).toBe('available');
  });

  it('is offline for a departed entry', () => {
    expect(presenceIndicator({ leftAt: 0 }, 1)).toBe('offline');
  });
});
