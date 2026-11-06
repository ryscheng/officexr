import { describe, expect, it } from 'vitest';
import type { ObjectInstance } from '@officexr/sdk';
import { resolveDeskAreas } from '../desk-areas.ts';
import { emptyMapDocument, type DeskArea, type WorldObjectKind } from '../../scenes/index.ts';

const kinds: Record<string, Partial<WorldObjectKind>> = {
  chair: { seat: { offset: { x: 0, y: 0.5, z: 0 }, yawDeg: 0 } },
  desk: { isDesk: true },
  plant: {},
};
const catalog = { getKind: (id: string) => kinds[id] as WorldObjectKind | undefined };
// One-metre boxes centred on the instance position (x, z in metres).
const geometry = {
  worldAABBOfInstance: (i: { position: [number, number, number] }) => ({
    min: [i.position[0] - 0.5, 0, i.position[2] - 0.5] as [number, number, number],
    max: [i.position[0] + 0.5, 1, i.position[2] + 0.5] as [number, number, number],
  }),
} as Parameters<typeof resolveDeskAreas>[3];

const area: DeskArea = { id: 'd1', min: { x: 0, z: 0 }, max: { x: 4, z: 4 } };
const inst = (id: string, kindId: string, x: number, z: number): ObjectInstance => ({
  id,
  sourceCommandId: id,
  kindId,
  position: [x, 0, z],
});

function resolve(instances: ObjectInstance[]) {
  return resolveDeskAreas({ ...emptyMapDocument('m'), deskAreas: [area] }, instances, catalog, geometry)[0];
}

describe('resolveDeskAreas', () => {
  it('has no seat without a chair', () => {
    expect(resolve([inst('t', 'desk', 2, 2), inst('p', 'plant', 1, 1)])).toMatchObject({ seatInstanceId: null, violation: null });
  });

  it('seats the single chair next to the single desk', () => {
    expect(resolve([inst('t', 'desk', 2, 2), inst('c', 'chair', 1, 1)])).toMatchObject({
      seatInstanceId: 'c',
      violation: null,
      label: 'Desk',
    });
  });

  it('removes the seat when two chairs share an area', () => {
    expect(resolve([inst('a', 'chair', 1, 1), inst('b', 'chair', 3, 3)])).toMatchObject({
      seatInstanceId: null,
      violation: 'multiple-seats',
    });
  });

  it('removes the seat when two desks share an area', () => {
    expect(resolve([inst('c', 'chair', 1, 1), inst('a', 'desk', 1, 3), inst('b', 'desk', 3, 3)])).toMatchObject({
      seatInstanceId: null,
      violation: 'multiple-desks',
    });
  });

  it('reports multiple seats when an area has both extra chairs and extra desks', () => {
    const r = resolve([inst('a', 'chair', 1, 1), inst('b', 'chair', 2, 1), inst('c', 'desk', 1, 3), inst('d', 'desk', 3, 3)]);
    expect(r.violation).toBe('multiple-seats');
  });

  it('judges an instance straddling the edge by its centre', () => {
    expect(resolve([inst('in', 'chair', 4, 2)]).seatInstanceId).toBe('in');
    expect(resolve([inst('out', 'chair', 4.2, 2)]).seatInstanceId).toBeNull();
  });
});
