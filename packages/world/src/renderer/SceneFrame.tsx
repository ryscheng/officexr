import React, { useEffect, useEffectEvent, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { RapierRigidBody } from '@react-three/rapier';
import { liveRigidBody } from './liveRigidBody.ts';
import type {
  Actions,
  Store,
  RuleRegistry,
  SyncEngine,
  SnapshotHandshake,
  Bus,
  Vec3,
} from '@officexr/sdk';
import { tickSession } from '@officexr/sdk';
import type { BotPool } from '../bot/BotPool.ts';
import { hasCommandModifier, isTypingTarget } from '../react/useWorldFocus.ts';
import { useApplication } from '../react/application-context.tsx';
import type { CameraMode } from './config.ts';
import { resolveCharacterTunables } from '../characters/resolve.ts';
import { fixedMovementYaw, yawFromDirection, type ViewOffsets } from './lookControls.ts';
import { moveIntent, type AutoWalkSource, type MoveInput } from './moveIntent.ts';
import { sitOnPress, stepSeated, type SeatingSource } from './seated.ts';
import { extrapolatePos } from './Players.tsx';
import { useStoreWorldObjects } from './useStoreWorldObjects.ts';
import type { SimBakedColliders, SimCore, SimPeer } from '../sim/SimCore.ts';

interface SceneFrameProps {
  store: Store;
  actions: Actions;
  rules: RuleRegistry;
  bus: Bus;
  sync: SyncEngine;
  handshake: SnapshotHandshake;
  bots?: BotPool;
  cameraMode: CameraMode;
  fixedAzimuthDeg: number;
  /** Manual fine-tune for fixed-mode WASD direction (degrees). */
  fixedMovementYawOffsetDeg: number;
  yawRef: React.MutableRefObject<number>;
  viewOffsetsRef: React.MutableRefObject<ViewOffsets>;
  /** Analog walking input (e.g. an on-screen joystick); keys win when held. Not gated by `worldFocused`. */
  moveInputRef?: React.MutableRefObject<MoveInput>;
  /** Steers at walk speed while there is no key or stick input; such input cancels it. Not gated by `worldFocused`. */
  autoWalk?: AutoWalkSource;
  /** E sits through it; while seated, any movement input stands through it instead of moving. */
  seating?: SeatingSource;
  selfId: string;
  /** Set by `Players` when the self avatar's RigidBody mounts; mirrors the sim's position for the proximity sensors. */
  selfBodyRef: React.MutableRefObject<RapierRigidBody | null>;
  /** Builds the local player's movement simulation; called once per mount, after Rapier has loaded. */
  createSim: (charRadius: number) => SimCore;
  /** Loaded baked layouts' colliders; their rooms' instances collide through these instead. */
  bakedColliders: readonly SimBakedColliders[];
  /** Called once the sim collides with `bakedColliders`, with their room instance ids. */
  onBakedCollidersApplied?: (roomInstanceIds: readonly string[]) => void;
  /** When false, keyboard input is released from the in-world
   * character: keydown is ignored, and any held keys are cleared
   * so the character stops mid-stride. Toggled by the studio's
   * `useWorldFocus` hook based on side-panel interaction. */
  worldFocused: boolean;
  /** Spawn points from the active map. When the local player falls
   * below `respawnThreshold(state.worldObjects, spawnPoints)` (the
   * backstop) or trips the primary dual-gate (no floor underneath +
   * fall speed >= MAX_FALL_VELOCITY), SceneFrame teleports them to
   * one of these positions (+ SPAWN_DROP_HEIGHT y-lift so they fall
   * onto the surface). The spawn list is also folded into the
   * backstop threshold so baked-layout maps (whose floor lives in
   * the GLB, not in `worldObjects.instances`) still get a finite
   * backstop. Empty/undefined => no respawn ever (the player floats
   * in the void instead). */
  spawnPoints?: readonly Vec3[];
  /** Mutated each frame to true while the local player is airborne.
   * Players.tsx reads this to drive the jump animation for the self avatar
   * without React re-renders. Ref is created in Scene.tsx and threaded to
   * both SceneFrame and Players. */
  isAirborneRef: React.MutableRefObject<boolean>;
  /** While an immersive XR session is presenting, movement follows the headset's yaw. */
  xrPresenting: boolean;
}

const headsetForward = new THREE.Vector3();
const peerPos = new THREE.Vector3();

const ARROW_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

/**
 * Owns the per-frame loop: input into the local player's `SimCore`
 * step, world tick, rule evaluation, sync flushing, bot updates.
 * Mounted once inside `<Canvas>`, downstream of `<Physics>`, whose self
 * body it keeps on the sim's position. Each step's result goes back
 * into `actions.setSelfPosition` so the store + broadcast stay
 * consistent with where the character actually ended up.
 */
export function SceneFrame({
  store,
  actions,
  rules,
  bus,
  sync,
  handshake,
  bots,
  cameraMode,
  fixedAzimuthDeg,
  fixedMovementYawOffsetDeg,
  yawRef,
  viewOffsetsRef,
  moveInputRef,
  autoWalk,
  seating,
  selfId,
  selfBodyRef,
  createSim,
  bakedColliders,
  onBakedCollidersApplied,
  worldFocused,
  spawnPoints,
  isAirborneRef,
  xrPresenting,
}: SceneFrameProps) {
  // Mirror the spawn list into a ref so the per-frame fall-respawn
  // check below can read the live value without re-binding the
  // useFrame callback when the picker pushes a new map.
  const spawnsRef = useRef<readonly Vec3[]>(spawnPoints ?? []);
  useEffect(() => {
    spawnsRef.current = spawnPoints ?? [];
  }, [spawnPoints]);
  const keysDown = React.useRef<Set<string>>(new Set());
  // Mirror the React-prop focus state into a ref so the imperative
  // keydown listener (registered once in useEffect below) always
  // reads the live value without re-binding when focus changes.
  const focusedRef = React.useRef(worldFocused);
  useEffect(() => {
    focusedRef.current = worldFocused;
    // Drop any held keys when focus is released so a key still
    // depressed at panel-click time doesn't lock the character into
    // a permanent walk loop. (Real keyup events stop firing while
    // an input has focus.)
    if (!worldFocused) keysDown.current.clear();
  }, [worldFocused]);
  const prevState = React.useRef(store.getState());
  const wasMoving = React.useRef(false);

  const simRef = useRef<SimCore | null>(null);
  // Mugshot's gravity-off mode, which also drops the warp threshold below to zero.
  const gravityEnabledRef = useRef(true);
  useEffect(() => {
    const sim = createSim(store.getState().worldSettings.charRadius);
    sim.setGravityEnabled(gravityEnabledRef.current);
    simRef.current = sim;
    return () => {
      simRef.current = null;
      sim.dispose();
    };
  }, [createSim, store]);

  const { catalog, voxelSize } = useApplication();
  const worldObjects = useStoreWorldObjects(store);
  const notifyBakedApplied = useEffectEvent((ids: readonly string[]) => onBakedCollidersApplied?.(ids));
  useEffect(() => {
    simRef.current?.setStaticColliders(worldObjects, { voxelSize, kinds: catalog.listKinds() }, bakedColliders);
    notifyBakedApplied(bakedColliders.map((b) => b.roomInstanceId));
  }, [createSim, worldObjects, voxelSize, catalog, bakedColliders]);

  const spaceWasDownRef = useRef(false);  // edge-trigger: was Space held last frame?
  const eWasDownRef = useRef(false);
  useEffect(() => {
    (window as unknown as {
      __OFFICE_GRAVITY__?: { setEnabled: (v: boolean) => void };
    }).__OFFICE_GRAVITY__ = {
      setEnabled: (v: boolean) => {
        gravityEnabledRef.current = v;
        simRef.current?.setGravityEnabled(v);
      },
    };
    return () => {
      delete (window as unknown as { __OFFICE_GRAVITY__?: unknown })
        .__OFFICE_GRAVITY__;
    };
  }, []);

  useEffect(() => {
    // Gate on the React-managed `worldFocused` flag (mirrored into
    // focusedRef above so this once-bound listener reads the live
    // value). The studio's `useWorldFocus` hook flips it on
    // mousedown / focusin against a `[data-studio-panel]` ancestor;
    // when false, keydowns are dropped (and held keys cleared) so
    // interacting with the right-hand control panel doesn't
    // accidentally walk the character.
    const onKeyDown = (e: KeyboardEvent) => {
      if (!focusedRef.current) return;
      // Also defend against keys typed into a focused <input> that
      // happens to be outside any panel — the world should never
      // capture keystrokes a real text field is consuming.
      if (isTypingTarget(e.target) || hasCommandModifier(e)) {
        return;
      }
      if (ARROW_KEYS.has(e.key) || e.key === ' ') e.preventDefault();
      keysDown.current.add(e.key.toLowerCase());
    };
    const onKeyUp = (e: KeyboardEvent) =>
      keysDown.current.delete(e.key.toLowerCase());

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useFrame(({ gl }, dtSec) => {
    const dt = dtSec * 1000;
    const now = performance.now();
    const keys = keysDown.current;
    const sim = simRef.current;

    eWasDownRef.current = sitOnPress(keys, eWasDownRef.current, seating);
    const { fwd, strafe, isRunning, speedScale } = moveIntent(keys, moveInputRef?.current);
    const hasMoveInput = fwd !== 0 || strafe !== 0;
    if (hasMoveInput) {
      autoWalk?.cancel();
    }
    const selfBeforeWalk = store.getState().players[selfId];
    const autoWalkDir =
      !hasMoveInput && selfBeforeWalk ? (autoWalk?.intent(selfBeforeWalk.pos) ?? null) : null;

    // Read after E and auto-walk, which can seat the player, so this frame's movement doesn't overwrite the seated pose.
    const stateSnapshot = store.getState();
    const self = stateSnapshot.players[selfId];
    const body = liveRigidBody(selfBodyRef.current);
    const { worldSettings } = stateSnapshot;
    // Resolve per-character overrides for the local model — each
    // character can have its own speed / run multiplier, falling back
    // to WorldSettings defaults via resolveCharacterTunables.
    const selfModel = self?.avatar.model ?? 'default';
    const { playerSpeed: baseSpeed, runSpeedMultiplier } =
      resolveCharacterTunables(
        selfModel,
        worldSettings,
        stateSnapshot.characterConfigs,
      );
    const playerSpeed = autoWalkDir
      ? baseSpeed
      : (isRunning ? baseSpeed * runSpeedMultiplier : baseSpeed) * speedScale;

    // Space key edge-trigger for jump: only fire on the frame the
    // key transitions from up to down. Holding Space does not repeat.
    const spaceDown = keys.has(' ');
    const spacePressedThisFrame = spaceDown && !spaceWasDownRef.current;
    spaceWasDownRef.current = spaceDown;

    if (sim) {
      // Peers collide where Players draws them this frame.
      const peers: SimPeer[] = [];
      for (const [id, p] of Object.entries(stateSnapshot.players)) {
        if (id !== selfId) {
          const { x, y, z } = extrapolatePos(p, now, peerPos);
          peers.push({ id, pos: { x, y, z } });
        }
      }
      sim.syncPeers(peers, worldSettings.charRadius);
    }

    if (self?.seat != null && body) {
      stepSeated(store, selfId, body, seating, hasMoveInput || spacePressedThisFrame || autoWalkDir !== null);
      sim?.teleport(store.getState().players[selfId]?.pos ?? self.pos);
      isAirborneRef.current = false;
      wasMoving.current = false;
    } else if (self && body && sim) {
      // Auto-warp detector. If the store's pos has been mutated to
      // somewhere far from where the sim has the player (a map-switch
      // spawn or a test-driven `store.setState`), teleport there this
      // frame and SKIP the movement step, which would otherwise move
      // on from the old position and clobber the warp.
      //
      // This is what lets `useMapPicker` drop the player from the
      // sky by just calling `setSelfPosition(skyPos, ...)` — no
      // body-handle plumbing required.
      //
      // Threshold of 0.5 m comfortably excludes the per-frame deltas
      // produced by gravity (~0.006 m at 60 fps) and normal walking
      // (~0.1 m / frame at 6 m/s) while catching any "real" teleport.
      //
      // When gravity is disabled (Mugshot mode), drop the threshold
      // to zero so any `setSelfPosition` change — including the
      // mugshot Y-slider's 0.01 m granularity — moves the body
      // immediately. With gravity off there's no per-frame jitter
      // to filter out.
      const before = sim.position();
      const dx0 = self.pos.x - before.x;
      const dy0 = self.pos.y - before.y;
      const dz0 = self.pos.z - before.z;
      const warpThresholdSq = gravityEnabledRef.current ? 0.25 : 0;
      let isMoving = false;
      if (dx0 * dx0 + dy0 * dy0 + dz0 * dz0 > warpThresholdSq) {
        sim.teleport(self.pos);
        body.setNextKinematicTranslation(self.pos);
        isAirborneRef.current = false;
        // Reset moving/idle so the moving→idle edge-trigger below
        // doesn't fire spuriously after a teleport.
        wasMoving.current = false;
      } else {
        // Horizontal intent: camera-relative from keys or the stick, else
        // world-space from auto-walk. Zero when neither steers; the sim
        // still steps so gravity can apply.
        let dx = 0;
        let dz = 0;
        if (hasMoveInput) {
          const cameraYaw = xrPresenting
            ? yawFromDirection(gl.xr.getCamera().getWorldDirection(headsetForward))
            : cameraMode === 'fixed'
              ? fixedMovementYaw(
                  fixedAzimuthDeg,
                  viewOffsetsRef.current.fixedAzimuthOffsetRad,
                  fixedMovementYawOffsetDeg,
                )
              : yawRef.current;
          const forwardX = -Math.sin(cameraYaw);
          const forwardZ = -Math.cos(cameraYaw);
          const rightX = Math.cos(cameraYaw);
          const rightZ = -Math.sin(cameraYaw);
          dx = forwardX * fwd + rightX * strafe;
          dz = forwardZ * fwd + rightZ * strafe;
        } else if (autoWalkDir) {
          dx = autoWalkDir.x;
          dz = autoWalkDir.z;
        }
        const len = Math.hypot(dx, dz);
        const dir = len > 0 ? { x: dx / len, z: dz / len } : { x: 0, z: 0 };

        const result = sim.step({
          dtSec,
          nowMs: now,
          dir,
          speed: playerSpeed,
          running: isRunning && !autoWalkDir,
          yaw: len > 0 ? yawFromDirection(dir) : self.yaw,
          jump: spacePressedThisFrame,
          settings: worldSettings,
          spawnPoints: spawnsRef.current,
        });
        isAirborneRef.current = result.isAirborne;

        // Bilateral: `normal` points out of the peer, the way self is pushed.
        for (const { otherId, normal } of result.bumps) {
          bus.emit({ kind: 'collision:char-bump', selfId, otherId, normal });
          bus.emit({
            kind: 'collision:char-bump',
            selfId: otherId,
            otherId: selfId,
            normal: { x: -normal.x, z: -normal.z },
          });
        }

        body.setNextKinematicTranslation(result.newPos);
        actions.setSelfPosition(result.newPos, result.broadcastVel, result.broadcastYaw, result.isAirborne);
        isMoving = result.moved;
      }
      // On the moving → idle transition, zero out the velocity once so
      // the renderer (and remote peers) see the stop. While airborne,
      // isMoving is true so this branch never fires mid-air.
      if (!isMoving && wasMoving.current) {
        actions.setSelfPosition(before, { x: 0, y: 0, z: 0 }, self.yaw, false);
      }
      wasMoving.current = isMoving;
    }

    bots?.tick(dt);
    prevState.current = tickSession({
      actions,
      store,
      rules,
      bus,
      sync,
      handshake,
      prevState: prevState.current,
      nowMs: now,
    });
  });

  return null;
}
