/**
 * Sanity tests on the committed `cube-kinds.json` file. The Object
 * editor and Room editor read this list at runtime, so a corrupt or
 * duplicated entry would surface as broken thumbnails / mis-rendered
 * cubes that the rest of the test suite wouldn't catch.
 *
 * The committed catalog is the post-`pnpm asset-packs:install` state
 * (12 default blocks + furniture + prototype + restaurant entries
 * added by the install script). Devs who haven't run the install
 * script will still pass these tests because we only assert structural
 * invariants, not the existence of the .gltf binaries themselves.
 */

import { describe, it, expect } from 'vitest';
import committedCatalog from '../../world-object-kinds.json' with { type: 'json' };
import bundledDefault from '../../world-object-kinds.default.json' with { type: 'json' };
import {
  CUBE_KIND_CATEGORIES,
  validateWorldObjectKindCatalog as validateCubeKindCatalog,
} from './world-object-kinds-schema.ts';

describe('cube-kinds.json (the committed editable catalog)', () => {
  it('passes validateCubeKindCatalog', () => {
    expect(() => validateCubeKindCatalog(committedCatalog)).not.toThrow();
  });

  it('has at least the bundled-default block kinds', () => {
    const ids = new Set(
      validateCubeKindCatalog(committedCatalog).kinds.map((k) => k.id),
    );
    for (const dflt of validateCubeKindCatalog(bundledDefault).kinds) {
      expect(ids.has(dflt.id), `missing default kind ${dflt.id}`).toBe(true);
    }
  });

  it('all entry ids are unique', () => {
    const cat = validateCubeKindCatalog(committedCatalog);
    const ids = cat.kinds.map((k) => k.id);
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const id of ids) {
      if (seen.has(id)) dupes.push(id);
      seen.add(id);
    }
    expect(dupes).toEqual([]);
  });

  it("every entry's category is from the allowed set", () => {
    const cat = validateCubeKindCatalog(committedCatalog);
    const allowed = new Set(CUBE_KIND_CATEGORIES);
    for (const k of cat.kinds) {
      expect(
        allowed.has(k.category),
        `${k.id} has bad category ${k.category}`,
      ).toBe(true);
    }
  });

  it('every entry has a gltfPath rooted at /models/ and ending in .gltf', () => {
    const cat = validateCubeKindCatalog(committedCatalog);
    for (const k of cat.kinds) {
      expect(
        k.gltfPath.startsWith('/models/'),
        `${k.id} has unexpected gltfPath ${k.gltfPath}`,
      ).toBe(true);
      expect(
        k.gltfPath.toLowerCase().endsWith('.gltf'),
        `${k.id} gltfPath does not end in .gltf: ${k.gltfPath}`,
      ).toBe(true);
    }
  });

  it('newly-added pack entries default to the no-change override baseline', () => {
    // The install script writes catalog entries with scale=1, tint=null,
    // opacity=1, etc. — the documented "no-change" defaults. Anything
    // else would change how blocks render after a fresh install.
    const cat = validateCubeKindCatalog(committedCatalog);
    for (const k of cat.kinds) {
      if (k.category === 'block') continue; // block category may be hand-edited
      expect(k.scale, `${k.id}.scale`).toBe(1);
      expect(k.tint, `${k.id}.tint`).toBeNull();
      expect(k.opacity, `${k.id}.opacity`).toBe(1);
      expect(k.roughness, `${k.id}.roughness`).toBeNull();
      expect(k.metalness, `${k.id}.metalness`).toBeNull();
      expect(k.emissive, `${k.id}.emissive`).toBeNull();
      expect(k.emissiveIntensity, `${k.id}.emissiveIntensity`).toBe(0);
    }
  });
});

describe('cube-kinds.default.json (the bundled fallback)', () => {
  it('passes validateCubeKindCatalog', () => {
    expect(() => validateCubeKindCatalog(bundledDefault)).not.toThrow();
  });

  it('contains only the original 12 block-category kinds', () => {
    const cat = validateCubeKindCatalog(bundledDefault);
    expect(cat.kinds).toHaveLength(12);
    for (const k of cat.kinds) {
      expect(k.category).toBe('block');
    }
  });
});
