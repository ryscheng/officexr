import type { WorldObjects } from '@officexr/sdk';
import { loadMap, modelUrl, type ApplicationApi, type MapLoaderDeps } from '@officexr/world/app';
import type { LayoutDocument, MapDocumentV2, RoomDocument } from '@officexr/world/scenes';
import { unionBounds, type Bounds } from './renderFraming.ts';
import type { RenderParams } from './renderParams.ts';

export type RenderStorages = MapLoaderDeps['storages'];

/** What the render page draws; `bounds` is what the camera frames. */
export type RenderContent = { bounds: Bounds; modelUrls: string[] } & (
  | {
      type: 'map';
      doc: MapDocumentV2;
      rooms: ReadonlyMap<string, RoomDocument>;
      layouts: ReadonlyMap<string, LayoutDocument>;
    }
  | { type: 'room'; worldObjects: WorldObjects; layoutName?: string }
  | { type: 'layout'; worldObjects: WorldObjects }
);

/** Names of the baked layouts whose GLBs the content draws. */
export function bakedLayoutNames(content: RenderContent): string[] {
  if (content.type === 'map') {
    const names = new Set<string>();
    for (const room of content.rooms.values()) {
      if (room.layoutName) {
        names.add(room.layoutName);
      }
    }
    return [...names];
  }
  return content.type === 'room' && content.layoutName ? [content.layoutName] : [];
}

function nothingToRender({ target, name }: RenderParams): Error {
  return new Error(`${target} "${name}" has nothing to render`);
}

export async function loadRenderContent(
  api: ApplicationApi,
  storages: RenderStorages,
  params: RenderParams,
): Promise<RenderContent> {
  const { target, name } = params;
  const boundsOf = (instances: WorldObjects['instances']) =>
    unionBounds(instances, (inst) => api.geometry.worldAABBOfInstance(inst));
  /** Catalog kinds only: primitives have no model to load. */
  const modelUrlsOf = (instances: WorldObjects['instances']) => [
    ...new Set(
      instances.flatMap((inst) => {
        const kind = api.catalog.getKind(inst.kindId);
        return kind ? [modelUrl(kind.gltfPath)] : [];
      }),
    ),
  ];

  if (target === 'map') {
    const map = await loadMap(
      { storages, catalog: api.catalog, roomService: api.rooms, geometry: api.geometry },
      name,
    );
    // loadMap's compile already holds every linked layout's instances, which bound the baked GLBs.
    const bounds = boundsOf(map.worldObjects.instances);
    if (!bounds) {
      throw nothingToRender(params);
    }
    // Only for RoomsLayer's editor-side AABBs; loadMap doesn't hand back the documents.
    const layouts = new Map<string, LayoutDocument>();
    await Promise.all(
      [...new Set(map.bakedLayouts.map((b) => b.layoutName))].map(async (layoutName) => {
        const layout = await storages.layouts.load(layoutName);
        if (layout) {
          layouts.set(layoutName, layout);
        }
      }),
    );
    // Layout instances aren't drawn as models (their GLB is), so preload only the rooms' own kinds.
    const roomObjects = api.rooms.compileMap(map.mapDoc, map.rooms);
    return {
      type: 'map',
      bounds,
      modelUrls: modelUrlsOf(roomObjects.instances),
      doc: map.mapDoc,
      rooms: map.rooms,
      layouts,
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
    return { type: 'layout', bounds, modelUrls: modelUrlsOf(worldObjects.instances), worldObjects };
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
    modelUrls: modelUrlsOf(worldObjects.instances),
    worldObjects,
    layoutName: room.layoutName,
  };
}
