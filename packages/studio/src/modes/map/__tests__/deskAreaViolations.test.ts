import { describe, expect, it } from 'vitest';
import type { ObjectInstance } from '@officexr/sdk';
import { emptyMapDocument, type WorldObjectKind } from '@officexr/world/scenes';
import { findDeskAreaViolations } from '../deskAreaViolations.ts';

const kinds: Record<string, Partial<WorldObjectKind>> = {
  chair: { seat: { offset: { x: 0, y: 0.5, z: 0 }, yawDeg: 0 } },
  desk: { isDesk: true },
};
const catalog = { getKind: (id: string) => kinds[id] as WorldObjectKind | undefined };
const geometry = {
  worldAABBOfInstance: (i: { position: [number, number, number] }) => ({
    min: [i.position[0] - 0.5, 0, i.position[2] - 0.5],
    max: [i.position[0] + 0.5, 1, i.position[2] + 0.5],
  }),
};
const inst = (id: string, kindId: string, x: number): ObjectInstance => ({
  id,
  sourceCommandId: id,
  kindId,
  position: [x, 0, 1],
});
const doc = {
  ...emptyMapDocument('m'),
  deskAreas: [{ id: 'a', label: 'Pod', min: { x: 0, z: 0 }, max: { x: 4, z: 2 } }],
};

function violations(instances: ObjectInstance[]) {
  return findDeskAreaViolations(
    doc,
    instances,
    catalog,
    geometry as unknown as Parameters<typeof findDeskAreaViolations>[3],
  );
}

describe('findDeskAreaViolations', () => {
  it('accepts one chair and one desk', () => {
    expect(violations([inst('c1', 'chair', 1), inst('d1', 'desk', 2)])).toEqual([]);
  });

  it('names the cause for extra chairs and desks, ignoring furniture outside', () => {
    expect(
      violations([
        inst('c1', 'chair', 1),
        inst('c2', 'chair', 2),
        inst('d1', 'desk', 1),
        inst('d2', 'desk', 2),
        inst('far', 'chair', 20),
      ]),
    ).toEqual([{ areaId: 'a', label: 'Pod', reason: '2 chairs, 2 desks' }]);
  });
});
