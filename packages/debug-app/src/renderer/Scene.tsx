import React, { Suspense, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { Sky } from '@react-three/drei';
import { useControls } from 'leva';
import { BUBBLE_RADIUS } from '@officexr/sdk';
import type {
  Actions,
  Bus,
  RuleRegistry,
  Store,
  SyncEngine,
  SnapshotHandshake,
} from '@officexr/sdk';
import type { BotDriver } from '../bot/BotDriver.ts';
import { Floor } from './Floor.tsx';
import { Players } from './Players.tsx';
import { CameraRig } from './CameraRig.tsx';
import { SceneFrame } from './SceneFrame.tsx';
import {
  FIXED_CAMERA_DEFAULTS,
  WORLD,
  type CameraMode,
} from './config.ts';

interface SceneProps {
  store: Store;
  actions: Actions;
  rules: RuleRegistry;
  bus: Bus;
  sync: SyncEngine;
  handshake: SnapshotHandshake;
  bot: BotDriver;
  selfId: string;
  cameraMode: CameraMode;
}

export function Scene(props: SceneProps) {
  const { store, selfId, cameraMode } = props;

  // Leva debug panel — fixed camera + world tweakables.
  const fixed = useControls(
    'Fixed camera',
    {
      azimuthDeg: {
        value: FIXED_CAMERA_DEFAULTS.azimuthDeg,
        min: 0,
        max: 360,
        step: 0.5,
        label: 'azimuth (°)',
      },
      elevationDeg: {
        value: FIXED_CAMERA_DEFAULTS.elevationDeg,
        min: 0,
        max: 89,
        step: 0.5,
        label: 'elevation (°)',
      },
      distance: {
        value: FIXED_CAMERA_DEFAULTS.distance,
        min: 5,
        max: 300,
        step: 1,
      },
      fov: {
        value: FIXED_CAMERA_DEFAULTS.fov,
        min: 20,
        max: 110,
        step: 1,
      },
    },
    { collapsed: false },
  );

  const world = useControls('World', {
    gridSize: {
      value: WORLD.gridSize,
      min: 4,
      max: 100,
      step: 2,
      label: 'floor size',
    },
    stoneLayers: { value: WORLD.stoneLayers, min: 0, max: 5, step: 1 },
  });

  // Refs shared between movement code and the camera rig.
  const yawRef = useRef(0);
  const pitchRef = useRef(-0.25);
  const selfPosRef = useRef(new THREE.Vector3());

  const fixedCam = useMemo(
    () => ({
      azimuthDeg: fixed.azimuthDeg,
      elevationDeg: fixed.elevationDeg,
      distance: fixed.distance,
      fov: fixed.fov,
    }),
    [fixed.azimuthDeg, fixed.elevationDeg, fixed.distance, fixed.fov],
  );

  return (
    <Canvas
      shadows
      camera={{ position: [0, 1.6, 0], fov: 75, near: 0.1, far: 2000 }}
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      <Suspense fallback={null}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[20, 40, 20]} intensity={0.9} castShadow />
        <Sky sunPosition={[20, 40, 20]} />

        <Floor gridSize={world.gridSize} stoneLayers={world.stoneLayers} />

        <Players
          store={store}
          selfId={selfId}
          cameraMode={cameraMode}
          selfPosRef={selfPosRef}
        />

        <ProximityBubble store={store} selfId={selfId} />

        <CameraRig
          mode={cameraMode}
          playerPosRef={selfPosRef}
          yawRef={yawRef}
          pitchRef={pitchRef}
          fixed={fixedCam}
        />

        <SceneFrame
          store={props.store}
          actions={props.actions}
          rules={props.rules}
          bus={props.bus}
          sync={props.sync}
          handshake={props.handshake}
          bot={props.bot}
          selfId={props.selfId}
          cameraMode={cameraMode}
          fixedAzimuthDeg={fixed.azimuthDeg}
          yawRef={yawRef}
        />
      </Suspense>
    </Canvas>
  );
}

/** Wireframe sphere centered on the local player showing proximity radius. */
function ProximityBubble({
  store,
  selfId,
}: {
  store: Store;
  selfId: string;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const self = store.getState().players[selfId];
    if (ref.current && self) {
      ref.current.position.set(self.pos.x, self.pos.y, self.pos.z);
    }
  });

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[BUBBLE_RADIUS, 16, 16]} />
      <meshBasicMaterial
        color={0x44aaff}
        wireframe
        transparent
        opacity={0.25}
      />
    </mesh>
  );
}

