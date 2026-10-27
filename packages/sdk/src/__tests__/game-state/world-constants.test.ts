import { describe, expect, it } from 'vitest';
import { DEFAULT_WORLD_SETTINGS } from '../../game-state/types.ts';
import {
  DEFAULT_WORLD_CONSTANTS,
  parseWorldConstants,
  worldSettingsFromConstants,
} from '../../game-state/world-constants.ts';
import { createStore } from '../../game-state/store.ts';

describe('WorldConstants', () => {
  it('default constants derive the same gameplay settings as before', () => {
    expect(worldSettingsFromConstants(DEFAULT_WORLD_CONSTANTS)).toEqual({
      playerSpeed: 3,
      runSpeedMultiplier: 2,
      walkAnimSpeed: 1,
      runAnimSpeed: 1,
      idleAnimSpeed: 1,
      turnSpeed: 16,
      charRadius: 0.4,
      proximityRadius: 3,
      proximityOuterRadius: 6,
      bumpEasingMs: 180,
      proximityEnterDebounceMs: 500,
      movementBlockThreshold: 0.9,
      jumpVelocity: 8,
      airControl: 0.2,
      maxJumps: 2,
      landingEaseMs: 120,
    });
  });

  it('a fresh store derives its world settings from the default constants', () => {
    const state = createStore({ selfId: 'me', officeId: 'o' }).getState();
    expect(state.worldConstants).toEqual(DEFAULT_WORLD_CONSTANTS);
    expect(state.worldSettings).toEqual(DEFAULT_WORLD_SETTINGS);
  });

  it('parseWorldConstants round-trips a valid document and throws on an invalid one', () => {
    expect(parseWorldConstants(JSON.parse(JSON.stringify(DEFAULT_WORLD_CONSTANTS)))).toEqual(
      DEFAULT_WORLD_CONSTANTS,
    );
    expect(() => parseWorldConstants({ ...DEFAULT_WORLD_CONSTANTS, schemaVersion: 2 })).toThrow();
    expect(() => parseWorldConstants(null)).toThrow();
  });
});
