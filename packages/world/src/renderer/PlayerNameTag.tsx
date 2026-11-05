import { useEffect, useState } from 'react';
import { Html } from '@react-three/drei';
import type { PlayerId, Store } from '@officexr/sdk';
import { PingBellButton } from '../react/PingBellButton.tsx';
import { CHAR_HEIGHT_M, type CameraMode } from './config.ts';
import { isYawPitchMode } from './lookControls.ts';
import './PlayerNameTag.css';

const TAG_HEIGHT_M = 2;

export const shouldShowNameTag = (
  name: string,
  isSelf: boolean,
  paused: boolean,
): boolean => !isSelf && !paused && name !== '';

export const shouldShowPingBell = (
  onPing: ((id: PlayerId) => void) | undefined,
  isSelf: boolean,
  cameraMode: CameraMode,
  paused: boolean,
): onPing is (id: PlayerId) => void => !!onPing && !isSelf && !paused && !isYawPitchMode(cameraMode);

function usePlayerName(store: Store, playerId: PlayerId): string {
  const [name, setName] = useState(() => store.getState().players[playerId]?.name ?? '');
  useEffect(
    () => store.subscribe((s) => s.players[playerId]?.name ?? '', setName),
    [store, playerId],
  );
  return name;
}

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
  const name = usePlayerName(store, playerId);
  if (!shouldShowNameTag(name, isSelf, paused)) return null;
  return (
    // ponytail: tags show through walls and keep a constant size regardless of distance.
    // Small zIndexRange keeps tags beneath HUD panels.
    <Html center position={[0, TAG_HEIGHT_M, 0]} zIndexRange={[1, 0]}>
      <div className="player-name-tag">{name}</div>
    </Html>
  );
}

/**
 * Invisible hover target around a player's body that shows a ping bell above
 * the name tag. Like the tag, it must be a child of the per-player group.
 */
export function PlayerPingBell(props: {
  store: Store;
  playerId: PlayerId;
  radius: number;
  onPing: (id: PlayerId) => void;
}) {
  const { store, playerId, radius, onPing } = props;
  const name = usePlayerName(store, playerId);
  const [overAvatar, setOverAvatar] = useState(false);
  // The bell sits outside the capsule, so moving onto it fires the capsule's pointerout.
  const [overBell, setOverBell] = useState(false);
  return (
    <>
      <mesh
        position={[0, CHAR_HEIGHT_M / 2, 0]}
        onPointerOver={() => setOverAvatar(true)}
        onPointerOut={() => setOverAvatar(false)}
      >
        <capsuleGeometry args={[radius, CHAR_HEIGHT_M - 2 * radius]} />
        {/* Invisible material: skipped by the renderer but still raycast. */}
        <meshBasicMaterial visible={false} />
      </mesh>
      {(overAvatar || overBell) && (
        <Html center position={[0, TAG_HEIGHT_M, 0]} zIndexRange={[1, 0]}>
          <div
            className="player-ping-bell"
            onPointerEnter={() => setOverBell(true)}
            onPointerLeave={() => setOverBell(false)}
          >
            <PingBellButton name={name} onPing={() => onPing(playerId)} />
          </div>
        </Html>
      )}
    </>
  );
}
