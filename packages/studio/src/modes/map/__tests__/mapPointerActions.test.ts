import { describe, expect, it } from 'vitest';
import { resolveRoomPointerAction } from '../mapPointerActions.ts';

/**
 * Regression guard for taxonomy F (the c606f10 bug). The decision must
 * be a pure function of the tool — no mesh-type gating — so a click on a
 * baked-layout mesh routes the same as a click on a raw cube.
 */
describe('resolveRoomPointerAction', () => {
  it('spawn tool always places a spawn', () => {
    expect(resolveRoomPointerAction('spawn')).toBe('place-spawn');
  });

  it('select tool selects without dragging', () => {
    expect(resolveRoomPointerAction('select')).toBe('select');
  });

  it('move tool selects and starts a drag in one gesture', () => {
    expect(resolveRoomPointerAction('move')).toBe('select-drag');
  });

  it('is total over MapTool (every tool resolves to an action)', () => {
    const tools = ['select', 'move', 'spawn'] as const;
    for (const t of tools) {
      expect(resolveRoomPointerAction(t)).toBeTruthy();
    }
  });
});
