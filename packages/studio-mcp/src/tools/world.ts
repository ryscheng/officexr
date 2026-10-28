import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DEFAULT_WORLD_CONSTANTS, type WorldConstants } from '@officexr/sdk';
import {
  validateWorldObjectKindCatalog,
  WorldConstantsPushError,
  type WorldObjectKindCatalogV1,
} from '@officexr/world/scenes';
import { z } from 'zod';
import type { StudioDocuments } from '../studio-documents.ts';
import { documentSchema, errorResult, guard, jsonResult } from './shared.ts';
import { YAW_CONTRACT } from './yaw.ts';

type KindPatch = { id: string } & Record<string, unknown>;

/** Merges each patch's top-level fields into the kind with its id; throws on an unknown or repeated id. */
export function patchKinds(catalog: WorldObjectKindCatalogV1, patches: KindPatch[]): unknown {
  const byId = new Map(patches.map((p) => [p.id, p]));
  if (byId.size !== patches.length) {
    throw new Error('each kind id may appear only once');
  }
  const missing = [...byId.keys()].filter((id) => !catalog.kinds.some((k) => k.id === id));
  if (missing.length > 0) {
    throw new Error(`no such kind: ${missing.join(', ')}`);
  }
  return { ...catalog, kinds: catalog.kinds.map((k) => ({ ...k, ...byId.get(k.id) })) };
}

export function registerWorldTools(
  server: McpServer,
  { catalog, worldSettings }: StudioDocuments,
): void {
  server.registerTool(
    'get_world_object_kinds',
    {
      description:
        'Read the catalog of world-object kinds (id, label, model path, swatch, walkable, scale, material ' +
        'overrides, rotationStepDeg). Rooms and layouts reference kinds by id. `scale` is a unitless uniform multiplier (1 = model ' +
        'size unchanged); dimensions are in metres. ' +
        YAW_CONTRACT,
    },
    () =>
      guard(async () => {
        const doc = await catalog.load();
        return doc ? jsonResult(doc) : errorResult('no catalog saved');
      }),
  );
  server.registerTool(
    'put_world_object_kinds',
    {
      description:
        'Replace the whole world-object-kind catalog; it is validated and nothing is written if invalid. ' +
        'Call get_world_object_kinds first and edit that document; `scale` is a unitless multiplier (1 = unchanged). ' +
        '`rotationStepDeg` must be a positive integer dividing 360, else the catalog is rejected. ' +
        YAW_CONTRACT,
      inputSchema: { catalog: documentSchema },
    },
    (args) =>
      guard(async () => {
        await catalog.save(validateWorldObjectKindCatalog(args.catalog));
        return jsonResult({ saved: true });
      }),
  );
  server.registerTool(
    'patch_world_object_kinds',
    {
      description:
        'Update some kinds in the world-object-kind catalog without resending the rest. Each entry is ' +
        '{id, ...fields}: the given top-level fields replace that kind\'s fields, and fields not given stay ' +
        'as they are. Every id must already exist. The patched catalog is validated as a whole, and nothing ' +
        'is written if any entry fails. Returns the patched ids. ' +
        YAW_CONTRACT,
      inputSchema: { kinds: z.array(z.object({ id: z.string() }).passthrough()).min(1) },
    },
    (args) =>
      guard(async () => {
        const current = await catalog.load();
        if (!current) {
          return errorResult('no catalog saved');
        }
        await catalog.save(validateWorldObjectKindCatalog(patchKinds(current, args.kinds)));
        return jsonResult({ saved: true, patched: args.kinds.map((k) => k.id) });
      }),
  );
  server.registerTool(
    'get_world_settings',
    {
      description:
        'Read the world settings (animation, proximity, lighting, background, camera tunables). ' +
        'Returns the defaults when none have been saved.',
    },
    () => guard(async () => jsonResult((await worldSettings.load()) ?? DEFAULT_WORLD_CONSTANTS)),
  );
  server.registerTool(
    'put_world_settings',
    {
      description:
        'Replace the world settings and push them to the realtime servers. If some pushes fail the settings ' +
        'are still saved and the error names the failed targets. Call get_world_settings first and edit that document.',
      inputSchema: { settings: documentSchema },
    },
    (args) =>
      guard(async () => {
        try {
          await worldSettings.save(args.settings as WorldConstants);
        } catch (err) {
          if (err instanceof WorldConstantsPushError) {
            return errorResult(
              `settings saved, but the realtime push failed for: ${err.failed
                .map((f) => `${f.target} (${f.error ?? f.status ?? 'unknown'})`)
                .join(', ')}`,
            );
          }
          throw err;
        }
        return jsonResult({ saved: true });
      }),
  );
}
