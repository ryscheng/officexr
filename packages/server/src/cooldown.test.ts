import { describe, expect, it } from 'vitest';
import { createCooldown } from './cooldown';

describe('createCooldown', () => {
  it('allows one action per key per window and reports the time left', () => {
    let now = 1_000;
    const cooldown = createCooldown(120_000, () => now);
    expect(cooldown.take('a>b')).toBe(0);
    now += 30_000;
    expect(cooldown.take('a>b')).toBe(90_000);
    expect(cooldown.take('b>a')).toBe(0);
    expect(cooldown.take('a>c')).toBe(0);
    now += 90_000;
    expect(cooldown.take('a>b')).toBe(0);
  });

  it('lets a released key go again at once', () => {
    const cooldown = createCooldown(120_000, () => 0);
    cooldown.take('a>b');
    cooldown.release('a>b');
    expect(cooldown.take('a>b')).toBe(0);
  });
});
