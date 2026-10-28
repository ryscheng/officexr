import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BakeStatusType } from '@officexr/world/bake-source';
import { groupPlacementsByLayout, mapLayoutPlacements, type WorldObjectKindCatalogV1 } from '@officexr/world/scenes';
import { z } from 'zod';
import type { StudioDocuments } from '../studio-documents.ts';
import { checkedName, nameSchema } from './documents.ts';
import { errorResult, guard, jsonResult } from './shared.ts';

export type LayoutBakeCheck =
  | { layoutName: string; status: BakeStatusType; roomInstanceIds: string[] }
  | { layoutName: string; error: string; roomInstanceIds: string[] };

export type MapBakeCheck =
  | { map: string; layouts: LayoutBakeCheck[]; missingRooms: string[] }
  | { map: string; error: string };

/** Reports every baked layout a map's rooms use as missing, unknown, stale or fresh. */
export async function checkMapBakes(
  { maps, rooms, layouts, bakedLayouts }: StudioDocuments,
  catalog: WorldObjectKindCatalogV1,
  mapName: string,
): Promise<MapBakeCheck> {
  const map = await maps.load(mapName);
  if (!map) {
    return { map: mapName, error: `map "${mapName}" not found` };
  }
  // Lazy: the subpath pulls in gltf-transform, which vite.config.ts shouldn't load at startup.
  const { evaluateBake } = await import('@officexr/world/bake-source');
  const { placements, missingRooms } = await mapLayoutPlacements(map, (name) => rooms.load(name));
  const kindLookup = (id: string) => catalog.kinds.find((k) => k.id === id);
  const checks = await Promise.all(
    [...groupPlacementsByLayout(placements)].map(async ([layoutName, roomInstanceIds]): Promise<LayoutBakeCheck> => {
      try {
        const layout = await layouts.load(layoutName);
        if (!layout) {
          return { layoutName, error: `layout "${layoutName}" not found`, roomInstanceIds };
        }
        const status = await evaluateBake(layout, await bakedLayouts.load(layoutName), kindLookup);
        return { layoutName, status: status.type, roomInstanceIds };
      } catch (err) {
        return { layoutName, error: err instanceof Error ? err.message : String(err), roomInstanceIds };
      }
    }),
  );
  return { map: mapName, layouts: checks, missingRooms };
}

export function registerMapBakeTools(server: McpServer, docs: StudioDocuments): void {
  server.registerTool(
    'check_map_bakes',
    {
      description:
        'Check which baked layouts a map needs are fresh, stale, missing or of unknown provenance. Pass `map` for one ' +
        'map or `all: true` for every stored map. For each layout the map\'s rooms link, returns layoutName, status and ' +
        'the roomInstanceIds that use it. "fresh": the baked GLB matches the layout, optimizer and kinds as stored ' +
        'now. "stale": any of them changed since the bake, or the bake predates the current bake algorithm. ' +
        '"missing": no baked GLB. "unknown": the GLB carries no fingerprint (an older bake, or baked in a browser ' +
        'without crypto.subtle), or none can be computed now. Also returns missingRooms (rooms the map references ' +
        'that do not load), per-layout or per-map error entries for missing documents, and status totals. ' +
        'Read-only; re-run bake_layout on non-fresh layouts.',
      inputSchema: { map: nameSchema.optional(), all: z.literal(true).optional() },
    },
    ({ map, all }) =>
      guard(async () => {
        if ((map === undefined) === (all === undefined)) {
          return errorResult('pass exactly one of `map` or `all: true`');
        }
        const catalog = await docs.catalog.load();
        if (!catalog) {
          return errorResult('no catalog saved');
        }
        const names = map === undefined ? (await docs.maps.list()).map((m) => m.name) : [checkedName(map)];
        const results = await Promise.all(names.map((name) => checkMapBakes(docs, catalog, name)));
        const totals = { fresh: 0, stale: 0, missing: 0, unknown: 0, errors: 0 };
        for (const result of results) {
          if ('error' in result) {
            totals.errors += 1;
            continue;
          }
          for (const check of result.layouts) {
            totals['error' in check ? 'errors' : check.status] += 1;
          }
        }
        return jsonResult({ maps: results, totals });
      }),
  );
}
