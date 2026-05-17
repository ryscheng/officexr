/**
 * Default `RoomService` implementation. Wraps the existing pure
 * `compileScene` / `compileMap` functions, providing the kind-stride
 * lookup from the injected geometry service so callers don't have to
 * re-derive it themselves.
 */

import { compileScene as compileSceneRaw } from '../scenes/compile.ts';
import { compileMap as compileMapRaw } from '../scenes/compile-map.ts';
import type { RoomDocument } from '../scenes/commands.ts';
import type { MapDocumentV1 } from '../scenes/map-document.ts';
import type { WorldObjects } from '@officexr/sdk';
import type { InstanceGeometryService, RoomService } from './types.ts';

export function createRoomService(deps: {
  geometry: InstanceGeometryService;
}): RoomService {
  const { geometry } = deps;
  const stride = (id: string): [number, number, number] => {
    const [x, y, z] = geometry.tileStep(id);
    return [x, y, z];
  };

  return {
    compileScene(doc: RoomDocument): WorldObjects {
      return compileSceneRaw(doc, geometry.voxelSize, stride);
    },
    compileMap(
      map: MapDocumentV1,
      rooms: ReadonlyMap<string, RoomDocument>,
    ): WorldObjects {
      return compileMapRaw(map, rooms, geometry.voxelSize, stride);
    },
  };
}
