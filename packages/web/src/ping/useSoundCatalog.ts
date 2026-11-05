import { useEffect, useState } from 'react';
import { fetchSoundCatalog, soundCatalogUrl, type SoundCatalog } from '@officexr/world/app';

let catalogPromise: Promise<SoundCatalog> | null = null;

const loadCatalogOnce = () => (catalogPromise ??= fetchSoundCatalog(soundCatalogUrl()));

/** The sound library, fetched once per session; null until it loads. */
export function useSoundCatalog(): SoundCatalog | null {
  const [catalog, setCatalog] = useState<SoundCatalog | null>(null);
  useEffect(() => {
    let live = true;
    void loadCatalogOnce().then((loaded) => {
      if (live) {
        setCatalog(loaded);
      }
    });
    return () => {
      live = false;
    };
  }, []);
  return catalog;
}
