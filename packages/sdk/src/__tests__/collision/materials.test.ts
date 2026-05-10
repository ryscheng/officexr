import { describe, it, expect } from 'vitest';
import {
  CHARACTER_BODY,
  CHARACTER_PROXIMITY_INNER,
  CHARACTER_PROXIMITY_OUTER,
  CUBE_WALKABLE,
  CUBE_WALL,
  DEFAULT_COLLISION_MATRIX,
  interactionFor,
  mergeMatrix,
  type CollisionMatrix,
} from '../../collision/materials.ts';

describe('DEFAULT_COLLISION_MATRIX', () => {
  it('character bodies collide with each other', () => {
    expect(
      interactionFor(DEFAULT_COLLISION_MATRIX, CHARACTER_BODY, CHARACTER_BODY),
    ).toBe('collide');
  });

  it('character bodies trigger both inner and outer proximity sensors', () => {
    expect(
      interactionFor(
        DEFAULT_COLLISION_MATRIX,
        CHARACTER_BODY,
        CHARACTER_PROXIMITY_INNER,
      ),
    ).toBe('trigger');
    expect(
      interactionFor(
        DEFAULT_COLLISION_MATRIX,
        CHARACTER_BODY,
        CHARACTER_PROXIMITY_OUTER,
      ),
    ).toBe('trigger');
  });

  it('lookup is symmetric (order of args does not matter)', () => {
    expect(
      interactionFor(
        DEFAULT_COLLISION_MATRIX,
        CHARACTER_PROXIMITY_INNER,
        CHARACTER_BODY,
      ),
    ).toBe('trigger');
  });

  it('character bodies collide with walls and ignore walkable cubes', () => {
    expect(
      interactionFor(DEFAULT_COLLISION_MATRIX, CHARACTER_BODY, CUBE_WALL),
    ).toBe('collide');
    expect(
      interactionFor(DEFAULT_COLLISION_MATRIX, CHARACTER_BODY, CUBE_WALKABLE),
    ).toBe('ignore');
  });

  it('proximity sensors do not interact with walls or each other', () => {
    expect(
      interactionFor(
        DEFAULT_COLLISION_MATRIX,
        CHARACTER_PROXIMITY_INNER,
        CHARACTER_PROXIMITY_INNER,
      ),
    ).toBe('ignore');
    expect(
      interactionFor(
        DEFAULT_COLLISION_MATRIX,
        CHARACTER_PROXIMITY_INNER,
        CHARACTER_PROXIMITY_OUTER,
      ),
    ).toBe('ignore');
    expect(
      interactionFor(
        DEFAULT_COLLISION_MATRIX,
        CHARACTER_PROXIMITY_INNER,
        CUBE_WALL,
      ),
    ).toBe('ignore');
    expect(
      interactionFor(
        DEFAULT_COLLISION_MATRIX,
        CHARACTER_PROXIMITY_OUTER,
        CUBE_WALL,
      ),
    ).toBe('ignore');
  });

  it('unknown materials default to ignore', () => {
    expect(
      interactionFor(DEFAULT_COLLISION_MATRIX, 'unknown.foo', CHARACTER_BODY),
    ).toBe('ignore');
  });
});

describe('mergeMatrix', () => {
  it('extends a base matrix with new materials', () => {
    const ext: CollisionMatrix = {
      'pickup.coin': { [CHARACTER_BODY]: 'trigger' },
      [CHARACTER_BODY]: { 'pickup.coin': 'trigger' },
    };
    const merged = mergeMatrix(DEFAULT_COLLISION_MATRIX, ext);
    expect(interactionFor(merged, 'pickup.coin', CHARACTER_BODY)).toBe(
      'trigger',
    );
    // base entries survive
    expect(interactionFor(merged, CHARACTER_BODY, CHARACTER_BODY)).toBe(
      'collide',
    );
  });

  it('extension overrides base values', () => {
    const ext: CollisionMatrix = {
      [CHARACTER_BODY]: { [CHARACTER_BODY]: 'ignore' },
    };
    const merged = mergeMatrix(DEFAULT_COLLISION_MATRIX, ext);
    expect(interactionFor(merged, CHARACTER_BODY, CHARACTER_BODY)).toBe(
      'ignore',
    );
  });
});
