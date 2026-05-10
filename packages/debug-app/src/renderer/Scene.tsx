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
import type { BotPool } from '../bot/BotPool.ts';
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
  bots: BotPool;
  selfId: string;
  cameraMode: CameraMode;
}

export function Scene(props: SceneProps) {
  const { store, actions, selfId, cameraMode, bots } = props;

  useLevaPersistence();

  // Bot pool — `count` slider grows / shrinks the live BotPool; mode
  // buttons fan out to every bot (and become the default for newly-spawned
  // bots until another mode is chosen).
  const botCfg = useControls('Bot', {
    count: {
      value: 1,
      min: 0,
      max: 10,
      step: 1,
      label: 'count',
    },
    Stay: button(() => bots.setMode('idle')),
    'Walk to me': button(() => bots.setMode('walk-to-local')),
    'Walk away': button(() => bots.setMode('walk-away')),
    Wander: button(() => bots.setMode('wander')),
    Patrol: button(() => bots.setMode('patrol')),
    Orbit: button(() => bots.setMode('orbit')),
  });

  useEffect(() => {
    void bots.setCount(botCfg.count);
  }, [bots, botCfg.count]);

  // Animation playback speed knobs. timeScale=1 plays the clip at its
  // authored speed; <1 slows down, >1 speeds up.
  const proximity = useControls('Proximity', {
    sensorRadius: {
      value: 3,
      min: 0.5,
      max: 20,
      step: 0.1,
      label: 'inner radius (m)',
    },
    outerRadius: {
      value: 6,
      min: 1,
      max: 30,
      step: 0.1,
      label: 'outer radius (m)',
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
    enteringColor: { value: '#ffd24a', label: 'entering colour' },
    enteredColor: { value: '#7be67b', label: 'entered colour' },
    exitingColor: { value: '#ff8c42', label: 'exiting colour' },
  });

  const animation = useControls('Animation', {
    idleSpeed: { value: 1, min: 0.1, max: 3, step: 0.05 },
    walkSpeed: { value: 1, min: 0.1, max: 10, step: 0.05 },
    runSpeed: {
      value: 1,
      min: 0.1,
      max: 10,
      step: 0.05,
      label: 'run anim speed',
    },
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
    runMultiplier: {
      value: 2,
      min: 1,
      max: 6,
      step: 0.1,
      label: 'run × walk',
    },
    movementBlockThreshold: {
      value: 0.9,
      min: 0,
      max: 1,
      step: 0.01,
      label: 'block threshold',
    },
  });

  // Mirror the Animation + Proximity panels into world state so peers
  // (e.g. the bot) observe the same movement, animation, and proximity
  // parameters via their own stores. Both proximity radii are broadcast —
  // the inner cylinder fires entered/exiting (steady glow + voice ON);
  // the outer cylinder fires entering/exited (pulsing glow + voice OFF).
  useEffect(() => {
    actions.setWorldSettings({
      playerSpeed: animation.playerSpeed,
      runSpeedMultiplier: animation.runMultiplier,
      walkAnimSpeed: animation.walkSpeed,
      runAnimSpeed: animation.runSpeed,
      idleAnimSpeed: animation.idleSpeed,
      turnSpeed: animation.turnSpeed,
      movementBlockThreshold: animation.movementBlockThreshold,
      proximityRadius: proximity.sensorRadius,
      proximityOuterRadius: proximity.outerRadius,
    });
  }, [
    actions,
    animation.playerSpeed,
    animation.runMultiplier,
    animation.walkSpeed,
    animation.runSpeed,
    animation.idleSpeed,
    animation.turnSpeed,
    animation.movementBlockThreshold,
    proximity.sensorRadius,
    proximity.outerRadius,
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
          bus={props.bus}
          selfId={selfId}
          discRadius={proximity.discRadius}
          pulseSpeed={proximity.pulseSpeed}
          intensity={proximity.intensity}
          enteringColor={proximity.enteringColor}
          enteredColor={proximity.enteredColor}
          exitingColor={proximity.exitingColor}
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
          bots={props.bots}
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


