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
} from '@officexr/sdk';
import type { BotPool } from '../bot/BotPool.ts';
import type { CameraMode } from './config.ts';
import { resolveCharacterTunables } from '../characters/resolve.ts';

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
}

const ARROW_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

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
}: SceneFrameProps) {
  const keysDown = React.useRef<Set<string>>(new Set());
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
  // PlayerIds whose bodies the local character was bumping into on the
  // previous frame. Used to edge-trigger `collision:char-bump` — Rapier
  // reports a collision every frame two characters are in contact, but
  // we only want one bump event per touch.
  const bumpingPeersRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const isInsideLeva = (el: EventTarget | null): boolean =>
      el instanceof Element && !!el.closest('#leva__root');

    let pointerOverLeva = false;
    const onPointerMove = (e: PointerEvent) => {
      pointerOverLeva = isInsideLeva(e.target);
    };

    const isLevaActive = (eventTarget: EventTarget | null): boolean => {
      if (isInsideLeva(eventTarget)) return true;
      if (pointerOverLeva) return true;
      const active = document.activeElement;
      if (active && active !== document.body && isInsideLeva(active)) {
        return true;
      }
      return false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isLevaActive(e.target)) {
        keysDown.current.clear();
        return;
      }
      if (ARROW_KEYS.has(e.key)) e.preventDefault();
      keysDown.current.add(e.key.toLowerCase());
    };
    const onKeyUp = (e: KeyboardEvent) =>
      keysDown.current.delete(e.key.toLowerCase());
    const onFocusIn = (e: FocusEvent) => {
      if (isInsideLeva(e.target)) keysDown.current.clear();
    };
    const onMouseDown = (e: MouseEvent) => {
      if (isInsideLeva(e.target)) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && isInsideLeva(active)) {
        active.blur();
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('mousedown', onMouseDown);
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
      const fwd =
        (keys.has('w') || keys.has('arrowup') ? 1 : 0) -
        (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
      const strafe =
        (keys.has('d') || keys.has('arrowright') ? 1 : 0) -
        (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
      let isMoving = false;
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
        let dx = forwardX * fwd + rightX * strafe;
        let dz = forwardZ * fwd + rightZ * strafe;
        const len = Math.hypot(dx, dz);
        if (len > 0) {
          dx /= len;
          dz /= len;
          const move = (playerSpeed * dt) / 1000;
          const movementYaw = Math.atan2(-dx, -dz);

          // Find the body's primary collider — Rapier's controller
          // works on a single collider, and we registered three
          // (body + 2 sensors). The first non-sensor collider IS the
          // body collider; sensors don't push, so we want the body.
          let bodyCollider = null;
          for (let i = 0; i < body.numColliders(); i++) {
            const c = body.collider(i);
            if (!c.isSensor()) {
              bodyCollider = c;
              break;
            }
          }
          if (bodyCollider) {
            // Lazily create or refresh the character controller. If
            // the world proxy has swapped its underlying World (e.g.
            // Physics rebuilt after a Leva change), reattach.
            if (
              !controllerRef.current ||
              controllerWorldRef.current !== world
            ) {
              const c = world.createCharacterController(0.01);
              c.setApplyImpulsesToDynamicBodies(false);
              c.setSlideEnabled(true);
              controllerRef.current = c;
              controllerWorldRef.current = world;
            }
            const controller = controllerRef.current;
            if (!controller) return;
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
              { x: dx * move, y: 0, z: dz * move },
              RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
            );
            const corrected = controller.computedMovement();

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

            // `movementBlockThreshold` from worldSettings controls
            // when we treat "blocked enough" as fully stopped —
            // preserving the original behaviour where pushing into a
            // wall snaps the walking animation back to idle instead of
            // looping forever at zero ground speed.
            //
            // We compute `progress` BEFORE applying any movement to
            // the rigid body so we can short-circuit the
            // `setNextKinematicTranslation` call as well — otherwise
            // even a fully-blocked character would creep forward by
            // the controller's residual corrected delta each frame.
            // "Blocked above the threshold" means *no* forward
            // progress in this direction, full stop.
            const correctedLen = Math.hypot(corrected.x, corrected.z);
            const intentLen = Math.hypot(dx * move, dz * move);
            const progress =
              intentLen > 1e-9 ? Math.min(1, correctedLen / intentLen) : 0;
            if (progress < minProgress) {
              actions.setSelfPosition(
                self.pos,
                { x: 0, y: 0, z: 0 },
                movementYaw,
              );
              isMoving = false;
            } else {
              const t = body.translation();
              const newPos = {
                x: t.x + corrected.x,
                y: self.pos.y,
                z: t.z + corrected.z,
              };
              body.setNextKinematicTranslation(newPos);
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
            }
          }
        }
      }
      // On the moving → idle transition, zero out the velocity once so
      // the renderer (and remote peers) see the stop.
      if (!isMoving && wasMoving.current) {
        actions.setSelfPosition(self.pos, { x: 0, y: 0, z: 0 }, self.yaw);
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
