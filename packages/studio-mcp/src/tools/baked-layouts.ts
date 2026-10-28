import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { LayoutDocument, WorldObjectKindCatalogV1 } from '@officexr/world/scenes';
import type { HeavyWorkLock } from '../heavy-work-lock.ts';
import type { StudioDocuments } from '../studio-documents.ts';
import { checkedName, nameSchema } from './documents.ts';
import { guard, jsonResult } from './shared.ts';

/** The shape of `bakeLayoutGlb` that the tools rely on, so tests can inject a stub. */
export type BakeLayout = (input: {
  layout: LayoutDocument;
  modelRoot: string;
  catalog: WorldObjectKindCatalogV1 | null;
}) => Promise<{ glb: Uint8Array; meta: { optimizerId: string } }>;

export interface BakeDeps {
  docs: StudioDocuments;
  modelRoot: string;
  bake: BakeLayout;
}

// Lazy so vite.config.ts doesn't load the bake pipeline (three, gltf-transform) at startup.
export const bakeLayoutLazily: BakeLayout = async (input) => {
  const { bakeLayoutGlb } = await import('@officexr/world/bake-layout-glb');
  return bakeLayoutGlb(input);
};

/** Bakes the stored layout against the live catalog and saves the GLB; throws if the layout is missing or the bake fails. */
export async function bakeOne(name: string, { docs, modelRoot, bake }: BakeDeps) {
  const layout = await docs.layouts.load(checkedName(name));
  if (!layout) {
    throw new Error(`layout "${name}" not found`);
  }
  const { glb, meta } = await bake({ layout, modelRoot, catalog: await docs.catalog.load() });
  await docs.bakedLayouts.save(name, glb);
  return { bytes: glb.length, optimizer: meta.optimizerId };
}

export function registerBakedLayoutTools(server: McpServer, lock: HeavyWorkLock, deps: BakeDeps): void {
  const { bakedLayouts } = deps.docs;
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
      guard(() =>
        lock.run(async () => {
          const { bytes, optimizer } = await bakeOne(name, deps);
          return jsonResult({ name, bytes, optimizer });
        }),
      ),
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
