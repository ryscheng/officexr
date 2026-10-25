import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DEFAULT_WORLD_CONSTANTS, type WorldConstants } from '@officexr/sdk';
import {
  validateWorldObjectKindCatalog,
  WorldConstantsPushError,
} from '@officexr/world/scenes';
import type { StudioDocuments } from '../studio-documents.ts';
import { documentSchema, errorResult, guard, jsonResult } from './shared.ts';

export function registerWorldTools(
  server: McpServer,
  { catalog, worldSettings }: StudioDocuments,
): void {
  server.registerTool(
    'get_world_object_kinds',
    {
      description:
        'Read the catalog of world-object kinds (id, label, model path, swatch, walkable, scale, material ' +
        'overrides). Rooms and layouts reference kinds by id.',
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
        'Call get_world_object_kinds first and edit that document.',
      inputSchema: { catalog: documentSchema },
    },
    (args) =>
      guard(async () => {
        await catalog.save(validateWorldObjectKindCatalog(args.catalog));
        return jsonResult({ saved: true });
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
