import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { OfficeState, PlayerId, Store } from '@officexr/sdk';
import { loginOf } from '@officexr/sdk';
import { resolveCharacter, type CatalogCharacters } from '@officexr/world/characters';
import { useCatalogCharacters } from '@officexr/world/react';
import { useCharacterPortrait } from '@officexr/world/top-down';

type Looks = { store: Store; catalog: CatalogCharacters };

const LooksContext = createContext<Looks | null>(null);

export function PlayerPortraits({ store, children }: { store: Store; children: ReactNode }) {
  const catalog = useCatalogCharacters();
  const value = useMemo(() => ({ store, catalog }), [store, catalog]);
  return <LooksContext.Provider value={value}>{children}</LooksContext.Provider>;
}

type Pick = (s: OfficeState) => { id: PlayerId; model: string | undefined } | undefined;

const subscribeNothing = () => () => undefined;

function usePortrait(pick: Pick): string | null {
  const looks = useContext(LooksContext);
  const store = looks?.store;
  const subscribe = useCallback((notify: () => void) => (store ? store.subscribe((s) => pick(s)?.model, notify) : subscribeNothing()), [store, pick]);
  const model = useSyncExternalStore(subscribe, () => (store ? pick(store.getState())?.model : undefined));
  const id = store ? pick(store.getState())?.id : undefined;
  const url = id === undefined || !looks ? undefined : resolveCharacter(id, model, looks.catalog).url;
  return useCharacterPortrait(url);
}

const pickSelf: Pick = (s) => ({ id: s.selfId, model: s.players[s.selfId]?.avatar.model });

export const useSelfPortrait = () => usePortrait(pickSelf);

export function usePlayerPortrait(playerId: PlayerId): string | null {
  const pick = useCallback<Pick>((s) => (s.players[playerId] ? { id: playerId, model: s.players[playerId].avatar.model } : undefined), [playerId]);
  return usePortrait(pick);
}

export function useLoginPortrait(login: string | null): string | null {
  const pick = useCallback<Pick>(
    (s) => {
      const p = login === null ? undefined : Object.values(s.players).find((q) => loginOf(q.id) === login);
      return p && { id: p.id, model: p.avatar.model };
    },
    [login],
  );
  return usePortrait(pick);
}
