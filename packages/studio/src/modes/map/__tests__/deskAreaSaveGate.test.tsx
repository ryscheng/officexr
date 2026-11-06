import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ObjectInstance } from '@officexr/sdk';
import {
  InMemoryMapStorage,
  emptyMapDocument,
  emptyRoomDocument,
  type WorldObjectKind,
} from '@officexr/world/scenes';
import { useMapDocument } from '../useMapDocument.ts';
import { createDeskAreaValidator, type DeskAreaLibrary } from '../deskAreaValidator.ts';

const kinds: Record<string, Partial<WorldObjectKind>> = {
  chair: { seat: { offset: { x: 0, y: 0.5, z: 0 }, yawDeg: 0 } },
};
const geometry = {
  worldAABBOfInstance: (i: { position: [number, number, number] }) => ({
    min: [i.position[0] - 0.5, 0, i.position[2] - 0.5],
    max: [i.position[0] + 0.5, 1, i.position[2] + 0.5],
  }),
} as unknown as Parameters<typeof createDeskAreaValidator>[0]['geometry'];
const chair = (id: string, x: number): ObjectInstance => ({
  id,
  sourceCommandId: id,
  kindId: 'chair',
  position: [x, 0, 1],
});
const library: DeskAreaLibrary = {
  rooms: new Map([['r', emptyRoomDocument('r', 'r')]]),
  layouts: new Map(),
  settledRooms: new Set(['r']),
  settledLayouts: new Set(),
};

afterEach(() => vi.useRealTimers());

describe('desk-area save gate wired to the real validator', () => {
  it('blocks saving a two-chair area and saves once the area is shrunk', async () => {
    vi.useFakeTimers();
    globalThis.localStorage?.clear();
    const seed = {
      ...emptyMapDocument('default'),
      rooms: [{ id: 'p1', roomName: 'r', position: [0, 0, 0] as [number, number, number], rotationY: 0 as const }],
    };
    const storage = new InMemoryMapStorage({ seed: [{ name: 'default', doc: seed }] });
    const save = vi.spyOn(storage, 'save');
    const validateDeskAreas = createDeskAreaValidator({
      catalogReady: true,
      roomService: { compileMap: () => ({ cubeSize: 0.5, instances: [chair('c1', 1), chair('c2', 3)] }) },
      catalog: { getKind: (id) => kinds[id] as WorldObjectKind | undefined },
      geometry,
      library,
    });
    const { result } = renderHook(() => useMapDocument({ storage, validateDeskAreas }));
    await act(() => vi.advanceTimersByTimeAsync(0));

    let id = '';
    act(() => {
      id = result.current.addDeskArea({ min: { x: 0, z: 0 }, max: { x: 4, z: 2 } });
    });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(result.current.deskAreaCheck).toMatchObject({ type: 'checked', violations: [{ areaId: id }] });
    expect(save).not.toHaveBeenCalled();

    act(() => result.current.setDeskAreaBounds(id, { min: { x: 0, z: 0 }, max: { x: 2, z: 2 } }));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(save).toHaveBeenCalledTimes(1);
  });
});
