import { useCallback, useSyncExternalStore } from 'react';

const KEY = 'officexr:hud:lock-camera-angle';
const LEGACY_JOYSTICK_KEY = 'officexr:hud:joystick';
const listeners = new Set<() => void>();
let session: boolean | null = null;

function read(): boolean {
  if (session !== null) {
    return session;
  }
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

export function setLockCameraAngle(locked: boolean): void {
  session = locked;
  try {
    localStorage.setItem(KEY, locked ? 'on' : 'off');
  } catch {
    // The choice then lasts for the session only.
  }
  listeners.forEach((l) => l());
}

export function resetLockCameraAngleForTest(): void {
  session = null;
}

export function forgetLegacyJoystickChoice(): void {
  try {
    localStorage.removeItem(LEGACY_JOYSTICK_KEY);
  } catch {
    // Nothing to clean up where storage is blocked.
  }
}

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => void listeners.delete(onChange);
};

export function useLockCameraAngle(): [boolean, (locked: boolean) => void] {
  const locked = useSyncExternalStore(subscribe, read, () => false);
  return [locked, useCallback(setLockCameraAngle, [])];
}

export interface AngleLockSources {
  overhead: boolean;
  motionLook: boolean;
  userLock: boolean;
}

/** While the angle is locked, dragging does not turn the view, so the joystick may start anywhere. */
export const cameraAngleLocked = ({ overhead, motionLook, userLock }: AngleLockSources): boolean =>
  overhead || motionLook || userLock;
