import React, { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  useRapier,
  type RapierRigidBody,
} from '@react-three/rapier';
import RAPIER from '@dimforge/rapier3d-compat';
import type {
  Actions,
  Store,
  RuleRegistry,
  SyncEngine,
  SnapshotHandshake,
  Bus,
  Vec3,
} from '@officexr/sdk';
import type { BotPool } from '../bot/BotPool.ts';
import type { CameraMode } from './config.ts';
import { resolveCharacterTunables } from '../characters/resolve.ts';
import {
  GRAVITY as GAME_GRAVITY,
  pickRespawnPosition,
  respawnThreshold,
} from '../physics/rules.ts';

interface SceneFrameProps {
  store: Store;
  actions: Actions;
  rules: RuleRegistry;
  bus: Bus;
  sync: SyncEngine;
  handshake: SnapshotHandshake;
  bots: BotPool;
  cameraMode: CameraMode;
  fixedAzimuthDeg: number;
  /** Manual fine-tune for fixed-mode WASD direction (degrees). */
  fixedMovementYawOffsetDeg: number;
  yawRef: React.MutableRefObject<number>;
  selfId: string;
  /** Set by `Players` when the self avatar's RigidBody mounts. */
  selfBodyRef: React.MutableRefObject<RapierRigidBody | null>;
  /** When false, keyboard input is released from the in-world
   * character: keydown is ignored, and any held keys are cleared
   * so the character stops mid-stride. Toggled by the studio's
   * `useWorldFocus` hook based on side-panel interaction. */
  worldFocused: boolean;
  /** Spawn points from the active map. When the local player falls
   * below `respawnThreshold(state.worldObjects)`, SceneFrame
   * teleports them to one of these positions (+ SPAWN_DROP_HEIGHT
   * y-lift so they fall onto the surface). Empty/undefined => no
   * respawn ever (the player floats in the void instead). */
  spawnPoints?: readonly Vec3[];
}

const ARROW_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

// Same gravity constant the bot physics worlds use — see
// `packages/world/src/physics/rules.ts`. Imported under an alias so
// the per-frame closure can still refer to it as `GRAVITY` for
// readability without colliding with anything else named `GRAVITY`.
const GRAVITY = GAME_GRAVITY;

/**
 * Owns the per-frame loop: WASD movement (via Rapier's
 * `KinematicCharacterController`), world tick, rule evaluation, sync
 * flushing, bot updates. Mounted once inside `<Canvas>`, downstream of
 * `<Physics>`.
 *
 * The character controller is the load-bearing replacement for the old
 * `resolveMovement`. It walks the self body's collider against every
 * other collider in the Rapier world (other players, walls, future
 * obstacles) and yields a "corrected" movement vector that slides
 * along contacts and stops at solid geometry. We feed that result
 * back into `actions.setSelfPosition` so the store + broadcast stay
 * consistent with where the body actually ended up.
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
  selfId,
  selfBodyRef,
  worldFocused,
  spawnPoints,
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

  const { world } = useRapier();

  // The character controller is created lazily on first frame instead
  // of in a useMemo. `<Physics>` proxies the underlying Rapier World
  // through a getter that lazily instantiates `new RAPIER.World(...)`
  // on first property access. During render, calling
  // `world.createCharacterController(...)` would trigger that lazy
  // init — but the proxy and the controller live for the
  // *worldProxy's* lifetime, which can outlast individual Physics
  // re-renders (StrictMode double-mount, HMR, Leva-driven option
  // changes that change `gravity` / `numSolverIterations` etc and
  // rebuild Physics' inner context). A controller created against a
  // freed/reset world later resolves to `undefined` when
  // `computeColliderMovement` is called, which is the white-screen
  // bug we hit on first WASD press. Re-acquiring the controller from
  // the live world inside useFrame makes this resilient.
  const controllerRef = useRef<RAPIER.KinematicCharacterController | null>(
    null,
  );
  const controllerWorldRef = useRef<unknown>(null);
  // Vertical velocity (m/s) for the local player. Accumulates `GRAVITY
  // * dt` every frame and resets to 0 whenever the character controller
  // reports `computedGrounded()`. The Rapier `Physics` world's gravity
  // vector ONLY drives dynamic bodies — our player is kinematic, so the
  // controller integrates gravity itself via the desired translation we
  // pass into `computeColliderMovement`.
  const verticalVelRef = useRef(0);
  // Test hook: when false, gravity is skipped (vertical velocity stays
  // at 0). The deterministic visual regression test flips this off so
  // it can pin the player to a fixed pos without the body drifting
  // away each frame. Production code never reads or writes this.
  const gravityEnabledRef = useRef(true);
  useEffect(() => {
    (window as unknown as {
      __OFFICE_GRAVITY__?: { setEnabled: (v: boolean) => void };
    }).__OFFICE_GRAVITY__ = {
      setEnabled: (v: boolean) => {
        gravityEnabledRef.current = v;
        if (!v) verticalVelRef.current = 0;
      },
    };
    return () => {
      delete (window as unknown as { __OFFICE_GRAVITY__?: unknown })
        .__OFFICE_GRAVITY__;
    };
  }, []);
  // PlayerIds whose bodies the local character was bumping into on the
  // previous frame. Used to edge-trigger `collision:char-bump` — Rapier
  // reports a collision every frame two characters are in contact, but
  // we only want one bump event per touch.
  const bumpingPeersRef = useRef<Set<string>>(new Set());

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
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      ) {
        return;
      }
      if (ARROW_KEYS.has(e.key)) e.preventDefault();
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

  useFrame((_, dtSec) => {
    const dt = dtSec * 1000;
    const now = performance.now();
    const keys = keysDown.current;

    const stateSnapshot = store.getState();
    const self = stateSnapshot.players[selfId];
    const body = selfBodyRef.current;
    const { movementBlockThreshold } = stateSnapshot.worldSettings;
    // Resolve per-character overrides for the local model — each
    // character can have its own speed / run multiplier, falling back
    // to WorldSettings defaults via resolveCharacterTunables.
    const selfModel = self?.avatar.model ?? 'default';
    const { playerSpeed: baseSpeed, runSpeedMultiplier } =
      resolveCharacterTunables(
        selfModel,
        stateSnapshot.worldSettings,
        stateSnapshot.characterConfigs,
      );
    const isRunning = keys.has('shift');
    const playerSpeed = isRunning ? baseSpeed * runSpeedMultiplier : baseSpeed;
    // movementBlockThreshold = "fraction of intent that must be
    // *blocked* to count as 'fully stopped'". So if 90% (default) of
    // intent is blocked, we want progress < 0.1 to snap velocity and
    // animation to zero.
    const minProgress = 1 - movementBlockThreshold;

    if (self && body) {
      // Auto-warp detector. If the store's pos has been mutated to
      // somewhere far from where the body actually is (a map-switch
      // spawn or a test-driven `store.setState`), teleport the body
      // to match this frame and SKIP the rest of the movement
      // integration — otherwise the bottom-of-loop
      // `setNextKinematicTranslation(t + corrected)` (which reads
      // body.translation() — still the pre-warp value because the
      // physics step hasn't run yet) would clobber the warp back to
      // the old position.
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
      const t0 = body.translation();
      const dx0 = self.pos.x - t0.x;
      const dy0 = self.pos.y - t0.y;
      const dz0 = self.pos.z - t0.z;
      const warpThresholdSq = gravityEnabledRef.current ? 0.25 : 0;
      const warped = dx0 * dx0 + dy0 * dy0 + dz0 * dz0 > warpThresholdSq;
      if (warped) {
        body.setNextKinematicTranslation(self.pos);
        verticalVelRef.current = 0;
        // Reset moving/idle so the moving→idle edge-trigger below
        // doesn't fire spuriously after a teleport.
        wasMoving.current = false;
      }

      const fwd =
        (keys.has('w') || keys.has('arrowup') ? 1 : 0) -
        (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
      const strafe =
        (keys.has('d') || keys.has('arrowright') ? 1 : 0) -
        (keys.has('a') || keys.has('arrowleft') ? 1 : 0);

      // Horizontal intent. Zero when no WASD keys are held; we still
      // run the controller below so gravity can apply.
      let dx = 0;
      let dz = 0;
      let horizMove = 0;
      let intendsMove = false;
      let movementYaw = self.yaw;
      if (fwd !== 0 || strafe !== 0) {
        const cameraYaw =
          cameraMode === 'fixed'
            ? Math.PI -
              (fixedAzimuthDeg * Math.PI) / 180 +
              (fixedMovementYawOffsetDeg * Math.PI) / 180
            : yawRef.current;
        const forwardX = -Math.sin(cameraYaw);
        const forwardZ = -Math.cos(cameraYaw);
        const rightX = Math.cos(cameraYaw);
        const rightZ = -Math.sin(cameraYaw);
        dx = forwardX * fwd + rightX * strafe;
        dz = forwardZ * fwd + rightZ * strafe;
        const len = Math.hypot(dx, dz);
        if (len > 0) {
          dx /= len;
          dz /= len;
          horizMove = (playerSpeed * dt) / 1000;
          movementYaw = Math.atan2(-dx, -dz);
          intendsMove = true;
        }
      }

      // Find the body's primary collider — Rapier's controller works
      // on a single collider, and we registered three (body + 2
      // sensors). The first non-sensor collider IS the body
      // collider; sensors don't push, so we want the body.
      let bodyCollider = null;
      for (let i = 0; i < body.numColliders(); i++) {
        const c = body.collider(i);
        if (!c.isSensor()) {
          bodyCollider = c;
          break;
        }
      }
      let isMoving = false;
      if (bodyCollider && !warped) {
        // Lazily create or refresh the character controller. If the
        // world proxy has swapped its underlying World (e.g. Physics
        // rebuilt after a settings change), reattach and reset
        // vertical velocity so we don't carry a stale fall speed
        // across the world swap.
        if (
          !controllerRef.current ||
          controllerWorldRef.current !== world
        ) {
          const c = world.createCharacterController(0.01);
          c.setApplyImpulsesToDynamicBodies(false);
          c.setSlideEnabled(true);
          c.setUp({ x: 0, y: 1, z: 0 });
          // Stick to the ground when walking off a small ledge or
          // down a slight slope — prevents the character from
          // hovering for a frame when transitioning between cubes
          // that are nominally at the same height but pixel-diff
          // because of physics solver tolerance.
          c.enableSnapToGround(0.3);
          controllerRef.current = c;
          controllerWorldRef.current = world;
          verticalVelRef.current = 0;
        }
        const controller = controllerRef.current;
        if (!controller) return;

        // Integrate gravity. Rapier's KinematicCharacterController
        // does not auto-apply the Physics world's gravity vector to
        // kinematic bodies — gravity here is a manual integration
        // baked into the `desired` translation we pass to
        // `computeColliderMovement`. The controller then resolves
        // that translation against ground colliders.
        const dtSec = dt / 1000;
        if (gravityEnabledRef.current) {
          verticalVelRef.current += GRAVITY * dtSec;
        } else {
          verticalVelRef.current = 0;
        }

        // EXCLUDE_SENSORS: the proximity rings (inner/outer) are
        // sensors. Without this flag the character controller
        // treats them as solid geometry — the local player would
        // physically bump into the *invisible* proximity sphere
        // around every other character. Rapier's `sensor: true`
        // only disables the dynamics solver's penetration push;
        // movement resolution uses the query pipeline, which needs
        // this flag to skip sensors.
        controller.computeColliderMovement(
          bodyCollider,
          {
            x: dx * horizMove,
            y: verticalVelRef.current * dtSec,
            z: dz * horizMove,
          },
          RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        );
        const corrected = controller.computedMovement();

        // When the controller resolves us onto solid ground, drop
        // accumulated fall speed. Otherwise it would compound across
        // frames while standing on a cube and the player would punch
        // through the floor the next time they step over an edge.
        if (controller.computedGrounded()) {
          verticalVelRef.current = 0;
        }

        // Edge-trigger bilateral `collision:char-bump` events for
        // every peer character we're newly touching. The Rapier
        // character controller resolves movement via the query
        // pipeline (it *slides* rather than collides), so the
        // contact pipeline never fires `onCollisionEnter` for the
        // bodies it walked the character past. We walk the
        // controller's own collision list and convert any contact
        // with another player's RigidBody into a bump event.
        const touchedThisFrame = new Set<string>();
        const n = controller.numComputedCollisions();
        for (let i = 0; i < n; i++) {
          const coll = controller.computedCollision(i);
          if (!coll || !coll.collider) continue;
          const otherRb = coll.collider.parent();
          if (!otherRb) continue;
          const otherUd = otherRb.userData as
            | { playerId?: string }
            | undefined;
          const otherId = otherUd?.playerId;
          if (!otherId || otherId === selfId) continue;
          touchedThisFrame.add(otherId);
          if (!bumpingPeersRef.current.has(otherId)) {
            // `normal1` points OUT of the obstacle in world space.
            // For self that's the direction we get pushed; for the
            // other character it's the reverse.
            const nrm = coll.normal1;
            bus.emit({
              kind: 'collision:char-bump',
              selfId,
              otherId,
              normal: { x: nrm.x, z: nrm.z },
            });
            bus.emit({
              kind: 'collision:char-bump',
              selfId: otherId,
              otherId: selfId,
              normal: { x: -nrm.x, z: -nrm.z },
            });
          }
        }
        bumpingPeersRef.current = touchedThisFrame;

        // `movementBlockThreshold` from worldSettings controls when
        // we treat "blocked enough" as fully stopped — preserving
        // the original behaviour where pushing into a wall snaps
        // the walking animation back to idle. Only applies when the
        // user is intentionally moving; gravity-only frames don't
        // count as "blocked horizontal movement".
        const correctedLen = Math.hypot(corrected.x, corrected.z);
        const intentLen = Math.hypot(dx * horizMove, dz * horizMove);
        const progress =
          intentLen > 1e-9 ? Math.min(1, correctedLen / intentLen) : 0;
        const horizBlocked = intendsMove && progress < minProgress;

        const t = body.translation();
        let newPos = {
          x: horizBlocked ? t.x : t.x + corrected.x,
          y: t.y + corrected.y,
          z: horizBlocked ? t.z : t.z + corrected.z,
        };

        // Fall-respawn. Bots and the local player obey the same
        // below-the-lowest-cube rule — bots are simulations of
        // remote players, they don't get to defy game physics.
        const threshold = respawnThreshold(stateSnapshot.worldObjects);
        if (newPos.y < threshold) {
          const r = pickRespawnPosition(spawnsRef.current);
          if (r) {
            newPos = r;
            verticalVelRef.current = 0;
            // Skip animation transitions; treat as a teleport. The
            // body warp happens via the same auto-warp path that
            // handles spawn-from-sky: setSelfPosition(r) updates the
            // store, and the auto-warp at the top of the next frame
            // moves the body to match.
          }
        }

        body.setNextKinematicTranslation(newPos);

        if (intendsMove && !horizBlocked) {
          actions.setSelfPosition(
            newPos,
            {
              x: dx * playerSpeed * progress,
              y: 0,
              z: dz * playerSpeed * progress,
            },
            movementYaw,
          );
          isMoving = true;
        } else {
          actions.setSelfPosition(
            newPos,
            { x: 0, y: 0, z: 0 },
            intendsMove ? movementYaw : self.yaw,
          );
        }
      }
      // On the moving → idle transition, zero out the velocity once so
      // the renderer (and remote peers) see the stop.
      if (!isMoving && wasMoving.current) {
        const t = body?.translation();
        const stopPos = t ? { x: t.x, y: t.y, z: t.z } : self.pos;
        actions.setSelfPosition(stopPos, { x: 0, y: 0, z: 0 }, self.yaw);
      }
      wasMoving.current = isMoving;
    }

    actions.tick(now);
    bots.tick(dt);
    const current = store.getState();
    rules.tick(current, prevState.current, bus);
    prevState.current = store.getState();
    sync.flushPosition();
    handshake.tickTimers();
  });

  return null;
}
