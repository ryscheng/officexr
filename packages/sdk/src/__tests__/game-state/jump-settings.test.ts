import { describe, it, expect } from 'vitest';
import { DEFAULT_WORLD_SETTINGS } from '../../game-state/types.ts';
import type { JumpSettings, PlayerState, WorldSettings } from '../../game-state/types.ts';

// Compile-time check: WorldSettings must satisfy JumpSettings.
// This line errors at compile time if the intersection is missing JumpSettings.
const _check: JumpSettings = DEFAULT_WORLD_SETTINGS;
// Silence unused-variable lint
void _check;

describe('JumpSettings fields on DEFAULT_WORLD_SETTINGS', () => {
  it('jumpVelocity is a number', () => {
    expect(typeof DEFAULT_WORLD_SETTINGS.jumpVelocity).toBe('number');
  });

  it('airControl is a number', () => {
    expect(typeof DEFAULT_WORLD_SETTINGS.airControl).toBe('number');
  });

  it('maxJumps is a number', () => {
    expect(typeof DEFAULT_WORLD_SETTINGS.maxJumps).toBe('number');
  });

  it('landingEaseMs is a number', () => {
    expect(typeof DEFAULT_WORLD_SETTINGS.landingEaseMs).toBe('number');
  });
});

describe('DEFAULT_WORLD_SETTINGS jump default values', () => {
  it('jumpVelocity === 8', () => {
    expect(DEFAULT_WORLD_SETTINGS.jumpVelocity).toBe(8);
  });

  it('airControl === 0.2', () => {
    expect(DEFAULT_WORLD_SETTINGS.airControl).toBe(0.2);
  });

  it('maxJumps === 2', () => {
    expect(DEFAULT_WORLD_SETTINGS.maxJumps).toBe(2);
  });

  it('landingEaseMs === 120', () => {
    expect(DEFAULT_WORLD_SETTINGS.landingEaseMs).toBe(120);
  });
});

describe('JumpSettings value constraints', () => {
  it('airControl is in range [0, 1]', () => {
    expect(DEFAULT_WORLD_SETTINGS.airControl).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_WORLD_SETTINGS.airControl).toBeLessThanOrEqual(1);
  });

  it('maxJumps is a positive integer', () => {
    expect(Number.isInteger(DEFAULT_WORLD_SETTINGS.maxJumps)).toBe(true);
    expect(DEFAULT_WORLD_SETTINGS.maxJumps).toBeGreaterThanOrEqual(1);
  });

  it('landingEaseMs is non-negative', () => {
    expect(DEFAULT_WORLD_SETTINGS.landingEaseMs).toBeGreaterThanOrEqual(0);
  });
});

describe('PlayerState has isAirborne field', () => {
  it('accepts isAirborne: false in a full PlayerState object (compile-time type check)', () => {
    // This is a compile-time check — if PlayerState doesn't include isAirborne,
    // TypeScript errors here. At runtime it's a no-op tautology.
    const p: PlayerState = {
      id: 'x',
      name: '',
      pos: { x: 0, y: 0, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      yaw: 0,
      hp: 100,
      isDead: false,
      isAirborne: false,
      avatar: { model: 'default' },
      jitsiRoom: null,
      status: 'active',
    };
    expect(p.isAirborne).toBe(false);
  });
});

// Suppress unused-import lint for the WorldSettings type import
const _ws: WorldSettings = DEFAULT_WORLD_SETTINGS;
void _ws;
