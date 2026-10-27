import type { WorldObjects } from '@officexr/sdk';
import { loadMap, type ApplicationApi } from '@officexr/world/app';
import type {
  LayoutStorage,
  MapStorage,
  RoomDocument,
  RoomInstance,
  RoomStorage,
} from '@officexr/world/scenes';
import { unionBounds, type Bounds } from './renderFraming.ts';
import type { RenderParams } from './renderParams.ts';

export interface RenderStorages {
  maps: MapStorage;
  rooms: RoomStorage;
  layouts: LayoutStorage;
}

/** What the render page draws, plus the bounds the camera frames. */
export type RenderContent = { bounds: Bounds; bakedLayoutNames: string[] } & (
  | { type: 'map'; placements: readonly RoomInstance[]; rooms: ReadonlyMap<string, RoomDocument> }
  | { type: 'room'; worldObjects: WorldObjects; layoutName?: string }
  | { type: 'layout'; worldObjects: WorldObjects }
);

function nothingToRender({ target, name }: RenderParams): Error {
  return new Error(`${target} "${name}" has nothing to render`);
}

/** Loads the requested document (and what it references) from `storages`. */
export async function loadRenderContent(
  api: ApplicationApi,
  storages: RenderStorages,
  params: RenderParams,
): Promise<RenderContent> {
  const { target, name } = params;
  const boundsOf = (instances: WorldObjects['instances']) =>
    unionBounds(instances, (inst) => api.geometry.worldAABBOfInstance(inst));

  if (target === 'map') {
    const map = await loadMap(
      { storages, catalog: api.catalog, roomService: api.rooms, geometry: api.geometry },
      name,
    );
    const bounds = boundsOf(map.worldObjects.instances);
    if (!bounds) {
      throw nothingToRender(params);
    }
    const bakedLayoutNames = new Set<string>();
    for (const placement of map.mapDoc.rooms) {
      const layoutName = map.rooms.get(placement.roomName)?.layoutName;
      if (layoutName) {
        bakedLayoutNames.add(layoutName);
      }
    }
    return {
      type: 'map',
      bounds,
      bakedLayoutNames: [...bakedLayoutNames],
      placements: map.mapDoc.rooms,
      rooms: map.rooms,
    };
  }

  // Kind strides are only correct once the catalog has landed.
  await api.catalog.ready();
  if (target === 'layout') {
    const layout = await storages.layouts.load(name);
    if (!layout) {
      throw new Error(`layout "${name}" not found`);
    }
    const worldObjects = api.rooms.compileScene(layout);
    const bounds = boundsOf(worldObjects.instances);
    if (!bounds) {
      throw nothingToRender(params);
    }
    return { type: 'layout', bounds, bakedLayoutNames: [], worldObjects };
  }

  const room = await storages.rooms.load(name);
  if (!room) {
    throw new Error(`room "${name}" not found`);
  }
  const worldObjects = api.rooms.compileScene(room);
  // The baked GLB has no bounds of its own; its source layout's commands stand in for them.
  const layout = room.layoutName ? await storages.layouts.load(room.layoutName) : null;
  const layoutInstances = layout ? api.rooms.compileScene(layout).instances : [];
  const bounds = boundsOf([...worldObjects.instances, ...layoutInstances]);
  if (!bounds) {
    throw nothingToRender(params);
  }
  return {
    type: 'room',
    bounds,
    bakedLayoutNames: room.layoutName ? [room.layoutName] : [],
    worldObjects,
    layoutName: room.layoutName,
  };
}
