import { useCallback, useEffect, useMemo } from 'react';
import type { Actions, OfficeState, PlayerId, Store } from '@officexr/sdk';
import { useStoreSelector } from '@officexr/world/top-down';
import { readStatusPrefs, writeStatusPrefs, type StatusPrefs } from './statusPrefs';

export type StatusStorage = Pick<Storage, 'getItem' | 'setItem'>;

const memoryOnly: StatusStorage = { getItem: () => null, setItem: () => {} };

function browserStorage(): StatusStorage {
  try {
    return localStorage;
  } catch {
    return memoryOnly;
  }
}

export type SelfStatus = StatusPrefs & {
  handRaised: boolean;
  setStatus: (patch: Partial<Pick<StatusPrefs, 'text' | 'emoji'>>) => void;
  toggleFocus: () => void;
  toggleHand: () => void;
};

const selectSelf =
  (selfId: PlayerId) =>
  (s: OfficeState): StatusPrefs & { handRaised: boolean } => {
    const me = s.players[selfId];
    return { text: me?.statusText ?? '', emoji: me?.statusEmoji ?? '', focus: me?.focus ?? false, handRaised: me?.handRaised ?? false };
  };

const sameSelf = (a: ReturnType<ReturnType<typeof selectSelf>>, b: typeof a) =>
  a.text === b.text && a.emoji === b.emoji && a.focus === b.focus && a.handRaised === b.handRaised;

export function useSelfStatus(
  store: Store,
  actions: Pick<Actions, 'setSelfRichStatus' | 'setSelfHand'>,
  selfId: PlayerId,
  storage: StatusStorage = browserStorage(),
): SelfStatus {
  const select = useMemo(() => selectSelf(selfId), [selfId]);
  const current = useStoreSelector(store, select, sameSelf);

  useEffect(() => {
    const saved = readStatusPrefs(storage);
    actions.setSelfRichStatus({ statusText: saved.text, statusEmoji: saved.emoji, focus: saved.focus });
  }, [actions, storage]);

  const save = useCallback(
    (patch: Partial<StatusPrefs>) => {
      const next = { ...select(store.getState()), ...patch };
      actions.setSelfRichStatus({ statusText: next.text, statusEmoji: next.emoji, focus: next.focus });
      const settled = select(store.getState());
      writeStatusPrefs(storage, { text: settled.text, emoji: settled.emoji, focus: settled.focus });
    },
    [store, actions, select, storage],
  );

  const toggleFocus = useCallback(() => save({ focus: !select(store.getState()).focus }), [save, select, store]);
  const toggleHand = useCallback(
    () => actions.setSelfHand(!select(store.getState()).handRaised),
    [actions, select, store],
  );

  return { ...current, setStatus: save, toggleFocus, toggleHand };
}
