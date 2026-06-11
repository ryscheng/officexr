import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { Physics, type RapierRigidBody } from '@react-three/rapier';
import { GradientBackground } from './GradientBackground.tsx';
import { LightingRig } from './LightingRig.tsx';
import { MapColliders } from './MapColliders.tsx';
import type {
  Actions,
  Bus,
  RuleRegistry,
  Store,
  SyncEngine,
  SnapshotHandshake,
  Vec3,
} from '@officexr/sdk';
import type { BotPool } from '../bot/BotPool.ts';
import { Players } from './Players.tsx';
import { CameraRig } from './CameraRig.tsx';
import { SceneFrame } from './SceneFrame.tsx';
import { ObjectInstances } from './ObjectInstances.tsx';
import { BakedLayout } from './BakedLayout.tsx';
import { BakedLayoutColliders } from './BakedLayoutColliders.tsx';
import { ProximityGlow } from './ProximityGlow.tsx';
import type { CameraMode } from './config.ts';
import type { ViewConfig } from './viewConfig.ts';

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
  /** Renderer-tweaker bag. Studio owns the React state for these
   * fields and renders the editing UI in its SidePanel; Scene reads
   * them here to drive the scene graph. Previously these values
   * came from 8 Leva hooks called inside Scene; the new flow is
   * fully controlled — see `packages/studio/src/panels/world/`
   * for the editor. */
  viewConfig: ViewConfig;
  /** When false, keyboard input is released from the in-world
   * character so the user can interact with the side panel without
   * accidentally walking. Studio's `useWorldFocus` hook tracks this
   * via mousedown / focusin against `[data-studio-panel]`. Default
   * true preserves the historical behaviour for any caller that
   * doesn't wire a focus tracker. */
  worldFocused?: boolean;
  /** Spawn points for the active map, in world coords. Forwarded
   * straight to `SceneFrame`'s fall-respawn rule. Empty/undefined
   * disables respawn (the player floats in the void instead). */
  spawnPoints?: readonly Vec3[];
  /**
   * URL of the pre-baked layout GLB to render as this room's structural
   * base, e.g. `/api/baked-layouts/lobby`.  Requires `bakedLayoutName`.
   */
  bakedLayoutPath?: string;
  /**
   * Registry key for the layout (used for cache-busting and collider sync).
   * Must match the `LayoutDocument.name` used when baking.
   * Required alongside `bakedLayoutPath` for the layout to render.
   */
  bakedLayoutName?: string;
  /** When true, every character rendered in this scene is frozen at
   * its bind pose (no animation mixer activity). Used by the Mugshot
   * mode to produce deterministic snapshot tests. */
  paused?: boolean;
  /** Penetration skin (metres) for the local player's kinematic
   * character controller. Defaults to gameplay's 0.01 (an anti-tunnel
   * gap). The Mugshot mode passes a near-zero value so the gravity-
   * settled character rests feet-flush on the cube top instead of
   * floating ~1 cm above it. Threaded straight to `SceneFrame`. */
  characterControllerOffset?: number;
  /** Forwarded to R3F `<Canvas dpr={...}>`. Default is R3F's (auto-
   * picks `devicePixelRatio`). Set to 1 in Mugshot mode so the
   * captured framebuffer matches the container's CSS pixel size
   * exactly — capture baselines are deterministic regardless of
   * the user's display DPI. */
  dpr?: number;
}

export function Scene(props: SceneProps) {
  const { store, selfId, cameraMode, sync, viewConfig } = props;
  const showLayout =
    Boolean(props.bakedLayoutPath) && Boolean(props.bakedLayoutName);
  const { proximity, lighting, background, fixedCamera } = viewConfig;
  const worldFocused = props.worldFocused ?? true;

  // After Scene mounts, force-broadcast the current world state.
  // The regular `onStoreChange` diff path only fires when values
  // *change* — without this, a bot spawned with default world
  // settings would never receive the canonical values if the
  // studio's persisted config happens to match the SDK defaults.
  // Fires once per channel-stack swap via the `sync` dependency.
  useEffect(() => {
    sync.broadcastWorldState();
  }, [sync]);

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

  // Mutated each frame by SceneFrame to true while the local player is
  // airborne. Players reads this ref (not React state) to drive the jump
  // animation for the self avatar without triggering re-renders.
  const isAirborneRef = useRef<boolean>(false);

  // Updated each frame by `ProximityGlow`'s tracker: the local player's
  // current MeetingArea centroid (lifted to local-player y), or `null`
  // when not in a conversation. `CameraRig` reads it to drive the
  // damped conversation-view blend.
  const conversationFocusRef = useRef<
    { x: number; y: number; z: number } | null
  >(null);

  const fixedCam = useMemo(
    () => ({
      azimuthDeg: fixedCamera.azimuthDeg,
      pitchDeg: fixedCamera.pitchDeg,
      height: fixedCamera.height,
      maxOnScreenFrac: fixedCamera.maxOnScreenFrac,
      minOnScreenFrac: fixedCamera.minOnScreenFrac,
      lateralFrac: fixedCamera.lateralFrac,
      fov: fixedCamera.fov,
      distanceM: fixedCamera.distanceM,
      lookAt: fixedCamera.lookAt,
    }),
    [
      fixedCamera.azimuthDeg,
      fixedCamera.pitchDeg,
      fixedCamera.height,
      fixedCamera.maxOnScreenFrac,
      fixedCamera.minOnScreenFrac,
      fixedCamera.lateralFrac,
      fixedCamera.fov,
      fixedCamera.distanceM,
      fixedCamera.lookAt,
    ],
  );

  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      camera={{ position: [0, 1.6, 0], fov: 75, near: 0.1, far: 2000 }}
      style={{ width: '100%', height: '100%', display: 'block' }}
      dpr={props.dpr}
      // `preserveDrawingBuffer: true` lets `canvas.toDataURL()` read
      // the actual rendered pixels — by default WebGL clears the
      // back buffer after compositing and `toDataURL` returns black.
      // The mugshot export depends on this being set; the small per-
      // frame perf cost is acceptable since the renderer's heaviest
      // consumers (Debug) don't use the export path.
      gl={{ preserveDrawingBuffer: true }}
    >
      <Suspense fallback={null}>
        {/*
          <Physics> wraps everything that needs Rapier — characters,
          map colliders, the per-frame movement loop. The gravity
          vector here drives DYNAMIC bodies; the local player is a
          kinematic body whose character controller integrates
          gravity manually in `SceneFrame` (Rapier doesn't auto-apply
          the world's gravity to kinematic bodies). The two values
          should stay in sync so any future dynamic body falls at
          the same rate the player does. `timeStep="vary"` lets
          Rapier sub-step at the real frame delta.
        */}
        <Physics gravity={[0, -20, 0]} timeStep="vary">
        <MapColliders store={store} />
        {showLayout && (
          <>
            <BakedLayout
              gltfPath={props.bakedLayoutPath!}
              layoutName={props.bakedLayoutName}
            />
            <BakedLayoutColliders
              gltfPath={props.bakedLayoutPath!}
              layoutName={props.bakedLayoutName}
            />
          </>
        )}
        {/* Lighting: shared LightingRig + a per-frame SunFollower
            that mutates the sun's position/target/disc to track the
            local player. The follower keeps the orthographic shadow
            camera tight around the player even on huge maps — that's
            how shadow-map texels stay small (sharp shadows) without
            exploding shadow-map memory. Editors mount LightingRig
            without the follower (sun stays static). */}
        <LightingRig
          lighting={lighting}
          sunLightRef={sunLightRef}
          sunLightTargetRef={sunLightTargetRef}
          sunDiscRef={sunDiscRef}
        />
        <SunFollower
          lightRef={sunLightRef}
          lightTargetRef={sunLightTargetRef}
          sunDiscRef={sunDiscRef}
          sunOffset={lighting.sunPosition as [number, number, number]}
          selfPosRef={selfPosRef}
        />
        <GradientBackground
          topColor={background.topColor}
          bottomColor={background.bottomColor}
        />

        {/* Per-map cubes — the ONLY visible world content. The Map
            Editor is the source of truth; the picker pushes a fresh
            WorldObjects snapshot via `actions.setWorldObjects(
            compileMap(...))` on every map switch, and this
            re-renders one InstancedMesh per cube kind in response.
            The legacy `<Floor>` (a default 27×27 blue platform
            rendered underneath these cubes) was removed because it
            visually competed with map-authored content — authors saw
            a stripe of "default" cubes peeking around the edges of
            their own map and assumed map switching was broken. */}
        <ObjectInstances store={store} />

        <Players
          store={store}
          bus={props.bus}
          selfId={selfId}
          cameraMode={cameraMode}
          selfPosRef={selfPosRef}
          selfBodyRef={selfBodyRef}
          paused={props.paused}
          isAirborneRef={isAirborneRef}
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
          fixedAzimuthDeg={fixedCamera.azimuthDeg}
          fixedMovementYawOffsetDeg={fixedCamera.movementYawOffsetDeg}
          yawRef={yawRef}
          selfBodyRef={selfBodyRef}
          worldFocused={worldFocused}
          spawnPoints={props.spawnPoints}
          isAirborneRef={isAirborneRef}
          characterControllerOffset={props.characterControllerOffset}
        />
        </Physics>
      </Suspense>
    </Canvas>
  );
}
