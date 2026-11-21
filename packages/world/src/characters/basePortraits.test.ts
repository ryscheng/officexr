import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import manifest from './portraits/manifest.json';
import { basePortrait } from './basePortraits.ts';
import { cachedCharacterPortrait } from './portraitCache.ts';
import { baseCharacterOptions, CHARACTERS } from './registry.ts';

const modelPath = (id: string) => new URL(`../../../studio/public/models/characters/${id}.glb`, import.meta.url);

describe('base character portraits', () => {
  it('has a portrait for every built-in character, and none for another URL', () => {
    for (const option of baseCharacterOptions()) {
      expect(basePortrait(option.url), option.id).toMatch(/\.webp$/);
    }
    expect(basePortrait('/models/characters/Custom.glb')).toBeNull();
  });

  it('serves a built-in portrait without a render', () => {
    const [first] = baseCharacterOptions();
    expect(cachedCharacterPortrait(first.url)).toBe(basePortrait(first.url));
  });

  it('was baked from the models in the repo; run `pnpm --filter @officexr/world bake:portraits` after changing one', () => {
    for (const id of CHARACTERS) {
      const sha = createHash('sha256').update(readFileSync(modelPath(id))).digest('hex');
      expect(manifest[id], id).toBe(sha);
    }
  });
});
