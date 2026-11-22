import { useEffect, useRef } from 'react';
import { modelUrl } from '@officexr/world/app';
import type { WorldObjectKind } from '@officexr/world';
import { renderCharacterPortrait } from '@officexr/world/renderer';
import { MAX_PORTRAIT_CHARS } from '@officexr/world/scenes';

const needsPortrait = (kind: WorldObjectKind) => kind.category === 'character' && !kind.portrait;

/** Renders and saves a portrait for each `character` kind that has none, so the game never downloads a model just to draw its tile. */
export function useCharacterPortraitBackfill(kinds: readonly WorldObjectKind[], setPortrait: (kindId: string, portrait: string) => void): void {
  const tried = useRef(new Set<string>());
  useEffect(() => {
    for (const kind of kinds) {
      const attempt = `${kind.id}|${kind.gltfPath}`;
      if (!needsPortrait(kind) || tried.current.has(attempt)) {
        continue;
      }
      tried.current.add(attempt);
      renderCharacterPortrait(modelUrl(kind.gltfPath)).then(
        (image) => {
          if (image.startsWith('data:image/webp;base64,') && image.length <= MAX_PORTRAIT_CHARS) {
            setPortrait(kind.id, image);
          }
        },
        (err: unknown) => console.warn(`[object-catalog] portrait for ${kind.id} failed:`, err),
      );
    }
  }, [kinds, setPortrait]);
}
