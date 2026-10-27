import { useEffect, useState } from 'react';
import { Html } from '@react-three/drei';
import type { Store } from '@officexr/sdk';
import './PlayerNameTag.css';

const TAG_HEIGHT_M = 2;

export const shouldShowNameTag = (
  name: string,
  isSelf: boolean,
  paused: boolean,
): boolean => !isSelf && !paused && name !== '';

/**
 * Floating name label above a player's feet. Must be a child of the
 * per-player group so it follows the character.
 */
export function PlayerNameTag(props: {
  store: Store;
  playerId: string;
  isSelf: boolean;
  paused: boolean;
}) {
  const { store, playerId, isSelf, paused } = props;
  const [name, setName] = useState(() => store.getState().players[playerId]?.name ?? '');
  useEffect(
    () => store.subscribe((s) => s.players[playerId]?.name ?? '', setName),
    [store, playerId],
  );
  if (!shouldShowNameTag(name, isSelf, paused)) return null;
  return (
    // ponytail: tags show through walls and keep a constant size regardless of distance.
    // Small zIndexRange keeps tags beneath HUD panels.
    <Html center position={[0, TAG_HEIGHT_M, 0]} zIndexRange={[1, 0]}>
      <div className="player-name-tag">{name}</div>
    </Html>
  );
}
