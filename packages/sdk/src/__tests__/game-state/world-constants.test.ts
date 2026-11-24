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
      stepUpSpeedFactor: 0.7,
      climbAnimFactor: 1,
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

  it('parseWorldConstants accepts a horizon colour, still parses documents without one, and rejects a bad one', () => {
    const background = { ...DEFAULT_WORLD_CONSTANTS.background, horizonColor: '#ffd9b0' };
    expect(parseWorldConstants({ ...DEFAULT_WORLD_CONSTANTS, background }).background).toEqual(background);
    expect(parseWorldConstants(DEFAULT_WORLD_CONSTANTS).background.horizonColor).toBeUndefined();
    expect(() =>
      parseWorldConstants({ ...DEFAULT_WORLD_CONSTANTS, background: { ...background, horizonColor: 'peach' } }),
    ).toThrow();
  });
});

describe('stepUpSpeedFactor / climbAnimFactor', () => {
  const withAnimation = (extra: object) => ({
    ...DEFAULT_WORLD_CONSTANTS,
    animation: { ...DEFAULT_WORLD_CONSTANTS.animation, ...extra },
  });

  it('documents without them parse and resolve to the defaults', () => {
    const parsed = parseWorldConstants(DEFAULT_WORLD_CONSTANTS);
    expect(parsed.animation.stepUpSpeedFactor).toBeUndefined();
    expect(parsed.animation.climbAnimFactor).toBeUndefined();
    const settings = worldSettingsFromConstants(parsed);
    expect(settings.stepUpSpeedFactor).toBe(0.7);
    expect(settings.climbAnimFactor).toBe(1.0);
  });

  it('provided values flow through to the settings', () => {
    const settings = worldSettingsFromConstants(
      parseWorldConstants(withAnimation({ stepUpSpeedFactor: 1.2, climbAnimFactor: 2 })),
    );
    expect(settings.stepUpSpeedFactor).toBe(1.2);
    expect(settings.climbAnimFactor).toBe(2);
  });

  it.each([{ stepUpSpeedFactor: 0 }, { stepUpSpeedFactor: 3 }, { climbAnimFactor: 0.05 }, { climbAnimFactor: 4 }])(
    'rejects out-of-range %o',
    (extra) => {
      expect(() => parseWorldConstants(withAnimation(extra))).toThrow();
    },
  );
});

describe('ghostAvatar', () => {
  it('round-trips through parseWorldConstants and is optional', () => {
    const ghostAvatar = { model: '/models/characters/Ghost.glb' };
    expect(parseWorldConstants({ ...DEFAULT_WORLD_CONSTANTS, ghostAvatar }).ghostAvatar).toEqual(ghostAvatar);
    expect(parseWorldConstants(DEFAULT_WORLD_CONSTANTS).ghostAvatar).toBeUndefined();
    expect(() => parseWorldConstants({ ...DEFAULT_WORLD_CONSTANTS, ghostAvatar: { model: '' } })).toThrow();
  });
});
