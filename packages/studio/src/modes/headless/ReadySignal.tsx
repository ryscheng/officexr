import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';

// Enough for InstancedMesh.setMatrixAt to have run (mount, matrix update
// effect, next paint pass).
const FRAMES_BEFORE_READY = 3;

/**
 * Calls `onReady` once, after a few rendered frames. Mount it inside the
 * scene's Suspense boundary so it only counts once the assets have loaded.
 */
export function ReadySignal({ onReady }: { onReady: () => void }) {
  const frames = useRef(0);
  useFrame(() => {
    frames.current += 1;
    if (frames.current === FRAMES_BEFORE_READY) {
      onReady();
    }
  });
  return null;
}
