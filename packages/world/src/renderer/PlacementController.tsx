import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import {
  isPlaceableKind,
  MAX_PLACED_PROPS,
  PLACEABLE_KINDS,
  propToInstance,
  rotateYaw,
  type PlacedProp,
  type Store,
} from '@officexr/sdk';
import { ObjectInstances, type MaterialOverride } from './ObjectInstances.tsx';
import { fitsClear, ghostSpot, PLACE_AHEAD_M, PLACE_ERROR_TEXT, pickPlaced, type PlacementHost } from '../motion/place-mode.ts';
import { feetPosition } from '../physics/rules.ts';
import { useApplication } from '../react/application-context.tsx';
import { isTypingTarget } from '../react/useWorldFocus.ts';

const GHOST_ID = '__ghost__';

const ghostOverride = (valid: boolean): MaterialOverride => (_kindId, base) => {
  const m = base.clone() as THREE.MeshStandardMaterial;
  m.transparent = true;
  m.opacity = 0.55;
  m.depthWrite = false;
  if (m.emissive) {
    m.emissive.set(valid ? '#2ee59d' : '#ff4d4d');
    m.emissiveIntensity = 0.7;
  }
  return m;
};

/** In place mode: a ghost of the chosen prop ahead of the player, and the keys that place, turn, grab and remove props. */
export function PlacementController({ store, host }: { store: Store; host: PlacementHost }) {
  const { geometry } = useApplication();
  const mode = useSyncExternalStore(host.mode.subscribe, host.mode.get);
  const placedRef = useRef<PlacedProp[]>([]);
  placedRef.current = useSyncExternalStore(
    (onChange) => store.subscribe((s) => s.placedProps, onChange),
    () => store.getState().placedProps,
  );

  useFrame(() => {
    const m = host.mode.get();
    if (!m.open) return;
    const state = store.getState();
    const self = state.players[state.selfId];
    if (!self) return;
    const feet = feetPosition(self.pos, state.worldSettings.charRadius);
    const position = ghostSpot(geometry, geometry.voxelSize, feet, self.yaw, m.kindId, m.yawDeg);
    const placed = placedRef.current;
    host.mode.setGhost({
      position,
      valid: placed.length < MAX_PLACED_PROPS && fitsClear(geometry, placed, m.kindId, position, m.yawDeg),
      targetId: pickPlaced(geometry, placed, {
        x: feet.x - Math.sin(self.yaw) * PLACE_AHEAD_M,
        z: feet.z - Math.cos(self.yaw) * PLACE_AHEAD_M,
      }),
    });
  });

  useEffect(() => {
    if (!mode.open) return;
    const run = async (op: Parameters<PlacementHost['send']>[0]) => {
      const result = await host.send(op);
      host.mode.setNotice(result.ok ? null : PLACE_ERROR_TEXT[result.error]);
    };
    const place = () => {
      const m = host.mode.get();
      if (m.ghost?.valid) void run({ op: 'place', kindId: m.kindId, position: m.ghost.position, yawDeg: m.yawDeg });
    };
    const target = () => {
      const id = host.mode.get().ghost?.targetId;
      return id ? placedRef.current.find((p) => p.id === id) : undefined;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      const handled = ['enter', 'r', 't', 'g', 'delete', 'backspace', 'tab'];
      if (!handled.includes(key)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      const t = target();
      if (key === 'enter') place();
      else if (key === 'r') host.mode.rotate();
      else if (key === 'tab') {
        const kinds = PLACEABLE_KINDS.map((k) => k.kindId);
        host.mode.selectKind(kinds[(kinds.indexOf(host.mode.get().kindId) + 1) % kinds.length]);
      } else if (!t) return;
      else if (key === 't') void run({ op: 'update', id: t.id, kindId: t.kindId, position: t.position, yawDeg: rotateYaw(t.yawDeg) });
      else if (key === 'g') {
        void run({ op: 'remove', id: t.id });
        if (isPlaceableKind(t.kindId)) {
          host.mode.selectKind(t.kindId);
          host.mode.setYaw(t.yawDeg);
        }
      } else void run({ op: 'remove', id: t.id });
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0 && document.pointerLockElement) place();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('mousedown', onMouseDown);
    };
  }, [mode.open, host]);

  const ghostWorld = useMemo(
    () =>
      mode.open && mode.ghost
        ? {
            cubeSize: geometry.voxelSize,
            instances: [propToInstance({ id: GHOST_ID, kindId: mode.kindId, position: mode.ghost.position, yawDeg: mode.yawDeg })],
          }
        : null,
    [mode.open, mode.ghost, mode.kindId, mode.yawDeg, geometry],
  );
  const override = useMemo(() => ghostOverride(mode.ghost?.valid ?? false), [mode.ghost?.valid]);
  const target = mode.open && mode.ghost?.targetId ? placedRef.current.find((p) => p.id === mode.ghost?.targetId) : undefined;
  const box = useMemo(() => {
    if (!target) return null;
    const { min, max } = geometry.worldAABBOfInstance(propToInstance(target));
    return { position: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] as const, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] as const };
  }, [target, geometry]);

  return (
    <>
      {ghostWorld && <ObjectInstances worldObjects={ghostWorld} materialOverride={override} />}
      {box && (
        <mesh position={box.position}>
          <boxGeometry args={[...box.size]} />
          <meshBasicMaterial color="#ffd23f" wireframe transparent opacity={0.9} depthTest={false} />
        </mesh>
      )}
    </>
  );
}
