import { memo } from 'react';
import { Html } from '@react-three/drei';
import type { Bus, PlayerId, Store } from '@officexr/sdk';
import type { CameraMode } from './config.ts';
import { overheadAnchorY, useCharacterHeight } from './characterHeight.ts';
import { PlayerBubbles } from './PlayerBubbles.tsx';
import { PlayerNameTag, usePlayerName } from './PlayerNameTag.tsx';
import { PingHoverTarget, PlayerPingBell, shouldShowPingBell, usePingBellHover } from './PlayerPingBell.tsx';
import './PlayerNameTag.css';

/**
 * Everything that floats over a player's head, in one stack whose bottom edge sits just above the
 * top of the model: bubbles, then the ping bell, then the name tag. Must be a child of the
 * per-player group so it follows the character.
 */
export const PlayerOverhead = memo(function PlayerOverhead(props: {
  store: Store;
  bus: Bus;
  playerId: PlayerId;
  modelUrl: string;
  isSelf: boolean;
  paused: boolean;
  cameraMode: CameraMode;
  charRadius: number;
  onPing?: (id: PlayerId) => void;
}) {
  const { store, bus, playerId, modelUrl, isSelf, paused, cameraMode, charRadius, onPing } = props;
  const heightM = useCharacterHeight(modelUrl);
  const name = usePlayerName(store, playerId);
  const hover = usePingBellHover();
  const bellEnabled = shouldShowPingBell(onPing, isSelf, cameraMode, paused);
  return (
    <>
      {bellEnabled && <PingHoverTarget radius={charRadius} heightM={heightM} hover={hover} />}
      {/* ponytail: the stack shows through walls and keeps a constant size regardless of distance.
          Small zIndexRange keeps it beneath HUD panels. */}
      <Html position={[0, overheadAnchorY(heightM), 0]} zIndexRange={[1, 0]} pointerEvents="none">
        <div className="player-overhead" onPointerEnter={hover.onStackEnter} onPointerLeave={hover.onStackLeave}>
          <PlayerBubbles store={store} bus={bus} playerId={playerId} paused={paused} />
          {bellEnabled && hover.visible && onPing && <PlayerPingBell name={name} onPing={() => onPing(playerId)} />}
          <PlayerNameTag store={store} playerId={playerId} isSelf={isSelf} paused={paused} />
        </div>
      </Html>
    </>
  );
});
