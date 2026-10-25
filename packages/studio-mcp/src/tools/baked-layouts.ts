import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StudioDocuments } from '../studio-documents.ts';
import { checkedName, nameSchema } from './documents.ts';
import { errorResult, guard, jsonResult } from './shared.ts';

/** `modelRoot` is the directory the catalog's `/models/...` paths resolve against. */
export function registerBakedLayoutTools(
  server: McpServer,
  { layouts, catalog, bakedLayouts }: StudioDocuments,
  modelRoot: string,
): void {
  server.registerTool(
    'bake_layout',
    {
      description:
        'Bake a stored layout into one optimized GLB on the server and store it as the layout\'s baked model. ' +
        'Uses the layout\'s own optimizer. Fails, storing nothing, if the layout or a kind model is missing. ' +
        'Returns the name, byte size and optimizer used.',
      inputSchema: { name: nameSchema },
    },
    ({ name }) =>
      guard(async () => {
        const layout = await layouts.load(checkedName(name));
        if (!layout) {
          return errorResult(`layout "${name}" not found`);
        }
        // Lazy so vite.config.ts doesn't load the bake pipeline (three, gltf-transform) at startup.
        const { bakeLayoutGlb } = await import('@officexr/world/bake-layout-glb');
        const { glb, meta } = await bakeLayoutGlb({ layout, modelRoot, catalog: await catalog.load() });
        await bakedLayouts.save(name, glb);
        return jsonResult({ name, bytes: glb.length, optimizer: meta.optimizerId });
      }),
  );
  server.registerTool(
    'list_baked_layouts',
    { description: 'List the stored baked layout GLBs (name, size in bytes, updatedAt).' },
    () => guard(async () => jsonResult(await bakedLayouts.list())),
  );
  server.registerTool(
    'delete_baked_layout',
    {
      description: 'Delete a baked layout GLB by name; deleting a missing one is not an error.',
      inputSchema: { name: nameSchema },
    },
    ({ name }) =>
      guard(async () => {
        await bakedLayouts.delete(checkedName(name));
        return jsonResult({ deleted: name });
      }),
  );
}
