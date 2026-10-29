import { describe, expect, it } from 'vitest';
import { DEFAULT_WORLD_CONSTANTS, worldSettingsFromConstants } from '@officexr/sdk';
import catalogJson from '../../world-object-kinds.json' with { type: 'json' };
import doorwayLayout from '../../layouts/scenario-doorway.json' with { type: 'json' };
import slopeLayout from '../../layouts/scenario-slope.json' with { type: 'json' };
import stairsLayout from '../../layouts/scenario-stairs.json' with { type: 'json' };
import { createInstanceGeometry } from '../app/geometry-service.ts';
import { createRoomService } from '../app/room-service.ts';
import { worldObjectsToColliders } from '../physics/rules.ts';
import { STEP_UP_MAX_HEIGHT } from '../physics/step-up.ts';
import { CHAR_HEIGHT_M, VOXEL_SIZE } from '../renderer/config.ts';
import { deserializeLayout } from '../scenes/layout-document.ts';
import { validateWorldObjectKindCatalog } from '../scenes/world-object-kinds-schema.ts';
import { buildNavGrid } from './grid.ts';
import { findPath } from './path.ts';

const kinds = new Map(validateWorldObjectKindCatalog(catalogJson).kinds.map((k) => [k.id, k]));
const geometry = createInstanceGeometry({ catalog: { getKind: (id) => kinds.get(id) }, voxelSize: VOXEL_SIZE });

/** Builds the grid from a layout's colliders the way the bake derives them. */
function layoutGrid(layout: unknown) {
  const compiled = createRoomService({ geometry }).compileScene(deserializeLayout(layout));
  const colliders = worldObjectsToColliders(compiled, geometry.worldAABB, (id) => kinds.get(id)?.colliderShape);
  return buildNavGrid(colliders, {
    charRadius: worldSettingsFromConstants(DEFAULT_WORLD_CONSTANTS).charRadius,
    charHeight: CHAR_HEIGHT_M,
    maxStep: STEP_UP_MAX_HEIGHT,
  })!;
}

describe('nav grid over checked-in layouts', () => {
  it('climbs scenario-stairs from the floor to the top platform', () => {
    // Floor blocks top out at y=2 over x 4..8; the platform tops out at y=6 over x -4..0.
    const path = findPath(layoutGrid(stairsLayout), { x: 6, y: 2, z: 2 }, { x: -2, y: 6, z: 2 });
    expect(path).not.toBeNull();
    expect(path!.at(-1)!.x).toBeLessThan(0);
  });

  it('climbs scenario-slope from the floor to the top platform', () => {
    // Same footprint as scenario-stairs, with a slope trimesh in place of the steps.
    const path = findPath(layoutGrid(slopeLayout), { x: 6, y: 2, z: 2 }, { x: -2, y: 6, z: 2 });
    expect(path).not.toBeNull();
    expect(path!.at(-1)!.x).toBeLessThan(0);
  });

  it('walks up an outer-corner slope piece standing on a floor', () => {
    const commands = [];
    for (let x = -8; x <= 12; x += 4) {
      for (let z = -8; z <= 12; z += 4) {
        commands.push({ id: `floor@${x},${z}`, op: 'placeObject', kindId: 'colored_block_blue', position: [x, 0, z] });
      }
    }
    // A 4×4 m piece over x, z 0..4, rising from the floor top (y=2) to y=6 along its ridge.
    commands.push({ id: 'corner', op: 'placeObject', kindId: 'prototype_primitive_slope_outercorner', position: [0, 4, 0] });
    const g = layoutGrid({ schemaVersion: 1, name: 'corner', title: 'corner', updatedAt: 0, commands });
    let onPiece = 0;
    for (let c = 0; c < g.walkable.length; c++) {
      onPiece += g.walkable[c] === 1 && g.surface[c] > 2.01 ? 1 : 0;
    }
    expect(onPiece).toBeGreaterThan(150);
    expect(findPath(g, { x: -3, y: 2, z: -3 }, { x: 0.75, y: 5.3, z: 0.75 })).not.toBeNull();
  });

  it('walks through the scanned doorway of scenario-doorway', () => {
    // The wall runs along z 6..6.53 with its opening, under a lintel, at x 5.2..6.8.
    const path = findPath(layoutGrid(doorwayLayout), { x: 6, y: 0.5, z: 2 }, { x: 6, y: 0.5, z: 10 });
    expect(path).not.toBeNull();
    expect(path!.at(-1)!.z).toBeGreaterThan(9);
  });
});
