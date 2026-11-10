import { useEffect, useEffectEvent } from 'react';
import { useGLTF } from '@react-three/drei';
import type { Store } from '@officexr/sdk';
import { resolveCharacter } from '../characters/registry.ts';
import { useCatalogCharacters } from '../react/application-context.tsx';
import { ANIMATION_URLS } from './Adventurer.tsx';

/**
 * Rendered last inside `<Scene>`'s outer `<Suspense>`, so its effect runs
 * only once every sibling's models have resolved. It also loads the self
 * player's models, which a scene holding the self player back has not
 * requested yet; without them cached, adding the self player would
 * re-suspend the whole world.
 */
export function ModelsReady(props: { store: Store; selfId: string; onReady: () => void }) {
  const model = props.store.getState().players[props.selfId]?.avatar.model;
  const catalog = useCatalogCharacters();
  useGLTF([resolveCharacter(props.selfId, model, catalog).url, ...ANIMATION_URLS]);
  const onReady = useEffectEvent(props.onReady);
  useEffect(() => {
    onReady();
  }, []);
  return null;
}
