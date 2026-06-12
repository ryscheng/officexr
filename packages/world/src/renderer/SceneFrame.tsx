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
  CHARACTER_CONTROLLER_SKIN,
  FLOOR_PROBE_RANGE,
  GRAVITY as GAME_GRAVITY,
  pickRespawnPosition,
  respawnThreshold,
  shouldRespawnFalling,
} from '../physics/rules.ts';
import { horizontalProgress } from '../physics/blocking.ts';

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
  /** Mutated each frame to true while the local player is airborne.
   * Players.tsx reads this to drive the jump animation for the self avatar
   * without React re-renders. Ref is created in Scene.tsx and threaded to
   * both SceneFrame and Players. */
  isAirborneRef: React.MutableRefObject<boolean>;
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
  isAirborneRef,
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
  // Jump state refs — all declared here so the per-frame closure can
  // mutate them without re-binding useFrame. Declared BEFORE the
  // `__OFFICE_GRAVITY__` effect so its `setEnabled` closure can
  // reference them without TS "used before declaration" errors.
  // Tracks "this character actively jumped and has not finished the
  // landing blend yet". Drives the broadcast `isAirborne` flag and the
  // 'jumping' animation. Critically NOT inferred from
  // `jumpsRemainingRef < maxJumps` — the ref starts at 0 (refilled on
  // first grounded frame), so that derivation would misclassify the
  // spawn frame as airborne.
  const airborneRef = useRef(false);
  const jumpsRemainingRef = useRef(0);    // refilled to maxJumps on landing
  const airVelXRef = useRef(0);           // captured/deflected horizontal velocity while airborne
  const airVelZRef = useRef(0);
  const landingBlendTRef = useRef(0);     // ms elapsed in the landing ease blend
  const blendStartVelXRef = useRef(0);    // airVel at the moment the landing blend began (linear lerp source)
  const blendStartVelZRef = useRef(0);
  const spaceWasDownRef = useRef(false);  // edge-trigger: was Space held last frame?
  useEffect(() => {
    (window as unknown as {
      __OFFICE_GRAVITY__?: { setEnabled: (v: boolean) => void };
    }).__OFFICE_GRAVITY__ = {
      setEnabled: (v: boolean) => {
        gravityEnabledRef.current = v;
        if (!v) {
          // Gravity-off mode (Mugshot): treat the character as
          // grounded — clear any jump/landing state but do NOT zero
          // `jumpsRemainingRef`. Zeroing it would make every frame
          // classify as airborne (since 0 < maxJumps), permanently
          // pinning the avatar in the `'jumping'` animation pose
          // and forcing the airborne broadcast branch.
          verticalVelRef.current = 0;
          airborneRef.current = false;
          airVelXRef.current = 0;
          airVelZRef.current = 0;
          landingBlendTRef.current = 0;
        }
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

  // SRP violation: SceneFrame owns WASD input, physics step, gravity,
  // respawn, broadcast, and bot/world ticks. This is a pre-existing bend
  // forced by React/r3f: `useRapier()` must be called inside the Canvas
  // component tree, and `useFrame` must be called from a mounted component,
  // so the per-frame physics step cannot be split into a separate module
  // without a significant r3f refactor. The dual-gate respawn rule and
  // intent-verb pattern are adopted here to ensure behavioral parity with
  // BotCharacterMovement without restructuring the component model.
  // What would remove this: extract SceneFrame's physics step into a
  // headless class that accepts `world` + `controller` as constructor args,
  // wrapping it in a thin r3f component that calls useRapier/useFrame.
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
      // Destructure jump tunables from worldSettings for this frame.
      const { jumpVelocity, airControl, maxJumps, landingEaseMs } =
        stateSnapshot.worldSettings;

      // Space key edge-trigger for jump: only fire on the frame the
      // key transitions from up to down. Holding Space does not repeat.
      const spaceDown = keys.has(' ');
      const spacePressedThisFrame = spaceDown && !spaceWasDownRef.current;
      spaceWasDownRef.current = spaceDown;

      // Airborne is an explicit state set on jump trigger and cleared
      // on full landing blend (or warp / respawn / gravity-off).
      const isAirborne = airborneRef.current;

      // Write to the ref each frame so Players.tsx can read it
      // without a React re-render.
      isAirborneRef.current = isAirborne;

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
        // Reset jump state so a teleport doesn't leave the player
        // mid-jump with a depleted counter.
        airborneRef.current = false;
        jumpsRemainingRef.current = maxJumps;
        airVelXRef.current = 0;
        airVelZRef.current = 0;
        landingBlendTRef.current = 0;
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

      // Intent verb (mirrors CharacterMovement interface):
      // isRunning + (fwd || strafe) → 'run' verb
      // !isRunning + (fwd || strafe) → 'walk' verb
      // neither → 'stop' verb
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
          const c = world.createCharacterController(CHARACTER_CONTROLLER_SKIN);
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

        // --- Grounded handling + landing blend ---
        // Must happen BEFORE the jump trigger so we know if we landed
        // this frame and can properly clear airborne state.
        if (controller.computedGrounded()) {
          verticalVelRef.current = 0;
          if (airborneRef.current) {
            // Capture start-of-blend airVel once so the blend is a true
            // linear lerp toward zero (not a compounding `*= (1-t)`).
            if (landingBlendTRef.current === 0) {
              blendStartVelXRef.current = airVelXRef.current;
              blendStartVelZRef.current = airVelZRef.current;
            }
            landingBlendTRef.current += dt;
            if (landingEaseMs <= 0 || landingBlendTRef.current >= landingEaseMs) {
              // Blend complete (or instant hard-stop).
              airborneRef.current = false;
              jumpsRemainingRef.current = maxJumps;
              airVelXRef.current = 0;
              airVelZRef.current = 0;
              landingBlendTRef.current = 0;
            } else {
              // Linear lerp from `blendStart*` toward zero over the
              // configured ease duration.
              const t = landingBlendTRef.current / landingEaseMs;
              airVelXRef.current = blendStartVelXRef.current * (1 - t);
              airVelZRef.current = blendStartVelZRef.current * (1 - t);
            }
          } else {
            // On the ground without an active jump — refill the
            // counter so the first Space press from rest works, and
            // make sure any stale blend timer is cleared.
            jumpsRemainingRef.current = maxJumps;
            landingBlendTRef.current = 0;
          }
        }

        // --- Jump trigger ---
        // Placed after grounded handling so a freshly-landed frame
        // that also receives a Space press correctly re-grants a jump.
        // Also requires gravity to be enabled — disable-gravity mode
        // (Mugshot) treats the character as frozen on the ground.
        if (
          spacePressedThisFrame &&
          jumpsRemainingRef.current > 0 &&
          !warped &&
          gravityEnabledRef.current
        ) {
          verticalVelRef.current = jumpVelocity;
          if (!airborneRef.current) {
            // First jump from ground: capture current WASD intent as
            // the air-vel baseline. dx/dz are normalised direction
            // unit vectors; multiply by playerSpeed to get m/s.
            // Standing-still jump → 0 carry.
            airVelXRef.current = dx * playerSpeed;
            airVelZRef.current = dz * playerSpeed;
          }
          // Second jump: airVelXRef/Z already hold mid-air deflected values.
          airborneRef.current = true;
          jumpsRemainingRef.current--;
          landingBlendTRef.current = 0; // cancel any active landing blend
        }

        // --- Horizontal movement (airborne vs. ground) ---
        let moveX: number;
        let moveZ: number;

        if (isAirborne) {
          // Air-control: low-pass blend airVel toward WASD intent each frame.
          const intentX = dx * playerSpeed;
          const intentZ = dz * playerSpeed;
          airVelXRef.current += (intentX - airVelXRef.current) * airControl * dtSec;
          airVelZRef.current += (intentZ - airVelZRef.current) * airControl * dtSec;
          moveX = airVelXRef.current * dtSec;
          moveZ = airVelZRef.current * dtSec;
        } else {
          moveX = dx * horizMove;
          moveZ = dz * horizMove;
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
            x: moveX,
            y: verticalVelRef.current * dtSec,
            z: moveZ,
          },
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

        // `movementBlockThreshold` from worldSettings controls when
        // we treat "blocked enough" as fully stopped — preserving
        // the original behaviour where pushing into a wall snaps
        // the walking animation back to idle. Only applies when the
        // user is intentionally moving; gravity-only frames don't
        // count as "blocked horizontal movement".
        //
        // Unified blocking decision: horizontalProgress() is shared with
        // BotPhysicsWorld (bot path) via physics/blocking.ts — single
        // source of truth for both human and bot movement-blocking.
        //
        // DIP note: SceneFrame (renderer) and BotPhysicsWorld (physics)
        // each run their own Rapier world and gravity integration because
        // SceneFrame lives inside the r3f Canvas with @react-three/rapier
        // while BotPhysicsWorld is a headless Rapier instance. The full
        // CharacterMovement interface (gravity, position application, anim
        // derivation) is therefore still duplicated across the two paths.
        // What IS now unified is the blocking-decision scalar:
        // horizontalProgress replaces the old magnitude-ratio in SceneFrame
        // and the inline dot-product in BotPhysicsWorld, so both paths
        // agree on when "the character is blocked". To remove the remaining
        // duplication, SceneFrame would need to be refactored onto a
        // SceneFrameCharacterMovement impl of CharacterMovement — tracked
        // as a future step in refactor-plan/.
        const progress = horizontalProgress(
          { x: corrected.x, z: corrected.z },
          { x: moveX, z: moveZ },
        );
        const horizBlocked = intendsMove && progress < minProgress;

        const t = body.translation();
        let newPos = {
          x: horizBlocked ? t.x : t.x + corrected.x,
          y: t.y + corrected.y,
          z: horizBlocked ? t.z : t.z + corrected.z,
        };

        // Fall-respawn — dual-gate rule (matches BotCharacterMovement / BotDriver).
        // Primary gate: both (a) no floor found within FLOOR_PROBE_RANGE and
        // (b) falling fast enough (shouldRespawnFalling). This fires before the
        // character exits the bottom of the world so respawns feel responsive.
        // Backstop: Y-floor threshold (respawnThreshold) is retained as a
        // last-resort safety net for edge cases where the primary gate misses
        // (e.g. floor probe briefly inconclusive or map geometry very sparse).
        const floorRay = new RAPIER.Ray(
          { x: newPos.x, y: newPos.y, z: newPos.z },
          { x: 0, y: -1, z: 0 },
        );
        const floorHit = world.castRay(
          floorRay,
          FLOOR_PROBE_RANGE,
          true,
          RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        );
        const hasFloorUnderneath = floorHit !== null;
        const backstopThreshold = respawnThreshold(stateSnapshot.worldObjects);
        if (
          shouldRespawnFalling(verticalVelRef.current, hasFloorUnderneath) ||
          newPos.y < backstopThreshold
        ) {
          const r = pickRespawnPosition(spawnsRef.current);
          if (r) {
            newPos = r;
            verticalVelRef.current = 0;
            // Reset jump state on respawn so the player starts fresh.
            airborneRef.current = false;
            jumpsRemainingRef.current = maxJumps;
            airVelXRef.current = 0;
            airVelZRef.current = 0;
            landingBlendTRef.current = 0;
            // Skip animation transitions; treat as a teleport. The
            // body warp happens via the same auto-warp path that
            // handles spawn-from-sky: setSelfPosition(r) updates the
            // store, and the auto-warp at the top of the next frame
            // moves the body to match.
          }
        }

        body.setNextKinematicTranslation(newPos);

        // Broadcast velocity and isAirborne. While airborne, use the
        // carried air velocity so peers extrapolate the correct mid-air
        // trajectory.
        const broadcastVel = isAirborne
          ? { x: airVelXRef.current, y: 0, z: airVelZRef.current }
          : (intendsMove && !horizBlocked)
            ? { x: dx * playerSpeed * progress, y: 0, z: dz * playerSpeed * progress }
            : { x: 0, y: 0, z: 0 };
        const broadcastYaw = intendsMove ? movementYaw : self.yaw;

        if (isAirborne || (intendsMove && !horizBlocked)) {
          actions.setSelfPosition(newPos, broadcastVel, broadcastYaw, isAirborne);
          isMoving = isAirborne || (intendsMove && !horizBlocked);
        } else {
          actions.setSelfPosition(newPos, { x: 0, y: 0, z: 0 }, broadcastYaw, false);
        }
      }
      // On the moving → idle transition, zero out the velocity once so
      // the renderer (and remote peers) see the stop. While airborne,
      // isMoving is true so this branch never fires mid-air.
      if (!isMoving && wasMoving.current) {
        const t = body?.translation();
        const stopPos = t ? { x: t.x, y: t.y, z: t.z } : self.pos;
        actions.setSelfPosition(stopPos, { x: 0, y: 0, z: 0 }, self.yaw, false);
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
