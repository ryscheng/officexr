import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { Sphere } from '@react-three/drei';
import { Physics, type RapierRigidBody } from '@react-three/rapier';
import { GradientBackground } from './GradientBackground.tsx';
import { FloorColliders } from './FloorColliders.tsx';
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
import type { BotMode } from '../bot/BotDriver.ts';
import { Floor } from './Floor.tsx';
import { Players } from './Players.tsx';
import { CameraRig } from './CameraRig.tsx';
import { SceneFrame } from './SceneFrame.tsx';
import { ProximityGlow } from './ProximityGlow.tsx';
import {
  CUBE_SIZE,
  FIXED_CAMERA_DEFAULTS,
  WORLD,
  type CameraMode,
} from './config.ts';
import {
  exportLevaConfig,
  resetLevaConfig,
  useLevaPersistence,
} from './levaPersistence.ts';

/**
 * Each frame, anchor the sun (directional light + its target + the
 * visible emissive sphere) to the local player's render position
 * plus the user-set sun offset. The sun's *direction* (offset from
 * player) stays constant — it's only translated — so it still reads
 * as the same sun in the sky regardless of where the player walks.
 *
 * This is the load-bearing piece for "shadows that stay sharp on big
 * maps": the directional light's orthographic shadow camera now
 * covers a fixed `shadowRange` around the player, so shadow-map
 * texels stay small (sharp shadows) even when `gridSize` is huge.
 */
function SunFollower(props: {
  lightRef: React.RefObject<THREE.DirectionalLight | null>;
  lightTargetRef: React.RefObject<THREE.Object3D | null>;
  sunDiscRef: React.RefObject<THREE.Object3D | null>;
  sunOffset: [number, number, number];
  selfPosRef: React.RefObject<THREE.Vector3>;
}) {
  useFrame(() => {
    const player = props.selfPosRef.current;
    if (!player) return;
    const [ox, oy, oz] = props.sunOffset;
    const light = props.lightRef.current;
    const target = props.lightTargetRef.current;
    if (light && target) {
      // Bind the movable target to the light (idempotent — three.js
      // reads `light.target.matrixWorld` for the view direction).
      if (light.target !== target) light.target = target;
      light.position.set(player.x + ox, player.y + oy, player.z + oz);
      target.position.copy(player);
      target.updateMatrixWorld();
    }
    if (props.sunDiscRef.current) {
      props.sunDiscRef.current.position.set(
        player.x + ox,
        player.y + oy,
        player.z + oz,
      );
    }
  });
  return null;
}

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
  /** Page-level handler for the Leva bot-count control. The page
   * decides whether to apply the count to the in-browser pool or
   * promote to Supabase mode and forward to the Node CLI. */
  onBotCountChange: (count: number) => void;
  /** Page-level handler for the Leva bot-mode buttons. Mirrors
   * `onBotCountChange` so mode toggles propagate to whichever pool
   * (in-browser or CLI) is currently authoritative. */
  onBotModeChange: (mode: BotMode) => void;
}

export function Scene(props: SceneProps) {
  const { store, actions, selfId, cameraMode, onBotCountChange, onBotModeChange } = props;

  useLevaPersistence();

  // Bot pool — `count` slider grows / shrinks the live BotPool; mode
  // buttons fan out to every bot (and become the default for newly-spawned
  // bots until another mode is chosen). The page intercepts both via the
  // `onBotCountChange` / `onBotModeChange` props because count >= 2 may
  // require flipping the realtime backend.
  const botCfg = useControls('Bot', {
    count: {
      value: 1,
      min: 0,
      max: 10,
      step: 1,
      label: 'count',
    },
    Stay: button(() => onBotModeChange('idle')),
    'Walk to me': button(() => onBotModeChange('walk-to-local')),
    'Walk away': button(() => onBotModeChange('walk-away')),
    Wander: button(() => onBotModeChange('wander')),
    Patrol: button(() => onBotModeChange('patrol')),
    Orbit: button(() => onBotModeChange('orbit')),
  });

  useEffect(() => {
    onBotCountChange(botCfg.count);
  }, [onBotCountChange, botCfg.count]);

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
    enterDebounceMs: {
      value: 500,
      min: 0,
      max: 2000,
      step: 10,
      label: 'enter delay (ms)',
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
    meetingBorderInset: {
      value: 0.05,
      min: 0,
      max: 2,
      step: 0.01,
      label: 'border inset (m)',
    },
    meetingBorderOutset: {
      value: 0.05,
      min: 0,
      max: 2,
      step: 0.01,
      label: 'border outset (m)',
    },
    sparkleSpeed: {
      value: 1.5,
      min: 0,
      max: 8,
      step: 0.1,
      label: 'bubble rise speed',
    },
    sparkleFloatHeight: {
      value: 1.5,
      min: 0.1,
      max: 6,
      step: 0.1,
      label: 'bubble rise height (m)',
    },
    conversationDistance: {
      value: 7,
      min: 2,
      max: 30,
      step: 0.25,
      label: 'convo cam dist (m)',
    },
    conversationHeight: {
      value: 5,
      min: 1,
      max: 30,
      step: 0.25,
      label: 'convo cam height (m)',
    },
    sparkleSize: {
      value: 1,
      min: 0.2,
      max: 10,
      step: 0.1,
      label: 'sparkle size ×',
    },
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

  // Sun-like directional light. `sunPosition`, `sunIntensity` and
  // `ambientIntensity` mirror into broadcast worldSettings so peers see
  // the same time-of-day. The remaining knobs (colour, shadow params)
  // are purely visual — kept local to this Leva panel so a designer
  // can tune without pushing them onto every peer.
  const lighting = useControls('Lighting', {
    sunPosition: { value: [20, 40, 20], label: 'sun position' },
    sunColor: { value: '#ffffff', label: 'sun colour' },
    sunIntensity: { value: 1.4, min: 0, max: 3, step: 0.05, label: 'sun intensity' },
    ambientIntensity: { value: 0.15, min: 0, max: 1, step: 0.01, label: 'ambient fill' },
    castShadow: { value: true, label: 'cast shadow' },
    /** Half-size (m) of the shadow camera frustum, centred on the
     * local player. The shadow camera follows the player so this is
     * an upper bound on how far from the player we render shadows —
     * regardless of how big the map is. Auto-clamped to the floor's
     * half-diagonal so small floors don't waste shadow-map texels on
     * empty space. Bigger value = shadows visible further away, but
     * each shadow-map texel covers more world units (blockier). */
    shadowRange: {
      value: 40,
      min: 5,
      max: 200,
      step: 1,
      label: 'shadow range (m)',
    },
    shadowMapSize: {
      value: 2048,
      options: { '512': 512, '1024': 1024, '2048': 2048, '4096': 4096 },
      label: 'shadow res',
    },
    shadowBias: {
      value: -0.0005,
      min: -0.002,
      max: 0.002,
      step: 0.0001,
      label: 'shadow bias',
    },
    shadowNormalBias: {
      value: 0.02,
      min: 0,
      max: 0.1,
      step: 0.001,
      label: 'shadow nbias',
    },
    // Optional secondary light co-located with the directional sun, to
    // fake the look of a visible "star" — a localised hotspot or radial
    // glow on top of the real (parallel-ray) sunlight. The directional
    // light is always emitted; this just adds extra illumination near
    // the sun's position. Defaults to `none` so it stays opt-in.
    auxLightType: {
      value: 'none' as 'none' | 'spot' | 'point',
      options: ['none', 'spot', 'point'] as const,
      label: 'aux light',
    },
    auxIntensity: { value: 1, min: 0, max: 10, step: 0.1, label: 'aux intensity' },
    /** Spot/point falloff distance (0 = infinite range). */
    auxDistance: { value: 0, min: 0, max: 500, step: 5, label: 'aux distance' },
    /** Spot light cone half-angle (radians). */
    auxAngle: { value: Math.PI / 6, min: 0.1, max: Math.PI / 2, step: 0.01, label: 'spot angle' },
    /** Spot light edge softness. */
    auxPenumbra: { value: 0.2, min: 0, max: 1, step: 0.01, label: 'spot penumbra' },
    /** Distance falloff exponent (physical = 2). */
    auxDecay: { value: 2, min: 0, max: 4, step: 0.1, label: 'falloff decay' },
    /** Visible "sun" — an emissive sphere placed at sunPosition so
     * the user sees a star/disc in the sky aligned with the shadow
     * direction. Renders as a self-lit sphere via emissive material
     * so it stays bright regardless of how much ambient or sun light
     * hits it. */
    showSunDisc: { value: true, label: 'sun disc' },
    sunDiscRadius: { value: 3, min: 0.2, max: 30, step: 0.1, label: 'disc radius' },
    sunDiscIntensity: { value: 2, min: 0, max: 10, step: 0.1, label: 'disc glow' },
  });

  // Background gradient. Renders behind everything via a giant inverted
  // sphere with a vertex-interpolated colour gradient — Leva controls
  // the top / bottom colours so we can go from a daylit sky to deep
  // space without code changes. Local-only; not broadcast.
  const background = useControls('Background', {
    topColor: { value: '#02030a', label: 'top colour' },
    bottomColor: { value: '#1a1238', label: 'bottom colour' },
  });

  // Mirror Animation + Proximity + Lighting panels into world state so
  // peers (e.g. the bot) observe the same parameters via their own
  // stores. Both proximity radii are broadcast — the inner cylinder
  // fires entered/exiting (steady glow + voice ON); the outer cylinder
  // fires entering/exited (pulsing glow + voice OFF). Lighting fields
  // live in WorldSettings too so every connected client renders the
  // same time-of-day.
  useEffect(() => {
    const [sx, sy, sz] = lighting.sunPosition;
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
      proximityEnterDebounceMs: proximity.enterDebounceMs,
      conversationCameraDistance: proximity.conversationDistance,
      conversationCameraHeight: proximity.conversationHeight,
      sunPositionX: sx,
      sunPositionY: sy,
      sunPositionZ: sz,
      sunIntensity: lighting.sunIntensity,
      ambientIntensity: lighting.ambientIntensity,
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
    proximity.enterDebounceMs,
    proximity.conversationDistance,
    proximity.conversationHeight,
    lighting.sunPosition,
    lighting.sunIntensity,
    lighting.ambientIntensity,
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

  // After Scene mounts (and the Leva-driven useEffects above have flushed
  // their initial values into the store), force-broadcast the current
  // world state. The regular `onStoreChange` diff path only fires when
  // values *change* — without this, a bot spawned with default world
  // settings would never receive the canonical values if the user's
  // Leva config happens to match the SDK defaults. Fires once per
  // channel-stack swap via the `sync` dependency.
  useEffect(() => {
    props.sync.broadcastWorldState();
  }, [props.sync]);

  // Refs shared between movement code and the camera rig.
  const yawRef = useRef(0);
  const pitchRef = useRef(-0.25);
  const selfPosRef = useRef(new THREE.Vector3());

  // Refs the SunFollower drives each frame so the directional light
  // (and its visible sun disc) tracks the local player.
  const sunLightRef = useRef<THREE.DirectionalLight | null>(null);
  const sunLightTargetRef = useRef<THREE.Object3D | null>(null);
  const sunDiscRef = useRef<THREE.Object3D | null>(null);

  // Set by `Players` when the self avatar's `RigidBody` mounts; SceneFrame
  // reads it each frame to drive the `KinematicCharacterController`.
  const selfBodyRef = useRef<RapierRigidBody | null>(null);

  // Updated each frame by `ProximityGlow`'s tracker: the local player's
  // current MeetingArea centroid (lifted to local-player y), or `null`
  // when not in a conversation. `CameraRig` reads it to drive the
  // damped conversation-view blend.
  const conversationFocusRef = useRef<
    { x: number; y: number; z: number } | null
  >(null);

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

  // Orthographic shadow camera. We deliberately do NOT size this to
  // the whole floor any more — for very large maps that would either
  // (a) require an enormous shadow map to keep texels small, or (b)
  // produce blocky shadows because each texel covers metres of world
  // space. Instead the shadow camera follows the local player (see
  // `SunFollower` below) and covers a fixed-ish `shadowRange` half-
  // width around them; anything farther than that doesn't render
  // shadows.
  //
  // The clamp to the floor's half-diagonal handles tiny floors so we
  // don't waste shadow-map texels on empty space outside the map.
  //
  // The `far` plane still needs to span from the sun to the far edge
  // of the shadow region, hence `|sunPos| + radius + margin` — too
  // small and floor near the player falls behind the shadow camera.
  const shadowCam = useMemo(() => {
    const [sx, sy, sz] = lighting.sunPosition;
    const halfExtent = (world.gridSize * CUBE_SIZE) / 2;
    const floorDiagHalf = halfExtent * Math.SQRT2 + 5;
    const radius = Math.min(lighting.shadowRange, floorDiagHalf);
    const sunMag = Math.hypot(sx, sy, sz);
    const far = sunMag + radius + 20;
    return { radius, far };
  }, [lighting.sunPosition, lighting.shadowRange, world.gridSize]);

  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      camera={{ position: [0, 1.6, 0], fov: 75, near: 0.1, far: 2000 }}
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      <Suspense fallback={null}>
        {/*
          <Physics> wraps everything that needs Rapier — characters,
          floor walls, the per-frame movement loop. Gravity is zero
          because our characters are kinematic and never fall.
          `timeStep="vary"` lets Rapier sub-step at the real frame
          delta; characters are kinematic anyway so determinism isn't
          critical here.
        */}
        <Physics gravity={[0, 0, 0]} timeStep="vary">
        <FloorColliders gridSize={world.gridSize} />
        {/* Sun-like single light source. The Leva `sunPosition` drives
            both the shadow-casting directional light and the visible
            sun disc in the sky so they stay aligned.

            For fill we use `hemisphereLight` instead of `ambientLight`:
            a flat ambient washed every surface identically and made
            each beveled cube top read with the same intensity as its
            sides, which (combined with the directional sun's hard
            shadows on the bevels) drew a visible grid line between
            cubes. The hemisphere light fills sky-tinted from above and
            ground-tinted from below, which matches the directional sun
            naturally and lets cube tops dominate while bevel sides
            stay subtly darker — the surface reads as one cohesive
            floor instead of a checkerboard of tiles. The Leva
            `ambient fill` control drives its intensity. */}
        <hemisphereLight
          args={['#aedcff', '#3a2f24', lighting.ambientIntensity]}
        />
        {/* The sun: always emitted. Parallel rays + orthographic shadow
            camera. The shadow camera follows the local player via
            `SunFollower` below (its `target` and the light's
            `position` are mutated each frame) so its frustum stays
            tight around whoever is moving — that's how shadow-map
            texels stay small (and shadows stay sharp) on big maps
            without exploding shadow-map memory. */}
        <directionalLight
          ref={sunLightRef}
          position={lighting.sunPosition}
          color={lighting.sunColor}
          intensity={lighting.sunIntensity}
          castShadow={lighting.castShadow}
          shadow-mapSize-width={lighting.shadowMapSize}
          shadow-mapSize-height={lighting.shadowMapSize}
          shadow-camera-near={1}
          shadow-camera-far={shadowCam.far}
          shadow-camera-left={-shadowCam.radius}
          shadow-camera-right={shadowCam.radius}
          shadow-camera-top={shadowCam.radius}
          shadow-camera-bottom={-shadowCam.radius}
          shadow-bias={lighting.shadowBias}
          shadow-normalBias={lighting.shadowNormalBias}
        />
        {/* Movable target the directionalLight points at — also moved
            each frame by SunFollower so the light's view direction
            stays constant relative to the player. Three.js needs the
            target's matrixWorld to be up to date; updateMatrixWorld
            is called inside the follower. */}
        <object3D ref={sunLightTargetRef} />
        {/* Visible sun disc — an emissive sphere placed at the same
            position as the directional light, so you actually see a
            star where the shadows are coming from. Renders bright
            regardless of lighting via emissive. */}
        {lighting.showSunDisc && (
          <Sphere
            ref={sunDiscRef as unknown as React.Ref<THREE.Mesh>}
            args={[lighting.sunDiscRadius, 32, 16]}
            position={lighting.sunPosition}
          >
            <meshStandardMaterial
              color={lighting.sunColor}
              emissive={lighting.sunColor}
              emissiveIntensity={lighting.sunDiscIntensity}
              toneMapped={false}
            />
          </Sphere>
        )}
        <SunFollower
          lightRef={sunLightRef}
          lightTargetRef={sunLightTargetRef}
          sunDiscRef={sunDiscRef}
          sunOffset={lighting.sunPosition as [number, number, number]}
          selfPosRef={selfPosRef}
        />
        {/* Optional secondary light co-located with the sun, to fake
            the look of a visible "star" radiating from the sun's
            position. The directional light above already does the
            global parallel-ray lighting; this adds a localised
            hotspot. Shadow casting is deliberately off here — only
            the directional drives shadows so we don't double-up
            shadow passes (the secondary's shadows would be subtly
            offset and produce visible doubling). */}
        {lighting.auxLightType === 'spot' && (
          <spotLight
            position={lighting.sunPosition}
            color={lighting.sunColor}
            intensity={lighting.auxIntensity}
            distance={lighting.auxDistance}
            angle={lighting.auxAngle}
            penumbra={lighting.auxPenumbra}
            decay={lighting.auxDecay}
          />
        )}
        {lighting.auxLightType === 'point' && (
          <pointLight
            position={lighting.sunPosition}
            color={lighting.sunColor}
            intensity={lighting.auxIntensity}
            distance={lighting.auxDistance}
            decay={lighting.auxDecay}
          />
        )}
        <GradientBackground
          topColor={background.topColor}
          bottomColor={background.bottomColor}
        />

        <Floor gridSize={world.gridSize} stoneLayers={world.stoneLayers} />

        <Players
          store={store}
          bus={props.bus}
          selfId={selfId}
          cameraMode={cameraMode}
          selfPosRef={selfPosRef}
          selfBodyRef={selfBodyRef}
        />

        <ProximityGlow
          store={store}
          bus={props.bus}
          selfId={selfId}
          discRadius={proximity.discRadius}
          outerRadius={proximity.outerRadius}
          pulseSpeed={proximity.pulseSpeed}
          intensity={proximity.intensity}
          enteringColor={proximity.enteringColor}
          enteredColor={proximity.enteredColor}
          exitingColor={proximity.exitingColor}
          meetingBorderInset={proximity.meetingBorderInset}
          meetingBorderOutset={proximity.meetingBorderOutset}
          sparkleSpeed={proximity.sparkleSpeed}
          sparkleFloatHeight={proximity.sparkleFloatHeight}
          sparkleSize={proximity.sparkleSize}
          cameraMode={cameraMode}
          conversationFocusRef={conversationFocusRef}
        />

        <CameraRig
          mode={cameraMode}
          playerPosRef={selfPosRef}
          yawRef={yawRef}
          pitchRef={pitchRef}
          conversationFocusRef={conversationFocusRef}
          conversationDistance={proximity.conversationDistance}
          conversationHeight={proximity.conversationHeight}
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
          selfBodyRef={selfBodyRef}
        />
        </Physics>
      </Suspense>
    </Canvas>
  );
}


