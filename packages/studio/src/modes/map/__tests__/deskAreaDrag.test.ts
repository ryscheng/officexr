import { describe, expect, it } from 'vitest';
import { reduceDeskAreaDrag, type DeskAreaDrag } from '../deskAreaDrag.ts';

const idle: DeskAreaDrag = { type: 'idle' };

describe('reduceDeskAreaDrag', () => {
  it('commits the snapped rectangle on release', () => {
    let { drag } = reduceDeskAreaDrag(idle, { type: 'down', point: { x: 1.1, z: 1.1 } });
    ({ drag } = reduceDeskAreaDrag(drag, { type: 'move', point: { x: 3.1, z: 2.6 } }));
    expect(drag).toMatchObject({ type: 'dragging', draft: { min: { x: 1, z: 1 }, max: { x: 3, z: 2.5 } } });
    const result = reduceDeskAreaDrag(drag, { type: 'up', point: { x: 3.1, z: 2.6 } });
    expect(result.drag).toEqual(idle);
    expect(result.commit).toEqual({ min: { x: 1, z: 1 }, max: { x: 3, z: 2.5 } });
  });

  it('drops a zero-area drag', () => {
    const { drag } = reduceDeskAreaDrag(idle, { type: 'down', point: { x: 1, z: 1 } });
    expect(reduceDeskAreaDrag(drag, { type: 'up', point: { x: 1.1, z: 1.1 } }).commit).toBeNull();
  });

  it('ignores moves and releases when no drag is in progress, and a press that misses the floor', () => {
    expect(reduceDeskAreaDrag(idle, { type: 'move', point: { x: 1, z: 1 } })).toEqual({ drag: idle, commit: null });
    expect(reduceDeskAreaDrag(idle, { type: 'up', point: { x: 1, z: 1 } })).toEqual({ drag: idle, commit: null });
    expect(reduceDeskAreaDrag(idle, { type: 'down', point: null })).toEqual({ drag: idle, commit: null });
  });
});
