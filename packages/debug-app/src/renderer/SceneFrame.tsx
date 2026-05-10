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
  yawRef: React.MutableRefObject<number>;
  selfId: string;
}

const PLAYER_SPEED = 3; // m/s
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
  yawRef,
  selfId,
}: SceneFrameProps) {
  const keysDown = React.useRef<Set<string>>(new Set());
  const prevState = React.useRef(store.getState());

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
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

    const self = store.getState().players[selfId];
    if (self) {
      const fwd =
        (keys.has('w') || keys.has('arrowup') ? 1 : 0) -
        (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
      const strafe =
        (keys.has('d') || keys.has('arrowright') ? 1 : 0) -
        (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
      if (fwd !== 0 || strafe !== 0) {
        // Movement is always camera-relative. In fixed mode we derive yaw
        // from the fixed camera's azimuth so W still goes "into the screen".
        const cameraYaw =
          cameraMode === 'fixed'
            ? (fixedAzimuthDeg * Math.PI) / 180
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
          const move = (PLAYER_SPEED * dt) / 1000;
          // Character faces the direction it's moving. Yaw convention:
          // forward = (-sin(yaw), -cos(yaw)), so atan2(-dx, -dz) yields the
          // yaw whose forward equals (dx, dz). Mouse-look (yawRef) is
          // intentionally NOT used here — it only steers the camera.
          const movementYaw = Math.atan2(-dx, -dz);
          actions.setSelfPosition(
            {
              x: self.pos.x + dx * move,
              y: self.pos.y,
              z: self.pos.z + dz * move,
            },
            { x: 0, y: 0, z: 0 },
            movementYaw,
          );
        }
      }
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
