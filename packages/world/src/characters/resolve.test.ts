import { describe, it, expect } from 'vitest';
import { DEFAULT_WORLD_SETTINGS } from '@officexr/sdk';
import { resolveCharacterTunables } from './resolve.ts';

describe('resolveCharacterTunables', () => {
  it('falls back to WorldSettings when no per-character config exists', () => {
    const out = resolveCharacterTunables('Knight', DEFAULT_WORLD_SETTINGS, {});
    expect(out.playerSpeed).toBe(DEFAULT_WORLD_SETTINGS.playerSpeed);
    expect(out.runSpeedMultiplier).toBe(
      DEFAULT_WORLD_SETTINGS.runSpeedMultiplier,
    );
    expect(out.turnSpeed).toBe(DEFAULT_WORLD_SETTINGS.turnSpeed);
    expect(out.charRadius).toBe(DEFAULT_WORLD_SETTINGS.charRadius);
    expect(out.bumpEasingMs).toBe(DEFAULT_WORLD_SETTINGS.bumpEasingMs);
    expect(out.walkAnimSpeed).toBe(DEFAULT_WORLD_SETTINGS.walkAnimSpeed);
    expect(out.runAnimSpeed).toBe(DEFAULT_WORLD_SETTINGS.runAnimSpeed);
    expect(out.idleAnimSpeed).toBe(DEFAULT_WORLD_SETTINGS.idleAnimSpeed);
  });

  it('multiplies playerSpeed by speedMultiplier', () => {
    const out = resolveCharacterTunables('Mage', DEFAULT_WORLD_SETTINGS, {
      Mage: { speedMultiplier: 0.5 },
    });
    expect(out.playerSpeed).toBeCloseTo(DEFAULT_WORLD_SETTINGS.playerSpeed * 0.5);
  });

  it('replaces individual scalar overrides without touching unrelated fields', () => {
    const out = resolveCharacterTunables('Knight', DEFAULT_WORLD_SETTINGS, {
      Knight: { charRadius: 0.55, walkAnimSpeed: 1.3 },
    });
    expect(out.charRadius).toBe(0.55);
    expect(out.walkAnimSpeed).toBe(1.3);
    expect(out.runAnimSpeed).toBe(DEFAULT_WORLD_SETTINGS.runAnimSpeed);
    expect(out.playerSpeed).toBe(DEFAULT_WORLD_SETTINGS.playerSpeed);
  });

  it('does not let configs for one model leak into another', () => {
    const configs = {
      Mage: { speedMultiplier: 0.5 },
      Knight: { charRadius: 0.7 },
    };
    const mage = resolveCharacterTunables('Mage', DEFAULT_WORLD_SETTINGS, configs);
    const knight = resolveCharacterTunables('Knight', DEFAULT_WORLD_SETTINGS, configs);
    expect(mage.charRadius).toBe(DEFAULT_WORLD_SETTINGS.charRadius);
    expect(knight.playerSpeed).toBe(DEFAULT_WORLD_SETTINGS.playerSpeed);
  });
});
