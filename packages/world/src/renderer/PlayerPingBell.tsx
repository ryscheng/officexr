import { useState } from 'react';
import { Html } from '@react-three/drei';
import type { PlayerId, Store } from '@officexr/sdk';
import { PingBellButton } from '../react/PingBellButton.tsx';
import type { CameraMode } from './config.ts';
import { isYawPitchMode } from './lookControls.ts';
import { TAG_HEIGHT_M, usePlayerName } from './PlayerNameTag.tsx';

// Reaches past the name tag so the pointer can move from the avatar up to the bell without unhovering.
const HOVER_HEIGHT_M = TAG_HEIGHT_M + 0.15;

export const shouldShowPingBell = (
  onPing: ((id: PlayerId) => void) | undefined,
  isSelf: boolean,
  cameraMode: CameraMode,
  paused: boolean,
): boolean => onPing !== undefined && !isSelf && !paused && !isYawPitchMode(cameraMode);

/**
 * Invisible hover target around a player's body that shows a ping bell above
 * the name tag. Must be a child of the per-player group so it follows the character.
 */
export function PlayerPingBell(props: {
  store: Store;
  playerId: PlayerId;
  radius: number;
  onPing: (id: PlayerId) => void;
}) {
  const { store, playerId, radius, onPing } = props;
  const name = usePlayerName(store, playerId);
  // ponytail: hover-only, so touch users can't reach it; they ping from the participant list.
  const [overAvatar, setOverAvatar] = useState(false);
  // The bell sits outside the capsule, so moving onto it fires the capsule's pointerout.
  const [overBell, setOverBell] = useState(false);
  return (
    <>
      <mesh
        position={[0, HOVER_HEIGHT_M / 2, 0]}
        onPointerOver={(e) => {
          // Only the nearest of overlapping avatars shows its bell.
          e.stopPropagation();
          setOverAvatar(true);
        }}
        onPointerOut={() => setOverAvatar(false)}
      >
        <capsuleGeometry args={[radius, HOVER_HEIGHT_M - 2 * radius]} />
        {/* Invisible material: skipped by the renderer but still raycast. */}
        <meshBasicMaterial visible={false} />
      </mesh>
      {(overAvatar || overBell) && (
        <Html center position={[0, TAG_HEIGHT_M, 0]} zIndexRange={[1, 0]}>
          {/* A pixel offset, not a world one, keeps the bell just clear of the tag at any zoom. */}
          <div
            style={{ transform: 'translateY(-24px)' }}
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
