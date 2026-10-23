import { useEffect, useState } from 'react';
import { Html } from '@react-three/drei';
import type { Store } from '@officexr/sdk';

const TAG_HEIGHT_M = 2;

export const shouldShowNameTag = (
  name: string,
  isSelf: boolean,
  paused: boolean,
): boolean => !isSelf && !paused && name !== '';

const TAG_STYLE = `
.player-name-tag {
  padding: 2px 8px;
  border-radius: 999px;
  background: #111;
  color: #fff;
  font: 12px/1.4 sans-serif;
  white-space: nowrap;
  user-select: none;
  pointer-events: auto;
  opacity: 0.5;
}
.player-name-tag:hover { opacity: 1; }
`;

/**
 * Floating name label above a player's feet. Must be a child of the
 * per-player group so it follows the character.
 */
export function PlayerNameTag(props: {
  store: Store;
  playerId: string;
  selfId: string;
  paused: boolean;
}) {
  const { store, playerId, selfId, paused } = props;
  const [name, setName] = useState(() => store.getState().players[playerId]?.name ?? '');
  useEffect(
    () => store.subscribe((s) => s.players[playerId]?.name ?? '', setName),
    [store, playerId],
  );
  if (!shouldShowNameTag(name, playerId === selfId, paused)) return null;
  return (
    // Only the pill itself takes pointer events, so the label never blocks the world around it.
    <Html center position={[0, TAG_HEIGHT_M, 0]} pointerEvents="none">
      <style>{TAG_STYLE}</style>
      <div className="player-name-tag">{name}</div>
    </Html>
  );
}
