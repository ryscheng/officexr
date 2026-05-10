import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { Sky } from '@react-three/drei';
import { useControls, button } from 'leva';
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
import { ProximityGlow } from './ProximityGlow.tsx';
import {
  FIXED_CAMERA_DEFAULTS,
  WORLD,
  type CameraMode,
} from './config.ts';
import {
  exportLevaConfig,
  resetLevaConfig,
  useLevaPersistence,
} from './levaPersistence.ts';

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
  const { store, actions, selfId, cameraMode, bot } = props;

  useLevaPersistence();

  // Bot mode buttons — replaces the standalone BotControlPanel.
  useControls('Bot', {
    Stay: button(() => bot.setMode('idle')),
    'Walk to me': button(() => bot.setMode('walk-to-local')),
    'Walk away': button(() => bot.setMode('walk-away')),
  });

  // Animation playback speed knobs. timeScale=1 plays the clip at its
  // authored speed; <1 slows down, >1 speeds up.
  const proximity = useControls('Proximity', {
    outerRadius: {
      value: 6,
      min: 1,
      max: 20,
      step: 0.1,
      label: 'outer radius (m)',
    },
    innerRadius: {
      value: 3,
      min: 0.5,
      max: 20,
      step: 0.1,
      label: 'inner radius (m)',
    },
    discRadius: {
      value: 1.6,
      min: 0.2,
      max: 5,
      step: 0.05,
      label: 'disc radius (m)',
    },
    pulseSpeed: {
      value: 0.8,
      min: 0.05,
      max: 4,
      step: 0.05,
      label: 'pulse (Hz)',
    },
    intensity: { value: 1.0, min: 0, max: 3, step: 0.05 },
    color: '#ffd24a',
  });

  const animation = useControls('Animation', {
    idleSpeed: { value: 1, min: 0.1, max: 3, step: 0.05 },
    walkSpeed: { value: 1, min: 0.1, max: 10, step: 0.05 },
    turnSpeed: {
      value: 16,
      min: 1,
      max: 60,
      step: 0.5,
      label: 'turn speed (rad/s)',
    },
    playerSpeed: {
      value: 3,
      min: 0.5,
      max: 15,
      step: 0.1,
      label: 'walk speed (m/s)',
    },
    movementBlockThreshold: {
      value: 0.9,
      min: 0,
      max: 1,
      step: 0.01,
      label: 'block threshold',
    },
  });

  // Mirror the Animation panel into world state so peers (e.g. the bot)
  // observe the same movement & animation parameters via their own stores.
  useEffect(() => {
    actions.setWorldSettings({
      playerSpeed: animation.playerSpeed,
      walkAnimSpeed: animation.walkSpeed,
      idleAnimSpeed: animation.idleSpeed,
      turnSpeed: animation.turnSpeed,
      movementBlockThreshold: animation.movementBlockThreshold,
    });
  }, [
    actions,
    animation.playerSpeed,
    animation.walkSpeed,
    animation.idleSpeed,
    animation.turnSpeed,
    animation.movementBlockThreshold,
  ]);

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
      pitchDeg: {
        value: FIXED_CAMERA_DEFAULTS.pitchDeg,
        min: -89,
        max: 89,
        step: 0.5,
        label: 'pitch (°)',
      },
      height: {
        value: FIXED_CAMERA_DEFAULTS.height,
        min: 0,
        max: 200,
        step: 0.5,
        label: 'height (Y)',
      },
      maxOnScreenFrac: {
        value: FIXED_CAMERA_DEFAULTS.maxOnScreenFrac,
        min: 0.05,
        max: 0.6,
        step: 0.005,
        label: 'near (screen %)',
      },
      minOnScreenFrac: {
        value: FIXED_CAMERA_DEFAULTS.minOnScreenFrac,
        min: 0.01,
        max: 0.3,
        step: 0.005,
        label: 'far (screen %)',
      },
      lateralFrac: {
        value: FIXED_CAMERA_DEFAULTS.lateralFrac,
        min: 0,
        max: 1,
        step: 0.01,
        label: 'lateral (frac)',
      },
      fov: {
        value: FIXED_CAMERA_DEFAULTS.fov,
        min: 20,
        max: 110,
        step: 1,
      },
      movementYawOffsetDeg: {
        value: 0,
        min: -180,
        max: 180,
        step: 0.5,
        label: 'WASD offset (°)',
      },
    },
    { collapsed: false },
  );

  useControls('Settings', {
    'Export JSON': button(() => exportLevaConfig()),
    'Reset to defaults': button(() => resetLevaConfig()),
  });

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

  // Mirror the World floor size into the SDK's broadcast world map. The
  // map's gridSize feeds collision (map-edge clamp + cell partition); peers
  // receive `world:map` via SyncEngine and stay in sync.
  useEffect(() => {
    const current = store.getState().worldMap;
    if (current.gridSize === world.gridSize) return;
    actions.setWorldMap({ ...current, gridSize: world.gridSize });
  }, [actions, store, world.gridSize]);

  // Refs shared between movement code and the camera rig.
  const yawRef = useRef(0);
  const pitchRef = useRef(-0.25);
  const selfPosRef = useRef(new THREE.Vector3());

  const fixedCam = useMemo(
    () => ({
      azimuthDeg: fixed.azimuthDeg,
      pitchDeg: fixed.pitchDeg,
      height: fixed.height,
      maxOnScreenFrac: fixed.maxOnScreenFrac,
      minOnScreenFrac: fixed.minOnScreenFrac,
      lateralFrac: fixed.lateralFrac,
      fov: fixed.fov,
    }),
    [
      fixed.azimuthDeg,
      fixed.pitchDeg,
      fixed.height,
      fixed.maxOnScreenFrac,
      fixed.minOnScreenFrac,
      fixed.lateralFrac,
      fixed.fov,
    ],
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
          bus={props.bus}
          selfId={selfId}
          cameraMode={cameraMode}
          selfPosRef={selfPosRef}
        />

        <ProximityGlow
          store={store}
          outerRadius={proximity.outerRadius}
          innerRadius={proximity.innerRadius}
          discRadius={proximity.discRadius}
          pulseSpeed={proximity.pulseSpeed}
          intensity={proximity.intensity}
          color={proximity.color}
        />

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
          fixedMovementYawOffsetDeg={fixed.movementYawOffsetDeg}
          yawRef={yawRef}
        />
      </Suspense>
    </Canvas>
  );
}


