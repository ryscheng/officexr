import React, { useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import type {
  Actions,
  Store,
  RuleRegistry,
  SyncEngine,
  SnapshotHandshake,
  Bus,
} from '@officexr/sdk';
import { getCollisionWorld, resolveMovement } from '@officexr/sdk';
import type { BotPool } from '../bot/BotPool.ts';
import type { CameraMode } from './config.ts';

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
  /** Manual fine-tune for fixed-mode WASD direction (degrees). Added to the
   * derived camera yaw so the user can compensate if the world axes don't
   * line up with what they expect to be "up the screen". */
  fixedMovementYawOffsetDeg: number;
  yawRef: React.MutableRefObject<number>;
  selfId: string;
}

const ARROW_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

/**
 * Owns the per-frame loop: WASD movement, world tick, rule evaluation,
 * sync flushing, bot updates. Mounted once inside <Canvas>.
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
}: SceneFrameProps) {
  const keysDown = React.useRef<Set<string>>(new Set());
  const prevState = React.useRef(store.getState());
  const wasMoving = React.useRef(false);

  useEffect(() => {
    const isInsideLeva = (el: EventTarget | null): boolean =>
      el instanceof Element && !!el.closest('#leva__root');

    // Leva sliders use pointer events without taking keyboard focus, so the
    // e.target / activeElement checks alone don't catch the "user is dragging
    // a slider" case. We also track whether the pointer is currently over
    // the leva panel and treat that as "leva is being interacted with".
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
        // Drop anything we still think is held — keyup might never fire if
        // leva swallows it — and let the panel consume the keystroke.
        keysDown.current.clear();
        return;
      }
      if (ARROW_KEYS.has(e.key)) e.preventDefault();
      keysDown.current.add(e.key.toLowerCase());
    };
    // Always release on keyup, regardless of focus, so a key can't get stuck
    // if focus moved into Leva mid-press.
    const onKeyUp = (e: KeyboardEvent) =>
      keysDown.current.delete(e.key.toLowerCase());
    const onFocusIn = (e: FocusEvent) => {
      if (isInsideLeva(e.target)) keysDown.current.clear();
    };
    // Click outside the panel returns focus to the document so WASD works
    // again without the user having to tab away.
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
    // Speed and collision params live in world state — read them each frame
    // so settings changes from any peer take effect immediately.
    const {
      playerSpeed: baseSpeed,
      runSpeedMultiplier,
      charRadius,
      movementBlockThreshold,
    } = stateSnapshot.worldSettings;
    // Hold Shift to run. The keydown handler adds e.key.toLowerCase(), so
    // both Left/Right Shift end up as the same 'shift' entry.
    const isRunning = keys.has('shift');
    const playerSpeed = isRunning ? baseSpeed * runSpeedMultiplier : baseSpeed;
    const collisionWorld = getCollisionWorld(stateSnapshot.worldMap);
    if (self) {
      const fwd =
        (keys.has('w') || keys.has('arrowup') ? 1 : 0) -
        (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
      const strafe =
        (keys.has('d') || keys.has('arrowright') ? 1 : 0) -
        (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
      let isMoving = false;
      if (fwd !== 0 || strafe !== 0) {
        // Movement is always camera-relative. The fixed-camera placement is
        // position=(sin(az), -cos(az)), giving forward=(-sin(az), +cos(az)).
        // The mouse-look formula below assumes forward=(-sin(yaw), -cos(yaw)),
        // so we map fixed azimuth → yaw via yaw = π − az to align them.
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
          // Resolve against obstacles, the map edge, and other characters.
          // The bot is just another character to us here — same primitives,
          // same world data (broadcast world:map keeps both stores aligned).
          const others: Array<{
            id: string;
            pos: { x: number; y: number; z: number };
            radius: number;
          }> = [];
          for (const [id, p] of Object.entries(stateSnapshot.players)) {
            if (id === selfId) continue;
            others.push({ id, pos: p.pos, radius: charRadius });
          }
          const intentTo = {
            x: self.pos.x + dx * move,
            y: self.pos.y,
            z: self.pos.z + dz * move,
          };
          const result = resolveMovement({
            from: self.pos,
            to: intentTo,
            charRadius,
            world: collisionWorld,
            others,
          });
          // Progress = how much of the requested vector survived the resolve,
          // measured as projection of (resolved - from) onto the normalised
          // intent. 1 = unblocked, 0 = fully blocked, slide-only motion gets
          // a low score because it's perpendicular to intent.
          const intentDX = intentTo.x - self.pos.x;
          const intentDZ = intentTo.z - self.pos.z;
          const intentLenSq = intentDX * intentDX + intentDZ * intentDZ;
          let progress = 1;
          if (intentLenSq > 1e-12) {
            const actualDX = result.pos.x - self.pos.x;
            const actualDZ = result.pos.z - self.pos.z;
            const dot = actualDX * intentDX + actualDZ * intentDZ;
            progress = Math.max(0, Math.min(1, dot / intentLenSq));
          }
          const minProgress = 1 - movementBlockThreshold;
          if (progress < minProgress) {
            // Mostly blocked — snap to zero so the avatar doesn't slide
            // sideways while the walk animation has already settled to idle.
            actions.setSelfPosition(
              self.pos,
              { x: 0, y: 0, z: 0 },
              movementYaw,
            );
            isMoving = false;
          } else {
            // Scale vel by progress so the renderer animates at a rate that
            // matches the actual ground speed.
            actions.setSelfPosition(
              result.pos,
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
      // On the moving → idle transition, clear vel exactly once so the
      // renderer (and remote peers) see the stop without us calling
      // setSelfPosition every frame at rest.
      if (!isMoving && wasMoving.current) {
        actions.setSelfPosition(self.pos, { x: 0, y: 0, z: 0 }, self.yaw);
      }
      wasMoving.current = isMoving;
    }

    actions.tick(now);
    // bots tick BEFORE rules.tick so the rule pass sees the latest positions
    // from every active bot — the bump rule's rising-edge detection needs
    // every participant's move settled into the store first.
    bots.tick(dt);
    const current = store.getState();
    rules.tick(current, prevState.current, bus);
    prevState.current = store.getState();
    sync.flushPosition();
    handshake.tickTimers();
  });

  return null;
}
