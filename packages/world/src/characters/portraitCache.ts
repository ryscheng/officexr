import { basePortrait } from './basePortraits.ts';
import { createPortraitStore, type PortraitStore } from './portraitStore.ts';

const images = new Map<string, string>();
let store: PortraitStore | undefined;

const persistent = () => (store ??= createPortraitStore());

/** Replaces the persistent store, for tests. */
export const setPortraitStore = (next: PortraitStore | undefined): void => {
  store = next;
};

export const cachedCharacterPortrait = (url: string): string | null => images.get(url) ?? basePortrait(url);

export const storeCharacterPortrait = (url: string, image: string): void => {
  images.set(url, image);
  void persistent().write(url, image);
};

/** Makes catalog-supplied portraits known by model URL, so nothing downloads or renders those models for a tile. */
export const supplyCharacterPortraits = (options: Iterable<{ url: string; portrait?: string }>): void => {
  for (const { url, portrait } of options) {
    if (portrait) {
      images.set(url, portrait);
    }
  }
};

/** A portrait already known in memory or stored from an earlier visit; the renderer is needed only when this is `null`. */
export async function knownCharacterPortrait(url: string): Promise<string | null> {
  const known = cachedCharacterPortrait(url);
  if (known) {
    return known;
  }
  const stored = await persistent().read(url);
  if (stored) {
    images.set(url, stored);
  }
  return stored;
}
