import { useEffect, useEffectEvent, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import type { Store } from '@officexr/sdk';
import { resolveCharacter } from '../characters/registry.ts';
import { useCatalogCharacters } from '../react/application-context.tsx';
import { ANIMATION_URLS } from './Adventurer.tsx';

/**
 * Rendered last inside `<Scene>`'s outer `<Suspense>`, so its effect runs
 * only once every sibling's models have resolved. Avatars load under their
 * own boundaries, so it also loads the self player's models itself; without
 * that, the world would show before the self player has a body.
 *
 * The URLs are read once: this gates the first paint only, and re-reading a
 * later character pick here would suspend the whole world on its download.
 */
export function ModelsReady(props: { store: Store; selfId: string; onReady: () => void }) {
  const catalog = useCatalogCharacters();
  const [urls] = useState(() => {
    const model = props.store.getState().players[props.selfId]?.avatar.model;
    return [resolveCharacter(props.selfId, model, catalog).url, ...ANIMATION_URLS];
  });
  useGLTF(urls);
  const onReady = useEffectEvent(props.onReady);
  useEffect(() => {
    onReady();
  }, []);
  return null;
}
