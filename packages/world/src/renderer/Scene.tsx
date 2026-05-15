import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { Sphere } from '@react-three/drei';
import { Physics, type RapierRigidBody } from '@react-three/rapier';
import { GradientBackground } from './GradientBackground.tsx';
import { MapColliders } from './MapColliders.tsx';
import type {
  Actions,
  Bus,
  RuleRegistry,
  Store,
  SyncEngine,
  SnapshotHandshake,
} from '@officexr/sdk';
import type { BotPool } from '../bot/BotPool.ts';
import { Players } from './Players.tsx';
import { CameraRig } from './CameraRig.tsx';
import { SceneFrame } from './SceneFrame.tsx';
import { ObjectInstances } from './ObjectInstances.tsx';
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
}

export function Scene(props: SceneProps) {
  const { store, selfId, cameraMode, sync, viewConfig } = props;
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
    }),
    [
      fixedCamera.azimuthDeg,
      fixedCamera.pitchDeg,
      fixedCamera.height,
      fixedCamera.maxOnScreenFrac,
      fixedCamera.minOnScreenFrac,
      fixedCamera.lateralFrac,
      fixedCamera.fov,
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
  // The `far` plane still needs to span from the sun to the far edge
  // of the shadow region, hence `|sunPos| + radius + margin` — too
  // small and floor near the player falls behind the shadow camera.
  const shadowCam = useMemo(() => {
    const [sx, sy, sz] = lighting.sunPosition;
    const radius = lighting.shadowRange;
    const sunMag = Math.hypot(sx, sy, sz);
    const far = sunMag + radius + 20;
    return { radius, far };
  }, [lighting.sunPosition, lighting.shadowRange]);

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
        <MapColliders store={store} />
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
        />
        </Physics>
      </Suspense>
    </Canvas>
  );
}
