import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BakeStatusType } from '@officexr/world/bake-source';
import { catalogKindLookup, groupPlacementsByLayout, mapLayoutPlacements } from '@officexr/world/scenes';
import { z } from 'zod';
import type { HeavyWorkLock } from '../heavy-work-lock.ts';
import type { StudioDocuments } from '../studio-documents.ts';
import { type BakeDeps, bakeOne } from './baked-layouts.ts';
import type { BakeJob, BakeJobResult, BakeJobs } from './bake-jobs.ts';
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

type MapSelection = { map?: string; all?: true };

/** Checks the requested map, or every map; throws on bad input or when no catalog is saved. */
async function checkRequestedMaps(docs: StudioDocuments, { map, all }: MapSelection): Promise<MapBakeCheck[]> {
  if ((map === undefined) === (all === undefined)) {
    throw new Error('pass exactly one of `map` or `all: true`');
  }
  const catalog = await docs.catalog.load();
  if (!catalog) {
    throw new Error('no catalog saved');
  }
  const kindLookup = catalogKindLookup(catalog);
  const names = map === undefined ? (await docs.maps.list()).map((m) => m.name) : [checkedName(map)];
  return Promise.all(names.map((name) => checkMapBakes(docs, kindLookup, name)));
}

/** One entry per distinct layout (the first mention wins); a map or layout that cannot be checked is `failed`. */
function planBakeJob(checks: readonly MapBakeCheck[], force: boolean): BakeJobResult[] {
  const plan = new Map<string, BakeJobResult>();
  const add = (result: BakeJobResult) => {
    if (!plan.has(result.layoutName)) {
      plan.set(result.layoutName, result);
    }
  };
  for (const check of checks) {
    if (check.type === 'error') {
      add({ layoutName: `map "${check.map}"`, action: 'failed', error: check.error });
      continue;
    }
    for (const layout of check.layouts) {
      const { layoutName } = layout;
      add(
        layout.type === 'error'
          ? { layoutName, action: 'failed', error: layout.error }
          : { layoutName, action: force || layout.status !== 'fresh' ? 'pending' : 'skipped' },
      );
    }
  }
  return [...plan.values()];
}

async function runBakeJob(jobs: BakeJobs, job: BakeJob, deps: BakeDeps): Promise<void> {
  for (const result of job.results) {
    if (result.action !== 'pending') {
      continue;
    }
    try {
      result.bytes = (await bakeOne(result.layoutName, deps)).bytes;
      result.action = 'baked';
    } catch (err) {
      result.action = 'failed';
      result.error = messageOf(err);
    }
  }
  jobs.finish(job);
}

export function registerMapBakeTools(
  server: McpServer,
  lock: HeavyWorkLock,
  jobs: BakeJobs,
  deps: BakeDeps,
): void {
  const { docs } = deps;
  server.registerTool(
    'check_map_bakes',
    {
      description:
        'Check whether the baked layouts a map needs are fresh, stale, missing or of unknown provenance; pass `map` ' +
        'for one map or `all: true` for every map. Returns each layout\'s status and the roomInstanceIds using it, ' +
        'rooms that fail to load, per-map and per-layout errors, and totals. Read-only; errors when no catalog is saved.',
      inputSchema: { map: nameSchema.optional(), all: z.literal(true).optional() },
    },
    (selection) =>
      guard(async () => {
        const results = await checkRequestedMaps(docs, selection);
        return jsonResult({ maps: results, totals: tallyBakes(results) });
      }),
  );
  server.registerTool(
    'bake_map',
    {
      description:
        'Start a background job that re-bakes the layouts a map uses (`map`) or every map uses (`all: true`) against ' +
        'the live catalog, one at a time. Only layouts that are not fresh are baked unless `force` is true. Returns ' +
        '{jobId, layouts} at once; poll get_bake_job. Errors when a bake or render is in progress or no catalog is saved.',
      inputSchema: { map: nameSchema.optional(), all: z.literal(true).optional(), force: z.boolean().optional() },
    },
    ({ force, ...selection }) =>
      guard(async () => {
        const release = lock.acquire();
        let job: BakeJob;
        try {
          job = jobs.create(planBakeJob(await checkRequestedMaps(docs, selection), force === true));
        } catch (err) {
          release();
          throw err;
        }
        // Detached: the lock stays held until the whole job is done, and the loop never rejects.
        void runBakeJob(jobs, job, deps).finally(release);
        return jsonResult({ jobId: job.id, layouts: job.results.map((r) => ({ ...r })) });
      }),
  );
  server.registerTool(
    'get_bake_job',
    {
      description:
        'Report a bake_map job: state (running or done), each layout\'s result (baked, skipped, failed or pending, ' +
        'with error or bytes) and totals per action. Errors for an unknown jobId; finished jobs are kept for an hour.',
      inputSchema: { jobId: z.string() },
    },
    ({ jobId }) =>
      guard(async () => {
        const job = jobs.get(jobId);
        if (!job) {
          return errorResult(`bake job "${jobId}" not found`);
        }
        const totals = { baked: 0, skipped: 0, failed: 0, pending: 0 };
        for (const { action } of job.results) {
          totals[action] += 1;
        }
        return jsonResult({ state: job.finishedAt === undefined ? 'running' : 'done', results: job.results, totals });
      }),
  );
}
