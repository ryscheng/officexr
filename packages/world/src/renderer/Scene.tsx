import React, { Suspense, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { Physics, type RapierRigidBody } from '@react-three/rapier';
import { XR, type XRStore } from '@react-three/xr';
import { SkyDome } from './SkyDome.tsx';
import { LightingRig } from './LightingRig.tsx';
import { lightBasis, snapToShadowTexel } from './shadow-snap.ts';
import { MapColliders } from './MapColliders.tsx';
import { excludeLayoutInstances } from './useStoreWorldObjects.ts';
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
import { XRAvatarOrigin } from './XRAvatarOrigin.tsx';
import type { MotionLookState } from './motionLook.ts';
import { SceneFrame } from './SceneFrame.tsx';
import { ObjectInstances } from './ObjectInstances.tsx';
import { BakedLayout } from './BakedLayout.tsx';
import { BakedLayoutColliders } from './BakedLayoutColliders.tsx';
import { ProximityGlow } from './ProximityGlow.tsx';
import { ModelsReady } from './ModelsReady.tsx';
import { FrameStatsProbe, type FrameStatsSample } from './FrameStatsProbe.tsx';
import { ViewYawProbe } from './ViewYawProbe.tsx';
import type { ViewYaw } from '../react/viewYaw.tsx';
import { GAMEPLAY_FOV, type CameraMode } from './config.ts';
import { placementTransform } from './placement-transform.ts';
import type { BakedLayoutPlacement } from '../app/map-loader.ts';
import type { ViewConfig } from './viewConfig.ts';
import type { ViewOffsets } from './lookControls.ts';
import type { AutoWalkSource, MoveInput } from './moveIntent.ts';

/**
 * Each frame, anchor the sun (directional light + its target) to the
 * local player's render position
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
  sunOffset: [number, number, number];
  shadowRange: number;
  shadowMapSize: number;
  selfPosRef: React.RefObject<THREE.Vector3>;
}) {
  const [ox, oy, oz] = props.sunOffset;
  const basis = useMemo(() => lightBasis([ox, oy, oz]), [ox, oy, oz]);
  const texelSize = (2 * props.shadowRange) / props.shadowMapSize;
  const snapped = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const player = props.selfPosRef.current;
    if (!player) return;
    snapToShadowTexel(player, basis, texelSize, snapped);
    const light = props.lightRef.current;
    const target = props.lightTargetRef.current;
    if (light && target) {
      // Bind the movable target to the light (idempotent — three.js
      // reads `light.target.matrixWorld` for the view direction).
      if (light.target !== target) light.target = target;
      light.position.set(snapped.x + ox, snapped.y + oy, snapped.z + oz);
      target.position.copy(snapped);
      target.updateMatrixWorld();
    }
  });
  return null;
}

function OptionalXR({ store, children }: { store?: XRStore; children: React.ReactNode }) {
  return store ? <XR store={store}>{children}</XR> : <>{children}</>;
}

const noopSubscribe = () => () => {};

/** A layout placement with the URL of its baked GLB, e.g. `/api/baked-layouts/lobby`. */
export interface SceneBakedLayout extends BakedLayoutPlacement {
  gltfPath: string;
}

interface SceneProps {
  store: Store;
  actions: Actions;
  rules: RuleRegistry;
  bus: Bus;
  sync: SyncEngine;
  handshake: SnapshotHandshake;
  bots?: BotPool;
  selfId: string;
  cameraMode: CameraMode;
  /** Device-motion look; absent leaves the view to mouse and touch. */
  motionLook?: MotionLookState;
  invertLook?: boolean;
  /** Fully resolved lighting, background, camera and proximity values. */
  view: ViewConfig;
  /** When false, keyboard input is released from the in-world
   * character so the user can interact with the side panel without
   * accidentally walking. Studio's `useWorldFocus` hook tracks this
   * via mousedown / focusin against `[data-studio-panel]`. Default
   * true preserves the historical behaviour for any caller that
   * doesn't wire a focus tracker. */
  worldFocused?: boolean;
  /** Analog walking input from a touch joystick; absent where there is none. */
  moveInputRef?: React.MutableRefObject<MoveInput>;
  /** World-space steering used while there is no key or stick input; absent where nothing auto-walks. */
  autoWalk?: AutoWalkSource;
  /** Spawn points for the active map, in world coords. Forwarded
   * straight to `SceneFrame`'s fall-respawn rule. Empty/undefined
   * disables respawn (the player floats in the void instead). */
  spawnPoints?: readonly Vec3[];
  /**
   * Layout placements to draw from their baked GLBs, with their colliders.
   * The store's instances compiled from these layouts are then left out
   * of `ObjectInstances` and `MapColliders`; bots still collide with them.
   */
  bakedLayouts?: readonly SceneBakedLayout[];
  /** When true, every character rendered in this scene is frozen at
   * its bind pose (no animation mixer activity). Used by the Mugshot
   * mode to produce deterministic snapshot tests. */
  paused?: boolean;
  /** Forwarded to R3F `<Canvas dpr={...}>`. Default is R3F's (auto-
   * picks `devicePixelRatio`). Set to 1 in Mugshot mode so the
   * captured framebuffer matches the container's CSS pixel size
   * exactly — capture baselines are deterministic regardless of
   * the user's display DPI. */
  dpr?: number;
  /** When provided, mounts a `<FrameStatsProbe>` inside the canvas
   * that reports FPS / frame-time / draw-call samples here (and a
   * final `null` on unmount). The studio's perf footer is the
   * intended consumer; omitting the prop adds zero per-frame work. */
  onFrameStats?: (sample: FrameStatsSample | null) => void;
  /** Receives the camera's yaw each frame; omitting it mounts no probe. */
  viewYaw?: ViewYaw;
  /** When false, the self player is not rendered, so it has no body and
   * neither moves nor falls. Default true. */
  selfReady?: boolean;
  /** Called once per mount when every model in the scene, plus the self
   * player's, has loaded. */
  onModelsReady?: () => void;
  /** Called once each baked layout's colliders have mounted, with its room instance id. */
  onCollidersReady?: (roomInstanceId: string) => void;
  onCollidersError?: (error: Error) => void;
  /** Enables immersive XR sessions from the self avatar's eyes. Without it the scene has no `<XR>` wrapper. */
  xrStore?: XRStore;
}

export function Scene(props: SceneProps) {
  const { store, selfId, cameraMode, sync, bakedLayouts } = props;
  const excludeBakedInstance = useMemo(() => excludeLayoutInstances(bakedLayouts), [bakedLayouts]);
  const { proximity, lighting, background, fixedCamera } = props.view;
  const worldFocused = props.worldFocused ?? true;
  const { xrStore } = props;
  const xrPresenting = useSyncExternalStore(
    xrStore?.subscribe ?? noopSubscribe,
    () => xrStore?.getState().session != null,
  );

  // After Scene mounts, force-broadcast the current world state.
  // The regular `onStoreChange` diff path only fires when values
  // *change* — without this, a bot spawned with the default map
  // would never receive the canonical one if the studio's map
  // happens to match the SDK defaults.
  // Fires once per channel-stack swap via the `sync` dependency.
  useEffect(() => {
    sync.broadcastWorldState();
  }, [sync]);

  // Refs shared between movement code and the camera rig.
  const yawRef = useRef(0);
  const pitchRef = useRef(-0.25);
  const viewOffsetsRef = useRef<ViewOffsets>({
    fixedAzimuthOffsetRad: 0,
    fixedPitchOffsetRad: 0,
    zoom: 1,
  });
  const selfPosRef = useRef(new THREE.Vector3());
  const subscribeCharRadius = useCallback(
    (onChange: () => void) => store.subscribe((s) => s.worldSettings.charRadius, onChange),
    [store],
  );
  const charRadius = useSyncExternalStore(
    subscribeCharRadius,
    () => store.getState().worldSettings.charRadius,
  );

  // Refs the SunFollower drives each frame so the directional light
  // tracks the local player.
  const sunLightRef = useRef<THREE.DirectionalLight | null>(null);
  const sunLightTargetRef = useRef<THREE.Object3D | null>(null);

  // Set by `Players` when the self avatar's `RigidBody` mounts; SceneFrame
  // reads it each frame to drive the `KinematicCharacterController`.
  const selfBodyRef = useRef<RapierRigidBody | null>(null);

  // Mutated each frame by SceneFrame to true while the local player is
  // airborne. Players reads this ref (not React state) to drive the jump
  // animation for the self avatar without triggering re-renders.
  const isAirborneRef = useRef<boolean>(false);

  // Updated each frame by `ProximityGlow`'s tracker: the local player's
  // current MeetingArea centroid (at the local player's feet height), or `null`
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
      camera={{ position: [0, 1.6, 0], fov: GAMEPLAY_FOV, near: 0.1, far: 2000 }}
      style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }}
      dpr={props.dpr}
      // `preserveDrawingBuffer: true` lets `canvas.toDataURL()` read
      // the actual rendered pixels — by default WebGL clears the
      // back buffer after compositing and `toDataURL` returns black.
      // The mugshot export depends on this being set; the small per-
      // frame perf cost is acceptable since the renderer's heaviest
      // consumers (Debug) don't use the export path.
      gl={{ preserveDrawingBuffer: true }}
    >
      <OptionalXR store={xrStore}>
      {props.onFrameStats && <FrameStatsProbe onSample={props.onFrameStats} />}
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
        <MapColliders store={store} exclude={excludeBakedInstance} />
        {bakedLayouts?.map((p) => {
          const transform = placementTransform(p);
          return (
            <React.Fragment key={p.roomInstanceId}>
              <group {...transform}>
                <BakedLayout gltfPath={p.gltfPath} layoutName={p.layoutName} />
              </group>
              <BakedLayoutColliders
                gltfPath={p.gltfPath}
                layoutName={p.layoutName}
                transform={transform}
                onReady={() => props.onCollidersReady?.(p.roomInstanceId)}
                onError={props.onCollidersError}
              />
            </React.Fragment>
          );
        })}
        {/* Lighting: shared LightingRig. SunFollower (mounted below,
            after Players) moves the sun to track the local player,
            keeping the orthographic shadow camera tight around the
            player even on huge maps — that's how shadow-map texels
            stay small (sharp shadows) without exploding shadow-map
            memory. Editors mount LightingRig without the follower
            (sun stays static). */}
        <LightingRig
          lighting={lighting}
          sunLightRef={sunLightRef}
          sunLightTargetRef={sunLightTargetRef}
        />
        {/* The sky draws the visible sun in the directional light's
            direction, so the disc lines up with the shadows. */}
        <SkyDome
          topColor={background.topColor}
          horizonColor={background.horizonColor}
          bottomColor={background.bottomColor}
          sun={
            lighting.showSunDisc
              ? {
                  position: lighting.sunPosition,
                  color: lighting.sunColor,
                  discRadius: lighting.sunDiscRadius,
                  glow: lighting.sunDiscIntensity,
                }
              : null
          }
        />

        <ObjectInstances store={store} exclude={excludeBakedInstance} />

        <Players
          store={store}
          bus={props.bus}
          selfId={selfId}
          cameraMode={cameraMode}
          selfPosRef={selfPosRef}
          selfBodyRef={selfBodyRef}
          paused={props.paused}
          isAirborneRef={isAirborneRef}
          xrPresenting={xrPresenting}
          selfReady={props.selfReady}
        />
        {xrStore && <XRAvatarOrigin selfPosRef={selfPosRef} charRadius={charRadius} />}

        {/* Mounted after Players: same-priority useFrames run in
            subscription order, so this reads the current frame's
            selfPosRef instead of last frame's. */}
        <SunFollower
          lightRef={sunLightRef}
          lightTargetRef={sunLightTargetRef}
          sunOffset={lighting.sunPosition as [number, number, number]}
          shadowRange={lighting.shadowRange}
          shadowMapSize={lighting.shadowMapSize}
          selfPosRef={selfPosRef}
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
          charRadius={charRadius}
          yawRef={yawRef}
          pitchRef={pitchRef}
          viewOffsetsRef={viewOffsetsRef}
          motionLook={props.motionLook}
          invertLook={props.invertLook}
          conversationFocusRef={conversationFocusRef}
          conversationDistance={proximity.conversationDistance}
          conversationHeight={proximity.conversationHeight}
          fixed={fixedCam}
          xrPresenting={xrPresenting}
        />
        {/* After CameraRig, so the probe reads this frame's pose, not last frame's. */}
        {props.viewYaw && <ViewYawProbe viewYaw={props.viewYaw} />}

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
          viewOffsetsRef={viewOffsetsRef}
          moveInputRef={props.moveInputRef}
          autoWalk={props.autoWalk}
          selfBodyRef={selfBodyRef}
          worldFocused={worldFocused}
          spawnPoints={props.spawnPoints}
          isAirborneRef={isAirborneRef}
          xrPresenting={xrPresenting}
        />
        {props.onModelsReady && (
          <ModelsReady store={store} selfId={selfId} onReady={props.onModelsReady} />
        )}
        </Physics>
      </Suspense>
      </OptionalXR>
    </Canvas>
  );
}
