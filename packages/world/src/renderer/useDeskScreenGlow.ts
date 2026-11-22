import { useEffect, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ObjectInstance, Store } from '@officexr/sdk';
import {
  isChairOccupied,
  isScreenSettled,
  screenGlow,
  SCREEN_OFF,
  stepScreenPower,
  type DeskScreenLink,
  type ScreenPower,
} from '../app/desk-screens.ts';
import { useApplication } from '../react/application-context.tsx';
import { publishDeskScreens } from './deskScreenMarker.ts';
import { chooseScreenFace, type ScreenFace } from './screenFace.ts';

export interface DeskScreenDrive {
  store: Store;
  links: ReadonlyMap<string, DeskScreenLink>;
}

interface Driven {
  index: number;
  link: DeskScreenLink;
  power: ScreenPower;
}

// Writes each linked screen's glow into the mesh's instanceColor (y: glow, z: lit face id) as its chair fills and empties.
export function useDeskScreenGlow(
  meshRef: RefObject<THREE.InstancedMesh | null>,
  kindId: string,
  instances: ObjectInstance[],
  faces: readonly ScreenFace[] | null,
  drive: DeskScreenDrive | undefined,
  rebuildKey: unknown,
): void {
  const { geometry } = useApplication();
  const driven = useRef<Driven[]>([]);

  useEffect(() => {
    const mesh = meshRef.current;
    driven.current = [];
    if (!mesh || !faces || !drive) return;
    const colours = new Float32Array(mesh.instanceMatrix.count * 3).fill(1);
    for (let i = 0; i < colours.length; i += 3) colours[i + 1] = colours[i + 2] = 0;
    const list: Driven[] = [];
    instances.forEach((inst, index) => {
      const link = drive.links.get(inst.id);
      if (!link) return;
      const { rotationY } = geometry.meshTransform(inst.position, inst.kindId, inst.yawDeg);
      const face = chooseScreenFace(faces, rotationY, link.chair.x - link.monitor.x, link.chair.z - link.monitor.z);
      if (face === 0) return;
      colours[index * 3 + 2] = face;
      list.push({ index, link, power: SCREEN_OFF });
    });
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colours, 3);
    driven.current = list;
    const key = `${kindId}`;
    publishDeskScreens(
      key,
      list.map((d) => ({
        deskAreaId: d.link.deskAreaId,
        monitorInstanceId: d.link.monitorInstanceId,
        get on() {
          return d.power.on;
        },
        get glow() {
          return colours[d.index * 3 + 1];
        },
      })),
    );
    return () => publishDeskScreens(key, null);
  }, [meshRef, kindId, instances, faces, drive?.links, geometry, rebuildKey]);

  useFrame((_, dt) => {
    const mesh = meshRef.current;
    const colour = mesh?.instanceColor;
    if (!drive || !colour || driven.current.length === 0) return;
    const state = drive.store.getState();
    let dirty = false;
    for (const d of driven.current) {
      const occupied = isChairOccupied(state, d.link.seatId);
      if (isScreenSettled(d.power, occupied)) continue;
      d.power = stepScreenPower(d.power, occupied, dt);
      colour.array[d.index * 3 + 1] = screenGlow(d.power);
      dirty = true;
    }
    if (dirty) colour.needsUpdate = true;
  });
}
