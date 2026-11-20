import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { PlayerId, Store } from '@officexr/sdk';
import './MissionMarker.css';

export type MissionMarkerTarget = { x: number; z: number; label: string };

const BEACON_HEIGHT_M = 6;
const FLOOR_Y_M = 1;
const COLOUR = '#0a84ff';

export const markerText = (label: string, metres: number | null) =>
  metres === null ? label : `${label} · ${metres < 1 ? '<1' : Math.floor(metres)} m`;

export function MissionMarker({ store, selfId, target }: { store: Store; selfId: PlayerId; target: MissionMarkerTarget }) {
  const text = useRef<HTMLSpanElement>(null);
  const shown = useRef('');
  useFrame(() => {
    const pos = store.getState().players[selfId]?.pos;
    const next = markerText(target.label, pos ? Math.hypot(pos.x - target.x, pos.z - target.z) : null);
    if (text.current && next !== shown.current) {
      shown.current = next;
      text.current.textContent = next;
    }
  });
  return (
    <group position={[target.x, FLOOR_Y_M, target.z]}>
      <mesh position={[0, BEACON_HEIGHT_M / 2, 0]} renderOrder={5}>
        <cylinderGeometry args={[0.35, 0.35, BEACON_HEIGHT_M, 24, 1, true]} />
        <meshBasicMaterial color={COLOUR} transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} renderOrder={5}>
        <ringGeometry args={[0.7, 0.9, 40]} />
        <meshBasicMaterial color={COLOUR} transparent opacity={0.8} depthWrite={false} />
      </mesh>
      <Html center position={[0, BEACON_HEIGHT_M + 0.4, 0]} zIndexRange={[10, 0]}>
        <div className="mission-marker" role="img" aria-label={target.label}>
          <span ref={text} />
        </div>
      </Html>
    </group>
  );
}
