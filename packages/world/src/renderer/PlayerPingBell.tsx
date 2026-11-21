import { useState } from 'react';
import type { PlayerId } from '@officexr/sdk';
import { PingBellButton } from '../react/PingBellButton.tsx';
import type { CameraMode } from './config.ts';
import { isYawPitchMode } from './lookControls.ts';
import { OVERHEAD_GAP_M } from './characterHeight.ts';

export const shouldShowPingBell = (
  onPing: ((id: PlayerId) => void) | undefined,
  isSelf: boolean,
  cameraMode: CameraMode,
  paused: boolean,
): boolean => onPing !== undefined && !isSelf && !paused && !isYawPitchMode(cameraMode);

export interface PingBellHover {
  visible: boolean;
  onAvatarOver: () => void;
  onAvatarOut: () => void;
  onStackEnter: () => void;
  onStackLeave: () => void;
}

/**
 * The bell shows while the pointer is over the avatar or over the overhead stack. The stack sits
 * outside the avatar's hover capsule, so moving onto it fires the capsule's pointerout.
 */
export function usePingBellHover(): PingBellHover {
  const [overAvatar, setOverAvatar] = useState(false);
  const [overStack, setOverStack] = useState(false);
  return {
    visible: overAvatar || overStack,
    onAvatarOver: () => setOverAvatar(true),
    onAvatarOut: () => setOverAvatar(false),
    onStackEnter: () => setOverStack(true),
    onStackLeave: () => setOverStack(false),
  };
}

/**
 * Invisible hover target around a player's body, up to the overhead stack. Must be a child of the
 * per-player group so it follows the character.
 */
export function PingHoverTarget(props: { radius: number; heightM: number; hover: PingBellHover }) {
  const { radius, heightM, hover } = props;
  const reach = heightM + OVERHEAD_GAP_M;
  return (
    <mesh
      position={[0, reach / 2, 0]}
      onPointerOver={(e) => {
        // Only the nearest of overlapping avatars shows its bell.
        e.stopPropagation();
        hover.onAvatarOver();
      }}
      onPointerOut={hover.onAvatarOut}
    >
      <capsuleGeometry args={[radius, reach - 2 * radius]} />
      {/* Invisible material: skipped by the renderer but still raycast. */}
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}

export function PlayerPingBell(props: { name: string; onPing: () => void }) {
  return (
    <div className="player-ping-bell">
      <PingBellButton name={props.name} onPing={props.onPing} />
    </div>
  );
}
