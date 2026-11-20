import { useMemo } from 'react';
import type { Actions, PlayerId, Store } from '@officexr/sdk';
import { useSelfStatus } from './useSelfStatus';
import { useStatusHotkeys } from './useStatusHotkeys';

export function StatusHotkeys({
  store,
  actions,
  selfId,
}: {
  store: Store;
  actions: Pick<Actions, 'setSelfRichStatus' | 'setSelfHand'>;
  selfId: PlayerId;
}) {
  const { toggleHand, toggleFocus } = useSelfStatus(store, actions, selfId);
  const hotkeys = useMemo(() => ({ toggleHand, toggleFocus }), [toggleHand, toggleFocus]);
  useStatusHotkeys(hotkeys);
  return null;
}
