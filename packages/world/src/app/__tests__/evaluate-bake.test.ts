import { Document, WebIO } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { defaultOptimizer } from '../bake-optimizers.ts';
import { registerCompressionCodecs } from '../glb-compression.ts';
import { evaluateBake } from '../evaluate-bake.ts';
import { createInstanceGeometry } from '../geometry-service.ts';
import { bakeLayout, type KindLookup } from '../layout-bake-service.ts';
import { BAKE_SOURCE_VERSION } from '../bake-source.ts';
import type { LayoutDocument } from '../../scenes/layout-document.ts';
import { catalogKindLookup, type WorldObjectKind } from '../../scenes/world-object-kinds-schema.ts';

const io = await registerCompressionCodecs(new WebIO());

const wallKind = { id: 'wall', label: 'wall', gltfPath: '/models/wall.glb', swatch: '#fff' };
const catalogOf = (...kinds: Array<Record<string, unknown>>) =>
  catalogKindLookup({ schemaVersion: 1, kinds } as unknown as Parameters<typeof catalogKindLookup>[0]);

const layout = (overrides: Partial<LayoutDocument> = {}): LayoutDocument => ({
  schemaVersion: 1,
  name: 'hall',
  updatedAt: 1,
  commands: [{ id: 'c1', op: 'placeObject', kindId: 'wall', position: [0, 0, 0] }],
  ...overrides,
});

async function trivialModel(): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const position = doc
    .createAccessor()
    .setType('VEC3')
    .setBuffer(buffer)
    .setArray(new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 1, 0.5]));
  const mesh = doc.createMesh('m').addPrimitive(doc.createPrimitive().setAttribute('POSITION', position));
  doc.createScene('s').addChild(doc.createNode('n').setMesh(mesh));
  return io.writeBinary(doc);
}

/** A real, compressed bake of `doc`, as the studio produces it. */
async function bake(doc: LayoutDocument, lookup: KindLookup, options: Parameters<typeof bakeLayout>[4] = {}) {
  const model = await trivialModel();
  const geometry = createInstanceGeometry({
    catalog: { getKind: lookup as (id: string) => WorldObjectKind | undefined },
    voxelSize: 0.5,
  });
  return (await bakeLayout(doc, lookup, async () => model, geometry, { io, ...options })).glb;
}

describe('evaluateBake', () => {
  const lookup = catalogOf(wallKind);

  it('is missing without a GLB', async () => {
    expect(await evaluateBake(layout(), null, lookup)).toEqual({ type: 'missing' });
  });

  it('is fresh for a real compressed bake of the same layout', async () => {
    // layout.optimizer is undefined; the bake hashes the resolved id "default".
    expect(layout().optimizer).toBeUndefined();
    const glb = await bake(layout(), lookup);
    expect(new TextDecoder().decode(glb)).toContain('EXT_meshopt_compression');
    expect(await evaluateBake(layout(), glb, lookup)).toEqual({ type: 'fresh' });
  });

  it('is stale when the layout, a kind, the optimizer or the bake version changed', async () => {
    const glb = await bake(layout(), lookup);
    const moved = layout({ commands: [{ id: 'c1', op: 'placeObject', kindId: 'wall', position: [1, 0, 0] }] });
    expect(await evaluateBake(moved, glb, lookup)).toEqual({ type: 'stale' });
    expect(await evaluateBake(layout(), glb, catalogOf({ ...wallKind, label: 'other' }))).toEqual({ type: 'stale' });
    expect(await evaluateBake(layout({ optimizer: 'none' }), glb, lookup)).toEqual({ type: 'stale' });

    const doc = await io.readBinary(glb);
    const scene = doc.getRoot().listScenes()[0];
    const extras = scene.getExtras() as { officexr: { bakeSource: object } };
    scene.setExtras({ officexr: { ...extras.officexr, bakeSource: { ...extras.officexr.bakeSource, version: BAKE_SOURCE_VERSION + 1 } } });
    expect(await evaluateBake(layout(), await io.writeBinary(doc), lookup)).toEqual({ type: 'stale' });
  });

  it('is fresh when the optimizer is named explicitly or unknown but resolves to the default', async () => {
    const glb = await bake(layout({ optimizer: defaultOptimizer.id }), lookup, { optimizer: defaultOptimizer.id });
    expect(await evaluateBake(layout({ optimizer: 'no-such-optimizer' }), glb, lookup)).toEqual({ type: 'fresh' });
  });

  it('is unknown for a bake without bakeSource', async () => {
    const glb = await bake(layout(), lookup, { subtle: () => undefined });
    expect(await evaluateBake(layout(), glb, lookup)).toEqual({ type: 'unknown' });
  });

  it('is unknown, not stale, when the fresh fingerprint cannot be computed', async () => {
    const glb = await bake(layout(), lookup);
    const invalid = (id: string) => (id === 'wall' ? ({ ...wallKind, label: '' } as unknown as WorldObjectKind) : undefined);
    expect(await evaluateBake(layout(), glb, invalid)).toEqual({ type: 'unknown' });
  });

  it('throws on bytes that are not a GLB', async () => {
    await expect(evaluateBake(layout(), new Uint8Array([1, 2, 3]), lookup)).rejects.toThrow('not a GLB');
  });
});
