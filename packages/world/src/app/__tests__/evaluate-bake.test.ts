import { Document, WebIO } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { BAKE_SOURCE_VERSION, computeBakeSourceFingerprint } from '../bake-source.ts';
import { evaluateBake } from '../evaluate-bake.ts';
import type { KindLookup } from '../layout-bake-service.ts';
import type { LayoutDocument } from '../../scenes/layout-document.ts';

const rawKind = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  label: id,
  gltfPath: `/models/${id}.glb`,
  swatch: '#fff',
  ...extra,
});

const layout = (overrides: Partial<LayoutDocument> = {}): LayoutDocument => ({
  schemaVersion: 1,
  name: 'hall',
  updatedAt: 1,
  commands: [{ id: 'c1', op: 'placeObject', kindId: 'wall', position: [0, 0, 0] }],
  ...overrides,
});

const lookup = (kinds: Record<string, unknown>): KindLookup => (id) => kinds[id] as ReturnType<KindLookup>;
const kinds = { wall: rawKind('wall') };

async function glbWith(bakeSource: unknown): Promise<Uint8Array> {
  const doc = new Document();
  doc.createScene('s').setExtras(bakeSource === undefined ? {} : { officexr: { bakeSource } });
  return new WebIO().writeBinary(doc);
}

describe('evaluateBake', () => {
  it('is missing without a GLB', async () => {
    expect(await evaluateBake(layout(), null, lookup(kinds))).toEqual({ type: 'missing' });
  });

  it('is unknown for a GLB without bakeSource', async () => {
    expect(await evaluateBake(layout(), await glbWith(undefined), lookup(kinds))).toEqual({ type: 'unknown' });
  });

  it('is fresh when the fingerprint matches the resolved default optimizer', async () => {
    // layout.optimizer is undefined; the bake hashes the resolved id "default".
    const fingerprint = (await computeBakeSourceFingerprint(layout(), 'default', lookup(kinds)))!;
    const glb = await glbWith({ version: BAKE_SOURCE_VERSION, fingerprint, layoutName: 'hall' });
    expect(await evaluateBake(layout(), glb, lookup(kinds))).toEqual({ type: 'fresh' });
  });

  it('is stale when the layout, the version or the kind changed', async () => {
    const fingerprint = (await computeBakeSourceFingerprint(layout(), 'default', lookup(kinds)))!;
    const glb = await glbWith({ version: BAKE_SOURCE_VERSION, fingerprint, layoutName: 'hall' });
    const moved = layout({ commands: [{ id: 'c1', op: 'placeObject', kindId: 'wall', position: [1, 0, 0] }] });
    expect(await evaluateBake(moved, glb, lookup(kinds))).toEqual({ type: 'stale' });
    expect(await evaluateBake(layout(), glb, lookup({ wall: rawKind('wall', { label: 'other' }) }))).toEqual({
      type: 'stale',
    });
    const oldVersion = await glbWith({ version: BAKE_SOURCE_VERSION + 1, fingerprint, layoutName: 'hall' });
    expect(await evaluateBake(layout(), oldVersion, lookup(kinds))).toEqual({ type: 'stale' });
  });

  it('is unknown, not stale, when the fresh fingerprint cannot be computed', async () => {
    const glb = await glbWith({ version: BAKE_SOURCE_VERSION, fingerprint: 'abc', layoutName: 'hall' });
    expect(await evaluateBake(layout(), glb, lookup({ wall: rawKind('wall', { label: '' }) }))).toEqual({
      type: 'unknown',
    });
  });
});
