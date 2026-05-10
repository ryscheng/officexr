import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { Bus, OfficeState, PlayerId, Store } from '@officexr/sdk';
import { extrapolatePos } from './Players.tsx';

/**
 * One of the four proximity event states a peer can be in *from self's
 * point of view*. The visual glow's colour and pulse mode are derived
 * from this — `entered` is steady, the others pulse.
 *
 *   entering : peer crossed our outer cylinder INWARD, hasn't reached inner yet
 *   entered  : peer is inside our inner cylinder (talking range; voice on)
 *   exiting  : peer was inside our inner cylinder, has now stepped back out
 *              into the outer band (voice still on — hysteresis)
 */
type PairState = 'entering' | 'entered' | 'exiting';

interface ProximityGlowProps {
  store: Store;
  bus: Bus;
  selfId: PlayerId;
  /** Visual size of the disc on the ground. */
  discRadius: number;
  /** Pulses per second while pulsing. */
  pulseSpeed: number;
  /** Peak alpha at the bright phase of the pulse / steady. */
  intensity: number;
  /** CSS colour for the entering state (peer in outer band, no contact yet). */
  enteringColor: string;
  /** CSS colour for the entered state (peer inside inner; voice on). */
  enteredColor: string;
  /** CSS colour for the exiting state (peer left inner, still in outer; voice still on). */
  exitingColor: string;
}

/**
 * Procedural radial-gradient texture used as the glow disc's `map`.
 * Module-scoped so every instance shares one texture.
 */
const radialTexture = (() => {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
})();

interface DiscRegistration {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
}

/**
 * Pulsing disc on the ground beneath each player. Visibility, colour, and
 * pulse mode are all driven by the SDK's proximity events on the bus —
 * the renderer doesn't compute distance bands itself, so it stays in sync
 * with whatever the broadcast world settings are doing.
 *
 *   self's disc      uses the *strongest* state across all of self's pairs
 *                    (entered > exiting > entering).
 *   other peer X     uses self's pair state with X — proximity is symmetric
 *                    on the local view, so X's disc colour matches self's.
 *   anyone with no pair state currently → no glow.
 */
export function ProximityGlow({
  store,
  bus,
  selfId,
  discRadius,
  pulseSpeed,
  intensity,
  enteringColor,
  enteredColor,
  exitingColor,
}: ProximityGlowProps) {
  const initialIds = useMemo(
    () => Object.keys(store.getState().players),
    [store],
  );
  const [playerIds, setPlayerIds] = useState<string[]>(initialIds);

  useEffect(() => {
    return store.subscribeAll((next: OfficeState, prev: OfficeState) => {
      const a = Object.keys(next.players);
      const b = Object.keys(prev.players);
      if (a.length === b.length && a.every((id, i) => id === b[i])) return;
      setPlayerIds(a);
    });
  }, [store]);

  // Per-pair state for self — a peer enters this map on `entering` (or
  // `entered` if they crossed both cylinders in one frame) and is removed
  // on `exited`. State priority on overlapping events: entered ranks above
  // exiting, both rank above entering.
  const pairStates = useRef<Map<PlayerId, PairState>>(new Map());
  useEffect(() => {
    const offEntering = bus.on('proximity:entering', ({ otherId }) => {
      // Don't downgrade an already-entered pair back to 'entering'.
      if (pairStates.current.get(otherId) === 'entered') return;
      pairStates.current.set(otherId, 'entering');
    });
    const offEntered = bus.on('proximity:entered', ({ otherId }) => {
      pairStates.current.set(otherId, 'entered');
    });
    const offExiting = bus.on('proximity:exiting', ({ otherId }) => {
      pairStates.current.set(otherId, 'exiting');
    });
    const offExited = bus.on('proximity:exited', ({ otherId }) => {
      pairStates.current.delete(otherId);
    });
    return () => {
      offEntering();
      offEntered();
      offExiting();
      offExited();
    };
  }, [bus]);

  const registry = useRef<Map<string, DiscRegistration>>(new Map());
  const currentI = useRef<Map<string, number>>(new Map());
  const enteringC = useMemo(() => new THREE.Color(enteringColor), [enteringColor]);
  const enteredC = useMemo(() => new THREE.Color(enteredColor), [enteredColor]);
  const exitingC = useMemo(() => new THREE.Color(exitingColor), [exitingColor]);

  const register = useCallback(
    (id: string, entry: DiscRegistration | null) => {
      if (entry) registry.current.set(id, entry);
      else registry.current.delete(id);
    },
    [],
  );

  const tmpVec = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, dt) => {
    const t = state.clock.getElapsedTime();
    const now = performance.now();
    const pulse = 0.5 + 0.5 * Math.sin(t * pulseSpeed * Math.PI * 2);
    const players = store.getState().players;

    // Self's strongest current pair state.
    let selfState: PairState | null = null;
    for (const s of pairStates.current.values()) {
      if (s === 'entered') {
        selfState = 'entered';
        break;
      }
      if (s === 'exiting' && selfState !== 'entering') {
        selfState = 'exiting';
      } else if (s === 'entering' && selfState === null) {
        selfState = 'entering';
      }
    }

    for (const [id, p] of Object.entries(players)) {
      const reg = registry.current.get(id);
      if (!reg) continue;

      // Position the disc under the player's rendered (extrapolated) pos.
      const renderPos = extrapolatePos(p, now, tmpVec);
      reg.mesh.position.set(renderPos.x, p.pos.y + 0.02, renderPos.z);

      // Decide this disc's state.
      const discState: PairState | null =
        id === selfId ? selfState : (pairStates.current.get(id) ?? null);

      const isSteady = discState === 'entered';
      const isPulsing = discState === 'entering' || discState === 'exiting';
      const target =
        isSteady ? intensity : isPulsing ? intensity * pulse : 0;
      const prev = currentI.current.get(id) ?? 0;
      const next = prev + (target - prev) * Math.min(1, 6 * dt);
      currentI.current.set(id, next);
      reg.material.opacity = next;

      const targetColor =
        discState === 'entered'
          ? enteredC
          : discState === 'exiting'
            ? exitingC
            : enteringC;
      reg.material.color.copy(targetColor);
    }
  });

  return (
    <>
      {playerIds.map((id) => (
        <GlowDisc
          key={id}
          id={id}
          radius={discRadius}
          register={register}
        />
      ))}
    </>
  );
}

interface GlowDiscProps {
  id: string;
  radius: number;
  register: (id: string, entry: DiscRegistration | null) => void;
}

function GlowDisc({ id, radius, register }: GlowDiscProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);

  useEffect(() => {
    if (meshRef.current && matRef.current) {
      register(id, { mesh: meshRef.current, material: matRef.current });
    }
    return () => register(id, null);
  }, [id, register]);

  return (
    <mesh
      ref={meshRef}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={2}
    >
      <circleGeometry args={[radius, 64]} />
      <meshBasicMaterial
        ref={matRef}
        map={radialTexture}
        color={0xffffff}
        transparent
        opacity={0}
        depthWrite={false}
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </mesh>
  );
}
