import { useEffect, useState } from 'react';
import { Html } from '@react-three/drei';
import { EMOTE_BUBBLE_MS, EMOTE_INFO, type Bus, type EmoteId, type PlayerId, type Store } from '@officexr/sdk';
import { TAG_HEIGHT_M } from './PlayerNameTag.tsx';
import './PlayerNameTag.css';

export const RAISED_HAND_GLYPH = '✋';

type ShownEmote = { emote: EmoteId; n: number };

/** The emote `playerId` last sent, for `EMOTE_BUBBLE_MS`; a repeat restarts the timer and the pop. */
export function usePlayerEmote(bus: Bus, playerId: PlayerId, lifeMs: number = EMOTE_BUBBLE_MS): ShownEmote | null {
  const [shown, setShown] = useState<ShownEmote | null>(null);
  useEffect(
    () =>
      bus.on('emote:received', ({ fromId, emote }) => {
        if (fromId === playerId) setShown((prev) => ({ emote, n: (prev?.n ?? 0) + 1 }));
      }),
    [bus, playerId],
  );
  useEffect(() => {
    if (!shown) return;
    const id = setTimeout(() => setShown(null), lifeMs);
    return () => clearTimeout(id);
  }, [shown, lifeMs]);
  return shown;
}

export function usePlayerHandRaised(store: Store, playerId: PlayerId): boolean {
  const [raised, setRaised] = useState(() => store.getState().players[playerId]?.handRaised ?? false);
  useEffect(
    () => store.subscribe((s) => s.players[playerId]?.handRaised ?? false, setRaised),
    [store, playerId],
  );
  return raised;
}

export const shouldShowBubbles = (paused: boolean, handRaised: boolean, emote: ShownEmote | null): boolean =>
  !paused && (handRaised || emote !== null);

/**
 * Raised-hand and emote icons above a player's name tag. Must be a child of the
 * per-player group so it follows the character.
 */
export function PlayerBubbles(props: { store: Store; bus: Bus; playerId: PlayerId; paused: boolean }) {
  const { store, bus, playerId, paused } = props;
  const emote = usePlayerEmote(bus, playerId);
  const handRaised = usePlayerHandRaised(store, playerId);
  if (!shouldShowBubbles(paused, handRaised, emote)) return null;
  return (
    <Html center position={[0, TAG_HEIGHT_M, 0]} zIndexRange={[1, 0]}>
      <div className="player-bubbles">
        {handRaised && (
          <span role="img" aria-label="Hand raised" className="player-bubble player-bubble-hand">
            {RAISED_HAND_GLYPH}
          </span>
        )}
        {emote && (
          <span
            // A new key restarts the pop animation when the same emote repeats.
            key={emote.n}
            role="img"
            aria-label={EMOTE_INFO[emote.emote].label}
            className="player-bubble player-bubble-emote"
          >
            {EMOTE_INFO[emote.emote].glyph}
          </span>
        )}
      </div>
    </Html>
  );
}
