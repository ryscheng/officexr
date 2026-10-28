import { describe, it, expect } from 'vitest';
import { computeBakeSourceFingerprint } from '../bake-source.ts';
import { parseBakeSource } from '../baked-collider-extras.ts';
import type { KindLookup } from '../layout-bake-service.ts';
import type { LayoutDocument } from '../../scenes/layout-document.ts';
import { normalizeKind } from '../../scenes/world-object-kinds-schema.ts';

const rawKind = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  label: id,
  gltfPath: `/models/${id}.glb`,
  swatch: '#fff',
  ...extra,
});

const layout = (overrides: Partial<LayoutDocument> = {}): LayoutDocument => ({
  schemaVersion: 1,
  name: 'room',
  updatedAt: 1,
  commands: [{ id: 'c1', op: 'placeObject', kindId: 'wall', position: [0, 0, 0] }],
  ...overrides,
});

const lookupOf =
  (kinds: Record<string, unknown>): KindLookup =>
  (id) => kinds[id] as ReturnType<KindLookup>;

const fingerprint = (doc: LayoutDocument, kinds: Record<string, unknown>, optimizer = 'default') =>
  computeBakeSourceFingerprint(doc, optimizer, lookupOf(kinds));

describe('computeBakeSourceFingerprint', () => {
  const kinds = { wall: rawKind('wall'), lamp: rawKind('lamp') };

  it('is stable for identical inputs and hex SHA-256', async () => {
    const a = await fingerprint(layout(), kinds);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await fingerprint(layout(), kinds)).toBe(a);
  });

  it('changes with a used kind, a command or the optimizer', async () => {
    const base = await fingerprint(layout(), kinds);
    const box = { kind: 'compound-steps', stepCount: 3, stepRise: 0.2, stepRun: 0.3, stepDepth: 1 };
    expect(await fingerprint(layout(), { ...kinds, wall: rawKind('wall', { colliderShape: box }) })).not.toBe(base);
    const moved = layout({
      commands: [{ id: 'c1', op: 'placeObject', kindId: 'wall', position: [1, 0, 0] }],
    });
    expect(await fingerprint(moved, kinds)).not.toBe(base);
    expect(await fingerprint(layout(), kinds, 'none')).not.toBe(base);
  });

  it('ignores unused kinds, groups, name and updatedAt', async () => {
    const base = await fingerprint(layout(), kinds);
    expect(await fingerprint(layout(), { ...kinds, lamp: rawKind('lamp', { tint: '#f00' }) })).toBe(base);
    const meta = layout({ groups: { g: { id: 'g', commandIds: ['c1'] } as never }, name: 'other', updatedAt: 99 });
    expect(await fingerprint(meta, kinds)).toBe(base);
  });

  it('hashes a raw catalog kind and its normalised form identically', async () => {
    const raw = await fingerprint(layout(), kinds);
    const normalised = await fingerprint(layout(), { ...kinds, wall: normalizeKind(kinds.wall, 0) });
    expect(normalised).toBe(raw);
  });

  it('records a missing kind as null rather than throwing', async () => {
    expect(await fingerprint(layout(), {})).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns null when crypto.subtle is unavailable', async () => {
    expect(await computeBakeSourceFingerprint(layout(), 'default', lookupOf(kinds), () => undefined)).toBeNull();
  });
});

describe('parseBakeSource', () => {
  it('returns null for pre-fingerprint extras and malformed input', () => {
    expect(parseBakeSource({ officexr: { colliders: { version: 2, cuboids: [], trimeshes: [] } } })).toBeNull();
    expect(parseBakeSource(undefined)).toBeNull();
    expect(parseBakeSource({ officexr: { bakeSource: { version: 1, fingerprint: 3, layoutName: 'x' } } })).toBeNull();
  });

  it('reads a well-formed bakeSource', () => {
    const bakeSource = { version: 1, fingerprint: 'ab', layoutName: 'room' };
    expect(parseBakeSource({ officexr: { bakeSource } })).toEqual(bakeSource);
  });
});
