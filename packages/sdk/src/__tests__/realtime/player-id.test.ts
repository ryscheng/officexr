import { describe, expect, it } from 'vitest';
import { loginOf, sessionPlayerId } from '../../realtime/player-id.ts';

describe('player ids', () => {
  it('round-trips a session id back to its login', () => {
    const id = sessionPlayerId('ann@example.com', 't1');
    expect(id).toBe('ann@example.com#t1');
    expect(loginOf(id)).toBe('ann@example.com');
  });

  it('treats a bare login as its own login', () => {
    expect(loginOf('ann@example.com')).toBe('ann@example.com');
  });
});
