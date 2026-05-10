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
import type { BotDriver } from '../bot/BotDriver.ts';
import type { CameraMode } from './config.ts';

interface SceneFrameProps {
  store: Store;
  actions: Actions;
  rules: RuleRegistry;
  bus: Bus;
  sync: SyncEngine;
  handshake: SnapshotHandshake;
  bot: BotDriver;
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
  bot,
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

    const onKeyDown = (e: KeyboardEvent) => {
      // While a Leva input has focus, let the panel consume the keystroke.
      if (isInsideLeva(e.target)) return;
      if (ARROW_KEYS.has(e.key)) e.preventDefault();
      keysDown.current.add(e.key.toLowerCase());
    };
    // Always release on keyup, regardless of focus, so a key can't get stuck
    // if focus moves into Leva mid-press.
    const onKeyUp = (e: KeyboardEvent) =>
      keysDown.current.delete(e.key.toLowerCase());
    // When Leva gains focus, drop any keys we already consider held — those
    // keys' eventual keyups may target the Leva input and never reach us.
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

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
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
    // playerSpeed lives in world state — read it each frame so settings
    // changes from any peer take effect immediately.
    const playerSpeed = stateSnapshot.worldSettings.playerSpeed;
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
          // Character faces the direction it's moving. atan2(-dx, -dz) yields
          // the yaw whose forward = (dx, dz). vel is the authoritative
          // movement-intent state — written here so the renderer can read it
          // for animation, and re-broadcast unchanged to remote peers.
          const movementYaw = Math.atan2(-dx, -dz);
          actions.setSelfPosition(
            {
              x: self.pos.x + dx * move,
              y: self.pos.y,
              z: self.pos.z + dz * move,
            },
            { x: dx * playerSpeed, y: 0, z: dz * playerSpeed },
            movementYaw,
          );
          isMoving = true;
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
    const current = store.getState();
    rules.tick(current, prevState.current, bus);
    prevState.current = store.getState();
    sync.flushPosition();
    handshake.tickTimers();
    bot.tick(dt);
  });

  return null;
}
