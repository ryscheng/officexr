import { describe, expect, it } from 'vitest';
import {
  CUTAWAY_RADIUS,
  isAboveCutPlane,
  isOverheadCover,
  isRoofName,
  withinCutawayRadius,
} from './cutawayMath.ts';

describe('cutaway selection math', () => {
  it('treats only objects well above the head as cover', () => {
    expect(isOverheadCover(3, 0, false)).toBe(true);
    expect(isOverheadCover(1.5, 0, false)).toBe(false);
    expect(isOverheadCover(2.5, 1, false)).toBe(false);
  });

  it('lets a roof or ceiling name lower the clearance', () => {
    expect(isOverheadCover(2.0, 0, false)).toBe(false);
    expect(isOverheadCover(2.0, 0, true)).toBe(true);
    expect(isRoofName('Roof_Tile_A')).toBe(true);
    expect(isRoofName('wall_01')).toBe(false);
    expect(isRoofName(undefined)).toBe(false);
  });

  it('hides everything at or above the lowest cover bottom', () => {
    expect(isAboveCutPlane(3, 3)).toBe(true);
    expect(isAboveCutPlane(6, 3)).toBe(true);
    expect(isAboveCutPlane(2.5, 3)).toBe(false);
  });

  it('bounds the cutaway to the area around the player', () => {
    expect(withinCutawayRadius(CUTAWAY_RADIUS - 1, 0, 0)).toBe(true);
    expect(withinCutawayRadius(CUTAWAY_RADIUS + 1, 0, 0)).toBe(false);
    expect(withinCutawayRadius(CUTAWAY_RADIUS + 1, 0, 2)).toBe(true);
  });
});
