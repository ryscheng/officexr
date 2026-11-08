import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { emptyLayoutDocument, type LayoutDocument } from '../scenes/layout-document.ts';
import type { WorldObjectKindCatalogV1 } from '../scenes/world-object-kinds-schema.ts';
import { NodeIO } from '@gltf-transform/core';
import { compressDocument, registerCompressionCodecs } from './glb-compression.ts';
import { triangleDoc } from './test-fixtures.ts';
import { bakeLayoutGlb } from './bake-layout-glb.ts';

const defaults = JSON.parse(
  await readFile(new URL('../../world-object-kinds.default.json', import.meta.url), 'utf-8'),
) as WorldObjectKindCatalogV1;

const layout = {
  ...emptyLayoutDocument('hall'),
  commands: [{ op: 'placeObject', id: 'p1', kindId: 'colored_block_blue', position: [0, 0, 0] }],
} as LayoutDocument;

const withGltfPath = (gltfPath: string): WorldObjectKindCatalogV1 => ({
  ...defaults,
  kinds: defaults.kinds.map((k) => (k.id === 'colored_block_blue' ? { ...k, gltfPath } : k)),
});

describe('bakeLayoutGlb', () => {
  it('refuses a kind model path that escapes the model root', async () => {
    await expect(
      bakeLayoutGlb({ layout, modelRoot: '/srv/public', catalog: withGltfPath('/../../../etc/passwd') }),
    ).rejects.toThrow('outside the model root');
  });

  it('does not mistake a name starting with two dots for an escape', async () => {
    await expect(
      bakeLayoutGlb({ layout, modelRoot: '/srv/public', catalog: withGltfPath('/models/..foo.gltf') }),
    ).rejects.not.toThrow('outside the model root');
  });

  describe('sourceObject kinds', () => {
    const withSource = (sourceObject: string): WorldObjectKindCatalogV1 => ({
      ...defaults,
      kinds: defaults.kinds.map((k) =>
        k.id === 'colored_block_blue' ? { ...k, gltfPath: '/models/missing.glb', sourceObject } : k,
      ),
    });

    it('fails clearly without a source reader', async () => {
      await expect(
        bakeLayoutGlb({ layout, modelRoot: '/srv/public', catalog: withSource('packs/p/a.glb') }),
      ).rejects.toThrow(/colored_block_blue.*private sources aren't configured/);
    });

    it('reads the kind from the reader and never from modelRoot', async () => {
      const glb = await new NodeIO().writeBinary(triangleDoc());
      const reads: string[] = [];
      const sourceReader = {
        read: async (key: string) => {
          reads.push(key);
          return glb;
        },
      };
      const { glb: baked } = await bakeLayoutGlb({
        layout,
        modelRoot: '/nonexistent',
        catalog: withSource('packs/p/a.glb'),
        sourceReader,
      });
      expect(baked.length).toBeGreaterThan(0);
      expect(reads).toEqual(['packs/p/a.glb']);
    });

    it('bakes a meshopt-compressed source', async () => {
      const source = triangleDoc();
      await source.transform(compressDocument);
      const glb = await (await registerCompressionCodecs(new NodeIO())).writeBinary(source);
      const { glb: baked } = await bakeLayoutGlb({
        layout,
        modelRoot: '/nonexistent',
        catalog: withSource('packs/p/a.glb'),
        sourceReader: { read: async () => glb },
      });
      expect(baked.length).toBeGreaterThan(0);
    });
  });
});
