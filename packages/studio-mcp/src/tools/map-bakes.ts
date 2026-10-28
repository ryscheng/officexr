import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BakeStatusType } from '@officexr/world/bake-source';
import { catalogKindLookup, groupPlacementsByLayout, mapLayoutPlacements } from '@officexr/world/scenes';
import { z } from 'zod';
import type { StudioDocuments } from '../studio-documents.ts';
import { checkedName, nameSchema } from './documents.ts';
import { errorResult, guard, jsonResult } from './shared.ts';

export type LayoutBakeCheck =
  | { type: 'ok'; layoutName: string; status: BakeStatusType; roomInstanceIds: string[] }
  | { type: 'error'; layoutName: string; error: string; roomInstanceIds: string[] };

export type MapBakeCheck =
  | { type: 'ok'; map: string; layouts: LayoutBakeCheck[]; missingRooms: string[] }
  | { type: 'error'; map: string; error: string };

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Reports every baked layout a map's rooms use as missing, unknown, stale or fresh; a failure is returned, not thrown. */
export async function checkMapBakes(
  docs: StudioDocuments,
  kindLookup: ReturnType<typeof catalogKindLookup>,
  mapName: string,
): Promise<MapBakeCheck> {
  try {
    const map = await docs.maps.load(mapName);
    if (!map) {
      return { type: 'error', map: mapName, error: `map "${mapName}" not found` };
    }
    // Lazy: the subpath pulls in gltf-transform, which vite.config.ts shouldn't load at startup.
    const { evaluateBake } = await import('@officexr/world/bake-source');
    const { placements, missingRooms } = await mapLayoutPlacements(map, (name) => docs.rooms.load(name));
    const layouts = await Promise.all(
      [...groupPlacementsByLayout(placements)].map(async ([layoutName, roomInstanceIds]): Promise<LayoutBakeCheck> => {
        try {
          const layout = await docs.layouts.load(layoutName);
          if (!layout) {
            return { type: 'error', layoutName, error: `layout "${layoutName}" not found`, roomInstanceIds };
          }
          const status = await evaluateBake(layout, await docs.bakedLayouts.load(layoutName), kindLookup);
          return { type: 'ok', layoutName, status: status.type, roomInstanceIds };
        } catch (err) {
          return { type: 'error', layoutName, error: messageOf(err), roomInstanceIds };
        }
      }),
    );
    return { type: 'ok', map: mapName, layouts, missingRooms };
  } catch (err) {
    return { type: 'error', map: mapName, error: messageOf(err) };
  }
}

interface BakeTotals {
  fresh: number;
  stale: number;
  missing: number;
  unknown: number;
  errors: number;
}

function tallyBakes(results: readonly MapBakeCheck[]): BakeTotals {
  const totals: BakeTotals = { fresh: 0, stale: 0, missing: 0, unknown: 0, errors: 0 };
  for (const result of results) {
    if (result.type === 'error') {
      totals.errors += 1;
      continue;
    }
    for (const check of result.layouts) {
      if (check.type === 'error') {
        totals.errors += 1;
        continue;
      }
      const status = check.status;
      switch (status) {
        case 'fresh':
        case 'stale':
        case 'missing':
        case 'unknown':
          totals[status] += 1;
          break;
        default: {
          const unhandled: never = status;
          throw new Error(`unhandled bake status ${String(unhandled)}`);
        }
      }
    }
  }
  return totals;
}

export function registerMapBakeTools(server: McpServer, docs: StudioDocuments): void {
  server.registerTool(
    'check_map_bakes',
    {
      description:
        'Check whether the baked layouts a map needs are fresh, stale, missing or of unknown provenance; pass `map` ' +
        'for one map or `all: true` for every map. Returns each layout\'s status and the roomInstanceIds using it, ' +
        'rooms that fail to load, per-map and per-layout errors, and totals. Read-only; errors when no catalog is saved.',
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
        const kindLookup = catalogKindLookup(catalog);
        const names = map === undefined ? (await docs.maps.list()).map((m) => m.name) : [checkedName(map)];
        const results = await Promise.all(names.map((name) => checkMapBakes(docs, kindLookup, name)));
        return jsonResult({ maps: results, totals: tallyBakes(results) });
      }),
  );
}
