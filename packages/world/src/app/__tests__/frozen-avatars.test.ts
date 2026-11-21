import { describe, expect, it } from 'vitest';
import { createInitialOfficeState, type DeskAreaState, type OfficeState } from '@officexr/sdk';
import type { WorldObjectKind } from '../../scenes/index.ts';
import { createInstanceGeometry } from '../geometry-service.ts';
import { frozenAvatars } from '../frozen-avatars.ts';
import { seatedPlayerPose, seatOf } from '../seating.ts';

const kinds: Record<string, Partial<WorldObjectKind>> = {
  chair: { id: 'chair', dimensions: { width: 1, height: 1, depth: 1 }, seats: [{ offset: { x: 0.5, y: 0.5, z: 0.5 }, yawDeg: 0 }] },
};
const catalog = { getKind: (id: string) => kinds[id] as WorldObjectKind | undefined };
const geometry = createInstanceGeometry({ catalog, voxelSize: 1 });
const noCharacters = new Map();
const area = (id: string, seatInstanceId: string | null): DeskAreaState => ({
  id,
  label: id,
  min: { x: 0, z: 0 },
  max: { x: 4, z: 4 },
  seatInstanceId,
});

function state(patch: Partial<OfficeState>): OfficeState {
  const base = createInitialOfficeState({ selfId: 'me@x.io#1', officeId: 'o' });
  return {
    ...base,
    worldObjects: {
      ...base.worldObjects,
      instances: [{ id: 'c1', sourceCommandId: 'c1', kindId: 'chair', position: [1, 0, 1] }],
    },
    ...patch,
  };
}

describe('frozenAvatars', () => {
  it('seats an absent claimant at the desk chair with their stored character', () => {
    const s = state({
      deskAreas: [area('d1', 'c1')],
      deskClaims: { d1: 'bob@x.io' },
      deskClaimants: { 'bob@x.io': { characterId: 'Mage' } },
    });
    const [frozen] = frozenAvatars(s, catalog, geometry, noCharacters);
    const seat = seatOf(s, catalog, geometry, 'c1')!;
    const expected = seatedPlayerPose(seat.pose, s.worldSettings.charRadius);
    expect(frozen.login).toBe('bob@x.io');
    expect(frozen.name).toBe('bob');
    expect(frozen.pos).toEqual(expected.pos);
    expect(frozen.yaw).toBe(expected.yaw);
    expect(frozen.model.url).toContain('Mage');
  });

  it('falls back to a built-in character from claims alone', () => {
    const s = state({ deskAreas: [area('d1', 'c1')], deskClaims: { d1: 'bob@x.io' } });
    const [frozen] = frozenAvatars(s, catalog, geometry, noCharacters);
    expect(frozen.model.ghost).toBe(false);
    expect(frozen.model.url).toMatch(/\.glb$/);
  });

  it('skips present players, self, and desks without a seat', () => {
    const s = state({
      deskAreas: [area('d1', 'c1'), area('d2', null), area('d3', 'missing')],
      deskClaims: { d1: 'me@x.io', d2: 'ann@x.io', d3: 'cy@x.io' },
    });
    expect(frozenAvatars(s, catalog, geometry, noCharacters)).toEqual([]);
    const live = state({
      deskAreas: [area('d1', 'c1')],
      deskClaims: { d1: 'bob@x.io' },
      players: { 'bob@x.io#7': {} as never },
    });
    expect(frozenAvatars(live, catalog, geometry, noCharacters)).toEqual([]);
  });
});
