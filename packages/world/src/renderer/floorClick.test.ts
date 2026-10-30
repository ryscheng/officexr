import { describe, expect, it } from 'vitest';
import { CAMERA_MODES } from './config.ts';
import { allowsFloorClick, isClick } from './floorClick.ts';

describe('allowsFloorClick', () => {
  it('is on only where the pointer is not locked', () => {
    expect(CAMERA_MODES.filter(allowsFloorClick)).toEqual(['fixed', 'top-down']);
  });
});

describe('isClick', () => {
  it('accepts a press that stayed within a few pixels', () => {
    expect(isClick({ x: 10, y: 10 }, { x: 13, y: 12 })).toBe(true);
  });

  it('rejects a drag', () => {
    expect(isClick({ x: 10, y: 10 }, { x: 30, y: 10 })).toBe(false);
  });
});
