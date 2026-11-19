import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Actions, EmoteId, PlayerId, Store, SyncEngine } from '@officexr/sdk';
import { performanceNow } from '../hud/useNow';
import { useSelfStatus, type SelfStatus, type StatusStorage } from './useSelfStatus';
import { useStatusHotkeys } from './useStatusHotkeys';

export const EMOTE_COOLDOWN_MS = 1000;

export type StatusHud = SelfStatus & {
  statusMenuOpen: boolean;
  setStatusMenuOpen: (open: boolean) => void;
  emoteMenuOpen: boolean;
  setEmoteMenuOpen: (open: boolean) => void;
  /** Ignored while the previous emote is still cooling down. */
  sendEmote: (emote: EmoteId) => void;
};

const StatusHudContext = createContext<StatusHud | null>(null);

/** The status controls' state, or null outside a provider so shared lists render without them. */
export const useStatusHud = (): StatusHud | null => useContext(StatusHudContext);

/** Owns the local status, raised hand and emote state, and the H, R and Alt+N keys that drive them. */
export function SelfStatusProvider({
  store,
  actions,
  sync,
  selfId,
  storage,
  clock = performanceNow,
  children,
}: {
  store: Store;
  actions: Pick<Actions, 'setSelfRichStatus' | 'setSelfHand' | 'receiveEmote'>;
  sync: Pick<SyncEngine, 'sendEmote'>;
  selfId: PlayerId;
  storage?: StatusStorage;
  /** Must be stable. */
  clock?: () => number;
  children: ReactNode;
}) {
  const status = useSelfStatus(store, actions, selfId, storage);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [emoteMenuOpen, setEmoteMenuOpen] = useState(false);
  const lastEmoteAt = useRef(-Infinity);

  const sendEmote = useCallback(
    (emote: EmoteId) => {
      const now = clock();
      if (now - lastEmoteAt.current < EMOTE_COOLDOWN_MS) {
        return;
      }
      lastEmoteAt.current = now;
      // The server never echoes a sender's own event, so the local bubble comes from here.
      actions.receiveEmote(selfId, emote, now);
      sync.sendEmote(emote);
    },
    [actions, sync, selfId, clock],
  );

  const { toggleHand, toggleFocus } = status;
  const hotkeys = useMemo(
    () => ({ toggleHand, toggleFocus, toggleEmotePicker: () => setEmoteMenuOpen((open) => !open) }),
    [toggleHand, toggleFocus],
  );
  useStatusHotkeys(hotkeys);

  const value = { ...status, statusMenuOpen, setStatusMenuOpen, emoteMenuOpen, setEmoteMenuOpen, sendEmote };
  return <StatusHudContext.Provider value={value}>{children}</StatusHudContext.Provider>;
}
