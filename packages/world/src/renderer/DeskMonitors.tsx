import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Store, WorldObjects } from '@officexr/sdk';
import { deskScreenPlacements, isScreenSettled, isSeatOccupied, screenGlow, SCREEN_OFF, stepScreenPower, type DeskScreenPlacement, type ScreenPower } from '../app/desk-screens.ts';
import { useApplication } from '../react/application-context.tsx';
import {
  createDesktopTexture,
  createMonitorBodyGeometry,
  createMonitorBodyMaterial,
  createMonitorScreenGeometry,
  createMonitorScreenMaterial,
  MONITOR_LOCAL_BOUNDS,
} from './deskMonitorModel.ts';
import { MonitorOccluder } from './occlusion/MonitorOccluder.ts';
import { useOccluderRegistry } from './occlusion/OccluderContext.tsx';

export interface DeskScreenMarker {
  screens: Array<{ deskAreaId: string; seatInstanceId: string; on: boolean; glow: number }>;
}

type MarkerWindow = { __OFFICE_DESK_SCREENS__?: DeskScreenMarker };

interface DeskMonitorsProps {
  store: Store;
  worldObjects: WorldObjects;
}

export function DeskMonitors({ store, worldObjects }: DeskMonitorsProps) {
  const { catalog, geometry } = useApplication();
  const deskAreas = useStoreDeskAreas(store);
  const placements = useMemo(
    () => deskScreenPlacements(deskAreas, worldObjects.instances, catalog, geometry),
    [deskAreas, worldObjects.instances, catalog, geometry],
  );
  const lit = useRef(new Map<string, boolean>());
  const materials = useRef(new Map<string, THREE.MeshStandardMaterial>());
  const publish = useRef(() => {});

  useEffect(() => {
    const win = globalThis as unknown as MarkerWindow;
    publish.current = () => {
      win.__OFFICE_DESK_SCREENS__ = {
        screens: placements.map((p) => ({
          deskAreaId: p.deskAreaId,
          seatInstanceId: p.seatInstanceId,
          on: lit.current.get(p.deskAreaId) ?? false,
          get glow() {
            return materials.current.get(p.deskAreaId)?.emissiveIntensity ?? 0;
          },
        })),
      };
    };
    publish.current();
    return () => {
      publish.current = () => {};
      delete win.__OFFICE_DESK_SCREENS__;
    };
  }, [placements]);

  const trackMaterial = useCallback((areaId: string, material: THREE.MeshStandardMaterial | null) => {
    if (material) materials.current.set(areaId, material);
    else materials.current.delete(areaId);
  }, []);

  const reportLit = (deskAreaId: string, on: boolean) => {
    lit.current.set(deskAreaId, on);
    publish.current();
  };

  const desktop = useMemo(createDesktopTexture, []);
  useEffect(() => () => desktop.dispose(), [desktop]);

  return (
    <>
      {placements.map((p) => (
        <DeskMonitor
          key={p.deskAreaId}
          placement={p}
          store={store}
          desktop={desktop}
          onLit={reportLit}
          onMaterial={trackMaterial}
        />
      ))}
    </>
  );
}

function useStoreDeskAreas(store: Store) {
  const [areas, setAreas] = React.useState(() => store.getState().deskAreas);
  useEffect(() => {
    setAreas(store.getState().deskAreas);
    return store.subscribe((s) => s.deskAreas, setAreas);
  }, [store]);
  return areas;
}

interface DeskMonitorProps {
  placement: DeskScreenPlacement;
  store: Store;
  desktop: THREE.Texture;
  onLit: (deskAreaId: string, on: boolean) => void;
  onMaterial: (deskAreaId: string, material: THREE.MeshStandardMaterial | null) => void;
}

function DeskMonitor({ placement, store, desktop, onLit, onMaterial }: DeskMonitorProps) {
  const registry = useOccluderRegistry();
  const bodyGeometry = useMemo(createMonitorBodyGeometry, []);
  const screenGeometry = useMemo(createMonitorScreenGeometry, []);
  const bodyMaterial = useMemo(createMonitorBodyMaterial, []);
  const screenMaterial = useMemo(() => createMonitorScreenMaterial(desktop), [desktop]);
  useEffect(
    () => () => {
      bodyGeometry.dispose();
      screenGeometry.dispose();
      bodyMaterial.dispose();
      screenMaterial.dispose();
    },
    [bodyGeometry, screenGeometry, bodyMaterial, screenMaterial],
  );

  useEffect(() => {
    onMaterial(placement.deskAreaId, screenMaterial);
    return () => onMaterial(placement.deskAreaId, null);
  }, [onMaterial, placement.deskAreaId, screenMaterial]);

  const rootRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>>(null);
  const screenRef = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>>(null);
  const power = useRef<ScreenPower>(SCREEN_OFF);

  useEffect(() => {
    const root = rootRef.current;
    const body = bodyRef.current;
    const screen = screenRef.current;
    if (!registry || !root || !body || !screen) return;
    return registry.addOccluder(new MonitorOccluder(root, MONITOR_LOCAL_BOUNDS, [body, screen]));
  }, [registry, placement]);

  useFrame((_, dt) => {
    const occupied = isSeatOccupied(store.getState(), placement.seatInstanceId);
    if (isScreenSettled(power.current, occupied)) return;
    const before = power.current.on;
    power.current = stepScreenPower(power.current, occupied, dt);
    screenMaterial.emissiveIntensity = screenGlow(power.current);
    if (power.current.on !== before) onLit(placement.deskAreaId, power.current.on);
  });

  const [x, y, z] = placement.position;
  return (
    <group ref={rootRef} position={[x, y, z]} rotation={[0, placement.yawRad, 0]}>
      <mesh ref={bodyRef} geometry={bodyGeometry} material={bodyMaterial} castShadow receiveShadow />
      <mesh ref={screenRef} geometry={screenGeometry} material={screenMaterial} />
    </group>
  );
}
