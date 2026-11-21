import { useEffect, useState } from 'react';
import { cachedCharacterPortrait, knownCharacterPortrait } from '../characters/portraitCache.ts';

export function useCharacterPortrait(url: string | undefined): string | null {
  const [rendered, setRendered] = useState<{ url: string; image: string } | null>(null);
  useEffect(() => {
    if (!url || cachedCharacterPortrait(url)) {
      return;
    }
    let live = true;
    knownCharacterPortrait(url)
      .then((known) => known ?? import('../renderer/characterPortrait.ts').then((m) => m.renderCharacterPortrait(url)))
      .then(
        (image) => live && setRendered({ url, image }),
        () => undefined,
      );
    return () => {
      live = false;
    };
  }, [url]);
  if (!url) {
    return null;
  }
  return cachedCharacterPortrait(url) ?? (rendered?.url === url ? rendered.image : null);
}
