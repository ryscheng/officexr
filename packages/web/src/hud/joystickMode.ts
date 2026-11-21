import { useCallback, useSyncExternalStore } from 'react';

export type JoystickMode = 'floating' | 'fixed';

const KEY = 'officexr:hud:joystick';
const listeners = new Set<() => void>();
let session: JoystickMode | null = null;

const parse = (raw: string | null): JoystickMode | null => (raw === 'floating' || raw === 'fixed' ? raw : null);

function read(): JoystickMode {
  if (session) {
    return session;
  }
  try {
    return parse(localStorage.getItem(KEY)) ?? 'floating';
  } catch {
    return 'floating';
  }
}

export function setJoystickMode(mode: JoystickMode): void {
  session = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // The choice then lasts for the session only.
  }
  listeners.forEach((l) => l());
}

export function resetJoystickModeForTest(): void {
  session = null;
}

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => void listeners.delete(onChange);
};

export function useJoystickMode(): [JoystickMode, (mode: JoystickMode) => void] {
  const mode = useSyncExternalStore(subscribe, read, (): JoystickMode => 'floating');
  return [mode, useCallback(setJoystickMode, [])];
}
