import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { emptyLayoutDocument, type LayoutDocument } from '../scenes/layout-document.ts';
import type { WorldObjectKindCatalogV1 } from '../scenes/world-object-kinds-schema.ts';
import { bakeLayoutGlb } from './bake-layout-glb.ts';

const defaults = JSON.parse(
  await readFile(new URL('../../world-object-kinds.default.json', import.meta.url), 'utf-8'),
) as WorldObjectKindCatalogV1;

describe('bakeLayoutGlb', () => {
  it('refuses a kind model path that escapes the model root', async () => {
    const catalog = {
      ...defaults,
      kinds: defaults.kinds.map((k) => (k.id === 'colored_block_blue' ? { ...k, gltfPath: '/../../../etc/passwd' } : k)),
    };
    const layout = {
      ...emptyLayoutDocument('hall'),
      commands: [{ op: 'placeObject', id: 'p1', kindId: 'colored_block_blue', position: [0, 0, 0] }],
    } as LayoutDocument;
    await expect(bakeLayoutGlb({ layout, modelRoot: '/srv/public', catalog })).rejects.toThrow('outside the model root');
  });
});
